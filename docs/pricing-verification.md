# Pricing review verification — 28 October 2026

Baseline `45d4091`; review branch `pricing/paypal-commerce`. This extends the existing Phases 1–7 review stack. Production main was not changed and no deployment was requested or performed.

- `npm run test:unit`: **141 passed, 0 failed**. Includes 11 new commerce SQL tests (real PGlite migrations/RLS) and 8 PayPal adapter/dispatcher tests with test-only provider responses. Checks lifetime grants, global free budget, duplicate payment IDs/events, monthly/annual grants, refunds/debt, cancellation, checkout-owner binding, standalone unit reservation and settlement, lost/uncertain holds, resource admission, and guarded commercial activation.
- `npm run test:browser`: **80 passed**, desktop and mobile Chromium. Includes new dedicated pricing cards/dialog, conditional annual selection, authentication offer preservation, free onboarding/project creation, pending-payment protection and verified receipt display; previous image-processing, packs, Brand Studio, bulk and gallery workflows remain passing.
- `npm test`: **15 passed**, desktop/tablet/mobile landing regressions including the dedicated pricing navigation.
- `npm run build`: passed, Vite production bundles plus TypeScript compilation.
- `npm run typecheck`: passed during implementation; final production build also compiled the final TypeScript changes.
- `git diff --check`: passed.
- Visually inspected full pricing page and two-panel plan selector from actual Chromium screenshots. Images reuse the existing owned illustrative artwork and are disclosed as illustrative.
- Read-only official OpenAI pricing markdown fetched on this date confirmed the configured standard image and optional vision token rates. No real paid image cost was measured; free/project provider billing credit remains deferred by the user.

**Not verified live:** PayPal checkout/capture/subscription/refund or webhook delivery; real merchant plan creation; funded OpenAI image generation and token calibration; hosted SQL migrations, billing activation, tax/legal disclosures. PayPal credentials were absent. No live payment or paid API call was attempted, and no secrets were printed. Local mocks are restricted to automated tests.

Implementation groups: `pricing.html`, `src/pricing-page.js`, `src/pricing.css`; `src/billing-ui.js` and scoped commerce styles; existing landing/account/editor/pack/batch integration; `server/billing/{catalog,paypal,service,routes,meter}.ts`; migration `202610280007_commerce.sql`; environment template, audit and deployment runbook; commerce/PayPal unit and pricing browser tests.

See [audit](pricing-implementation-audit.md) for cost assumptions and [runbook](pricing-and-paypal.md) for configuration and the full activation sequence. Monthly nominal AI-budget margins are 88.9% Starter and 86.8% Pro; annual equivalents are 86.7% and 84.2%, and one-time packs are 90% and 86.7%. These exclude fees, infrastructure, storage, support, tax, refunds, unknown/over-reserve usage and prepaid liability; they are planning calculations, not guaranteed profit.
