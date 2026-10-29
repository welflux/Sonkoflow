import { brandPicker } from "./brand-ui.js";
import "./bulk-workspace.css";

const outputTypes = [
  {
    type: "listing",
    name: "Clean listing",
    aspect: "1:1",
    shape: "square",
    copy: "Neutral product presentation",
  },
  {
    type: "lifestyle",
    name: "Lifestyle",
    aspect: "3:2",
    shape: "landscape",
    copy: "A setting around your product",
  },
  {
    type: "detail",
    name: "Detail",
    aspect: "1:1",
    shape: "detail",
    copy: "Details visible in the source",
  },
  {
    type: "social",
    name: "Social",
    aspect: "1:1",
    shape: "square",
    copy: "A square photographic composition",
  },
  {
    type: "wide",
    name: "Wide promotion",
    aspect: "3:2",
    shape: "landscape",
    copy: "Landscape promotional space",
  },
];
const qualityNames = { low: "Essential", medium: "Studio", high: "Signature" };
const localFileLimit = 100;
const mb = (bytes) =>
  `${(bytes / 1048576).toLocaleString(undefined, { maximumFractionDigits: 2 })} MB`;
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function tell(node, message, error = false) {
  node.textContent = message?.message ?? message;
  node.className = `notice${error ? " error" : ""}`;
  node.setAttribute("role", error ? "alert" : "status");
}
function link(text, href, className) {
  const node = el("a", text, className);
  node.href = href;
  return node;
}

