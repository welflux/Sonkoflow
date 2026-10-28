import { createClient } from "@supabase/supabase-js";
import { loadProcessingConfig } from "../server/processing/config.js";
import { providerFetch } from "../server/transport.js";
const loaded = loadProcessingConfig();
console.log(
  `AI processing configuration: ${loaded.config ? "valid" : "disabled or incomplete"}`,
);
for (const name of loaded.missing) console.log(`Required setting: ${name}`);
let blocked = !loaded.config;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY) {
  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    {
      global: { fetch: providerFetch },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  try {
    for (const [rpc, version, label] of [
      ["processing_schema_version", 2026102801, "Phase 2"],
      ["product_quality_schema_version", 2026102802, "Phase 3 product quality"],
    ] as const) {
      const result = await client.rpc(rpc);
      const ready = !result.error && result.data === version;
      console.log(
        `${label} schema: ${ready ? "passed (read only)" : "BLOCKED — migration not verified"} (HTTP ${result.status}; code ${result.error?.code ?? "none"})`,
      );
      if (!ready) blocked = true;
    }
  } catch {
    console.log("Phase 2 schema: BLOCKED — connection unavailable");
    blocked = true;
  }
} else {
  console.log(
    "Phase 2 schema: BLOCKED — existing Supabase bindings unavailable",
  );
  blocked = true;
}
if (loaded.config) {
  try {
    const r = await providerFetch(
      `https://api.openai.com/v1/models/${encodeURIComponent(loaded.config.AI_IMAGE_MODEL)}`,
      {
        headers: { Authorization: `Bearer ${loaded.config.AI_OPENAI_API_KEY}` },
      },
    );
    console.log(
      `OpenAI model access: HTTP ${r.status} (no generation requested)`,
    );
    await r.body?.cancel();
    if (!r.ok) blocked = true;
  } catch {
    console.log(
      "OpenAI model access: BLOCKED — network or credential access unavailable",
    );
    blocked = true;
  }
}
console.log(
  "This check does not generate an image or establish completed end-to-end processing.",
);
if (blocked) process.exitCode = 2;
