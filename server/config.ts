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
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): Config | null {
  const result = schema.safeParse(env);
  if (!result.success) {
    if (env.NODE_ENV === "production")
      throw new Error(
        "Required server configuration is missing or invalid. See docs/phase-1-deployment.md.",
      );
    return null;
  }
  const c = result.data;
  const origin = new URL(c.APP_ORIGIN);
  if (
    origin.origin !== c.APP_ORIGIN ||
    (c.NODE_ENV === "production" &&
      (origin.protocol !== "https:" || !c.SUPABASE_URL.startsWith("https://")))
  )
    throw new Error("Invalid production origin or Supabase TLS configuration");
  return c;
}
