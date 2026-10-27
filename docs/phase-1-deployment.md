# Phase 1: architecture, setup, and release gate

## Prioritized plan and current status

Latest results are in [phase-1-verification.md](phase-1-verification.md): the hosted migration, backend authentication, two-account private-storage test, and backend recovery checks have now passed. Real email delivery and actual Hostinger plan compatibility remain outstanding. The original setup instructions below describe the procedures, not evidence that those remaining checks succeeded.

1. **Implemented locally:** retain the approved Vite marketing page; add a separate responsive application entry and TypeScript/Express backend; add Supabase Auth/PostgreSQL/private-storage integration, SQL migration, encrypted server sessions, project/profile APIs, original-image upload/retrieval/deletion, shared rate-limit functions, quotas, and local verification.
2. **Owner setup:** create one Supabase development project and a Resend sending domain; connect them using the instructions below. Connect Hostinger or identify the actual plan/site so runtime and proxy details can be verified. No services have been purchased or provisioned by this task.
3. **Integration gate:** apply the migration to development, execute live integration tests, verify actual signup/confirmation and password-recovery email delivery, verify storage policy and restart persistence. These checks are currently blocked by missing external configuration.
4. **Deployment gate:** verify the actual Hostinger runtime/build settings and resource limits, configure secrets, deploy to an approved target, verify production TLS/cookies/rate-limit proxy behavior, backups, and operational procedures. Only then open real customer access. This document is not evidence that deployment or hosted integration has succeeded.

## Architecture decision

Use the existing **Vite frontend**, a same-origin **Node.js/Express 5 TypeScript backend**, **Supabase PostgreSQL/Auth/Storage**, and **Resend SMTP connected to Supabase Auth**. There is no browser Supabase client and no browser-accessible privileged key. This retains the existing framework and marketing design and avoids operating a separate identity server, database host, and object store. No paid features are provisioned automatically. Free service tiers are suitable only for evaluation, not an assumed production entitlement or availability guarantee; review current pricing, quotas, backups, and region options before production.

The Hostinger `deploy-to-hosting` skill documents Express/Node deployment on Business and Cloud plans. It does not establish the user's plan, runtime versions, resource allocation, or exact control-panel UI. No authenticated Hostinger connection exists. Attempts to fetch live Hostinger/Supabase documentation from this cloud machine returned network-policy 403 responses; exact current account options and provider pricing are not verified. These are explicit compatibility gates, not assumed capabilities. The Node deployment requires a currently supported Node version **22.12+**, package installation (including Sharp platform binaries), build tooling, outbound HTTPS to the selected Supabase project, an assigned port, and a persistent web process. All lasting customer records/objects reside in Supabase, so Hostinger filesystem persistence is unnecessary.

If the user's Hostinger plan cannot run this Node app, do not deploy it as a static app or silently remove the backend. Choose an eligible Hostinger Node plan or obtain approval for a different backend host. There is no Phase 1 background worker. The supplied maintenance command can run from an approved external scheduler/CI runner; Hostinger cron/worker support is not assumed.

## Exact manual setup

### 1. Supabase

Dashboard: <https://supabase.com/dashboard> → **New project**.

