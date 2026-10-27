begin;
revoke create on schema public from public,anon,authenticated;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '' check (length(display_name)<=100),
 audience text not null default 'individual' check (audience in ('ecommerce','professional','individual')),
 created_at timestamptz not null default now()
);
create function public.create_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.profiles(id) values(new.id);return new;end; $$;
create trigger account_profile after insert on auth.users for each row execute function public.create_profile();
create table public.projects (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 100),
 audience text not null check(audience in ('ecommerce','professional','individual')),
 created_at timestamptz not null default now(),unique(id,user_id)
);
create function public.enforce_project_quota() returns trigger language plpgsql security definer set search_path='' as $$
begin perform 1 from public.profiles where id=new.user_id for update; if (select count(*) from public.projects where user_id=new.user_id)>=100 then raise exception 'Project quota exceeded';end if;return new;end;$$;
revoke all on function public.enforce_project_quota() from public,anon,authenticated;
create trigger project_quota before insert on public.projects for each row execute function public.enforce_project_quota();
create index projects_owner on public.projects(user_id,created_at desc);
create table public.images (
 id uuid primary key, user_id uuid not null references public.profiles(id) on delete cascade,
 project_id uuid not null, role text not null check(role in ('original','generated')),
 object_key text not null unique, filename text not null check(length(filename) between 1 and 150),
 media_type text not null check(media_type='image/webp'), byte_size integer not null check(byte_size between 1 and 10485760),
 width integer not null check(width>=64),height integer not null check(height>=64),
 checksum text not null check(checksum ~ '^[a-f0-9]{64}$'),
 status text not null default 'pending' check(status in ('pending','ready','deleting')),
 created_at timestamptz not null default now(), unique(id,user_id),unique(id,project_id,user_id),
 foreign key(project_id,user_id) references public.projects(id,user_id),
 check(object_key=user_id::text||'/'||id::text||'.webp'),check(width::bigint*height<=25000000)
);
create index images_owner on public.images(user_id,project_id,created_at desc);
create function public.enforce_image_quota() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.profiles where id=new.user_id for update;
 if (select count(*) from public.images where user_id=new.user_id)>=100 or
 (select coalesce(sum(byte_size),0) from public.images where user_id=new.user_id)+new.byte_size>262144000 then
 raise exception 'Image quota exceeded' using errcode='P0001';end if;
 return new;
end;$$;
create trigger image_quota before insert on public.images for each row execute function public.enforce_image_quota();
create table public.processing_jobs (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,
 project_id uuid not null,input_image_id uuid not null,
 status text not null default 'queued' check(status in ('queued','running','completed','failed','cancelled')),
 submission_key uuid not null,created_at timestamptz not null default now(),completed_at timestamptz,
 foreign key(project_id,user_id) references public.projects(id,user_id),
 foreign key(input_image_id,project_id,user_id) references public.images(id,project_id,user_id),unique(user_id,submission_key),unique(id,user_id)
);
create index jobs_owner on public.processing_jobs(user_id,created_at desc);
create table public.usage_events (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,
 job_id uuid, operation text not null check(operation in ('upload','download','delete','processing')),
 units bigint not null check(units>=0),idempotency_key text not null check(length(idempotency_key) between 1 and 200),
 created_at timestamptz not null default now(),unique(user_id,idempotency_key),foreign key(job_id,user_id) references public.processing_jobs(id,user_id)
);
create index usage_owner on public.usage_events(user_id,created_at desc);
create table public.app_sessions (
 id text primary key check(id ~ '^[a-f0-9]{64}$'), user_id uuid not null references public.profiles(id) on delete cascade,
 tokens text not null, purpose text not null check(purpose in ('account','recovery')),
 access_expires_at timestamptz not null,expires_at timestamptz not null,
 refresh_lock text,refresh_until timestamptz, created_at timestamptz not null default now()
);
create index sessions_owner on public.app_sessions(user_id);
create index sessions_expiry on public.app_sessions(expires_at);
create table public.rate_limits(key text primary key,hits integer not null,reset_at timestamptz not null);
create function public.take_rate_limit(bucket_key text,max_hits integer,window_seconds integer) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 insert into public.rate_limits(key,hits,reset_at) values(bucket_key,1,now()+make_interval(secs=>window_seconds))
 on conflict(key) do update set hits=case when public.rate_limits.reset_at<=now() then 1 else public.rate_limits.hits+1 end,
 reset_at=case when public.rate_limits.reset_at<=now() then now()+make_interval(secs=>window_seconds) else public.rate_limits.reset_at end returning hits into n;
 return n<=max_hits;
