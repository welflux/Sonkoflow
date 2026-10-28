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
test("Brand profiles and presets create/edit/duplicate/delete with revisions and retry-safe creation", async () => {
  const id = randomUUID(),
    p = await mutate("profile", "save", id, null, null, data());
  assert.equal(p.revision, 1);
  assert.equal(
    (await mutate("profile", "save", id, null, null, data())).revision,
    1,
  );
  const preset = randomUUID();
  await mutate("preset", "save", preset, id, null, {
    name: "Warm lifestyle",
    purpose: "lifestyle",
    settings: { theme: "warm" },
  });
  const changed = await mutate("profile", "save", id, null, 1, {
    ...data(),
    name: "Evergreen revised",
  });
  assert.equal(changed.revision, 2);
  await fails(
    () => mutate("profile", "save", id, null, 1, data()),
    /brand_conflict/,
  );
  const copy = randomUUID();
  const dup = await mutate("profile", "duplicate", copy, id, 2);
  assert.equal(dup.settings.primary_color, p.settings.primary_color);
  assert.equal(
    (
      await db.query<any>(
        "select * from public.brand_presets where profile_id=$1",
        [copy],
      )
    ).rows.length,
    1,
  );
  await mutate("profile", "delete", id, null, 2);
  assert.equal(
    (
      await db.query<any>(
        "select deleted from public.brand_profiles where id=$1",
        [id],
      )
    ).rows[0].deleted,
    true,
  );
  assert.equal(
    (
      await db.query<any>(
        "select deleted from public.brand_presets where id=$1",
        [preset],
      )
    ).rows[0].deleted,
    true,
  );
  assert.equal(
    (
      await db.query<any>(
        "select deleted from public.brand_profiles where id=$1",
        [copy],
      )
    ).rows[0].deleted,
    false,
  );
});
test("Brand RLS isolates profiles, presets and assets, and rejects direct writes or privileged RPC calls", async () => {
  const id = randomUUID();
  await mutate("profile", "save", id, null, null, data());
  const preset = randomUUID();
  await mutate("preset", "save", preset, id, null, {
    name: "Listing",
    purpose: "listing",
    settings: {},
  });
  await reserve(randomUUID());
  await db.query(
    "update public.brand_assets set status='ready' where user_id=$1",
    [owner],
  );
  await db.exec(
    `set local role authenticated;select set_config('request.jwt.claim.sub','${other}',true)`,
  );
  for (const table of ["brand_profiles", "brand_presets", "brand_assets"])
    assert.equal(
      (await db.query(`select * from public.${table}`)).rows.length,
      0,
    );
  await fails(
    () => mutate("profile", "save", randomUUID(), null, null, data()),
    /permission denied/,
  );
  await fails(
    () => db.query("delete from public.brand_profiles where id=$1", [id]),
    /permission denied/,
  );
  await db.exec(`select set_config('request.jwt.claim.sub','${owner}',true)`);
  for (const table of ["brand_profiles", "brand_presets", "brand_assets"])
    assert.equal(
      (await db.query(`select * from public.${table}`)).rows.length,
      1,
    );
  await db.exec("reset role");
  await fails(
    () =>
      mutate(
        "preset",
        "save",
        randomUUID(),
        id,
        null,
        { name: "Bad", purpose: "listing", settings: {} },
        other,
      ),
    /brand_not_found/,
  );
  await fails(
    () => mutate("profile", "delete", id, null, 1, {}, other),
    /brand_not_found/,
  );
});
async function reserve(id: string, bytes = 1000) {
  return (
    await db.query<any>(
      "select public.reserve_brand_asset($1,$2,$3) as result",
      [
        owner,
        id,
        JSON.stringify({
          name: "Logo",
          kind: "logo",
          checksum: "a".repeat(64),
          byte_size: bytes,
          width: 128,
          height: 128,
        }),
      ],
    )
  ).rows[0].result;
}
test("Asset reservations are idempotent, bounded and keep historical removed files within the storage cap", async () => {
  const id = randomUUID(),
    a = await reserve(id);
  assert.match(a.object_key, /\/brand-/);
  assert.equal((await reserve(id)).id, id);
  await db.query(
    "update public.brand_assets set status='deleted' where id=$1",
    [id],
  );
  for (let i = 0; i < 12; i++) await reserve(randomUUID(), 2097152);
  await fails(() => reserve(randomUUID(), 2097152), /brand_limit/);
});
test("Profile edits and deletion cannot rewrite immutable settings recorded in existing generated jobs", async () => {
  const id = randomUUID(),
    p = await mutate("profile", "save", id, null, null, data()),
    project = randomUUID(),
    source = randomUUID(),
    job = randomUUID();
  await db.query(
    "insert into public.projects(id,user_id,name,audience) values($1,$2,'Products','ecommerce')",
    [project, owner],
  );
  await db.query(
    "insert into public.images(id,user_id,project_id,role,object_key,filename,media_type,byte_size,width,height,checksum,status) values($1,$2,$3,'original',$4,'photo.webp','image/webp',1000,128,128,$5,'ready')",
    [source, owner, project, `${owner}/${source}.webp`, "a".repeat(64)],
  );
  const snapshot = {
    version: "brand-v1",
    profile_id: id,
    profile_name: p.name,
    profile_revision: p.revision,
    settings: p.settings,
  };
  const params = {
    user_id: owner,
    project_id: project,
    input_image_id: source,
    submission_key: job,
    mode: "product",
    instructions: "",
    settings: {
      background: "clean",
      framing: "square",
      preserve_appearance: true,
      brand_snapshot: snapshot,
    },
    model: "gpt-image-2.5-sunburst-2026-09-08",
    output_size: "1024x1024",
    quality: "low",
    prompt_version: "brand-product-v1",
    request_fingerprint: "a".repeat(64),
    reserved_micro_usd: 100000,
    price_snapshot: { version: "test" },
    quality_retry_limit: 2,
  };
  const r = await db.query<any>(
    "select public.submit_processing_job($1,$2) as job",
    [
      JSON.stringify(params),
      JSON.stringify({
        user_active: 1,
        user_daily: 5,
        global_daily: 10,
        user_budget: 5e6,
        global_budget: 10e6,
      }),
    ],
  );
  assert.deepEqual(r.rows[0].job.settings.brand_snapshot, snapshot);
  await mutate("profile", "save", id, null, 1, {
    ...data(),
    name: "New visual identity",
    settings: brandSettings.parse({ primary_color: "#FF0000" }),
  });
  await mutate("profile", "delete", id, null, 2);
  assert.deepEqual(
    (
      await db.query<any>(
        "select settings from public.processing_jobs where id=$1",
        [r.rows[0].job.id],
      )
    ).rows[0].settings.brand_snapshot,
    snapshot,
  );
  assert.equal(
    (await db.query("select * from public.pack_credit_accounts")).rows.length,
    0,
  );
});
test("Active profile and preset limits are enforced inside the transaction", async () => {
  const first = randomUUID();
  await mutate("profile", "save", first, null, null, data());
  for (let i = 1; i < 20; i++)
    await mutate("profile", "save", randomUUID(), null, null, data());
  await fails(
    () => mutate("profile", "save", randomUUID(), null, null, data()),
    /brand_limit/,
  );
  for (let i = 0; i < 20; i++)
    await mutate("preset", "save", randomUUID(), first, null, {
      name: "Preset",
      purpose: "listing",
      settings: {},
    });
  await fails(
    () =>
      mutate("preset", "save", randomUUID(), first, null, {
        name: "Extra",
        purpose: "listing",
        settings: {},
      }),
    /brand_limit/,
  );
  await mutate("profile", "delete", first, null, 1);
  await mutate("profile", "save", randomUUID(), null, null, data());
});

