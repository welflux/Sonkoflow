import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("Phase 4 preserves existing records and RLS without minting wallets or retroactively charging standalone jobs", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth,storage to anon,authenticated,service_role;grant execute on function auth.uid() to authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant select on storage.objects to authenticated;`,
    );
    for (const file of [
      "202610270001_foundation.sql",
      "202610280001_processing.sql",
    ])
      await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    const owner = "11111111-1111-4111-8111-111111111111",
      project = "22222222-2222-4222-8222-222222222222",
      source = "33333333-3333-4333-8333-333333333333",
      output = "44444444-4444-4444-8444-444444444444",
      job = "55555555-5555-4555-8555-555555555555";
    await db.query("insert into auth.users(id) values($1)", [owner]);
    await db.query(
      "insert into public.projects(id,user_id,name,audience) values($1,$2,'Existing collection','ecommerce')",
      [project, owner],
    );
    for (const [id, role] of [
      [source, "original"],
      [output, "generated"],
    ])
      await db.query(
        "insert into public.images(id,user_id,project_id,role,object_key,filename,media_type,byte_size,width,height,checksum,status) values($1,$2,$3,$4,$5,'existing.webp','image/webp',1000,1024,1024,$6,'ready')",
        [id, owner, project, role, `${owner}/${id}.webp`, "a".repeat(64)],
      );
    await db.query(
      "insert into public.processing_jobs(id,user_id,project_id,input_image_id,output_image_id,submission_key,mode,status,cost_estimate_micro_usd) values($1,$2,$3,$4,$5,$1,'product','completed',1234)",
      [job, owner, project, source, output],
    );
    await db.query(
      "insert into public.usage_events(user_id,job_id,operation,units,idempotency_key,cost_estimate_micro_usd) values($1,$2,'processing',1,'existing-ledger',1234)",
      [owner, job],
    );
    await db.exec(
      await readFile(
        "supabase/migrations/202610280002_product_quality.sql",
        "utf8",
      ),
    );
    const policies = await db.query(
      "select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where tablename not in ('product_packs','pack_credit_accounts','pack_credit_reservations') order by schemaname,tablename,policyname",
    );
    const pictures = await db.query("select * from public.images order by id");
    const ledger = await db.query("select * from public.usage_events");
    await db.exec(
      await readFile(
        "supabase/migrations/202610280003_product_packs.sql",
        "utf8",
      ),
    );
    assert.deepEqual(
      (
        await db.query(
          "select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where tablename not in ('product_packs','pack_credit_accounts','pack_credit_reservations') order by schemaname,tablename,policyname",
        )
      ).rows,
      policies.rows,
    );
    assert.deepEqual(
      (await db.query("select * from public.images order by id")).rows,
      pictures.rows,
    );
    assert.deepEqual(
      (await db.query("select * from public.usage_events")).rows.map((row) =>
        Object.fromEntries(
          Object.keys(ledger.rows[0]).map((key) => [key, row[key]]),
        ),
      ),
      ledger.rows,
    );
    const saved = (
      await db.query<any>("select * from public.processing_jobs where id=$1", [
        job,
      ])
    ).rows[0];
    assert.equal(saved.input_image_id, source);
    assert.equal(saved.output_image_id, output);
    assert.equal(saved.status, "completed");
    assert.equal(saved.quality_state, "pending");
    assert.equal(saved.quality_model, null);
    assert.equal(saved.quality_reserved_micro_usd, 0);
    assert.equal(saved.generation_cost_micro_usd, 1234);
    assert.equal(saved.user_decision, "pending");
    assert.equal(saved.pack_id, null);
    assert.equal(
      (await db.query("select * from public.pack_credit_accounts")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.pack_credit_reservations")).rows
        .length,
      0,
    );
    assert.equal(
      (await db.query<any>("select count(*)::int as n from public.profiles"))
        .rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});
