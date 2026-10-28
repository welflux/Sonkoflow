begin;
-- Phase 3 extends the Phase 2 job/usage ledger; no image table, bucket or RLS reset.
alter table public.processing_jobs
 add column quality_state text not null default 'not_applicable' check(quality_state in ('not_applicable','pending','running','completed','unavailable')),
 add column quality_report jsonb,
 add column quality_error_code text check(quality_error_code in ('assessment_storage','assessment_configuration','assessment_persistence','assessment_provider_failed','assessment_interrupted','assessment_quota','assessment_credentials','assessment_invalid','assessment_unavailable','assessment_reservation_expired')),
 add column quality_model text check(quality_model is null or quality_model='gpt-6.1-terra'),
 add column quality_price_snapshot jsonb,
 add column quality_reserved_micro_usd bigint not null default 0 check(quality_reserved_micro_usd>=0),
 add column quality_provider_started_at timestamptz,
 add column quality_provider_usage jsonb,
 add column quality_request_id text check(length(quality_request_id)<=200),
 add column quality_cost_micro_usd bigint check(quality_cost_micro_usd>=0),
 add column generation_cost_micro_usd bigint check(generation_cost_micro_usd>=0),
 add column quality_lease_owner uuid,
 add column quality_lease_until timestamptz,
 add column quality_parent_id uuid references public.processing_jobs(id) on delete set null,
 add column quality_root_id uuid references public.processing_jobs(id) on delete set null,
 add column quality_retry_number integer not null default 0 check(quality_retry_number between 0 and 5),
 add column quality_retry_limit integer not null default 2 check(quality_retry_limit between 0 and 5),
 add column quality_retry_targets jsonb not null default '[]'::jsonb check(jsonb_typeof(quality_retry_targets)='array'),
 add column quality_retry_instructions text not null default '' check(length(quality_retry_instructions)<=800),
 add column user_decision text not null default 'pending' check(user_decision in ('pending','approved','rejected')),
 add column decision_revision integer not null default 0,
 add column quality_decisions jsonb not null default '[]'::jsonb check(jsonb_typeof(quality_decisions)='array');
update public.processing_jobs set generation_cost_micro_usd=cost_estimate_micro_usd;
-- Older completed results receive free local checks only, never retroactive API spend.
update public.processing_jobs set quality_state='pending' where mode='product' and status='completed' and input_image_id is not null and output_image_id is not null;
create index product_quality_queue on public.processing_jobs(quality_state,created_at) where mode='product' and status='completed';
create unique index product_retry_number on public.processing_jobs(quality_root_id,quality_retry_number) where quality_root_id is not null;

