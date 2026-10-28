import { test } from "node:test";
import assert from "node:assert/strict";
import { PayPal, paypalConfig } from "../../server/billing/paypal.js";
import { BillingService, usdCents } from "../../server/billing/service.js";
const env = {
  PAYPAL_MODE: "sandbox",
  PAYPAL_CLIENT_ID: "test-client",
  PAYPAL_CLIENT_SECRET: "test-secret",
  PAYPAL_MERCHANT_ID: "MERCHANT123",
  PAYPAL_WEBHOOK_ID: "WH-TEST",
  PAYPAL_PLAN_IDS: JSON.stringify({
    starter_monthly: "P-STARTER",
    pro_annual: "P-ANNUAL",
  }),
};
const json = (v: unknown) => Response.json(v);
function adapter(
  handler: (url: string, options: RequestInit) => Response | Promise<Response>,
) {
  return new PayPal(env, (async (url, opts) =>
    String(url).endsWith("/token")
      ? json({ access_token: "test-token" })
      : handler(String(url), opts!)) as typeof fetch);
}
const plan = () => ({
  status: "ACTIVE",
  billing_cycles: [
    {
      tenure_type: "REGULAR",
      total_cycles: 0,
      frequency: { interval_unit: "MONTH", interval_count: 1 },
      pricing_scheme: { fixed_price: { value: "9", currency_code: "USD" } },
    },
  ],
  payment_preferences: { setup_fee: { value: "0.00" } },
});
test("PayPal configuration fails closed; transport failures never expose credentials", async () => {
  assert.equal(paypalConfig({}), null);
  await assert.rejects(new PayPal({}).request("/v1/test"), /paypal_setup/);
  const p = new PayPal(env, (async () => {
    throw Error("test-secret");
  }) as typeof fetch);
  await assert.rejects(
    p.request("/v1/test"),
    (e) =>
      e instanceof Error &&
      !e.message.includes("test-secret") &&
      e.message === "paypal_unavailable",
  );
});
test("Real request shape fixes merchant, price, currency, references and idempotency server-side", async () => {
  let seen: any;
  const p = adapter((url, options) => {
    seen = { url, options, body: JSON.parse(String(options.body)) };
    return json({ id: "ORDER12345" });
  });
  await p.create(
    { id: "checkout-uuid", offer_id: "small_pack" },
    "https://sonkoflow.com",
  );
  assert.match(seen.url, /v2\/checkout\/orders$/);
  assert.equal(seen.options.headers["PayPal-Request-Id"], "checkout-uuid");
  assert.deepEqual(seen.body.purchase_units[0], {
    reference_id: "checkout-uuid",
    custom_id: "checkout-uuid",
    invoice_id: "checkout-uuid",
    payee: { merchant_id: "MERCHANT123" },
    amount: { currency_code: "USD", value: "5.00" },
  });
  assert.match(
    seen.body.payment_source.paypal.experience_context.return_url,
    /sonkoflow.com\/app\/checkout/,
  );
});
test("Subscription plans reject unexpected price, trial, tax or interval; cancellation accepts HTTP204", async () => {
  let remote = plan();
  const p = adapter((_url, options) =>
    options.method === "POST"
      ? new Response(null, { status: 204 })
      : json(remote),
  );
  assert.equal(await p.validatePlan("starter_monthly"), "P-STARTER");
  remote.billing_cycles[0].frequency.interval_count = 2;
  await assert.rejects(
    p.validatePlan("starter_monthly"),
    /paypal_plan_mismatch/,
  );
  remote = plan();
  remote.billing_cycles[0].pricing_scheme.fixed_price.value = "0.09";
  await assert.rejects(
    p.validatePlan("starter_monthly"),
    /paypal_plan_mismatch/,
  );
  remote = plan();
  remote.billing_cycles.push({
    ...remote.billing_cycles[0],
    tenure_type: "TRIAL",
  });
  await assert.rejects(
    p.validatePlan("starter_monthly"),
    /paypal_plan_mismatch/,
  );
  assert.deepEqual(
    await p.request("/v1/billing/subscriptions/I-TEST/cancel", "POST", {}),
    {},
  );
  await assert.rejects(p.validatePlan("pro_monthly"), /paypal_plan_setup/);
});
test("Approval URLs and webhook signatures cannot redirect credentials to an arbitrary host", async () => {
  let calls = 0;
  const p = adapter(() => {
    calls++;
    return json({ verification_status: "FAILURE" });
  });
  assert.throws(
    () =>
      p.approval({
        links: [{ rel: "approve", href: "https://attacker.test" }],
      }),
    /paypal_unavailable/,
  );
  assert.match(
    p.approval({
      links: [
        {
          rel: "approve",
          href: "https://www.sandbox.paypal.com/checkoutnow?token=test",
        },
      ],
    }),
    /^https:/,
  );
  const headers = {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://attacker.test/cert",
    "paypal-transmission-id": "test",
    "paypal-transmission-sig": "signature",
    "paypal-transmission-time": new Date().toISOString(),
  };
  await assert.rejects(
    p.verifyWebhook({ id: "event" }, headers),
    /invalid_webhook/,
  );
  assert.equal(calls, 0);
  headers["paypal-cert-url"] =
    "https://api.paypal.com/v1/notifications/certs/TEST";
  await assert.rejects(
    p.verifyWebhook({ id: "event" }, headers),
    /invalid_webhook/,
  );
  assert.equal(calls, 1);
});
test("Payment amount parsing and binding reject cross-order, wrong merchant and currency", () => {
  assert.equal(usdCents({ currency_code: "USD", value: "9" }), 900);
  assert.equal(usdCents({ currency: "USD", total: "0.01" }), 1);
  for (const value of [
    { currency_code: "EUR", value: "9.00" },
    { currency_code: "USD", value: "1e3" },
    { currency_code: "USD", value: "9.001" },
  ])
    assert.throws(() => usdCents(value));
  const s = new BillingService({} as any, env);
  const c = { id: "checkout", amount_cents: 500 },
    order = {
      purchase_units: [
        {
          custom_id: c.id,
          reference_id: c.id,
          payee: { merchant_id: "MERCHANT123" },
          amount: { currency_code: "USD", value: "5.00" },
        },
      ],
    };
  assert.doesNotThrow(() => s.validateOrder(order, c));
  order.purchase_units[0].payee.merchant_id = "OTHER";
  assert.throws(() => s.validateOrder(order, c), /payment_mismatch/);
});
test("Webhook dispatch refuses forged signatures before touching the payment database", async () => {
  const p = adapter(() => json({ verification_status: "FAILURE" })),
    s = new BillingService({} as any, env, p);
  s.require = async () => {};
  await assert.rejects(
    s.webhook(
      { id: "event", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} },
      {},
    ),
    /invalid_webhook/,
  );
});
test("Verified capture notifications re-read the real order and pass only matched settled payment data to the ledger", async () => {
  const checkout = {
    id: "checkout",
    provider_id: "ORDER123",
    amount_cents: 500,
    offer_id: "small_pack",
  };
  let applied: any,
    verified = false;
  const admin = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: checkout, error: null }),
        }),
      }),
    }),
    rpc: async (name: string, args: any) => {
      assert.equal(name, "apply_billing_event");
      assert.equal(verified, true);
      applied = args;
      return { data: true, error: null };
    },
  };
  const p = adapter((url) => {
    assert.match(url, /orders\/ORDER123$/);
    return json({
      status: "COMPLETED",
      purchase_units: [
        {
          custom_id: "checkout",
          reference_id: "checkout",
          payee: { merchant_id: "MERCHANT123" },
          amount: { currency_code: "USD", value: "5.00" },
          payments: {
            captures: [
              {
                id: "CAPTURE123",
                status: "COMPLETED",
                amount: { currency_code: "USD", value: "5.00" },
              },
            ],
          },
        },
      ],
    });
  });
  p.verifyWebhook = async () => {
    verified = true;
  };
  const s = new BillingService(admin as any, env, p);
  s.require = async () => {};
  await s.webhook(
    {
      id: "EVENT123",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: {
        id: "CAPTURE123",
        supplementary_data: { related_ids: { order_id: "ORDER123" } },
      },
    },
    {},
  );
  assert.equal(applied.kind, "paid");
  assert.deepEqual(applied.p, {
    checkout_id: "checkout",
    provider_id: "ORDER123",
    payment_id: "CAPTURE123",
    amount_cents: 500,
  });
  assert.equal(applied.event_hash.length, 64);
});
test("A browser capture response never grants units and an uncompleted provider payment cannot reach the ledger", async () => {
  let calls = 0;
  const c = {
      id: "checkout",
      provider_id: "ORDER123",
      amount_cents: 500,
      offer_id: "small_pack",
      status: "pending",
    },
    order = {
      status: "APPROVED",
      purchase_units: [
        {
          custom_id: c.id,
          reference_id: c.id,
          payee: { merchant_id: "MERCHANT123" },
          amount: { currency_code: "USD", value: "5.00" },
        },
      ],
    };
  const p = adapter((_url, options) => {
    calls++;
    return json({
      ...order,
      status: options.method === "POST" ? "COMPLETED" : "APPROVED",
    });
  });
  const s = new BillingService(
    {
      rpc: async () => {
        throw Error("browser must not grant");
      },
    } as any,
    env,
    p,
  );
  s.require = async () => {};
  s.own = async () => c;
  assert.equal(
    (await s.capture(c.id, {} as any)).status,
    "awaiting_verified_notification",
  );
  assert.equal(calls, 2);
});
