import {
  createClient,
  type SupabaseClient,
  type Session,
} from "@supabase/supabase-js";
import { z } from "zod";
import type { Config } from "../config.js";
import { AppError, seal, unseal, opaque, hash } from "../security.js";
import { timedProviderFetch } from "../transport.js";
const record = z
  .object({
    state: z.string().regex(/^[a-f0-9]{64}$/),
    created: z.number(),
    storage: z.record(z.string().max(160), z.string().max(1000)),
  })
  .strict();
// PKCE state stays encrypted and HttpOnly; provider tokens never enter browser storage.
export class GoogleAuth {
  private cached: { until: number; enabled: boolean } | null = null;
  constructor(
    readonly config: Config,
    private fetcher: typeof fetch = timedProviderFetch(10000),
    private env: NodeJS.ProcessEnv = process.env,
  ) {}
  async available() {
    if (this.env.AUTH_GOOGLE_ENABLED !== "1") return false;
    if (this.cached && this.cached.until > Date.now())
      return this.cached.enabled;
    let enabled = false;
    try {
      const r = await this.fetcher(
        `${this.config.SUPABASE_URL}/auth/v1/settings`,
        {
          headers: { apikey: this.config.SUPABASE_PUBLISHABLE_KEY },
          redirect: "error",
        },
      );
      if (r.ok) {
        const reader = r.body?.getReader();
        if (!reader) throw Error("settings_unavailable");
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 32768) {
            await reader.cancel();
            throw Error("settings_too_large");
          }
          chunks.push(part.value);
        }
        enabled =
          JSON.parse(Buffer.concat(chunks).toString())?.external?.google ===
          true;
      } else await r.body?.cancel();
    } catch {}
    this.cached = { until: Date.now() + 60000, enabled };
    return enabled;
  }
  private client(storage: Record<string, string>): SupabaseClient {
    return createClient(
      this.config.SUPABASE_URL,
      this.config.SUPABASE_PUBLISHABLE_KEY,
      {
        global: { fetch: this.fetcher },
        auth: {
          flowType: "pkce",
          storageKey: "sonkoflow-oauth",
          persistSession: true,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storage: {
            getItem: (key) => storage[key] ?? null,
            setItem: (key, value) => {
              storage[key] = value;
            },
            removeItem: (key) => {
              delete storage[key];
            },
          },
        },
      },
    );
  }
  async start() {
    if (!(await this.available()))
      throw new AppError(
        503,
        "google_unavailable",
        "Google sign-in is not enabled. Use email and password.",
      );
    const state = opaque(),
      storage: Record<string, string> = {};
    const client = this.client(storage);
    const redirectTo = `${this.config.APP_ORIGIN}/api/auth/google/callback?state=${state}`;
    const result = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        queryParams: { prompt: "select_account" },
      },
    });
    if (result.error || !result.data.url)
      throw new AppError(
        503,
        "google_unavailable",
        "Google sign-in could not start. Use email and password or try again.",
      );
    const url = new URL(result.data.url);
    if (
      url.origin !== new URL(this.config.SUPABASE_URL).origin ||
      url.pathname !== "/auth/v1/authorize" ||
      url.searchParams.get("provider") !== "google" ||
      url.searchParams.get("code_challenge_method") !== "s256"
    )
      throw new AppError(
        503,
        "google_unavailable",
        "Secure Google sign-in could not be prepared.",
      );
    const safe = record.parse({ state, created: Date.now(), storage });
    return {
      url: url.href,
      cookie: seal(safe, this.config.SESSION_ENCRYPTION_KEY),
    };
  }
  async finish(
    cookie: unknown,
    state: unknown,
    code: unknown,
  ): Promise<Session> {
    const fail = () =>
      new AppError(
        400,
        "google_callback_invalid",
        "This Google sign-in has expired or could not be verified. Start again.",
      );
    if (
      typeof cookie !== "string" ||
      cookie.length > 6000 ||
      cookie !== Buffer.from(cookie, "base64").toString("base64") ||
      typeof state !== "string" ||
      !/^[a-f0-9]{64}$/.test(state) ||
      typeof code !== "string" ||
      code.length < 8 ||
      code.length > 2048
    )
      throw fail();
    let flow: z.infer<typeof record>;
    try {
      flow = record.parse(unseal(cookie, this.config.SESSION_ENCRYPTION_KEY));
    } catch {
      throw fail();
    }
    if (
      hash(flow.state) !== hash(state) ||
      Date.now() - flow.created > 600000 ||
      flow.created > Date.now() + 1000
    )
      throw fail();
    const client = this.client(flow.storage);
    const result = await client.auth.exchangeCodeForSession(code);
    if (result.error || !result.data.session) throw fail();
    // Check with the provider; no unverified JWT decode or caller-supplied user ID.
    const verified = await client.auth.getUser(
      result.data.session.access_token,
    );
    if (
      verified.error ||
      !verified.data.user?.email_confirmed_at ||
      !verified.data.user.email ||
      verified.data.user.id !== result.data.session.user.id
    )
      throw fail();
    return result.data.session;
  }
}
