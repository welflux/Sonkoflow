# Phase 3 — product preservation and quality review

Implemented on the existing Phase 1/2 codebase on 28 October 2026. **Live acceptance remains deferred**, as requested, until API credit and the pending hosted migrations/configuration are available. No successful real-service Phase 3 assessment or retry is claimed. Production `main` has not been merged or deployed.

## Product editing

The existing original-upload, private storage, OpenAI image-edit adapter, generation worker and download routes are reused. Product editing now records explicit background, lighting, color/contrast and realistic-shadow operations. The user can retain the exact arrangement; quantity, accessories, actual shape/proportions, materials, colors, finishes, packaging, labels, logos and print remain preservation requirements. Nonselected operations are constrained in the editing prompt. Background replacement is limited to neutral photographic settings; creative lifestyle scenes are not introduced.

Additional instructions cannot override preservation constraints. The prompt directs the model to reuse original details wherever achievable, avoid guessed lettering or reconstructed branding, and keep the original upload as reference. A quality retry uses that original again, never the previous generated image. Personal and portrait prompts retain their original version and behavior.

These controls reduce unnecessary changes; they cannot guarantee identity of pixels, typography, product geometry or colors. The original upload remains Phase 1's validated, metadata-stripped normalized WebP reference, rather than byte-for-byte archival of an incoming JPEG/PNG.

## Assessment pipeline

Product generation still completes only after validated output, private storage and checksum readback. Completion then queues a separate assessment state **on the same processing job**. The existing long-lived Node service runs its assessment loop alongside the generation worker, using the same database, image records, private bucket and owner checks. No new external service, queue platform, public URL or mock production result is used.

| Check | Implemented method | Meaning and limitation |
| --- | --- | --- |
| Readability/format | Actual Sharp decoding and WebP verification | Objective file property; cannot prove product fidelity. |
| Canvas | Actual pixel dimensions compared with requested dimensions | Cannot recover missing detail or establish physical dimensions. |
| Visual structure | Directional luminance-edge disagreement after normalized resampling | Heuristic review signal; no segmentation, geometric registration or physical metrology. Lighting, background and framing can change it. |
| Color distribution | RGB histogram total-variation distance | Heuristic review signal; not color calibrated. Different backgrounds/lighting can create large differences. |
| Visibility/cropping | Optional comparison by a real vision model | Probabilistic; manual review when unavailable. |
| Shape/color/material/quantity/arrangement | Optional vision comparison | Probabilistic; subtle details may be missed. |
| Labels/packaging/branding/distinctive details | Optional vision comparison | Unreadable/small print must remain uncertain; no certified OCR or perfect logo verification. |
| Background/instruction compliance | Optional vision comparison using saved selected requirements | Probabilistic; cannot prove full instruction compliance. |

Local structure/color thresholds are review heuristics (38% directional-edge disagreement and 28% histogram distance), **not calibrated fidelity scores**. A passed descriptor means only that its threshold did not flag a large difference. Users can optionally define a normalized product region for these comparisons. The same rectangle is examined in the output; it is not a foreground mask or an editing/inpainting constraint. Reframing can invalidate direct alignment. Without a region, the background is included explicitly in the reported scope.

Quality checks distinguish objective, heuristic, probabilistic vision and unavailable methods. No aggregate numeric fidelity score is invented. An objective failure can produce Failed; suspected AI defects are labeled as potential concerns. All low-confidence vision findings, including nominal passes, become Needs Review; non-high-confidence AI failures also become Needs Review. Confidence is AI-reported, not statistically calibrated. Missing detailed checks appear individually as Unavailable.

Even if every check passes, `user_decision` remains pending. Customers must explicitly attest that they compared the photographs before approving or rejecting. Reports, current decisions, revisioned/idempotent decision history and retry ancestry persist. Decision history is bounded at 50 changes per result. Authenticated ownership and existing origin/CSRF controls apply to every mutation. Images remain available for side-by-side review and authenticated download even when assessment is unavailable, provided the existing private object remains retrievable.

