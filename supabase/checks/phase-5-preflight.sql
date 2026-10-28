-- Read-only. Inspect the target project before applying only the pending migrations.
select jsonb_build_object(
 'database',current_database(),
 'brand_tables',(select coalesce(jsonb_agg(table_name order by table_name),'[]'::jsonb) from information_schema.tables where table_schema='public' and table_name in ('brand_profiles','brand_presets','brand_assets')),
 'functions',(select coalesce(jsonb_agg(routine_name order by routine_name),'[]'::jsonb) from information_schema.routines where routine_schema='public' and routine_name in ('brand_schema_version','mutate_brand','reserve_brand_asset')),
 'existing_jobs',(select count(*) from public.processing_jobs),
 'rls',(select jsonb_agg(jsonb_build_object('table',relname,'enabled',relrowsecurity)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname in ('brand_profiles','brand_presets','brand_assets','images','processing_jobs','product_packs','usage_events')),
 'policies',(select jsonb_agg(jsonb_build_object('table',tablename,'policy',policyname,'command',cmd,'roles',roles)) from pg_policies where schemaname='public' and tablename in ('brand_profiles','brand_presets','brand_assets'))
) as phase_5_preflight;
