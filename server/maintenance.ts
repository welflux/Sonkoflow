import { loadConfig } from "./config.js";
import { services, databaseError } from "./services.js";
const config = loadConfig();
if (!config) throw new Error("Configure services before maintenance.");
const { admin } = services(config);
// Only process old interrupted/deleting records. Valid ready photographs are retained.
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
  const object = await admin.storage.from("photos").remove([image.object_key]);
  if (object.error) continue;
  const result =
    image.status === "deleting"
      ? await admin.rpc("complete_deletion", {
          image_id: image.id,
          owner_id: image.user_id,
        })
      : await admin
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