export async function bulkWorkspace(api, shell, project) {
  const page = shell("batches");
  page.classList.add("bulk-workspace");
  page.innerHTML = `
    <header class="page-heading bulk-heading"><div><p class="eyebrow">PRODUCTION WORKSPACE</p><h1>Bulk processing</h1><p>Stage your product photographs. Set the direction. Review before you run.</p></div><a class="bulk-text-link" href="#batch-history-section">Batch history ↓</a></header>
    <div id="batch-notice" class="notice" role="status"></div>
    <form id="batch-form" novalidate>
      <div class="bulk-layout">
        <details class="bulk-panel bulk-setup" open><summary><span class="bulk-step">01</span><span>Batch setup</span><span class="bulk-disclosure" aria-hidden="true">⌄</span></summary>
          <div class="bulk-setup-content">
            <label>Project<select name="project" aria-label="Project" required aria-describedby="batch-project-help"><option value="">Loading projects…</option></select></label><p id="batch-project-help" class="bulk-helper">Originals are saved to this project.</p>
            <label>Batch name<input name="name" maxlength="100" placeholder="e.g. Autumn product collection" required autocomplete="off"></label>
            <label>Output quality<select name="quality" aria-label="Output quality"><option value="low">Essential</option><option value="medium">Studio</option><option value="high">Signature</option></select></label>
            <div id="batch-brand-slot"><p class="bulk-helper">Loading Brand Studio options…</p></div>
            <details class="bulk-direction"><summary>Additional instructions</summary><label class="bulk-instruction-label">Editing direction<textarea name="instructions" maxlength="800" rows="4" placeholder="Describe any important requirements for this batch."></textarea></label></details>
            <a class="bulk-text-link" href="/app/brands">Manage Brand Studio ↗</a>
          </div>
        </details>
        <section class="bulk-panel bulk-stage" aria-labelledby="batch-stage-heading">
          <div class="bulk-panel-heading"><h2 id="batch-stage-heading"><span class="bulk-step">02</span> Source photographs</h2><span id="batch-count" class="bulk-count" aria-live="polite">0 staged</span></div>
          <div id="batch-dropzone" class="bulk-dropzone"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M16 21V4m-6 6 6-6 6 6M5 20v8h22v-8"/></svg><strong>Drop product photos or a folder</strong><span>Keep your originals together in one private batch.</span><div class="bulk-drop-actions"><button type="button" id="batch-browse" class="secondary">Choose photographs</button><button type="button" id="batch-folder" class="bulk-quiet">Choose folder</button></div><input id="batch-upload" class="bulk-file-input" tabindex="-1" name="files" type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="Product photographs"><input class="bulk-file-input" tabindex="-1" name="folder" type="file" multiple webkitdirectory aria-label="Product photograph folder"><p id="batch-limit" class="bulk-helper">Loading your upload limits…</p></div>
          <div class="bulk-queue-toolbar"><span id="batch-queue-meta" role="status">No photographs selected</span><div><button type="button" class="bulk-quiet" id="batch-select-all" disabled>Select all</button><button type="button" class="bulk-quiet" id="batch-remove-selected" disabled>Remove selected</button><button type="button" class="bulk-quiet" id="batch-clear" disabled>Clear queue</button></div></div>
          <div id="batch-files" class="bulk-file-grid" aria-label="Staged photographs"></div>
          <p class="bulk-source-note">Allowance review saves private originals to your project. Clearing this queue does not delete an uploaded original.</p>
          <div id="batch-empty" class="bulk-empty"><span aria-hidden="true">＋</span><strong>Your collection starts here</strong><p>Add a few photographs, then choose the outputs you need below.</p></div>
          <fieldset class="bulk-output-fieldset"><legend>Output selection</legend><p class="bulk-helper">Apply the same selected outputs to every source photograph.</p><div class="bulk-output-actions"><button type="button" class="bulk-quiet" id="batch-all-outputs">Select all five</button><button type="button" class="bulk-quiet" id="batch-listing-only">Listing only</button></div><div class="bulk-output-grid" id="batch-output-options"></div><p class="bulk-helper">Canvas sizes follow each output type. Creative scenes and product details need your review.</p></fieldset>
        </section>
        <aside class="bulk-panel bulk-allowance" aria-labelledby="batch-allowance-heading"><div class="bulk-panel-heading"><h2 id="batch-allowance-heading"><span class="bulk-step">03</span> Allowance & run</h2></div><div class="bulk-run-state"><span class="bulk-status-dot" aria-hidden="true"></span><span id="batch-run-state">Prepare your batch</span></div><dl class="bulk-summary"><div><dt>Source photographs</dt><dd id="batch-source-total">0</dd></div><div><dt>Outputs per source</dt><dd id="batch-type-total">1</dd></div><div class="bulk-summary-total"><dt>Planned outputs</dt><dd id="batch-output-total">0</dd></div></dl><div id="batch-quote" hidden></div><div id="batch-unquoted"><span class="bulk-micro">COST REVIEW</span><strong>Review first. Run with confidence.</strong><p>Your verified estimate, reservation and available units appear here after upload and review.</p></div><div class="bulk-run-notes"><span class="bulk-micro">YOU STAY IN CONTROL</span><p>No generation starts during upload or allowance review. Confirm provider permission before starting.</p><a class="bulk-text-link" href="/app/billing">Plan & usage ↗</a></div></aside>
      </div>
    </form>
    <section id="batch-history-section" class="bulk-panel bulk-history" aria-labelledby="batch-history-heading"><div class="bulk-history-heading"><div><p class="bulk-micro">SAVED PRODUCTION</p><h2 id="batch-history-heading">Batch history</h2></div><button type="button" class="secondary" id="batch-history-refresh">Refresh history</button></div><div id="batch-history" aria-live="polite"><p class="bulk-helper">Loading saved batches…</p></div></section>
    <div class="bulk-actionbar"><div><strong id="batch-action-summary">Stage your photographs</strong><span id="batch-action-hint">Upload and review before any generation.</span></div><button type="submit" form="batch-form" id="batch-review" disabled>Upload and review allowance <span aria-hidden="true">↗</span></button></div>`;

  if (matchMedia("(max-width: 600px)").matches)
    page.querySelector(".bulk-setup").open = false;
  const form = page.querySelector("#batch-form"),
    notice = page.querySelector("#batch-notice"),
    quote = page.querySelector("#batch-quote"),
    review = page.querySelector("#batch-review"),
    files = form.elements.files,
    folder = form.elements.folder,
    dropzone = page.querySelector("#batch-dropzone"),
    brandSlot = page.querySelector("#batch-brand-slot");
  let rows = [],
    cap = null,
    projects = [],
    initialized = false,
    busy = false,
    importing = false,
    stopped = false,
    leaving = false,
    revision = 0,
    submission = crypto.randomUUID(),
    brand = { value: () => undefined },
    historyEpoch = 0;
  const selectedOutputs = () =>
    [...form.querySelectorAll('[name="output"]:checked')].map(
      (input) => input.value,
    );
  const invalidate = () => {
    revision++;
    submission = crypto.randomUUID();
    quote.hidden = true;
    page.querySelector("#batch-unquoted").hidden = false;
    updateSummary();
  };
  for (const spec of outputTypes) {
    const label = el("label", undefined, "bulk-output-option");
    const input = el("input");
    input.type = "checkbox";
    input.name = "output";
    input.value = spec.type;
    input.checked = spec.type === "listing";
    const body = el("span", undefined, "bulk-output-body"),
      shape = el("span", undefined, `bulk-output-shape ${spec.shape}`);
    shape.setAttribute("aria-hidden", "true");
    body.append(
      shape,
      el("strong", spec.name),
      el("small", `${spec.aspect} · ${spec.copy}`),
    );
    label.append(input, body);
    page.querySelector("#batch-output-options").append(label);
  }
  function updateSummary() {
    const types = selectedOutputs().length,
      bytes = rows.reduce((sum, row) => sum + row.file.size, 0),
      invalid = rows.filter((row) => row.error && !row.retryable).length,
      reading = rows.some((row) => row.reading),
      overLimit =
        cap && (rows.length > cap.max_images || bytes > cap.max_bytes);
    page.querySelector("#batch-count").textContent = `${rows.length} staged`;
    page.querySelector("#batch-source-total").textContent = String(rows.length);
    page.querySelector("#batch-type-total").textContent = String(types);
    page.querySelector("#batch-output-total").textContent = String(
      rows.length * types,
    );
    page.querySelector("#batch-queue-meta").textContent = rows.length
      ? `${rows.length} files · ${mb(bytes)}${invalid ? ` · ${invalid} need attention` : ""}`
      : "No photographs selected";
    page.querySelector("#batch-empty").hidden = !!rows.length;
    dropzone.classList.toggle("has-files", !!rows.length);
    page.querySelector("#batch-select-all").disabled = busy || !rows.length;
    page.querySelector("#batch-select-all").textContent =
      rows.length && rows.every((row) => row.selected)
        ? "Deselect all"
        : "Select all";
    page.querySelector("#batch-remove-selected").disabled =
      busy || !rows.some((row) => row.selected);
    page.querySelector("#batch-clear").disabled = busy || !rows.length;
    review.disabled =
      busy ||
      importing ||
      !initialized ||
      !cap?.available ||
      !projects.length ||
      !rows.length ||
      !types ||
      !!invalid ||
      reading ||
      !!overLimit;
    page.querySelector("#batch-action-summary").textContent = busy
      ? "Reviewing your batch…"
      : `${rows.length} sources · ${rows.length * types} planned outputs`;
    page.querySelector("#batch-action-hint").textContent = overLimit
      ? `Your limit is ${cap.max_images} sources / ${mb(cap.max_bytes)} combined. Remove files to continue.`
      : invalid
        ? "Remove or replace files that need attention."
        : reading || importing
          ? "Reading your photographs…"
          : !types
            ? "Select at least one output type."
            : "Nothing runs until you confirm the allowance review.";
    if (quote.hidden)
      page.querySelector("#batch-run-state").textContent =
        cap && !cap.available
          ? "Generation unavailable"
          : overLimit || invalid
            ? "Selection needs attention"
            : reading || importing
              ? "Reading photographs"
              : rows.length
                ? "Ready to review"
                : "Prepare your batch";
  }
  function release(row) {
    if (row.url) URL.revokeObjectURL(row.url);
  }
  function removeRows(predicate) {
    if (busy) return;
    rows.filter(predicate).forEach(release);
    rows = rows.filter((row) => !predicate(row));
    invalidate();
    render();
  }
  function render() {
    const grid = page.querySelector("#batch-files");
    grid.replaceChildren();
    for (const row of rows) {
      const card = el(
          "article",
          undefined,
          `batch-file-row bulk-file-card${row.error ? " has-error" : ""}`,
        ),
        visual = el("div", undefined, "bulk-file-visual"),
        status = el(
          "span",
          row.uploading
            ? "Uploading…"
            : row.reading
              ? "Reading…"
              : row.error
                ? "Needs attention"
                : row.saved
                  ? "Uploaded privately"
                  : "Ready",
          `bulk-file-status${row.error ? " is-error" : ""}`,
        );
      if (row.url && !row.error) {
        const img = el("img");
        img.src = row.url;
        img.alt = `Source preview: ${row.file.name}`;
        visual.append(img);
      } else
        visual.append(el("span", row.error ? "!" : "…", "bulk-file-fallback"));
      visual.append(status);
      const select = el("input");
      select.type = "checkbox";
      select.checked = !!row.selected;
      select.disabled = busy;
      select.setAttribute("aria-label", `Select ${row.file.name}`);
      select.className = "bulk-file-select";
      select.onchange = () => {
        row.selected = select.checked;
        updateSummary();
      };
      const remove = el("button", "×", "bulk-file-remove");
      remove.type = "button";
      remove.disabled = busy;
      remove.setAttribute("aria-label", `Remove ${row.file.name}`);
      remove.onclick = () => removeRows((r) => r === row);
      visual.append(select, remove);
      const name = el("strong", row.file.name, "bulk-file-name");
      name.title = row.file.webkitRelativePath || row.file.name;
      const format =
        row.file.type.replace("image/", "").toUpperCase() || "Unknown format";
      const meta = el(
        "span",
        `${format} · ${mb(row.file.size)}${row.width ? ` · ${row.width} × ${row.height} px` : ""}`,
        "bulk-file-meta",
      );
      card.append(visual, name, meta);
      if (row.error || row.warning)
        card.append(
          el(
            "span",
            row.error || row.warning,
            row.error ? "bulk-file-error" : "bulk-file-warning",
          ),
        );
      grid.append(card);
    }
    updateSummary();
  }
  function validate(row) {
    if (!cap || row.saved) return;
    row.error = !cap.formats.includes(row.file.type)
      ? "Unsupported format"
      : row.file.size > cap.file_bytes
        ? `Exceeds ${mb(cap.file_bytes)} per file`
        : row.decodeError
          ? "Image could not be read"
          : row.width &&
              (row.width < 64 ||
                row.height < 64 ||
                row.width * row.height > 25000000)
            ? "Requires 64 × 64 px minimum and 25 MP maximum"
            : null;
  }
  async function addFiles(incoming) {
    if (busy || !incoming.length) return;
    if (rows.length + incoming.length > localFileLimit) {
      tell(
        notice,
        `Stage up to ${localFileLimit} files at a time. No files from this selection were added. Your server-reported batch limit still applies.`,
        true,
      );
      return;
    }
    invalidate();
    const added = incoming.map((file) => ({
      file,
      id: crypto.randomUUID(),
      saved: false,
      reading: false,
      selected: false,
    }));
    for (const row of added) {
      validate(row);
      if (
        !row.error &&
        ["image/jpeg", "image/png", "image/webp"].includes(row.file.type) &&
        row.file.size <= (cap?.file_bytes ?? 10485760)
      ) {
        row.url = URL.createObjectURL(row.file);
        row.reading = true;
      }
    }
    rows.push(...added);
    render();
    // Decode in a bounded sequence; staging a folder must not decode 100 images at once.
    for (const row of added.filter((row) => row.reading)) {
      if (stopped || !rows.includes(row)) {
        row.reading = false;
        continue;
      }
      try {
        const bitmap = await createImageBitmap(row.file);
        row.width = bitmap.width;
        row.height = bitmap.height;
        bitmap.close();
        if (row.width < 512 || row.height < 512)
          row.warning = "Small source · inspect final details";
      } catch {
        row.decodeError = true;
      }
      row.reading = false;
      validate(row);
      if (!stopped && rows.includes(row)) render();
    }
  }
  files.onchange = () => {
    const incoming = [...files.files];
    files.value = "";
    void addFiles(incoming);
  };
  folder.onchange = () => {
    const incoming = [...folder.files];
    folder.value = "";
    void addFiles(incoming);
  };
  page.querySelector("#batch-browse").onclick = () => files.click();
  page.querySelector("#batch-folder").onclick = () => folder.click();
  page.querySelector("#batch-clear").onclick = () => removeRows(() => true);
  page.querySelector("#batch-remove-selected").onclick = () =>
    removeRows((row) => row.selected);
  page.querySelector("#batch-select-all").onclick = () => {
    const selected = !rows.every((row) => row.selected);
    rows.forEach((row) => (row.selected = selected));
    render();
  };
  for (const [id, all] of [
    ["batch-all-outputs", true],
    ["batch-listing-only", false],
  ])
    page.querySelector(`#${id}`).onclick = () => {
      if (busy) return;
      form
        .querySelectorAll('[name="output"]')
        .forEach((input) => (input.checked = all || input.value === "listing"));
      invalidate();
    };
  form.addEventListener("input", (event) => {
    if (
      !event.target.closest("#batch-quote") &&
      !event.target.matches('[type="file"], .bulk-file-select')
    )
      invalidate();
  });
  form.elements.project.addEventListener("change", () => {
    if (rows.some((row) => row.saved)) {
      rows.forEach(release);
      rows = [];
      render();
      tell(
        notice,
        "Uploaded originals remain in their previous project. Choose source photographs for this project.",
      );
    }
    invalidate();
  });
  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (!busy) dropzone.classList.add("is-dragging");
  });
  dropzone.addEventListener("dragleave", (event) => {
    if (!dropzone.contains(event.relatedTarget))
      dropzone.classList.remove("is-dragging");
  });
  dropzone.addEventListener("drop", async (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-dragging");
    if (busy || importing) return;
    const data = event.dataTransfer,
      entries = [...(data.items ?? [])]
        .map((item) => item.webkitGetAsEntry?.())
        .filter(Boolean),
      fallback = [...data.files];
    importing = true;
    invalidate();
    const incoming = [];
    async function read(entry) {
      if (incoming.length + rows.length > localFileLimit)
        throw Error(
          `A folder selection can stage at most ${localFileLimit} files. Choose a smaller folder.`,
        );
      if (entry.isFile)
        incoming.push(
          await new Promise((resolve, reject) => entry.file(resolve, reject)),
        );
      else if (entry.isDirectory) {
        const reader = entry.createReader();
        for (;;) {
          const children = await new Promise((resolve, reject) =>
            reader.readEntries(resolve, reject),
          );
          if (!children.length) break;
          for (const child of children) await read(child);
        }
      }
    }
    try {
      if (entries.length) for (const entry of entries) await read(entry);
      else incoming.push(...fallback);
      await addFiles(incoming);
    } catch (error) {
      tell(notice, error, true);
    } finally {
      importing = false;
      updateSummary();
    }
  });
  const lock = (value) => {
    busy = value;
    for (const control of form.querySelectorAll(
      "input, select, textarea, button",
    )) {
      if (value) {
        control.dataset.bulkDisabled = String(control.disabled);
        control.disabled = true;
      } else if (control.dataset.bulkDisabled !== undefined) {
        control.disabled = control.dataset.bulkDisabled === "true";
        delete control.dataset.bulkDisabled;
      }
    }
    form.setAttribute("aria-busy", String(value));
    review.textContent = value
      ? "Reviewing…"
      : "Upload and review allowance ↗";
    render();
  };
  window.addEventListener("beforeunload", (event) => {
    if (!leaving && rows.length) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.addEventListener(
    "pagehide",
    () => {
      stopped = true;
      rows.forEach(release);
    },
    { once: true },
  );
  function showQuote(plan, input, version) {
    quote.replaceChildren(
      el("span", "VERIFIED ALLOWANCE REVIEW", "bulk-micro"),
    );
    const dl = el("dl", undefined, "bulk-summary bulk-cost-summary");
    for (const [label, value] of [
      ["Estimated usage", plan.estimated_credits],
      ["Temporary reservation", plan.reserved_credits],
      ["Available units", plan.allowance.available_credits],
    ]) {
      const row = el("div");
      row.append(el("dt", label), el("dd", String(value)));
      dl.append(row);
    }
    const meter = el("progress");
    meter.max = Math.max(
      plan.allowance.available_credits,
      plan.reserved_credits,
      1,
    );
    meter.value = plan.reserved_credits;
    meter.setAttribute(
      "aria-label",
      "Reserved units relative to available allowance",
    );
    const help = el(
      "p",
      "The reservation holds units while work runs. Final usage may differ from the estimate.",
      "bulk-helper",
    );
    const label = el("label", undefined, "bulk-consent"),
      consent = el("input");
    consent.type = "checkbox";
    label.append(
      consent,
      el(
        "span",
        "I have permission to send these photographs to OpenAI and understand that each output can incur usage.",
      ),
    );
    const generate = el("button", "Confirm batch");
    generate.type = "button";
    generate.disabled = true;
    consent.onchange = () => {
      generate.disabled = !consent.checked || !plan.can_generate;
    };
    generate.onclick = async () => {
      if (
        busy ||
        !consent.checked ||
        !plan.can_generate ||
        version !== revision
      )
        return;
      // Freeze the reviewed configuration; retries keep the same submission key.
      lock(true);
      generate.disabled = true;
      try {
        const result = await api("/batches", {
          method: "POST",
          body: JSON.stringify({
            ...input,
            submission_key: submission,
            quote_fingerprint: plan.quote_fingerprint,
            provider_consent: true,
          }),
        });
        leaving = true;
        location.assign(`/app/batches/${result.id}`);
      } catch (error) {
        tell(notice, error, true);
      } finally {
        lock(false);
        generate.disabled = !consent.checked || !plan.can_generate;
      }
    };
    quote.append(dl, meter, help);
    if (!plan.can_generate)
      quote.append(
        el(
          "p",
          "Your available units do not cover this reservation. Review Plan & usage or reduce your batch.",
          "bulk-quote-warning",
        ),
        link("Review Plan & usage ↗", "/app/billing", "bulk-text-link"),
      );
    quote.append(label, generate);
    quote.hidden = false;
    page.querySelector("#batch-unquoted").hidden = true;
    page.querySelector("#batch-run-state").textContent = plan.can_generate
      ? "Awaiting your confirmation"
      : "More allowance needed";
    if (matchMedia("(max-width: 1180px)").matches)
      quote.scrollIntoView({ behavior: "auto", block: "center" });
  }
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (review.disabled || busy) return;
    if (!form.checkValidity()) {
      page.querySelector(".bulk-setup").open = true;
      form.reportValidity();
      return;
    }
    const version = revision;
    try {
      const selectedBrand = brand.value(),
        input = {
          project_id: form.elements.project.value,
          name: form.elements.name.value.trim(),
          image_ids: rows.map((row) => row.id),
          outputs: selectedOutputs().map((type) => ({
            type,
            quality: form.elements.quality.value,
          })),
          instructions: form.elements.instructions.value,
          ...(selectedBrand ? { brand: selectedBrand } : {}),
        };
      if (!input.name) throw Error("Give this batch a name before reviewing.");
      quote.hidden = true;
      page.querySelector("#batch-unquoted").hidden = false;
      lock(true);
      tell(notice, "");
      for (const row of rows) {
        if (row.saved) continue;
        const data = new FormData();
        data.set("id", row.id);
        data.set("project_id", input.project_id);
        data.set("image", row.file);
        row.uploading = true;
        render();
        try {
          await api("/images", {
            method: "POST",
            headers: { "X-Sonkoflow-Bulk": "1" },
            body: data,
          });
          row.uploading = false;
          row.saved = true;
          row.error = null;
          row.retryable = false;
        } catch (error) {
          row.uploading = false;
          row.error = error.message;
          row.retryable =
            !error.status || error.status >= 500 || error.status === 429;
          render();
          throw error;
        }
        render();
      }
      if (version !== revision)
        throw Error("Selections changed while uploading. Review them again.");
      const plan = await api("/batches/quote", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (version === revision) showQuote(plan, input, version);
    } catch (error) {
      tell(notice, error, true);
    } finally {
      if (busy) lock(false);
    }
  };

  // Bind staging before metadata loads, so an early file selection is never lost.
  void loadHistory();
  page.querySelector("#batch-history-refresh").onclick = () => loadHistory();
  try {
    const [capabilities, loaded] = await Promise.all([
      api("/batches/capabilities"),
      api("/projects"),
    ]);
    if (stopped) return;
    cap = capabilities;
    projects = loaded.projects;
    form.elements.project.replaceChildren();
    for (const p of projects) {
      const option = el("option", p.name);
      option.value = p.id;
      form.elements.project.append(option);
    }
    if (!projects.length) {
      const option = el("option", "Create a project first");
      option.value = "";
      form.elements.project.append(option);
      tell(
        notice,
        "Create a project before uploading a batch. Your staged files will stay here while you review.",
      );
    }
    if (project && projects.some((p) => p.id === project))
      form.elements.project.value = project;
    page.querySelector("#batch-limit").textContent =
      `${cap.formats.map((format) => format.replace("image/", "").toUpperCase()).join(", ")} · ${mb(cap.file_bytes)} per file · ${cap.max_images} sources / ${mb(cap.max_bytes)} combined`;
    rows.forEach(validate);
    render();
    if (!cap.available)
      tell(
        notice,
        cap.reason ||
          "Bulk generation is not available yet. You can stage photographs and revisit saved batches.",
      );
    brandSlot.replaceChildren();
    brand = await brandPicker(api, brandSlot, {
      pack: true,
      onChange: invalidate,
    });
    // Keep saved profile/preset selection visible, with optional per-batch overrides tucked away.
    // Move the existing containers intact so Brand Studio keeps its own state and event handlers.
    const picker = brandSlot.querySelector(".brand-picker");
    if (picker) {
      const sections = [...picker.children].filter(
        (child) => child.tagName === "DIV",
      );
      if (sections.length === 2) {
        const details = el("details", undefined, "bulk-brand-details");
        details.append(
          el("summary", "Preview & adjust selected brand"),
          ...sections,
        );
        picker.append(details);
        const profileChoice = picker.querySelector(
          'select[aria-label="Saved brand profile"]',
        );
        const syncDetails = () => {
          details.hidden = !profileChoice.value;
        };
        picker.addEventListener("change", syncDetails);
        syncDetails();
      }
    }
    if (!brandSlot.children.length)
      brandSlot.append(
        el(
          "p",
          "No saved brand direction selected. Product identity remains based on your source.",
          "bulk-helper",
        ),
      );
    initialized = true;
    updateSummary();
  } catch (error) {
    tell(
      notice,
      `Batch setup could not load: ${error.message} Reload this page to try again.`,
      true,
    );
  }
  if (!projects.length)
    page
      .querySelector("#batch-project-help")
      .replaceChildren(link("Create a project ↗", "/app", "bulk-text-link"));

  async function loadHistory(offset = 0, append = false) {
    const epoch = ++historyEpoch,
      host = page.querySelector("#batch-history"),
      refresh = page.querySelector("#batch-history-refresh");
    refresh.disabled = true;
    if (!append)
      host.replaceChildren(el("p", "Loading saved batches…", "bulk-helper"));
    try {
      const result = await api(`/batches${offset ? `?offset=${offset}` : ""}`);
      if (stopped || epoch !== historyEpoch) return;
      if (!append) host.replaceChildren();
      if (!result.batches.length && !append) {
        const empty = el("div", undefined, "bulk-history-empty");
        empty.append(
          el("strong", "No saved batches yet"),
          el(
            "p",
            "Confirmed batches appear here with their source count, output status and review links.",
            "bulk-helper",
          ),
          link("Stage a new batch ↑", "#batch-form", "bulk-text-link"),
        );
        host.append(empty);
        return;
      }
      let tbody = host.querySelector("tbody");
      if (!tbody) {
        const wrap = el("div", undefined, "bulk-table-wrap");
        wrap.tabIndex = 0;
        wrap.setAttribute("role", "region");
        wrap.setAttribute("aria-label", "Saved batch runs");
        const table = el("table"),
          thead = el("thead"),
          headings = el("tr");
        for (const title of [
          "Batch / project",
          "Created",
          "Run status",
          "Sources",
          "Quality",
          "Outputs",
          "Actions",
        ]) {
          const th = el("th", title);
          th.scope = "col";
          headings.append(th);
        }
        thead.append(headings);
        tbody = el("tbody");
        table.append(thead, tbody);
        wrap.append(table);
        host.append(wrap);
      }
      host.querySelector(".bulk-history-more")?.remove();
      const summaries = [];
      for (const b of result.batches) {
        const row = el("tr"),
          name = el("td"),
          date = el("td"),
          status = el("td"),
          count = el("td", "—"),
          quality = el("td", "—"),
          outputs = el("td", "—"),
          actions = el("td");
        name.append(
          link(b.name, `/app/batches/${b.id}`, "bulk-history-name"),
          el("small", b.id.slice(0, 8)),
        );
        if (b.project_id)
          name.append(
            link(
              projects.find((p) => p.id === b.project_id)?.name ||
                "Open project",
              `/app/projects/${b.project_id}`,
              "bulk-history-project",
            ),
          );
        const time = el(
          "time",
          new Date(b.created_at).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        );
        time.dateTime = b.created_at;
        date.append(time);
        const detail = el("button", "Load summary", "bulk-quiet");
        detail.type = "button";
        status.append(detail);
        actions.append(
          link("View batch ↗", `/app/batches/${b.id}`, "bulk-text-link"),
        );
        detail.onclick = async () => {
          detail.disabled = true;
          detail.textContent = "Loading…";
          try {
            const data = await api(`/batches/${b.id}`);
            if (stopped || epoch !== historyEpoch) return;
            const badge = el(
              "span",
              data.status.replaceAll("_", " "),
              `bulk-history-status state-${data.status}`,
            );
            status.replaceChildren(badge);
            if (data.counts?.processing || data.counts?.queued) {
              const progress = el("progress");
              progress.max = Math.max(data.counts.total, 1);
              progress.value = data.counts.completed;
              progress.setAttribute("aria-label", "Completed sources");
              status.append(progress);
            }
            count.textContent = String(data.counts.total);
            const qualities = [
              ...new Set(
                (data.batch.configuration?.outputs ?? []).map(
                  (output) => qualityNames[output.quality] || output.quality,
                ),
              ),
            ];
            quality.textContent = qualities.join(" / ") || "—";
            const all = data.items.flatMap((item) => item.outputs),
              completed = all.filter(
                (output) => output.current?.status === "completed",
              ).length,
              approved = data.items.reduce(
                (sum, item) => sum + (item.progress.approved ?? 0),
                0,
              );
            outputs.replaceChildren(
              el("span", `${completed} / ${all.length} saved`),
              el("small", `${approved} approved`),
            );
            if (approved)
              actions.append(
                link(
                  "Approved ZIP ↓",
                  `/api/batches/${b.id}/download`,
                  "bulk-text-link",
                ),
              );
            const reuse = el("button", "Reuse setup", "bulk-quiet");
            reuse.type = "button";
            reuse.onclick = () => {
              if (busy) return;
              if (
                rows.length &&
                !confirm(
                  "Replace this staged batch? Uploaded originals stay in their existing project.",
                )
              )
                return;
              if (!projects.some((project) => project.id === b.project_id)) {
                tell(
                  notice,
                  "This batch’s project is unavailable. Create or choose a project for a new batch.",
                  true,
                );
                return;
              }
              const config = data.batch.configuration;
              if (!config?.outputs?.length) {
                tell(
                  notice,
                  "This batch’s saved setup is unavailable. Configure a new batch instead.",
                  true,
                );
                return;
              }
              rows.forEach(release);
              rows = [];
              form.reset();
              form.elements.project.value = b.project_id;
              form.elements.name.value = `${b.name} copy`.slice(0, 100);
              form.elements.quality.value = config.outputs[0].quality;
              form.elements.instructions.value = config.instructions ?? "";
              form
                .querySelectorAll('[name="output"]')
                .forEach(
                  (input) =>
                    (input.checked = config.outputs.some(
                      (output) => output.type === input.value,
                    )),
                );
              const select = brandSlot.querySelector(
                'select[aria-label="Saved brand profile"]',
              );
              if (select) {
                select.value = "";
                select.dispatchEvent(new Event("change"));
              }
              invalidate();
              render();
              page.querySelector(".bulk-setup").open = true;
              tell(
                notice,
                "Setup copied. Add source photographs and choose a brand direction before reviewing. This does not rerun the saved batch.",
              );
              page
                .querySelector("#batch-form")
                .scrollIntoView({ behavior: "auto", block: "start" });
              form.elements.name.focus({ preventScroll: true });
            };
            actions.append(reuse);
          } catch {
            detail.disabled = false;
            detail.textContent = "Retry summary";
          }
        };
        summaries.push(detail);
        row.append(name, date, status, count, quality, outputs, actions);
        tbody.append(row);
      }
      if (result.next_offset !== null && result.next_offset !== undefined) {
        const more = el(
          "button",
          "Load more batches",
          "secondary bulk-history-more",
        );
        more.type = "button";
        more.disabled = true;
        more.onclick = () => {
          more.disabled = true;
          void loadHistory(result.next_offset, true);
        };
        host.append(more);
      }
      // Read summaries through existing owner-checked endpoints, at most two at a time.
      let next = 0;
      async function summarize() {
        while (!stopped && epoch === historyEpoch && next < summaries.length)
          await summaries[next++].onclick();
      }
      void Promise.all([summarize(), summarize()]).then(() => {
        if (!stopped && epoch === historyEpoch) {
          const more = host.querySelector(".bulk-history-more");
          if (more) more.disabled = false;
        }
      });
    } catch (error) {
      if (!append)
        host.replaceChildren(
          el(
            "p",
            `Saved batches could not load: ${error.message}. Use Refresh history to try again.`,
            "bulk-history-error",
          ),
        );
      else {
        tell(notice, error, true);
        const more = host.querySelector(".bulk-history-more");
        if (more) more.disabled = false;
      }
    } finally {
      if (epoch === historyEpoch) refresh.disabled = false;
    }
  }
}
