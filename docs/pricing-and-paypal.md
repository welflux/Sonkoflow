# Pricing, allowances and PayPal deployment runbook

This review branch adds `/pricing`, the plan selector, `/app/checkout`, `/app/welcome` and `/app/billing`. It does not merge main, deploy the website, activate billing, buy API credit, create merchant plans or take a real payment. The implementation audit is in [pricing-implementation-audit.md](pricing-implementation-audit.md).

## Catalog and entitlements

| Offer | USD charge | Processing units | Feature entitlement |
| --- | ---: | ---: | --- |
| Free | 0 | 20 once | One Low square edit; no AI vision; 3 projects/10 images/25 MiB |
| Starter monthly | 9 monthly | 100 per verified payment | Low/Medium, packs, Brand Studio, up to 3 bulk sources |
| Starter annual | 86.40 yearly | 1,200 up front per verified payment | Same Starter tools for the paid year |
| Pro monthly | 19 monthly | 250 per verified payment | High option, packs, Brand Studio, up to 5 bulk sources |
| Pro annual | 182.40 yearly | 3,000 up front per verified payment | Same Pro tools for the paid year |
| Small one-time pack | 5 once | 50 once | Pay-as-you-go Low/Medium and packs |
| Studio one-time pack | 15 once | 200 once | Same pay-as-you-go tools |

Paid storage stays at the existing 100 projects/100 images/250 MiB limits. Bulk limits are source ceilings, subject to existing total image/storage reservations; a complete five-view pack at maximum output size may not fit five sources. Operator concurrency, quality, model and global spend limits can lower availability. They never grant additional paid capacity.

One unit represents $0.01 of configured uncached provider-cost allowance. It is not one image, currency redeemable for cash, or a promise of fixed output counts. Units stay in the existing pooled wallet while the account exists. Annual is not a monthly refill: all units are granted up front after actual annual payment. Price/unit amounts exist both in `server/billing/catalog.ts` and the immutable offer snapshot migration; changes require coordinated versioned review.

A subscription cancellation stops future renewal and retains features through the verified paid period. Unused units and projects remain. After that period, a customer with unrefunded purchased capacity has pay-as-you-go access: no High, bulk or Brand Studio generation. A subscription upgrade/downgrade or replacement cannot overlap an existing paid subscription/pending approval; there is no unsupported proration.

Refund notifications remove proportional units once (rounding cumulative refunded allocation upward). Consumed units can create debt, which stops new work. Existing holds are not erased. Refund rights, tax treatment, legal seller identity and support obligations are business disclosures to review before public activation. Chargebacks/reversals and unusual adjustments require merchant reconciliation; automated dispute processing is not claimed.

## Authentication and verification

The selector POSTs an exact server-known offer to create a durable checkout intent before either registration or sign-in. A random HttpOnly, SameSite=Lax cookie carries an opaque token, never a paid entitlement. The checkout stores only its hash. Signup also stores an HMAC email fingerprint for same-user confirmation on another device. Verified authentication binds the intent to one owner; mismatched owners/emails cannot claim it. Existing email/password, recovery and server-cookie sessions are reused; Google OAuth is not advertised.

Free onboarding uses the existing project creation, upload and processing screens. The database grants at most one lifetime 20-unit sample per verified account, subject to a configurable global daily grant pool (default 10); no weekly/monthly reset. Signup and upload IP limits still apply. Failed pre-dispatch attempts can safely retry; a dispatched/uncertain free job cannot be recreated as a fresh sample.

PayPal approval returns to `/app/checkout`; query strings never grant capacity. A one-time approved order can be captured by the backend, but only a verified webhook grants the receipt. The webhook verifies the PayPal signature through PayPal's verification endpoint, then re-reads the actual capture/order/subscription/refund. It checks merchant, amount, USD currency, checkout binding and preconfigured plan. Atomic receipt/event IDs prevent duplicate grants across refreshes, reordered notifications or duplicate event IDs. Missing/ambiguous references return a retryable error, not a fabricated successful purchase.

Supported automatic notifications: `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.SALE.COMPLETED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.SALE.REFUNDED`, and subscription cancellation/suspension/expiry/payment failure. Unknown notifications are signature-verified and acknowledged without grants. Applied event hashes, receipts, refunds, subscription state and all unit ledger changes persist. This is not a general merchant accounting/chargeback system.

## Metering rules

Standalone edits now use `pack_credit_accounts`, `pack_credit_reservations`, and `usage_events`, extending the existing pack/bulk ledger. No second allowance wallet exists. The global database budget lock and wallet locks protect admission against concurrent overspend. Every dispatch requires an intact reservation and a non-deficit wallet.

The quote uses the complete controlled server prompt, reviewed source bounds and model/quality/canvas token estimates. It reserves the greater of the configured operation floor and twice the standalone estimate, plus separate optional vision capacity. Free ignores the general floor but still requires twice its estimate to fit 20 units. Pack/bulk quotes retain their existing configured estimate multiplier/floors and one reservation per child operation. Reservations are temporary, not fixed prices or provider invoice guarantees. Actual reported token cost settles units upward to the next unit; unused holds release. Provider cost above the hold creates a deficit and blocks future work. Unknown billed outcomes remain held for reconciliation, with no blind replay.

