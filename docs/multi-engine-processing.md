# Multi-engine processing enhancement — 31 October 2026

## Release state

Implementation is prepared; **Topaz and Claid are disabled**. The owner confirmed that these accounts are not funded/configured and has not chosen a live comparison budget. No billable comparison was run and no successful live Topaz/Claid output, photographic-quality result or actual per-operation invoice cost is claimed. Existing OpenAI processing/billing activation flags are unchanged. Contract tests use explicit fixtures only; production contains no simulated provider responses.

The existing dashboard layout, navigation, projects, private image library, original uploads, account/OAuth/recovery, packs, batches, brand profiles and commercial credit catalogue remain intact. No hosted schema migration or new credit system is required. Only the editor gains matching native form controls for the processing experience and, when activated, eligible providers/operations. Unverified Authentic Enhancement is visibly unavailable.

## Experiences and routing

**Authentic Enhancement:** precision processing of the entire original at original resolution, or a verified 2x/4x scale. No generative models, reconstructed faces, background replacement, arbitrary prompts, branding or cropping are accepted. Topaz is the primary provider. The implemented presets use its non-generative precision endpoints: High Fidelity V3 (enhancement/upscale, recovery strength 0), Natural sharpening (strength 0.3), and Normal denoising (strength 0.3, additional sharpening disabled). Each request performs one selected operation; sharpening and denoising are not chained. Claid's authentic alternative is restricted to `smart_resize` upscaling. Precision processing does not guarantee label accuracy, identity preservation or genuine recovery of missing information; human inspection is required.

**Creative Production:** existing OpenAI reference editing, instructions, canvas, brand, packs and batch workflows remain the default. Claid adds a fixed commercial product-lighting/white-background finish using the Image Editing API. Free-form lifestyle scenes and brand layouts continue through OpenAI; no unsupported Claid generative endpoint or unseen product-angle capability is advertised. Claid finish is a product-only workflow; its source geometry is not intentionally cropped or stretched.

`engine-registry.ts` selects only enabled, reviewed operations. Automatic selection prefers Topaz for eligible authentic upscales, then eligible Claid; creative instructions stay on OpenAI and the fixed product finish routes to Claid. The actually chosen provider must equal the provider to which the user consented. A changed provider requires fresh review/consent. No automatic provider switch occurs after dispatch, even for timeouts or outages. This prevents double billing and replacing a faithful enhancement with a generative result.

## Worker, storage and accounting

The existing authenticated `/api/jobs`, capabilities, billing quote, SQL submission/claims and worker are reused. Legacy requests omit the optional `processing` object, retaining their exact fingerprint and OpenAI behavior. New requests pin a server-created route in job settings: provider, experience, operation, model, target dimensions, reviewed rate/version, estimate, reservation and canonical route digest. Clients cannot submit route snapshots or arbitrary model/endpoint URLs. Workers reject altered routes, disabled providers, changed pricing or missing operation-specific verification before contacting a provider.

Original objects are checksum-verified and never overwritten. Provider outputs remain separate `generated` image versions using the existing owner-scoped key, bounded validation, metadata stripping, lossless WebP encoding and checksum readback. The current shared limits remain: output <=25 MP, side <=10,000 pixels and normalized WebP <=10 MB; output storage quota/reservations still apply. Dedicated jobs do not silently invoke OpenAI vision or brand compositing. Existing local product checks/review remain available; generative quality retries do not operate on dedicated-engine results.

New jobs use the existing internal allowance reservations and billing ledger, including daily/user/global safeguards, active limits and uncertain-outcome holds. Dedicated pricing is required, versioned and configurable per operation or output megapixel, with a positive minimum, reviewed maximum resolution and reservation multiplier >=2. Paid tier quality ceilings remain enforced; the free sample stays on its existing calibrated OpenAI path. No new units, grants, plan prices or checkout activation are introduced.

