import { z } from "zod";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(2).default(0),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SECRET_KEY: z.string().min(20),
  SESSION_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
  RATE_LIMIT_KEY: z.string().min(32),
});
export type Config = z.infer<typeof schema>;
function configurationError(fields: string[]): Error {
  return new Error(
    `Required server configuration is missing or invalid: ${fields.join(", ")}. See docs/phase-1-deployment.md. Values are intentionally not logged.`,
  );
}
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): Config | null {
  const result = schema.safeParse(env);
  if (!result.success) {
    if (env.NODE_ENV === "production" ||
        (env.NODE_ENV !== undefined && !["development", "test", "production"].includes(env.NODE_ENV))) {
      // Paths come only from this fixed schema; never log issue messages or inputs.
      const fields = [...new Set(result.error.issues.map(issue => String(issue.path[0])))];
      throw configurationError(fields);
    }
    return null;
  }
  const c = result.data;
  const origin = new URL(c.APP_ORIGIN);
  if (origin.origin !== c.APP_ORIGIN ||
      (c.NODE_ENV === "production" && origin.protocol !== "https:")) {
    throw configurationError(["APP_ORIGIN"]);
  }
  if (c.NODE_ENV === "production" && new URL(c.SUPABASE_URL).protocol !== "https:") {
    throw configurationError(["SUPABASE_URL"]);
  }
  return c;
}
