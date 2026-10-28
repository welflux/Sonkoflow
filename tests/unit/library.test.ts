import { purgeDeletedImage } from "../../server/library/cleanup.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { libraryQuery } from "../../server/library/routes.js";
test("Library filters are bounded and reject arbitrary fields, invalid dates, sorts and owner injection", () => {
  assert.equal(libraryQuery.parse({}).offset, 0);
  assert.equal(libraryQuery.parse({ trash: "1" }).trash, true);
  for (const value of [
    { offset: -1 },
    { sort: "sql" },
    { after: "yesterday" },
    { user_id: "foreign" },
    { search: "a".repeat(151) },
  ])
    assert.throws(() => libraryQuery.parse(value));
});

test("Expired-image cleanup retains database references on storage failure and retries the existing completion RPC safely", async () => {
  let fail = true,
    completed = 0;
  const admin: any = {
    storage: {
      from: () => ({ remove: async () => ({ error: fail ? {} : null }) }),
    },
    rpc: async () => {
      completed++;
      return { error: null };
    },
  };
  const image = {
    id: "test-image",
    user_id: "owner",
    object_key: "private-key",
    status: "deleting",
  };
  assert.equal(await purgeDeletedImage(admin, image), false);
  assert.equal(completed, 0);
  fail = false;
  assert.equal(await purgeDeletedImage(admin, image), true);
  assert.equal(completed, 1);
  assert.equal(
    await purgeDeletedImage(admin, { ...image, status: "ready" }),
    false,
  );
  assert.equal(completed, 1);
});
