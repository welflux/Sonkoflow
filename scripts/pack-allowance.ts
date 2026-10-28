// Operator-only allowance administration. Never called from browser routes.
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { providerFetch, closeProviderTransport } from "../server/transport.js";
const [action, ...args] = process.argv.slice(2);
const uuid = z.uuid(),
  amount = z.coerce.number().int().min(0).max(1e9);
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY)
  throw new Error("Existing server Supabase configuration is required.");
const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  {
    global: { fetch: providerFetch },
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
try {
  let r;
  if (action === "grant") {
    const owner = uuid.parse(args[0]),
      credits = amount.min(1).max(1e6).parse(args[1]),
      request_key = uuid.parse(args[2]),
      unit = amount.min(1).parse(process.env.AI_PACK_CREDIT_MICRO_USD);
    r = await admin.rpc("grant_pack_credits", {
      owner,
      amount: credits,
      request_key,
      unit,
    });
  } else if (action === "reconcile") {
    r = await admin.rpc("reconcile_pack_credit", {
      job: uuid.parse(args[0]),
      stage_name: z.enum(["generation", "assessment"]).parse(args[1]),
      attempt_no: amount.min(1).max(3).parse(args[2]),
      cost_micro_usd: amount.parse(args[3]),
    });
  } else
    throw new Error(
      "Usage: grant USER_UUID CREDITS IDEMPOTENCY_UUID | reconcile JOB_UUID generation|assessment ATTEMPT ACTUAL_MICRO_USD",
    );
  if (r.error) {
    console.log(
      JSON.stringify({
        status: "blocked",
        http_status: r.status,
        code: r.error.code,
      }),
    );
    process.exitCode = 1;
  } else console.log(JSON.stringify({ status: "recorded", operation: action }));
} finally {
  await closeProviderTransport();
}
