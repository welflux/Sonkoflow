import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const foundation = "supabase/migrations/202610270001_foundation.sql";
async function base() {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key,email_confirmed_at timestamptz default now());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth,storage to anon,authenticated,service_role;grant execute on function auth.uid() to authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant select on storage.objects to authenticated;`,
  );
  await db.exec(await readFile(foundation, "utf8"));
  return db;
}
test("Guarded release upgrades the Phase 1 database atomically, preserves owned records and keeps billing off", async () => {
  const db = await base();
  try {
    const owner = "11111111-1111-4111-8111-111111111111";
    await db.query("insert into auth.users(id) values($1)", [owner]);
    await db.query(
      "insert into public.projects(user_id,name,audience)values($1,'Existing collection','ecommerce')",
      [owner],
    );
    const sql = await readFile(
      "release/20261028-pending-migrations.sql",
      "utf8",
    );
    await db.exec(sql);
    const v = await db.query<any>(
      "select public.processing_schema_version() as processing,public.commerce_schema_version() as commerce",
    );
    assert.equal(v.rows[0].processing, 2026102801);
    assert.equal(v.rows[0].commerce, 2026102807);
    assert.equal(
      (await db.query<any>("select enabled from public.billing_settings"))
        .rows[0].enabled,
      false,
    );
    assert.equal(
      (await db.query<any>("select name from public.projects")).rows[0].name,
      "Existing collection",
    );
    await assert.rejects(db.exec(sql), /later schema already exists/);
    await db.exec("rollback");
    assert.equal(
      (await db.query<any>("select name from public.projects")).rows[0].name,
      "Existing collection",
    );
  } finally {
    await db.close();
  }
});
test("A release transaction with a downstream failure leaves the original schema and records intact", async () => {
  const db = await base();
  try {
    const sql = await readFile(
      "release/20261028-pending-migrations.sql",
      "utf8",
    );
    const failing = sql.replace(
      "-- Purchasing stays OFF;",
      "select 1/0;\n-- Purchasing stays OFF;",
    );
    await assert.rejects(db.exec(failing), /division by zero/);
    await db.exec("rollback");
    assert.equal(
      (
        await db.query<any>(
          "select to_regprocedure('public.processing_schema_version()') as version,to_regclass('public.billing_settings') as billing",
        )
      ).rows[0].version,
      null,
    );
    assert.equal(
      (await db.query<any>("select to_regclass('public.profiles') as profiles"))
        .rows[0].profiles,
      "profiles",
    );
    assert.equal(
      (
        await db.query<any>(
          "select public from storage.buckets where id='photos'",
        )
      ).rows[0].public,
      false,
    );
  } finally {
    await db.close();
  }
});