Provider-specific usage records store provider, actual model/operation, output pixels, elapsed time, remote request ID and configured estimate basis. Reported invoice cost remains **null** when the API does not supply it. The legacy usage-event cost-basis label is refined after the atomic usage/credit RPC; a label-write failure is logged safely and does not replay a provider or discard a result. Provider estimates use the immutable saved rate; invoices and existing owner cost-reconciliation facilities remain authoritative. A reservation is an admission safeguard, **not a guaranteed external invoice ceiling**.

Topaz acceptance is checkpointed before polling its existing job. Polling/download failures preserve the known remote ID and unknown-cost hold. A process crash or timeout does not automatically submit the image again; it becomes an uncertain job for operator reconciliation, using the existing state machine. Persisted image recovery retries storage only. This release does not add automatic resumption of a remote job after a server restart.

## Transport and privacy

Secrets are server-only `AI_TOPAZ_API_KEY` / `AI_CLAID_API_KEY`; OpenAI retains its existing key. Fixed HTTPS API endpoints, bounded responses, overall operation deadlines and existing proxy/CA-aware transport are used. Sources are uploaded as normalized PNG bytes, never exposed through a public source URL. Raw provider errors, secrets, signed URLs, prompts and image bytes are not logged or returned to the browser.

Downloads follow no redirects and send no provider Authorization/X-API-KEY header. Topaz requires operator-configured exact HTTPS storage origin/path prefixes from genuine downloads. Claid's documented default is a temporary public-bucket URL, retained by the provider for up to 24 hours; only its documented bucket prefix is accepted. Its editor consent/help explains temporary hosting before the result is copied to the private library. This server-side copy does not erase provider-side files or override provider retention. Operators must review provider agreements and this output-delivery arrangement before activation; no private-connected-storage configuration is invented.

## Configuration and independent switches

See `.env.example`. Existing `AI_PROCESSING_ENABLED` remains the global switch and existing budgets remain mandatory. `AI_OPENAI_ENABLED` defaults to enabled for backward compatibility and may be independently disabled; in that case an OpenAI key/token-price configuration is not required for dedicated processing. A misconfigured OpenAI adapter also fails closed independently when a separately verified dedicated provider is available; shared budgets remain mandatory. The inactive OpenAI compatibility fields are inert and never used to report a zero provider cost. Packs/batches remain unavailable if their OpenAI engine is disabled.

New switches default off: `AI_MULTI_ENGINE_ENABLED`, `AI_TOPAZ_ENABLED`, `AI_CLAID_ENABLED`. Each dedicated engine additionally requires its own secret, a valid reviewed `AI_<PROVIDER>_PRICE_JSON`, output delivery configuration and a server-local approved `AI_<PROVIDER>_VERIFICATION_FILE`. Restart the Node service after configuration changes. No credentials or new activation switches were configured on Hostinger or in the running environment during implementation.

Price JSON fields: `version`, `unit` (`operation` or `output_megapixel`), `micro_usd`, `minimum_micro_usd`, `max_output_pixels`, `reserve_multiplier`. Supply genuine current account rates/conservative calibration, not unit-test prices. If one provider-level rate covers several operations/models, it must conservatively cover every approved operation. A changed adapter version, model, rate or price version invalidates the matching queued route/approval.

## Genuine comparison and approval procedure

`npm run check:engines` inspects configuration and approved reports only: no network/provider/image request. `npm run test:live:engines -- /private/path/manifest.json` refuses to run unless `RUN_LIVE_ENGINE_COMPARISON=1`, complete private configuration, explicit permission to process the photographs and a maximum total reserved API budget are supplied. It is not invoked by builds, installation, app startup or ordinary tests. Private results/reports under `artifacts/engine-comparison/` are Git-ignored and never served by the app.

Manifest fields:

- `permission_confirmed: true`
- `max_total_reservation_micro_usd`: owner-approved total for this run; no default spend limit
- `operation`: `upscale`, `enhance`, `sharpen`, `denoise` or `product_finish`
- `scale`: 2 or 4 for upscale; 1 for the other operations
- `samples`: exactly three distinct local files with categories `portrait`, `product`, `commercial`

