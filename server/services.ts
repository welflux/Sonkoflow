import {
  createClient,
  type SupabaseClient,
  type Session,
} from "@supabase/supabase-js";
import type { Config } from "./config.js";
import { AppError, hash, opaque, seal, unseal } from "./security.js";
import { providerFetch } from "./transport.js";
export type Identity = {
  id: string;
  userId: string;
  purpose: string;
  client: SupabaseClient;
};
export function services(config: Config) {
  const options = {
    global: { fetch: providerFetch },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  };
  const admin = createClient(
    config.SUPABASE_URL,
    config.SUPABASE_SECRET_KEY,
    options,
  );
  const anonymous = () =>
    createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, options);
  const userClient = (jwt: string) =>
    createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
      ...options,
      global: {
        fetch: providerFetch,
        headers: { Authorization: `Bearer ${jwt}` },
      },
    });
  async function newSession(session: Session, purpose = "account") {
    const token = opaque();
    const { error } = await admin
      .from("app_sessions")
      .insert({
        id: hash(token),
        user_id: session.user.id,
        purpose,
        tokens: seal(
          {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          },
          config.SESSION_ENCRYPTION_KEY,
        ),
        access_expires_at: new Date(
          (session.expires_at ?? 0) * 1000,
        ).toISOString(),
        expires_at: new Date(Date.now() + (purpose === "recovery" ? 15 * 60000 : 7 * 86400000)).toISOString(),
      });
    if (error)
      throw new AppError(
        503,
        "session_unavailable",
        "Session service is unavailable. Please try again.",
      );
    return token;
  }
  async function identity(token: string | undefined): Promise<Identity> {
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      throw new AppError(401, "unauthorized", "Please sign in.");
    const id = hash(token);
    let { data, error } = await admin
      .from("app_sessions")
      .select("*")
      .eq("id", id)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (error)
      throw new AppError(
        503,
        "session_unavailable",
        "Session service is unavailable.",
      );
    if (!data) throw new AppError(401, "unauthorized", "Please sign in.");
    let tokens = unseal(data.tokens, config.SESSION_ENCRYPTION_KEY);
    if (Date.parse(data.access_expires_at) < Date.now() + 60000) {
      const lock = opaque();
      const { data: claimed, error: lockError } = await admin.rpc(
        "claim_session_refresh",
        { session_id: id, lock_token: lock },
      );
      if (lockError)
        throw new AppError(
          503,
          "session_unavailable",
          "Session service is unavailable.",
        );
      if (!claimed)
        throw new AppError(
          409,
          "session_refresh",
          "Your session is refreshing. Please try again.",
        );
      try {
        const { data: refreshed, error: refreshError } =
          await anonymous().auth.refreshSession({
            refresh_token: tokens.refresh_token,
          });
        if (refreshError || !refreshed.session) {
          await admin.from("app_sessions").delete().eq("id", id);
          throw new AppError(401, "unauthorized", "Please sign in again.");
        }
        tokens = {
          access_token: refreshed.session.access_token,
          refresh_token: refreshed.session.refresh_token,
        };
        const { data: updated, error: updateError } = await admin
          .from("app_sessions")
          .update({
            tokens: seal(tokens, config.SESSION_ENCRYPTION_KEY),
            access_expires_at: new Date(
              (refreshed.session.expires_at ?? 0) * 1000,
            ).toISOString(),
            refresh_lock: null,
            refresh_until: null,
          })
          .eq("id", id)
          .eq("refresh_lock", lock)
          .select("id")
          .maybeSingle();
        if (updateError || !updated)
          throw new AppError(401, "unauthorized", "Please sign in again.");
      } finally {
        await admin
          .from("app_sessions")
          .update({ refresh_lock: null, refresh_until: null })
          .eq("id", id)
          .eq("refresh_lock", lock);
      }
    }
    // Check provider identity, not an unverified JWT decode. RLS uses this user's token.
    const { data: user, error: userError } = await anonymous().auth.getUser(
      tokens.access_token,
    );
    if (
      userError ||
      user.user?.id !== data.user_id ||
      !user.user?.email_confirmed_at
    )
      throw new AppError(401, "unauthorized", "Please sign in again.");
    return {
      id,
      userId: data.user_id,
      purpose: data.purpose,
      client: userClient(tokens.access_token),
    };
  }
  return { admin, anonymous, newSession, identity };
}
export type Services = ReturnType<typeof services>;
export function databaseError(error: unknown) {
  if (error)
    throw new AppError(
      503,
      "database_error",
      "The operation could not be completed. Please try again.",
    );
}
