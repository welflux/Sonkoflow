const node = (tag, text, cls) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
};
export function studioSettings(controls) {
  const groups = [
    [
      "Palette & environment",
      [
        "primary_color",
        "secondary_color",
        "accent_color",
        "background_color",
        "background_style",
        "theme",
      ],
    ],
    [
      "Composition & photography",
      ["canvas", "framing", "spacing", "image_style"],
    ],
    [
      "Brand rules & logo",
      [
        "restrictions",
        "instructions",
        "logo_asset_id",
        "logo_placement",
        "logo_align",
      ],
    ],
  ];
  for (const [title, keys] of groups) {
    const section = node("details", undefined, "studio-setting-group");
    section.open = title === "Palette & environment";
    const summary = node("summary");
    const header = node("h3", title);
    summary.append(header);
    section.append(summary);
    const grid = node("div", undefined, "studio-setting-grid");
    for (const key of keys) {
      const control = controls.querySelector(`[data-setting="${key}"]`);
      grid.append(control.closest(".brand-setting"));
    }
    section.append(grid);
    controls.append(section);
  }
  for (const color of controls.querySelectorAll("input[type=color]")) {
    const label = color.parentElement;
    const wrap = node("div", undefined, "studio-color-control");
    color.before(wrap);
    wrap.append(color);
    const hex = node("input");
    hex.type = "text";
    hex.value = color.value;
    hex.pattern = "#[0-9a-fA-F]{6}";
    hex.maxLength = 7;
    hex.required = true;
    hex.spellcheck = false;
    hex.autocomplete = "off";
    hex.setAttribute("aria-label", `${color.getAttribute("aria-label")} HEX`);
    wrap.append(hex);
    const original = color.oninput;
    color.oninput = () => {
      hex.value = color.value;
      original?.call(color);
    };
    hex.oninput = () => {
      if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) {
        color.value = hex.value;
        color.dispatchEvent(new Event("input", { bubbles: true }));
      } else original?.call(color);
    };
    hex.title = "Exact sRGB HEX color, for example #243F37";
  }
  const align = controls.querySelector("[data-setting=logo_align]");
  const anchors = node("div", undefined, "studio-logo-anchors");
  anchors.setAttribute("role", "group");
  anchors.setAttribute("aria-label", "Logo footer alignment");
  for (const value of ["left", "center", "right"]) {
    const button = node("button", value[0].toUpperCase() + value.slice(1));
    button.type = "button";
    button.setAttribute("aria-pressed", String(align.value === value));
    button.onclick = () => {
      align.value = value;
      align.dispatchEvent(new Event("input", { bubbles: true }));
    };
    anchors.append(button);
  }
  const original = align.oninput;
  align.oninput = () => {
    for (const button of anchors.children)
      button.setAttribute(
        "aria-pressed",
        String(button.textContent.toLowerCase() === align.value),
      );
    original?.call(align);
  };
  align.hidden = true;
  const label = align.parentElement;
  const title = node("span", "Logo alignment", "studio-field-label");
  label.replaceWith(title, align, anchors);
  const rules = controls.querySelector("[data-setting=restrictions]");
  rules.placeholder =
    "e.g. No artificial textures, no changes to labels or product colors.";
  controls.querySelector("[data-setting=instructions]").placeholder =
    "e.g. Soft directional light with a clean, neutral surface.";
}
export function stagePreview(figure, settings, state, onChange) {
  figure.classList.add("studio-preview");
  const canvas = figure.querySelector(".brand-preview-canvas");
  const subject = canvas.querySelector(".brand-preview-subject");
  subject.replaceChildren();
  subject.classList.add("studio-benchmark");
  subject.removeAttribute("style");
  const plinth = node("div", undefined, "studio-scene-plinth");
  plinth.setAttribute("aria-hidden", "true");
  canvas.insertBefore(plinth, subject);
  subject.innerHTML =
    '<div class="studio-bottle"><div class="studio-bottle-cap"></div><div class="studio-bottle-body"><span>SAMPLE<br><small>PRODUCT</small></span></div></div>';
  canvas.classList.add(
    "studio-stage",
    `studio-framing-${settings.framing || "full_product"}`,
    `studio-canvas-${settings.canvas || "square"}`,
    `studio-photo-${settings.image_style || "realistic"}`,
  );
  canvas.style.width = `min(100%, calc(max(220px, 100dvh - 480px) * ${settings.canvas === "landscape" ? 1.5 : settings.canvas === "portrait" ? 0.6667 : 1}))`;
  canvas.dataset.theme = settings.theme || "restrained";
  canvas.dataset.light = state.light;
  canvas.dataset.guides = String(state.guides);
  canvas.dataset.footer = String(
    settings.logo_placement === "footer" && !!settings.logo_asset_id,
  );
  canvas.style.setProperty(
    "--studio-primary",
    settings.primary_color || "#243f37",
  );
  canvas.style.setProperty(
    "--studio-accent",
    settings.accent_color || "#d5a66d",
  );
  const guides = node("div", undefined, "studio-guides");
  guides.setAttribute("aria-hidden", "true");
  canvas.append(guides);
  const caption = node("span", "LAYOUT SIMULATION", "studio-stage-label");
  canvas.append(caption);
  const toolbar = node("div", undefined, "studio-preview-tools");
  const group = node("div", undefined, "studio-light-options");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Preview lighting only");
  for (const [value, label] of [
    ["studio", "Studio"],
    ["daylight", "Daylight"],
    ["backlight", "Backlight"],
  ]) {
    const button = node("button", label);
    button.type = "button";
    button.setAttribute("aria-pressed", String(state.light === value));
    button.onclick = () => {
      state.light = value;
      onChange();
    };
    group.append(button);
  }
  const toggle = node("label", undefined, "studio-guides-toggle");
  const input = node("input");
  input.type = "checkbox";
  input.checked = state.guides;
  input.onchange = () => {
    state.guides = input.checked;
    onChange();
  };
  toggle.append(input, node("span", "Show guides"));
  const lighting = node("div", undefined, "studio-preview-light-control");
  lighting.append(node("span", "Preview lighting only", "studio-micro"), group);
  toolbar.append(lighting, toggle);
  figure.querySelector("figcaption").after(toolbar);
  const details = node("details", undefined, "studio-preview-disclosure");
  details.append(
    node("summary", "About this preview"),
    node(
      "p",
      "Sample product and lighting are layout simulations, not AI output or a fidelity guarantee. Preview lighting and guides are not saved generation settings. Your product keeps its own colors. A selected logo footer reserves 14% of the final canvas, rather than covering the product.",
    ),
  );
  const helps = figure.querySelectorAll(".help");
  helps[helps.length - 1]?.remove();
  figure.append(details);
}
export function assetQueue({
  form,
  api,
  onSaved,
  notify,
  canUpload = () => true,
}) {
  const input = form.elements.asset;
  input.multiple = true;
  input.required = false;
  const defaults = form.querySelector(".studio-upload-defaults");
  const defaultName = form.elements.name,
    defaultKind = form.elements.kind;
  const nameLabel = defaultName.closest("label");
  const kindLabel = defaultKind.closest("label");
  const zone = form.querySelector(".studio-dropzone");
  const queue = form.querySelector(".studio-upload-queue");
  const submit = form.querySelector("button[type=submit]");
  const clear = form.querySelector(".studio-clear-queue");
  let items = [],
    busy = false;
  const report = (text, error = false) => {
    zone.classList.toggle("has-error", error);
    notify(text, error);
  };
  function release() {
    for (const item of items) URL.revokeObjectURL(item.url);
    items = [];
    queue.replaceChildren();
    defaults.append(nameLabel, kindLabel);
    nameLabel.querySelector("input").disabled = false;
    kindLabel.querySelector("select").disabled = false;
    submit.textContent = "Upload asset";
    input.value = "";
  }
  clear.onclick = () => {
    if (busy) return;
    release();
    form.reset();
    report("");
  };
  function status(item, text, error = false) {
    item.status.textContent = text;
    item.row.dataset.state = error ? "error" : item.saved ? "saved" : "ready";
  }
  function add(files) {
    if (busy) return;
    if (files.length) report("");
    if (items.length && items.every((item) => item.saved)) {
      release();
      form.reset();
    }
    for (const file of files) {
      if (items.length >= 10) {
        report(
          "Queue up to 10 assets at a time. Upload or clear this queue before adding more.",
          true,
        );
        break;
      }
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        report(
          `${file.name}: use PNG, JPEG or WebP. SVG and animation are not supported.`,
          true,
        );
        continue;
      }
      if (file.size > 2 * 1024 * 1024 || file.size === 0) {
        report(`${file.name}: choose a file between 1 byte and 2 MB.`, true);
        continue;
      }
      const item = {
        file,
        id: crypto.randomUUID(),
        url: URL.createObjectURL(file),
        saved: false,
      };
      const row = node("article", undefined, "studio-queued-asset");
      item.row = row;
      const img = node("img");
      img.src = item.url;
      img.alt = `Preview of ${file.name}`;
      const fields = node("div", undefined, "studio-queued-fields");
      if (!items.length) {
        fields.append(nameLabel, kindLabel);
        item.name = defaultName;
        item.kind = defaultKind;
        if (!item.name.value)
          item.name.value = file.name.replace(/\.[^.]+$/, "").slice(0, 100);
      } else {
        const label = node("label", "Asset name");
        item.name = node("input");
        item.name.value = file.name.replace(/\.[^.]+$/, "").slice(0, 100);
        item.name.maxLength = 100;
        item.name.required = true;
        label.append(item.name);
        const kind = node("label", "Asset type");
        item.kind = node("select");
        for (const [value, title] of [
          ["logo", "Logo"],
          ["reference", "Visual reference"],
        ]) {
          const option = node("option", title);
          option.value = value;
          item.kind.append(option);
        }
        item.kind.value = defaultKind.value;
        kind.append(item.kind);
        fields.append(label, kind);
      }
      item.status = node(
        "span",
        `${file.name} · ${(file.size / 1024).toFixed(0)} KB · Ready to upload`,
        "studio-queue-status",
      );
      const remove = node("button", "Remove from queue", "secondary");
      remove.type = "button";
      remove.onclick = () => {
        if (busy) return;
        URL.revokeObjectURL(item.url);
        row.remove();
        items = items.filter((entry) => entry !== item);
        if (item.name === defaultName) {
          defaults.append(nameLabel, kindLabel);
          defaultName.value = "";
        }
        if (!items.length) {
          release();
          form.reset();
        }
        submit.textContent =
          items.length > 1 ? "Upload assets" : "Upload asset";
      };
      row.append(img, fields, item.status, remove);
      queue.append(row);
      items.push(item);
    }
    submit.textContent =
      items.filter((item) => !item.saved).length > 1
        ? "Upload assets"
        : "Upload asset";
  }
  input.onchange = () => {
    add([...input.files]);
    input.value = "";
  };
  for (const event of ["dragenter", "dragover"])
    zone.addEventListener(event, (e) => {
      e.preventDefault();
      zone.classList.add("is-dragging");
    });
  for (const event of ["dragleave", "drop"])
    zone.addEventListener(event, (e) => {
      e.preventDefault();
      zone.classList.remove("is-dragging");
    });
  zone.addEventListener("drop", (e) => add([...e.dataTransfer.files]));
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!canUpload()) {
      report(
        "Brand assets are still loading. Please wait before uploading.",
        true,
      );
      return;
    }
    const pending = items.filter((item) => !item.saved);
    if (!pending.length) {
      report("Choose one or more supported assets first.", true);
      return;
    }
    busy = true;
    submit.disabled = true;
    clear.disabled = true;
    input.disabled = true;
    let successes = 0;
    try {
      for (const item of pending) {
        const name = item.name.value.trim();
        if (!name) {
          status(item, "Add an asset name before uploading.", true);
          continue;
        }
        item.submission ??= { name, kind: item.kind.value };
        const body = new FormData();
        body.set("id", item.id);
        body.set("name", item.submission.name);
        body.set("kind", item.submission.kind);
        body.set("asset", item.file);
        item.name.disabled = true;
        item.kind.disabled = true;
        status(item, "Uploading securely…");
        try {
          await api("/brands/assets", { method: "POST", body });
          item.saved = true;
          successes++;
          status(item, "Saved privately");
        } catch (error) {
          status(
            item,
            `${error.message} Retry keeps the original file name and type.`,
            true,
          );
        }
      }
      if (successes) await onSaved();
      report(
        items.every((item) => item.saved)
          ? items.length === 1
            ? "Asset saved privately."
            : `${items.length} assets saved privately.`
          : "Some assets still need attention. Review the queue and retry unsaved files.",
        !items.every((item) => item.saved),
      );
    } catch (error) {
      report(error.message, true);
    } finally {
      busy = false;
      submit.disabled = false;
      clear.disabled = false;
      input.disabled = false;
      submit.textContent = items.some((item) => !item.saved)
        ? "Retry unsaved assets"
        : "Upload asset";
    }
  };
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted)
      for (const item of items) URL.revokeObjectURL(item.url);
  });
  return {
    clear: release,
    hasPending: () => items.some((item) => !item.saved),
  };
}