Start with a shared upscale run to compare all three providers on the identical normalized originals. OpenAI is a creative reference comparator with its supported fixed canvases; dedicated-engine output dimensions can differ. Reports include input/output hashes, dimensions, elapsed time, request IDs, configured estimates and explicitly unknown actual costs. Additional operation-specific runs are required for each preset/scale to activate. Unsupported provider/operation combinations are marked blocked; they are not substituted with another operation. The tool never automatically retries a paid call.

Reports start with `approved:false`, human reviews pending, `actual_cost_micro_usd:null` and `invoice_reference:null`. Inspect facial identity/expression/proportions/skin texture; product geometry, labels, packaging text/colours/accessories; photographic naturalness and commercial suitability at full resolution. Enter actual settled account/invoice amounts and references, compare processing speed and profitability, and record passed/failed judgments. Do not infer quality from a successful HTTP status or invented automated scores.

The registry requires approved evidence for all three categories **for the exact operation/scale/model**, successful request IDs, valid image hashes, timing, three distinct reference photographs, positive actual invoiced costs and passed identity/detail/naturalness reviews. Actual sample cost must fit the configured conservative reservation and reviewed output range. Failed/pending/unknown-cost samples cannot activate a provider. Approval files are private operator attestations; they are not third-party compliance certificates. After review, configure the approved report and enable only the verified cases, then perform a live authenticated staging workflow before production activation.

## Official references reviewed 31 October 2026

- [Topaz image request parameters](https://developer.topazlabs.com/getting-started/request-parameters/image.md)
- [Topaz High Fidelity V3](https://developer.topazlabs.com/image-models/upscaling-and-enhancement/precision/high-fidelity-3.md)
- [Topaz Natural sharpening](https://developer.topazlabs.com/image-models/sharpening/sharpen-natural.md)
- [Topaz Normal denoising](https://developer.topazlabs.com/image-models/denoising/denoise-normal.md)
- [Topaz async status/download quickstart](https://developer.topazlabs.com/getting-started/image-quickstart.md)
- [Claid upload API](https://docs.claid.ai/image-editing-api/upload-api-reference.md)
- [Claid input/output and temporary storage](https://docs.claid.ai/image-editing-api/image-i-o.md)
- [Claid resizing](https://docs.claid.ai/image-editing-api/image-operations/resizing.md)
- [Claid adjustments](https://docs.claid.ai/image-editing-api/image-operations/color-adjustments.md)
- [Claid background operations](https://docs.claid.ai/image-editing-api/image-operations/background.md)

Request contracts have been checked against these documents. Only funded, genuine provider tests can establish live compatibility, final host allowlists, output quality, timing and actual costs. Those tests remain pending by owner instruction.

## Verification for this release

- Production Vite build and TypeScript compilation passed.
- 70 selected unit/security/provider/workflow checks passed, including explicit adapter fixtures, independent OpenAI configuration, actual admission payloads, existing billing units, internal-rate redaction and recovery behavior.
- 36 existing isolated PostgreSQL processing/pack/commerce checks plus one dedicated native-dimension/unknown-cost ledger check passed. These use local PGlite, not the hosted customer database.
- 39 editor browser checks passed across desktop, tablet and mobile, including legacy modes, missing configuration, saved results/downloads, uncertain outcomes, resubmission identifiers, Production Hub handoffs and the new experience/provider controls. UI/API fixtures do not prove live authentication or generation quality.
- Configuration-only preflight reports Topaz and Claid disabled/unverified, with no configured credentials. The comparison command refuses to run without its explicit arm flag and spending manifest. No billable provider call was made.

Live release verification: the deployed application bundle matched the release checksum, contained the experience controls and excluded server-only Topaz/Claid secret bindings. Existing anonymous authentication-origin checks passed 7/7; public/health/pricing/private-route release checks passed 13/13. The smoke script's stale “Made for” assertion was updated to the already-approved current homepage heading; no homepage content was changed for this feature.
