begin;
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
notify pgrst,'reload schema';commit;