## Optional vision integration and cost

The server calls OpenAI's real fixed `/v1/chat/completions` endpoint with `gpt-6.1-terra`, two privately read inline images, strict structured JSON output, reasoning effort `none` and at most 1,500 completion tokens. Neither external image URLs nor tools are enabled. Images are resized inside 1024 × 1024 for analysis without upscaling. Tiny print can be unreadable at this analysis size; this is disclosed rather than scored as preserved. Responses are bounded at 64 KiB and validated; raw provider errors, keys and private storage paths are not returned or logged.

The [current official model page](https://developers.openai.com/api/docs/models/gpt-6.1-terra) was retrieved on this date and documents image input, structured output, Chat Completions and standard rates of **$1 input / $5 output per million tokens**. The [API pricing page](https://developers.openai.com/api/docs/pricing) agrees. Retrieved model-page Markdown SHA-256: `cd34faa8904d85961ab5fe270f079b8be45a9c876af6c809b38b2c069f687a7a`. Earlier candidates were rejected because their current documentation marks them deprecated. This model's documented snapshot is the canonical alias, not a dated snapshot; model behavior is not asserted to be permanently frozen. Real access/output with this project's key remains unverified until the deferred paid test.

Vision is disabled by default and adds **at most one external assessment per generated product result** when enabled. It requires explicit server configuration:

```dotenv
AI_PRODUCT_RETRY_LIMIT=2
AI_QUALITY_VISION_ENABLED=0
AI_QUALITY_VISION_MODEL=gpt-6.1-terra
AI_QUALITY_RESERVE_USD=
AI_QUALITY_INPUT_USD_PER_MILLION=
AI_QUALITY_OUTPUT_USD_PER_MILLION=
AI_QUALITY_PRICE_VERSION=
```

When enabling, explicitly set the two verified rates to `1` and `5`, an appropriate price version such as `openai-standard-vision-2026-10-28`, and a conservative additional assessment reservation. Existing image-processing configuration, budgets and `AI_OPENAI_API_KEY` are still required. Do not put keys in browser variables, Git or chat. Cloud configuration does not automatically configure Hostinger.

Both generation and assessment reservations are included in the existing serialized per-user/global daily budget admission. Actual reported assessment input/output/total tokens and provider request ID are checkpointed in an independent idempotent `assessment:<job-id>` usage event, using the existing usage table and processing operation category. Its model and price snapshot are stored on the job. A known assessment cost still consumes budget if generation usage is unknown. The displayed total estimate remains null when a required component is unknown, rather than pretending the unknown component was free. Cached discounts are not applied to the configured estimate; invoices are authoritative.

Reservations and request counts are admission safeguards, **not provider invoice ceilings**. Variable image tokens, model behavior and in-flight requests can exceed an inaccurate reservation. No provider billing settings or automatic recharge settings were changed. An old daily reservation cannot dispatch a new vision call after its UTC reservation day expires. Such a result retains local checks and becomes unavailable for AI assessment; it is not charged to an unreserved later day.

## Recovery and controlled retries

Assessment states are `not_applicable → pending → running → completed/unavailable`; the report separately records Passed, Needs Review or Failed. Generation status and quality/decision status are distinct. Failed checks never silently discard a saved output or imply that generation never happened.

A database lease serializes assessment globally. An interrupted local-only assessment can be resumed before external dispatch. Once the vision dispatch marker is set, an expired lease becomes unavailable and **never automatically replays the API request**. Database acknowledgement retries repeat only idempotent checkpoints, not the provider call. Invalid/refused model findings preserve usable provider usage; provider failures, storage failures, configuration failures, interrupted requests and assessment-persistence failures have separate safe codes. Assessment does not regenerate an image.

The explicit quality-retry route is separate from Phase 2's safe provider-retry route and storage-only recovery. It creates a new, separately metered generation with parent/root IDs, incrementing the same family counter and retaining all prior images/results. It reuses original settings and adds controlled correction instructions for selected reported concerns. Customer-observed concerns require a description. An unavailable assessment alone cannot justify a blind regeneration; the customer must specify an actual concern. The default family limit is two, configurable from zero to five, and cannot be raised beyond the root's original limit. Lowering the current server limit is also enforced. Concurrent submissions, duplicate keys, lost responses and stale decisions are checked in SQL, within the existing budget lock.

Quality retries still consume normal generation counts and shared budgets. A deliberately independent new edit remains subject to those normal daily limits; the family retry limit is not represented as a lifetime limit on all edits of a photograph.

## Migration and compatibility

The additive [Phase 3 migration](../supabase/migrations/202610280002_product_quality.sql) extends `processing_jobs` and its service-role-only RPCs. The new [read-only preflight](../supabase/checks/phase-3-preflight.sql) supports review on the intended existing project. Apply only after the existing Phase 1 and Phase 2 migrations, with normal backup/review; never reset data or rerun the foundation migration. No hosted migration was performed in this phase. The last hosted Phase 2 check was still 404/PGRST202, and SQL-management access remains unavailable.

The migration preserves existing image records, usage events and RLS policies. Earlier completed product results receive free local checks only, with no retroactive vision model/reservation. Inputs/results cannot be deleted during active assessment. Existing Phase 2 version and functions remain available through restricted wrappers; internal v2 entry points are not directly callable by application roles. Personal/portrait history continues to work against a Phase 2 schema. New product editing requires the quality migration so it cannot falsely offer a review workflow without storage support.

`npm run check:processing` now checks both schema versions without generating an image. Restart the existing Node service after activating migrations and environment settings. No production `main` merge or deployment is included in this work.

## Verification on 28 October 2026

- `npm run build`: production Vite build and TypeScript compilation passed.
- `npm run test:unit`: **62 passed, zero failures/skips**. Includes original security/provider regressions, real local SQL execution for all migrations, existing-row/RLS preservation, ownership and origin denial, product-control validation, uncertain findings, assessment storage/provider failures, idempotent usage, expired reservations, partial-known-cost budgets, decision revisions and retry limits.
- `npm run test:browser`: **34 passed**, desktop/mobile. Includes original personal/portrait/account workflows and new product controls, side-by-side saved results, approval/rejection persistence, safe rendering of findings, unavailable assessments, manual correction requirements and lost-response retry deduplication.
- `npm test`: **15 passed**, existing marketing/navigation/responsive checks.
- Browser screenshots were inspected at mobile size; no horizontal overflow was found. Test reports/findings/images are explicitly mocked only inside browser tests.
- Local image analysis ran on representative synthetic labeled-product, complex-packaging, reflective-surface and multiple-item fixtures. These establish executable methods and failure handling, not real-world detector accuracy or product-fidelity certification.
- Client-bundle scan found no server secret names or private price-snapshot field.
- `npm run test:live:processing` with paid opt-in absent: **one explicitly skipped**, zero live passes. No additional paid OpenAI call was made in Phase 3.

The opt-in integration test was extended to verify actual local/vision findings when enabled, owner-only persisted decisions and retained history/download. `RUN_LIVE_PROCESSING=1 RUN_LIVE_PRODUCT_RETRY=1 npm run test:live:processing` additionally exercises a genuine controlled retry, duplicate protection and approval of the new result. That full run can issue four image edits (three base modes plus one product retry), with up to two additional vision calls when enabled. It requires funded API access, both hosted migrations, configured budgets and isolated development projects/accounts. It has **not** been executed successfully in this phase.

Remaining live blockers are the previously exhausted API credit, pending hosted Phase 2/3 SQL and runtime activation. No additional setup action is requested now; live testing remains deferred at the owner's request. Product packs, Brand Studio, bulk work and payments were not introduced.
