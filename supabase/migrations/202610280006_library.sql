begin;
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
notify pgrst,'reload schema';commit;