test("Branded packs use existing atomic job/allowance orchestration and keep their saved identity after profile removal", async () => {
  const id = randomUUID(),
    p = await mutate("profile", "save", id, null, null, data()),
    project = randomUUID(),
    source = randomUUID();
  await db.query(
    "insert into public.projects(id,user_id,name,audience) values($1,$2,'Branded products','ecommerce')",
    [project, owner],
  );
  await db.query(
    "insert into public.images(id,user_id,project_id,role,object_key,filename,media_type,byte_size,width,height,checksum,status) values($1,$2,$3,'original',$4,'photo.webp','image/webp',1000,128,128,$5,'ready')",
    [source, owner, project, `${owner}/${source}.webp`, "a".repeat(64)],
  );
  const snapshot = {
      version: "brand-v1",
      profile_id: id,
      profile_name: p.name,
      profile_revision: 1,
      settings: p.settings,
    },
    configuration = {
      outputs: [
        { type: "listing", quality: "low" },
        { type: "wide", quality: "low" },
      ],
      brand_snapshot: snapshot,
    };
  const jobs = configuration.outputs.map((o) => ({
    user_id: owner,
    project_id: project,
    input_image_id: source,
    submission_key: randomUUID(),
    request_fingerprint: "c".repeat(64),
    mode: "product",
    instructions: "Preserve print",
    quality: "low",
    settings: {
      background: "clean",
      framing: o.type === "wide" ? "landscape" : "square",
      preserve_appearance: true,
      brand_snapshot: snapshot,
      pack_context: {
        type: o.type,
        scene: "Neutral room",
        detail_focus: "Visible print",
      },
    },
    model: "gpt-image-2.5-sunburst-2026-09-08",
    output_size: o.type === "wide" ? "1536x1024" : "1024x1024",
    prompt_version: "brand-pack-v1",
    price_snapshot: { version: "test" },
    reserved_micro_usd: 100000,
    quality_reserved_micro_usd: 0,
    quality_retry_limit: 2,
    pack_output_type: o.type,
    pack_credit_plan: {
      unit_micro_usd: 1000,
      generation_credits: 100,
      assessment_credits: 0,
      estimated_credits: 50,
    },
  }));
  const created = (
    await db.query<any>(
      "select public.create_product_pack($1,$2,$3,$4) as pack",
      [
        JSON.stringify({
          user_id: owner,
          project_id: project,
          input_image_id: source,
          submission_key: randomUUID(),
          request_fingerprint: "d".repeat(64),
          configuration,
          plan: {},
        }),
        JSON.stringify(jobs),
        JSON.stringify({
          user_active: 1,
          user_daily: 5,
          global_daily: 10,
          user_budget: 5e6,
          global_budget: 10e6,
        }),
        JSON.stringify({
          max_outputs: 5,
          daily: 2,
          active: 1,
          initial_credits: 1000,
          unit_micro_usd: 1000,
        }),
      ],
    )
  ).rows[0].pack;
  const records = (
    await db.query<any>(
      "select settings,pack_output_type from public.processing_jobs where pack_id=$1",
      [created.id],
    )
  ).rows;
  assert.equal(records.length, 2);
  for (const j of records)
    assert.deepEqual(j.settings.brand_snapshot, snapshot);
  assert.equal(
    (
      await db.query<any>(
        "select reserved_credits from public.pack_credit_accounts where user_id=$1",
        [owner],
      )
    ).rows[0].reserved_credits,
    200,
  );
  await mutate("profile", "delete", id, null, 1);
  assert.deepEqual(
    (
      await db.query<any>(
        "select configuration from public.product_packs where id=$1",
        [created.id],
      )
    ).rows[0].configuration.brand_snapshot,
    snapshot,
  );
});
