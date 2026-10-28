# Phase 4 — product image packs

Implemented on the existing Phases 1–3 code on 28 October 2026. **Live acceptance remains deferred** at the owner's request. No production `main` merge, deployment, funded OpenAI test or hosted migration was performed in this phase.

## User workflow and supported outputs

On an existing project, choose **Create image pack** beside a ready original, or use the existing single-photo uploader and then choose that action. The pack editor also selects other ready originals in that project. Upload/authentication/validation/private storage are reused rather than rebuilt.

Select individual outputs or the complete five-view pack, choose quality per output, describe a lifestyle/promotional setting or visible detail focus, and review the planned canvases and allowance requirement. A single **Generate image pack** action starts the reviewed selection after explicit consent. Changing selections invalidates the review. An insufficient allowance disables generation and is independently enforced in SQL.

| Output | Native canvas | Aspect | Intent |
| --- | --- | --- | --- |
| Clean Listing Image | 1024 × 1024 WebP | 1:1 | Preservation-focused neutral product presentation. |
| Lifestyle Scene | 1536 × 1024 WebP | 3:2 | Creative environment surrounding the same product. |
| Detail Image | 1024 × 1024 WebP | 1:1 | Closer view of features genuinely visible in the original. |
| Square Social Image | 1024 × 1024 WebP | 1:1 | Square photographic composition, without invented branding/text. |
| Wide Promotional Image | 1536 × 1024 WebP | 3:2 | Landscape promotional composition and useful negative space. |

Low, medium and high are available within the existing server maximum. These are supported model canvases, not claims of compliance with a named platform or a native 16:9 banner. Final destination requirements must be checked separately. Detail generation is not verified recovery of missing information; unseen features and unreadable print must not be invented or represented as accurate.

Listing work remains distinct from creative lifestyle/promotional settings. Every output uses the **same original reference**, selected requirements and controlled product-preservation instructions. Pack-specific exceptions allow legitimate environments and intentional detail cropping without relaxing recognizable product shape, colors, materials, packaging, print, logos and distinctive features. No image is generated solely from a preceding generated result. Consistency is encouraged through the reference and common requirements, not guaranteed by pixel identity or an unimplemented cross-image certification system.

## Existing processing and quality infrastructure

A pack record groups independent rows in the existing `processing_jobs` table. Creating the pack and all initial jobs is atomic. Per-pack submission keys/request fingerprints prevent accidental duplicate packs, including lost responses. A rejected admission rolls back jobs and reservations before any worker can see them.

The existing Node generation worker claims each output and uses the existing real OpenAI image-edit adapter, private storage, output validation/checksum publication, timeouts, leases and interruption rules. There is no second provider adapter, separate queue service or simulated production worker. Failed outputs do not erase completed siblings or earlier versions. Queued work can be cancelled; an uncertain dispatched request is never replayed automatically. Eligible definitive provider failures can use the existing bounded safe-retry action.

Each saved product result queues the existing Phase 3 assessment. Its file checks, visual descriptors and optional real vision comparison run independently. Lifestyle, detail and promotional outputs add an explicit customer-review requirement. The vision prompt understands permitted cropping/scene changes; it does not automatically call every changed background a defect. Exact product fidelity remains unverified by simple pixel descriptors and can remain uncertain after AI assessment.

The gallery groups output types, shows actual generation, assessment, decision and usage states, and compares original/generated private images. Review panels reuse Phase 3 approval, rejection and targeted retries. Polling updates changed cards while preserving an open review and typed customer correction. An unfinished assessment cannot be displayed as Passed merely because its local checks passed. Counts come from stored job states; there are no simulated percentages or placeholder finished images. Missing job records are classified as incomplete rather than invented queued jobs.

