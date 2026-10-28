import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const project = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  source = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const limits = {
  user_active: 1,
  user_daily: 5,
  global_daily: 10,
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
async function claim(worker = randomUUID()) {
  return {
    worker,
    job: (
      await db.query<{ job: any }>(
        "select public.claim_processing_job($1,420,1) as job",
        [worker],
      )
    ).rows[0].job,
  };
}
async function step(
  job: string,
  worker: string,
  action: string,
  p: object = {},
) {
  return (
    await db.query<{ ok: boolean }>(
      "select public.processing_step($1,$2,$3,$4::jsonb) as ok",
      [job, worker, action, JSON.stringify(p)],
    )
  ).rows[0].ok;
}
async function expectFailure(
  operation: () => Promise<unknown>,
  pattern: RegExp,
) {
  await db.exec("savepoint expected_error");
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  await db.exec(
    "rollback to savepoint expected_error;release savepoint expected_error",
  );
  assert(
    caught instanceof Error,
    "Expected the database to reject this operation",
  );
  assert.match(caught.message, pattern);
}
before(async () => {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth,storage to anon,authenticated,service_role;grant execute on function auth.uid() to authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant select on storage.objects to authenticated;`,
  );
  await db.exec(
    await readFile("supabase/migrations/202610270001_foundation.sql", "utf8"),
  );
  await db.exec(
    await readFile("supabase/migrations/202610280001_processing.sql", "utf8"),
  );
  await db.exec(
    await readFile(
      "supabase/migrations/202610280002_product_quality.sql",
      "utf8",
    ),
  );
  await db.query("insert into auth.users(id) values($1),($2)", [owner, other]);
  await db.query(
    "insert into public.projects(id,user_id,name,audience) values($1,$2,'Collection','ecommerce')",
    [project, owner],
  );
  await db.query(
    "insert into public.images(id,user_id,project_id,role,object_key,filename,media_type,byte_size,width,height,checksum,status) values($1,$2,$3,'original',$4,'source.webp','image/webp',1000,128,128,$5,'ready')",
    [source, owner, project, `${owner}/${source}.webp`, "a".repeat(64)],
  );
});
after(() => db.close());
beforeEach(() => db.exec("begin"));
afterEach(() => db.exec("rollback"));
const review = {
  version: "product-review-v1",
  status: "needs_review",
  assessed_at: "2026-10-28T00:00:00Z",
  checks: [
    {
      id: "labels_details",
      label: "Labels",
      status: "needs_review",
      method: "vision",
      confidence: "low",
      explanation: "Print is too small to verify.",
    },
  ],
};
async function finishGeneration(job: any) {
  const c = await claim();
  assert.equal(c.job.id, job.id);
  await step(job.id, c.worker, "dispatch");
  await step(job.id, c.worker, "response", {
    cost: 1000,
    usage: { input_tokens: 20 },
    request_id: "req-generation",
  });
  await step(job.id, c.worker, "prepare", {
    filename: "result.webp",
    byte_size: 1000,
    width: 1024,
    height: 1024,
    checksum: "b".repeat(64),
  });
  await step(job.id, c.worker, "complete");
  return c;
}
async function qclaim() {
  const worker = randomUUID();
  return {
    worker,
    job: (
      await db.query<{ job: any }>(
        "select public.claim_product_assessment($1) as job",
        [worker],
      )
    ).rows[0].job,
  };
}
async function qstep(
  job: string,
  worker: string,
  action: string,
  p: object = {},
) {
  return (
    await db.query<{ ok: boolean }>(
      "select public.product_assessment_step($1,$2,$3,$4::jsonb) as ok",
      [job, worker, action, JSON.stringify(p)],
    )
  ).rows[0].ok;
}
async function finishReview(job: any) {
  const q = await qclaim();
  assert.equal(q.job.id, job.id);
  await qstep(job.id, q.worker, "local", { report: review });
  await qstep(job.id, q.worker, "complete", { report: review });
}
function retryPayload(parent: any) {
  return {
    ...payload(),
    quality_parent_id: parent.id,
    quality_retry_targets: ["labels_details"],
    quality_retry_instructions: "Keep the original label.",
  };
}
test("product completion queues quality review without approval; personal jobs retain their original workflow", async () => {
  const j = await submit();
  await finishGeneration(j);
  const saved = (
    await db.query<any>("select * from public.processing_jobs where id=$1", [
      j.id,
    ])
  ).rows[0];
  assert.equal(saved.status, "completed");
  assert.equal(saved.quality_state, "pending");
  assert.equal(saved.user_decision, "pending");
  const q = await qclaim();
  assert.equal(q.job.id, j.id);
  assert.equal((await qclaim()).job, null);
  assert.equal(
    await qstep(j.id, randomUUID(), "complete", { report: review }),
    false,
  );
  await qstep(j.id, q.worker, "complete", { report: review });
  const p = await submit({ ...payload(), mode: "personal" });
  await finishGeneration(p);
  assert.equal(
    (
      await db.query<any>(
        "select quality_state from public.processing_jobs where id=$1",
        [p.id],
      )
    ).rows[0].quality_state,
    "not_applicable",
  );
});
test("quality reports and revisioned customer decisions persist; duplicate and conflicting decisions are safe", async () => {
  const j = await submit();
  await finishGeneration(j);
  await finishReview(j);
  const key = randomUUID();
  const decide = (decision: string, rev: number, user = owner) =>
    db.query<any>(
      "select public.decide_product_result($1,$2,$3,$4,$5) as revision",
      [j.id, user, decision, key, rev],
    );
  await expectFailure(
    () => decide("approved", 0, other),
    /quality_decision_state/,
  );
  assert.equal((await decide("approved", 0)).rows[0].revision, 1);
  assert.equal((await decide("approved", 0)).rows[0].revision, 1);
  await expectFailure(() => decide("rejected", 1), /submission_conflict/);
  await expectFailure(
    () =>
      db.query("select public.decide_product_result($1,$2,$3,$4,0)", [
        j.id,
        owner,
        "rejected",
        randomUUID(),
      ]),
    /quality_decision_conflict/,
  );
  const row = (
    await db.query<any>(
      "select quality_report,user_decision,quality_decisions from public.processing_jobs where id=$1",
      [j.id],
    )
  ).rows[0];
  assert.deepEqual(row.quality_report, review);
  assert.equal(row.user_decision, "approved");
  assert.equal(row.quality_decisions.length, 1);
});
test("controlled retries preserve the original settings, deduplicate and enforce the immutable family limit", async () => {
  const root = await submit();
  await finishGeneration(root);
  await finishReview(root);
  const p = retryPayload(root);
  const child = await submit(p);
  assert.equal(child.quality_retry_number, 1);
  assert.equal(child.quality_root_id, root.id);
  assert.equal(child.input_image_id, source);
  assert.equal((await submit(p)).id, child.id);
  await expectFailure(
    () => submit({ ...p, request_fingerprint: "c".repeat(64) }),
    /submission_conflict/,
  );
  await finishGeneration(child);
  await finishReview(child);
  const second = await submit(retryPayload(child));
  assert.equal(second.quality_retry_number, 2);
  await finishGeneration(second);
  await finishReview(second);
  await expectFailure(() => submit(retryPayload(root)), /quality_retry_limit/);
  assert.equal(
    (
      await db.query<any>(
        "select count(*)::int as n from public.processing_jobs",
      )
    ).rows[0].n,
    3,
  );
});
test("unsupported retry targets, changed parent settings and foreign parents cannot create new generations", async () => {
  const root = await submit();
  await finishGeneration(root);
  await finishReview(root);
  await expectFailure(
    () => submit({ ...retryPayload(root), quality_retry_targets: ["canvas"] }),
    /quality_retry_target/,
  );
  await expectFailure(
    () => submit({ ...retryPayload(root), settings: { background: "studio" } }),
    /quality_retry_state/,
  );
  await expectFailure(
    () => submit({ ...retryPayload(root), user_id: other }),
    /quality_retry_state/,
  );
  await expectFailure(
    () =>
      submit({
        ...retryPayload(root),
        quality_retry_targets: ["customer_detail"],
        quality_retry_instructions: "",
      }),
    /quality_retry_target/,
  );
});
test("assessment usage is independently idempotent and its cost is included in subsequent budget admission", async () => {
  const j = await submit({
    ...payload(),
    reserved_micro_usd: 1010000,
    quality_reserved_micro_usd: 10000,
    quality_model: "gpt-6.1-terra",
    quality_price_snapshot: { input: 0.4, output: 1.6, version: "test-rates" },
  });
  await finishGeneration(j);
  const q = await qclaim();
  assert(await qstep(j.id, q.worker, "dispatch"));
  assert.equal(await qstep(j.id, q.worker, "dispatch"), false);
  const response = {
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    cost: 2000000,
    request_id: "req-review",
  };
  assert(await qstep(j.id, q.worker, "response", response));
  assert(await qstep(j.id, q.worker, "response", response));
  await qstep(j.id, q.worker, "complete", { report: review });
  const usage = (
    await db.query<any>(
      "select * from public.usage_events where idempotency_key=$1",
      ["assessment:" + j.id],
    )
  ).rows;
  assert.equal(usage.length, 1);
  assert.equal(usage[0].cost_estimate_micro_usd, 2000000);
  const saved = (
    await db.query<any>(
      "select cost_estimate_micro_usd,generation_cost_micro_usd from public.processing_jobs where id=$1",
      [j.id],
    )
  ).rows[0];
  assert.equal(saved.cost_estimate_micro_usd, 2001000);
  assert.equal(saved.generation_cost_micro_usd, 1000);
  await expectFailure(
    () => submit(payload(), { ...limits, user_budget: 2500000 }),
    /budget_limit/,
  );
  await db.query(
    "update public.processing_jobs set generation_cost_micro_usd=null,cost_estimate_micro_usd=null where id=$1",
    [j.id],
  );
  await expectFailure(
    () => submit(payload(), { ...limits, user_budget: 2500000 }),
    /budget_limit/,
  );
});
test("interrupted external assessment is not replayed, retains the image and leaves an unknown-usage ledger", async () => {
  const j = await submit({
    ...payload(),
    quality_reserved_micro_usd: 10000,
    quality_model: "gpt-6.1-terra",
  });
  await finishGeneration(j);
  const q = await qclaim();
  await qstep(j.id, q.worker, "local", { report: review });
  await qstep(j.id, q.worker, "dispatch");
  await db.query(
    "update public.processing_jobs set quality_lease_until=now()-interval '1 second' where id=$1",
    [j.id],
  );
  assert.equal((await qclaim()).job, null);
  const row = (
    await db.query<any>(
      "select status,quality_state,quality_report from public.processing_jobs where id=$1",
      [j.id],
    )
  ).rows[0];
  assert.equal(row.status, "completed");
  assert.equal(row.quality_state, "unavailable");
  assert.equal(row.quality_report.checks.length, 2);
  assert.equal(
    (
      await db.query<any>(
        "select units from public.usage_events where idempotency_key=$1",
        ["assessment:" + j.id],
      )
    ).rows[0].units,
    0,
  );
});
test("quality RPCs are service-only and quality review never weakens job or image tenant isolation", async () => {
  const j = await submit();
  await finishGeneration(j);
  await expectFailure(
    () => db.query("delete from public.images where id=$1", [source]),
    /processing_image_busy/,
  );
  await db.exec("set local role authenticated");
  await expectFailure(
    () =>
      db.query("select public.claim_product_assessment($1)", [randomUUID()]),
    /permission denied/,
  );
  await expectFailure(
    () =>
      db.query("select public.decide_product_result($1,$2,$3,$4,0)", [
        j.id,
        owner,
        "approved",
        randomUUID(),
      ]),
    /permission denied/,
  );
  await expectFailure(
    () =>
      db.query("select public.submit_processing_job_v2($1,$2)", [
        JSON.stringify(payload()),
        JSON.stringify(limits),
      ]),
    /permission denied/,
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [other]);
  assert.equal(
    (await db.query("select quality_report from public.processing_jobs")).rows
      .length,
    0,
  );
  await db.exec("reset role");
});
test("an expired daily assessment reservation cannot dispatch a new paid vision request", async () => {
  const j = await submit({
    ...payload(),
    quality_reserved_micro_usd: 10000,
    quality_model: "gpt-6.1-terra",
  });
  await finishGeneration(j);
  await db.query(
    "update public.processing_jobs set created_at=now()-interval '2 days' where id=$1",
    [j.id],
  );
  const q = await qclaim();
  await qstep(j.id, q.worker, "local", { report: review });
  assert.equal(await qstep(j.id, q.worker, "dispatch"), false);
  const saved = (
    await db.query<any>(
      "select quality_state,quality_provider_started_at from public.processing_jobs where id=$1",
      [j.id],
    )
  ).rows[0];
  assert.equal(saved.quality_state, "unavailable");
  assert.equal(saved.quality_provider_started_at, null);
  assert.equal(
    (
      await db.query(
        "select * from public.usage_events where idempotency_key=$1",
        ["assessment:" + j.id],
      )
    ).rows.length,
    0,
  );
});
