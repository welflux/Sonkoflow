begin;
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
commit;
