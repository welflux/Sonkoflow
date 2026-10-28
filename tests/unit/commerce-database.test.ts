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
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key,email_confirmed_at timestamptz default now());create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth,storage to anon,authenticated,service_role;grant execute on function auth.uid() to authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant select on storage.objects to authenticated;`,
  );
  for (const file of (await readdir("supabase/migrations")).sort())
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.query("insert into auth.users(id) values($1),($2)", [owner, other]);
});
after(() => db.close());
beforeEach(() =>
  db.exec("begin;update public.billing_settings set enabled=true"),
);
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
async function account(user = owner) {
  return (
    await db.query<any>("select public.ensure_billing_account($1) as account", [
      user,
    ])
  ).rows[0].account;
}
async function checkout(offer = "small_pack", user = owner) {
  const id = randomUUID();
  await db.query(
    "insert into public.billing_checkouts(id,user_id,token_hash,offer_id,status,provider_id,amount_cents,units)select $1,$2,$3,id,'pending',$4,cents,units from public.billing_offers where id=$5",
    [id, user, "h" + id, id, offer],
  );
  return id;
}
async function event(id: string, kind: string, p: any, eventId = randomUUID()) {
  return (
    await db.query<any>(
      "select public.apply_billing_event($1,$2,$3,$4) as result",
      [
        eventId,
        "a".repeat(64),
        kind,
        JSON.stringify({ checkout_id: id, ...p }),
      ],
    )
  ).rows[0].result;
}

test("Verified-email sample grant is lifetime-idempotent and global daily grant capacity is enforced", async () => {
  const a = await account();
  assert.equal(a.account.balance_credits, 20);
  assert.equal((await account()).account.balance_credits, 20);
  await db.exec("update public.billing_settings set free_daily_grants=1");
  assert.equal((await account(other)).account.balance_credits, 0);
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [
    other,
  ]);
  await fails(() => account(other), /billing_unverified/);
});
test("One-time verified payments grant exactly once across duplicate event IDs and different notifications for the same capture", async () => {
  await account();
  const id = await checkout(),
    p = { provider_id: id, payment_id: "capture-1", amount_cents: 500 };
  const eventId = randomUUID();
  assert.equal(await event(id, "paid", p, eventId), true);
  assert.equal(await event(id, "paid", p, eventId), false);
  await event(id, "paid", p);
  assert.equal((await account()).account.balance_credits, 70);
  assert.equal(
    (await db.query("select * from public.billing_receipts")).rows.length,
    1,
  );
  await fails(
    () => event(id, "paid", { ...p, amount_cents: 1 }),
    /billing_amount/,
  );
});
test("Recurring receipts grant actual paid-cycle capacity; cancellation retains paid-through access and does not regrant units", async () => {
  await account();
  const id = await checkout("pro_monthly"),
    p = {
      provider_id: id,
      payment_id: "sale-1",
      amount_cents: 1900,
      paid_until: new Date(Date.now() + 28 * 86400000).toISOString(),
    };
  await event(id, "paid", p);
  assert.equal((await account()).plan, "pro");
  assert.equal((await account()).account.balance_credits, 270);
  await event(id, "cancelled", {});
  assert.equal((await account()).plan, "pro");
  await event(id, "paid", p);
  assert.equal((await account()).account.balance_credits, 270);
  await db.exec(
    "update public.billing_subscriptions set paid_until=now()-interval '1 second'",
  );
  assert.equal((await account()).plan, "payg");
});
test("Refunds remove proportional units once and consumed-refund debt stops new reservations; paid replay cannot reactivate refunded rights", async () => {
  await account();
  const id = await checkout(),
    p = { provider_id: id, payment_id: "capture-2", amount_cents: 500 };
  await event(id, "paid", p);
  await db.query(
    "update public.pack_credit_accounts set balance_credits=10 where user_id=$1",
    [owner],
  );
  const refund = {
    payment_id: "capture-2",
    refund_id: "refund-1",
    amount_cents: 500,
  };
  await event(id, "refund", refund);
  await event(id, "refund", refund);
  assert.equal((await account()).account.balance_credits, -40);
  assert.equal((await account()).plan, "free");
  await event(id, "paid", p);
  assert.equal(
    (
      await db.query<any>(
        "select status from public.billing_checkouts where id=$1",
        [id],
      )
    ).rows[0].status,
    "refunded",
  );
});
test("Authenticated roles cannot forge payments, change entitlements, call legacy submit or read another customer receipts", async () => {
  await account();
  const id = await checkout();
  await event(id, "paid", {
    provider_id: id,
    payment_id: "capture-private",
    amount_cents: 500,
  });
  await db.exec(
    `set local role authenticated;select set_config('request.jwt.claim.sub','${other}',true)`,
  );
  assert.equal(
    (await db.query("select * from public.billing_receipts")).rows.length,
    0,
  );
  await fails(
    () =>
      event(id, "paid", {
        provider_id: id,
        payment_id: "forged",
        amount_cents: 500,
      }),
    /permission denied/,
  );
  await fails(
    () => db.query("update public.billing_accounts set has_paid=true"),
    /permission denied/,
  );
  await fails(
    () => db.query("select public.submit_processing_job_v4('{}','{}')"),
    /permission denied/,
  );
  await db.exec("reset role");
});

const project = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  source = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const limits = {
  user_active: 5,
  user_daily: 20,
  global_daily: 50,
  user_budget: 5e6,
  global_budget: 10e6,
};
function payload() {
  return {
    user_id: owner,
    project_id: project,
    input_image_id: source,
    submission_key: randomUUID(),
    mode: "product",
    instructions: "Natural light",
    settings: {
      background: "clean",
      framing: "match",
      preserve_appearance: true,
    },
    model: "gpt-image-2.5-flare-2026-09-08",
    output_size: "1024x1024",
    quality: "high",
    prompt_version: "reference-edit-v1",
    request_fingerprint: "a".repeat(64),
    reserved_micro_usd: 1e6,
    price_snapshot: {
      version: "test-rates",
      text_input: 5,
      image_input: 8,
      text_output: 10,
      image_output: 32,
    },
  };
}
async function submit(p = payload(), l = limits) {
  return (
    await db.query<{ job: any }>(
      "select public.submit_processing_job($1::jsonb,$2::jsonb) as job",
      [JSON.stringify(p), JSON.stringify(l)],
    )
  ).rows[0].job;
}

async function original() {
  await db.query(
    "insert into public.projects(id,user_id,name,audience)values($1,$2,'Commerce test','ecommerce')",
    [project, owner],
  );
  await db.query(
    "insert into public.images(id,user_id,project_id,role,object_key,filename,media_type,byte_size,width,height,checksum,status)values($1,$2,$3,'original',$4,'source.webp','image/webp',1000,128,128,$5,'ready')",
    [source, owner, project, `${owner}/${source}.webp`, "a".repeat(64)],
  );
}
function metered() {
  return {
    ...payload(),
    quality: "low",
    mode: "personal",
    reserved_micro_usd: 100000,
    pack_credit_plan: {
      unit_micro_usd: 10000,
      generation_credits: 10,
      assessment_credits: 0,
      estimated_credits: 5,
      estimated_micro_usd: 50000,
      version: "test",
    },
  };
}
test("Standalone edits reserve the existing wallet once; atomic admission prevents overspending and repeated free samples", async () => {
  await original();
  const p = metered(),
    a = await submit(p);
  assert.equal(a.billing_metered, true);
  assert.equal(a.free_sample, true);
  assert.equal((await account()).account.reserved_credits, 10);
  assert.equal((await submit(p)).id, a.id);
  assert.equal((await account()).account.reserved_credits, 10);
  await fails(() => submit(metered()), /billing_sample_used/);
  await fails(
    () => submit({ ...metered(), quality: "high" }),
    /billing_entitlement/,
  );
  const id = await checkout();
  await event(id, "paid", {
    provider_id: id,
    payment_id: "meter-fund",
    amount_cents: 500,
  });
  await db.query(
    "update public.pack_credit_accounts set balance_credits=15 where user_id=$1",
    [owner],
  );
  await fails(() => submit(metered()), /insufficient_credits/);
  assert.equal(
    (await db.query("select * from public.processing_jobs")).rows.length,
    1,
  );
});
test("Verified consumption settles standalone reservations at actual cost and paid replay never duplicates usage", async () => {
  await original();
  const j = await submit(metered()),
    worker = randomUUID();
  await db.query("select public.claim_processing_job($1,420,1)", [worker]);
  assert.equal(
    (
      await db.query<any>(
        "select public.processing_step($1,$2,'dispatch','{}') as ok",
        [j.id, worker],
      )
    ).rows[0].ok,
    true,
  );
  await db.query(
    "update public.processing_jobs set generation_cost_micro_usd=42000 where id=$1",
    [j.id],
  );
  assert.equal((await account()).account.balance_credits, 15);
  assert.equal((await account()).account.reserved_credits, 0);
  await db.query(
    "update public.processing_jobs set generation_cost_micro_usd=42000 where id=$1",
    [j.id],
  );
  assert.equal((await account()).account.balance_credits, 15);
});
test("Undispatched cancellation releases units; interrupted external requests retain their hold", async () => {
  await original();
  const j = await submit(metered());
  await db.query(
    "update public.processing_jobs set status='cancelled' where id=$1",
    [j.id],
  );
  assert.equal((await account()).account.reserved_credits, 0);
  const next = await submit(metered());
  assert.equal((await account()).account.reserved_credits, 10);
  await db.query(
    "update public.processing_jobs set provider_started_at=now(),status='uncertain' where id=$1",
    [next.id],
  );
  assert.equal((await account()).account.reserved_credits, 10);
});
test("Checkout intent is owner/email bound and annual payments grant exactly twelve paid months up front", async () => {
  const id = await checkout("starter_annual");
  await fails(
    () =>
      db.query("select public.bind_billing_checkout($1,$2,$3)", [
        "h" + id,
        other,
        "email",
      ]),
    /billing_owner/,
  );
  await account();
  await event(id, "paid", {
    provider_id: id,
    payment_id: "annual",
    amount_cents: 9000,
    paid_until: new Date(Date.now() + 365 * 86400000).toISOString(),
  });
  assert.equal((await account()).account.balance_credits, 1220);
  assert.equal((await account()).plan, "starter");
  const otherCheckout = await checkout("pro_monthly");
  await fails(
    () =>
      db.query("select public.begin_billing_checkout($1,$2)", [
        otherCheckout,
        owner,
      ]),
    /billing_subscription_exists/,
  );
});
test("Free project and storage quotas and product-pack/brand admission are enforced inside the database", async () => {
  await account();
  for (let n = 0; n < 3; n++)
    await db.query(
      "insert into public.projects(user_id,name,audience)values($1,'test','ecommerce')",
      [owner],
    );
  await fails(
    () =>
      db.query(
        "insert into public.projects(user_id,name,audience)values($1,'fourth','ecommerce')",
        [owner],
      ),
    /billing_storage_limit/,
  );
  await fails(
    () => mutate("profile", "save", randomUUID(), null, null, data()),
    /billing_entitlement/,
  );
});

test("Commercial activation cannot silently convert legacy balances or accept an unreviewed rollout", async () => {
  await db.exec("update public.billing_settings set enabled=false");
  await fails(
    () => db.query("select public.activate_commerce(false,10)"),
    /billing_review_required/,
  );
  await db.exec("update public.billing_settings set enabled=true");
  await account();
  await db.exec("update public.billing_settings set enabled=false");
  await fails(
    () => db.query("select public.activate_commerce(true,10)"),
    /billing_legacy_balance_review/,
  );
  await db.query(
    "update public.pack_credit_accounts set balance_credits=0 where user_id=$1",
    [owner],
  );
  assert.equal(
    (await db.query<any>("select public.activate_commerce(true,10) as ok"))
      .rows[0].ok,
    true,
  );
});
