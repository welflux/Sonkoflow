-- SONKOFLOW release: 28 October 2026
-- Apply ONLY to the existing Phase 1 Sonkoflow project after reviewing the preflight.
-- One transaction: any failure rolls back all new schema changes.
-- This does not reset data, enable purchasing, create payments, or call OpenAI.
-- Existing auth/profile/image objects are retained. Keep production processing disabled until verification.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));
do $$begin
 if to_regclass('public.profiles') is null or to_regclass('public.images') is null or to_regclass('public.processing_jobs') is null then raise exception 'Foundation schema missing: do not continue';end if;
 if to_regprocedure('public.processing_schema_version()') is not null or to_regclass('public.billing_settings') is not null then raise exception 'A later schema already exists: inspect migrations individually; do not rerun this bundle';end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='processing_jobs' and column_name='mode')then raise exception 'Phase 2 schema appears partially present: operator inspection required';end if;
 if exists(select 1 from public.processing_jobs where status in('queued','running'))then raise exception 'Active legacy work exists: drain it before schema deployment';end if;
 if not exists(select 1 from storage.buckets where id='photos' and public=false)then raise exception 'Private photos bucket missing or public';end if;
end$$;

-- SOURCE: 202610280001_processing.sql
-- SHA256: f241334f76b8ad6480f98255f76addac9bb23a56386e622003610ffcd4509d91
-- Add to the Phase 1 tables; retain all existing photographs, accounts and policies.
alter table public.processing_jobs drop constraint processing_jobs_status_check;
alter table public.processing_jobs add constraint processing_jobs_status_check
 check(status in ('queued','running','persisting','completed','failed','cancelled','uncertain'));
alter table public.processing_jobs
 add column mode text check(mode in ('personal','portrait','product')),
 add column instructions text not null default '' check(length(instructions)<=1500),
 add column settings jsonb not null default '{}'::jsonb,
 add column model text,
 add column output_size text,
 add column quality text check(quality in ('low','medium','high')),
 add column prompt_version text,
 add column request_fingerprint text,
 add column result_image_id uuid not null default gen_random_uuid(),
 add column output_image_id uuid,
 add column attempts integer not null default 0 check(attempts between 0 and 3),
 add column storage_attempts integer not null default 0 check(storage_attempts between 0 and 5),
 add column lease_owner uuid,
 add column lease_until timestamptz,
 add column provider_started_at timestamptz,
 add column result_received_at timestamptz,
 add column provider_request_id text check(length(provider_request_id)<=200),
 add column provider_usage jsonb,
 add column cost_estimate_micro_usd bigint check(cost_estimate_micro_usd>=0),
 add column price_snapshot jsonb,
 add column reserved_micro_usd bigint not null default 0 check(reserved_micro_usd>=0),
 add column error_code text,
 add column safe_to_retry boolean not null default false,
 add column updated_at timestamptz not null default now();
-- A deleted photograph/project must not erase the spend ledger. History retains the
-- owner and accounting, while deleted image/project references become null.
alter table public.processing_jobs alter column input_image_id drop not null;
alter table public.processing_jobs alter column project_id drop not null;
do $$declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.processing_jobs'::regclass
  and contype='f' and confrelid in ('public.images'::regclass,'public.projects'::regclass)
 loop execute format('alter table public.processing_jobs drop constraint %I',c.conname);end loop;
end;$$;
alter table public.processing_jobs add foreign key(project_id,user_id) references public.projects(id,user_id) on delete set null(project_id);
alter table public.processing_jobs add foreign key(input_image_id,project_id,user_id) references public.images(id,project_id,user_id) on delete set null(input_image_id);
alter table public.processing_jobs add foreign key(output_image_id,project_id,user_id) references public.images(id,project_id,user_id) on delete set null(output_image_id);
create index processing_queue on public.processing_jobs(status,created_at) where mode is not null;
create index jobs_project_history on public.processing_jobs(user_id,project_id,created_at desc,id desc);
create index jobs_input_active on public.processing_jobs(input_image_id) where status in ('queued','running','persisting','uncertain');
create index jobs_output_active on public.processing_jobs(output_image_id) where status in ('queued','running','persisting');
create index jobs_daily_budget on public.processing_jobs(created_at) include(user_id,reserved_micro_usd);
alter table public.usage_events add column provider_usage jsonb,
 add column cost_estimate_micro_usd bigint check(cost_estimate_micro_usd>=0),
 add column cost_basis text,add column model text,add column provider_request_id text;

-- Existing upload enforcement also respects output slots reserved by active jobs.
create or replace function public.enforce_image_quota() returns trigger language plpgsql security definer set search_path='' as $$
declare reserved integer;begin
 perform 1 from public.profiles where id=new.user_id for update;
 if new.role='original' and exists(select 1 from public.processing_jobs where result_image_id=new.id) then raise exception 'Reserved result identifier';end if;
 select count(*) into reserved from public.processing_jobs where user_id=new.user_id and mode is not null
  and status in ('queued','running','persisting') and output_image_id is null
  and not (new.role='generated' and result_image_id=new.id);
 if (select count(*) from public.images where user_id=new.user_id)+reserved>=100 or
  (select coalesce(sum(byte_size),0) from public.images where user_id=new.user_id)+reserved::bigint*10485760+new.byte_size>262144000 then
  raise exception 'Image quota exceeded' using errcode='P0001';end if;return new;
end;$$;

create function public.submit_processing_job(p jsonb,limits jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare j public.processing_jobs; i public.images; owner uuid:=(p->>'user_id')::uuid;
 day_start timestamptz:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 n integer;reserved bigint;
begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));
 select * into j from public.processing_jobs where user_id=owner and submission_key=(p->>'submission_key')::uuid;
 if found then
  if j.request_fingerprint<>p->>'request_fingerprint' then raise exception 'submission_conflict';end if;
  return to_jsonb(j);
 end if;
 select * into i from public.images where id=(p->>'input_image_id')::uuid and user_id=owner
  and project_id=(p->>'project_id')::uuid and role='original' and status='ready' for update;
 if not found then raise exception 'source_not_found';end if;
 if exists(select 1 from public.processing_jobs where input_image_id=i.id and user_id=owner and status='uncertain')
  and not coalesce((p->>'acknowledge_uncertain')::boolean,false) then raise exception 'uncertain_acknowledgement_required';end if;
 if (select count(*) from public.processing_jobs where user_id=owner and status in ('queued','running','persisting') and mode is not null)>=(limits->>'user_active')::int then raise exception 'active_limit';end if;
 if (select count(*) from public.processing_jobs where created_at>=day_start and mode is not null)>=(limits->>'global_daily')::int or
  (select count(*) from public.processing_jobs where user_id=owner and created_at>=day_start and mode is not null)>=(limits->>'user_daily')::int then raise exception 'daily_limit';end if;
 reserved:=(p->>'reserved_micro_usd')::bigint;
 if reserved<=0 then raise exception 'invalid_reservation';end if;
 if (select coalesce(sum(greatest(reserved_micro_usd,coalesce(cost_estimate_micro_usd,0))),0) from public.processing_jobs where created_at>=day_start)+reserved>(limits->>'global_budget')::bigint or
  (select coalesce(sum(greatest(reserved_micro_usd,coalesce(cost_estimate_micro_usd,0))),0) from public.processing_jobs where user_id=owner and created_at>=day_start)+reserved>(limits->>'user_budget')::bigint then raise exception 'budget_limit';end if;
 perform 1 from public.profiles where id=owner for update;
 select count(*) into n from public.processing_jobs where user_id=owner and status in ('queued','running','persisting');
 if (select count(*) from public.images where user_id=owner)+n+1>100 or
  (select coalesce(sum(byte_size),0) from public.images where user_id=owner)+(n+1)::bigint*10485760>262144000 then raise exception 'output_storage_limit';end if;
 insert into public.processing_jobs(user_id,project_id,input_image_id,submission_key,mode,instructions,settings,
  model,output_size,quality,prompt_version,request_fingerprint,price_snapshot,reserved_micro_usd)
 values(owner,i.project_id,i.id,(p->>'submission_key')::uuid,p->>'mode',p->>'instructions',p->'settings',
  p->>'model',p->>'output_size',p->>'quality',p->>'prompt_version',p->>'request_fingerprint',p->'price_snapshot',reserved) returning * into j;
 return to_jsonb(j);
end;$$;

