import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {trialSlotId} from '../../server/processing/claid-trial.js';
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
test("owner trial slots are durable unique reservations and use existing output checkpoints without invented dollar cost",async()=>{
 const worker=randomUUID(),result=randomUUID(),id=trialSlotId(owner,0);
 const insert=()=>db.query("insert into public.processing_jobs(id,user_id,project_id,input_image_id,submission_key,status,mode,lease_owner,provider_started_at,result_image_id,reserved_micro_usd) values($1,$2,$3,$4,$5,'running','personal',$6,now(),$7,0)",[id,owner,project,source,randomUUID(),worker,result]);
 await insert();await expectFailure(insert,/duplicate key/);
 await db.query("insert into public.usage_events(user_id,job_id,operation,units,idempotency_key,cost_basis) values($1,$2,'processing',0,$3,'free_trial_api_credits_unknown')",[owner,id,`processing:${id}`]);
 assert(await step(id,worker,'response',{request_id:'trial-test-only',usage:{provider:'claid',reserved_api_credits:3,actual_api_credits:null},cost:null}));
 const metadata={filename:'trial.webp',checksum:'b'.repeat(64),width:128,height:128,byte_size:1000};
 assert(await step(id,worker,'prepare',metadata));assert(await step(id,worker,'prepare',metadata));
 assert(await step(id,worker,'complete'));
 const j=(await db.query<any>('select * from public.processing_jobs where id=$1',[id])).rows[0];
 assert.equal(j.status,'completed');assert.equal(j.cost_estimate_micro_usd,null);assert.equal(Number(j.reserved_micro_usd),0);
 const i=(await db.query<any>('select * from public.images where id=$1',[result])).rows[0];assert.equal(i.status,'ready');assert.equal(i.role,'generated');
 assert.notEqual(result,source);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);await db.exec('set role authenticated');
 assert.equal((await db.query('select id from public.images where id=$1',[result])).rows.length,0);
 await expectFailure(()=>db.query('delete from public.processing_jobs where id=$1',[id]),/permission denied/);
});
test("processing submission is idempotent and mismatched reuse is rejected", async () => {
  const p = payload();
  const a = await submit(p);
  assert.equal((await submit(p)).id, a.id);
  await expectFailure(
    () => submit({ ...p, request_fingerprint: "b".repeat(64) }),
    /submission_conflict/,
  );
  assert.equal(
    (await db.query("select * from public.processing_jobs")).rows.length,
    1,
  );
});
test("foreign references and authenticated privileged calls are denied; history remains isolated by RLS", async () => {
  await expectFailure(
    () => submit({ ...payload(), user_id: other }),
    /source_not_found/,
  );
  await submit();
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    other,
  ]);
  await db.exec("set role authenticated");
  assert.equal(
    (await db.query("select * from public.processing_jobs")).rows.length,
    0,
  );
  await expectFailure(
    () => db.query("select public.submit_processing_job('{}','{}')"),
    /permission denied/,
  );
});
test("active limits, daily limits and shared budget reservations are enforced in SQL", async () => {
  const j = await submit();
  await expectFailure(() => submit(), /active_limit/);
  await db.query("select public.cancel_processing_job($1,$2)", [j.id, owner]);
  await expectFailure(
    () => submit(payload(), { ...limits, user_budget: 1e6 }),
    /budget_limit/,
  );
  await expectFailure(
    () => submit(payload(), { ...limits, global_daily: 1 }),
    /daily_limit/,
  );
});
test("worker claims are exclusive and dispatch cannot be repeated or stolen", async () => {
  await submit();
  const a = await claim();
  assert(a.job);
  assert.equal((await claim()).job, null);
  assert.equal(await step(a.job.id, randomUUID(), "dispatch"), false);
  assert.equal(await step(a.job.id, a.worker, "dispatch"), true);
  assert.equal(await step(a.job.id, a.worker, "dispatch"), false);
  await expectFailure(
    () =>
      db.query("update public.images set status='deleting' where id=$1", [
        source,
      ]),
    /processing_image_busy/,
  );
});
test("expired undispatched work is recoverable; dispatched work becomes uncertain and is not replayed", async () => {
  await submit();
  const a = await claim();
  await db.query(
    "update public.processing_jobs set lease_until=now()-interval '1 minute' where id=$1",
    [a.job.id],
  );
  const b = await claim();
  assert.equal(b.job.id, a.job.id);
  assert.equal(b.job.attempts, 2);
  await step(b.job.id, b.worker, "dispatch");
  await db.query(
    "update public.processing_jobs set lease_until=now()-interval '1 minute' where id=$1",
    [b.job.id],
  );
  assert.equal((await claim()).job, null);
  assert.equal(
    (await db.query<any>("select status from public.processing_jobs")).rows[0]
      .status,
    "uncertain",
  );
  await expectFailure(() => submit(), /uncertain_acknowledgement_required/);
});
test("provider usage is recorded before storage and completion is atomic and idempotent", async () => {
  await submit();
  const { worker, job } = await claim();
  assert.equal(await step(job.id, worker, "complete"), false);
  await step(job.id, worker, "dispatch");
  await step(job.id, worker, "response", {
    usage: { input_tokens: 50, output_tokens: 100 },
    request_id: "req-test",
    cost: 1234,
  });
  const ledger = (
    await db.query<any>(
      "select * from public.usage_events where operation='processing'",
    )
  ).rows[0];
  assert.equal(ledger.units, 1);
  assert.equal(ledger.cost_estimate_micro_usd, 1234);
  await step(job.id, worker, "prepare", {
    filename: "output.webp",
    byte_size: 2000,
    width: 1024,
    height: 1024,
    checksum: "b".repeat(64),
  });
  assert.equal(
    (
      await db.query<any>("select status from public.images where id=$1", [
        job.result_image_id,
      ])
    ).rows[0].status,
    "pending",
  );
  assert.equal(await step(job.id, worker, "complete"), true);
  assert.equal(await step(job.id, worker, "complete"), true);
  assert.equal(
    (await db.query<any>("select status from public.processing_jobs")).rows[0]
      .status,
    "completed",
  );
  assert.equal(
    (
      await db.query(
        "select * from public.usage_events where operation='processing'",
      )
    ).rows.length,
    1,
  );
});
test("safe retries are bounded and uncertain/billable failures cannot use the retry operation", async () => {
  await submit();
  let c = await claim();
  await step(c.job.id, c.worker, "fail", {
    code: "source_unavailable",
    safe: true,
    uncertain: false,
  });
  assert.equal(
    (
      await db.query<any>("select public.retry_processing_job($1,$2) as ok", [
        c.job.id,
        owner,
      ])
    ).rows[0].ok,
    true,
  );
  c = await claim();
  await step(c.job.id, c.worker, "dispatch");
  await step(c.job.id, c.worker, "fail", {
    code: "provider_interrupted",
    safe: false,
    uncertain: true,
  });
  assert.equal(
    (
      await db.query<any>("select public.retry_processing_job($1,$2) as ok", [
        c.job.id,
        owner,
      ])
    ).rows[0].ok,
    false,
  );
});
test("deleting completed images and an empty project retains spend history and budget reservations", async () => {
  await submit();
  const { worker, job } = await claim();
  await step(job.id, worker, "dispatch");
  await step(job.id, worker, "response", {
    usage: null,
    request_id: "req-x",
    cost: null,
  });
  await step(job.id, worker, "prepare", {
    filename: "result.webp",
    byte_size: 1000,
    width: 1024,
    height: 1024,
    checksum: "b".repeat(64),
  });
  await step(job.id, worker, "complete");
  await db.query("delete from public.images where user_id=$1", [owner]);
  await db.query("delete from public.projects where id=$1", [project]);
  const saved = (await db.query<any>("select * from public.processing_jobs"))
    .rows[0];
  assert.equal(saved.input_image_id, null);
  assert.equal(saved.output_image_id, null);
  assert.equal(saved.project_id, null);
  assert.equal(saved.reserved_micro_usd, 1e6);
  assert.equal(
    (
      await db.query(
        "select * from public.usage_events where operation='processing'",
      )
    ).rows.length,
    1,
  );
});