end;$$;
create function public.claim_session_refresh(session_id text,lock_token text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.app_sessions set refresh_lock=lock_token,refresh_until=now()+interval '30 seconds'
 where id=session_id and expires_at>now() and (refresh_until is null or refresh_until<now());return found;
end;$$;
-- These functions are exclusively called by the trusted backend, never public clients.
revoke all on function public.take_rate_limit(text,integer,integer) from public,anon,authenticated;
revoke all on function public.claim_session_refresh(text,text) from public,anon,authenticated;
grant execute on function public.take_rate_limit(text,integer,integer),public.claim_session_refresh(text,text) to service_role;
revoke all on function public.create_profile(),public.enforce_image_quota() from public,anon,authenticated;
-- Remove default table privileges before granting the minimum user operations.
revoke all on public.profiles,public.projects,public.images,public.processing_jobs,public.usage_events,public.app_sessions,public.rate_limits from anon,authenticated;
grant all on public.profiles,public.projects,public.images,public.processing_jobs,public.usage_events,public.app_sessions,public.rate_limits to service_role;
grant select on public.profiles,public.projects,public.images,public.processing_jobs,public.usage_events to authenticated;
grant update(display_name,audience) on public.profiles to authenticated;
grant insert(user_id,name,audience),delete on public.projects to authenticated;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.images enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.usage_events enable row level security;
alter table public.app_sessions enable row level security;
alter table public.rate_limits enable row level security;
create policy profile_read on public.profiles for select to authenticated using (id=(select auth.uid()));
create policy profile_update on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy project_read on public.projects for select to authenticated using(user_id=(select auth.uid()));
create policy project_insert on public.projects for insert to authenticated with check(user_id=(select auth.uid()));
create policy project_delete on public.projects for delete to authenticated using(user_id=(select auth.uid()));
create policy image_read on public.images for select to authenticated using(user_id=(select auth.uid()));
create policy job_read on public.processing_jobs for select to authenticated using(user_id=(select auth.uid()));
create policy usage_read on public.usage_events for select to authenticated using(user_id=(select auth.uid()));
-- Storage is private. Application users cannot insert/update/delete objects directly,
-- so uploads must pass server decoding and validation.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('photos','photos',false,10485760,array['image/webp']);
create policy photo_read on storage.objects for select to authenticated using(
 bucket_id='photos' and exists(select 1 from public.images i where i.object_key=name and i.user_id=(select auth.uid()) and i.status='ready')
);

create function public.complete_upload(image_id uuid,owner_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 update public.images set status='ready' where id=image_id and user_id=owner_id and status='pending';
 if not found then raise exception 'Invalid upload state';end if;
 insert into public.usage_events(user_id,operation,units,idempotency_key) values(owner_id,'upload',1,'upload:'||image_id::text) on conflict(user_id,idempotency_key) do nothing;
end;$$;
create function public.complete_deletion(image_id uuid,owner_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 delete from public.images where id=image_id and user_id=owner_id and status='deleting';
 if found then insert into public.usage_events(user_id,operation,units,idempotency_key) values(owner_id,'delete',1,'delete:'||image_id::text) on conflict(user_id,idempotency_key) do nothing;end if;
end;$$;
revoke all on function public.complete_upload(uuid,uuid),public.complete_deletion(uuid,uuid) from public,anon,authenticated;
grant execute on function public.complete_upload(uuid,uuid),public.complete_deletion(uuid,uuid) to service_role;
commit;
