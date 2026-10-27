import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
// Minimal auth/storage schema fixtures allow the real PostgreSQL migration and RLS
// to execute locally. They do not emulate Supabase HTTP, auth delivery, or object storage.
const db = new PGlite();
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const pa = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const pb = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const image = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
before(async () => {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth,storage to anon,authenticated,service_role;grant execute on function auth.uid() to authenticated;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant select on storage.objects to authenticated;`,
  );
  await db.exec(
    await readFile("supabase/migrations/202610270001_foundation.sql", "utf8"),
  );
  await db.query("insert into auth.users(id) values($1),($2)", [alice, bob]);
  await db.query(
    `insert into public.projects(id,user_id,name,audience) values($1,$2,'Alice project','ecommerce'),($3,$4,'Bob project','individual')`,
    [pa, alice, pb, bob],
  );
});
after(async () => {
  await db.close();
});
async function asUser(user: string, operation: () => Promise<void>) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try {
    await operation();
  } finally {
    await db.exec("reset role");
  }
}
async function insertImage(id = image, user = alice, project = pa) {
  await db.query(
    `insert into public.images(id,user_id,project_id,role,object_key,filename,media_type,byte_size,width,height,checksum) values($1,$2,$3,'original',$4,'photo.webp','image/webp',1000,128,128,$5)`,
    [id, user, project, `${user}/${id}.webp`, "a".repeat(64)],
  );
}
test("migration creates profiles automatically and enforces per-user read/update/insert isolation", async () => {
  await asUser(alice, async () => {
    const profiles = await db.query<{ id: string }>(
      "select id from public.profiles",
    );
    assert.deepEqual(
      profiles.rows.map((p) => p.id),
      [alice],
    );
    const projects = await db.query<{ id: string }>(
      "select id from public.projects",
    );
    assert.deepEqual(
      projects.rows.map((p) => p.id),
      [pa],
    );
    const update = await db.query(
      "update public.profiles set display_name=$1 where id=$2 returning id",
      ["Intrusion", bob],
    );
    assert.equal(update.rows.length, 0);
    await assert.rejects(
      db.query(
        "insert into public.projects(user_id,name,audience) values($1,'Intrusion','individual')",
        [bob],
      ),
    );
  });
});
test("cross-owner project/image references and malformed storage paths are rejected", async () => {
  await assert.rejects(insertImage(image, alice, pb));
  await insertImage();
  await assert.rejects(
    db.query(
      "update public.images set object_key='public/photo.webp' where id=$1",
      [image],
    ),
  );
  await assert.rejects(
    db.query(
      "update public.images set width=100000,height=100000 where id=$1",
      [image],
    ),
  );
});
test("private storage selection requires matching owner and a ready metadata record", async () => {
  await db.query(
    "insert into storage.objects(bucket_id,name) values('photos',$1)",
    [`${alice}/${image}.webp`],
  );
  await asUser(alice, async () =>
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      0,
    ),
  );
  await db.query("select public.complete_upload($1,$2)", [image, alice]);
  await asUser(alice, async () =>
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      1,
    ),
  );
  await asUser(bob, async () => {
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.images")).rows.length,
      0,
    );
  });
  assert.equal(
    (
      await db.query(
        "select * from public.usage_events where operation='upload'",
      )
    ).rows.length,
    1,
  );
  await assert.rejects(
    db.query("select public.complete_upload($1,$2)", [image, alice]),
  );
});
test("authenticated users cannot write image metadata, jobs, usage, sessions, or privileged functions", async () => {
  await asUser(alice, async () => {
    for (const table of [
      "images",
      "processing_jobs",
      "usage_events",
      "app_sessions",
      "rate_limits",
    ])
      await assert.rejects(db.query(`delete from public.${table}`));
    await assert.rejects(db.query("select * from public.app_sessions"));
    await assert.rejects(
      db.query("select public.take_rate_limit('bypass',10,60)"),
    );
    await assert.rejects(
      db.query("select public.complete_deletion($1,$2)", [image, alice]),
    );
  });
});
test("shared database rate limits enforce counters and expired windows reset", async () => {
  assert.equal(
    (
      await db.query<{ allowed: boolean }>(
        "select public.take_rate_limit('test',2,60) as allowed",
      )
    ).rows[0].allowed,
    true,
  );
  await db.exec("select public.take_rate_limit('test',2,60)");
  assert.equal(
    (
      await db.query<{ allowed: boolean }>(
        "select public.take_rate_limit('test',2,60) as allowed",
      )
    ).rows[0].allowed,
    false,
  );
  await db.exec(
    "update public.rate_limits set reset_at=now()-interval '1 minute'",
  );
  assert.equal(
    (
      await db.query<{ allowed: boolean }>(
        "select public.take_rate_limit('test',2,60) as allowed",
      )
    ).rows[0].allowed,
    true,
  );
});
test("session refresh is atomically leased; expired sessions cannot be leased", async () => {
  const sid = "f".repeat(64);
  await db.query(
    "insert into public.app_sessions(id,user_id,tokens,purpose,access_expires_at,expires_at) values($1,$2,'encrypted','account',now(),now()+interval '1 day')",
    [sid, alice],
  );
  assert.equal(
    (
      await db.query<{ ok: boolean }>(
        "select public.claim_session_refresh($1,$2) as ok",
        [sid, "lock-a"],
      )
    ).rows[0].ok,
    true,
  );
  assert.equal(
    (
      await db.query<{ ok: boolean }>(
        "select public.claim_session_refresh($1,$2) as ok",
        [sid, "lock-b"],
      )
    ).rows[0].ok,
    false,
  );
  await db.query(
    "update public.app_sessions set expires_at=now()-interval '1 minute',refresh_until=null where id=$1",
    [sid],
  );
  assert.equal(
    (
      await db.query<{ ok: boolean }>(
        "select public.claim_session_refresh($1,$2) as ok",
        [sid, "lock-c"],
      )
    ).rows[0].ok,
    false,
  );
});
test("deletion accounting is idempotent and foreign references protect nonempty projects", async () => {
  await assert.rejects(
    db.query("delete from public.projects where id=$1", [pa]),
  );
  await db.query("update public.images set status='deleting' where id=$1", [
    image,
  ]);
  await db.query("select public.complete_deletion($1,$2)", [image, alice]);
  await db.query("select public.complete_deletion($1,$2)", [image, alice]);
  assert.equal(
    (
      await db.query(
        "select * from public.usage_events where operation='delete'",
      )
    ).rows.length,
    1,
  );
});
test("project and image quotas are enforced in the database, including pending images", async () => {
  await db.exec("begin");
  try {
    await db.query(
      `insert into public.projects(user_id,name,audience) select $1,'Quota '||n,'individual' from generate_series(1,99) n`,
      [bob],
    );
    await assert.rejects(
      db.query(
        "insert into public.projects(user_id,name,audience) values($1,'Over quota','individual')",
        [bob],
      ),
    );
  } finally {
    await db.exec("rollback");
  }
  await db.exec("begin");
  try {
    await db.query(
      `insert into public.images(id,user_id,project_id,role,object_key,filename,media_type,byte_size,width,height,checksum) select id,$1::uuid,$2::uuid,'original',($1::uuid)::text||'/'||id::text||'.webp','quota.webp','image/webp',100,64,64,$3 from (select gen_random_uuid() as id from generate_series(1,100)) t`,
      [bob, pb, "b".repeat(64)],
    );
    await assert.rejects(
      insertImage("dddddddd-dddd-4ddd-8ddd-dddddddddddd", bob, pb),
    );
  } finally {
    await db.exec("rollback");
  }
});
