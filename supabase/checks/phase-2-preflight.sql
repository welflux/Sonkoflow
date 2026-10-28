-- Read only: run on the intended existing project before/after the new migration.
select jsonb_build_object(
 'database',current_database(),
 'job_columns',(select coalesce(jsonb_agg(column_name order by column_name),'[]'::jsonb) from information_schema.columns where table_schema='public' and table_name='processing_jobs'),
 'job_count',(select count(*) from public.processing_jobs),
 'image_counts',(select coalesce(jsonb_agg(t),'[]'::jsonb) from(select role,status,count(*) from public.images group by role,status)t),
 'functions',(select coalesce(jsonb_agg(routine_name order by routine_name),'[]'::jsonb) from information_schema.routines where routine_schema='public' and routine_name in('submit_processing_job','claim_processing_job','processing_step','retry_processing_job','cancel_processing_job','protect_processing_image','processing_schema_version')),
 'rls',(select jsonb_agg(jsonb_build_object('table',relname,'enabled',relrowsecurity)) from pg_class where oid in ('public.images'::regclass,'public.processing_jobs'::regclass,'public.usage_events'::regclass)),
 'bucket',(select jsonb_agg(jsonb_build_object('id',id,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types)) from storage.buckets where id='photos')
) as phase_2_preflight;
