import { BrandService } from "../brand/service.js";
import type { Express, Request, Response } from "express";
import type { Config } from "../config.js";
import type { Identity } from "../services.js";
import type { ProcessingEngine } from "../processing/engine.js";
import { z } from "zod";
import { opaque, hash, uuid, AppError } from "../security.js";
import { BillingService, billingError, emailFingerprint } from "./service.js";
import { plans, offers, offerIds } from "./catalog.js";
import { jobInput } from "../processing/contracts.js";
import { meterPlan } from "./meter.js";
export const intentCookie = "sonkoflow_checkout";
export function catalogRoutes(app: Express, engine: ProcessingEngine | null) {
  app.get("/api/public/pricing", async (_q, r) => {
    const enabled = engine
        ? await new BillingService(engine.admin).ready()
        : false,
      pp = engine ? new BillingService(engine.admin).paypal.config : null;
    r.set("Cache-Control", "no-store").json({
      plans,
      offers,
      enabled,
      checkout_enabled: enabled && !!pp,
      annual_supported:
        enabled &&
        !!pp?.PAYPAL_PLAN_IDS.starter_annual &&
        !!pp?.PAYPAL_PLAN_IDS.pro_annual,
      reason:
        enabled && pp
          ? null
          : "Secure checkout is awaiting merchant setup and billing activation. You can review plans and create your workspace; no payment is taken here yet.",
    });
  });
}
export function webhookRoute(
  app: Express,
  engine: ProcessingEngine | null,
  limit?: (q: Request, b: string, n?: number, s?: number) => Promise<void>,
) {
  app.post("/api/billing/webhook", async (q, r) => {
    if (!engine)
      throw new AppError(
        503,
        "billing_not_ready",
        "Billing verification is not configured.",
      );
    await limit?.(q, "paypal-webhook", 300, 300);
    const event = z
      .object({
        id: z.string().min(1).max(200),
        event_type: z.string().max(100),
        resource: z.unknown(),
      })
      .passthrough()
      .parse(q.body);
    r.json(await new BillingService(engine.admin).webhook(event, q.headers));
  });
}
export function intentRoutes(
  app: Express,
  engine: ProcessingEngine | null,
  config: Config | null,
  limit: (q: Request, b: string, n?: number, s?: number) => Promise<void>,
) {
  app.post("/api/public/billing/intents", async (q, r) => {
    if (!engine || !config)
      throw new AppError(
        503,
        "billing_not_ready",
        "Account setup is not available yet.",
      );
    await limit(q, "checkout-intent", 20, 900);
    const b = z
        .object({
          offer_id: z.enum(
            offerIds as [
              (typeof offerIds)[number],
              ...(typeof offerIds)[number][],
            ],
          ),
        })
        .strict()
        .parse(q.body),
      o = offers[b.offer_id],
      token = opaque();
    const v = await engine.admin
      .from("billing_checkouts")
      .insert({
        token_hash: hash(token),
        offer_id: b.offer_id,
        amount_cents: o.cents,
        units: o.units,
      })
      .select("id")
      .single();
    billingError(v.error);
    r.cookie(intentCookie, token, {
      httpOnly: true,
      secure: config.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 86400000,
    });
    r.status(201).json({ next: "/app/checkout", offer_id: b.offer_id });
  });
}
export async function rememberIntent(
  engine: ProcessingEngine | null,
  q: Request,
  email: string,
  key: string,
) {
  if (!engine || !q.cookies[intentCookie]) return;
  const version = await engine.admin.rpc("commerce_schema_version");
  if (version.error) return;
  await engine.admin
    .from("billing_checkouts")
    .update({ email_hash: emailFingerprint(email, key) })
    .eq("token_hash", hash(q.cookies[intentCookie]))
    .is("user_id", null);
}
export async function billingNext(
  engine: ProcessingEngine | null,
  q: Request,
  owner: string,
  email: string,
  key: string,
) {
  if (!engine) return "/app";
  const version = await engine.admin.rpc("commerce_schema_version");
  if (version.error) return "/app";
  const v = await engine.admin.rpc("bind_billing_checkout", {
    token: q.cookies[intentCookie] ? hash(q.cookies[intentCookie]) : "",
    owner,
    email_fingerprint: emailFingerprint(email, key),
  });
  return !v.error && v.data ? "/app/checkout" : "/app";
}
export function billingRoutes(
  app: Express,
  engine: ProcessingEngine,
  config: Config,
  who: (r: Response) => Identity,
  limit: (q: Request, b: string, n?: number, s?: number) => Promise<void>,
) {
  const svc = new BillingService(engine.admin);
  app.get("/api/billing/account", async (_q, r) =>
    r.json(await svc.account(who(r))),
  );
  app.get("/api/billing/current", async (q, r) => {
    const c = await svc.bind(
      q.cookies[intentCookie] ? hash(q.cookies[intentCookie]) : null,
      who(r),
      config.RATE_LIMIT_KEY,
    );
    r.json({
      checkout: c
        ? {
            id: c.id,
            offer_id: c.offer_id,
            status: c.status,
            amount_cents: c.amount_cents,
            units: c.units,
          }
        : null,
      enabled: await svc.ready(),
      paypal_ready: !!svc.paypal.config,
    });
  });
  app.post("/api/billing/free", async (_q, r) => {
    const account = await svc.account(who(r));
    r.json({ account, next: "/app/welcome" });
  });
  app.post("/api/billing/quote", async (q, r) => {
    const input = jobInput.parse(q.body),
      i = who(r);
    const image = await i.client
      .from("images")
      .select("id,width,height,status,role")
      .eq("id", input.input_image_id)
      .eq("project_id", input.project_id)
      .eq("status", "ready")
      .eq("role", "original")
      .maybeSingle();
    billingError(image.error);
    if (!image.data)
      throw new AppError(404, "not_found", "Original not found.");
    if (!engine.billing)
      throw new AppError(
        503,
        "billing_not_ready",
        "Metering is not activated.",
      );
    const brand = input.brand
      ? await new BrandService(engine.admin).resolve(input.brand, i)
      : undefined;
    const plan = await meterPlan(engine, input, image.data, i, brand);
    r.json({
      estimated_units: plan!.plan.estimated_credits,
      reserved_units:
        plan!.plan.generation_credits + plan!.plan.assessment_credits,
      available_units:
        plan!.account.account.balance_credits -
        plan!.account.account.reserved_credits,
    });
  });
  app.post("/api/billing/checkouts/:id/start", async (q, r) => {
    await limit(q, "paypal-start", 10, 900);
    r.json(await svc.start(uuid.parse(q.params.id), who(r), config.APP_ORIGIN));
  });
  app.post("/api/billing/checkouts/:id/capture", async (q, r) => {
    await limit(q, "paypal-capture", 10, 900);
    r.json(await svc.capture(uuid.parse(q.params.id), who(r)));
  });
  app.get("/api/billing/checkouts/:id", async (q, r) =>
    r.json({ checkout: await svc.own(uuid.parse(q.params.id), who(r)) }),
  );
  app.post("/api/billing/subscriptions/:id/cancel", async (q, r) => {
    await limit(q, "paypal-cancel", 10, 900);
    const id = z
      .string()
      .regex(/^I-[A-Z0-9]+$/)
      .parse(q.params.id);
    r.json(await svc.cancel(id, who(r)));
  });
}