Uploading, organization, downloads, local image checks and direct logo compositing do not spend AI units. Each generated pack view is a separate edit; each bulk source requests its own pack. Customer-requested corrections are fresh, quoted edits. Safely undispatched failure/cancellation releases its hold; an invalid image or storage failure after provider usage does not erase incurred usage. Existing independent generation/assessment usage checkpoints and unknown-outcome handling remain.

## Activation sequence — not executed by this change

1. Apply all existing migrations in order through `202610280007_commerce.sql` in a reviewed staging database first. Installation leaves `billing_settings.enabled=false`, preserving existing noncommercial behavior. Verify ownership/RLS and worker versions before enabling commercial traffic.
2. Fund OpenAI later as planned. Calibrate real output token usage for each allowed quality/canvas and source bound, including optional vision and retries. Confirm current official rates for the exact configured model. Set a conservative model-matching `AI_PACK_TOKEN_ESTIMATES_JSON`, `AI_PACK_INITIAL_CREDITS=0`, `AI_PACK_CREDIT_MICRO_USD=10000`, explicit daily dollar budgets and reservation floors. A $1 reservation floor requires 100 units per output and can make Starter packs unavailable; do not advertise fixed image counts. Change floors only with measured cost evidence. The application cannot guarantee provider spending or gross margin; configure independent provider project budgets/alerts too.
3. Configure separate PayPal sandbox credentials exclusively on the backend: `PAYPAL_MODE=sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID`, `PAYPAL_WEBHOOK_ID`. Precreate ACTIVE recurring plans with exactly one infinite regular cycle, no trial/setup fee/tax, USD 9/19 per month or 86.40/182.40 per year. Store IDs in `PAYPAL_PLAN_IDS`, e.g. keys `starter_monthly`, `pro_monthly`, `starter_annual`, `pro_annual`. Do not use invented IDs. Server validates actual plan details each creation/payment. Annual pricing is visible for review. Annual checkout remains blocked until both annual IDs and billing activation are present. Apply `202610290001_annual_prices.sql` (or synchronize the same two catalog rows while purchasing is disabled) before deploying the new annual catalog; do not reuse merchant plans with the old amounts. The 20% discount is against twelve monthly payments. Essential, Studio and Signature map to provider low, medium and high settings; the names do not change cost or output guarantees.
4. Configure the matching PayPal application webhook at `https://sonkoflow.com/api/billing/webhook`, with the supported events above. Use matching sandbox/live webhook IDs and credentials; never mix environments. The managed development runtime must allow the exact outbound host `api-m.sandbox.paypal.com` for sandbox or `api-m.paypal.com` for live. Supabase and OpenAI allowlists remain separate. These are API destination hosts, not the website/custom domain. No network policy was changed here.
5. Drain existing workers/holds and reconcile any legacy internal balances explicitly. Do not zero or convert balances automatically. The service-only `activate_commerce(true,10)` RPC refuses activation without explicit review, with active/uncertain work, held reservations or any nonzero/mismatched legacy wallet. Run it only after reconciliation. Set `BILLING_ENABLED=1` and `BILLING_PROVIDER_VERIFIED=1` only after the provider-cost review. This dual application/database gate fails closed on schema/config mismatch.
6. Run real sandbox one-time capture, monthly and annual subscription, duplicate webhook, cancellation, failure and partial/full refund tests. Verify actual receipt, ledger and paid-through access, with real hosted migrations. Missing merchant credentials prevent those tests in this workspace. Then complete tax/legal/merchant disclosures and repeat the approved sequence with live credentials. A staging sandbox success does not establish live readiness.
7. Production publication requires separate explicit authorization. Keep `APP_ORIGIN=https://sonkoflow.com` and existing Supabase redirect allowlists correct when deployment is approved. Secrets are not committed, sent to client bundles, printed by setup checks or included in screenshots.

An approval interrupted before its provider ID is persisted retries with the same PayPal request ID; do not manufacture a new payment. Stale pending subscriptions block competing subscription creation until the original is cancelled/reconciled, avoiding double billing. Out-of-window provider idempotency and disputes require operator reconciliation. For unknown usage, inspect persisted request IDs and actual provider invoices before deciding a correction; there is no automatic unconditional credit refund.

## Verification evidence

Automated tests use mocked provider replies only inside tests, real PGlite PostgreSQL policies, and Chromium against the built app. Production provider code calls PayPal/OpenAI over the configured secure transport. No paid OpenAI request, real PayPal payment, hosted SQL migration, billing activation, deployment or production merge was performed in this phase. Final check counts and commit are recorded in the completion report.

References: [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [PayPal Orders v2](https://developer.paypal.com/docs/api/orders/v2/), [Subscriptions v1](https://developer.paypal.com/docs/api/subscriptions/v1/), [webhook verification](https://developer.paypal.com/docs/api/webhooks/v1/#verify-webhook-signature_post), [Payments v2](https://developer.paypal.com/docs/api/payments/v2/).