alter function public.submit_processing_job(jsonb,jsonb) rename to submit_processing_job_v2;
create function public.submit_processing_job(p jsonb,limits jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.processing_jobs;parent public.processing_jobs;root public.processing_jobs;rid uuid;n integer;target text;
 owner uuid:=(p->>'user_id')::uuid;limit_count integer:=coalesce((p->>'quality_retry_limit')::int,2);
begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));
 select * into j from public.processing_jobs where user_id=owner and submission_key=(p->>'submission_key')::uuid;
 if found then
  if j.request_fingerprint is distinct from p->>'request_fingerprint' then raise exception 'submission_conflict';end if;
  return to_jsonb(j);
 end if;
 -- A partial known cost must still consume budget even when the total estimate
 -- is null because one provider omitted usage. Keep the Phase 2 checks as well.
 if (select coalesce(sum(greatest(reserved_micro_usd,coalesce(generation_cost_micro_usd,0)+coalesce(quality_cost_micro_usd,0))),0) from public.processing_jobs
      where created_at>=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'))+(p->>'reserved_micro_usd')::bigint>(limits->>'global_budget')::bigint or
    (select coalesce(sum(greatest(reserved_micro_usd,coalesce(generation_cost_micro_usd,0)+coalesce(quality_cost_micro_usd,0))),0) from public.processing_jobs
      where user_id=owner and created_at>=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'))+(p->>'reserved_micro_usd')::bigint>(limits->>'user_budget')::bigint then raise exception 'budget_limit';end if;
 if p->>'quality_parent_id' is not null then
  select * into parent from public.processing_jobs where id=(p->>'quality_parent_id')::uuid and user_id=owner for update;
  if not found or parent.mode<>'product' or parent.status<>'completed' or parent.quality_state not in ('completed','unavailable') or parent.user_decision='approved' then raise exception 'quality_retry_state';end if;
  if parent.input_image_id is null or parent.project_id is null then raise exception 'source_not_found';end if;
  rid:=coalesce(parent.quality_root_id,parent.id);
  select * into root from public.processing_jobs where id=rid and user_id=owner;
  if not found then raise exception 'quality_retry_state';end if;
  limit_count:=least(root.quality_retry_limit,limit_count);
  select coalesce(max(quality_retry_number),0)+1 into n from public.processing_jobs where quality_root_id=rid;
  if n>limit_count then raise exception 'quality_retry_limit';end if;
  if jsonb_typeof(p->'quality_retry_targets') is distinct from 'array' or jsonb_array_length(p->'quality_retry_targets') not between 1 and 8 then raise exception 'quality_retry_target';end if;
  for target in select jsonb_array_elements_text(p->'quality_retry_targets') loop
   if target='customer_detail' then
    if length(trim(coalesce(p->>'quality_retry_instructions','')))=0 then raise exception 'quality_retry_target';end if;
   elsif target='assessment_availability' and (length(trim(coalesce(p->>'quality_retry_instructions','')))=0 or not (p->'quality_retry_targets' ? 'customer_detail')) then raise exception 'quality_retry_target';
   elsif exists(select 1 from jsonb_array_elements(parent.quality_report->'checks') c where c->>'id'=target and c->>'status'='unavailable')
    and (length(trim(coalesce(p->>'quality_retry_instructions','')))=0 or not (p->'quality_retry_targets' ? 'customer_detail')) then raise exception 'quality_retry_target';
   elsif not exists(select 1 from jsonb_array_elements(parent.quality_report->'checks') c where c->>'id'=target and c->>'status' in ('needs_review','failed','unavailable')) then raise exception 'quality_retry_target';
   end if;
  end loop;
  if p->>'input_image_id' is distinct from parent.input_image_id::text or p->>'project_id' is distinct from parent.project_id::text or p->>'mode'<>'product' or p->'settings' is distinct from parent.settings or p->>'instructions' is distinct from parent.instructions then raise exception 'quality_retry_state';end if;
 else
  n:=0;rid:=null;
 end if;
 if coalesce((p->>'quality_reserved_micro_usd')::bigint,0)<0 or coalesce((p->>'quality_reserved_micro_usd')::bigint,0)>(p->>'reserved_micro_usd')::bigint then raise exception 'invalid_reservation';end if;
 if p->>'quality_model' is not null and (p->>'mode'<>'product' or coalesce((p->>'quality_reserved_micro_usd')::bigint,0)<=0) then raise exception 'invalid_reservation';end if;
 j:=jsonb_populate_record(null::public.processing_jobs,public.submit_processing_job_v2(p,limits));
 update public.processing_jobs set quality_retry_limit=limit_count,quality_parent_id=parent.id,quality_root_id=rid,
  quality_retry_number=n,quality_retry_targets=coalesce(p->'quality_retry_targets','[]'::jsonb),
  quality_retry_instructions=coalesce(p->>'quality_retry_instructions',''),
  quality_model=p->>'quality_model',quality_price_snapshot=p->'quality_price_snapshot',
  quality_reserved_micro_usd=coalesce((p->>'quality_reserved_micro_usd')::bigint,0)
 where id=j.id returning * into j;
 return to_jsonb(j);
end;$$;

alter function public.processing_step(uuid,uuid,text,jsonb) rename to processing_step_v2;
create function public.processing_step(job uuid,worker uuid,action text,p jsonb default '{}'::jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare ok boolean;begin
 ok:=public.processing_step_v2(job,worker,action,p);
 if ok and action='response' then update public.processing_jobs set generation_cost_micro_usd=(p->>'cost')::bigint where id=job;end if;
 if ok and action='complete' then update public.processing_jobs set quality_state='pending'
  where id=job and mode='product' and quality_state='not_applicable';end if;
 return ok;
end;$$;

create function public.claim_product_assessment(worker uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.processing_jobs;begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-product-assessment'));
 -- If an external assessment might have run, retain its known local report and
 -- never call it again after an interrupted lease. No image is regenerated.
 update public.processing_jobs set quality_state='unavailable',quality_lease_until=null,quality_error_code='assessment_interrupted',
  quality_report=jsonb_build_object('version','product-review-v1','status',case when quality_report->>'status'='failed' then 'failed' else 'needs_review' end,'assessed_at',now(),
    'checks',coalesce(quality_report->'checks','[]'::jsonb)||jsonb_build_array(jsonb_build_object(
      'id','assessment_availability','label','Interrupted assessment','status','unavailable','method','availability',
      'confidence',null,'explanation','The assessment was interrupted after dispatch and may have incurred usage. It was not repeated. Review the retained result yourself.')))
 where quality_state='running' and quality_lease_until<now() and quality_provider_started_at is not null;
 update public.processing_jobs set quality_state='pending',quality_lease_until=null where quality_state='running' and quality_lease_until<now() and quality_provider_started_at is null;
 if exists(select 1 from public.processing_jobs where quality_state='running' and quality_lease_until>now()) then return null;end if;
 select * into j from public.processing_jobs where mode='product' and status='completed' and quality_state='pending'
  order by created_at,id for update skip locked limit 1;
 if not found then return null;end if;
 update public.processing_jobs set quality_state='running',quality_lease_owner=worker,quality_lease_until=now()+interval '120 seconds' where id=j.id returning * into j;
 return to_jsonb(j);
end;$$;
create function public.product_assessment_step(job uuid,worker uuid,action text,p jsonb default '{}'::jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.processing_jobs;begin
 select * into j from public.processing_jobs where id=job and quality_lease_owner=worker for update;
 if not found then return false;end if;
 if action in ('complete','unavailable') and j.quality_state in ('completed','unavailable') then return true;end if;
 if j.quality_state<>'running' then return false;end if;
 if action='heartbeat' then update public.processing_jobs set quality_lease_until=now()+interval '120 seconds' where id=job;
 elsif action='local' then update public.processing_jobs set quality_report=p->'report' where id=job;
 elsif action='dispatch' then
  if j.quality_model is null or j.quality_provider_started_at is not null then return false;end if;
  if j.created_at<(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') then
   update public.processing_jobs set quality_state='unavailable',quality_lease_until=null,quality_error_code='assessment_reservation_expired',
    quality_report=jsonb_build_object('version','product-review-v1','status',case when quality_report->>'status'='failed' then 'failed' else 'needs_review' end,'assessed_at',now(),
     'checks',coalesce(quality_report->'checks','[]'::jsonb)||jsonb_build_array(jsonb_build_object('id','assessment_availability','label','Assessment reservation expired','status','unavailable','method','availability','confidence',null,
      'explanation','The original daily reservation expired before vision dispatch. No assessment API call was made. Review the saved image manually.'))) where id=job;
   return false;
  end if;
  update public.processing_jobs set quality_provider_started_at=now() where id=job;
  insert into public.usage_events(user_id,job_id,operation,units,idempotency_key,model,cost_basis)
   values(j.user_id,j.id,'processing',0,'assessment:'||j.id,j.quality_model,'assessment_pending_or_unknown') on conflict(user_id,idempotency_key) do nothing;
 elsif action='response' then
  if j.quality_provider_started_at is null then return false;end if;
  update public.processing_jobs set quality_provider_usage=p->'usage',quality_cost_micro_usd=(p->>'cost')::bigint,quality_request_id=p->>'request_id',
   cost_estimate_micro_usd=case when generation_cost_micro_usd is null or p->>'cost' is null then null else generation_cost_micro_usd+(p->>'cost')::bigint end where id=job;
  update public.usage_events set units=1,provider_usage=p->'usage',cost_estimate_micro_usd=(p->>'cost')::bigint,
   provider_request_id=p->>'request_id',cost_basis=case when p->>'cost' is null then 'assessment_usage_unavailable' else 'configured_vision_token_estimate' end
   where user_id=j.user_id and idempotency_key='assessment:'||j.id;
 elsif action in ('complete','unavailable') then
  if jsonb_typeof(p->'report'->'checks') is distinct from 'array' or jsonb_array_length(p->'report'->'checks')>12 then raise exception 'quality_report_invalid';end if;
  update public.processing_jobs set quality_report=p->'report',quality_error_code=case when action='unavailable' then coalesce(p->>'error_code','assessment_unavailable') else null end,quality_state=case when action='complete' then 'completed' else 'unavailable' end,quality_lease_until=null where id=job;
 else return false;end if;
 return true;
end;$$;

create function public.decide_product_result(job uuid,owner uuid,decision text,request_key uuid,expected_revision integer) returns integer
language plpgsql security definer set search_path='' as $$
declare j public.processing_jobs;event jsonb;begin
 select * into j from public.processing_jobs where id=job and user_id=owner for update;
 if not found or j.mode<>'product' or j.status<>'completed' or j.quality_state not in ('completed','unavailable') or j.output_image_id is null then raise exception 'quality_decision_state';end if;
 select e into event from jsonb_array_elements(j.quality_decisions) e where e->>'request_key'=request_key::text;
 if found then
  if event->>'decision'<>decision then raise exception 'submission_conflict';end if;
  return (event->>'revision')::int;
 end if;
 if decision not in ('approved','rejected') or expected_revision<>j.decision_revision or j.decision_revision>=50 then raise exception 'quality_decision_conflict';end if;
 update public.processing_jobs set user_decision=decision,decision_revision=decision_revision+1,
 quality_decisions=quality_decisions||jsonb_build_array(jsonb_build_object('decision',decision,'request_key',request_key,'revision',decision_revision+1,'at',now()))
 where id=job returning * into j;
 return j.decision_revision;
end;$$;

create or replace function public.protect_processing_image() returns trigger language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from public.processing_jobs where (input_image_id=old.id or output_image_id=old.id) and
   (status in ('queued','running','persisting') or quality_state in ('pending','running'))) then raise exception 'processing_image_busy';end if;
 if tg_op='DELETE' then return old;else return new;end if;
end;$$;
create function public.product_quality_schema_version() returns integer language sql immutable set search_path='' as $$select 2026102802$$;
-- Renaming retains previous grants. Remove access to the internal v2 entry points.
revoke all on function public.submit_processing_job_v2(jsonb,jsonb),public.processing_step_v2(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.submit_processing_job(jsonb,jsonb),public.processing_step(uuid,uuid,text,jsonb),
 public.claim_product_assessment(uuid),public.product_assessment_step(uuid,uuid,text,jsonb),
 public.decide_product_result(uuid,uuid,text,uuid,integer),public.product_quality_schema_version() from public,anon,authenticated;
grant execute on function public.submit_processing_job(jsonb,jsonb),public.processing_step(uuid,uuid,text,jsonb),
 public.claim_product_assessment(uuid),public.product_assessment_step(uuid,uuid,text,jsonb),
 public.decide_product_result(uuid,uuid,text,uuid,integer),public.product_quality_schema_version() to service_role;
commit;