create function public.claim_processing_job(worker uuid,lease_seconds integer,max_concurrent integer) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare j public.processing_jobs;begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-claim'));
 -- Never replay a request whose provider acceptance is unknown.
 update public.processing_jobs set status=case when provider_started_at is null then 'queued' else 'uncertain' end,
  error_code=case when provider_started_at is null then null else 'provider_interrupted' end,
  safe_to_retry=false,lease_until=null,updated_at=now()
 where status='running' and lease_until<now() and mode is not null;
 update public.processing_jobs set status='cancelled',error_code='queue_expired',completed_at=now(),updated_at=now()
 where status='queued' and (created_at<(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') or attempts>=3) and mode is not null;
 update public.processing_jobs set status='failed',error_code='result_unavailable',completed_at=now(),lease_until=null,updated_at=now()
 where status='persisting' and lease_until<now() and storage_attempts>=5;
 if (select count(*) from public.processing_jobs where status in ('running','persisting') and lease_until>now())>=max_concurrent then return null;end if;
 select * into j from public.processing_jobs where mode is not null and
  (status='queued' or (status='persisting' and lease_until<now()))
  order by case when status='persisting' then 0 else 1 end,created_at for update skip locked limit 1;
 if not found then return null;end if;
 update public.processing_jobs set status=case when j.status='persisting' then 'persisting' else 'running' end,
  attempts=case when j.status='persisting' then attempts else attempts+1 end,
  storage_attempts=case when j.status='persisting' then storage_attempts+1 else storage_attempts end,
  lease_owner=worker,lease_until=now()+make_interval(secs=>least(greatest(lease_seconds,60),900)),updated_at=now()
 where id=j.id returning * into j;
 return to_jsonb(j);
end;$$;

create function public.processing_step(job uuid,worker uuid,action text,p jsonb default '{}'::jsonb) returns boolean
 language plpgsql security definer set search_path='' as $$
declare j public.processing_jobs;begin
 select * into j from public.processing_jobs where id=job and lease_owner=worker for update;
 if not found then return false;end if;
 if action='heartbeat' then
  update public.processing_jobs set lease_until=now()+interval '90 seconds' where id=job and status in ('running','persisting');return found;
 elsif action='dispatch' then
  if j.status<>'running' or j.provider_started_at is not null then return false;end if;
  update public.processing_jobs set provider_started_at=now(),safe_to_retry=false,updated_at=now() where id=job;
  insert into public.usage_events(user_id,job_id,operation,units,idempotency_key,model,cost_basis)
   values(j.user_id,j.id,'processing',0,'processing:'||j.id,j.model,'pending_or_unknown') on conflict(user_id,idempotency_key) do nothing;
 elsif action='response' then
  if j.status not in ('running','uncertain') or j.provider_started_at is null then return false;end if;
  update public.processing_jobs set result_received_at=now(),provider_request_id=p->>'request_id',provider_usage=p->'usage',
   cost_estimate_micro_usd=(p->>'cost')::bigint,updated_at=now() where id=job;
  update public.usage_events set units=1,provider_usage=p->'usage',cost_estimate_micro_usd=(p->>'cost')::bigint,
   cost_basis=case when p->>'cost' is null then 'usage_unavailable' else 'configured_uncached_token_estimate' end,
   provider_request_id=p->>'request_id' where user_id=j.user_id and idempotency_key='processing:'||j.id;
 elsif action='prepare' then
  -- A lost RPC acknowledgement may be retried with identical metadata.
  if j.status='persisting' then return exists(select 1 from public.images where id=j.output_image_id and user_id=j.user_id
   and checksum=p->>'checksum' and byte_size=(p->>'byte_size')::int and width=(p->>'width')::int and height=(p->>'height')::int);end if;
  if j.status not in ('running','uncertain') or j.result_received_at is null then return false;end if;
  insert into public.images(id,user_id,project_id,role,object_key,filename,media_type,byte_size,width,height,checksum)
   values(j.result_image_id,j.user_id,j.project_id,'generated',j.user_id::text||'/'||j.result_image_id::text||'.webp',
   p->>'filename','image/webp',(p->>'byte_size')::int,(p->>'width')::int,(p->>'height')::int,p->>'checksum');
  update public.processing_jobs set status='persisting',output_image_id=result_image_id,lease_until=now()+interval '90 seconds',updated_at=now() where id=job;
 elsif action='complete' then
  if j.status='completed' then return true;end if;
  if j.status<>'persisting' then return false;end if;
  update public.images set status='ready' where id=j.output_image_id and user_id=j.user_id and role='generated' and status='pending';
  if not found then return false;end if;
  update public.processing_jobs set status='completed',completed_at=now(),lease_until=null,error_code=null,updated_at=now() where id=job;
 elsif action='fail' then
  if j.status not in ('running','persisting','uncertain') then return false;end if;
  update public.processing_jobs set status=case when coalesce((p->>'uncertain')::boolean,false) then 'uncertain' else 'failed' end,
   error_code=p->>'code',safe_to_retry=coalesce((p->>'safe')::boolean,false) and result_received_at is null and attempts<3 and created_at>=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),
   provider_started_at=case when coalesce((p->>'safe')::boolean,false) and result_received_at is null then null else provider_started_at end,
   completed_at=now(),lease_until=null,updated_at=now() where id=job;
 else return false;end if;
 return true;
end;$$;
create function public.retry_processing_job(job uuid,owner uuid) returns boolean
 language plpgsql security definer set search_path='' as $$begin
 update public.processing_jobs set status='queued',error_code=null,safe_to_retry=false,completed_at=null,updated_at=now()
 where id=job and user_id=owner and status='failed' and safe_to_retry=true and provider_started_at is null and attempts<3
 and created_at>=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC');return found;
end;$$;
create function public.cancel_processing_job(job uuid,owner uuid) returns boolean
 language plpgsql security definer set search_path='' as $$begin
 update public.processing_jobs set status='cancelled',completed_at=now(),updated_at=now()
 where id=job and user_id=owner and status='queued';return found;
end;$$;
create function public.protect_processing_image() returns trigger language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from public.processing_jobs where (input_image_id=old.id or output_image_id=old.id) and status in ('queued','running','persisting')) then
  raise exception 'processing_image_busy';end if;
 if tg_op='DELETE' then return old;else return new;end if;
end;$$;
create trigger processing_image_delete before delete on public.images for each row execute function public.protect_processing_image();
create trigger processing_image_mark before update of status on public.images for each row when(new.status='deleting') execute function public.protect_processing_image();
create function public.processing_schema_version() returns integer language sql immutable set search_path='' as $$select 2026102801$$;
revoke all on function public.processing_schema_version() from public,anon,authenticated;
grant execute on function public.processing_schema_version() to service_role;
revoke all on function public.submit_processing_job(jsonb,jsonb),public.claim_processing_job(uuid,integer,integer),
 public.processing_step(uuid,uuid,text,jsonb),public.retry_processing_job(uuid,uuid),public.cancel_processing_job(uuid,uuid),public.protect_processing_image() from public,anon,authenticated;
grant execute on function public.submit_processing_job(jsonb,jsonb),public.claim_processing_job(uuid,integer,integer),
 public.processing_step(uuid,uuid,text,jsonb),public.retry_processing_job(uuid,uuid),public.cancel_processing_job(uuid,uuid) to service_role;

-- SOURCE: 202610280002_product_quality.sql
-- SHA256: 55451b55eb0677acba062d7b2628c65d7cade601ea2e33f6a8787cffd3d4a6fb
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

-- SOURCE: 202610280003_product_packs.sql
-- SHA256: 9f9018d6188cf58438c52d5089b8da6653d46cad2588ea06a01e5fc5d4cc889c
create table public.product_packs(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,
 project_id uuid,input_image_id uuid,submission_key uuid not null,request_fingerprint text not null,
 configuration jsonb not null,plan jsonb not null,created_at timestamptz not null default now(),
 unique(id,user_id),unique(user_id,submission_key),
 foreign key(project_id,user_id) references public.projects(id,user_id) on delete set null(project_id),
 foreign key(input_image_id,project_id,user_id) references public.images(id,project_id,user_id) on delete set null(input_image_id));
create index pack_owner_history on public.product_packs(user_id,project_id,created_at desc);
create table public.pack_credit_accounts(
 user_id uuid primary key references public.profiles(id) on delete cascade,
 balance_credits bigint not null default 0,reserved_credits bigint not null default 0 check(reserved_credits>=0),
 unit_micro_usd bigint not null check(unit_micro_usd>0),created_at timestamptz not null default now());
alter table public.processing_jobs
 add column pack_id uuid,
 add column pack_output_type text check(pack_output_type in ('listing','lifestyle','detail','social','wide')),
 add column pack_credit_plan jsonb,
 add column pack_estimated_credits bigint check(pack_estimated_credits>=0),
 add column pack_reserved_credits bigint check(pack_reserved_credits>=0),
 add foreign key(pack_id,user_id) references public.product_packs(id,user_id);
create unique index pack_root_output on public.processing_jobs(pack_id,pack_output_type) where pack_id is not null and quality_retry_number=0;
create index pack_job_history on public.processing_jobs(user_id,pack_id,created_at,id);
create table public.pack_credit_reservations(
 user_id uuid not null references public.profiles(id) on delete cascade,job_id uuid not null,
 stage text not null check(stage in ('generation','assessment')),attempt integer not null check(attempt between 1 and 3),
 reserved_credits bigint not null check(reserved_credits>0),unit_micro_usd bigint not null check(unit_micro_usd>0),
 dispatched_at timestamptz,
 state text not null default 'held' check(state in ('held','settled','released')),
 actual_credits bigint check(actual_credits>=0),actual_micro_usd bigint check(actual_micro_usd>=0),
 primary key(job_id,stage,attempt),foreign key(job_id,user_id) references public.processing_jobs(id,user_id) on delete cascade);
alter table public.usage_events add column pack_id uuid references public.product_packs(id) on delete set null,
 add column credit_event text,add column credit_delta bigint,add column reserved_delta bigint;
alter table public.product_packs enable row level security;
alter table public.pack_credit_accounts enable row level security;
alter table public.pack_credit_reservations enable row level security;
create policy pack_owner_read on public.product_packs for select to authenticated using(user_id=(select auth.uid()));
create policy pack_account_read on public.pack_credit_accounts for select to authenticated using(user_id=(select auth.uid()));
create policy pack_reservations_read on public.pack_credit_reservations for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.product_packs,public.pack_credit_accounts,public.pack_credit_reservations from anon,authenticated;
grant select on public.product_packs,public.pack_credit_accounts,public.pack_credit_reservations to authenticated;
grant all on public.product_packs,public.pack_credit_accounts,public.pack_credit_reservations to service_role;

create function public.ensure_pack_account(owner uuid,initial_credits bigint,unit_micro_usd bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.pack_credit_accounts;begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));
 if initial_credits not between 0 and 1000000 or unit_micro_usd<=0 then raise exception 'pack_credit_required';end if;
 insert into public.pack_credit_accounts(user_id,balance_credits,unit_micro_usd) values(owner,initial_credits,unit_micro_usd) on conflict(user_id) do nothing;
 if found then insert into public.usage_events(user_id,operation,units,idempotency_key,credit_event,credit_delta,reserved_delta)
  values(owner,'processing',0,'credit:initial','grant',initial_credits,0);end if;
 select * into a from public.pack_credit_accounts where user_id=owner;
 if a.unit_micro_usd<>unit_micro_usd then raise exception 'credit_unit_changed';end if;
 return to_jsonb(a);
