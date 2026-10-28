-- Read-only. Run on the intended existing project before/after Phase 3 SQL.
-- Phase 1 and 2 migrations must already exist; never reset the database.
select jsonb_build_object(
 'database',current_database(),
 'job_count',(select count(*) from public.processing_jobs),
 'job_columns',(select jsonb_agg(column_name order by column_name) from information_schema.columns where table_schema='public' and table_name='processing_jobs'),
 'quality_functions',(select coalesce(jsonb_agg(routine_name order by routine_name),'[]'::jsonb) from information_schema.routines where routine_schema='public' and routine_name in('product_quality_schema_version','claim_product_assessment','product_assessment_step','decide_product_result')),
 'rls',(select jsonb_agg(jsonb_build_object('table',relname,'enabled',relrowsecurity)) from pg_class where oid in ('public.images'::regclass,'public.processing_jobs'::regclass,'public.usage_events'::regclass)),
 'bucket',(select jsonb_agg(jsonb_build_object('id',id,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types)) from storage.buckets where id='photos')
) as phase_3_preflight;
