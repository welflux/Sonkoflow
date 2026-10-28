begin;
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
notify pgrst,'reload schema';commit;