end;$$;
create function public.reserve_pack_credit(job uuid,stage_name text,attempt_no integer,amount bigint,unit bigint) returns void
language plpgsql security definer set search_path='' as $$
declare j public.processing_jobs;a public.pack_credit_accounts;begin
 if amount=0 then return;end if;
 select * into j from public.processing_jobs where id=job;
 if j.pack_id is null or amount<0 then raise exception 'pack_credit_required';end if;
 select * into a from public.pack_credit_accounts where user_id=j.user_id for update;
 if not found or a.unit_micro_usd<>unit then raise exception 'credit_unit_changed';end if;
 if exists(select 1 from public.pack_credit_reservations where job_id=job and stage=stage_name and attempt=attempt_no) then return;end if;
 if a.balance_credits-a.reserved_credits<amount then raise exception 'insufficient_credits';end if;
 insert into public.pack_credit_reservations(user_id,job_id,stage,attempt,reserved_credits,unit_micro_usd) values(j.user_id,job,stage_name,attempt_no,amount,unit);
 update public.pack_credit_accounts set reserved_credits=reserved_credits+amount where user_id=j.user_id;
 insert into public.usage_events(user_id,job_id,pack_id,operation,units,idempotency_key,credit_event,credit_delta,reserved_delta)
  values(j.user_id,j.id,j.pack_id,'processing',0,'credit:reserve:'||job||':'||stage_name||':'||attempt_no,'reserve',0,amount);
end;$$;
create function public.settle_pack_credit(job uuid,stage_name text,attempt_no integer,outcome text,cost_micro_usd bigint default null) returns void
language plpgsql security definer set search_path='' as $$
declare r public.pack_credit_reservations;j public.processing_jobs;debit bigint;begin
 select * into r from public.pack_credit_reservations where job_id=job and stage=stage_name and attempt=attempt_no for update;
 if not found or r.state<>'held' then return;end if;
 if outcome not in ('settled','released') or (outcome='settled' and (cost_micro_usd is null or cost_micro_usd<0)) then return;end if;
 select * into j from public.processing_jobs where id=job;
 debit:=case when outcome='released' then 0 else ceil(cost_micro_usd::numeric/r.unit_micro_usd)::bigint end;
 update public.pack_credit_reservations set state=outcome,actual_credits=debit,actual_micro_usd=case when outcome='released' then null else cost_micro_usd end where job_id=job and stage=stage_name and attempt=attempt_no;
 -- An actual overage is recorded honestly, including negative available balance;
 -- future reservations fail rather than silently making incurred usage free.
 update public.pack_credit_accounts set balance_credits=balance_credits-debit,reserved_credits=reserved_credits-r.reserved_credits where user_id=r.user_id;
 insert into public.usage_events(user_id,job_id,pack_id,operation,units,idempotency_key,credit_event,credit_delta,reserved_delta,cost_estimate_micro_usd)
  values(r.user_id,job,j.pack_id,'processing',0,'credit:final:'||job||':'||stage_name||':'||attempt_no,outcome,-debit,-r.reserved_credits,case when outcome='settled' then cost_micro_usd else null end);
end;$$;
create function public.reconcile_pack_job_credit() returns trigger language plpgsql security definer set search_path='' as $$
declare current_attempt integer:=case when old.status='queued' and new.status in ('cancelled','failed') then new.attempts+1 else greatest(new.attempts,1) end;begin
 if new.pack_id is null then return new;end if;
 if new.generation_cost_micro_usd is not null then perform public.settle_pack_credit(new.id,'generation',current_attempt,'settled',new.generation_cost_micro_usd);
 elsif new.status in ('failed','cancelled') and new.provider_started_at is null then perform public.settle_pack_credit(new.id,'generation',current_attempt,'released');end if;
 if new.quality_cost_micro_usd is not null then perform public.settle_pack_credit(new.id,'assessment',current_attempt,'settled',new.quality_cost_micro_usd);
 elsif new.status in ('failed','cancelled','uncertain') or (new.quality_state in ('completed','unavailable') and
   (new.quality_provider_started_at is null or new.quality_error_code in ('assessment_quota','assessment_credentials'))) then
  perform public.settle_pack_credit(new.id,'assessment',current_attempt,'released');end if;
 return new;
end;$$;
create trigger pack_credit_reconcile after update of status,generation_cost_micro_usd,quality_state,quality_cost_micro_usd on public.processing_jobs for each row execute function public.reconcile_pack_job_credit();

-- Preserve the existing queue and worker RPCs. Consistent lock order prevents
-- credit settlement from racing admissions or controlled retries.
alter function public.submit_processing_job(jsonb,jsonb) rename to submit_processing_job_v3;
create function public.submit_processing_job(p jsonb,limits jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.processing_jobs;parent public.processing_jobs;plan jsonb;begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));
 select * into j from public.processing_jobs where user_id=(p->>'user_id')::uuid and submission_key=(p->>'submission_key')::uuid;
 if found then
  if j.request_fingerprint is distinct from p->>'request_fingerprint' then raise exception 'submission_conflict';end if;return to_jsonb(j);end if;
 if p->>'quality_parent_id' is not null then
  select * into parent from public.processing_jobs where id=(p->>'quality_parent_id')::uuid and user_id=(p->>'user_id')::uuid;
  if parent.pack_id is not null then p:=p||jsonb_build_object('pack_id',parent.pack_id,'pack_output_type',parent.pack_output_type);end if;
 end if;
 if p->>'pack_id' is not null then
  if not exists(select 1 from public.product_packs where id=(p->>'pack_id')::uuid and user_id=(p->>'user_id')::uuid and input_image_id=(p->>'input_image_id')::uuid and project_id=(p->>'project_id')::uuid) then raise exception 'source_not_found';end if;
  if p->>'mode'<>'product' or p->'settings'->'pack_context'->>'type' is distinct from p->>'pack_output_type' then raise exception 'pack_credit_required';end if;
  plan:=p->'pack_credit_plan';if plan is null or coalesce((plan->>'generation_credits')::bigint,0)<=0 or coalesce((plan->>'assessment_credits')::bigint,-1)<0 or coalesce((plan->>'unit_micro_usd')::bigint,0)<=0 then raise exception 'pack_credit_required';end if;
  if (plan->>'generation_credits')::bigint*(plan->>'unit_micro_usd')::bigint<(p->>'reserved_micro_usd')::bigint-coalesce((p->>'quality_reserved_micro_usd')::bigint,0) or (plan->>'assessment_credits')::bigint*(plan->>'unit_micro_usd')::bigint<coalesce((p->>'quality_reserved_micro_usd')::bigint,0) then raise exception 'pack_credit_required';end if;
 end if;
 j:=jsonb_populate_record(null::public.processing_jobs,public.submit_processing_job_v3(p,limits));
 if p->>'pack_id' is not null then
  update public.processing_jobs set pack_id=(p->>'pack_id')::uuid,pack_output_type=p->>'pack_output_type',pack_credit_plan=plan,
   pack_estimated_credits=(plan->>'estimated_credits')::bigint,pack_reserved_credits=(plan->>'generation_credits')::bigint+(plan->>'assessment_credits')::bigint where id=j.id returning * into j;
  perform public.reserve_pack_credit(j.id,'generation',1,(plan->>'generation_credits')::bigint,(plan->>'unit_micro_usd')::bigint);
  perform public.reserve_pack_credit(j.id,'assessment',1,(plan->>'assessment_credits')::bigint,(plan->>'unit_micro_usd')::bigint);
 end if;
 return to_jsonb(j);
end;$$;
create function public.create_product_pack(p jsonb,jobs jsonb,limits jsonb,pack_limits jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare pack public.product_packs;i jsonb;j jsonb;owner uuid:=(p->>'user_id')::uuid;n integer;begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));
 select * into pack from public.product_packs where user_id=owner and submission_key=(p->>'submission_key')::uuid;
 if found then if pack.request_fingerprint is distinct from p->>'request_fingerprint' then raise exception 'submission_conflict';end if;return to_jsonb(pack);end if;
 n:=jsonb_array_length(jobs);if n not between 1 and least((pack_limits->>'max_outputs')::int,5) then raise exception 'pack_limit';end if;
 if (select count(*) from public.product_packs where user_id=owner and created_at>=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'))>=(pack_limits->>'daily')::int then raise exception 'pack_limit';end if;
 if (select count(distinct pack_id) from public.processing_jobs where user_id=owner and pack_id is not null and (status in ('queued','running','persisting') or quality_state in ('pending','running')))>=(pack_limits->>'active')::int then raise exception 'pack_limit';end if;
 if exists(select 1 from public.processing_jobs where user_id=owner and pack_id is null and status in ('queued','running','persisting')) then raise exception 'active_limit';end if;
 perform public.ensure_pack_account(owner,(pack_limits->>'initial_credits')::bigint,(pack_limits->>'unit_micro_usd')::bigint);
 insert into public.product_packs(user_id,project_id,input_image_id,submission_key,request_fingerprint,configuration,plan)
  values(owner,(p->>'project_id')::uuid,(p->>'input_image_id')::uuid,(p->>'submission_key')::uuid,p->>'request_fingerprint',p->'configuration',p->'plan') returning * into pack;
 for i in select * from jsonb_array_elements(jobs) loop
  j:=i||jsonb_build_object('user_id',owner,'project_id',pack.project_id,'input_image_id',pack.input_image_id,'pack_id',pack.id);
  perform public.submit_processing_job(j,jsonb_set(limits,'{user_active}',to_jsonb(n+(select count(*) from public.processing_jobs where user_id=owner and status in ('queued','running','persisting')))));
 end loop;
 return to_jsonb(pack);
end;$$;
alter function public.processing_step(uuid,uuid,text,jsonb) rename to processing_step_v3;
create function public.processing_step(job uuid,worker uuid,action text,p jsonb default '{}'::jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.processing_jobs;ok boolean;begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));
 select * into j from public.processing_jobs where id=job;
 if action='dispatch' and j.pack_id is not null and not exists(select 1 from public.pack_credit_reservations where job_id=job and stage='generation' and attempt=j.attempts and state='held') then raise exception 'pack_credit_required';end if;
 ok:=public.processing_step_v3(job,worker,action,p);
 if ok and action='dispatch' and j.pack_id is not null then update public.pack_credit_reservations set dispatched_at=coalesce(dispatched_at,now()) where job_id=job and stage='generation' and attempt=j.attempts;end if;
 return ok;
end;$$;
alter function public.product_assessment_step(uuid,uuid,text,jsonb) rename to product_assessment_step_v3;
create function public.product_assessment_step(job uuid,worker uuid,action text,p jsonb default '{}'::jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.processing_jobs;ok boolean;begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));
 select * into j from public.processing_jobs where id=job;
 if action='dispatch' and j.pack_id is not null and not exists(select 1 from public.pack_credit_reservations where job_id=job and stage='assessment' and attempt=j.attempts and state='held') then raise exception 'pack_credit_required';end if;
 ok:=public.product_assessment_step_v3(job,worker,action,p);
 if ok and action='dispatch' and j.pack_id is not null then update public.pack_credit_reservations set dispatched_at=coalesce(dispatched_at,now()) where job_id=job and stage='assessment' and attempt=j.attempts;end if;
 return ok;
