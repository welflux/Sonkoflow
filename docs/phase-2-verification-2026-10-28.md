# Phase 2 resumed verification — 28 October 2026

Phase 2 is **not complete**. Production `main` was not merged or deployed. Existing implementation, authentication, private storage, and processing architecture were reused.

## Active environment and real API request

The managed environment reported connected/running with current observations and matching desired/observed spec revision 5. Both existing Supabase bindings and the server-only OpenAI binding were ready. Enforced network destinations include the two API hosts and official OpenAI documentation hosts. OpenAI `GET /v1/models` returned HTTP 200 and listed the pinned 2.5 snapshots. This verifies active authentication/network access, not billing availability or successful image generation. The draft still references its existing base publication version; a new persistent publication version was not separately established.

One genuine `POST /v1/images/edits` used the existing `editImage` adapter, matching Undici multipart transport, existing validation, and the configured secure key. It submitted the repository's illustrative footwear reference with the product-preservation prompt, pinned Sunburst snapshot, low quality, square 1024 canvas and one output. This was a provider-only diagnostic; it did not create a durable Supabase job or test authenticated download/history. It was not a human-photo fidelity test.

**Actual result:** HTTP **429**, provider code **`credit_balance_exhausted`**, type **`insufficient_quota`**. It was not retried. No image or usage breakdown was received; output validation/storage and real per-operation cost measurement therefore did not run. No charge amount or account balance can be inferred from this response. [Sanitized result](verification/2026-10-28-openai-probe.json) retains timestamps and machine codes only. The recorded adapter error was its former generic rate-limit category; this verification corrected billing classification and added regression coverage.

## Database

Read-only checks against the existing intended project returned HTTP 200 for the five relevant tables. Counts: one profile, zero projects, zero images, zero processing jobs and zero usage events. The `photos` bucket remains private, WebP-only, with a 10,485,760-byte limit.

`processing_schema_version()` returned **404 / PGRST202**. Phase 2 is not verified/applied. No Supabase management token, database URL/password, SQL client connection or SQL connector is configured. A service-role application key does not authorize arbitrary SQL execution. The existing read-only [preflight](../supabase/checks/phase-2-preflight.sql) and additive [migration](../supabase/migrations/202610280001_processing.sql) remain the reviewed path; neither Phase 1 SQL nor a database reset should be repeated. No hosted SQL or data mutation was performed.

Local PostgreSQL execution tests passed for the migration, tenant authorization, duplicate submission, worker leases, interrupted dispatch recovery, output reservation, storage recovery, usage ledger, daily limits and budget admission. These do not establish hosted migration success.

## Current capability/pricing verification

Official Sunburst/Flare model pages, image guide and API pricing were retrieved on this date. Sunburst is recommended for editing precision and is now the pinned default; Flare remains selectable by server configuration. Both support Images API reference editing. The application keeps high as its maximum quality and the existing supported canvases rather than enabling experimental larger outputs before a cost measurement.

Standard direct Images API rates for both 2.5 models, USD per million tokens:

| Token category | Rate |
| --- | ---: |
| Text input | 5 |
| Image input | 8 |
| Image output | 30 |

Text output is not billed for these image-only models. Cached/Batch discounts are not used by this endpoint. Cost estimates remain null when provider breakdowns/rates are insufficient; no zero-cost success is invented. Actual provider invoices remain authoritative.

Sources:

- https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst
- https://developers.openai.com/api/docs/models/gpt-image-2.5-flare
- https://developers.openai.com/api/docs/guides/image-generation
- https://developers.openai.com/api/docs/pricing

Retrieved Markdown SHA-256 values:

- Sunburst: `09fa5cd4e0a0fb559c2646aa02c99274d0a8842df4a9cb0f993ae16881f12cf8`
- Flare: `24567a412f95a959795e193b7571edcc5c27d0f6b760750c3e38e70c7e89dd68`
- Image guide: `8e9337b4b505536c2785e90c7298b41537e6a61f27d81caa069d9467787e3fe5`
- API pricing: `93d302a9b7a384877533bc3ab5bb48eebf4b56bd6add0f194095054b2a13f952`

## Spending safeguards and test results

Production processing remains disabled. Enabling requires a key, explicitly configured operation reservation, per-user/global daily budgets, and versioned prices. Existing SQL serializes admission and enforces daily operation limits, one active operation per user, shared budget reservations, and output storage reservations. One output is requested, default global concurrency is one, unknown billable outcomes are never automatically retried, and storage recovery cannot regenerate an image.

A reservation is an application admission limit, **not a per-call provider dollar ceiling**. Already admitted work and underestimated reservations can exceed intended spend. OpenAI project billing limits, available credit, alerts and any automatic recharge configuration cannot be inspected using this image API key. No billing settings were changed. Real generation cost and quality remain unmeasured because the provider rejected the request.

Executed after the correction:

- `npm run test:unit`: **43 passed, 0 failed, 0 skipped**; providers/stores mocked only inside automated tests, local SQL and image decoding real.
- `npm run build`: Vite production build and TypeScript compilation passed.
- `npm run check:processing`: correctly blocked, exit 2, processing disabled and hosted schema 404/PGRST202.
- Provider-only real edit: **failed**, one request, exhausted credit.
- Three-mode real-service integration: not run; hosted migration prerequisite missing.

Previously recorded browser tests were not presented as live API verification. The canonical production website is `https://sonkoflow.com/`; this cloud allowlist has not yet added that hostname, so no custom-domain deployment claim is made.

Immediate manual blocker: add API credit to the organization owning the dedicated SONKOFLOW OpenAI project. Existing key authentication succeeded; regenerating or sharing the key is unnecessary. Database migration access and full workflow verification remain pending after billing is available.
