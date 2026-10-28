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
  await db.exec(
    await readFile(
      "supabase/migrations/202610280003_product_packs.sql",
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
const packLimits = {
  max_outputs: 5,
  daily: 3,
  active: 1,
  initial_credits: 1000,
  unit_micro_usd: 10000,
};
const packBudget = {
  ...limits,
  user_daily: 15,
  global_daily: 30,
  user_budget: 20e6,
  global_budget: 30e6,
};
function packPayload(types = ["listing"], vision = false) {
  const p = {
    user_id: owner,
    project_id: project,
    input_image_id: source,
    submission_key: randomUUID(),
    request_fingerprint: "d".repeat(64),
    configuration: {
      outputs: types.map((type) => ({ type, quality: "high" })),
    },
    plan: {},
  };
  const jobs = types.map((type) => ({
    ...payload(),
    pack_output_type: type,
    settings: {
      ...payload().settings,
      pack_context: {
        type,
        scene: "Neutral room",
        detail_focus: "Visible print",
      },
    },
    pack_credit_plan: {
      unit_micro_usd: 10000,
      generation_credits: 100,
      assessment_credits: vision ? 10 : 0,
      estimated_credits: 20,
    },
    reserved_micro_usd: vision ? 1100000 : 1000000,
    quality_reserved_micro_usd: vision ? 100000 : 0,
    quality_model: vision ? "gpt-6.1-terra" : null,
  }));
  return { p, jobs };
}
async function createPack(input = packPayload(), pl = packLimits) {
  return (
    await db.query<any>(
      "select public.create_product_pack($1,$2,$3,$4) as pack",
      [
        JSON.stringify(input.p),
        JSON.stringify(input.jobs),
        JSON.stringify(packBudget),
        JSON.stringify(pl),
      ],
    )
  ).rows[0].pack;
}
async function account() {
  return (
    await db.query<any>(
      "select * from public.pack_credit_accounts where user_id=$1",
      [owner],
    )
  ).rows[0];
}
async function finish(j: any, cost = 50000) {
  const c = await claim();
  assert.equal(c.job.id, j.id);
  await step(j.id, c.worker, "dispatch");
  await step(j.id, c.worker, "response", {
    cost,
    usage: { input_tokens: 100 },
    request_id: "req-test",
  });
  await step(j.id, c.worker, "prepare", {
    filename: "result.webp",
    byte_size: 1000,
    width: 1024,
    height: 1024,
    checksum: "b".repeat(64),
  });
  await step(j.id, c.worker, "complete");
  return c;
}
async function jobsFor(pack: any) {
  return (
    await db.query<any>(
      "select * from public.processing_jobs where pack_id=$1 order by created_at,id",
      [pack.id],
    )
  ).rows;
}
test("all five outputs are independent durable jobs using one original and the existing serial worker", async () => {
  const pack = await createPack(
    packPayload(["listing", "lifestyle", "detail", "social", "wide"]),
  );
  const jobs = await jobsFor(pack);
  assert.equal(jobs.length, 5);
  assert(
    jobs.every((j) => j.input_image_id === source && j.status === "queued"),
  );
  assert.equal((await account()).reserved_credits, 500);
  const first = await claim();
  assert.equal((await claim()).job, null);
  await step(first.job.id, first.worker, "dispatch");
  await step(first.job.id, first.worker, "fail", {
    code: "provider_credentials",
    safe: true,
    uncertain: false,
  });
  const next = await claim();
  assert(next.job && next.job.id !== first.job.id);
  const saved = await jobsFor(pack);
  assert.equal(saved.filter((j) => j.status === "failed").length, 1);
  assert.equal(saved.filter((j) => j.status === "queued").length, 3);
  assert.equal((await account()).balance_credits, 1000);
  assert.equal((await account()).reserved_credits, 400);
});
test("duplicate pack creation reserves once, conflicting reuse is denied and partial admission rolls back", async () => {
  const input = packPayload(["listing", "social"]);
  await expectFailure(
    () => createPack(input, { ...packLimits, max_outputs: 1 }),
    /pack_limit/,
  );
  const pack = await createPack(input);
  assert.equal((await createPack(input)).id, pack.id);
  assert.equal((await account()).reserved_credits, 200);
  assert.equal((await jobsFor(pack)).length, 2);
  await expectFailure(
    () =>
      createPack({
        ...input,
        p: { ...input.p, request_fingerprint: "e".repeat(64) },
      }),
    /submission_conflict/,
  );
});
test("insufficient allowance prevents every output atomically without a debit or orphan pack", async () => {
  await db.query("select public.ensure_pack_account($1,250,10000)", [owner]);
  await expectFailure(
    () => createPack(packPayload(["listing", "social", "wide"])),
    /insufficient_credits/,
  );
  assert.equal(
    (await db.query("select * from public.product_packs")).rows.length,
    0,
  );
  assert.equal(
    (await db.query("select * from public.processing_jobs")).rows.length,
    0,
  );
  assert.equal((await account()).balance_credits, 250);
  assert.equal((await account()).reserved_credits, 0);
  assert.equal(
    (
      await db.query(
        "select * from public.usage_events where credit_event<>'grant'",
      )
    ).rows.length,
    0,
  );
});
test("known generation and assessment usage reconcile independently and duplicate responses cannot double debit", async () => {
  const pack = await createPack(packPayload(["listing"], true)),
    j = (await jobsFor(pack))[0];
  await finish(j);
  assert.equal((await account()).balance_credits, 995);
  assert.equal((await account()).reserved_credits, 10);
  const worker = randomUUID();
  await db.query("select public.claim_product_assessment($1)", [worker]);
  await db.query("select public.product_assessment_step($1,$2,'dispatch')", [
    j.id,
    worker,
  ]);
  const p = {
    usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
    cost: 20000,
    request_id: "req-quality",
  };
  for (let i = 0; i < 2; i++)
    await db.query(
      "select public.product_assessment_step($1,$2,'response',$3)",
      [j.id, worker, JSON.stringify(p)],
    );
  assert.equal((await account()).balance_credits, 993);
  assert.equal((await account()).reserved_credits, 0);
  assert.equal(
    (
      await db.query(
        "select * from public.usage_events where job_id=$1 and credit_event='settled'",
        [j.id],
      )
    ).rows.length,
    2,
  );
});
test("queued cancellation and pre-provider storage failures release holds without charging", async () => {
  const pack = await createPack(packPayload(["listing", "social"])),
    jobs = await jobsFor(pack);
  await db.query("select public.cancel_processing_job($1,$2)", [
    jobs[0].id,
    owner,
  ]);
  const c = await claim();
  await step(c.job.id, c.worker, "fail", {
    code: "source_unavailable",
    safe: true,
    uncertain: false,
  });
  assert.equal((await account()).balance_credits, 1000);
  assert.equal((await account()).reserved_credits, 0);
  assert.equal(
    (
      await db.query(
        "select * from public.usage_events where credit_event='settled'",
      )
    ).rows.length,
    0,
  );
});
test("safe provider retry re-reserves a new attempt once; uncertain dispatch retains unresolved allowance", async () => {
  const pack = await createPack(),
    j = (await jobsFor(pack))[0];
  const c = await claim();
  await step(j.id, c.worker, "dispatch");
  await step(j.id, c.worker, "fail", {
    code: "provider_billing",
    safe: true,
    uncertain: false,
  });
  assert.equal((await account()).reserved_credits, 0);
  assert.equal(
    (
      await db.query<any>("select public.retry_processing_job($1,$2) as ok", [
        j.id,
        owner,
      ])
    ).rows[0].ok,
    true,
  );
  assert.equal(
    (
      await db.query<any>("select public.retry_processing_job($1,$2) as ok", [
        j.id,
        owner,
      ])
    ).rows[0].ok,
    false,
  );
  assert.equal((await account()).reserved_credits, 100);
  const again = await claim();
  assert.equal(again.job.attempts, 2);
  await step(j.id, again.worker, "dispatch");
  await step(j.id, again.worker, "fail", {
    code: "provider_interrupted",
    safe: false,
    uncertain: true,
  });
  assert.equal((await account()).reserved_credits, 100);
  assert.equal((await account()).balance_credits, 1000);
  await db.query(
    "select public.reconcile_pack_credit($1,'generation',2,60000)",
    [j.id],
  );
  await db.query(
    "select public.reconcile_pack_credit($1,'generation',2,60000)",
    [j.id],
  );
  assert.equal((await account()).reserved_credits, 0);
  assert.equal((await account()).balance_credits, 994);
});
test("actual usage above a reservation is recorded rather than silently made free", async () => {
  const pack = await createPack(packPayload(), {
      ...packLimits,
      initial_credits: 200,
    }),
    j = (await jobsFor(pack))[0];
  await finish(j, 3000000);
  assert.equal((await account()).balance_credits, -100);
  assert.equal((await account()).reserved_credits, 0);
  await expectFailure(
    () => createPack(packPayload(["wide"]), { ...packLimits, active: 2 }),
    /insufficient_credits/,
  );
});
test("administrator grants are idempotent and clients cannot mutate allowances or private pack data", async () => {
  const key = randomUUID();
  for (let i = 0; i < 2; i++)
    await db.query("select public.grant_pack_credits($1,100,$2,10000)", [
      owner,
      key,
    ]);
  assert.equal((await account()).balance_credits, 100);
  await expectFailure(
    () =>
      db.query("select public.grant_pack_credits($1,200,$2,10000)", [
        owner,
        key,
      ]),
    /submission_conflict/,
  );
  const pack = await createPack();
  await db.exec("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [other]);
  assert.equal(
    (await db.query("select * from public.product_packs")).rows.length,
    0,
  );
  assert.equal(
    (await db.query("select * from public.pack_credit_accounts")).rows.length,
    0,
  );
  assert.equal(
    (await db.query("select * from public.pack_credit_reservations")).rows
      .length,
    0,
  );
  await expectFailure(
    () =>
      db.query("update public.pack_credit_accounts set balance_credits=99999"),
    /permission denied/,
  );
  await expectFailure(
    () =>
      db.query("select public.grant_pack_credits($1,100,$2,10000)", [
        other,
        randomUUID(),
      ]),
    /permission denied/,
  );
  await expectFailure(
    () =>
      db.query("select public.create_product_pack($1,$2,$3,$4)", [
        JSON.stringify(packPayload().p),
        "[]",
        JSON.stringify(packBudget),
        JSON.stringify(packLimits),
      ]),
    /permission denied/,
  );
  await db.exec("reset role");
});
test("a controlled quality retry inherits its pack and reserves separately without duplicating the parent charge", async () => {
  const pack = await createPack(),
    root = (await jobsFor(pack))[0];
  await finish(root);
  const worker = randomUUID();
  await db.query("select public.claim_product_assessment($1)", [worker]);
  const report = {
    checks: [{ id: "labels_details", status: "needs_review" }],
    status: "needs_review",
  };
  await db.query("select public.product_assessment_step($1,$2,'complete',$3)", [
    root.id,
    worker,
    JSON.stringify({ report }),
  ]);
  const p = {
    ...payload(),
    settings: root.settings,
    instructions: root.instructions,
    quality_parent_id: root.id,
    quality_retry_targets: ["labels_details"],
    quality_retry_instructions: "Retain the printed label.",
    pack_credit_plan: root.pack_credit_plan,
  };
  const child = await submit(p, packBudget);
  assert.equal(child.pack_id, pack.id);
  assert.equal(child.pack_output_type, "listing");
  assert.equal(child.input_image_id, source);
  assert.equal(child.quality_retry_number, 1);
  assert.equal((await account()).reserved_credits, 100);
  assert.equal((await account()).balance_credits, 995);
  assert.equal((await submit(p, packBudget)).id, child.id);
  assert.equal((await account()).reserved_credits, 100);
});
test("expired queued outputs release their holds without a provider dispatch and manual reconciliation cannot charge queued work", async () => {
  const pack = await createPack(),
    j = (await jobsFor(pack))[0];
  await expectFailure(
    () =>
      db.query("select public.reconcile_pack_credit($1,'generation',1,10000)", [
        j.id,
      ]),
    /pack_credit_required/,
  );
  await db.query(
    "update public.processing_jobs set created_at=now()-interval '2 days' where id=$1",
    [j.id],
  );
  assert.equal((await claim()).job, null);
  assert.equal((await account()).reserved_credits, 0);
  assert.equal((await account()).balance_credits, 1000);
});
test("legacy personal, portrait and product jobs do not acquire a pack wallet or change their source flow", async () => {
  for (const mode of ["personal", "portrait", "product"]) {
    const j = await submit({ ...payload(), mode }, packBudget);
    await finish(j);
  }
  assert.equal(
    (await db.query("select * from public.pack_credit_accounts")).rows.length,
    0,
  );
  assert.equal(
    (await db.query("select * from public.product_packs")).rows.length,
    0,
  );
  assert.equal(
    (await db.query("select * from public.pack_credit_reservations")).rows
      .length,
    0,
  );
});
test("cancelling or expiring a requeued safe retry releases its next-attempt holds, not the previous attempt", async () => {
  for (const action of ["cancel", "expire"]) {
    const pack = await createPack(packPayload(["listing"], true)),
      j = (await jobsFor(pack))[0];
    const c = await claim();
    await step(j.id, c.worker, "dispatch");
    await step(j.id, c.worker, "fail", {
      code: "provider_credentials",
      safe: true,
      uncertain: false,
    });
    await db.query("select public.retry_processing_job($1,$2)", [j.id, owner]);
    assert.equal((await account()).reserved_credits, 110);
    if (action === "cancel")
      await db.query("select public.cancel_processing_job($1,$2)", [
        j.id,
        owner,
      ]);
    else {
      await db.query(
        "update public.processing_jobs set created_at=now()-interval '2 days' where id=$1",
        [j.id],
      );
      assert.equal((await claim()).job, null);
    }
    assert.equal((await account()).reserved_credits, 0);
    assert.equal((await account()).balance_credits, 1000);
    const rows = (
      await db.query<any>(
        "select * from public.pack_credit_reservations where job_id=$1 and attempt=2",
        [j.id],
      )
    ).rows;
    assert.equal(rows.length, 2);
    assert(
      rows.every((r) => r.state === "released" && r.dispatched_at === null),
    );
  }
});
test("pack history with sibling retry versions remains valid during isolated test-account cleanup", async () => {
  const pack = await createPack(),
    root = (await jobsFor(pack))[0];
  async function completeReview(j: any) {
    await finish(j);
    const worker = randomUUID();
    await db.query("select public.claim_product_assessment($1)", [worker]);
    await db.query(
      "select public.product_assessment_step($1,$2,'complete',$3)",
      [
        j.id,
        worker,
        JSON.stringify({
          report: {
            status: "needs_review",
            checks: [{ id: "labels_details", status: "needs_review" }],
          },
        }),
      ],
    );
  }
  await completeReview(root);
  for (let n = 1; n <= 2; n++) {
    const p = {
      ...payload(),
      settings: root.settings,
      instructions: root.instructions,
      quality_parent_id: root.id,
      quality_retry_targets: ["labels_details"],
      quality_retry_instructions: "Retain print.",
      pack_credit_plan: root.pack_credit_plan,
    };
    const j = await submit(p, packBudget);
    assert.equal(j.quality_retry_number, n);
    await completeReview(j);
  }
  await db.query("delete from auth.users where id=$1", [owner]);
  assert.equal(
    (
      await db.query("select * from public.processing_jobs where user_id=$1", [
        owner,
      ])
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query("select * from public.product_packs where user_id=$1", [
        owner,
      ])
    ).rows.length,
    0,
  );
});