end;$$;
alter function public.claim_processing_job(uuid,integer,integer) rename to claim_processing_job_v3;
create function public.claim_processing_job(worker uuid,lease_seconds integer,max_concurrent integer) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));return public.claim_processing_job_v3(worker,lease_seconds,max_concurrent);end;$$;
alter function public.claim_product_assessment(uuid) rename to claim_product_assessment_v3;
create function public.claim_product_assessment(worker uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));return public.claim_product_assessment_v3(worker);end;$$;
alter function public.cancel_processing_job(uuid,uuid) rename to cancel_processing_job_v3;
create function public.cancel_processing_job(job uuid,owner uuid) returns boolean language plpgsql security definer set search_path='' as $$begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));return public.cancel_processing_job_v3(job,owner);end;$$;
alter function public.retry_processing_job(uuid,uuid) rename to retry_processing_job_v3;
create function public.retry_processing_job(job uuid,owner uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.processing_jobs;ok boolean;begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));
 ok:=public.retry_processing_job_v3(job,owner);if not ok then return false;end if;
 select * into j from public.processing_jobs where id=job and user_id=owner;
 if j.pack_id is not null then
  perform public.reserve_pack_credit(j.id,'generation',j.attempts+1,(j.pack_credit_plan->>'generation_credits')::bigint,(j.pack_credit_plan->>'unit_micro_usd')::bigint);
  perform public.reserve_pack_credit(j.id,'assessment',j.attempts+1,(j.pack_credit_plan->>'assessment_credits')::bigint,(j.pack_credit_plan->>'unit_micro_usd')::bigint);
 end if;return true;
end;$$;
create function public.grant_pack_credits(owner uuid,amount bigint,request_key uuid,unit bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.usage_events;begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));
 if amount not between 1 and 1000000 then raise exception 'pack_credit_required';end if;
 perform public.ensure_pack_account(owner,0,unit);
 select * into old from public.usage_events where user_id=owner and idempotency_key='credit:grant:'||request_key;
 if found then if old.credit_delta<>amount then raise exception 'submission_conflict';end if;
 else
  update public.pack_credit_accounts set balance_credits=balance_credits+amount where user_id=owner;
  insert into public.usage_events(user_id,operation,units,idempotency_key,credit_event,credit_delta,reserved_delta) values(owner,'processing',0,'credit:grant:'||request_key,'grant',amount,0);
 end if;
 return (select to_jsonb(a) from public.pack_credit_accounts a where user_id=owner);
end;$$;
create function public.reconcile_pack_credit(job uuid,stage_name text,attempt_no integer,cost_micro_usd bigint) returns void language plpgsql security definer set search_path='' as $$
declare r public.pack_credit_reservations;j public.processing_jobs;begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));
 if cost_micro_usd<0 or cost_micro_usd is null then raise exception 'pack_credit_required';end if;
 select * into j from public.processing_jobs where id=job;
 if (stage_name='generation' and (j.provider_started_at is null or j.status not in ('completed','failed','uncertain'))) or (stage_name='assessment' and (j.quality_provider_started_at is null or j.quality_state not in ('completed','unavailable'))) then raise exception 'pack_credit_required';end if;
 select * into r from public.pack_credit_reservations where job_id=job and stage=stage_name and attempt=attempt_no;
 if not found or (r.state<>'held' and r.actual_micro_usd is distinct from cost_micro_usd) then raise exception 'credit_reconciliation_conflict';end if;
 perform public.settle_pack_credit(job,stage_name,attempt_no,'settled',cost_micro_usd);
 if stage_name='generation' then update public.processing_jobs set generation_cost_micro_usd=cost_micro_usd where id=job;else update public.processing_jobs set quality_cost_micro_usd=cost_micro_usd where id=job;end if;
 update public.processing_jobs set cost_estimate_micro_usd=case when generation_cost_micro_usd is null or (quality_model is not null and quality_cost_micro_usd is null) then null else generation_cost_micro_usd+coalesce(quality_cost_micro_usd,0) end where id=job;
 update public.usage_events set cost_estimate_micro_usd=cost_micro_usd,cost_basis='owner_reconciled_api_usage' where job_id=job and idempotency_key=(case when stage_name='generation' then 'processing:' else 'assessment:' end)||job;
end;$$;
create function public.product_packs_schema_version() returns integer language sql immutable set search_path='' as $$select 2026102803$$;
-- Private helpers and renamed implementations are not exposed to application roles.
do $$declare f record;begin
 for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('ensure_pack_account','reserve_pack_credit','settle_pack_credit','reconcile_pack_job_credit','submit_processing_job','submit_processing_job_v3','processing_step','processing_step_v3','product_assessment_step','product_assessment_step_v3','claim_processing_job','claim_processing_job_v3','claim_product_assessment','claim_product_assessment_v3','cancel_processing_job','cancel_processing_job_v3','retry_processing_job','retry_processing_job_v3','create_product_pack','grant_pack_credits','reconcile_pack_credit','product_packs_schema_version') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname not like '%_v3' and f.proname not in ('reserve_pack_credit','settle_pack_credit','reconcile_pack_job_credit') then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end;$$;

-- SOURCE: 202610280004_brand_studio.sql
-- SHA256: 8410ea50e3e0e4114acc876cd9f042d07ec211bc6e68863c9c68e35346f9e37f
create table public.brand_profiles(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(length(name) between 1 and 100),description text not null default '' check(length(description)<=500),
 settings jsonb not null check(jsonb_typeof(settings)='object'),revision integer not null default 1 check(revision>0),deleted boolean not null default false,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(id,user_id));
create table public.brand_presets(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,profile_id uuid not null,
 name text not null check(length(name) between 1 and 100),purpose text not null check(purpose in('listing','lifestyle','promotional','business')),
 settings jsonb not null check(jsonb_typeof(settings)='object'),revision integer not null default 1,deleted boolean not null default false,
 foreign key(profile_id,user_id) references public.brand_profiles(id,user_id) on delete cascade);
create table public.brand_assets(
 id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,name text not null check(length(name) between 1 and 100),
 kind text not null check(kind in('logo','reference')),status text not null check(status in('pending','ready','deleted','failed')),
 object_key text not null unique,checksum text not null check(checksum ~ '^[a-f0-9]{64}$'),byte_size integer not null check(byte_size between 1 and 2097152),
 width integer not null check(width between 1 and 1024),height integer not null check(height between 1 and 1024),created_at timestamptz not null default now());
