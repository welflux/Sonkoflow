-- Read-only. Review the existing project; do not rerun earlier migrations or reset.
select jsonb_build_object(
 'database',current_database(),
 'job_count',(select count(*) from public.processing_jobs),
 'pack_tables',(select coalesce(jsonb_agg(table_name order by table_name),'[]'::jsonb) from information_schema.tables where table_schema='public' and table_name in ('product_packs','pack_credit_accounts','pack_credit_reservations')),
 'job_columns',(select jsonb_agg(column_name order by column_name) from information_schema.columns where table_schema='public' and table_name='processing_jobs'),
 'functions',(select coalesce(jsonb_agg(routine_name order by routine_name),'[]'::jsonb) from information_schema.routines where routine_schema='public' and routine_name in ('product_packs_schema_version','create_product_pack','ensure_pack_account','grant_pack_credits','reconcile_pack_credit')),
 'rls',(select jsonb_agg(jsonb_build_object('table',relname,'enabled',relrowsecurity)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname in ('images','processing_jobs','usage_events','product_packs','pack_credit_accounts','pack_credit_reservations'))
) as phase_4_preflight;