Controlled retries retain pack/type/root ancestry, the original reference, settings and prior results. They require a new allowance preview tied to the particular correction. The Phase 3 family limit remains immutable upward and configurable downward; generic provider-safe retries retain their three-attempt bound. Attempts and dispatch markers are recorded separately from accepted usage. A dispatch marker means the call may have been attempted, not proof that OpenAI accepted or billed it. Full review/history and individual image downloads remain available.

## Estimates and internal allowance

Credits here are **internal usage allowance, not purchased credits or payment processing**. Granting internal allowance does not fund the OpenAI account. The default initial allowance is zero, issued at most once when an eligible owner requests a quote; an operator can grant allowance through service-only administration. No checkout, subscription, payment processor or automatic billing/recharge setting is introduced.

Quotes are calculated on the server using the configured, versioned model prices, selected native canvas and quality, actual controlled prompt, and reviewed model-specific image-token estimates. Prompt UTF-8 byte length is used as a conservative text-token estimate, not an exact tokenizer result. Optional vision input uses an explicit reviewed estimate and its real 1,500-completion-token bound. There is no assumption that all output types/qualities/canvases have identical costs.

The verified 28 October standard rates from Phase 2/3 still apply to the default models: image editing with GPT Image 2.5 uses $5 text input, $8 image input and $30 image output per million tokens; optional GPT-6.1 Terra assessment uses $1 input/$5 output. These are model/endpoint-specific configured estimates, not a provider invoice. [Image model](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst), [vision model](https://developers.openai.com/api/docs/models/gpt-6.1-terra), [official pricing](https://developers.openai.com/api/docs/pricing), and the recorded source hashes in earlier verification documents provide the pricing evidence. No new paid call was made to calibrate pack token estimates.

The feature fails closed until an operator supplies a model-matched estimate version, supported source-pixel bound, reference image-token estimate, and output-token estimates for each quality and native aspect. **No invented numeric production token table is supplied.** A larger source than the reviewed input bound is rejected. The client displays expected credit use separately from the required conservative hold; it must have enough available allowance for the hold. Each stage rounds up to whole internal credits.

A generation reserve is the larger of the existing per-operation USD reservation and the model/token estimate multiplied by the pack reserve factor. The assessment reserve similarly respects its existing configured minimum. Both are included in the existing per-user/global daily budget admission as well as the credit hold. The API revalidates a quote fingerprint before admission, including source checksum, model/prices, operation details and estimate version. A changed allowance is checked atomically at creation even if its earlier preview was sufficient.

`pack_credit_accounts` stores balance/reserved totals; `pack_credit_reservations` records generation/assessment holds per job attempt. The existing `usage_events` table records idempotent grants, reserves, releases and settlement deltas alongside provider usage. Generation jobs still hold immutable model/price snapshots and actual token/request metadata. New jobs, grants, retries and settlement share the existing budget transaction lock.

- A reservation does not debit balance. Queued cancellation, queue expiry and known pre-provider failures release unused holds with no debit. Requeued safe attempts release the correct **next-attempt** hold if cancelled before dispatch.
- Actual known provider token-cost estimates settle each generation/assessment once and release unused held allowance. Duplicate checkpoints cannot debit twice.
- If required usage is missing or the request's outcome is unknown, its applicable hold remains unresolved rather than being declared free or fabricated as a zero-cost success. An assessment that never starts releases its separate hold.
- For the verified image-only 2.5 models, an immutable `output_modality=image` snapshot permits using reported output tokens when the redundant output modality breakdown is absent. Unverified models/snapshots remain unknown. Existing input/total consistency checks are retained.
- Actual usage above the hold is recorded honestly, including a negative available balance, and blocks later reservations. Already incurred provider usage cannot be undone by dropping a record or pretending it was free.
- Definitive quota/credential rejections, internal database acknowledgements and storage recovery do not trigger repeated automatic provider charges. Unknown external outcomes remain unreplayed.

Reservations and request counts are **admission safeguards, not hard provider invoice ceilings**. Token estimates require calibration after funding, and in-flight requests can exceed inaccurate estimates. Cached discounts and invoices may differ from the configured uncached-token estimate. Provider-level funding/spending controls remain separate. No promise of exact provider charges, automated invoice retrieval or automatic unknown-charge reconciliation is made.

## Private approved ZIP export

Individual downloads use the existing authenticated content endpoint. ZIP export requires ownership of the pack and reads only the latest completed, explicitly approved, still-present version of each output type. Other queued, failed, uncertain, rejected or unapproved outputs are excluded; a partial pack can be exported. If a newer retry fails, an older approved version remains eligible and is identified in the interface.

Each selected image is read from private storage, checked against its saved checksum, decoded/validated against its recorded native output format/dimensions, and approval is rechecked after storage I/O. Missing/corrupt objects or changed decisions fail honestly rather than generating an incomplete or misleading archive. The ZIP contains the actual stored generated WebP bytes, not placeholders, links or regenerated previews.

The standard ZIP writer uses CRC-32 and stored WebP entries, controlled ASCII filenames and no filesystem extraction. It rejects traversal paths, duplicate names, oversized entries and empty archives. Limits are five files, 10 MiB each, 50 MiB total; ZIP64 is not needed or supported. Downloads return attachment/no-store headers. Archive preparation defaults to one per Node process (configurable up to two) with the existing request-rate mechanism limiting repeated owner/IP downloads. Binary validity was checked with an independent Python ZIP reader. Export is a snapshot of approvals rechecked before the archive is returned; previously downloaded bytes cannot be revoked.

## Configuration and activation later

All new defaults are in `.env.example`; packs are disabled until configured:

```dotenv
AI_PACKS_ENABLED=0
AI_PACK_INITIAL_CREDITS=0
AI_PACK_CREDIT_MICRO_USD=
AI_PACK_MAX_OUTPUTS=5
AI_PACK_DAILY_LIMIT=2
AI_PACK_ACTIVE_LIMIT=1
AI_PACK_ZIP_CONCURRENCY=1
AI_PACK_RESERVE_MULTIPLIER=1.5
AI_PACK_VISION_INPUT_TOKEN_ESTIMATE=
AI_PACK_TOKEN_ESTIMATES_JSON=
```

`AI_PACK_CREDIT_MICRO_USD` defines the micro-USD represented by one internal credit and is frozen on an owner's account. Changing that unit requires deliberate reconciliation/migration, not a silent reinterpretation of existing balances. Image concurrency remains controlled by `AI_GLOBAL_CONCURRENCY`, quality retry limits by `AI_PRODUCT_RETRY_LIMIT`, and assessment concurrency by the existing single global assessment lease. Ordinary per-user/global processing limits still apply to **each output and retry**, not merely each pack; a complete five-output pack therefore needs five available daily operations and sufficient USD budget. Pack daily/active limits add further admission constraints.

The required token-table shape is below. Nulls are deliberately invalid placeholders; they must be replaced with reviewed, model-specific estimates before enabling, not copied into production as numbers:

```json
{
  "model": "gpt-image-2.5-sunburst-2026-09-08",
  "version": "operator-reviewed-estimate-version",
  "max_source_pixels": 25000000,
  "input_image_tokens": null,
  "output_image_tokens": {
    "low": {"square": null, "landscape": null},
    "medium": {"square": null, "landscape": null},
    "high": {"square": null, "landscape": null}
  }
}
```

Reference tokens must cover the declared source bound; output tokens must cover the selected model/quality/canvas. Vision input estimates must cover both analysis images and comparison prompt when optional vision is enabled. Until real usage is measured, these estimates remain a blocker to honest production cost activation. Existing generation/vision keys, prices, budgets and feature flags are still required, exclusively on the server.

The additive [Phase 4 migration](../supabase/migrations/202610280003_product_packs.sql) follows the already prepared Phase 2/3 migrations. The [read-only Phase 4 preflight](../supabase/checks/phase-4-preflight.sql) and `npm run check:processing` inspect readiness. No earlier migration should be replayed and no data reset is required. Existing image/usage/account rows and policies are preserved; no wallet is minted or retroactively charged for standalone jobs. New pack/allowance tables enforce RLS and owner-only reads; writes and ledger administration are service-role-only. Renamed internal worker functions cannot bypass the public reservation wrappers. No hosted SQL was applied; existing SQL-management access is still unavailable.

An operator-only helper reuses the existing server Supabase bindings:

```sh
node --env-file-if-exists=.env --import tsx scripts/pack-allowance.ts grant USER_UUID CREDITS IDEMPOTENCY_UUID
node --env-file-if-exists=.env --import tsx scripts/pack-allowance.ts reconcile JOB_UUID STAGE ATTEMPT ACTUAL_MICRO_USD
```

These are documentation commands, **not executed grants in this task**. Run them from a reviewed development checkout with its existing server bindings; `STAGE` is either `generation` or `assessment`. Reconciliation requires a dispatched, terminal external operation and verified actual cost; queued work cannot be manually charged. Matching repeats are idempotent, conflicting repeats fail. Reconciliation updates the cost ledger without falsely marking an image generated. There is no browser/admin payment interface in this phase.

## Actual verification

- `npm run build`: Vite production build and TypeScript compilation passed.
- `npm run test:unit`: **84 passed, zero failures/skips**, including all earlier backend/provider/security regressions. Local PostgreSQL/PGlite executes all four migrations and tests atomic pack creation, five independent outputs, serial claims, partial failure, duplicate submissions, credit holds/settlement, unused-work refunds, requeued-attempt refunds, actual overages, known/unknown usage, owner-only access, grants, targeted-retry inheritance and existing-data/RLS preservation. Sibling retry histories also survive isolated account cleanup without root-index conflicts.
- Focused pack tests were rerun after the missing-record progress correction: **8 passed**; these repeat existing cases and are not counted twice.
- `npm run test:browser`: **48 passed**, desktop/mobile. Existing account/personal/portrait/product workflows remain covered, plus pack selection/planning, insufficient allowance, configurable output limits, lost-response recovery, partial galleries, approval-gated ZIP links, targeted retry quotes, preserved correction text during polling and the unfinished-assessment status guard.
- `npm test`: **15 passed**, public marketing/navigation/responsive regressions.
- **147 distinct local checks passed.** Browser provider/results fixtures are explicitly test-only. These are not 147 live OpenAI/Supabase checks.
- Production client-bundle scans found no server secret names or private credit/price-plan fields. Mobile pack screenshots were inspected; responsive checks found no horizontal overflow.
- Paid image-processing and pack integration suites: **two explicitly skipped, zero live passes** because opt-in flags remain absent. No new paid OpenAI call was made in Phase 4.

For later funded development testing, `RUN_LIVE_PACKS=1 npm run test:live:packs` exercises two real outputs, ownership isolation, persisted decisions, internal allowance and actual approved ZIP bytes. `LIVE_PACK_COMPLETE=1` selects all five types, and `RUN_LIVE_PACK_RETRY=1` adds one genuine controlled retry. Optional vision adds one real assessment per generated result. These flags can therefore incur up to six image edits and six assessments in the full configuration, subject to configured daily caps and budgets. The test uses isolated development accounts; active, uncertain or unreconciled dispatched operations are retained for review rather than deleting their billing evidence. This live suite has not passed in this phase.

Remaining blockers are the previously exhausted OpenAI API credit, pending hosted Phase 2/3/4 migrations, reviewed token estimates/internal allowance and runtime activation. Existing cloud secrets are retained; no key re-entry is requested. Deployment remains on hold until the remaining phases are finished, as instructed. Brand Studio, bulk product processing, subscriptions and payments are outside this work.