create index brand_profiles_owner on public.brand_profiles(user_id,deleted);
create index brand_presets_owner on public.brand_presets(user_id,profile_id);
create index brand_assets_owner on public.brand_assets(user_id,status);
alter table public.brand_profiles enable row level security;alter table public.brand_presets enable row level security;alter table public.brand_assets enable row level security;
create policy brand_profiles_read on public.brand_profiles for select to authenticated using(user_id=(select auth.uid()) and not deleted);
create policy brand_presets_read on public.brand_presets for select to authenticated using(user_id=(select auth.uid()) and not deleted and exists(select 1 from public.brand_profiles b where b.id=profile_id and not b.deleted));
create policy brand_assets_read on public.brand_assets for select to authenticated using(user_id=(select auth.uid()) and status='ready');
revoke all on public.brand_profiles,public.brand_presets,public.brand_assets from public,anon,authenticated;
grant select on public.brand_profiles,public.brand_presets,public.brand_assets to authenticated;
grant all on public.brand_profiles,public.brand_presets,public.brand_assets to service_role;
create function public.mutate_brand(owner uuid,kind text,action text,target uuid,parent uuid,expected_revision integer,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.brand_profiles;pr public.brand_presets;copied public.brand_profiles;a public.brand_assets;begin
 perform pg_advisory_xact_lock(hashtextextended('brand:'||owner::text,0));
 if kind='profile' then
  if action='duplicate' then
   select * into b from public.brand_profiles where id=parent and user_id=owner and not deleted for update;
   if b.id is null then raise exception 'brand_not_found';end if;
   if b.revision is distinct from expected_revision then raise exception 'brand_conflict';end if;
   select * into copied from public.brand_profiles where id=target and user_id=owner and not deleted;
   if copied.id is not null then return to_jsonb(copied);end if;
   if(select count(*) from public.brand_profiles where user_id=owner and not deleted)>=20 then raise exception 'brand_limit';end if;
   insert into public.brand_profiles(id,user_id,name,description,settings) values(target,owner,left(b.name||' copy',100),b.description,b.settings) returning * into copied;
   insert into public.brand_presets(user_id,profile_id,name,purpose,settings) select owner,target,name,purpose,settings from public.brand_presets where profile_id=parent and user_id=owner and not deleted;
   return to_jsonb(copied);
  end if;
  select * into b from public.brand_profiles where id=target and user_id=owner and not deleted for update;
  if expected_revision is not null then
   if b.id is null then raise exception 'brand_not_found';end if;
   if b.revision<>expected_revision then raise exception 'brand_conflict';end if;
  elsif b.id is not null then
   if action='save' and b.name=payload->>'name' and b.description=coalesce(payload->>'description','') and b.settings=payload->'settings' then return to_jsonb(b);end if;
   raise exception 'brand_conflict';
  elsif action<>'save' then raise exception 'brand_not_found';end if;
  if action='delete' then
   update public.brand_profiles set deleted=true,revision=revision+1,updated_at=now() where id=target;
   update public.brand_presets set deleted=true,revision=revision+1 where profile_id=target and not deleted;return '{}'::jsonb;
  elsif action='save' then
   if b.id is null then
    if(select count(*) from public.brand_profiles where user_id=owner and not deleted)>=20 then raise exception 'brand_limit';end if;
    insert into public.brand_profiles(id,user_id,name,description,settings) values(target,owner,payload->>'name',coalesce(payload->>'description',''),payload->'settings') returning * into b;
   else update public.brand_profiles set name=payload->>'name',description=coalesce(payload->>'description',''),settings=payload->'settings',revision=revision+1,updated_at=now() where id=target returning * into b;end if;
   return to_jsonb(b);
  end if;
 elsif kind='preset' then
  select * into b from public.brand_profiles where id=parent and user_id=owner and not deleted for update;
  if b.id is null then raise exception 'brand_not_found';end if;
  select * into pr from public.brand_presets where id=target and profile_id=parent and user_id=owner and not deleted for update;
  if expected_revision is not null then
   if pr.id is null then raise exception 'brand_not_found';end if;
   if pr.revision<>expected_revision then raise exception 'brand_conflict';end if;
  elsif pr.id is not null then
   if action='save' and pr.name=payload->>'name' and pr.purpose=payload->>'purpose' and pr.settings=payload->'settings' then return to_jsonb(pr);end if;raise exception 'brand_conflict';
  elsif action<>'save' then raise exception 'brand_not_found';end if;
  if action='delete' then update public.brand_presets set deleted=true,revision=revision+1 where id=target;return '{}'::jsonb;
  elsif action='save' then
   if pr.id is null then
    if(select count(*) from public.brand_presets where profile_id=parent and not deleted)>=20 then raise exception 'brand_limit';end if;
    insert into public.brand_presets(id,user_id,profile_id,name,purpose,settings) values(target,owner,parent,payload->>'name',payload->>'purpose',payload->'settings') returning * into pr;
   else update public.brand_presets set name=payload->>'name',purpose=payload->>'purpose',settings=payload->'settings',revision=revision+1 where id=target returning * into pr;end if;return to_jsonb(pr);
  end if;
 end if;raise exception 'brand_conflict';end$$;
create function public.reserve_brand_asset(owner uuid,target uuid,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.brand_assets;begin
 perform pg_advisory_xact_lock(hashtextextended('brand:'||owner::text,0));
 select * into a from public.brand_assets where id=target and user_id=owner;
 if a.id is not null then
  if a.checksum<>p->>'checksum' or a.kind<>p->>'kind' then raise exception 'brand_conflict';end if;return to_jsonb(a);
 end if;
 if(select count(*) from public.brand_assets where user_id=owner and status<>'failed')>=50 or
 (select coalesce(sum(byte_size),0) from public.brand_assets where user_id=owner and status<>'failed')+(p->>'byte_size')::bigint>26214400 then raise exception 'brand_limit';end if;
 insert into public.brand_assets(id,user_id,name,kind,status,object_key,checksum,byte_size,width,height)
 values(target,owner,p->>'name',p->>'kind','pending',owner::text||'/brand-'||target::text||'.webp',p->>'checksum',(p->>'byte_size')::integer,(p->>'width')::integer,(p->>'height')::integer) returning * into a;
 return to_jsonb(a);end$$;
-- The photos bucket remains private/WebP-only. Its existing object policy only
-- permits image records, so assets are streamed through owner-checked backend routes.
create function public.brand_schema_version() returns integer language sql immutable set search_path='' as $$select 2026102804$$;
revoke all on function public.mutate_brand(uuid,text,text,uuid,uuid,integer,jsonb),public.reserve_brand_asset(uuid,uuid,jsonb),public.brand_schema_version() from public,anon,authenticated;
grant execute on function public.mutate_brand(uuid,text,text,uuid,uuid,integer,jsonb),public.reserve_brand_asset(uuid,uuid,jsonb),public.brand_schema_version() to service_role;
notify pgrst,'reload schema';

-- SOURCE: 202610280005_batches.sql
-- SHA256: 606601cc2ec79d9fce691df1f143be5d5d7286fc763bc5a328ddafacda0bc72f
create table public.processing_batches(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,project_id uuid,name text not null check(length(name) between 1 and 100),submission_key uuid not null,request_fingerprint text not null,configuration jsonb not null,plan jsonb not null,cancel_requested boolean not null default false,created_at timestamptz not null default now(),unique(id,user_id),unique(user_id,submission_key),foreign key(project_id,user_id) references public.projects(id,user_id) on delete set null(project_id));
create table public.batch_items(batch_id uuid not null,user_id uuid not null,pack_id uuid not null,input_image_id uuid,position integer not null,primary key(batch_id,position),unique(pack_id),foreign key(batch_id,user_id) references public.processing_batches(id,user_id) on delete cascade,foreign key(pack_id,user_id) references public.product_packs(id,user_id),foreign key(input_image_id,user_id) references public.images(id,user_id) on delete set null(input_image_id));
create index batches_history on public.processing_batches(user_id,created_at desc);
alter table public.processing_batches enable row level security;alter table public.batch_items enable row level security;
create policy batch_read on public.processing_batches for select to authenticated using(user_id=(select auth.uid()));create policy batch_item_read on public.batch_items for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.processing_batches,public.batch_items from public,anon,authenticated;grant select on public.processing_batches,public.batch_items to authenticated;grant all on public.processing_batches,public.batch_items to service_role;
create function public.create_processing_batch(p jsonb,items jsonb,limits jsonb,pack_limits jsonb,batch_limits jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.processing_batches;owner uuid:=(p->>'user_id')::uuid;i jsonb;pack jsonb;n integer;pos integer:=0;existing integer;begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));
 select * into b from public.processing_batches where user_id=owner and submission_key=(p->>'submission_key')::uuid;
 if found then if b.request_fingerprint is distinct from p->>'request_fingerprint' then raise exception 'submission_conflict';end if;return to_jsonb(b);end if;
 n:=jsonb_array_length(items);if n not between 1 and least(100,(batch_limits->>'max_images')::integer) then raise exception 'batch_limit';end if;
 if exists(select 1 from public.processing_jobs where user_id=owner and(status in('queued','running','persisting') or quality_state in('pending','running'))) then raise exception 'active_limit';end if;
 if(select count(*) from public.processing_batches where user_id=owner and created_at>=date_trunc('day',now())) >= (batch_limits->>'daily')::integer then raise exception 'batch_limit';end if;
 if(select coalesce(sum(byte_size),0) from public.images where user_id=owner and id in(select (value->>'input_image_id')::uuid from jsonb_array_elements(items)))>(batch_limits->>'max_bytes')::bigint then raise exception 'batch_limit';end if;
 select count(*) into existing from public.product_packs where user_id=owner and created_at>=date_trunc('day',now());
 insert into public.processing_batches(user_id,project_id,name,submission_key,request_fingerprint,configuration,plan)values(owner,(p->>'project_id')::uuid,p->>'name',(p->>'submission_key')::uuid,p->>'request_fingerprint',p->'configuration',p->'plan') returning * into b;
 for i in select * from jsonb_array_elements(items) loop
 pack:=public.create_product_pack(jsonb_build_object('user_id',owner,'project_id',b.project_id,'input_image_id',i->>'input_image_id','submission_key',gen_random_uuid(),'request_fingerprint',p->>'request_fingerprint','configuration',i->'configuration','plan',p->'plan'),i->'jobs',limits,pack_limits||jsonb_build_object('daily',existing+n,'active',n));
 insert into public.batch_items values(b.id,owner,(pack->>'id')::uuid,(i->>'input_image_id')::uuid,pos);pos:=pos+1;
 end loop;return to_jsonb(b);end$$;
create function public.cancel_processing_batch(target uuid,owner uuid) returns boolean language plpgsql security definer set search_path='' as $$declare j record;begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));
 perform 1 from public.processing_batches where id=target and user_id=owner for update;if not found then return false;end if;
 update public.processing_batches set cancel_requested=true where id=target;
 for j in select p.id from public.processing_jobs p join public.batch_items i on i.pack_id=p.pack_id where i.batch_id=target and i.user_id=owner and p.status='queued' loop perform public.cancel_processing_job(j.id,owner);end loop;return true;end$$;
create function public.batch_schema_version()returns integer language sql immutable set search_path='' as $$select 2026102805$$;
revoke all on function public.create_processing_batch(jsonb,jsonb,jsonb,jsonb,jsonb),public.cancel_processing_batch(uuid,uuid),public.batch_schema_version() from public,anon,authenticated;
grant execute on function public.create_processing_batch(jsonb,jsonb,jsonb,jsonb,jsonb),public.cancel_processing_batch(uuid,uuid),public.batch_schema_version() to service_role;
notify pgrst,'reload schema';

-- SOURCE: 202610280006_library.sql
-- SHA256: a9e5f4338684e076d6728b1cbf446a97edea039f4c0776af857dde2b2cf9f952
alter table public.projects add column archived boolean not null default false;
alter table public.images add column library_project_id uuid,add column trashed_at timestamptz,add foreign key(library_project_id,user_id) references public.projects(id,user_id) on delete set null(library_project_id);
update public.images set library_project_id=project_id;
alter table public.processing_jobs add column library_project_id uuid,add foreign key(library_project_id,user_id) references public.projects(id,user_id) on delete set null(library_project_id);
update public.processing_jobs set library_project_id=project_id;
create index library_page on public.images(user_id,trashed_at,created_at desc,id);
create index library_source_history on public.processing_jobs(user_id,input_image_id,created_at desc);
create index library_output_history on public.processing_jobs(user_id,output_image_id,created_at desc) where output_image_id is not null;
create index library_folder on public.images(user_id,library_project_id,created_at desc);
alter policy image_read on public.images using(user_id=(select auth.uid()) and trashed_at is null);
create function public.library_image_defaults()returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.role='generated' then select library_project_id into new.library_project_id from public.processing_jobs where result_image_id=new.id and user_id=new.user_id;else new.library_project_id:=new.project_id;end if;return new;end$$;
create trigger library_image_folder before insert on public.images for each row execute function public.library_image_defaults();
create function public.library_job_defaults()returns trigger language plpgsql security definer set search_path='' as $$declare source public.images;begin
 if new.input_image_id is not null then select * into source from public.images where id=new.input_image_id and user_id=new.user_id;if source.trashed_at is not null then raise exception 'source_not_found';end if;new.library_project_id:=source.library_project_id;end if;return new;end$$;