- Use a dedicated development project first. Choose the region appropriate for your customers and any data-residency requirements; the user's jurisdiction/region must be confirmed before production. Keep the database password in a password manager. Do not send it in chat.
- In **Project Settings → API / API Keys** (labels may vary by dashboard version), obtain the project URL, publishable key (legacy anon key also works), and backend secret key (legacy service-role key also works). Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` in secure server environment settings. The secret key bypasses RLS: restrict it to the backend and operational runner.
- In **SQL Editor → New query**, review and execute `supabase/migrations/202610270001_foundation.sql` once on the new project. It runs in one transaction. Do not rerun a committed migration; record the applied filename/hash and execution result in your release log. Subsequent changes require new migration files. Do not apply this migration blindly to an existing project with conflicting tables or storage policies.
- In **Storage**, verify that bucket `photos` exists, is **private**, allows only `image/webp`, and has a 10 MB file limit. The migration creates it. Review all existing `storage.objects` policies: unrelated broad policies must not expose this bucket. Do not add public read, authenticated upload, or overwrite policies. The backend validates and writes objects using its server identity; authenticated users can only read their own ready objects.
- In **Authentication → Providers / Sign In → Email**, enable email/password and require **Confirm email**. In **URL Configuration**, set **Site URL** to the actual `APP_ORIGIN`, with no trailing slash; add the exact `/account/confirm` URL to the redirect allowlist. Do not add wildcard production domains.
- In **Authentication → Email Templates**, use token-hash links rather than the default browser implicit-session redirect:

Signup confirmation link:

```html
<a href="{{ .SiteURL }}/account/confirm#token_hash={{ .TokenHash }}&amp;type=signup">Confirm your SONKOFLOW account</a>
```

Recovery link:

```html
<a href="{{ .SiteURL }}/account/confirm#token_hash={{ .TokenHash }}&amp;type=recovery">Reset your SONKOFLOW password</a>
```

The browser removes the fragment from its address bar before submitting the token. Confirmation requires an explicit click. The server exchanges a single-use token and issues an opaque HttpOnly cookie; provider tokens never enter browser storage.

- Set suitable provider auth rate limits, password minimum of at least 12 characters, and token expiry. Test expired/reused links and email enumeration behavior using actual messages. Do not treat built-in development mail delivery as a production SMTP service.

### 2. Resend transactional mail

Dashboard: <https://resend.com/domains> → **Add domain** → add a domain/subdomain you control (for example, `mail.your-domain.example`). Copy the exact DNS records Resend supplies into the authoritative DNS dashboard, preserving existing mail and verification records. Wait for verified status.

At <https://resend.com/api-keys>, create a **Sending access** key restricted to that domain. Enter it directly into **Supabase → Authentication → SMTP Settings → Enable custom SMTP**:

- Host: `smtp.resend.com`
- Port: `465` (TLS)
- Username: `resend`
- Password: the restricted Resend sending key
- Sender: an address on the verified domain; choose an actual monitored support/reply address separately.

Verify current values in Resend's SMTP dashboard before saving. No Resend key is needed in the application or browser. Test actual confirmation and recovery messages end-to-end. No secret values should appear in screenshots, logs, commits, or chat.

### 3. Local server configuration

Run `npm run setup:local` to create an ignored, owner-readable `.env` containing independent local encryption/rate-limit keys. It preserves existing files and never copies Supabase credentials. Add the Supabase values through secure process settings, or edit your own local `.env` privately. For production, generate separate keys and configure all variables in the hosting environment. Never prefix these variables with `VITE_`.

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development` locally; `production` on Hostinger |
| `PORT` | Host-assigned listening port; local default 3000 |
| `APP_ORIGIN` | Exact origin; local Vite origin `http://localhost:5173`; deployed HTTPS origin |
| `SUPABASE_URL` | Project HTTPS endpoint |
| `SUPABASE_PUBLISHABLE_KEY` | Server-side user-scoped API client |
| `SUPABASE_SECRET_KEY` | Backend-only session, storage-write, and maintenance identity |
| `SESSION_ENCRYPTION_KEY` | 64 hex characters generated independently with crypto; encrypts provider tokens at rest |
| `RATE_LIMIT_KEY` | Independent random secret of at least 32 characters; HMAC of rate-limit identifiers |
| `TRUST_PROXY_HOPS` | Defaults to 0; set only after confirming Hostinger's trusted proxy chain |

For this managed cloud workspace, also add the actual project hostname (for example `<project>.supabase.co`) to the environment network allowlist after creating the project. Saved environment changes must be applied before live tests can reach the service. No guessed project endpoint or secret binding has been added.

Generate each random key separately using the command in `.env.example`; save the result directly into secure settings. Rotating the encryption key invalidates existing sessions; clear session records at rotation. Do not log generated keys. The cloud configuration's proxy-backed HTTPS secret placeholders cannot be used as local encryption key material; local cryptographic keys require actual secure process values.

```sh
npm ci --cache /workspace/.npm-cache
npm run build
npm run check:services
npm run dev:server
# in another terminal
npm run dev
```

Vite proxies `/api` to local port 3000. Open `/account/signin` or `/app` through the development frontend. Without external configuration the service explicitly returns 503 for account APIs; it never fabricates sessions or stored results. Production startup rejects missing configuration.

### 4. Hostinger Web App

In <https://hpanel.hostinger.com>, open **Websites**, identify the intended site and eligible Node.js hosting plan, and open its Node.js web app deployment/build settings. The exact wizard differs by plan; use the Node/Express app option, not static-only hosting. Connect GitHub only through hPanel's authorized flow if using automatic deployment.

Expected settings to verify against the actual plan:

- Framework/runtime: **Express / Node.js**, Node **22.12+** (prefer the supported LTS offered by the plan).
- Install: `npm ci` with development dependencies available for the build.
- Build: `npm run build`.
- Server entry: `server.js`, or start command `npm start` where supported. The root entry imports the compiled backend. A `postinstall` hook runs the existing production build; its compiler/build dependencies are installed even when development dependencies are omitted. The Express wizard can therefore use its npm/server.js defaults.
- Output: preserve both `dist/` (assets/HTML) and `build/` (server JavaScript); working directory must be the repository root. Never publish the repository itself as a static document root.
- Listening: platform `PORT`, bound to `0.0.0.0`; HTTPS termination and app-origin forwarding verified.
- Environment: set the server variables above in the app's environment settings. Keep all preexisting settings; do not blindly replace them. Restart/rebuild when required by hPanel.
- Trusted proxies: default 0 ignores forwarded client-IP claims and may group customers under the proxy's rate bucket. Set `TRUST_PROXY_HOPS=1` only if there is exactly one trusted ingress hop and the app cannot be reached directly; otherwise verify the correct topology first. Do not trust arbitrary client `X-Forwarded-For` headers.
- External connectivity: allow outbound HTTPS to the selected `<project>.supabase.co` endpoint. No direct database TCP connection is used by the runtime; Supabase's HTTPS Data API enforces user JWT RLS.
- Production checks: `/api/health` is process liveness only. Verify login, storage, secure cookies, origin rejection, isolation, and host restart persistence separately. Do not treat a liveness response as service readiness.

