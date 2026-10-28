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
async function fixture() {
  const project = randomUUID(),
    target = randomUUID(),
    image = randomUUID();
  for (const [id, name] of [
    [project, "Summer collection"],
    [target, "Winter collection"],
  ])
    await db.query(
      "insert into public.projects(id,user_id,name,audience) values($1,$2,$3,'ecommerce')",
      [id, owner, name],
    );
  await db.query(
    "insert into public.images(id,user_id,project_id,role,object_key,filename,media_type,byte_size,width,height,checksum,status) values($1,$2,$3,'original',$4,'linen.webp','image/webp',1000,128,128,$5,'ready')",
    [image, owner, project, `${owner}/${image}.webp`, "a".repeat(64)],
  );
  return { project, target, image };
}
async function query(p: any = {}, user = owner) {
  return (
    await db.query<any>("select public.library_query($1,$2) as result", [
      user,
      JSON.stringify(p),
    ])
  ).rows[0].result;
}
async function action(
  ids: string[],
  kind: string,
  value: string | null = null,
  user = owner,
) {
  return db.query("select public.library_action($1,$2,$3,$4)", [
    user,
    ids,
    kind,
    value,
  ]);
}
async function failure(fn: () => Promise<any>, pattern: RegExp) {
  await db.exec("savepoint invalid");
  let error: any;
  try {
    await fn();
  } catch (e) {
    error = e;
  }
  await db.exec("rollback to savepoint invalid;release savepoint invalid");
  assert.match(error?.message ?? "", pattern);
}
test("Library search, project filters, rename and folder moves reuse one original without rewriting its execution context", async () => {
  const f = await fixture();
  assert.equal((await query({ search: "SUMMER" })).images.length, 1);
  assert.equal((await query({ search: "linen" })).images.length, 1);
  assert.equal((await query({ search: "%" })).images.length, 0);
  await action([f.image], "rename", "Autumn.webp");
  await action([f.image], "move", f.target);
  const result = (await query({ project_id: f.target })).images[0];
  assert.equal(result.project_name, "Winter collection");
  assert.equal(result.project_id, f.project);
  assert.equal(result.filename, "Autumn.webp");
  assert.equal((await db.query("select * from public.images")).rows.length, 1);
  await action([f.image], "move", null);
  assert.equal((await query({ unassigned: true })).images.length, 1);
});
test("Trash is hidden by RLS and downloads, restore retains the object, expiry enters retryable cleanup without erasing usage history", async () => {
  const f = await fixture();
  await action([f.image], "trash");
  assert.equal((await query()).images.length, 0);
  assert.equal((await query({ trash: true })).images.length, 1);
  await db.exec(
    `set local role authenticated;select set_config('request.jwt.claim.sub','${owner}',true)`,
  );
  assert.equal((await db.query("select * from public.images")).rows.length, 0);
  await db.exec("reset role");
  await action([f.image], "restore");
  assert.equal((await query()).images.length, 1);
  await action([f.image], "trash");
  await db.query(
    "update public.images set trashed_at=now()-interval '31 days' where id=$1",
    [f.image],
  );
  await failure(() => action([f.image], "restore"), /library_expired/);
  await db.query("select public.expire_library_trash()");
  assert.equal(
    (
      await db.query<any>("select status from public.images where id=$1", [
        f.image,
      ])
    ).rows[0].status,
    "deleting",
  );
  assert.equal((await db.query("select * from public.images")).rows.length, 1);
});
test("Foreign account access and mixed-owner actions are denied atomically", async () => {
  const f = await fixture();
  assert.equal((await query({}, other)).images.length, 0);
  await failure(
    () => action([f.image], "trash", null, other),
    /library_not_found/,
  );
  await failure(
    () => action([f.image, randomUUID()], "trash"),
    /library_not_found/,
  );
  assert.equal((await query()).images.length, 1);
  await failure(
    () => action([f.image, f.image], "move", f.target),
    /library_invalid/,
  );
  await db.exec("set local role authenticated");
  await failure(() => query({}, owner), /permission denied/);
  await db.exec("reset role");
});
test("Project rename/archive/restore preserves images; deletion refuses source dependencies", async () => {
  const f = await fixture();
  const change = (kind: string, value: string | null = null) =>
    db.query("select public.library_project_action($1,$2,$3,$4)", [
      owner,
      f.project,
      kind,
      value,
    ]);
  await change("rename", "Archive candidates");
  await change("archive");
  assert.equal((await query()).images.length, 0);
  assert.equal((await query({ archived: true })).images.length, 1);
  await change("restore");
  assert.equal((await query()).images.length, 1);
  await failure(() => change("delete"), /project_not_empty/);
  const gone = await db.query<any>(
    "select public.library_project_action($1,$2,'delete',null) as ok",
    [owner, f.target],
  );
  assert.equal(gone.rows[0].ok, true);
});
test("Trashed originals cannot admit new processing jobs even after a stale preflight ownership check", async () => {
  const f = await fixture();
  await action([f.image], "trash");
  await failure(
    () =>
      db.query(
        "insert into public.processing_jobs(user_id,project_id,input_image_id,submission_key,mode,status)values($1,$2,$3,$4,'product','queued')",
        [owner, f.project, f.image, randomUUID()],
      ),
    /source_not_found/,
  );
});
test("Generated versions inherit the source organization independently of the original processing project", async () => {
  const f = await fixture();
  await action([f.image], "move", f.target);
  const job = randomUUID(),
    output = randomUUID();
  await db.query(
    "insert into public.processing_jobs(id,user_id,project_id,input_image_id,submission_key,mode,status,result_image_id)values($1,$2,$3,$4,$1,'product','completed',$5)",
    [job, owner, f.project, f.image, output],
  );
  await db.query(
    "insert into public.images(id,user_id,project_id,role,object_key,filename,media_type,byte_size,width,height,checksum,status)values($1,$2,$3,'generated',$4,'result.webp','image/webp',1000,128,128,$5,'ready')",
    [output, owner, f.project, `${owner}/${output}.webp`, "b".repeat(64)],
  );
  await db.query(
    "update public.processing_jobs set output_image_id=$1 where id=$2",
    [output, job],
  );
  const r = await query({ project_id: f.target });
  assert.equal(r.images.length, 2);
  assert.equal(r.images.find((i: any) => i.id === output).job_id, job);
  await action([output], "trash");
  assert.equal((await query({ project_id: f.target })).images.length, 1);
  assert.equal(
    (await db.query("select * from public.processing_jobs where id=$1", [job]))
      .rows.length,
    1,
  );
});