create trigger library_job_folder before insert on public.processing_jobs for each row execute function public.library_job_defaults();
create function public.library_query(owner uuid,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$declare results jsonb;begin
 select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) into results from(
 select i.id,i.filename,i.role,i.width,i.height,i.byte_size,i.media_type,i.created_at,i.trashed_at,i.library_project_id,i.project_id,pr.name as project_name,pr.archived,
 case when i.trashed_at is not null then 'trashed' else i.status end as image_status,
 j.id as job_id,j.mode,j.status as processing_status,j.quality_state,j.user_decision,j.quality_report->>'status' as quality_status,j.pack_id,
 (select bi.batch_id from public.batch_items bi where bi.pack_id=j.pack_id and bi.user_id=owner limit 1) as batch_id
 from public.images i left join public.projects pr on pr.id=i.library_project_id and pr.user_id=owner
 left join lateral(select * from public.processing_jobs x where x.user_id=owner and (x.output_image_id=i.id or x.input_image_id=i.id) order by coalesce((x.output_image_id=i.id),false) desc,x.created_at desc,x.id desc limit 1)j on true
 where i.user_id=owner and i.status='ready' and ((coalesce((p->>'trash')::boolean,false) and i.trashed_at is not null) or (not coalesce((p->>'trash')::boolean,false) and i.trashed_at is null))
 and (coalesce((p->>'trash')::boolean,false) or coalesce((p->>'archived')::boolean,false) or not coalesce(pr.archived,false))
 and (p->>'project_id' is null or i.library_project_id=(p->>'project_id')::uuid)
 and (not coalesce((p->>'unassigned')::boolean,false) or i.library_project_id is null)
 and (coalesce(p->>'search','')='' or position(lower(p->>'search') in lower(i.filename||' '||coalesce(pr.name,'')))>0)
 and (p->>'role' is null or i.role=p->>'role') and(p->>'mode' is null or j.mode=p->>'mode')
 and(p->>'status' is null or coalesce(j.status,'ready')=p->>'status') and(p->>'review' is null or j.user_decision=p->>'review')
 and(p->>'after' is null or i.created_at>=(p->>'after')::timestamptz) and(p->>'before' is null or i.created_at<=(p->>'before')::timestamptz)
 order by case when p->>'sort'='name' then lower(i.filename) end asc,case when p->>'sort'='oldest' then i.created_at end asc,i.created_at desc,i.id desc
 limit 24 offset least(100000,greatest(0,coalesce((p->>'offset')::integer,0)))
 )t;return jsonb_build_object('images',results,'next_offset',case when jsonb_array_length(results)=24 then coalesce((p->>'offset')::integer,0)+24 else null end);end$$;
create function public.library_action(owner uuid,ids uuid[],action text,value text default null) returns integer language plpgsql security definer set search_path='' as $$declare n integer;begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));
 if cardinality(ids) not between 1 and 100 or cardinality(ids)<>(select count(distinct unnest) from unnest(ids)) then raise exception 'library_invalid';end if;
 select count(*) into n from public.images where user_id=owner and id=any(ids) and status='ready';if n<>cardinality(ids) then raise exception 'library_not_found';end if;
 if action='trash' then
 if exists(select 1 from public.processing_jobs where user_id=owner and(input_image_id=any(ids) or output_image_id=any(ids))and(status in('queued','running','persisting')or quality_state in('pending','running')))then raise exception 'processing_image_busy';end if;
 update public.images set trashed_at=coalesce(trashed_at,now()) where user_id=owner and id=any(ids);
 elsif action='restore' then
 if exists(select 1 from public.images where user_id=owner and id=any(ids) and trashed_at<now()-interval '30 days')then raise exception 'library_expired';end if;
 update public.images set trashed_at=null where user_id=owner and id=any(ids);
 elsif action='rename' then if cardinality(ids)<>1 or length(trim(value)) not between 1 and 150 then raise exception 'library_invalid';end if;update public.images set filename=trim(value) where user_id=owner and id=any(ids);
 elsif action='move' then
 if value is not null and not exists(select 1 from public.projects where id=value::uuid and user_id=owner and not archived) then raise exception 'library_not_found';end if;
 update public.images set library_project_id=value::uuid where user_id=owner and id=any(ids);
 else raise exception 'library_invalid';end if;return n;end$$;
create function public.library_project_action(owner uuid,target uuid,action text,value text default null) returns boolean language plpgsql security definer set search_path='' as $$begin
 perform 1 from public.projects where id=target and user_id=owner for update;if not found then return false;end if;
 if action='rename' then if length(trim(value)) not between 1 and 100 then raise exception 'library_invalid';end if;update public.projects set name=trim(value) where id=target;
 elsif action in('archive','restore')then update public.projects set archived=action='archive' where id=target;
 elsif action='delete' then if exists(select 1 from public.images where user_id=owner and(library_project_id=target or project_id=target)) then raise exception 'project_not_empty';end if;delete from public.projects where id=target;
 else raise exception 'library_invalid';end if;return true;end$$;
create function public.expire_library_trash()returns integer language plpgsql security definer set search_path='' as $$declare n integer;begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));
 update public.images i set status='deleting' where i.status='ready' and trashed_at<now()-interval '30 days' and not exists(select 1 from public.processing_jobs j where j.user_id=i.user_id and(j.input_image_id=i.id or j.output_image_id=i.id)and(j.status in('queued','running','persisting')or j.quality_state in('pending','running')));get diagnostics n=row_count;return n;end$$;
create function public.library_schema_version()returns integer language sql immutable set search_path='' as $$select 2026102806$$;
revoke all on function public.library_query(uuid,jsonb),public.library_action(uuid,uuid[],text,text),public.library_project_action(uuid,uuid,text,text),public.expire_library_trash(),public.library_schema_version(),public.library_image_defaults(),public.library_job_defaults() from public,anon,authenticated;
grant execute on function public.library_query(uuid,jsonb),public.library_action(uuid,uuid[],text,text),public.library_project_action(uuid,uuid,text,text),public.expire_library_trash(),public.library_schema_version() to service_role;
notify pgrst,'reload schema';

-- SOURCE: 202610280007_commerce.sql
-- SHA256: 7f6588efb02f0b5d4771f516ce15bee413dd9794a899db6d3c0c9ede91fcf60e
create table public.billing_settings(id boolean primary key default true check(id),enabled boolean not null default false,free_daily_grants integer not null default 10 check(free_daily_grants between 0 and 100));insert into public.billing_settings(id)values(true);
create table public.billing_offers(id text primary key,plan text not null,kind text not null,interval text not null,cents integer not null,units integer not null);
insert into public.billing_offers values('free','free','free','once',0,20),('starter_monthly','starter','subscription','month',900,100),('starter_annual','starter','subscription','year',9000,1200),('pro_monthly','pro','subscription','month',1900,250),('pro_annual','pro','subscription','year',19000,3000),('small_pack','payg','one_time','once',500,50),('studio_pack','payg','one_time','once',1500,200);
create table public.billing_accounts(user_id uuid primary key references public.profiles(id) on delete cascade,free_granted boolean not null default false,has_paid boolean not null default false,created_at timestamptz not null default now());
create table public.billing_checkouts(id uuid primary key default gen_random_uuid(),token_hash text not null unique,email_hash text,user_id uuid references public.profiles(id),offer_id text not null references public.billing_offers(id),status text not null default 'selected' check(status in('selected','creating','pending','active','paid','cancelled','failed','refunded')),provider_id text unique,approval_url text,amount_cents integer not null,units integer not null,created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '1 day');
create table public.billing_subscriptions(provider_id text primary key,checkout_id uuid not null references public.billing_checkouts(id),user_id uuid not null references public.profiles(id),plan text not null,state text not null,paid_until timestamptz not null);
create table public.billing_receipts(payment_id text primary key,checkout_id uuid not null references public.billing_checkouts(id),user_id uuid not null references public.profiles(id),amount_cents integer not null,units integer not null,refunded_cents integer not null default 0 check(refunded_cents>=0),created_at timestamptz not null default now());
create table public.billing_events(id text primary key,payload_hash text not null,kind text not null,created_at timestamptz not null default now());
create table public.billing_refunds(id text primary key,payment_id text not null references public.billing_receipts(payment_id),amount_cents integer not null,units integer not null);
create index billing_owner_checkout on public.billing_checkouts(user_id,created_at desc);create index billing_email_pending on public.billing_checkouts(email_hash,expires_at);create index billing_owner_subscription on public.billing_subscriptions(user_id,paid_until);
alter table public.billing_accounts enable row level security;alter table public.billing_checkouts enable row level security;alter table public.billing_subscriptions enable row level security;alter table public.billing_receipts enable row level security;alter table public.billing_events enable row level security;alter table public.billing_refunds enable row level security;alter table public.billing_settings enable row level security;alter table public.billing_offers enable row level security;
create policy billing_account_read on public.billing_accounts for select to authenticated using(user_id=(select auth.uid()));create policy billing_checkout_read on public.billing_checkouts for select to authenticated using(user_id=(select auth.uid()));create policy billing_subscription_read on public.billing_subscriptions for select to authenticated using(user_id=(select auth.uid()));create policy billing_receipt_read on public.billing_receipts for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.billing_accounts,public.billing_checkouts,public.billing_subscriptions,public.billing_receipts,public.billing_events,public.billing_refunds,public.billing_settings,public.billing_offers from public,anon,authenticated;
grant select on public.billing_accounts,public.billing_checkouts,public.billing_subscriptions,public.billing_receipts to authenticated;grant all on public.billing_accounts,public.billing_checkouts,public.billing_subscriptions,public.billing_receipts,public.billing_events,public.billing_refunds,public.billing_settings,public.billing_offers to service_role;
alter table public.processing_jobs add column billing_metered boolean not null default false,add column free_sample boolean not null default false;
create function public.billing_tier(owner uuid)returns text language sql stable security definer set search_path='' as $$select coalesce((select plan from public.billing_subscriptions where user_id=owner and paid_until>now() and state<>'refunded' order by case plan when 'pro' then 2 else 1 end desc,paid_until desc limit 1),(select case when has_paid then 'payg' else 'free' end from public.billing_accounts where user_id=owner),'free')$$;
create function public.ensure_billing_account(owner uuid)returns jsonb language plpgsql security definer set search_path='' as $$declare a public.billing_accounts;begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));
 if not(select enabled from public.billing_settings where id) then raise exception 'billing_not_ready';end if;
 if not exists(select 1 from auth.users where id=owner and email_confirmed_at is not null)then raise exception 'billing_unverified';end if;
 insert into public.billing_accounts(user_id)values(owner)on conflict do nothing;perform public.ensure_pack_account(owner,0,10000);
 select * into a from public.billing_accounts where user_id=owner for update;
 if not a.free_granted and not a.has_paid and(select count(*) from public.usage_events where credit_event='grant' and idempotency_key like 'billing:free:%' and created_at>=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'))<(select free_daily_grants from public.billing_settings where id)then
 update public.pack_credit_accounts set balance_credits=balance_credits+20 where user_id=owner;
 insert into public.usage_events(user_id,operation,units,idempotency_key,credit_event,credit_delta,reserved_delta)values(owner,'processing',0,'billing:free:'||owner,'grant',20,0);
 update public.billing_accounts set free_granted=true where user_id=owner;end if;
 return jsonb_build_object('plan',public.billing_tier(owner),'account',(select to_jsonb(x) from public.pack_credit_accounts x where user_id=owner),'free_granted',(select free_granted from public.billing_accounts where user_id=owner));end$$;
create function public.bind_billing_checkout(token text,owner uuid,email_fingerprint text)returns jsonb language plpgsql security definer set search_path='' as $$declare c public.billing_checkouts;begin
 select * into c from public.billing_checkouts where token_hash=token and expires_at>now() for update;
 if c.id is null then select * into c from public.billing_checkouts where email_hash=email_fingerprint and user_id is null and expires_at>now() order by created_at desc limit 1 for update;end if;
 if c.id is null then return null;end if;
 if c.user_id is not null and c.user_id<>owner then raise exception 'billing_owner';end if;
 if c.email_hash is not null and c.email_hash<>email_fingerprint then raise exception 'billing_owner';end if;
 update public.billing_checkouts set user_id=owner where id=c.id returning * into c;return to_jsonb(c);end$$;
create function public.begin_billing_checkout(target uuid,owner uuid)returns jsonb language plpgsql security definer set search_path='' as $$declare c public.billing_checkouts;o public.billing_offers;begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));perform public.ensure_billing_account(owner);
 select * into c from public.billing_checkouts where id=target and user_id=owner and expires_at>now() for update;if c.id is null then raise exception 'billing_owner';end if;
 select * into o from public.billing_offers where id=c.offer_id;
 if o.kind='subscription' and (exists(select 1 from public.billing_subscriptions where user_id=owner and paid_until>now()) or exists(select 1 from public.billing_checkouts where user_id=owner and id<>target and offer_id in(select id from public.billing_offers where kind='subscription')and status in('creating','pending','active')))then raise exception 'billing_subscription_exists';end if;
 if c.status in('selected','creating')then update public.billing_checkouts set status='creating' where id=target returning * into c;end if;return to_jsonb(c);end$$;
