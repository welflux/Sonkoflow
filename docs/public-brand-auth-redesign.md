# Public website, brand and account redesign

28 October 2026. Baseline `07f9012`, development branch `design/public-brand-auth`. The existing Phases 1–7 and pricing/commerce implementation are preserved. No main merge, production deployment, billing activation, account/data migration, paid API call or merchant change is part of this work.

## Completed interface

The homepage is rebuilt from header to footer with an editorial, image-led composition: centered hero and photographic collage; keyboard-accessible enhancement-mode tabs; product/reference and image-library panels; quality-review explanation; five-view pack planning; bulk-workflow entry; Brand Studio moodboard; an interactive warm/cool lighting study; three-step workflow; pricing navigation; service-availability disclosure; FAQs and a final account CTA. The warm/cool study is explicitly a concept image with display filters, not a claimed AI before/after result. Existing self-owned image assets and self-hosted Manrope are reused; no competitor imagery, wording, claims, metrics, testimonials or legal content is copied. No new full landing-page reference image was attached in this turn, so the supplied written layout direction and earlier visual references guided the original composition.

Shared public navigation/footer provide real destinations for current tools, protected workspace routes, pricing, account recovery and legal titles. The exact requested copyright is present: **All rights reserved © 2026 SonkoFlow, a product of AaronPrime PTY LTD.** Mobile navigation, Resources disclosure, FAQs, skip links, tab arrow/Home/End keys and the comparison slider work without framework replacement. Essential public navigation remains usable without JavaScript. Reduced-motion preferences are respected.

The new original framed-S mark and outlined SonkoFlow wordmark replace the sparkle branding in the homepage, favicon, account header, relevant workspace detail and pricing page/footer. Light and dark SVG versions are resolution-independent; transparent 2,400-pixel PNG exports are included. See `public/brand/README.md` for variants and font provenance. Existing workspace design and image-processing controls are otherwise retained.

Email signup, sign-in, verification, password recovery and password update are restyled as a responsive two-panel photographic/editorial layout. Password visibility is accessible, labels remain explicit, validation/errors are real, requests have loading protection and email workflows display provider-derived verification/recovery messages. Pricing checkout intent continues through email authentication, password recovery and optional Google authentication. API credentials and sessions are never put into local/session storage by the new auth code.

## Legal content deliberately deferred

The owner clarified during this task: display the legal titles/items now and create all legal-page content later. Accordingly `/terms`, `/privacy`, `/cookies` and `/legal` are working, branded destinations with the correct titles and a clear **Document not yet published** notice. They have `noindex,nofollow`. No policy text, fabricated business address, registration number or support email is published, and signup does not assert agreement to nonexistent final policies. Business disclosures, policy content and legal review remain necessary before public commercial launch. Earlier drafting was discarded and is not committed.

`/scripts/public-layout.mjs` is the shared static header/footer source, and `scripts/build-legal-pages.mjs` regenerates the four reserved pages. These scripts do not contact a service or publish a page.

## Optional Google authentication

`server/auth/google.ts` extends the existing Supabase authentication provider. The same existing `newSession` function creates the encrypted server-side application session. There is no competing authentication or identity database.

- `GET /api/public/auth` returns a safe capability boolean. Google stays hidden unless **both** `AUTH_GOOGLE_ENABLED=1` and the configured Supabase public settings report `external.google=true`. Provider failures return false. Availability is cached for at most 60 seconds.
- `POST /api/auth/google` retains existing Origin protection and rate limiting. It uses Supabase's real server-side PKCE flow with S256, an exact site callback and a random state. An encrypted HttpOnly, Secure-in-production, SameSite=Lax cookie holds the verifier/state for up to ten minutes; it contains no browser-readable provider tokens.
- `GET /api/auth/google/callback` clears that cookie, checks canonical encrypted cookie/state/age, exchanges the authorization code with Supabase, independently checks the provider user and verified email, then creates the existing application session. It preserves the server-owned checkout intent. Invalid/expired/cancelled callbacks return a fixed clean sign-in error; provider error text, query codes and tokens are never echoed.
- Production cookie: `__Host-sonkoflow_oauth`; development: `sonkoflow_oauth`. The existing account session cookie, ownership checks, password-recovery scope and price/entitlement checks remain unchanged.

**Hosted Google status was not verified:** the read-only request to configured Supabase public auth settings was unavailable from this runtime. No hosted provider setting was modified. Local tests run the actual Supabase SDK against test-only HTTP provider replies; this is not a real Google sign-in claim.

When ready to activate Google: configure the Google OAuth client in the existing Supabase project (credentials belong there, not in client code); register the project's `https://<project-host>/auth/v1/callback` in Google; allow the exact site callback `https://sonkoflow.com/api/auth/google/callback` with the required state query matching rules in Supabase, keeping existing email confirmation/recovery allowlists. Test the provider redirect, cancellation, verified identity, existing-account linking behavior and checkout continuation on an approved staging deployment before setting `AUTH_GOOGLE_ENABLED=1`. Use the actual configured project host, not a fabricated project ID. Repeat the verified configuration on the custom production domain only when publication is authorized. The Google client ID/secret are not requested or stored in this repository.

## Verification

**253 distinct automated checks passed:** `npm run test:unit` finished with **147 passed / 0 failed**; `npm run test:browser` finished with **88 desktop/mobile checks passed**; `npm test` finished with **18 desktop/tablet/mobile homepage checks passed**. After final vector-icon adjustments, the affected account/foundation/pricing browser subset was repeated with **26 passed** (not counted twice). `npm run build` passed after the final changes, and `git diff --check` passed. The new Google tests exercise the actual Supabase PKCE SDK with test-only provider replies, including state/cookie tampering, expiry, PKCE challenge/verifier binding, provider rejection, identity mismatch and public capability/origin handling. Visual previews were captured from the final production build using an intentionally unconfigured local server; all four screenshot routes had no horizontal overflow. Live Supabase/Google authentication and production image/payment activation remain separate verification requirements. No new database migration is required by this redesign.


Review previews are in `/workspace/artifacts/sonkoflow-public-redesign/`: `homepage-desktop.png`, `homepage-mobile.png`, `homepage-hero.png`, `signup-desktop.png` and `signin-mobile.png`. `node scripts/capture-public-review.mjs` regenerates them after a build. No real account, secret or provider image was used to capture these screenshots.
