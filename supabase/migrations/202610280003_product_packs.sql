begin;
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
commit;
