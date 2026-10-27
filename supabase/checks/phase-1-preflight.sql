-- Read-only: one consolidated result so the SQL Editor does not hide earlier checks.
-- No application records, credentials, tokens, or image contents are selected.
select jsonb_build_object(
  'database_name', current_database(),
  'database_role', current_user,
  'objects', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    from (
      select n.nspname as schema_name, c.relname as object_name,
             c.relkind as object_kind, c.relrowsecurity as rls_enabled
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in
        ('profiles','projects','images','processing_jobs','usage_events','app_sessions','rate_limits')
      order by c.relname
    ) t
  ),
  'policies', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    from (
      select schemaname, tablename, policyname, permissive, roles, cmd
      from pg_catalog.pg_policies
      where (schemaname='public' and tablename in
        ('profiles','projects','images','processing_jobs','usage_events','app_sessions','rate_limits'))
        or (schemaname='storage' and tablename='objects')
      order by schemaname,tablename,policyname
    ) t
  ),
  'functions', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    from (
      select routine_name from information_schema.routines
      where routine_schema='public' and routine_name in
        ('create_profile','enforce_project_quota','enforce_image_quota',
         'take_rate_limit','claim_session_refresh','complete_upload','complete_deletion')
      order by routine_name
    ) t
  ),
  'photos_bucket', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
    from (
      select id, public, file_size_limit, allowed_mime_types
      from storage.buckets where id='photos'
    ) t
  )
) as phase_1_preflight;
