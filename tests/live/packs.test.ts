import sharp from "sharp";
import { brandSettings } from "../../server/brand/contracts.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import request from "supertest";
import { loadConfig } from "../../server/config.js";
import { createApp } from "../../server/app.js";
import { services } from "../../server/services.js";
// REAL, BILLABLE. Default: two image edits; optional full pack/retry adds calls.
test(
  "real product pack, persistent decisions, allowance reconciliation and private approved ZIP",
  {
    skip: process.env.RUN_LIVE_PACKS !== "1",
    timeout: 90 * 60_000,
  },
  async () => {
    const config = loadConfig();
    assert(config, "Existing server configuration is required.");
    config.NODE_ENV = "test";
    const app = createApp(config),
      engine = app.locals.processing;
    assert(
      engine.config && engine.packConfig,
      "Reviewed pack estimates, credits and processing budgets are required.",
    );
    assert(
      await engine.packsReady(),
      "Apply the reviewed Phase 4 migration first.",
    );
    const svc = services(config),
      owners: string[] = [],
      agents = [request.agent(app), request.agent(app)];
    const origin = config.APP_ORIGIN;
    const awaitPack = async (id: string, count = 1) => {
      let result: any;
      const deadline =
        Date.now() +
        (engine.config.AI_TIMEOUT_SECONDS + 240) * count * 1000 +
        60000;
      while (Date.now() < deadline) {
        const r = await agents[0].get(`/api/packs/${id}`);
        assert.equal(r.status, 200);
        result = r.body;
        if (!result.progress.pending && !result.progress.reviewing)
          return result;
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
      throw new Error(
        "Real pack did not reach terminal states within the test deadline.",
      );
    };
    try {
      for (let i = 0; i < 2; i++) {
        const email = `sonkoflow-pack-${randomUUID()}@example.invalid`,
          password = `A!${randomUUID()}long`;
        const r = await svc.admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        assert(
          !r.error && r.data.user,
          "Could not create isolated test owner.",
        );
        owners.push(r.data.user.id);
        assert.equal(
          (
            await agents[i]
              .post("/api/auth/signin")
              .set("Origin", origin)
              .send({ email, password })
          ).status,
          200,
        );
      }
      const project = await agents[0]
        .post("/api/projects")
        .set("Origin", origin)
        .send({ name: "Phase 4 live integration", audience: "ecommerce" });
      assert.equal(project.status, 201);
      const image = randomUUID();
      assert.equal(
        (
          await agents[0]
            .post("/api/images")
            .set("Origin", origin)
            .field("project_id", project.body.project.id)
            .field("id", image)
            .attach(
              "image",
              await readFile("public/images/footwear-small.webp"),
              "product.webp",
            )
        ).status,
        201,
      );
      // Optional Phase 5 extension: same real provider/pack/quality/allowance path.
      let brand: any = null;
      if (process.env.RUN_LIVE_PACK_BRAND === "1") {
        const profileId = randomUUID(),
          assetId = randomUUID(),
          presetId = randomUUID();
        const logo = await sharp({
          create: {
            width: 120,
            height: 60,
            channels: 4,
            background: "#24543A",
          },
        })
          .png()
          .toBuffer();
        const asset = await agents[0]
          .post("/api/brands/assets")
          .set("Origin", origin)
          .field("id", assetId)
          .field("name", "Isolated test logo")
          .field("kind", "logo")
          .attach("asset", logo, {
            filename: "logo.png",
            contentType: "image/png",
          });
        assert.equal(
          asset.status,
          201,
          "Brand migration and private asset storage must be available.",
        );
        assert.equal(
          (await agents[1].get(`/api/brands/assets/${assetId}/content`)).status,
          404,
        );
        const profile = await agents[0]
          .post("/api/brands")
          .set("Origin", origin)
          .send({
            id: profileId,
            data: {
              name: "Phase 5 isolated identity",
              description: "Integration fixture",
              settings: brandSettings.parse({
                logo_asset_id: assetId,
                logo_placement: "footer",
                theme: "warm",
              }),
            },
          });
        assert.equal(profile.status, 200);
        const preset = await agents[0]
          .post(`/api/brands/${profileId}/presets`)
          .set("Origin", origin)
          .send({
            id: presetId,
            data: {
              name: "Live listing",
              purpose: "listing",
              settings: { spacing: "generous" },
            },
          });
        assert.equal(preset.status, 200);
        brand = {
          profile_id: profileId,
          profile_revision: profile.body.profile.revision,
          preset_id: presetId,
          preset_revision: preset.body.preset.revision,
          overrides: { theme: "natural" },
        };
        assert.equal(
          (await agents[1].get(`/api/brands/${profileId}`)).status,
          404,
        );
      }
      const types =
        process.env.LIVE_PACK_COMPLETE === "1"
          ? ["listing", "lifestyle", "detail", "social", "wide"]
          : ["listing", "lifestyle"];
      const input = {
        ...(brand ? { brand } : {}),
        project_id: project.body.project.id,
        input_image_id: image,
        outputs: types.map((type) => ({ type, quality: "low" })),
        scene: "A restrained neutral studio with realistic light.",
        detail_focus: "Only stitching already visible in the original.",
        instructions: "Preserve the real product and existing details.",
      };
      const quote = await agents[0]
        .post("/api/packs/quote")
        .set("Origin", origin)
        .send(input);
      assert.equal(quote.status, 200);
      assert.equal(quote.body.outputs.length, types.length);
      const grant = await svc.admin.rpc("grant_pack_credits", {
        owner: owners[0],
        amount: Math.min(1000000, quote.body.reserved_credits * 3),
        request_key: randomUUID(),
        unit: engine.packConfig.AI_PACK_CREDIT_MICRO_USD,
      });
      assert(
        !grant.error,
        "Internal test allowance grant failed. This does not fund OpenAI.",
      );
      const body = {
        ...input,
        submission_key: randomUUID(),
        quote_fingerprint: quote.body.quote_fingerprint,
        provider_consent: true,
      };
      const created = await agents[0]
        .post("/api/packs")
        .set("Origin", origin)
        .send(body);
      assert.equal(
        created.status,
        202,
        "Real pack must be admitted by configured provider budgets and allowance.",
      );
      const id = created.body.pack.id;
      const duplicate = await agents[0]
        .post("/api/packs")
        .set("Origin", origin)
        .send(body);
      assert.equal(duplicate.body.pack.id, id);
      assert.equal((await agents[1].get(`/api/packs/${id}`)).status, 404);
      assert.equal(
        (await agents[1].get(`/api/packs/${id}/download`)).status,
        404,
      );
      if (brand) {
        const edit = await agents[0]
          .post("/api/brands")
          .set("Origin", origin)
          .send({
            id: brand.profile_id,
            revision: brand.profile_revision,
            data: {
              name: "Changed after submission",
              description: "",
              settings: brandSettings.parse({ theme: "cool" }),
            },
          });
        assert.equal(edit.status, 200);
      }
      let pack = await awaitPack(id, types.length);
      assert.equal(pack.outputs.length, types.length);
      for (const output of pack.outputs) {
        const j = output.current;
        assert.equal(j.status, "completed", "A real output did not finish.");
        assert(j.provider_usage, "Real generation usage is required.");
        assert.equal(j.input_image_id, image);
        if (brand) {
          assert.equal(
            j.settings.brand_snapshot.profile_name,
            "Phase 5 isolated identity",
          );
          assert.equal(
            j.settings.brand_snapshot.profile_revision,
            brand.profile_revision,
          );
          assert.equal(j.settings.brand_snapshot.settings.theme, "natural");
          assert.equal(j.settings.brand_snapshot.settings.spacing, "generous");
          assert(
            j.quality_report.checks.some(
              (c: any) => c.id === "brand_layout" && c.status === "passed",
            ),
          );
          assert(
            j.quality_report.checks.some(
              (c: any) =>
                c.id === "brand_adherence" && c.status === "needs_review",
            ),
          );
        }
        assert(
          j.quality_report?.checks.some(
            (c: any) => c.id === "integrity" && c.status === "passed",
          ),
        );
        if (engine.quality.vision)
          assert(
            j.quality_report.checks.some((c: any) => c.method === "vision"),
            "Enabled real vision assessment must provide actual findings.",
          );
        assert.equal(
          (
            await agents[0]
              .post(`/api/jobs/${j.id}/decision`)
              .set("Origin", origin)
              .send({
                decision: "approved",
                request_key: randomUUID(),
                expected_revision: 0,
                reviewed: true,
              })
          ).status,
          200,
        );
      }
      const verifyZip = async () => {
        const zip = await agents[0]
          .get(`/api/packs/${id}/download`)
          .buffer(true)
          .parse((res, callback) => {
            const chunks: Buffer[] = [];
            res.on("data", (b) => chunks.push(Buffer.from(b)));
            res.on("end", () => callback(null, Buffer.concat(chunks)));
            res.on("error", callback);
          });
        assert.equal(zip.status, 200);
        assert.match(zip.headers["content-type"], /application\/zip/);
        const archive = Buffer.isBuffer(zip.body)
          ? zip.body
          : Buffer.from(zip.text, "binary");
        const count = Number(
          execFileSync(
            "python3",
            [
              "-c",
              "import sys,io,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(len(z.infolist()))",
            ],
            { input: archive },
          )
            .toString()
            .trim(),
        );
        assert.equal(count, types.length);
      };
      await verifyZip();
      if (process.env.RUN_LIVE_PACK_RETRY === "1") {
        const parent = pack.outputs[0].current;
        assert.equal(
          (
            await agents[0]
              .post(`/api/jobs/${parent.id}/decision`)
              .set("Origin", origin)
              .send({
                decision: "rejected",
                request_key: randomUUID(),
                expected_revision: 1,
                reviewed: true,
              })
          ).status,
          200,
        );
        const concern = {
          targets: ["customer_detail"],
          instructions:
            "Keep the original lettering and surface details; use only restrained lighting improvement.",
        };
        const retryQuote = await agents[0]
          .post(`/api/packs/outputs/${parent.id}/retry-plan`)
          .set("Origin", origin)
          .send(concern);
        assert.equal(retryQuote.status, 200);
        const retry = await agents[0]
          .post(`/api/jobs/${parent.id}/quality-retry`)
          .set("Origin", origin)
          .send({
            ...concern,
            quote_fingerprint: retryQuote.body.quote_fingerprint,
            submission_key: randomUUID(),
            provider_consent: true,
          });
        assert.equal(retry.status, 202);
        pack = await awaitPack(id);
        const changed = pack.outputs.find(
          (o: any) => o.type === parent.pack_output_type,
        ).current;
        assert.equal(changed.status, "completed");
        assert.equal(changed.quality_parent_id, parent.id);
        assert.equal(changed.input_image_id, image);
        assert.equal(
          (
            await agents[0]
              .post(`/api/jobs/${changed.id}/decision`)
              .set("Origin", origin)
              .send({
                decision: "approved",
                request_key: randomUUID(),
                expected_revision: 0,
                reviewed: true,
              })
          ).status,
          200,
        );
        await verifyZip();
      }
      console.log(
        JSON.stringify({
          check: "real_product_pack",
          outputs: types.length,
          status: "passed",
          controlled_retry: process.env.RUN_LIVE_PACK_RETRY === "1",
          brand_studio: !!brand,
        }),
      );
    } finally {
      await engine.stop();
      for (const owner of owners) {
        const active = await svc.admin
          .from("processing_jobs")
          .select("id")
          .eq("user_id", owner)
          .in("status", ["queued", "running", "persisting", "uncertain"]);
        const reviewing = await svc.admin
          .from("processing_jobs")
          .select("id")
          .eq("user_id", owner)
          .in("quality_state", ["pending", "running"]);
        const unresolved = await svc.admin
          .from("pack_credit_reservations")
          .select("job_id")
          .eq("user_id", owner)
          .eq("state", "held")
          .not("dispatched_at", "is", null);
        if (
          active.error ||
          reviewing.error ||
          unresolved.error ||
          active.data?.length ||
          reviewing.data?.length ||
          unresolved.data?.length
        ) {
          console.log(
            JSON.stringify({
              check: "cleanup_pending",
              test_owner_id: owner,
              reason: "active_or_unreconciled_usage_retained",
            }),
          );
          continue;
        }
        const photos = await svc.admin
          .from("images")
          .select("object_key")
          .eq("user_id", owner);
        if (photos.data?.length) {
          const r = await svc.admin.storage
            .from("photos")
            .remove(photos.data.map((i) => i.object_key));
          assert(!r.error, "Test storage cleanup needs attention.");
        }
        if (process.env.RUN_LIVE_PACK_BRAND === "1") {
          const assets = await svc.admin
            .from("brand_assets")
            .select("object_key")
            .eq("user_id", owner);
          assert(!assets.error, "Brand cleanup metadata unavailable.");
          if (assets.data?.length) {
            const deleted = await svc.admin.storage
              .from("photos")
              .remove(assets.data.map((a) => a.object_key));
            assert(
              !deleted.error,
              "Brand test storage cleanup needs attention.",
            );
          }
        }
        const r = await svc.admin.auth.admin.deleteUser(owner);
        assert(!r.error, "Test account cleanup needs attention.");
      }
    }
  },
);