test("output reservations protect slots from concurrent normal uploads and result identifiers cannot be stolen", async () => {
  const j = await submit();
  await expectFailure(
    () =>
      db.query(
        "insert into public.images(id,user_id,project_id,role,object_key,filename,media_type,byte_size,width,height,checksum) values($1,$2,$3,'original',$4,'reserved.webp','image/webp',1000,128,128,$5)",
        [
          j.result_image_id,
          owner,
          project,
          `${owner}/${j.result_image_id}.webp`,
          "a".repeat(64),
        ],
      ),
    /Reserved result identifier/,
  );
  // Existing images plus reserved output bytes must stay below the account quota.
  await db.query("update public.images set byte_size=10485760 where id=$1", [
    source,
  ]);
  assert((await db.query("select id from public.images")).rows.length === 1);
});
test("prepared metadata is retryable and bounded storage recovery never requeues a generation", async () => {
  await submit();
  const c = await claim();
  await step(c.job.id, c.worker, "dispatch");
  await step(c.job.id, c.worker, "response", { usage: null, cost: null });
  const metadata = {
    filename: "output.webp",
    byte_size: 1000,
    width: 1024,
    height: 1024,
    checksum: "b".repeat(64),
  };
  assert(await step(c.job.id, c.worker, "prepare", metadata));
  assert(await step(c.job.id, c.worker, "prepare", metadata));
  assert.equal((await db.query("select id from public.images")).rows.length, 2);
  for (let i = 0; i < 5; i++) {
    await db.query(
      "update public.processing_jobs set lease_until=now()-interval '1 minute' where id=$1",
      [c.job.id],
    );
    const recovered = await claim();
    assert.equal(recovered.job.status, "persisting");
    assert.equal(recovered.job.attempts, 1);
    assert.equal(recovered.job.storage_attempts, i + 1);
  }
  await db.query(
    "update public.processing_jobs set lease_until=now()-interval '1 minute' where id=$1",
    [c.job.id],
  );
  assert.equal((await claim()).job, null);
  const saved = (
    await db.query<any>("select status,error_code from public.processing_jobs")
  ).rows[0];
  assert.equal(saved.status, "failed");
  assert.equal(saved.error_code, "result_unavailable");
});

