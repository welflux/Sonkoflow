import { brandPicker } from "./brand-ui.js";
function el(t, text) {
  const n = document.createElement(t);
  if (text) n.textContent = text;
  return n;
}
function note(n, e) {
  n.textContent = e.message ?? e;
  n.className = "notice";
}
export async function batchesPage(api, shell, project) {
  const page = shell("batches");
  page.innerHTML =
    '<div class="page-heading"><div><p class="eyebrow">A COLLECTION, CONSIDERED TOGETHER</p><h1>Bulk processing.</h1><p>Review your photographs and allowance before any AI generation.</p></div></div><div id="batch-notice" class="notice" role="status"></div><section class="panel"><form id="batch-form"><label>Project<select name="project" required></select></label><label>Batch name<input name="name" maxlength="100" required></label><label>Product photographs<input type="file" multiple accept="image/jpeg,image/png,image/webp" name="files"></label><p id="batch-limit" class="help"></p><div id="batch-files"></div><label>Output quality<select name="quality"><option>low</option><option>medium</option><option>high</option></select></label><label class="check-row"><input name="complete" type="checkbox"><span>Complete five-view product pack for every source (additional allowance)</span></label><label>Additional instructions<textarea name="instructions" maxlength="800"></textarea></label><p class="help">Products only. All views preserve the real product; creative settings and close details require review. Uploads are saved as originals before planning. Removing a selection does not erase an already saved upload.</p><button id="batch-review">Upload and review allowance</button></form><div id="batch-quote" hidden></div></section><section class="panel"><h2>Saved batches</h2><div id="batch-history"></div></section>';
  const notice = page.querySelector("#batch-notice"),
    form = page.querySelector("form"),
    cap = await api("/batches/capabilities");
  const projects = await api("/projects");
  for (const p of projects.projects) {
    const o = el("option", p.name);
    o.value = p.id;
    form.elements.project.append(o);
  }
  if (project) form.elements.project.value = project;
  page.querySelector("#batch-limit").textContent =
    `Up to ${cap.max_images} images / ${Math.floor(cap.max_bytes / 1048576)} MB combined; 10 MB per original. Actual storage and generation limits also apply.`;
  const history = await api("/batches").catch(() => ({ batches: [] }));
  for (const b of history.batches) {
    const a = el(
      "a",
      `${b.name} · ${new Date(b.created_at).toLocaleDateString()}`,
    );
    a.href = `/app/batches/${b.id}`;
    const p = el("p");
    p.append(a);
    page.querySelector("#batch-history").append(p);
  }
  let rows = [],
    revision = 0,
    submission = crypto.randomUUID();
  const quote = page.querySelector("#batch-quote");
  const invalidate = () => {
    revision++;
    quote.hidden = true;
    submission = crypto.randomUUID();
  };
  const brand = await brandPicker(api, form, {
    pack: true,
    onChange: invalidate,
  });
  form.oninput = invalidate;
  const render = () => {
    const list = page.querySelector("#batch-files");
    list.replaceChildren();
    for (const row of rows) {
      const line = el("div");
      line.className = "batch-file-row";
      line.append(
        el(
          "span",
          `${row.file.name} · ${(row.file.size / 1048576).toFixed(2)} MB · ${row.error ?? (row.saved ? "Uploaded privately" : "Ready to upload")}`,
        ),
      );
      const remove = el("button", "Remove");
      remove.type = "button";
      remove.onclick = () => {
        rows = rows.filter((r) => r !== row);
        invalidate();
        render();
      };
      line.append(remove);
      list.append(line);
    }
  };
  form.elements.files.onchange = async () => {
    invalidate();
    rows = [
      ...rows,
      ...Array.from(form.elements.files.files).map((file) => ({
        file,
        id: crypto.randomUUID(),
        saved: false,
        error: !cap.formats.includes(file.type)
          ? "Unsupported format"
          : file.size > cap.file_bytes
            ? "File exceeds 10 MB"
            : null,
      })),
    ];
    render();
  };
  if (!cap.available) {
    form.querySelector("button").disabled = true;
    note(
      notice,
      "Bulk processing requires the Phase 6 migration and configured allowance estimates.",
    );
    return;
  }
  form.elements.project.onchange = () => {
    if (rows.some((r) => r.saved)) {
      rows = [];
      render();
      note(
        notice,
        "Existing uploads remain in their original project. Select files for this project.",
      );
    }
    invalidate();
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const version = revision;
    const button = form.querySelector("button#batch-review");
    button.disabled = true;
    try {
      if (
        !rows.length ||
        rows.length > cap.max_images ||
        rows.reduce((s, r) => s + r.file.size, 0) > cap.max_bytes
      )
        throw Error("Review the batch file-count and combined-size limits.");
      if (rows.some((r) => r.error && !r.retryable))
        throw Error("Remove or replace invalid files.");
      for (const row of rows) {
        if (row.saved) continue;
        const data = new FormData();
        data.set("id", row.id);
        data.set("project_id", form.elements.project.value);
        data.set("image", row.file);
        try {
          await api("/images", {
            method: "POST",
            headers: { "X-Sonkoflow-Bulk": "1" },
            body: data,
          });
          row.saved = true;
          row.error = null;
        } catch (err) {
          row.error = err.message;
          row.retryable = err.status >= 500;
          render();
          throw err;
        }
        render();
      }
      if (version !== revision)
        throw Error("Selections changed while uploading. Review them again.");
      const input = {
        project_id: form.elements.project.value,
        name: form.elements.name.value,
        image_ids: rows.map((r) => r.id),
        outputs: (form.elements.complete.checked
          ? ["listing", "lifestyle", "detail", "social", "wide"]
          : ["listing"]
        ).map((type) => ({ type, quality: form.elements.quality.value })),
        instructions: form.elements.instructions.value,
        ...(brand.value() ? { brand: brand.value() } : {}),
      };
      const plan = await api("/batches/quote", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (version !== revision) return;
      quote.replaceChildren(
        el("h2", "Review your batch"),
        el(
          "p",
          `${plan.images} sources · ${plan.outputs} outputs · estimated ${plan.estimated_credits} credits · reservation ${plan.reserved_credits} · available ${plan.allowance.available_credits}`,
        ),
      );
      const label = el("label"),
        consent = el("input");
      consent.type = "checkbox";
      label.className = "check-row";
      label.append(
        consent,
        el(
          "span",
          "I have permission to send these photographs to OpenAI and understand that each output can incur usage.",
        ),
      );
      const generate = el("button", "Confirm batch");
      generate.disabled = !plan.can_generate;
      generate.onclick = async () => {
        if (!consent.checked) {
          note(
            notice,
            "Confirm permission and provider usage before submitting.",
          );
          return;
        }
        generate.disabled = true;
        try {
          const r = await api("/batches", {
            method: "POST",
            body: JSON.stringify({
              ...input,
              submission_key: submission,
              quote_fingerprint: plan.quote_fingerprint,
              provider_consent: true,
            }),
          });
          location.assign(`/app/batches/${r.id}`);
        } catch (err) {
          note(notice, err);
          generate.disabled = false;
        }
      };
      quote.append(label, generate);
      quote.hidden = false;
    } catch (err) {
      note(notice, err);
    } finally {
      button.disabled = false;
    }
  };
}
export async function batchPage(api, shell, id) {
  const page = shell("batches");
  page.innerHTML =
    '<a href="/app/batches" class="breadcrumb">← All batches</a><div class="page-heading"><h1 id="batch-name">Batch results</h1><button id="batch-cancel" class="danger">Cancel queued work</button></div><p id="batch-progress" role="status"></p><div id="batch-notice" class="notice"></div><div id="batch-download"></div><div id="batch-items" class="pack-gallery"></div>';
  let stopped = false,
    timer;
  window.addEventListener(
    "pagehide",
    () => {
      stopped = true;
      clearTimeout(timer);
    },
    { once: true },
  );
  const notice = page.querySelector("#batch-notice");
  page.querySelector("#batch-cancel").onclick = async () => {
    if (
      !confirm(
        "Cancel queued outputs? Running requests may finish and incur usage; saved results are retained.",
      )
    )
      return;
    try {
      await api(`/batches/${id}/cancel`, { method: "POST", body: "{}" });
      await refresh();
    } catch (e) {
      note(notice, e);
    }
  };
  async function refresh() {
    if (stopped) return;
    try {
      const r = await api(`/batches/${id}`);
      page.querySelector("#batch-name").textContent = r.batch.name;
      page.querySelector("#batch-progress").textContent =
        `${r.status.replaceAll("_", " ")} · ${r.counts.total} sources · ${r.counts.queued} queued · ${r.counts.processing} processing · ${r.counts.completed} completed · ${r.counts.failed} failed/partial · ${r.counts.cancelled} cancelled`;
      const list = page.querySelector("#batch-items");
      const selected = new Set(
        Array.from(list.querySelectorAll("input:checked")).map((c) => c.value),
      );
      list.replaceChildren();
      for (const item of r.items) {
        const card = el("article");
        card.className = "panel";
        const a = el(
          "a",
          `Source ${item.position + 1}: review outputs, quality and retries`,
        );
        a.href = `/app/packs/${item.pack_id}`;
        const image = el("img");
        image.loading = "lazy";
        image.src = `/api/images/${item.input_image_id}/content`;
        image.alt = `Original source ${item.position + 1}`;
        image.style.maxWidth = "160px";
        card.append(a, image);
        for (const o of item.outputs)
          card.append(
            el(
              "p",
              `${o.spec.name}: ${o.current?.status ?? "Missing record"} · quality ${o.current?.quality_state ?? "unavailable"} · ${o.current?.user_decision ?? "not approved"}${o.current?.message ? ` · ${o.current.message}` : ""}`,
            ),
          );
        if (item.progress.approved) {
          const label = el("label"),
            check = el("input");
          check.type = "checkbox";
          check.value = item.pack_id;
          check.checked = selected.has(item.pack_id);
          label.append(check, el("span", "Include approved outputs in ZIP"));
          card.append(label);
        }
        list.append(card);
      }
      const dl = page.querySelector("#batch-download");
      dl.replaceChildren();
      const download = el("button", "Download selected approved outputs");
      download.onclick = () => {
        const ids = Array.from(list.querySelectorAll("input:checked")).map(
          (c) => c.value,
        );
        if (!ids.length) {
          note(notice, "Select a source with approved outputs.");
          return;
        }
        location.assign(`/api/batches/${id}/download?packs=${ids.join(",")}`);
      };
      dl.append(download);
      if (r.counts.queued || r.counts.processing)
        timer = setTimeout(refresh, 3000);
    } catch (e) {
      note(notice, e);
    }
  }
  await refresh();
}
