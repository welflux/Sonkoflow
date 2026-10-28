import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { brandSettings } from "../../server/brand/contracts.js";
const db = new PGlite(),
  owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
before(async () => {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth,storage to anon,authenticated,service_role;grant execute on function auth.uid() to authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant select on storage.objects to authenticated;`,
  );
  for (const file of (await readdir("supabase/migrations")).sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2)", [owner, other]);
});
after(() => db.close());
beforeEach(() => db.exec("begin"));
afterEach(() => db.exec("rollback"));
async function mutate(
  kind: string,
  action: string,
  id: string,
  parent: string | null = null,
  revision: number | null = null,
  payload: any = {},
  user = owner,
) {
  return (
    await db.query<any>(
      "select public.mutate_brand($1,$2,$3,$4,$5,$6,$7) as result",
      [user, kind, action, id, parent, revision, JSON.stringify(payload)],
    )
  ).rows[0].result;
}
const data = () => ({
  name: "Evergreen",
  description: "Original identity",
  settings: brandSettings.parse({}),
});
async function fails(fn: () => Promise<any>, re: RegExp) {
  await db.exec("savepoint bad");
  let e: any;
  try {
    await fn();
  } catch (err) {
    e = err;
  }
  await db.exec("rollback to savepoint bad;release savepoint bad");
  assert.match(e?.message ?? "", re);
}
async function batchFixture(n: number) {
  const project = randomUUID(),
    submission = randomUUID(),
    items = [];
  await db.query(
    "insert into public.projects(id,user_id,name,audience) values($1,$2,'Batch','ecommerce')",
    [project, owner],
  );
  for (let i = 0; i < n; i++) {
    const source = randomUUID();
    await db.query(
      "insert into public.images(id,user_id,project_id,role,object_key,filename,media_type,byte_size,width,height,checksum,status) values($1,$2,$3,'original',$4,'source.webp','image/webp',1000,128,128,$5,'ready')",
      [source, owner, project, `${owner}/${source}.webp`, "a".repeat(64)],
    );
    items.push({
      input_image_id: source,
      configuration: { outputs: [{ type: "listing", quality: "low" }] },
      jobs: [
        {
          mode: "product",
          instructions: "",
          quality: "low",
          submission_key: randomUUID(),
          request_fingerprint: "b".repeat(64),
          settings: {
            background: "clean",
            framing: "square",
            preserve_appearance: true,
            pack_context: {
              type: "listing",
              scene: "Neutral",
              detail_focus: "Visible features",
            },
            brand_snapshot: {
              profile_name: "Historical brand",
              profile_revision: 1,
            },
          },
          model: "gpt-image-2.5-sunburst-2026-09-08",
          output_size: "1024x1024",
          prompt_version: "brand-pack-v1",
          price_snapshot: { version: "test" },
          reserved_micro_usd: 100000,
          quality_reserved_micro_usd: 0,
          quality_retry_limit: 2,
          pack_output_type: "listing",
          pack_credit_plan: {
            unit_micro_usd: 1000,
            generation_credits: 100,
            assessment_credits: 0,
            estimated_credits: 50,
          },
        },
      ],
    });
  }
  return {
    p: {
      user_id: owner,
      project_id: project,
      name: "Bulk",
      submission_key: submission,
      request_fingerprint: "c".repeat(64),
      configuration: { image_ids: items.map((i) => i.input_image_id) },
      plan: { reserved_credits: n * 100 },
    },
    items,
  };
}
async function create(f: any, max = 100) {
  return (
    await db.query<any>(
      "select public.create_processing_batch($1,$2,$3,$4,$5) as batch",
      [
        JSON.stringify(f.p),
        JSON.stringify(f.items),
        JSON.stringify({
          user_active: 1,
          user_daily: 100,
          global_daily: 1000,
          user_budget: 100e6,
          global_budget: 1000e6,
        }),
        JSON.stringify({
          max_outputs: 5,
          initial_credits: 1000000,
          unit_micro_usd: 1000,
        }),
        JSON.stringify({ max_images: max, daily: 2, max_bytes: 50e6 }),
      ],
    )
  ).rows[0].batch;
}
async function failure(fn: () => Promise<any>, pattern: RegExp) {
  await db.exec("savepoint error");
  let e: any;
  try {
    await fn();
  } catch (x) {
    e = x;
  }
  await db.exec("rollback to savepoint error;release savepoint error");
  assert.match(e?.message ?? "", pattern);
}
test("20-source batch admission is atomic, preserves snapshots and duplicate requests reserve allowance once", async () => {
  const f = await batchFixture(20),
    b = await create(f);
  assert.equal(
    (await db.query("select * from public.batch_items")).rows.length,
    20,
  );
  assert.equal(
    (await db.query("select * from public.processing_jobs")).rows.length,
    20,
  );
  assert.equal(
    (
      await db.query<any>(
        "select reserved_credits from public.pack_credit_accounts",
      )
    ).rows[0].reserved_credits,
    2000,
  );
  assert.equal((await create(f)).id, b.id);
  assert.equal(
    (
      await db.query(
        "select * from public.pack_credit_reservations where state='held'",
      )
    ).rows.length,
    20,
  );
  const j = (
    await db.query<any>("select settings from public.processing_jobs limit 1")
  ).rows[0];
  assert.equal(j.settings.brand_snapshot.profile_name, "Historical brand");
});
test("20-source scheduling respects existing image quota and cancellation releases queued reservations without deleting originals", async () => {
  const f = await batchFixture(20),
    b = await create(f);
  assert.equal(
    (await db.query("select * from public.processing_jobs")).rows.length,
    20,
  );
  await db.query("select public.cancel_processing_batch($1,$2)", [b.id, owner]);
  assert.equal(
    (
      await db.query(
        "select * from public.processing_jobs where status='cancelled'",
      )
    ).rows.length,
    20,
  );
  assert.equal(
    (
      await db.query<any>(
        "select reserved_credits from public.pack_credit_accounts",
      )
    ).rows[0].reserved_credits,
    0,
  );
  assert.equal(
    (await db.query("select * from public.images where role='original'")).rows
      .length,
    20,
  );
  await db.query("select public.cancel_processing_batch($1,$2)", [b.id, owner]);
  assert.equal(
    (
      await db.query<any>(
        "select reserved_credits from public.pack_credit_accounts",
      )
    ).rows[0].reserved_credits,
    0,
  );
});
test("Capacity and ownership failures roll back every batch record, output job and reservation", async () => {
  const f = await batchFixture(3);
  await failure(() => create(f, 2), /batch_limit/);
  assert.equal(
    (await db.query("select * from public.processing_batches")).rows.length,
    0,
  );
  f.items[1].input_image_id = randomUUID();
  await failure(() => create(f), /source_not_found|foreign key constraint/);
  assert.equal(
    (await db.query("select * from public.processing_jobs")).rows.length,
    0,
  );
  assert.equal(
    (await db.query("select * from public.pack_credit_reservations")).rows
      .length,
    0,
  );
});
test("Batch and item RLS deny a second account and application roles cannot invoke privileged batch functions", async () => {
  const f = await batchFixture(2),
    b = await create(f);
  await db.exec(
    `set local role authenticated;select set_config('request.jwt.claim.sub','${other}',true)`,
  );
  for (const table of ["processing_batches", "batch_items"])
    assert.equal(
      (await db.query(`select * from public.${table}`)).rows.length,
      0,
    );
  await failure(
    () =>
      db.query("select public.cancel_processing_batch($1,$2)", [b.id, owner]),
    /permission denied/,
  );
  await db.exec("reset role");
  assert.equal(
    (
      await db.query<any>(
        "select public.cancel_processing_batch($1,$2) as ok",
        [b.id, other],
      )
    ).rows[0].ok,
    false,
  );
});

test("A 50-source batch safely fails against existing output-byte capacity without partial admission", async () => {
  const f = await batchFixture(50);
  await failure(() => create(f), /output_storage_limit/);
  assert.equal(
    (await db.query("select * from public.processing_batches")).rows.length,
    0,
  );
  assert.equal(
    (await db.query("select * from public.processing_jobs")).rows.length,
    0,
  );
});
