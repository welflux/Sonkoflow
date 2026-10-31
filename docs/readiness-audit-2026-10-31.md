# SonkoFlow readiness audit — 31 October 2026

## Assessment

The deployed application is prepared for controlled provider testing, with new
engines deliberately disabled. This audit does not establish successful paid
generation, photographic fidelity, settled provider costs, or commercial launch
readiness. Buying credits alone does not complete provider activation.

No provider generation calls, credit purchases, customer-data changes, hosted
migrations, billing activation or engine activation were performed in this audit.
Application layout and approved content were preserved.

## Live, read-only findings

- Release checks: 13/13 passed, including HTTPS, backend health, pricing, public
  routes, account shell, anonymous session rejection and workspace protection.
- Authentication-origin checks: 7/7 passed. These test request boundaries without
  signing in, creating accounts or sending recovery messages.
- SEO checks: 46/46 passed, including canonicals, sitemap, robots, structured data,
  private-route indexing protection and missing legacy routes.
- Public link crawl: 13 pages, 54 unique internal destinations, 664 references;
  no failed internal destinations or public section anchors. Includes page-linked
  assets and the public sign-in, sign-up and recovery routes. The external legal
  regulator link returned HTTP 200. This is a point-in-time crawl, not a guarantee
  about every account-specific or future link.
- Deployed application bundle SHA-256 matched the local release build:
  `47ceca09bc3af9521f9fe7ab3e32faa3c649c7b3c701c00c852a907837a58b70`.
- Live responses included CSP, HTTPS transport security, content-type protection
  and referrer restrictions. TLS verification remained enabled.
- Supabase backend authentication, seven checked table schemas and private photos
  bucket settings passed. Processing, quality and pack schema-version checks
  passed. No migration was rerun; account details and credentials were suppressed.
- The live public pricing endpoint reports checkout disabled.

## Local verification and repairs

- Production build and TypeScript compilation passed.
- All 191 unit/database checks passed, using local fixtures and isolated PGlite
  where appropriate; provider fixtures do not establish live API compatibility.
- Production dependency audit reported zero known vulnerabilities. This checks
  the advisory registry, not an assurance that no vulnerabilities exist.
- Three outdated browser expectations were corrected: the old homepage heading,
  pre-publication legal-page notice, and old pricing-page title. The application's
  approved pages were not changed to satisfy those checks.
- The complete dashboard/account/legal/processing browser run covered 426 checks
  across desktop, tablet and mobile: 417 initially passed and nine instances of
  the three outdated expectations failed. All nine corrected checks then passed
  in a targeted rerun. No unresolved browser failures remain in the audited suite.
- All 33 separate homepage browser checks passed, covering navigation, images,
  layout, keyboard controls, typography, animation and reduced-motion behavior.
  Total distinct browser checks covered: 459. Authenticated workflows in this
  local suite use explicit API fixtures, not real customer credentials or funded
  provider output.
- The initial restricted-shell HTTP tests encountered local socket restrictions;
  the complete unit suite passed after rerunning with local-socket access. This
  was an execution-environment limitation, not a deployment failure.

Reproduction commands: `npm run build`,
`node --import tsx --test --test-concurrency=2 tests/unit/*.test.ts`,
`npm run test:browser -- --workers=2`, `npm test -- --workers=2`,
`node scripts/verify-release.mjs`, `node scripts/verify-auth-origin.mjs`,
`node scripts/verify-seo.mjs`, `npm run check:services`,
`npm run check:processing`, `npm run check:engines`, `npm audit --omit=dev`.
`check:processing` deliberately reports incomplete/disabled processing here;
this is an expected activation gate, not a passing paid-generation check.

## Before the controlled provider comparison

1. Supply Topaz and Claid secrets to the separate coding/test environment, or use
   a controlled server test environment containing the saved Hostinger secrets.
   The owner saved the Hostinger variables and provided a completed-deployment
   screenshot, but their masked values and actual runtime presence cannot be
   independently verified through this session's tools. Do not expose keys in
   chat, screenshots or source files.
2. Confirm account funding or usable trial balances, select an explicit test
   budget, and provide three distinct permitted originals: portrait, product and
   commercial photography. No spending limit has been approved yet.
3. Review current account-specific rates and configure versioned provider prices
   and shared reservation/daily budgets. Determine the exact approved Topaz
   output storage prefixes from genuine provider delivery information.
4. Run the explicitly armed comparison command described in
   [multi-engine-processing.md](multi-engine-processing.md). Record real outputs,
   identity/label/geometry reviews, timings and settled invoice costs. Repeat for
   each operation/scale that will be offered. No fabricated successful results or
   automatic approval reports are permitted.
5. Install approved private verification reports, enable only verified operations,
   and validate authenticated upload, quote, reservation, dispatch, download,
   history, failure and reconciliation paths in a controlled live workflow before
   opening them to customers. Keep all new switches off until that review passes.

The local preflight confirms the new providers are disabled and unverified. It
also reports global processing disabled in this coding environment. This local
result is not evidence of Hostinger's actual secret values or runtime switches.

## Separate commercial launch gate

Payment-provider setup, sandbox payment/refund/webhook verification, provider-cost
calibration and existing billing activation gates must be reviewed before paid
customer launch. See [pricing-and-paypal.md](pricing-and-paypal.md). No checkout or
billing flags were changed by this audit. Previously verified user sign-in and
recovery were not repeated using a live customer's credentials in this audit.