create function public.apply_billing_event(event_id text,event_hash text,kind text,p jsonb)returns boolean language plpgsql security definer set search_path='' as $$declare c public.billing_checkouts;o public.billing_offers;receipt public.billing_receipts;debit bigint;n integer;fresh boolean:=false;begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));
 if exists(select 1 from public.billing_events where id=event_id)then if not exists(select 1 from public.billing_events where id=event_id and payload_hash=event_hash)then raise exception 'billing_event_conflict';end if;return false;end if;
 select * into c from public.billing_checkouts where id=(p->>'checkout_id')::uuid for update;if c.id is null or c.user_id is null then raise exception 'billing_owner';end if;
 select * into o from public.billing_offers where id=c.offer_id;
 if kind='paid' then
 if c.amount_cents is distinct from (p->>'amount_cents')::integer or c.provider_id is distinct from p->>'provider_id' then raise exception 'billing_amount';end if;
 if exists(select 1 from public.billing_receipts where payment_id=p->>'payment_id' and checkout_id<>c.id)then raise exception 'billing_event_conflict';end if;
 if not exists(select 1 from public.billing_receipts where payment_id=p->>'payment_id')then
 perform public.ensure_pack_account(c.user_id,0,10000);
 fresh:=true;
 insert into public.billing_receipts(payment_id,checkout_id,user_id,amount_cents,units)values(p->>'payment_id',c.id,c.user_id,c.amount_cents,c.units);
 update public.pack_credit_accounts set balance_credits=balance_credits+c.units where user_id=c.user_id;
 insert into public.usage_events(user_id,operation,units,idempotency_key,credit_event,credit_delta,reserved_delta)values(c.user_id,'processing',0,'billing:paid:'||(p->>'payment_id'),'purchase',c.units,0);
 insert into public.billing_accounts(user_id,has_paid)values(c.user_id,true)on conflict(user_id)do update set has_paid=true;
 end if;
 if fresh then
 update public.billing_checkouts set status=case when o.kind='subscription' then 'active' else 'paid' end where id=c.id;
 if o.kind='subscription' then
 if (p->>'paid_until')::timestamptz>now()+interval '370 days' or (p->>'paid_until')::timestamptz<=now()-interval '2 years' then raise exception 'billing_period';end if;
 insert into public.billing_subscriptions(provider_id,checkout_id,user_id,plan,state,paid_until)values(c.provider_id,c.id,c.user_id,o.plan,'active',(p->>'paid_until')::timestamptz)on conflict(provider_id)do update set paid_until=greatest(public.billing_subscriptions.paid_until,excluded.paid_until),state='active';end if;end if;
 elsif kind='refund' then
 select * into receipt from public.billing_receipts where payment_id=p->>'payment_id' and checkout_id=c.id for update;if receipt.payment_id is null then raise exception 'billing_receipt_missing';end if;
 if not exists(select 1 from public.billing_refunds where id=p->>'refund_id') then
 n:=(p->>'amount_cents')::integer;if n<=0 or receipt.refunded_cents+n>receipt.amount_cents then raise exception 'billing_amount';end if;
 debit:=ceil((receipt.refunded_cents+n)::numeric*receipt.units/receipt.amount_cents)-ceil(receipt.refunded_cents::numeric*receipt.units/receipt.amount_cents);
 insert into public.billing_refunds values(p->>'refund_id',receipt.payment_id,n,debit);
 update public.billing_receipts set refunded_cents=refunded_cents+n where payment_id=receipt.payment_id;
 update public.billing_accounts set has_paid=exists(select 1 from public.billing_receipts where user_id=c.user_id and refunded_cents<amount_cents)where user_id=c.user_id;
 update public.pack_credit_accounts set balance_credits=balance_credits-debit where user_id=c.user_id;
 insert into public.usage_events(user_id,operation,units,idempotency_key,credit_event,credit_delta,reserved_delta)values(c.user_id,'processing',0,'billing:refund:'||(p->>'refund_id'),'refund',-debit,0);
 if receipt.refunded_cents+n=receipt.amount_cents and not exists(select 1 from public.billing_receipts r where r.checkout_id=c.id and r.refunded_cents<r.amount_cents) then update public.billing_checkouts set status='refunded' where id=c.id;update public.billing_subscriptions set state='refunded' where checkout_id=c.id and not exists(select 1 from public.billing_receipts r where r.checkout_id=c.id and r.refunded_cents<r.amount_cents);end if;end if;
 elsif kind in('cancelled','suspended','failed') then
 update public.billing_subscriptions set state=kind where checkout_id=c.id;update public.billing_checkouts set status=case when kind='suspended' then status else kind end where id=c.id;
 else raise exception 'billing_event_invalid';end if;
 insert into public.billing_events(id,payload_hash,kind)values(event_id,event_hash,kind);return true;end$$;
create function public.billing_admission()returns trigger language plpgsql security definer set search_path='' as $$declare tier text;begin
 if not(select enabled from public.billing_settings where id)then return new;end if;
 tier:=public.billing_tier(new.user_id);
 if tg_table_name='processing_jobs' then
 if tier='free' then
 if new.quality<>'low' or new.output_size<>'1024x1024' or new.settings->'brand_snapshot' is not null or new.settings->'pack_context' is not null then raise exception 'billing_entitlement';end if;
 if exists(select 1 from public.processing_jobs where user_id=new.user_id and free_sample and status<>'cancelled' and not(status='failed' and safe_to_retry)) then raise exception 'billing_sample_used';end if;
 elsif tier in('starter','payg')and new.quality='high' then raise exception 'billing_entitlement';end if;
 if new.settings->'brand_snapshot' is not null and tier not in('starter','pro') then raise exception 'billing_entitlement';end if;
 elsif tg_table_name='product_packs' and tier='free' then raise exception 'billing_entitlement';
 elsif tg_table_name='brand_profiles' and tier not in('starter','pro')then raise exception 'billing_entitlement';
 elsif tg_table_name='processing_batches' then if jsonb_array_length(new.configuration->'image_ids')>(case tier when 'pro' then 5 when 'starter' then 3 else 0 end) then raise exception 'billing_entitlement';end if;end if;
 return new;end$$;
create trigger billing_job_policy before insert on public.processing_jobs for each row execute function public.billing_admission();
create trigger billing_pack_policy before insert on public.product_packs for each row execute function public.billing_admission();
create trigger billing_brand_policy before insert on public.brand_profiles for each row execute function public.billing_admission();
create trigger billing_batch_policy before insert on public.processing_batches for each row execute function public.billing_admission();
create function public.billing_resource_quota()returns trigger language plpgsql security definer set search_path='' as $$declare n bigint;bytes bigint;held bigint;begin
 if not(select enabled from public.billing_settings where id)or public.billing_tier(new.user_id)<>'free' then return new;end if;
 perform 1 from public.profiles where id=new.user_id for update;
 if tg_table_name='projects' then if(select count(*) from public.projects where user_id=new.user_id)>=3 then raise exception 'billing_storage_limit';end if;
 else
 select count(*),coalesce(sum(byte_size),0) into n,bytes from public.images where user_id=new.user_id;
 select count(*) into held from public.processing_jobs j where j.user_id=new.user_id and j.mode is not null and j.status in('queued','running','persisting')and j.result_image_id<>new.id and not exists(select 1 from public.images i where i.id=j.result_image_id);
 if n+held>=10 or bytes+held*10485760+new.byte_size>26214400 then raise exception 'billing_storage_limit';end if;
 end if;return new;end$$;
