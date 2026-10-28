import type { SupabaseClient } from "@supabase/supabase-js";
import type { Identity } from "../services.js";
import { AppError, hash } from "../security.js";
import {
  brandDb,
  brandSettings,
  brandSelection,
  profileInput,
  presetInput,
  type BrandSnapshot,
} from "./contracts.js";
export class BrandService {
  constructor(readonly admin: SupabaseClient) {}
  async ready() {
    const r = await this.admin.rpc("brand_schema_version");
    return !r.error && r.data === 2026102804;
  }
  async require() {
    if (!(await this.ready()))
      throw new AppError(
        503,
        "brand_unavailable",
        "Brand Studio requires the Phase 5 database migration.",
      );
  }
  async list(identity: Identity) {
    await this.require();
    const r = await identity.client
      .from("brand_profiles")
      .select("id,name,description,settings,revision,updated_at")
      .eq("deleted", false)
      .order("updated_at", { ascending: false });
    brandDb(r.error);
    return r.data ?? [];
  }
  async get(id: string, identity: Identity) {
    const r = await identity.client
      .from("brand_profiles")
      .select("id,name,description,settings,revision,updated_at")
      .eq("id", id)
      .eq("deleted", false)
      .maybeSingle();
    brandDb(r.error);
    if (!r.data)
      throw new AppError(404, "brand_not_found", "Brand profile not found.");
    return r.data;
  }
  async presets(id: string, identity: Identity) {
    await this.get(id, identity);
    const r = await identity.client
      .from("brand_presets")
      .select("id,profile_id,name,purpose,settings,revision")
      .eq("profile_id", id)
      .eq("deleted", false)
      .order("name");
    brandDb(r.error);
    return r.data ?? [];
  }
  async asset(id: string, identity: Identity) {
    const r = await identity.client
      .from("brand_assets")
      .select("id,name,kind,width,height,checksum,byte_size,status")
      .eq("id", id)
      .eq("status", "ready")
      .maybeSingle();
    brandDb(r.error);
    if (!r.data)
      throw new AppError(404, "brand_not_found", "Brand asset not found.");
    return r.data;
  }
  async validateLogo(settings: any, identity: Identity) {
    if (settings.logo_asset_id) {
      const a = await this.asset(settings.logo_asset_id, identity);
      if (a.kind !== "logo")
        throw new AppError(
          400,
          "brand_asset_invalid",
          "Choose an uploaded logo for the brand strip.",
        );
    }
    if (settings.logo_placement === "footer" && !settings.logo_asset_id)
      throw new AppError(
        400,
        "brand_asset_invalid",
        "Select a logo before enabling the brand strip.",
      );
  }
  async mutate(
    kind: "profile" | "preset",
    action: string,
    id: string,
    parent: string | null,
    revision: number | null,
    raw: any,
    identity: Identity,
  ) {
    await this.require();
    const body: Record<string, any> =
      action === "save"
        ? kind === "profile"
          ? profileInput.parse(raw)
          : presetInput.parse(raw)
        : {};
    if ("settings" in body)
      await this.validateLogo(
        kind === "preset"
          ? {
              ...(await this.get(parent!, identity)).settings,
              ...body.settings,
            }
          : body.settings,
        identity,
      );
    const r = await this.admin.rpc("mutate_brand", {
      owner: identity.userId,
      kind,
      action,
      target: id,
      parent,
      expected_revision: revision,
      payload: body,
    });
    brandDb(r.error);
    return r.data;
  }
  async resolve(
    raw: unknown,
    identity: Identity,
  ): Promise<BrandSnapshot | undefined> {
    if (!raw) return undefined;
    await this.require();
    const selected = brandSelection.parse(raw),
      p = await this.get(selected.profile_id, identity);
    let preset: any = null;
    if (selected.preset_id) {
      preset = (await this.presets(p.id, identity)).find(
        (r) => r.id === selected.preset_id,
      );
      if (!preset)
        throw new AppError(404, "brand_not_found", "Brand preset not found.");
    }
    if (
      p.revision !== selected.profile_revision ||
      (preset && preset.revision !== selected.preset_revision)
    )
      throw new AppError(
        409,
        "brand_conflict",
        "The selected profile or preset changed. Reload its preview before generating.",
      );
    const settings = brandSettings.parse({
      ...p.settings,
      ...preset?.settings,
      ...selected.overrides,
    });
    await this.validateLogo(settings, identity);
    let logo: BrandSnapshot["logo"] = null;
    if (settings.logo_placement === "footer" && settings.logo_asset_id) {
      const a = await this.asset(settings.logo_asset_id, identity);
      logo = {
        id: a.id,
        checksum: a.checksum,
        width: a.width,
        height: a.height,
      };
    }
    return {
      version: "brand-v1",
      profile_id: p.id,
      profile_name: p.name,
      profile_revision: p.revision,
      preset_id: preset?.id ?? null,
      preset_name: preset?.name ?? null,
      preset_revision: preset?.revision ?? null,
      settings,
      logo,
      precedence:
        "Profile defaults → preset → explicit job choices. Pack output canvases and preservation controls take priority. Brand palettes apply to surroundings only.",
    };
  }
  async content(id: string, identity: Identity) {
    const r = await this.admin
      .from("brand_assets")
      .select("object_key,checksum,status")
      .eq("id", id)
      .eq("user_id", identity.userId)
      .maybeSingle();
    brandDb(r.error);
    if (!r.data || !["ready", "deleted"].includes(r.data.status))
      throw new AppError(404, "brand_not_found", "Brand asset not found.");
    if (r.data.status === "deleted") {
      const historical = await identity.client
        .from("processing_jobs")
        .select("id")
        .contains("settings", { brand_snapshot: { logo: { id } } })
        .limit(1);
      brandDb(historical.error);
      if (!historical.data?.length)
        throw new AppError(404, "brand_not_found", "Brand asset not found.");
    }
    const d = await this.admin.storage
      .from("photos")
      .download(r.data.object_key);
    if (d.error || !d.data || d.data.size > 2 * 1024 * 1024)
      throw new AppError(503, "brand_storage", "Brand asset retrieval failed.");
    const b = Buffer.from(await d.data.arrayBuffer());
    if (hash(b) !== r.data.checksum)
      throw new AppError(
        503,
        "brand_storage",
        "Brand asset verification failed.",
      );
    return b;
  }
}
