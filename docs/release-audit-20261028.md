# Production release audit — 28 October 2026

Requested target: `https://sonkoflow.com`, repository `welflux/Sonkoflow`. The owner explicitly authorized production publication after inspection. Review baseline is `7289db6`; the production Git ref was independently read as `075dcaa0cc6b64ca6b6b390ab242c25f702d246b`. The review branch contains the complete accumulated Phase 1–7, pricing/commerce, public identity and authentication stack; it is not a separate rebuild.

## Local results

- Production build passed (Vite client entries and TypeScript server).
- Full unit/database/HTTP/security suite: 147 passed, 0 failed.
- Desktop/mobile application suite: 88 passed, including existing uploads/projects/library/processing/brand/pack/bulk paths and account/pricing continuity.
- Desktop/tablet/mobile landing suite: 18 passed.
- Dependency audit: 0 known vulnerabilities (info/low/moderate/high/critical all zero).
- Additional guarded release-migration checks: 2 passed. One verifies upgrading a foundation database while preserving an existing owner/project and keeping billing disabled. The other forces a downstream failure and verifies the entire migration rolls back to the original schema. Reapplying the completed bundle is explicitly refused.
- Public and account screenshots from the prior reviewed production build remain available; no genuine generated result or real payment is invented by those previews.

## Code and security inspection

Authentication continues through Supabase with encrypted server-side sessions and owner-scoped database clients. JSON mutations require the configured exact Origin; recovery sessions retain their limited scope. Google uses a server-created encrypted PKCE/state cookie, S256, provider identity verification and a fixed callback; the real upstream authorization and cancellation callback were checked after the owner changed Supabase URLs and now return to the custom-domain app callback.

Images are read/normalized with Sharp, bounded in size/pixels, stored in the existing private bucket and served through owner-authorized backend routes. Job, pack, batch, brand and library mutations reuse the current architecture and service-only RPCs. Output existence/validation precedes reported generation success. Durable leases, reserved balances, idempotent submissions/receipts, reported provider usage, timeout recovery and unknown-outcome holds remain in place. No browser API secrets, invented successful provider responses or public customer-image URLs are introduced.

Billing is intended to stay OFF (`BILLING_ENABLED=0`) for this publication. Live PayPal credentials, merchant ID and webhook were entered by the owner in Hostinger; they are not available in this workspace and were not copied, printed or independently verified. The backend separately requires calibrated provider configuration, database activation and provider-verification flags before it can grant commercial access. Merchant subscription plan IDs and genuine payment/capture/refund/webhook tests are still outstanding. OpenAI funding and measured cost calibration remain deferred by the owner, so paid image tests were not repeated.

Legal pages are deliberately reserved titles with a publication notice, as explicitly requested by the owner. They are not final terms/privacy disclosures. Retention maintenance, backup/restore arrangements, hosted mail delivery and final legal/merchant documents remain operational launch requirements; no certifications, commercial licence or uptime guarantees are asserted.

## Live inspection and release gates

Read-only Supabase calls used existing scoped credentials without displaying customer records. The `photos` bucket returned HTTP 200, is private and permits WebP. The foundation processing table exists. However **all seven later version RPCs returned HTTP 404 / PGRST202**, and `billing_settings` returned HTTP 404 / PGRST205. The full review stack cannot be called operational against this foundation-only database.

The application key cannot execute arbitrary SQL; no Supabase management token, direct database password or database connection URL is available here. The exact pending migrations are prepared in `release/20261028-pending-migrations.sql`, generated from the existing checked-in migrations by `scripts/prepare-release-sql.mjs`. Each original file is identified with its SHA256; the bundle uses one transaction, guards against partial/repeated installation, checks the private bucket and existing work, and leaves purchasing disabled. It does not reset data, create a payment, call OpenAI or activate commerce. It must be executed once through the authorized Supabase SQL Editor or an authenticated database-management connection before a complete feature release.

No authenticated Hostinger connector or Hostinger API token is available in this task. The current repository is already configured in the owner's hPanel for Git deployment, but actual build settings, environment variables, restart status and runtime logs cannot be independently read here yet. Preserve the existing environment values; never replace a masked variable list with incomplete values. Required production settings include `APP_ORIGIN=https://sonkoflow.com`, `AI_PROCESSING_ENABLED=0` while funding/cost verification is deferred, the existing correct session/rate-limit keys, `AUTH_GOOGLE_ENABLED=1` after its verified provider setup, and `BILLING_ENABLED=0`. Node must be 22.12+ with the existing Express root entry `server.js` and build/install hook.

The managed workspace's enforced outbound policy excludes `sonkoflow.com`. An additive environment draft adding that exact domain, while preserving existing hosts, was saved and requires publication before direct live verification can work. This affects the audit runner, not customer DNS. No DNS, MX/email record, nameserver or hosting plan was changed.

## Release procedure and rollback

1. Execute the guarded migration through an authenticated SQL Editor and read back all seven version numbers; confirm billing remains disabled.
2. Confirm the production app environment/build target without exposing or replacing existing secrets. Keep purchasing disabled; processing remains conditional on funding/reviewed limits.
3. Fast-forward the checked release commit to production `main` (no force push), allowing the existing Hostinger Git deployment to build the complete source. Keep the previous main SHA above as the rollback reference. Do not declare deployment complete from a successful Git push alone.
4. Run `node scripts/verify-release.mjs https://sonkoflow.com` after network access is applied. Verify the custom-domain TLS response and actual new page/asset fingerprints, public auth/catalog endpoints, health, protected-route/session behavior and correct callback destination. Verify the Hostinger build/runtime result if connection is supplied. A 200 placeholder is not release evidence.
5. If runtime or regression verification fails, use an explicit code revert/redeployment to the recorded main baseline while retaining additive database changes and customer data. Do not reset the database or erase live records as a rollback shortcut.

Publication is pending the external migration/access gates; this report is an audit result and release preparation, not a claim of a completed deployment.

## Hosted migration verification after owner execution

The owner executed the exact guarded bundle through Supabase SQL Editor. Independent read-only API checks then returned HTTP 200 for all seven version functions: processing `2026102801`, product quality `2026102802`, product packs `2026102803`, brand `2026102804`, batches `2026102805`, library `2026102806`, and commerce `2026102807`. The private `photos` bucket remains private with WebP uploads, and `billing_settings.enabled` is `false`. The migration gate is cleared; do not rerun the bundle. No payment or image-generation call was made during verification.

The owner has authorized publishing the audited source to production main. The separate managed-environment network draft still needs publication to permit custom-domain smoke checks. Git publication alone does not establish that Hostinger built or served this release. The hosting environment and deferred provider/merchant tests remain subject to the checks above.

## Custom-domain publication verified

After the owner published the network draft, the enforced policy included `sonkoflow.com`. Production main was independently confirmed at `aac3252573828e628197effeca069d8e4110bf0c`. The custom domain served the new homepage identity and account shell, the current Starter/Pro catalog, working health endpoint, expected anonymous 401 session response and protected-workspace redirect. All 13 non-billable release smoke checks passed over HTTPS with normal certificate verification. The verification helper was corrected to preserve blank lines in HTML bodies rather than treating them as additional header boundaries.

The live public capability response reports Google sign-in disabled (`google: false`), and checkout disabled (`checkout_enabled: false`). Hosting must enable `AUTH_GOOGLE_ENABLED=1` with the already configured provider before Google sign-in can be tested end to end. No real customer Google login, paid generation, payment, capture, refund or webhook delivery was tested. The private hosting environment and logs remain unavailable here; the public checks establish observed live behavior, not a complete production transaction test.