create trigger billing_project_quota before insert on public.projects for each row execute function public.billing_resource_quota();
create trigger billing_photo_quota before insert on public.images for each row execute function public.billing_resource_quota();
alter function public.submit_processing_job(jsonb,jsonb)rename to submit_processing_job_v4;
create function public.submit_processing_job(p jsonb,limits jsonb)returns jsonb language plpgsql security definer set search_path='' as $$declare j public.processing_jobs;owner uuid:=(p->>'user_id')::uuid;plan jsonb:=p->'pack_credit_plan';begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));
 if not(select enabled from public.billing_settings where id)then return public.submit_processing_job_v4(p,limits);end if;
 select * into j from public.processing_jobs where user_id=owner and submission_key=(p->>'submission_key')::uuid;
 if found then if j.request_fingerprint is distinct from p->>'request_fingerprint' then raise exception 'submission_conflict';end if;return to_jsonb(j);end if;
 perform public.ensure_billing_account(owner);
 if plan is null or (plan->>'unit_micro_usd')::bigint<>10000 or coalesce((plan->>'generation_credits')::bigint,0)<1 or (plan->>'generation_credits')::bigint*10000<(p->>'reserved_micro_usd')::bigint-coalesce((p->>'quality_reserved_micro_usd')::bigint,0) or coalesce((plan->>'assessment_credits')::bigint,0)*10000<coalesce((p->>'quality_reserved_micro_usd')::bigint,0)then raise exception 'pack_credit_required';end if;
 if public.billing_tier(owner)='free' and (p->>'quality_model' is not null or (plan->>'generation_credits')::bigint>20)then raise exception 'billing_entitlement';end if;
 j:=jsonb_populate_record(null::public.processing_jobs,public.submit_processing_job_v4(p,limits));
 update public.processing_jobs set billing_metered=true,free_sample=public.billing_tier(owner)='free',pack_credit_plan=plan where id=j.id returning * into j;
 if j.pack_id is null then perform public.reserve_pack_credit(j.id,'generation',1,(plan->>'generation_credits')::bigint,10000);perform public.reserve_pack_credit(j.id,'assessment',1,coalesce((plan->>'assessment_credits')::bigint,0),10000);end if;return to_jsonb(j);end$$;

create or replace function public.reserve_pack_credit(job uuid,stage_name text,attempt_no integer,amount bigint,unit bigint) returns void
language plpgsql security definer set search_path='' as $$
declare j public.processing_jobs;a public.pack_credit_accounts;begin
 if amount=0 then return;end if;
 select * into j from public.processing_jobs where id=job;
 if (j.pack_id is null and not j.billing_metered) or amount<0 then raise exception 'pack_credit_required';end if;
 select * into a from public.pack_credit_accounts where user_id=j.user_id for update;
 if not found or a.unit_micro_usd<>unit then raise exception 'credit_unit_changed';end if;
 if exists(select 1 from public.pack_credit_reservations where job_id=job and stage=stage_name and attempt=attempt_no) then return;end if;
 if a.balance_credits-a.reserved_credits<amount then raise exception 'insufficient_credits';end if;
 insert into public.pack_credit_reservations(user_id,job_id,stage,attempt,reserved_credits,unit_micro_usd) values(j.user_id,job,stage_name,attempt_no,amount,unit);
 update public.pack_credit_accounts set reserved_credits=reserved_credits+amount where user_id=j.user_id;
 insert into public.usage_events(user_id,job_id,pack_id,operation,units,idempotency_key,credit_event,credit_delta,reserved_delta)
  values(j.user_id,j.id,j.pack_id,'processing',0,'credit:reserve:'||job||':'||stage_name||':'||attempt_no,'reserve',0,amount);
end;$$;

create or replace function public.reconcile_pack_job_credit() returns trigger language plpgsql security definer set search_path='' as $$
declare current_attempt integer:=case when old.status='queued' and new.status in ('cancelled','failed') then new.attempts+1 else greatest(new.attempts,1) end;begin
 if new.pack_id is null and not new.billing_metered then return new;end if;
 if new.generation_cost_micro_usd is not null then perform public.settle_pack_credit(new.id,'generation',current_attempt,'settled',new.generation_cost_micro_usd);
 elsif new.status in ('failed','cancelled') and new.provider_started_at is null then perform public.settle_pack_credit(new.id,'generation',current_attempt,'released');end if;
 if new.quality_cost_micro_usd is not null then perform public.settle_pack_credit(new.id,'assessment',current_attempt,'settled',new.quality_cost_micro_usd);
 elsif new.status in ('failed','cancelled','uncertain') or (new.quality_state in ('completed','unavailable') and
   (new.quality_provider_started_at is null or new.quality_error_code in ('assessment_quota','assessment_credentials'))) then
  perform public.settle_pack_credit(new.id,'assessment',current_attempt,'released');end if;
 return new;
end;$$;

create or replace function public.processing_step(job uuid,worker uuid,action text,p jsonb default '{}'::jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.processing_jobs;ok boolean;begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));
 select * into j from public.processing_jobs where id=job;
 if action='dispatch' and (select enabled from public.billing_settings where id) and (not (j.pack_id is not null or j.billing_metered) or exists(select 1 from public.pack_credit_accounts where user_id=j.user_id and balance_credits<reserved_credits)) then raise exception 'insufficient_credits';end if;
 if action='dispatch' and (j.pack_id is not null or j.billing_metered) and not exists(select 1 from public.pack_credit_reservations where job_id=job and stage='generation' and attempt=j.attempts and state='held') then raise exception 'pack_credit_required';end if;
 ok:=public.processing_step_v3(job,worker,action,p);
 if ok and action='dispatch' and (j.pack_id is not null or j.billing_metered) then update public.pack_credit_reservations set dispatched_at=coalesce(dispatched_at,now()) where job_id=job and stage='generation' and attempt=j.attempts;end if;
 return ok;
end;$$;

create or replace function public.product_assessment_step(job uuid,worker uuid,action text,p jsonb default '{}'::jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.processing_jobs;ok boolean;begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));
 select * into j from public.processing_jobs where id=job;
 if action='dispatch' and (select enabled from public.billing_settings where id) and (not (j.pack_id is not null or j.billing_metered) or exists(select 1 from public.pack_credit_accounts where user_id=j.user_id and balance_credits<reserved_credits)) then raise exception 'insufficient_credits';end if;
 if action='dispatch' and (j.pack_id is not null or j.billing_metered) and not exists(select 1 from public.pack_credit_reservations where job_id=job and stage='assessment' and attempt=j.attempts and state='held') then raise exception 'pack_credit_required';end if;
 ok:=public.product_assessment_step_v3(job,worker,action,p);
 if ok and action='dispatch' and (j.pack_id is not null or j.billing_metered) then update public.pack_credit_reservations set dispatched_at=coalesce(dispatched_at,now()) where job_id=job and stage='assessment' and attempt=j.attempts;end if;
 return ok;
end;$$;

create or replace function public.retry_processing_job(job uuid,owner uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.processing_jobs;ok boolean;begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));
 ok:=public.retry_processing_job_v3(job,owner);if not ok then return false;end if;
 select * into j from public.processing_jobs where id=job and user_id=owner;
 if j.pack_id is not null or j.billing_metered then
  perform public.reserve_pack_credit(j.id,'generation',j.attempts+1,(j.pack_credit_plan->>'generation_credits')::bigint,(j.pack_credit_plan->>'unit_micro_usd')::bigint);
  perform public.reserve_pack_credit(j.id,'assessment',j.attempts+1,(j.pack_credit_plan->>'assessment_credits')::bigint,(j.pack_credit_plan->>'unit_micro_usd')::bigint);
 end if;return true;
end;$$;

revoke all on function public.submit_processing_job_v4(jsonb,jsonb),public.billing_tier(uuid),public.ensure_billing_account(uuid),public.bind_billing_checkout(text,uuid,text),public.begin_billing_checkout(uuid,uuid),public.apply_billing_event(text,text,text,jsonb),public.billing_admission(),public.billing_resource_quota() from public,anon,authenticated;
grant execute on function public.billing_tier(uuid),public.ensure_billing_account(uuid),public.bind_billing_checkout(text,uuid,text),public.begin_billing_checkout(uuid,uuid),public.apply_billing_event(text,text,text,jsonb) to service_role;
create function public.commerce_schema_version()returns integer language sql immutable set search_path='' as $$select 2026102807$$;
revoke all on function public.commerce_schema_version() from public,anon,authenticated;grant execute on function public.commerce_schema_version() to service_role;
revoke all on function public.submit_processing_job(jsonb,jsonb),public.submit_processing_job_v4(jsonb,jsonb) from public,anon,authenticated,service_role;grant execute on function public.submit_processing_job(jsonb,jsonb) to service_role;

-- Commercial activation is deliberately separate from installing the schema.
-- Never silently convert legacy internal allowances into purchased units.
create function public.activate_commerce(reviewed boolean,daily_free_grants integer default 10)returns boolean language plpgsql security definer set search_path='' as $$begin
 perform pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));
 if (select enabled from public.billing_settings where id)then return true;end if;
 if reviewed is distinct from true or daily_free_grants not between 0 and 100 then raise exception 'billing_review_required';end if;
 if exists(select 1 from public.processing_jobs where status in('queued','running','persisting','uncertain')) or exists(select 1 from public.pack_credit_reservations where state='held')then raise exception 'billing_active_work';end if;
 if exists(select 1 from public.pack_credit_accounts where unit_micro_usd<>10000 or balance_credits<>0 or reserved_credits<>0)then raise exception 'billing_legacy_balance_review';end if;
 update public.billing_settings set enabled=true,free_daily_grants=daily_free_grants where id;return true;
end$$;
revoke all on function public.activate_commerce(boolean,integer) from public,anon,authenticated;grant execute on function public.activate_commerce(boolean,integer) to service_role;
notify pgrst,'reload schema';

-- Purchasing stays OFF; operator activation is a distinct audited operation.
do $$begin if(select enabled from public.billing_settings where id)then raise exception 'Unexpected commerce activation';end if;end$$;
notify pgrst,'reload schema';
commit;
select public.processing_schema_version() as processing,public.product_quality_schema_version() as product_quality,public.product_packs_schema_version() as product_packs,public.brand_schema_version() as brand,public.batch_schema_version() as bulk,public.library_schema_version() as library,public.commerce_schema_version() as commerce;
