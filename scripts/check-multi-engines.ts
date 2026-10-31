// Configuration-only preflight: never uploads a photograph or calls a provider.
import {
  loadEngineRegistry,
  engineCapabilities,
} from "../server/processing/engine-registry.js";
import { loadProcessingConfig } from "../server/processing/config.js";
const registry = loadEngineRegistry(),
  common = loadProcessingConfig();
console.log(
  JSON.stringify(
    {
      global_processing_configured: !!common.config,
      multi_engine_flag: registry.enabled,
      openai_enabled: registry.openaiEnabled,
      providers: Object.values(registry.engines).map((engine) => ({
        id: engine.id,
        enabled: engine.enabled,
        reason: engine.reason,
        credential_configured: !!engine.key,
        reviewed_pricing: !!engine.rate,
        live_verified: engine.verified,
        verified_cases: engine.verifiedCases,
      })),
      status: engineCapabilities(registry, !!common.config),
      billable_requests: 0,
      note: "Configuration inspection only. Disabled/unverified providers are not operational. No claim of live image quality or measured API cost is made.",
    },
    null,
    2,
  ),
);
