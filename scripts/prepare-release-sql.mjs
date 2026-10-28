import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const names = [
  "202610280001_processing.sql",
  "202610280002_product_quality.sql",
  "202610280003_product_packs.sql",
  "202610280004_brand_studio.sql",
  "202610280005_batches.sql",
  "202610280006_library.sql",
  "202610280007_commerce.sql",
];
export async function releaseSql() {
  const parts = [];
  for (const name of names) {
    const source = await readFile(
      new URL(`../supabase/migrations/${name}`, import.meta.url),
      "utf8",
    );
    if (!/^begin;/i.test(source.trim()) || !/commit;$/i.test(source.trim()))
      throw Error(`Unexpected transaction boundaries in ${name}`);
    const sql = source
      .trim()
      .replace(/^begin;\s*/i, "")
      .replace(/\s*commit;$/i, "");
    parts.push(
      `-- SOURCE: ${name}\n-- SHA256: ${createHash("sha256").update(source).digest("hex")}\n${sql}`,
    );
  }
  return `-- SONKOFLOW release: 28 October 2026\n-- Apply ONLY to the existing Phase 1 Sonkoflow project after reviewing the preflight.\n-- One transaction: any failure rolls back all new schema changes.\n-- This does not reset data, enable purchasing, create payments, or call OpenAI.\n-- Existing auth/profile/image objects are retained. Keep production processing disabled until verification.\nbegin;\nset local lock_timeout='5s';\nset local statement_timeout='120s';\nselect pg_advisory_xact_lock(hashtext('sonkoflow-processing-budget'));\ndo $$begin\n if to_regclass('public.profiles') is null or to_regclass('public.images') is null or to_regclass('public.processing_jobs') is null then raise exception 'Foundation schema missing: do not continue';end if;\n if to_regprocedure('public.processing_schema_version()') is not null or to_regclass('public.billing_settings') is not null then raise exception 'A later schema already exists: inspect migrations individually; do not rerun this bundle';end if;\n if exists(select 1 from information_schema.columns where table_schema='public' and table_name='processing_jobs' and column_name='mode')then raise exception 'Phase 2 schema appears partially present: operator inspection required';end if;\n if exists(select 1 from public.processing_jobs where status in('queued','running'))then raise exception 'Active legacy work exists: drain it before schema deployment';end if;\n if not exists(select 1 from storage.buckets where id='photos' and public=false)then raise exception 'Private photos bucket missing or public';end if;\nend$$;\n\n${parts.join("\n\n")}\n\n-- Purchasing stays OFF; operator activation is a distinct audited operation.\ndo $$begin if(select enabled from public.billing_settings where id)then raise exception 'Unexpected commerce activation';end if;end$$;\nnotify pgrst,'reload schema';\ncommit;\nselect public.processing_schema_version() as processing,public.product_quality_schema_version() as product_quality,public.product_packs_schema_version() as product_packs,public.brand_schema_version() as brand,public.batch_schema_version() as bulk,public.library_schema_version() as library,public.commerce_schema_version() as commerce;\n`;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  await mkdir("release", { recursive: true });
  const sql = await releaseSql();
  await writeFile("release/20261028-pending-migrations.sql", sql);
  console.log(
    "Prepared guarded transactional release/20261028-pending-migrations.sql",
  );
}
