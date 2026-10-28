begin;
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
commit;
