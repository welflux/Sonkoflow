import { z } from "zod";
import { AppError } from "../security.js";
import { timedProviderFetch } from "../transport.js";
import { amount, offers, type OfferId } from "./catalog.js";
const cfg = z.object({
  PAYPAL_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_CLIENT_SECRET: z.string().min(1),
  PAYPAL_MERCHANT_ID: z.string().regex(/^[A-Z0-9]{8,30}$/),
  PAYPAL_WEBHOOK_ID: z.string().min(1),
  PAYPAL_PLAN_IDS: z.preprocess(
    (v) => {
      try {
        return typeof v === "string" ? JSON.parse(v) : v;
      } catch {
        return null;
      }
    },
    z.record(z.string(), z.string().regex(/^P-[A-Z0-9]+$/)).default({}),
  ),
});
export function paypalConfig(env: NodeJS.ProcessEnv = process.env) {
  const r = cfg.safeParse(env);
  return r.success ? r.data : null;
}
export class PayPal {
  readonly config;
  readonly base;
  constructor(
    env: NodeJS.ProcessEnv = process.env,
    private fetcher: typeof fetch = timedProviderFetch(15000),
  ) {
    this.config = paypalConfig(env);
    this.base =
      this.config?.PAYPAL_MODE === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";
  }
  private async transport(url: string, options: RequestInit) {
    try {
      return await this.fetcher(url, options);
    } catch {
      throw new AppError(
        503,
        "paypal_unavailable",
        "PayPal is temporarily unavailable. Return to your saved order to retry.",
      );
    }
  }
  private async token() {
    if (!this.config)
      throw new AppError(
        503,
        "paypal_setup",
        "Secure PayPal checkout is awaiting merchant configuration.",
      );
    const r = await this.transport(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.config.PAYPAL_CLIENT_ID}:${this.config.PAYPAL_CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const v = await this.read(r);
    if (
      typeof v.access_token !== "string" ||
      !v.access_token ||
      v.access_token.length > 16384
    )
      throw new AppError(
        503,
        "paypal_unavailable",
        "PayPal authentication is unavailable.",
      );
    return v.access_token;
  }
  private async read(r: Response) {
    if (!r.ok) {
      await r.body?.cancel();
      throw new AppError(
        503,
        "paypal_unavailable",
        "PayPal could not complete this request. No allowance has been granted. Retry from your order.",
      );
    }
    if (r.status === 204) return {};
    const reader = r.body?.getReader();
    if (!reader)
      throw new AppError(
        503,
        "paypal_unavailable",
        "PayPal response is unavailable.",
      );
    let size = 0;
    const chunks = [];
    for (;;) {
      const x = await reader.read();
      if (x.done) break;
      size += x.value.length;
      if (size > 262144) {
        await reader.cancel();
        throw new AppError(
          503,
          "paypal_unavailable",
          "PayPal response exceeded its safe limit.",
        );
      }
      chunks.push(x.value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      throw new AppError(
        503,
        "paypal_unavailable",
        "PayPal returned an invalid response.",
      );
    }
  }
  async request(path: string, method = "GET", body?: unknown, key?: string) {
    const token = await this.token();
    return this.read(
      await this.transport(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(key ? { "PayPal-Request-Id": key } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  }
  async validatePlan(id: OfferId) {
    const o = offers[id],
      remote = this.config?.PAYPAL_PLAN_IDS[id];
    if (o.kind !== "subscription" || !remote)
      throw new AppError(
        503,
        "paypal_plan_setup",
        "This billing period is not enabled for purchase yet.",
      );
    const p = await this.request(`/v1/billing/plans/${remote}`);
    const regular = p.billing_cycles?.filter(
      (v: any) => v.tenure_type === "REGULAR",
    );
    if (
      p.status !== "ACTIVE" ||
      regular?.length !== 1 ||
      p.billing_cycles.length !== 1 ||
      regular[0].frequency.interval_unit !==
        (o.interval === "year" ? "YEAR" : "MONTH") ||
      regular[0].frequency.interval_count !== 1 ||
      regular[0].total_cycles !== 0 ||
      Number(p.taxes?.percentage ?? 0) !== 0 ||
      regular[0].pricing_scheme.fixed_price.currency_code !== "USD" ||
      !/^\d{1,6}(\.\d{1,2})?$/.test(
        regular[0].pricing_scheme.fixed_price.value,
      ) ||
      Math.round(Number(regular[0].pricing_scheme.fixed_price.value) * 100) !==
        o.cents ||
      Number(p.payment_preferences?.setup_fee?.value ?? 0) !== 0
    )
      throw new AppError(
        503,
        "paypal_plan_mismatch",
        "The merchant plan does not match this order. No payment was started.",
      );
    return remote;
  }
  async create(checkout: any, origin: string) {
    const o = offers[checkout.offer_id as OfferId],
      back = `${origin}/app/checkout`;
    if (o.kind === "one_time")
      return this.request(
        "/v2/checkout/orders",
        "POST",
        {
          intent: "CAPTURE",
          purchase_units: [
            {
              reference_id: checkout.id,
              custom_id: checkout.id,
              invoice_id: checkout.id,
              payee: { merchant_id: this.config!.PAYPAL_MERCHANT_ID },
              amount: { currency_code: "USD", value: amount(o.cents) },
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                return_url: `${back}?returned=1`,
                cancel_url: `${back}?cancelled=1`,
                user_action: "PAY_NOW",
                shipping_preference: "NO_SHIPPING",
              },
            },
          },
        },
        checkout.id,
      );
    const plan = await this.validatePlan(checkout.offer_id);
    return this.request(
      "/v1/billing/subscriptions",
      "POST",
      {
        plan_id: plan,
        custom_id: checkout.id,
        application_context: {
          return_url: `${back}?returned=1`,
          cancel_url: `${back}?cancelled=1`,
          user_action: "SUBSCRIBE_NOW",
          shipping_preference: "NO_SHIPPING",
        },
      },
      checkout.id,
    );
  }
  async verifyWebhook(event: any, headers: Record<string, any>) {
    if (!this.config)
      throw new AppError(
        503,
        "paypal_setup",
        "Payment verification is not configured.",
      );
    const keys = [
      "paypal-auth-algo",
      "paypal-cert-url",
      "paypal-transmission-id",
      "paypal-transmission-sig",
      "paypal-transmission-time",
    ];
    if (
      keys.some(
        (k) => typeof headers[k] !== "string" || headers[k].length > 4096,
      )
    )
      throw new AppError(400, "invalid_webhook", "Missing PayPal signature.");
    const cert = new URL(headers["paypal-cert-url"]);
    if (
      cert.protocol !== "https:" ||
      ![
        "api.paypal.com",
        "api.sandbox.paypal.com",
        "api-m.paypal.com",
        "api-m.sandbox.paypal.com",
      ].includes(cert.hostname) ||
      cert.port ||
      cert.username ||
      cert.password ||
      !cert.pathname.startsWith("/v1/notifications/certs/")
    )
      throw new AppError(
        400,
        "invalid_webhook",
        "Unrecognized PayPal certificate location.",
      );
    const r = await this.request(
      "/v1/notifications/verify-webhook-signature",
      "POST",
      {
        auth_algo: headers["paypal-auth-algo"],
        cert_url: cert.href,
        transmission_id: headers["paypal-transmission-id"],
        transmission_sig: headers["paypal-transmission-sig"],
        transmission_time: headers["paypal-transmission-time"],
        webhook_id: this.config.PAYPAL_WEBHOOK_ID,
        webhook_event: event,
      },
    );
    if (r.verification_status !== "SUCCESS")
      throw new AppError(400, "invalid_webhook", "PayPal verification failed.");
  }
  approval(value: any) {
    const url = value.links?.find(
      (v: any) => v.rel === "approve" || v.rel === "payer-action",
    )?.href;
    if (typeof url !== "string")
      throw new AppError(
        503,
        "paypal_unavailable",
        "PayPal did not provide an approval link.",
      );
    const u = new URL(url);
    if (
      u.protocol !== "https:" ||
      u.hostname !==
        (this.config?.PAYPAL_MODE === "live"
          ? "www.paypal.com"
          : "www.sandbox.paypal.com") ||
      u.username ||
      u.password
    )
      throw new AppError(
        503,
        "paypal_unavailable",
        "PayPal returned an untrusted approval link.",
      );
    return u.href;
  }
}
