const fields = {
  primary_color: ["Primary color", "color", "#243F37"],
  secondary_color: ["Secondary color / strip", "color", "#F3F1EB"],
  accent_color: ["Accent color", "color", "#D5A66D"],
  background_style: [
    "Background",
    ["preserve", "neutral", "solid", "studio"],
    "neutral",
  ],
  background_color: ["Background color", "color", "#F3F1EB"],
  theme: [
    "Visual theme",
    ["restrained", "warm", "cool", "editorial", "natural"],
    "restrained",
  ],
  image_style: [
    "Photographic style",
    ["realistic", "soft", "crisp"],
    "realistic",
  ],
  canvas: [
    "Preferred canvas",
    ["match", "square", "landscape", "portrait"],
    "square",
  ],
  framing: [
    "Product framing",
    ["full_product", "centered", "negative_space"],
    "full_product",
  ],
  spacing: ["Subject spacing", ["tight", "balanced", "generous"], "balanced"],
  restrictions: ["Visual restrictions", "textarea", ""],
  instructions: ["Saved editing direction", "textarea", ""],
  logo_asset_id: ["Uploaded logo", [], ""],
  logo_placement: ["Logo treatment", ["none", "footer"], "none"],
  logo_align: ["Logo alignment", ["left", "center", "right"], "right"],
};
function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
function button(text, fn, cls = "secondary") {
  const n = el("button", text, cls);
  n.type = "button";
  n.onclick = fn;
  return n;
}
function note(n, text, error = false) {
  n.textContent = text;
  n.className = `notice${error ? " error" : ""}`;
  n.setAttribute("role", error ? "alert" : "status");
}
function option(s, label, value) {
  const o = el("option", label);
  o.value = value;
  s.append(o);
}
function readSettings(root, partial = false) {
  const r = {};
  for (const k of Object.keys(fields)) {
    if (partial && !root.querySelector(`[data-override="${k}"]`)?.checked)
      continue;
    const c = root.querySelector(`[data-setting="${k}"]`);
    r[k] = k === "logo_asset_id" ? c.value || null : c.value;
  }
  return r;
}
function settingsForm(settings, assets, partial = false, onChange = () => {}) {
  const root = el("div", null, "brand-settings");
  for (const [key, [label, type, fallback]] of Object.entries(fields)) {
    const row = el("div", null, "brand-setting"),
      l = el("label", label.replaceAll("_", " "));
    let c;
    if (Array.isArray(type)) {
      c = el("select");
      if (key === "logo_asset_id") {
        option(c, "No logo", "");
        for (const a of assets.filter((a) => a.kind === "logo"))
          option(c, a.name, a.id);
      } else for (const v of type) option(c, v.replaceAll("_", " "), v);
    } else {
      c = el(type === "textarea" ? "textarea" : "input");
      if (type === "color") c.type = "color";
      if (type === "textarea") {
        c.rows = 2;
        c.maxLength = key === "restrictions" ? 500 : 700;
      }
    }
    c.dataset.setting = key;
    c.value = settings[key] ?? fallback;
    c.setAttribute("aria-label", label);
    l.append(c);
    if (partial) {
      const toggle = el("input");
      toggle.type = "checkbox";
      toggle.dataset.override = key;
      toggle.checked = Object.hasOwn(settings, key);
      const t = el("label", null, "check-row");
      t.append(toggle, el("span", `Override ${label.toLowerCase()}`));
      row.append(t);
      c.disabled = !toggle.checked;
      toggle.onchange = () => {
        c.disabled = !toggle.checked;
        onChange();
      };
    }
    c.oninput = onChange;
    row.append(l);
    root.append(row);
  }
  return root;
}
export function brandPreview(
  settings,
  assets = [],
  title = "Visual configuration preview",
) {
  const s = Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, settings[k] ?? v[2]]),
    ),
    box = el("figure", null, "brand-preview");
  const h = el("figcaption", title);
  const canvas = el(
    "div",
    null,
    `brand-preview-canvas brand-space-${s.spacing}`,
  );
  canvas.style.aspectRatio =
    s.canvas === "landscape"
      ? "3 / 2"
      : s.canvas === "portrait"
        ? "2 / 3"
        : "1 / 1";
  canvas.style.background =
    s.background_style === "solid" ? s.background_color : s.secondary_color;
  const subject = el("div", "Product area", "brand-preview-subject");
  subject.style.borderColor = s.primary_color;
  subject.style.color = s.primary_color;
  if (s.framing === "negative_space") subject.style.marginLeft = "auto";
  canvas.append(subject);
  if (s.logo_placement === "footer" && s.logo_asset_id) {
    const footer = el("div", null, "brand-preview-footer");
    footer.style.background = s.secondary_color;
    footer.style.justifyContent =
      s.logo_align === "left"
        ? "flex-start"
        : s.logo_align === "center"
          ? "center"
          : "flex-end";
    const img = el("img");
    img.src = `/api/brands/assets/${s.logo_asset_id}/content`;
    img.alt = "Uploaded brand logo";
    footer.append(img);
    canvas.append(footer);
  }
  const palette = el("div", null, "brand-palette");
  for (const key of ["primary_color", "secondary_color", "accent_color"]) {
    const sw = el("span", s[key]);
    sw.style.borderTop = `12px solid ${s[key]}`;
    palette.append(sw);
  }
  box.append(
    h,
    canvas,
    palette,
    el(
      "p",
      `${s.theme} · ${s.image_style} · ${s.framing.replaceAll("_", " ")} · ${s.spacing} spacing`,
      "help",
    ),
    el(
      "p",
      "Layout illustration, not a generated result. Brand colors apply to surroundings; the real product keeps its own colors. Exact visual matches require review.",
      "help",
    ),
  );
  return box;
}
export async function brandPicker(
  api,
  host,
  {
    onDefaults = () => {},
    onChange = () => {},
    pack = false,
    explicitSettings = () => ({}),
  } = {},
) {
  const empty = { value: () => undefined };
  let cap;
  try {
    cap = await api("/brands/capabilities");
  } catch {
    return empty;
  }
  if (!cap.available) return empty;
  const box = el("fieldset", null, "brand-picker"),
    legend = el("legend", "Brand direction"),
    l = el("label", "Saved brand profile"),
    select = el("select"),
    pl = el("label", "Reusable preset"),
    preset = el("select"),
    slot = el("div"),
    preview = el("div"),
    notice = el("p", null, "help");
  select.setAttribute("aria-label", "Saved brand profile");
  preset.setAttribute("aria-label", "Reusable preset");
  option(select, "No brand profile", "");
  option(preset, "Profile defaults", "");
  l.append(select);
  pl.append(preset);
  const link = el("a", "Manage Brand Studio", "text-link");
  link.href = "/app/brands";
  box.append(legend, l, pl, link, notice, slot, preview);
  host.append(box);
  let profiles, assets;
  try {
    const loaded = await Promise.all([api("/brands"), api("/brands/assets")]);
    profiles = loaded[0].profiles;
    assets = loaded[1].assets;
  } catch (error) {
    note(
      notice,
      `Brand settings could not load: ${error.message} You can continue without a brand profile.`,
      true,
    );
    select.disabled = true;
    preset.disabled = true;
    return empty;
  }
  for (const p of profiles) option(select, p.name, p.id);
  let profile = null,
    presets = [],
    controls = null,
    epoch = 0;
  function update() {
    onChange();
    if (!profile) return;
    const s = {
      ...profile.settings,
      ...presets.find((p) => p.id === preset.value)?.settings,
      ...readSettings(controls, true),
    };
    preview.replaceChildren(
      brandPreview(
        { ...s, ...explicitSettings(s), ...(pack ? { canvas: "square" } : {}) },
        assets,
        pack
          ? "Style preview · output canvases are listed in the pack plan"
          : "Visual configuration preview",
      ),
    );
  }
  function apply() {
    const pr = presets.find((p) => p.id === preset.value);
    const s = { ...profile.settings, ...pr?.settings };
    const overrides = controls ? readSettings(controls, true) : {};
    controls = settingsForm(overrides, assets, true, update);
    slot.replaceChildren(controls);
    for (const k of Object.keys(fields)) {
      const c = controls.querySelector(`[data-setting="${k}"]`);
      c.value = overrides[k] ?? s[k] ?? fields[k][2];
    }
    for (const key of pack ? ["canvas"] : ["canvas", "background_style"]) {
      const c = controls.querySelector(`[data-setting="${key}"]`);
      c.closest(".brand-setting").hidden = true;
      const toggle = controls.querySelector(`[data-override="${key}"]`);
      toggle.checked = false;
    }
    onDefaults(s);
    notice.textContent = pack
      ? "Pack output types keep their selected canvases. Brand defaults style the surroundings across all outputs. Overrides affect this pack only."
      : "Profile → preset → explicit choices. Existing Canvas and Background controls take priority. Overrides affect this edit only.";
    update();
  }
  select.onchange = async () => {
    const version = ++epoch;
    profile = null;
    slot.replaceChildren();
    preview.replaceChildren();
    onChange();
    optionReset();
    if (!select.value) return;
    try {
      const r = await api(`/brands/${select.value}`);
      if (version !== epoch) return;
      profile = r.profile;
      presets = r.presets;
      for (const p of presets) option(preset, p.name, p.id);
      apply();
    } catch (e) {
      note(notice, e.message, true);
    }
  };
  function optionReset() {
    preset.replaceChildren();
    option(preset, "Profile defaults", "");
  }
  preset.onchange = () => {
    if (profile) apply();
  };
  return {
    refresh: update,
    value: () => {
      if (select.value && !profile)
        throw new Error(
          "Wait for the selected brand profile to load, or choose No brand profile.",
        );
      return profile
        ? {
            profile_id: profile.id,
            profile_revision: profile.revision,
            ...(preset.value
              ? {
                  preset_id: preset.value,
                  preset_revision: presets.find((p) => p.id === preset.value)
                    .revision,
                }
              : {}),
            overrides: readSettings(controls, true),
          }
        : undefined;
    },
  };
}
export function brandHistory(snapshot) {
  const box = el("details", null, "brand-history");
  box.append(
    el(
      "summary",
      `Brand: ${snapshot.profile_name} · revision ${snapshot.profile_revision}${snapshot.preset_name ? ` / ${snapshot.preset_name} · revision ${snapshot.preset_revision}` : ""}`,
    ),
  );
  box.append(brandPreview(snapshot.settings));
  const dl = el("dl");
  for (const [k, v] of Object.entries(snapshot.settings)) {
    if (k === "logo_asset_id") continue;
    dl.append(el("dt", k.replaceAll("_", " ")), el("dd", String(v || "None")));
  }
  box.append(
    dl,
    el(
      "p",
      "These settings were recorded with this job. Later profile edits or deletion do not change this record.",
      "help",
    ),
  );
  return box;
}
export async function brandStudio(api, shell) {
  const page = shell("brands");
  page.innerHTML =
    '<div class="page-heading"><div><p class="eyebrow">YOUR VISUAL LANGUAGE</p><h1>Brand Studio.</h1><p>A considered direction, ready for your next product photograph.</p></div></div><div id="brand-notice" class="notice" role="status"></div><div class="brand-layout"><aside class="panel"><h2>Your brands</h2><div id="brand-list"></div><button id="brand-new" class="secondary">Create brand profile</button><a class="text-link" href="/app">Apply a brand from a product project</a></aside><div id="brand-editor"></div></div><section class="panel brand-library"><h2>Private asset library</h2><p>Logos and reference images · PNG, JPEG or WebP · up to 2 MB / 8 megapixels. Normalized to lossless WebP, maximum 1024 pixels per side. SVG and animation are not supported.</p><p class="help">Only a selected logo is composited into results. Reference assets are stored for your review; this phase does not send them to the AI. Brand styling is available in product edits and image packs. Business presets may be saved, but are not applied to personal photographs or headshots.</p><form id="brand-upload"><label>Asset name<input name="name" maxlength="100" required></label><label>Asset type<select name="kind"><option value="logo">Logo</option><option value="reference">Visual reference</option></select></label><label>File<input name="asset" type="file" accept="image/png,image/jpeg,image/webp" required></label><button>Upload asset</button><div class="notice" role="status"></div></form><div id="brand-assets" class="brand-asset-grid"></div><p class="help">Up to 20 active profiles and 20 presets per profile. Asset storage is capped at 50 files / 25 MB including retained historical assets. Removed assets are hidden from new selections but retained privately for saved jobs.</p></section>';
  const top = page.querySelector("#brand-notice"),
    editor = page.querySelector("#brand-editor");
  let profiles = [],
    assets = [],
    selectedId = null,
    loadRevision = 0;
  try {
    const cap = await api("/brands/capabilities");
    if (!cap.available) {
      note(
        top,
        "Brand Studio is unavailable until the Phase 5 database migration is applied. Existing projects are retained.",
      );
      page.querySelector("#brand-new").disabled = true;
      page.querySelector("#brand-upload").hidden = true;
      return;
    }
    await refresh();
  } catch (e) {
    note(top, e.message, true);
    return;
  }
  async function refresh() {
    [{ profiles }, { assets }] = await Promise.all([
      api("/brands"),
      api("/brands/assets"),
    ]);
    const list = page.querySelector("#brand-list");
    list.replaceChildren();
    if (!profiles.length)
      list.append(el("p", "Create your first saved visual direction.", "help"));
    for (const p of profiles) {
      const b = button(p.name, () => load(p.id));
      b.classList.add("brand-list-item");
      list.append(b);
    }
    const grid = page.querySelector("#brand-assets");
    grid.replaceChildren();
    for (const a of assets) {
      const c = el("article", null, "brand-asset"),
        img = el("img");
      img.src = `/api/brands/assets/${a.id}/content`;
      img.alt = a.name;
      const remove = button(
        "Remove asset",
        async () => {
          if (
            !confirm(
              "Hide this asset from new selections? Saved jobs retain their private reference.",
            )
          )
            return;
          try {
            await api(`/brands/assets/${a.id}`, { method: "DELETE" });
            await refresh();
            if (selectedId) await load(selectedId);
          } catch (e) {
            note(top, e.message, true);
          }
        },
        "danger",
      );
      c.append(
        img,
        el("strong", a.name),
        el("small", `${a.kind} · ${a.width} × ${a.height}`),
        remove,
      );
      grid.append(c);
    }
  }
  async function load(id) {
    const version = ++loadRevision;
    editor.replaceChildren(el("p", "Loading brand settings…", "notice"));
    try {
      const r = await api(`/brands/${id}`);
      if (version !== loadRevision) return;
      selectedId = id;
      render(r.profile, r.presets);
    } catch (e) {
      note(top, e.message, true);
    }
  }
  function render(profile = null, presets = []) {
    editor.replaceChildren();
    const form = el("form", null, "panel"),
      head = el(
        "h2",
        profile ? "Edit visual identity" : "Create visual identity",
      ),
      nameLabel = el("label", "Brand name"),
      name = el("input"),
      descriptionLabel = el("label", "Description"),
      description = el("textarea"),
      preview = el("div", null, "brand-preview-slot"),
      message = el("div", null, "notice");
    name.required = true;
    name.maxLength = 100;
    name.value = profile?.name ?? "";
    name.setAttribute("aria-label", "Brand name");
    description.maxLength = 500;
    description.value = profile?.description ?? "";
    descriptionLabel.append(description);
    nameLabel.append(name);
    let controls;
    const update = () =>
      preview.replaceChildren(brandPreview(readSettings(controls), assets));
    controls = settingsForm(profile?.settings ?? {}, assets, false, update);
    const save = el(
      "button",
      profile ? "Save profile changes" : "Save brand profile",
    );
    const identityLayout = el("div", null, "brand-identity-layout");
    identityLayout.append(controls, preview);
    form.append(
      head,
      nameLabel,
      descriptionLabel,
      identityLayout,
      el(
        "p",
        "The optional logo footer reserves 14% of the canvas and fits the entire edited photograph above it. It does not paste over the product. Check final composition and logo legibility.",
        "help",
      ),
      message,
      save,
    );
    editor.append(form);
    update();
    const intent = profile?.id ?? crypto.randomUUID();
    form.onsubmit = async (e) => {
      e.preventDefault();
      save.disabled = true;
      try {
        const r = await api("/brands", {
          method: "POST",
          body: JSON.stringify({
            id: intent,
            revision: profile?.revision ?? null,
            data: {
              name: name.value,
              description: description.value,
              settings: readSettings(controls),
            },
          }),
        });
        await refresh();
        await load(r.profile.id);
        note(top, "Brand profile saved.");
      } catch (err) {
        note(message, err.message, true);
        save.disabled = false;
      }
    };
    if (!profile) return;
    const actions = el("div", null, "result-actions");
    actions.append(
      button("Duplicate profile", async () => {
        try {
          const r = await api("/brands", {
            method: "POST",
            body: JSON.stringify({
              id: crypto.randomUUID(),
              parent: profile.id,
              revision: profile.revision,
              action: "duplicate",
            }),
          });
          await refresh();
          await load(r.profile.id);
        } catch (e) {
          note(message, e.message, true);
        }
      }),
      button(
        "Delete profile",
        async () => {
          if (
            !confirm(
              "Delete this brand profile and its presets? Saved jobs keep their recorded settings.",
            )
          )
            return;
          try {
            await api("/brands", {
              method: "POST",
              body: JSON.stringify({
                id: profile.id,
                revision: profile.revision,
                action: "delete",
              }),
            });
            selectedId = null;
            await refresh();
            render();
          } catch (e) {
            note(message, e.message, true);
          }
        },
        "danger",
      ),
    );
    form.append(actions);
    const section = el("section", null, "panel brand-presets");
    section.append(
      el("h2", "Reusable presets"),
      el(
        "p",
        "Save only the settings that should differ from the profile. Unchecked fields inherit future profile defaults.",
        "help",
      ),
    );
    editor.append(section);
    for (const p of presets) {
      const row = el("div", null, "brand-preset-row");
      row.append(
        el("strong", p.name),
        el("span", `${p.purpose} · revision ${p.revision}`),
        button("Edit preset", () => editPreset(p)),
        button(
          "Delete preset",
          async () => {
            try {
              await api(`/brands/${profile.id}/presets`, {
                method: "POST",
                body: JSON.stringify({
                  id: p.id,
                  revision: p.revision,
                  action: "delete",
                }),
              });
              await load(profile.id);
            } catch (e) {
              note(top, e.message, true);
            }
          },
          "danger",
        ),
      );
      section.append(row);
    }
    const target = el("div");
    section.append(
      button("Create reusable preset", () => editPreset()),
      target,
    );
    function editPreset(p = null) {
      target.replaceChildren();
      const f = el("form"),
        nl = el("label", "Preset name"),
        n = el("input"),
        pl = el("label", "Purpose"),
        purpose = el("select"),
        msg = el("div", null, "notice");
      n.required = true;
      n.maxLength = 100;
      n.value = p?.name ?? "";
      n.setAttribute("aria-label", "Preset name");
      nl.append(n);
      for (const v of ["listing", "lifestyle", "promotional", "business"])
        option(purpose, v, v);
      purpose.value = p?.purpose ?? "listing";
      pl.append(purpose);
      const c = settingsForm(p?.settings ?? {}, assets, true);
      const sb = el("button", "Save preset");
      f.append(nl, pl, c, msg, sb);
      target.append(f);
      const id = p?.id ?? crypto.randomUUID();
      f.onsubmit = async (e) => {
        e.preventDefault();
        sb.disabled = true;
        try {
          await api(`/brands/${profile.id}/presets`, {
            method: "POST",
            body: JSON.stringify({
              id,
              revision: p?.revision ?? null,
              data: {
                name: n.value,
                purpose: purpose.value,
                settings: readSettings(c, true),
              },
            }),
          });
          await load(profile.id);
          note(top, "Preset saved.");
        } catch (err) {
          note(msg, err.message, true);
          sb.disabled = false;
        }
      };
    }
  }
  page.querySelector("#brand-new").onclick = () => {
    loadRevision++;
    selectedId = null;
    render();
  };
  render();
  const upload = page.querySelector("#brand-upload");
  let uploadId = crypto.randomUUID();
  upload.elements.asset.onchange = () => (uploadId = crypto.randomUUID());
  upload.onsubmit = async (e) => {
    e.preventDefault();
    const b = upload.querySelector("button"),
      n = upload.querySelector(".notice");
    b.disabled = true;
    try {
      const data = new FormData(upload);
      data.set("id", uploadId);
      await api("/brands/assets", { method: "POST", body: data });
      upload.reset();
      uploadId = crypto.randomUUID();
      await refresh();
      for (const selector of editor.querySelectorAll(
        "[data-setting=logo_asset_id]",
      )) {
        for (const a of assets.filter((a) => a.kind === "logo")) {
          if (!Array.from(selector.options).some((o) => o.value === a.id))
            option(selector, a.name, a.id);
        }
      }
      note(n, "Asset saved privately.");
    } catch (err) {
      note(n, err.message, true);
    } finally {
      b.disabled = false;
    }
  };
}
