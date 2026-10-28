import { packRoutes } from "./packs/routes.js";
import { ProcessingEngine } from "./processing/engine.js";
import { processingRoutes } from "./processing/routes.js";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import multer from "multer";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z, ZodError } from "zod";
import type { Config } from "./config.js";
import { services, databaseError, type Identity } from "./services.js";
import {
  AppError,
  credentials,
  projectInput,
  audience,
  uuid,
  rateKey,
  validateImage,
} from "./security.js";
export function createApp(config: Config | null) {
  const app = express();
  const svc = config ? services(config) : null;
  const processing = svc ? new ProcessingEngine(svc.admin) : null;
  app.locals.processing = processing;
  const secure = config?.NODE_ENV === "production";
  const cookieName = secure ? "__Host-sonkoflow_session" : "sonkoflow_session";
  app.disable("x-powered-by");
  app.set("trust proxy", config?.TRUST_PROXY_HOPS ?? false);
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader("X-Request-ID", res.locals.requestId);
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "blob:", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: secure ? [] : null,
        },
      },
      strictTransportSecurity: secure ? undefined : false,
      referrerPolicy: { policy: "no-referrer" },
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "16kb", type: "application/json" }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!config || !svc)
      return next(
        new AppError(
          503,
          "not_configured",
          "Account services are not configured yet.",
        ),
      );
    next();
  });
  app.use("/api", (req, _res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("origin") !== config!.APP_ORIGIN
    )
      return next(
        new AppError(403, "invalid_origin", "Request origin is not allowed."),
      );
    next();
  });
  async function limit(req: Request, bucket: string, max = 60, seconds = 900) {
    const { data, error } = await svc!.admin.rpc("take_rate_limit", {
      bucket_key: rateKey(
        req.ip ?? req.socket.remoteAddress ?? "unknown",
        bucket,
        config!.RATE_LIMIT_KEY,
      ),
      max_hits: max,
      window_seconds: seconds,
    });
    if (error)
      throw new AppError(
        503,
        "rate_limit_unavailable",
        "Request protection is unavailable. Please try again.",
      );
    if (!data)
      throw new AppError(
        429,
        "rate_limited",
        "Too many requests. Please try again later.",
      );
  }
  async function auth(req: Request, res: Response, next: NextFunction) {
    try {
      const identity = await svc!.identity(req.cookies[cookieName]);
      res.locals.identity = identity;
      if (
        identity.purpose !== "account" &&
        req.path !== "/auth/password" &&
        req.path !== "/auth/signout"
      )
        throw new AppError(
          403,
          "recovery_only",
          "Complete your password reset before continuing.",
        );
      next();
    } catch (error) {
      next(error);
    }
  }
  const who = (res: Response) => res.locals.identity as Identity;
  const setCookie = (res: Response, token: string) =>
    res.cookie(cookieName, token, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 86400000,
    });
  app.post("/api/auth/signup", async (req, res) => {
    await limit(req, "signup", 10);
    const input = credentials.parse(req.body);
    const { error } = await svc!
      .anonymous()
      .auth.signUp({
        ...input,
        options: { emailRedirectTo: `${config!.APP_ORIGIN}/account/confirm` },
      });
    if (error)
      throw new AppError(
        400,
        "signup_failed",
        "Unable to create an account. Check your details or try password recovery.",
      );
    res
      .status(202)
      .json({
        message:
          "Check your email to confirm your account. If you already have an account, sign in or reset your password.",
      });
  });
  app.post("/api/auth/signin", async (req, res) => {
    await limit(req, "signin", 20);
    const input = credentials.parse(req.body);
    const { data, error } = await svc!
      .anonymous()
      .auth.signInWithPassword(input);
    if (error || !data.session || !data.user?.email_confirmed_at)
      throw new AppError(
        401,
        "signin_failed",
        "Email or password is incorrect, or your email is not yet verified.",
      );
    setCookie(res, await svc!.newSession(data.session));
    res.json({ ok: true });
  });
  app.post("/api/auth/recover", async (req, res) => {
    await limit(req, "recover", 5, 3600);
    const { email } = z
      .object({ email: z.string().trim().email().max(254) })
      .strict()
      .parse(req.body);
    const { error } = await svc!
      .anonymous()
      .auth.resetPasswordForEmail(email, {
        redirectTo: `${config!.APP_ORIGIN}/account/confirm`,
      });
    if (error)
      throw new AppError(
        503,
        "mail_unavailable",
        "Recovery email is unavailable. Please try again later.",
      );
    res
      .status(202)
      .json({
        message:
          "If an account exists, a password recovery email will be sent.",
      });
  });
  app.post("/api/auth/confirm", async (req, res) => {
    await limit(req, "confirm", 20);
    const { token_hash, type } = z
      .object({
        token_hash: z.string().min(20).max(1024),
        type: z.enum(["email", "signup", "recovery"]),
      })
      .strict()
      .parse(req.body);
    const { data, error } = await svc!
      .anonymous()
      .auth.verifyOtp({ token_hash, type });
    if (error || !data.session)
      throw new AppError(
        400,
        "invalid_confirmation",
        "The confirmation link has expired or has already been used. Request a new one.",
      );
    setCookie(
      res,
      await svc!.newSession(
        data.session,
        type === "recovery" ? "recovery" : "account",
      ),
    );
    res.json({ recovery: type === "recovery" });
  });
  app.use("/api", async (req, _res, next) => {
    if (/^[a-f0-9]{64}$/.test(req.cookies[cookieName] ?? ""))
      await limit(req, "authenticated-api", 180, 60);
    next();
  });
  app.use("/api", auth);
  app.get("/api/session", async (_req, res) => {
    const identity = who(res);
    const { data, error } = await identity.client
      .from("profiles")
      .select("id,display_name,audience")
      .single();
    databaseError(error);
    res.json({ profile: data });
  });
  app.post("/api/auth/signout", async (_req, res) => {
    const { error } = await svc!.admin
      .from("app_sessions")
      .delete()
      .eq("id", who(res).id);
    databaseError(error);
    res.clearCookie(cookieName, {
      path: "/",
      httpOnly: true,
      secure,
      sameSite: "lax",
    });
    res.json({ ok: true });
  });
  app.post("/api/auth/password", async (req, res) => {
    await limit(req, "password", 10);
    const { password } = z
      .object({ password: z.string().min(12).max(128) })
      .strict()
      .parse(req.body);
    const id = who(res);
    if (id.purpose !== "recovery")
      throw new AppError(
        403,
        "recovery_required",
        "Request a password recovery email before changing your password.",
      );
    const revoked = await svc!.admin
      .from("app_sessions")
      .delete()
      .eq("user_id", id.userId);
    databaseError(revoked.error);
    res.clearCookie(cookieName, {
      path: "/",
      httpOnly: true,
      secure,
      sameSite: "lax",
    });
    const { error } = await svc!.admin.auth.admin.updateUserById(id.userId, {
      password,
    });
    if (error)
      throw new AppError(
        400,
        "password_failed",
        "Unable to update the password. Please try a different strong password.",
      );
    const result = await svc!.admin
      .from("app_sessions")
      .delete()
      .eq("user_id", id.userId);
    databaseError(result.error);
    res.clearCookie(cookieName, {
      path: "/",
      httpOnly: true,
      secure,
      sameSite: "lax",
    });
    res.json({ ok: true });
  });
  app.patch("/api/profile", async (req, res) => {
    const input = z
      .object({ display_name: z.string().trim().max(100), audience })
      .strict()
      .parse(req.body);
    const id = who(res);
    const { data, error } = await id.client
      .from("profiles")
      .update(input)
      .eq("id", id.userId)
      .select("id,display_name,audience")
      .single();
    databaseError(error);
    res.json({ profile: data });
  });
  app.get("/api/projects", async (_req, res) => {
    const { data, error } = await who(res)
      .client.from("projects")
      .select("id,name,audience,created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    databaseError(error);
    res.json({ projects: data });
  });
  app.post("/api/projects", async (req, res) => {
    await limit(req, "project", 30);
    const input = projectInput.parse(req.body);
    const id = who(res);
    const { data, error } = await id.client
      .from("projects")
      .insert({ ...input, user_id: id.userId })
      .select("id,name,audience,created_at")
      .single();
    databaseError(error);
    res.status(201).json({ project: data });
  });
  app.delete("/api/projects/:id", async (req, res) => {
    const id = uuid.parse(req.params.id);
    const identity = who(res);
    const { data, error } = await identity.client
      .from("projects")
      .delete()
      .eq("id", id)
      .select("id");
    if (error)
      throw new AppError(
        409,
        "project_not_empty",
        "Delete project photographs before deleting the project.",
      );
    if (!data?.length)
      throw new AppError(404, "not_found", "Project not found.");
    res.json({ ok: true });
  });
  app.get("/api/images", async (req, res) => {
    const projectId = uuid.parse(req.query.project_id);
    const { data, error } = await who(res)
      .client.from("images")
      .select("id,project_id,role,filename,width,height,byte_size,status,created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(100);
    databaseError(error);
    res.json({ images: data });
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2, parts: 3 },
  });
  let activeUploads = 0;
  app.post(
    "/api/images",
    async (req, res, next) => {
      await limit(req, "upload", 30);
      if (activeUploads >= 2)
        throw new AppError(
          503,
          "upload_busy",
          "Uploads are busy. Please try again.",
        );
      activeUploads++;
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          activeUploads--;
        }
      };
      res.once("finish", release);
      res.once("close", release);
      upload.single("image")(req, res, next);
    },
    async (req, res) => {
      const input = z
        .object({ project_id: uuid, id: uuid })
        .strict()
        .parse(req.body);
      const identity = who(res);
      const project = await identity.client
        .from("projects")
        .select("id")
        .eq("id", input.project_id)
        .maybeSingle();
      databaseError(project.error);
      if (!project.data)
        throw new AppError(404, "not_found", "Project not found.");
      if (!req.file)
        throw new AppError(
          400,
          "missing_image",
          "Choose a photograph to upload.",
        );
      const validated = await validateImage(req.file.buffer);
      const objectKey = `${identity.userId}/${input.id}.webp`;
      const prior = await identity.client
        .from("images")
        .select("id,status,checksum,project_id")
        .eq("id", input.id)
        .maybeSingle();
      databaseError(prior.error);
      if (prior.data) {
        if (
          prior.data.checksum !== validated.checksum ||
          prior.data.project_id !== input.project_id
        )
          throw new AppError(
            409,
            "duplicate_conflict",
            "This upload identifier belongs to different image content.",
          );
        if (prior.data.status !== "ready")
          throw new AppError(
            409,
            "upload_pending",
            "This upload is pending reconciliation. Please try later.",
          );
        res.json({ image: { id: input.id } });
        return;
      }
      const filename =
        req.file.originalname
          .replace(/[^\p{L}\p{N} ._-]/gu, "_")
          .slice(0, 140) || "photograph";
      const row = {
        id: input.id,
        user_id: identity.userId,
        project_id: input.project_id,
        role: "original",
        object_key: objectKey,
        filename,
        media_type: "image/webp",
        byte_size: validated.bytes.length,
        width: validated.width,
        height: validated.height,
        checksum: validated.checksum,
      };
      const inserted = await svc!.admin.from("images").insert(row);
      if (inserted.error)
        throw new AppError(
          409,
          "upload_limit",
          "Unable to reserve this upload. Check your image quota or retry status.",
        );
      try {
        const stored = await svc!.admin.storage
          .from("photos")
          .upload(objectKey, validated.bytes, {
            contentType: "image/webp",
            upsert: false,
          });
        if (stored.error) throw new Error("storage");
        const final = await svc!.admin.rpc("complete_upload", {
          image_id: input.id,
          owner_id: identity.userId,
        });
        databaseError(final.error);
        res.status(201).json({ image: { id: input.id } });
      } catch {
        const cleanup = await svc!.admin.storage
          .from("photos")
          .remove([objectKey]);
        if (!cleanup.error)
          await svc!.admin
            .from("images")
            .delete()
            .eq("id", input.id)
            .eq("user_id", identity.userId);
        throw new AppError(
          503,
          "upload_failed",
          "Upload failed. An incomplete upload may need reconciliation; no processing credits were charged.",
        );
      }
    },
  );
  app.get("/api/images/:id/content", async (req, res) => {
    await limit(req, "download", 120);
    const id = uuid.parse(req.params.id);
    const identity = who(res);
    const result = await identity.client
      .from("images")
      .select("id,object_key,status")
      .eq("id", id)
      .maybeSingle();
    databaseError(result.error);
    if (!result.data || result.data.status !== "ready")
      throw new AppError(404, "not_found", "Photograph not found.");
    const download = await identity.client.storage
      .from("photos")
      .download(result.data.object_key);
    if (download.error || !download.data)
      throw new AppError(
        503,
        "storage_error",
        "Photograph retrieval is unavailable.",
      );
    res.set({
      "Content-Type": "image/webp",
      "Cache-Control": "private, no-store",
      "Content-Disposition": `${req.query.download === "1" ? "attachment" : "inline"}; filename="sonkoflow-${id}.webp"`,
    });
    res.send(Buffer.from(await download.data.arrayBuffer()));
  });
  app.delete("/api/images/:id", async (req, res) => {
    await limit(req, "delete", 60);
    const id = uuid.parse(req.params.id);
    const identity = who(res);
    const result = await identity.client
      .from("images")
      .select("id,object_key")
      .eq("id", id)
      .maybeSingle();
    databaseError(result.error);
    if (!result.data)
      throw new AppError(404, "not_found", "Photograph not found.");
    const marked = await svc!.admin
      .from("images")
      .update({ status: "deleting" })
      .eq("id", id)
      .eq("user_id", identity.userId);
    if (marked.error?.message?.includes("processing_image_busy"))
      throw new AppError(409, "image_busy", "Wait for the active edit or quality assessment before deleting this photograph.");
    databaseError(marked.error);
    const removed = await svc!.admin.storage
      .from("photos")
      .remove([result.data.object_key]);
    if (removed.error)
      throw new AppError(
        503,
        "delete_pending",
        "Deletion is pending. Please retry.",
      );
    const done = await svc!.admin.rpc("complete_deletion", {
      image_id: id,
      owner_id: identity.userId,
    });
    databaseError(done.error);
    res.json({ ok: true });
  });
  if (processing) {
    processingRoutes(app, processing, who);
    packRoutes(app, processing, who, limit);
  }
  app.use("/api", (_req, _res, next) =>
    next(new AppError(404, "not_found", "Endpoint not found.")),
  );
  app.get(["/account", "/account/{*path}"], (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.sendFile(path.resolve("dist/app.html"));
  });
  app.get(["/app", "/app/{*path}"], async (req, res) => {
    if (!svc) {
      res.redirect("/account");
      return;
    }
    try {
      const id = await svc.identity(req.cookies[cookieName]);
      if (id.purpose !== "account") {
        res.redirect("/account/reset");
        return;
      }
      res.set("Cache-Control", "no-store");
      res.sendFile(path.resolve("dist/app.html"));
    } catch {
      res.redirect("/account");
    }
  });
  app.get("/app.html", (_req, res) => res.redirect("/account"));
  app.use(
    express.static(path.resolve("dist"), {
      dotfiles: "deny",
      index: "index.html",
    }),
  );
  app.use((_req, _res, next) =>
    next(new AppError(404, "not_found", "Page not found.")),
  );
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof ZodError) {
        res
          .status(400)
          .json({
            error: {
              code: "invalid_input",
              message: "Check the required fields and try again.",
              requestId: res.locals.requestId,
            },
          });
        return;
      }
      if (error instanceof multer.MulterError)
        error = new AppError(
          413,
          "upload_limits",
          "Upload one image no larger than 10 MB.",
        );
      if (error instanceof SyntaxError)
        error = new AppError(
          400,
          "invalid_json",
          "The request body is invalid.",
        );
      const safe =
        error instanceof AppError
          ? error
          : new AppError(
              500,
              "internal_error",
              "An unexpected error occurred. Please try again.",
            );
      if (safe.status === 429) {
        const daily = ["daily_limit", "budget_limit"].includes(safe.code);
        const now = new Date();
        const seconds = daily
          ? Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000)
          : 900;
        res.set("Retry-After", String(seconds));
      }
      if (safe.status >= 500)
        console.error(
          JSON.stringify({
            event: "request_failed",
            code: safe.code,
            requestId: res.locals.requestId,
          }),
        );
      res
        .status(safe.status)
        .json({
          error: {
            code: safe.code,
            message: safe.publicMessage,
            requestId: res.locals.requestId,
          },
        });
    },
  );
  return app;
}