test("normal uploads cannot consume the generated-output slot reserved by an active job", async () => {
  const j = await submit();
  await db.query(
    `insert into public.images(id,user_id,project_id,role,object_key,filename,media_type,byte_size,width,height,checksum,status)
 select id,$1::uuid,$2::uuid,'original',($1::uuid)::text||'/'||id::text||'.webp','extra.webp','image/webp',1000,128,128,$3,'ready'
 from (select gen_random_uuid() id from generate_series(1,98)) t`,
    [owner, project, "a".repeat(64)],
  );
  const extra = randomUUID();
  await expectFailure(
    () =>
      db.query(
        "insert into public.images(id,user_id,project_id,role,object_key,filename,media_type,byte_size,width,height,checksum) values($1,$2,$3,'original',$4,'blocked.webp','image/webp',1000,128,128,$5)",
        [extra, owner, project, `${owner}/${extra}.webp`, "a".repeat(64)],
      ),
    /Image quota exceeded/,
  );
  const c = await claim();
  await step(j.id, c.worker, "dispatch");
  await step(j.id, c.worker, "response", { usage: null, cost: null });
  assert(
    await step(j.id, c.worker, "prepare", {
      filename: "result.webp",
      byte_size: 1000,
      width: 1024,
      height: 1024,
      checksum: "b".repeat(64),
    }),
  );
  assert.equal(
    (await db.query("select id from public.images")).rows.length,
    100,
  );
});

test('dedicated-engine metadata and native dimensions use the existing idempotent job and retained unknown-cost ledger', async () => {
  const p:any=payload();
  p.model='topaz:Upscale High Fidelity V3';p.output_size='2048x1366';p.instructions='';
  p.settings={background:'preserve',framing:'match',preserve_appearance:true,processing:{experience:'authentic',engine:'topaz',operation:'upscale',scale:2,consented_engine:'topaz'},engine_route:{provider:'topaz',operation:'upscale',size:p.output_size,version:'multi-engine-v1'}};
  p.price_snapshot={provider:'topaz',version:'contract-test-rate',basis:'configured_provider_rate_estimate'};
  const job=await submit(p);assert.equal((await submit(p)).id,job.id);assert.equal(job.output_size,'2048x1366');assert.equal(job.settings.engine_route.provider,'topaz');assert.equal(job.price_snapshot.provider,'topaz');
  const {worker}=await claim();assert(await step(job.id,worker,'dispatch'));
  assert(await step(job.id,worker,'response',{usage:{provider:'topaz',remote_job_id:'contract-only',actual_cost_micro_usd:null},request_id:'contract-only',cost:null}));
  assert(await step(job.id,worker,'fail',{code:'provider_interrupted',safe:false,uncertain:true}));
  const event=(await db.query<any>("select * from public.usage_events where job_id=$1 and operation='processing'",[job.id])).rows[0];assert.equal(event.provider_usage.provider,'topaz');assert.equal(event.cost_estimate_micro_usd,null);assert.equal(event.model,'topaz:Upscale High Fidelity V3');
  const saved=(await db.query<any>('select * from public.processing_jobs where id=$1',[job.id])).rows[0];assert.equal(saved.status,'uncertain');assert.equal(saved.reserved_micro_usd,1e6);assert.equal(saved.safe_to_retry,false);
  assert.equal((await db.query<any>('select role from public.images where id=$1',[source])).rows[0].role,'original');
});
