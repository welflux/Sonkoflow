import { loadProcessingConfig } from "../processing/config.js";
import { loadPackConfig } from "../packs/config.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Identity } from "../services.js";
import { AppError, hash } from "../security.js";
import { createHmac } from "node:crypto";
import { PayPal } from "./paypal.js";
import { offers, type OfferId } from "./catalog.js";
export function billingError(e: any) {
  if (!e) return;
  const code = [
    "insufficient_credits",
    "billing_sample_used",
    "billing_entitlement",
    "billing_storage_limit",
    "billing_subscription_exists",
    "billing_owner",
    "credit_unit_changed",
    "billing_not_ready",
  ].find((c) => e.message?.includes(c));
  throw new AppError(
    code === "billing_owner" ? 404 : code ? 409 : 503,
    code ?? "billing_unavailable",
    code === "insufficient_credits"
      ? "Your available processing allowance is too low for this reservation."
      : code === "billing_sample_used"
        ? "Your one-time sample has been used. Choose a paid allowance to continue."
        : code === "billing_entitlement"
          ? "This quality or workflow is not included in your current plan."
          : code === "billing_subscription_exists"
            ? "You already have a subscription or pending approval. Manage it before starting another; no overlapping subscription is created."
            : code === "billing_storage_limit"
              ? "Your plan storage or project limit has been reached."
              : code === "billing_owner"
                ? "Order not found."
                : "Billing could not be verified. Processing and purchases remain protected; no allowance was granted.",
  );
}
export function usdCents(value: any) {
  if (value?.currency_code !== "USD" && value?.currency !== "USD")
    throw new AppError(
      409,
      "payment_mismatch",
      "Payment currency does not match.",
    );
  const amount = value.value ?? value.total;
  if (typeof amount !== "string" || !/^\d{1,6}(\.\d{1,2})?$/.test(amount))
    throw new AppError(409, "payment_mismatch", "Payment amount is invalid.");
  const [a, b = ""] = amount.split(".");
  return Number(a) * 100 + Number(b.padEnd(2, "0"));
}
export function emailFingerprint(email: string, key: string) {
  return createHmac("sha256", key)
    .update(email.trim().toLowerCase())
    .digest("hex");
}
export class BillingService {
  readonly paypal;
  constructor(
    readonly admin: SupabaseClient,
    readonly env: NodeJS.ProcessEnv = process.env,
    provider?: PayPal,
  ) {
    this.paypal = provider ?? new PayPal(env);
  }
  async ready() {
    const c = loadProcessingConfig(this.env).config;
    if (
      this.env.BILLING_ENABLED !== "1" ||
      this.env.BILLING_PROVIDER_VERIFIED !== "1" ||
      !c
    )
      return false;
    const pc = loadPackConfig(this.env);
    if (
      !pc ||
      pc.AI_PACK_INITIAL_CREDITS !== 0 ||
      pc.AI_PACK_CREDIT_MICRO_USD !== 10000 ||
      pc.AI_PACK_TOKEN_ESTIMATES_JSON.model !== c.AI_IMAGE_MODEL
    )
      return false;
    const v = await this.admin.rpc("commerce_schema_version");
    if (v.error || v.data !== 2026102807) return false;
    const s = await this.admin
      .from("billing_settings")
      .select("enabled")
      .eq("id", true)
      .single();
    return !s.error && s.data?.enabled === true;
  }
  async require() {
    if (!(await this.ready()))
      throw new AppError(
        503,
        "billing_not_ready",
        "Pricing is ready to review. Purchasing and sample processing are awaiting secure billing activation.",
      );
  }
  async account(i: Identity) {
    await this.require();
    const r = await this.admin.rpc("ensure_billing_account", {
      owner: i.userId,
    });
    billingError(r.error);
    const s = await i.client
      .from("billing_subscriptions")
      .select("provider_id,plan,state,paid_until")
      .order("paid_until", { ascending: false });
    billingError(s.error);
    const receipts = await i.client
      .from("billing_receipts")
      .select(
        "payment_id,checkout_id,amount_cents,units,refunded_cents,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(50);
    billingError(receipts.error);
    return {
      ...r.data,
      subscriptions: s.data ?? [],
      receipts: receipts.data ?? [],
    };
  }
  async bind(tokenHash: string | null, i: Identity, key: string) {
    const u = await this.admin.auth.admin.getUserById(i.userId);
    if (u.error || !u.data.user?.email || !u.data.user.email_confirmed_at)
      throw new AppError(
        401,
        "billing_unverified",
        "Verify your email before continuing.",
      );
    const r = await this.admin.rpc("bind_billing_checkout", {
      token: tokenHash ?? "",
      owner: i.userId,
      email_fingerprint: emailFingerprint(u.data.user.email, key),
    });
    billingError(r.error);
    return r.data;
  }
  async own(id: string, i: Identity) {
    const r = await i.client
      .from("billing_checkouts")
      .select(
        "id,offer_id,status,provider_id,amount_cents,units,approval_url,expires_at",
      )
      .eq("id", id)
      .maybeSingle();
    billingError(r.error);
    if (!r.data) throw new AppError(404, "billing_owner", "Order not found.");
    return r.data;
  }
  async start(id: string, i: Identity, origin: string) {
    await this.require();
    if (!this.paypal.config)
      throw new AppError(
        503,
        "paypal_setup",
        "Secure PayPal checkout is awaiting merchant configuration.",
      );
    const v = await this.admin.rpc("begin_billing_checkout", {
      target: id,
      owner: i.userId,
    });
    billingError(v.error);
    const c = v.data;
    if (["paid", "active", "refunded", "cancelled"].includes(c.status))
      throw new AppError(
        409,
        "checkout_state",
        "This order has already finished. Refresh your billing page.",
      );
    if (c.provider_id && c.approval_url)
      return { approval_url: c.approval_url };
    const remote = await this.paypal.create(c, origin);
    if (typeof remote.id !== "string" || !/^[A-Z0-9-]{8,100}$/.test(remote.id))
      throw new AppError(
        503,
        "paypal_unavailable",
        "PayPal did not provide a valid order.",
      );
    const url = this.paypal.approval(remote);
    const saved = await this.admin
      .from("billing_checkouts")
      .update({ status: "pending", provider_id: remote.id, approval_url: url })
      .eq("id", id)
      .eq("user_id", i.userId);
    billingError(saved.error);
    return { approval_url: url };
  }
  async capture(id: string, i: Identity) {
    await this.require();
    const c = await this.own(id, i);
    if (offers[c.offer_id as OfferId].kind !== "one_time")
      return { status: c.status };
    if (!c.provider_id)
      throw new AppError(
        409,
        "checkout_state",
        "Approve this order at PayPal first.",
      );
    let order = await this.paypal.request(
      `/v2/checkout/orders/${encodeURIComponent(c.provider_id)}`,
    );
    this.validateOrder(order, c);
    if (order.status === "APPROVED")
      order = await this.paypal.request(
        `/v2/checkout/orders/${encodeURIComponent(c.provider_id)}/capture`,
        "POST",
        {},
        `${c.id}-capture`,
      );
    return {
      status: ["paid", "active"].includes(c.status)
        ? c.status
        : "awaiting_verified_notification",
    };
  }
  validateOrder(order: any, c: any) {
    const units = order.purchase_units;
    if (
      units?.length !== 1 ||
      units[0].custom_id !== c.id ||
      units[0].reference_id !== c.id ||
      units[0].payee?.merchant_id !== this.paypal.config?.PAYPAL_MERCHANT_ID ||
      usdCents(units[0].amount) !== c.amount_cents
    )
      throw new AppError(
        409,
        "payment_mismatch",
        "PayPal order does not match this purchase.",
      );
  }
  async cancel(id: string, i: Identity) {
    await this.require();
    const row = await i.client
      .from("billing_subscriptions")
      .select("provider_id,checkout_id")
      .eq("provider_id", id)
      .maybeSingle();
    billingError(row.error);
    if (!row.data)
      throw new AppError(404, "billing_owner", "Subscription not found.");
    const state = await this.paypal.request(
      `/v1/billing/subscriptions/${encodeURIComponent(id)}`,
    );
    if (!["CANCELLED", "EXPIRED"].includes(state.status))
      await this.paypal.request(
        `/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`,
        "POST",
        { reason: "Customer requested cancellation" },
      );
    const r = await this.admin.rpc("apply_billing_event", {
      event_id: `cancel:${id}`,
      event_hash: hash(`cancel:${id}`),
      kind: "cancelled",
      p: { checkout_id: row.data.checkout_id },
    });
    billingError(r.error);
    return { cancelled: true };
  }
  async webhook(event: any, headers: Record<string, any>) {
    await this.require();
    await this.paypal.verifyWebhook(event, headers);
    const type = event.event_type,
      resource = event.resource ?? {};
    if (typeof event.id !== "string" || event.id.length > 200)
      throw new AppError(400, "invalid_webhook", "Invalid event identifier.");
    let c: any = null,
      p: any = null,
      kind = "";
    if (type === "PAYMENT.CAPTURE.COMPLETED") {
      const orderId = resource.supplementary_data?.related_ids?.order_id;
      if (typeof orderId !== "string")
        throw new AppError(400, "invalid_webhook", "Missing order reference.");
      const r = await this.admin
        .from("billing_checkouts")
        .select("*")
        .eq("provider_id", orderId)
        .maybeSingle();
      billingError(r.error);
      c = r.data;
      if (!c)
        throw new AppError(
          409,
          "payment_pending",
          "Order reference has not been saved yet. Retry this notification.",
        );
      const order = await this.paypal.request(
        `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
      );
      this.validateOrder(order, c);
      const capture = order.purchase_units[0].payments?.captures?.find(
        (x: any) => x.id === resource.id,
      );
      if (
        order.status !== "COMPLETED" ||
        capture?.status !== "COMPLETED" ||
        usdCents(capture.amount) !== c.amount_cents
      )
        throw new AppError(409, "payment_pending", "Payment is not completed.");
      kind = "paid";
      p = {
        checkout_id: c.id,
        provider_id: c.provider_id,
        payment_id: capture.id,
        amount_cents: usdCents(capture.amount),
      };
    } else if (type === "PAYMENT.SALE.COMPLETED") {
      const sale = await this.paypal.request(
        `/v1/payments/sale/${encodeURIComponent(String(resource.id))}`,
      );
      const subId = sale.billing_agreement_id;
      if (sale.state !== "completed" || typeof subId !== "string")
        throw new AppError(
          409,
          "payment_pending",
          "Recurring payment has not completed.",
        );
      const r = await this.admin
        .from("billing_checkouts")
        .select("*")
        .eq("provider_id", subId)
        .maybeSingle();
      billingError(r.error);
      c = r.data;
      if (!c)
        throw new AppError(
          409,
          "payment_pending",
          "Subscription reference is pending.",
        );
      const sub = await this.paypal.request(
        `/v1/billing/subscriptions/${encodeURIComponent(subId)}`,
      );
      const plan = await this.paypal.validatePlan(c.offer_id);
      if (
        sub.custom_id !== c.id ||
        sub.plan_id !== plan ||
        !["ACTIVE", "CANCELLED", "SUSPENDED", "EXPIRED"].includes(sub.status) ||
        usdCents(sale.amount) !== c.amount_cents
      )
        throw new AppError(
          409,
          "payment_mismatch",
          "Subscription payment does not match.",
        );
      const end = sub.billing_info?.next_billing_time;
      if (typeof end !== "string" || !Number.isFinite(Date.parse(end)))
        throw new AppError(
          409,
          "payment_pending",
          "Paid billing period could not be verified.",
        );
      kind = "paid";
      p = {
        checkout_id: c.id,
        provider_id: subId,
        payment_id: sale.id,
        amount_cents: usdCents(sale.amount),
        paid_until: end,
      };
    } else if (
      [
        "BILLING.SUBSCRIPTION.CANCELLED",
        "BILLING.SUBSCRIPTION.SUSPENDED",
        "BILLING.SUBSCRIPTION.EXPIRED",
        "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
      ].includes(type)
    ) {
      const sub = await this.paypal.request(
        `/v1/billing/subscriptions/${encodeURIComponent(String(resource.id))}`,
      );
      const r = await this.admin
        .from("billing_checkouts")
        .select("*")
        .eq("provider_id", sub.id)
        .maybeSingle();
      billingError(r.error);
      c = r.data;
      if (!c) return { ignored: true };
      if (sub.custom_id !== c.id)
        throw new AppError(
          409,
          "payment_mismatch",
          "Subscription reference does not match.",
        );
      kind =
        sub.status === "CANCELLED" || sub.status === "EXPIRED"
          ? "cancelled"
          : sub.status === "SUSPENDED"
            ? "suspended"
            : "failed";
      p = { checkout_id: c.id };
    } else if (
      ["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.SALE.REFUNDED"].includes(type)
    ) {
      const refund =
        type === "PAYMENT.CAPTURE.REFUNDED"
          ? await this.paypal.request(
              `/v2/payments/refunds/${encodeURIComponent(String(resource.id))}`,
            )
          : await this.paypal.request(
              `/v1/payments/refund/${encodeURIComponent(String(resource.id))}`,
            );
      if (
        type === "PAYMENT.CAPTURE.REFUNDED"
          ? refund.status !== "COMPLETED"
          : refund.state !== "completed"
      )
        throw new AppError(409, "payment_pending", "Refund has not completed.");
      let parent: string | undefined;
      const up = refund.links?.find((l: any) => l.rel === "up")?.href;
      if (typeof up === "string") {
        const u = new URL(up);
        if (
          u.protocol === "https:" &&
          [
            "api.paypal.com",
            "api-m.paypal.com",
            "api.sandbox.paypal.com",
            "api-m.sandbox.paypal.com",
          ].includes(u.hostname) &&
          /^\/v2\/payments\/captures\/[A-Z0-9]+$/.test(u.pathname)
        )
          parent = u.pathname.split("/").pop();
      }
      const paymentId =
        refund.supplementary_data?.related_ids?.capture_id ??
        refund.sale_id ??
        parent;
      if (typeof paymentId !== "string")
        throw new AppError(
          409,
          "payment_pending",
          "Refund payment reference requires reconciliation.",
        );
      const receipt = await this.admin
        .from("billing_receipts")
        .select("checkout_id")
        .eq("payment_id", paymentId)
        .maybeSingle();
      billingError(receipt.error);
      if (!receipt.data)
        throw new AppError(
          409,
          "payment_pending",
          "Original payment has not been verified yet.",
        );
      kind = "refund";
      p = {
        checkout_id: receipt.data.checkout_id,
        payment_id: paymentId,
        refund_id: refund.id,
        amount_cents: usdCents(refund.amount),
      };
    } else return { ignored: true };
    const applied = await this.admin.rpc("apply_billing_event", {
      event_id: event.id,
      event_hash: hash(JSON.stringify(event)),
      kind,
      p,
    });
    billingError(applied.error);
    return { accepted: true, applied: applied.data };
  }
}