No deployment, purchases, account creation, or DNS edits have been performed. Confirm the exact target before overwriting an existing site.

## Data and security implementation

`profiles` is created by an auth-user trigger. Projects carry a validated audience. Composite foreign keys prevent linking images/jobs/usage to another user's resources. Authenticated users receive narrowly scoped profile/project privileges and read-only image/job/usage access; every user-facing query uses that user's JWT and RLS. The backend's privileged storage mutations are preceded by a user-scoped ownership lookup. Private object keys are random UUID-based paths, not public image URLs. Downloads proxy bytes through current authentication and RLS with `private, no-store` and safe fixed filenames.

Session cookies contain 256-bit random opaque values, not provider JWTs. Only their SHA-256 hashes are stored; access/refresh tokens are AES-256-GCM encrypted with a separate server key. Provider identity is verified per request. Sessions expire after seven days, refresh under a database lease, and are deleted on logout. Recovery sessions expire after 15 minutes and cannot access normal APIs. Password updates require a recovery session and invalidate app sessions. Cookies are HttpOnly, SameSite=Lax, and use Secure with a __Host- prefix in production. Mutating endpoints require the exact configured Origin. Rate counters live in PostgreSQL rather than an ephemeral process store. Requests, bodies, upload bytes, pixels, image count, total image bytes, and concurrent in-process decodes are bounded. Only normalized, metadata-stripped, non-animated WebP is retained; the unmodified source file is not kept. The UI discloses that normalization. Decide separately if byte-identical archival originals are needed in a later phase.

Foundation limits: 100 projects per account, 100 stored images and 250 MB per account; input maximum 10 MB, 25 megapixels, minimum 64 × 64; JPEG/PNG/WebP only. These are operational safeguards, not paid entitlements. No AI processing or credit billing occurs. Usage events record completed uploads and deletions idempotently; processing/job schema exists but no processing execution is enabled. Downloads are not usage-billed.

`app_sessions` and `rate_limits` are inaccessible to user identities. Failed uploads leave durable pending records when cleanup fails; deletion failures retain a deleting record. These states are visible for retry/reconciliation rather than claimed as complete. Run `npm run maintenance` daily from a trusted configured runner: it reconciles at most 100 interrupted objects older than 24 hours, removes expired sessions, and prunes old rate counters. It does not delete valid ready images. Review the selected database/storage backup, restore, and alerting options before production; database backups do not automatically establish object-file backups. User account deletion requires an owner-run object-first deletion procedure until an audited self-service account deletion flow is separately authorized.

Errors use stable codes and request IDs; server logs omit credentials, image contents, and token-bearing URLs. Configure the hosting access logger likewise, especially for authentication routes. Supply legal identity, contact, privacy/retention disclosures and terms before accepting customer photographs. Abuse monitoring, real mail delivery, restore drills, production logs/alerts and security review remain release gates.

## Verification

```sh
npm run typecheck
npm run build
npm run test:all
npm audit
```

`npm run check:services` reports variable presence only and performs read-only auth/schema/private-bucket checks once bindings are available. It never prints credential values or account data. Supabase requests honor inherited HTTPS proxy/NO_PROXY settings and retain CA/TLS verification. These read-only checks do not substitute for live integration tests.

Local database tests execute the actual migration and RLS in PGlite (real PostgreSQL compiled to WASM) with minimal auth/storage schema fixtures. They validate SQL logic; they do not validate Supabase Auth servers, hosted Storage APIs, SMTP, hosted privileges, or Hostinger. HTTP tests use fail-closed or unauthenticated paths with no mocked external success. Browser tests cover the marketing page and account UI under missing-service conditions; authenticated workspace browser behavior remains unverified.

For a configured **development** Supabase project only:

```sh
RUN_LIVE_TESTS=1 npm run test:live
```

This creates two temporary test identities through the real provider, verifies cookie sessions, projects, cross-tenant access rejection, a real storage roundtrip, upload retry behavior, deletion and logout, then cleans up. The test bypasses email confirmation using the administrative test-account API; therefore actual signup/confirmation/recovery delivery and single-use/expired recovery links must also be tested manually through real mailboxes. Without opt-in the live test reports skipped, not passed. Never run these tests against customer accounts or claim their results before execution.
