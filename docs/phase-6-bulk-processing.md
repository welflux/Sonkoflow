# Phase 6 — Bulk processing

Review implementation; no production merge/deploy, hosted migration, paid generation or allowance grant performed.

## Architecture and workflow

`/app/batches` adds multi-file product selection, file type/size checks, remove controls, per-file server validation errors, sequential idempotent original uploads, project/name/quality selection, single listing or complete five-view product packs, saved brand/preset/overrides, an actual allowance quote and explicit provider consent. Originals are saved through the existing private upload endpoint. Removing a selected file does not erase a saved original; interrupted uploads remain available in their project. Server readability, pixel and storage validation is unchanged. Browser checks are convenience checks, never authorization.

Two additive owner-RLS tables (`processing_batches`, `batch_items`) group existing `product_packs` and existing `processing_jobs`; no second queue, worker or credit ledger. Server-only `create_processing_batch` atomically creates all source packs, their jobs and existing credit reservations under the existing global budget lock. Any source, quota, storage, budget or allowance failure rolls back the entire admission. Duplicate submissions return the same saved batch. Brand settings are resolved once per admission and copied into immutable per-job snapshots. Completed/failed/retried versions continue to use existing pack and quality workflows.

The batch admission policy separately permits several source packs in one transaction, replacing the standalone pack-count admission gate only inside this service-only operation. Existing owner/global generation-count, dollar-budget, output-slot, total-storage, worker-concurrency and retry limits remain enforced. The configured batch policy applies equally to authenticated accounts until future billing introduces differentiated entitlements; customers cannot supply or raise it in requests.

The dashboard reads persisted jobs and assessments, with source-level queued/processing/completed/failed-or-partial/cancelled counts and output-level generation/review/approval states. Completed generation does not mean approval. Existing pack review pages provide comparison, approve/reject, individual downloads, safe failure retry and separately quoted controlled quality retry. Partial failures retain other outputs. Missing records do not count as completed. Batch history is paginated, and the dashboard obtains packs/jobs in bounded set queries rather than one complete detail request per source.

Cancellation is a transactional owner-checked call to the existing queued-job cancellation RPC. It releases unused allowance exactly once. It does not abort already-dispatched API requests, erase saved images or remove usage records. Interrupted provider calls and unknown charges retain the existing no-blind-replay protection, dispatch markers, timeouts and recovery rules. There is no unlimited auto-retry.

Selected source packs can be exported as one bounded ZIP containing their latest completed **approved** outputs. Existing checksum/decode/decision validation is reused; decisions are checked again across the selected batch after storage reads. Limits: 100 files, 50 MiB combined, 10 MiB per image, one archive preparation per process, existing rate protection. Controlled names identify source pack, output type and job; no arbitrary paths or archive extraction. Individual approval/download/retry remains available in the linked pack page. The API rejects nonmember selections and unowned batches before storage access.

## Capacity and deployment

`AI_BATCH_MAX_IMAGES` defaults to **5**, configurable 1–100; `AI_BATCH_MAX_BYTES` defaults to 50 MiB (normalized source admission), configurable up to 1000 MiB; `AI_BATCH_DAILY_LIMIT` defaults to 2. Original uploads retain the existing accepted JPEG/PNG/WebP formats, 10 MiB per file, 25 megapixels and minimum 64 × 64, per-upload rate/concurrency limits. The browser also checks combined original file sizes against the batch limit. Product-only processing prevents applying product/brand settings to portraits.

The existing account storage policy remains 100 images / 250 MiB, including generated-output reservations of up to 10 MiB each. Existing upload rate protection and daily provider limits can further constrain a batch. Configuration for 20, 50 or 100 sources is not a guarantee that storage, allowance, provider or host can support it. Local SQL tests successfully admitted/cancelled **20** sources with small fixtures and one output each. **50** sources were deliberately tested and correctly rejected by existing output-byte capacity, rolling back admission. 100 is a validated configuration upper bound, not a tested deployment throughput promise. No real 20/50/100-image paid batch was run.

The current worker is the same long-lived Node process used in Phases 2–5, with bounded shared image concurrency and a separately leased quality assessment. Browser requests only upload one bounded file, quote, admit, poll or cancel. A durable database does not make a sleeping/terminated host process run: host lifecycle/restarts, actual processing throughput, API funding and visual results still need deployment verification. New jobs are subject to existing UTC-day expiration/reservation rules, so oversized queues must not be promised overnight execution.

Migration: `202610280005_batches.sql`, schema version `2026102805`, after the Phase 5 migration. No earlier migration reset. New tables are authenticated read-only under owner RLS; all mutation RPCs are service-only. Existing main/hosting data remain unchanged.

## Verification

New isolated tests execute all migrations, exercise 20-source atomic admissions and idempotency, queued cancellation/refunds, missing sources, configured limits, rollback, tenant isolation, privileged RPC denial, 50-source capacity rejection, truthful progress and bounded ZIP counts. Desktop/mobile browser tests exercise multi-file selection/removal, uploads, quote/consent, duplicate acknowledgement recovery, partial status, review links and cancellation. Existing queue tests cover lease exclusivity, interruption, provider/storage errors, safe retry limits and usage reconciliation; the bulk path reuses those exact functions.

Production uses real Supabase records and the existing actual OpenAI adapter. Mocks are limited to tests. Hosted migrations, reviewed model/token estimates, available internal allowance and funded API access remain activation requirements; real image quality and host-scale throughput remain unverified. No subscriptions, checkout or Phase 7 gallery/project-management work is included in this commit.

Bulk upload policy also exposes `AI_BATCH_FILE_BYTES` (64 KiB–10 MiB) and `AI_BATCH_FORMATS` (a subset of JPEG/PNG/WebP). The bulk UI marks uploads for this policy on the existing authenticated upload endpoint, which checks original bytes and the decoded format, not a claimed filename. Existing ready originals always retain the foundational validation guarantees. Normalized source bytes govern aggregate batch admission.

Executed local checks: 111 unit/database/HTTP tests passed, 64 desktop/mobile browser tests passed, and production build passed. Focused reruns are not counted twice. No funded OpenAI batch or hosted throughput test was performed.

## Bulk workspace presentation refresh

The bulk staging page now separates setup, a local thumbnail queue and the verified allowance review into three desktop panes, with responsive stacking and a collapsible setup section on phones. Multi-file selection, native folder selection and folder drops feed the same bounded queue. Browser-decoded dimensions and per-file warnings supplement the unchanged server validation. Files can be excluded individually or by selection; clearing staging never deletes a persisted original.

The five existing output types can be selected individually or together, preserving their supported square/landscape canvases and the existing Brand Studio picker. Upload/review and final provider-consent confirmation remain separate. Configuration is frozen during requests; uncertain upload and batch acknowledgements retain their existing stable IDs. Changing generation choices discards the visible quote and consent. No upload limit, account entitlement, model, worker, pricing, reservation or authentication policy was changed.

History uses the existing paginated list and owner-checked detail endpoints. Detail reads are bounded to two concurrent requests; later pages wait for their summaries. Status, saved output counts, quality and approval-dependent ZIP links come from actual saved records. Reuse setup copies name/project/output quality/types/instructions, resets brand selection and requires new source selection and another quote; it does not automatically rerun or generate anything. Failed history reads are explicit and retryable.

Higher server-reported capacity can be displayed without a UI rewrite, but the deployed per-file, batch, plan, storage and generation limits still apply. ZIP import, new image angles/aspect ratios, client rotation, GPU duration estimates, express queues and infrastructure expansion are not introduced by this presentation change.
