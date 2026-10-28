-- Read-only; apply only pending additive migrations after reviewing current state.
select table_name,column_name from information_schema.columns where table_schema='public' and table_name in('projects','images','processing_jobs') and column_name in('archived','library_project_id','trashed_at') order by table_name,column_name;
select tablename,policyname,qual from pg_policies where schemaname='public' and tablename in('images','projects','processing_jobs','processing_batches','batch_items');
select routine_name from information_schema.routines where routine_schema='public' and routine_name in('library_schema_version','library_query','library_action','library_project_action','expire_library_trash');
