import type { SupabaseClient } from "@supabase/supabase-js";
// Caller supplies an expired record already marked deleting. Never remove DB
// references ahead of successful private storage removal; retries are idempotent.
export async function purgeDeletedImage(
  admin: SupabaseClient,
  image: { id: string; user_id: string; object_key: string; status: string },
) {
  if (image.status !== "deleting") return false;
  try {
    const object = await admin.storage
      .from("photos")
      .remove([image.object_key]);
    if (object.error) return false;
    const result = await admin.rpc("complete_deletion", {
      image_id: image.id,
      owner_id: image.user_id,
    });
    return !result.error;
  } catch {
    return false;
  }
}
