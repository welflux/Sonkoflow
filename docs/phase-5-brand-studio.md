# Phase 5 — Brand Studio

Implementation on the existing Phases 1–4 stack. Review branch only; no production merge, deployment, remote migration or paid API call in this phase.

## Customer workflow

`/app/brands` is available from the existing workspace navigation. Account sessions, recovery restrictions, origin checks and private backend routes are unchanged. Brand Studio can operate with image generation disabled once its database migration is present.

Customers can create, edit, duplicate and delete profiles. Duplication copies active presets and shares references to the owner's immutable assets. Profiles include name/description; primary, secondary and accent colors; background direction/color; theme and photographic style; supported canvas preference; framing/spacing; preservation restrictions; saved instructions; and optional logo/footer settings. The preview updates from these controls, shows the actual privately served logo when selected, and is explicitly a layout illustration, not an AI result. Profile writes use revision checks; stale edits fail rather than overwriting someone else's newer changes. Browser loading prevents late profile responses from replacing the wrong draft.

Presets have a purpose (listing, lifestyle, promotional or business) and individually enabled structured overrides. Unchecked fields inherit the profile. Empty overrides remain empty: they do not inject schema defaults. Presets can be created, edited and deleted. Business presets are saved visual directions; this phase deliberately exposes them only in the existing product workflows. Personal/portrait generation rejects brand input server-side, and the controls are hidden for those modes.

The asset library accepts still PNG, JPEG and WebP files up to 2 MiB and 8 megapixels, minimum 16 × 16. Magic format must match MIME; images must decode; animation/SVG and unsafe dimensions are rejected. Assets are rotated, converted to sRGB and lossless WebP without source metadata, retaining transparency, bounded to 1024 × 1024 and 2 MiB after normalization. Customer-provided asset names never become object paths. Limits: 50 retained files / 25 MiB, including pending/removed historical files; 20 active profiles and 20 active presets per profile. Validation, read-back hashing and admission limits run on the server. Pending uploads can be retried with the same UUID/checksum; lost acknowledgements cannot create duplicate assets. Storage failure leaves the asset pending, never ready. Abandoned pending reservations retain their storage allowance; operator cleanup must verify storage and historical use before purging them.

## Integration and precedence

Both the existing product editor and pack planner offer saved profile/preset selection with a visible configuration preview and per-job overrides. Existing explicit canvas/background choices are retained when selecting a profile; UI changes to individual brand fields affect only the current request. Changing a preset preserves checked job overrides. Loading/failed profile selections block submission rather than silently generating without the selected brand.

Resolution is server-side:

1. Profile defaults.
2. Selected preset's explicitly saved fields.
3. Explicit structured overrides for the current job.
4. Explicit standalone Canvas/Background controls, or the selected pack output's supported canvas.
5. Product-preservation constraints and selected editing operations always take priority.

The standalone product editor uses the existing canvas controls: closest supported match, 1024 × 1024, 1536 × 1024 or 1024 × 1536. Pack types retain the explicit sizes defined in Phase 4; a saved portrait preference cannot turn a listing into a portrait canvas. The pack style preview illustrates a square canvas; output cards and the reviewed plan show actual per-output sizes. No arbitrary custom resolution or exact color/fidelity guarantee is introduced.

The server records `settings.brand_snapshot` with schema version `brand-v1`, profile/preset IDs, names, revision numbers, complete effective structured settings, precedence and immutable logo ID/checksum/dimensions. Pack configuration also records the reviewed snapshot; each job records its effective canvas. These are associations in the existing job/pack records, not a parallel job system. Later profile edits/deletion cannot rewrite saved jobs. Targeted quality retries inherit the parent's snapshot and original reference, including after profile/asset removal. New jobs require an active owned profile/preset and a ready owned logo.

Existing submission UUIDs remain idempotent, including a lost branded-job acknowledgement followed by a profile edit. Pack quote fingerprints include resolved settings and prompt/cost plans, so changed revisions require review again.

## AI and direct compositing

No extra provider or model is introduced. The real existing OpenAI image-edit adapter still sends the uploaded **original product photograph** as its reference. Controlled `brand-product-v1` / `brand-pack-v1` directions translate structured settings into background/theme/framing preferences and clearly subordinate free-text requests and palette choices to preservation. Brand colors style surroundings, never recolor real products, packaging, print or logos. There is no promise of perfect generative logo, typography, exact color or fine-detail reproduction.

Only the selected uploaded logo is applied automatically. Reference-image library assets are stored for the customer's review; they are not silently sent as additional AI references. This avoids assuming unverified multi-reference-model behavior or unpriced extra inputs.

The optional footer is an actual Sharp compositing operation after the genuine provider response has been metered and decoded. The whole generated photograph is fitted without cropping or stretching into the upper 86% of the existing output canvas. The lower 14% uses the saved secondary color and the actual uploaded logo, aligned left/center/right. The logo is contained within 30% of canvas width with safe padding, without upscaling small files. Intermediate logo encoding is PNG and the final output is lossless WebP, avoiding generative redrawing or lossy intermediate logo corruption. Resizing/alpha blending can change representation; legibility still requires review. No logo is pasted over the product area. This layout reduces the displayed photograph area and may not suit a marketplace's listing requirements; placement remains optional, disabled by default, and is not a compliance guarantee.

