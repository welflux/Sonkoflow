import { purgeDeletedImage } from "./library/cleanup.js";
import { loadConfig } from "./config.js";
import { services, databaseError } from "./services.js";
const config = loadConfig();
if (!config) throw new Error("Configure services before maintenance.");
const { admin } = services(config);
// Only process old interrupted/deleting records. Valid ready photographs are retained.
const expiry = await admin.rpc("expire_library_trash");
if (
  expiry.error &&
  expiry.error.code !== "PGRST202" &&
  expiry.error.code !== "42883"
)
  databaseError(expiry.error);
const cutoff = new Date(Date.now() - 86400000).toISOString();
const stale = await admin
  .from("images")
  .select("id,user_id,object_key,status")
  .in("status", ["pending", "deleting"])
  .lt("created_at", cutoff)
  .limit(100);
databaseError(stale.error);
let reconciled = 0;
for (const image of stale.data ?? []) {
  if (image.status === "deleting") {
    if (await purgeDeletedImage(admin, image)) reconciled++;
    continue;
  }
  const object = await admin.storage.from("photos").remove([image.object_key]);
  if (object.error) continue;
  const result = await admin
    .from("images")
    .delete()
    .eq("id", image.id)
    .eq("user_id", image.user_id)
    .eq("status", "pending");
  if (!result.error) reconciled++;
}

databaseError(
  (
    await admin
      .from("app_sessions")
      .delete()
      .lt("expires_at", new Date().toISOString())
  ).error,
);
databaseError(
  (await admin.from("rate_limits").delete().lt("reset_at", cutoff)).error,
);
console.log(JSON.stringify({ event: "maintenance_complete", reconciled }));