The worker verifies ownership and the immutable asset checksum **before** dispatch. A missing/corrupt logo fails safely without a provider call. After a provider response, accounting is checkpointed before compositing. The final composite must pass existing dimensions/format/10 MiB validation and deterministic storage/read-back checks before success. Composite failures cannot report completion or automatically regenerate a paid result. Storage recovery reads the already-composited deterministic output; it never calls OpenAI again.

## Quality, usage and spending

The existing product quality worker checks the final composited image. Existing decode/canvas checks remain. A separate objective check compares two footer boundary pixels with the saved strip color; it is explicitly a narrow check, not a proof of logo or product fidelity. Brand adherence remains `needs_review`: configured background, palette, semantic framing, spacing, typography and product details require human inspection. Optional real metered vision receives saved brand requirements and knows a declared separate footer is intentional branding. It does not certify pixel-exact logo fidelity without the asset reference. No automatic approval, fake fidelity score, OCR guarantee or hidden extra assessment call is added.

Standalone jobs retain configured generation/vision budgets and retry limits. Pack prompts, including brand instructions and retry snapshots, participate in existing token estimates, reservation amounts, quote fingerprints and credit reconciliation. Compositing adds no provider request. Credit estimates remain estimates; the existing daily caps, concurrency and ambiguous-charge protection stay in force. There are no payments, subscriptions or bulk processing changes.

## Persistence and authorization

Additive migration: `supabase/migrations/202610280004_brand_studio.sql`, schema version `2026102804`. Apply only after the existing pending Phase 2, 3 and 4 migrations, using the reviewed deployment process. Do not reset the database or rerun foundation SQL. `supabase/checks/phase-5-preflight.sql` is read-only.

New tables: `brand_profiles`, `brand_presets`, `brand_assets`, with owner RLS and read-only authenticated access. Mutations use service-only `mutate_brand` / `reserve_brand_asset` functions, owner checks, composite owner/profile foreign keys, serialized quota admission and optimistic revisions. No grants/policies on existing images, jobs, packs or usage tables are weakened.

Assets use the existing private `photos` bucket and WebP restriction. The existing image policy does not authorize asset object keys; assets stream through `/api/brands/assets/:id/content`, with an owner check, bounded download, checksum verification and `Cache-Control: no-store`. No public storage URLs or provider credentials are returned. Deleted assets are hidden from new selections but retained privately for prior jobs. Historical reads of removed assets additionally require an owned recorded job reference. Profile deletion soft-removes presets; it does not erase historical job snapshots or other profiles' shared logo references. Physical removal needs retention/history-aware operator cleanup; this phase does not claim a fully implemented erasure workflow.

API routes reuse existing authenticated/origin-protected `/api` middleware:

- `GET /brands/capabilities`, `GET/POST /brands`, `GET /brands/:id`.
- `POST /brands/:id/presets` for create/update/delete; revisions required for updates/deletes.
- `POST /brands/preview` for authenticated server resolution.
- `GET/POST /brands/assets`, `DELETE /brands/assets/:id`, `GET /brands/assets/:id/content`.
- Existing `/jobs`, `/packs/quote`, `/packs`, review, controlled retry, history and downloads carry the snapshots.

Profile/preset changes are rate limited. Multipart asset work has its own size/part/count/rate/concurrency bounds. No new environment secret is required: reuse `AI_OPENAI_API_KEY`, Supabase configuration, processing/quality budgets and reviewed pack token estimates from Phases 2–4. Brand CRUD requires account configuration and migration, not API credit.

## Verification and remaining activation limits

Local validation covers structured controls and sparse precedence, cross-account/deleted/missing resources, stale revisions, asset decoding/limits/transparency, exact opaque-logo compositing pixels, corrupt logo failure before dispatch, worker usage-before-persistence, profile/preset CRUD/duplication/RLS/quotas, real migration execution, stored historical snapshots, existing atomic pack/credit reservations, multipart HTTP upload/read-back/idempotency and storage failures. Browser fixtures are automated-test mocks only; production always uses actual Supabase data and actual OpenAI responses.

The opt-in existing live pack test now accepts `RUN_LIVE_PACK_BRAND=1`: it creates an isolated real profile/logo/preset, verifies second-account denial, runs real pack edits/assessments/downloads, changes the profile after admission, checks the original snapshot and footer findings, and cleans up test assets only when jobs/usage are safe to remove. It is **billable** and was not run. Example after approved migration/configuration/funding: `RUN_LIVE_PACKS=1 RUN_LIVE_PACK_BRAND=1 npm run test:live:packs` (default two edits, plus configured assessments; full pack/retry flags can add more).

OpenAI credit, remote migrations, reviewed pack estimates/allowance configuration and real end-to-end visual validation remain deferred. Local passes do not establish real provider image quality or hosted activation. Production main, sonkoflow.com, Hostinger configuration and hosted data remain unchanged. See the final task report for actual executed check counts.

Executed on 28 October 2026: `npm run test:unit` **103 passed**, `npm run test:browser` **60 passed** (desktop/mobile), `npm test` **15 passed** (marketing desktop/tablet/mobile), and `npm run build` **passed**. That is **178 distinct local checks**; targeted reruns are not counted twice. The two existing paid integration tests were explicitly skipped (`RUN_LIVE_PACKS=0 RUN_LIVE_PROCESSING=0`), with zero live-provider passes claimed. `git diff --check` passed, final client bundles contained none of the server credential names or private credit/quality plans, and desktop/mobile Brand Studio screenshots were visually inspected.
