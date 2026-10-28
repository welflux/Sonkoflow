import { renderQuality, qualitySummary } from "./quality-ui.js";
const modes = {
  personal: {
    name: "Personal Photo Enhancement",
    copy: "A natural photographic finish: balanced light, color, and clarity while keeping recognizable identity and original appearance.",
    background: "preserve",
  },
  portrait: {
    name: "Professional Portraits",
    copy: "A considered headshot for your professional world. Natural skin texture, realistic light, and recognizable identity come first.",
    background: "studio",
  },
  product: {
    name: "Product Photo Enhancement",
    copy: "Improve light, background, and realistic shadows while prioritizing your product’s actual shape, colors, packaging, labels, and logos. Review every detail; exact fidelity is not guaranteed.",
    background: "clean",
  },
};
const active = new Set(["queued", "running", "persisting"]);
const labels = {
  queued: "Queued",
  running: "Editing with OpenAI",
  persisting: "Validating and saving",
  completed: "Completed",
  failed: "Could not finish",
  uncertain: "Provider outcome unknown",
  cancelled: "Cancelled",
};
function notice(el, text, error = false) {
  el.textContent = text;
  el.className = `notice${error ? " error" : ""}`;
  el.setAttribute("role", error ? "alert" : "status");
}
export async function processingEditor(api, shell, imageId) {
  const page = shell("projects");
  page.innerHTML =
    '<a class="breadcrumb" id="project-link">← Back to project</a><div class="page-heading"><div><p class="eyebrow">A new perspective</p><h1>Make your next edit.</h1><p>One reference photograph. A direction that fits.</p></div></div><div id="page-notice" class="notice" role="status"></div><div class="editor-layout"><figure class="reference-panel"><img id="reference-photo" alt="Your uploaded reference photograph"><figcaption><strong id="reference-name"></strong><span>Uploaded reference · normalized WebP</span></figcaption></figure><section class="panel editor-controls"><h2>Choose your direction</h2><form id="edit-form"><label>Enhancement mode<select name="mode" aria-label="Enhancement mode"><option value="personal">Personal Photo Enhancement</option><option value="portrait">Professional Portraits</option><option value="product">Product Photo Enhancement</option></select></label><p id="mode-description" class="mode-description"></p><div class="inline-row"><label>Output quality<select name="quality" aria-label="Output quality"></select></label><label>Canvas<select name="framing" aria-label="Canvas"><option value="match">Closest match to reference</option><option value="square">Square · 1024 × 1024</option><option value="landscape">Landscape · 1536 × 1024</option><option value="portrait">Portrait · 1024 × 1536</option></select></label></div><p class="help">The closest supported canvas may extend the background. Images are not stretched. Generation cannot recover missing detail.</p><label>Background<select name="background" aria-label="Background"><option value="preserve">Preserve the original</option><option value="clean">Clean neutral setting</option><option value="studio">Professional studio</option></select></label><fieldset id="product-controls" hidden><legend>Preservation-focused product editing</legend><p class="help">Keep the actual product, packaging, print, logos, quantity and accessories. These edits use neutral photographic backgrounds; creative lifestyle scenes are outside this workflow.</p><label class="check-row"><input type="checkbox" name="product-operation" value="background" checked><span>Background cleanup or neutral replacement</span></label><label class="check-row"><input type="checkbox" name="product-operation" value="lighting" checked><span>Lighting improvement</span></label><label class="check-row"><input type="checkbox" name="product-operation" value="color" checked><span>Color balance and contrast correction</span></label><label class="check-row"><input type="checkbox" name="product-operation" value="shadows" checked><span>Realistic shadow enhancement</span></label><label class="check-row"><input type="checkbox" name="preserve_arrangement" checked><span>Keep the exact item arrangement</span></label><label class="check-row"><input type="checkbox" name="comparison-region"><span>Focus local comparisons on a product region</span></label><div id="product-region" hidden><p class="help">Optional region in percentages of the original image. The same region is compared in the result; reframing may trigger a review warning. This does not isolate or mask the product for editing.</p><div class="inline-row"><label>Left (%)<input name="region-left" type="number" min="0" max="95" value="10"></label><label>Top (%)<input name="region-top" type="number" min="0" max="95" value="10"></label></div><div class="inline-row"><label>Width (%)<input name="region-width" type="number" min="5" max="100" value="80"></label><label>Height (%)<input name="region-height" type="number" min="5" max="100" value="80"></label></div></div><p class="help" id="product-assessment-note"></p></fieldset><label>Optional editing instructions<textarea name="instructions" maxlength="1500" rows="4" placeholder="e.g. Soften harsh shadows and keep the warm natural colors."></textarea></label><label class="check-row"><input name="preserve_appearance" type="checkbox" required checked><span id="preserve-label">Keep recognizable identity and original appearance.</span></label><label class="check-row"><input name="provider_consent" type="checkbox" required><span>I have permission to edit this photograph and send it to OpenAI for processing. I will review the result before use.</span></label><label class="check-row" id="uncertain-ack" hidden><input name="acknowledge_uncertain" type="checkbox"><span>I understand a previous interrupted request may have incurred a charge, and this new edit can incur another.</span></label><p class="help" id="processing-limits"></p><div class="notice" id="edit-notice" role="status"></div><button type="submit" disabled>Generate edited photograph</button></form></section></div>';
  const { image } = await api(`/images/${imageId}`);
  if (image.role !== "original" || image.status !== "ready")
    throw new Error("Choose a ready uploaded reference photograph.");
  page.querySelector("#project-link").href =
    `/app/projects/${image.project_id}`;
  page.querySelector("#reference-photo").src =
    `/api/images/${image.id}/content`;
  page.querySelector("#reference-name").textContent = image.filename;
  const capabilities = await api("/processing/capabilities");
  const form = page.querySelector("form");
  const submit = form.querySelector("button");
  const select = form.elements.mode;
  const setMode = () => {
    const mode = modes[select.value];
    page.querySelector("#mode-description").textContent = mode.copy;
    form.elements.background.value = mode.background;
    page.querySelector("#product-controls").hidden = select.value !== "product";
    form.elements.background.disabled =
      select.value === "product" &&
      !form.querySelector("input[value=background]").checked;
    if (form.elements.background.disabled)
      form.elements.background.value = "preserve";
    submit.disabled =
      !capabilities.enabled ||
      (select.value === "product" &&
        capabilities.product_quality_available === false);
    page.querySelector("#product-assessment-note").textContent =
      capabilities.vision_assessment
        ? "Local checks and an additional, metered AI vision assessment will run. Review findings before approving."
        : "Local checks will run. Detailed labels, packaging, visibility and instruction compliance require your review; optional AI vision assessment is disabled.";
    if (capabilities.enabled)
      notice(
        page.querySelector("#edit-notice"),
        select.value === "product" &&
          capabilities.product_quality_available === false
          ? "Product editing requires the product-quality database migration. Other enhancement modes remain available."
          : "",
      );
    page.querySelector("#preserve-label").textContent =
      select.value === "product"
        ? "Prioritize the real product’s shape, colors, labels, and logos."
        : "Keep recognizable identity and original appearance.";
  };
  select.value =
    image.audience === "ecommerce"
      ? "product"
      : image.audience === "professional"
        ? "portrait"
        : "personal";
  setMode();
  select.addEventListener("change", setMode);
  form
    .querySelector("input[value=background]")
    .addEventListener("change", () => {
      form.elements.background.disabled =
        select.value === "product" &&
        !form.querySelector("input[value=background]").checked;
      if (form.elements.background.disabled)
        form.elements.background.value = "preserve";
    });
  form.elements["comparison-region"].addEventListener("change", () => {
    page.querySelector("#product-region").hidden =
      !form.elements["comparison-region"].checked;
  });
  for (const quality of capabilities.qualities ?? []) {
    const option = document.createElement("option");
    option.value = quality;
    option.textContent =
      quality === "high"
        ? "High · finest finish"
        : quality === "medium"
          ? "Medium · balanced"
          : "Low · economical";
    form.elements.quality.append(option);
  }
  form.elements.quality.value = capabilities.default_quality;
  if (new URLSearchParams(location.search).has("review"))
    page.querySelector("#uncertain-ack").hidden = false;
  if (!capabilities.enabled) {
    notice(
      page.querySelector("#edit-notice"),
      "AI processing is not available until the owner completes provider configuration and the Phase 2 database migration. Your reference remains stored privately.",
    );
    return;
  }
  page.querySelector("#processing-limits").textContent =
    `Up to ${capabilities.daily_limit} edits per account per UTC day, within the configured shared budget. Each submission can consume provider usage. Results are saved as WebP.`;
  submit.disabled =
    select.value === "product" &&
    capabilities.product_quality_available === false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    submit.textContent = "Submitting edit…";
    form.setAttribute("aria-busy", "true");
    const target = page.querySelector("#edit-notice");
    try {
      const values = Object.fromEntries(new FormData(form));
      const body = {
        project_id: image.project_id,
        input_image_id: image.id,
        mode: values.mode,
        instructions: values.instructions,
        quality: values.quality,
        framing: values.framing,
        background: values.background ?? "preserve",
        preserve_appearance: values.preserve_appearance === "on",
        provider_consent: values.provider_consent === "on",
        acknowledge_uncertain: values.acknowledge_uncertain === "on",
      };
      if (select.value === "product") {
        body.product_options = {
          operations: new FormData(form).getAll("product-operation"),
          preserve_arrangement: form.elements.preserve_arrangement.checked,
        };
        if (form.elements["comparison-region"].checked) {
          body.product_options.region = Object.fromEntries(
            ["left", "top", "width", "height"].map((key) => [
              key,
              Number(form.elements[`region-${key}`].value) / 100,
            ]),
          );
        }
      }
      // Keep a request identifier across a lost HTTP response or browser refresh.
      // Only a digest, never the photograph/instructions/session token, is kept here.
      const digest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(JSON.stringify(body)),
          ),
        ),
      )
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const key = `sonkoflow-edit:${image.id}`;
      let prior;
      try {
        prior = JSON.parse(sessionStorage.getItem(key) || "null");
      } catch {
        /* Storage can be unavailable in privacy modes. */
      }
      const submission =
        prior?.digest === digest && /^[a-f0-9-]{36}$/.test(prior.id)
          ? prior.id
          : crypto.randomUUID();
      try {
        sessionStorage.setItem(key, JSON.stringify({ digest, id: submission }));
      } catch {
        /* The server still enforces submission and active-job limits. */
      }
      const result = await api("/jobs", {
        method: "POST",
        body: JSON.stringify({ ...body, submission_key: submission }),
      });
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Optional local recovery hint only. */
      }
      location.assign(`/app/edits/${result.job.id}`);
    } catch (error) {
      notice(target, error.message, true);
      if (error.code === "uncertain_acknowledgement_required")
        page.querySelector("#uncertain-ack").hidden = false;
      submit.disabled = false;
      submit.textContent = "Generate edited photograph";
      form.removeAttribute("aria-busy");
    }
  });
}
export async function processingResult(api, shell, id) {
  const page = shell("projects");
  page.innerHTML =
    '<a class="breadcrumb" id="result-project">← Back to project</a><div class="page-heading"><div><p class="eyebrow">Your saved edit</p><h1 id="edit-title">Your photograph, considered.</h1></div><span class="job-status" id="job-status" role="status"></span></div><div id="page-notice" class="notice" role="status"></div><div class="result-comparison"><figure><div id="original-slot" class="result-image"></div><figcaption>Uploaded reference</figcaption></figure><figure><div id="output-slot" class="result-image output-slot"></div><figcaption>OpenAI-edited photograph</figcaption></figure></div><div class="result-actions" id="result-actions"></div><p class="help result-review">Review identity, labels, logos, colors, and fine details before publishing. Generative editing can alter details; perfect fidelity is not guaranteed.</p><section class="product-quality panel" id="product-quality" hidden></section><details class="job-details"><summary>Edit details & usage</summary><div id="job-details"></div></details>';
  let stopped = false;
  let timer;
  window.addEventListener(
    "pagehide",
    () => {
      stopped = true;
      clearTimeout(timer);
    },
    { once: true },
  );
  let renderedSource, renderedOutput;
  const renderPhoto = (slot, imageId, label) => {
    slot.replaceChildren();
    if (!imageId) {
      const p = document.createElement("p");
      p.textContent = "This photograph has been deleted.";
      slot.append(p);
      return;
    }
    const img = document.createElement("img");
    img.src = `/api/images/${imageId}/content`;
    img.alt = label;
    img.onerror = () => {
      slot.replaceChildren();
      const p = document.createElement("p");
      p.textContent =
        "Photograph retrieval is unavailable. Reload to try again.";
      slot.append(p);
    };
    slot.append(img);
  };
  const refresh = async () => {
    if (stopped) return;
    try {
      const { job } = await api(`/jobs/${id}`);
      page.querySelector("#result-project").href = job.project_id
        ? `/app/projects/${job.project_id}`
        : "/app";
      page.querySelector("#edit-title").textContent =
        modes[job.mode]?.name ?? "Your saved edit";
      const status = page.querySelector("#job-status");
      status.textContent = labels[job.status] ?? job.status;
      status.dataset.state = job.status;
      if (renderedSource !== job.input_image_id) {
        renderPhoto(
          page.querySelector("#original-slot"),
          job.input_image_id,
          "Uploaded reference photograph",
        );
        renderedSource = job.input_image_id;
      }
      const output = page.querySelector("#output-slot");
      if (job.status === "completed" && job.output_image_id) {
        if (renderedOutput !== job.output_image_id) {
          renderPhoto(output, job.output_image_id, "OpenAI-edited result");
          renderedOutput = job.output_image_id;
        }
      } else {
        output.replaceChildren();
        const p = document.createElement("p");
        p.textContent =
          job.status === "completed"
            ? "The generated photograph has been deleted."
            : job.status === "queued"
              ? "Your edit is queued. You can leave this page and return later."
              : job.status === "running"
                ? "OpenAI is editing your reference. This can take several minutes."
                : job.status === "persisting"
                  ? "The response has arrived. Validating and saving the photograph…"
                  : "No completed result is available.";
        output.append(p);
      }
      notice(
        page.querySelector("#page-notice"),
        job.message || "",
        job.status === "failed" || job.status === "uncertain",
      );
      const actions = page.querySelector("#result-actions");
      actions.replaceChildren();
      const action = (text, handler) => {
        const b = document.createElement("button");
        b.textContent = text;
        b.onclick = async () => {
          b.disabled = true;
          try {
            await handler();
            await refresh();
          } catch (e) {
            notice(page.querySelector("#page-notice"), e.message, true);
            b.disabled = false;
          }
        };
        actions.append(b);
      };
      if (job.status === "completed" && job.output_image_id) {
        const a = document.createElement("a");
        a.className = "button";
        a.href = `/api/images/${job.output_image_id}/content?download=1`;
        a.textContent = "Download edited WebP ↓";
        actions.append(a);
      }
      if (job.status === "queued")
        action("Cancel queued edit", () =>
          api(`/jobs/${id}/cancel`, { method: "POST", body: "{}" }),
        );
      if (job.status === "failed" && job.safe_to_retry)
        action("Retry safely", () =>
          api(`/jobs/${id}/retry`, { method: "POST", body: "{}" }),
        );
      if (!active.has(job.status) && job.input_image_id) {
        const a = document.createElement("a");
        a.className = "text-link";
        a.href = `/app/edit/${job.input_image_id}${job.status === "uncertain" ? "?review=1" : ""}`;
        a.textContent = "Create another edit";
        actions.append(a);
      }
      renderQuality(page.querySelector("#product-quality"), job, api, refresh);
      const details = page.querySelector("#job-details");
      details.replaceChildren();
      const row = (label, value) => {
        const p = document.createElement("p");
        const strong = document.createElement("strong");
        strong.textContent = `${label}: `;
        p.append(strong, document.createTextNode(value));
        details.append(p);
      };
      row("Quality & canvas", `${job.quality} · ${job.output_size} pixels`);
      row("Model", job.model);
      row("Submitted", new Date(job.created_at).toLocaleString());
      if (job.instructions) row("Your instructions", job.instructions);
      if (job.provider_usage)
        row(
          "Provider token usage",
          `${job.provider_usage.input_tokens} input · ${job.provider_usage.output_tokens} output`,
        );
      row(
        "Estimated provider cost",
        job.cost_estimate_micro_usd == null
          ? "Not available; an unknown outcome must not be treated as free."
          : `$${(job.cost_estimate_micro_usd / 1e6).toFixed(6)} USD using configured uncached-token rates. Provider billing is authoritative.`,
      );
      if (job.quality_provider_usage)
        row(
          "Assessment token usage",
          `${job.quality_provider_usage.input_tokens} input · ${job.quality_provider_usage.output_tokens} output`,
        );
      if (job.mode === "product" && job.quality_state)
        row(
          "Assessment cost",
          job.quality_cost_micro_usd == null
            ? "No reliable provider cost estimate available. Local checks have no provider API charge."
            : `$${(job.quality_cost_micro_usd / 1e6).toFixed(6)} USD estimated; included in the total when both costs are known.`,
        );
      clearTimeout(timer);
      if (
        active.has(job.status) ||
        ["pending", "running"].includes(job.quality_state)
      )
        timer = setTimeout(refresh, 3000);
    } catch (error) {
      notice(page.querySelector("#page-notice"), error.message, true);
      if (!stopped && error.status !== 401) timer = setTimeout(refresh, 10000);
    }
  };
  await refresh();
}
export async function projectProcessing(api, page, projectId) {
  const capabilities = await api("/processing/capabilities");
  const section = document.createElement("section");
  section.className = "processing-history";
  section.innerHTML =
    '<div class="section-title"><h2>Saved edits</h2><p>Reference photographs and generated results, together.</p></div><div class="job-history-list"></div>';
  page.append(section);
  const list = section.querySelector(".job-history-list");
  if (!capabilities.history_available) {
    const p = document.createElement("p");
    p.className = "help";
    p.textContent =
      "AI editing will appear here when Phase 2 configuration is ready.";
    list.append(p);
    return;
  }
  let offset = 0;
  const load = async () => {
    const result = await api(`/jobs?project_id=${projectId}&offset=${offset}`);
    for (const job of result.jobs) {
      const a = document.createElement("a");
      a.className = "job-history-card";
      a.href = `/app/edits/${job.id}`;
      const photo =
        job.status === "completed" ? job.output_image_id : job.input_image_id;
      if (photo) {
        const img = document.createElement("img");
        img.src = `/api/images/${photo}/content`;
        img.alt = "";
        img.loading = "lazy";
        a.append(img);
      }
      const text = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = modes[job.mode]?.name ?? "Photograph edit";
      const status = document.createElement("p");
      status.textContent = `${labels[job.status] ?? job.status} · ${new Date(job.created_at).toLocaleDateString()}`;
      text.append(name, status);
      if (job.mode === "product" && job.quality_state) {
        const review = document.createElement("p");
        review.textContent = `Review: ${qualitySummary(job)} · Your decision: ${job.user_decision ?? "pending"}${job.quality_retry_number ? ` · Retry ${job.quality_retry_number}` : ""}`;
        text.append(review);
      }
      a.append(text);
      list.append(a);
    }
    if (!list.children.length) {
      const p = document.createElement("p");
      p.className = "help";
      p.textContent =
        "Choose “Enhance photograph” on an uploaded reference to start your first edit.";
      list.append(p);
    }
    section.querySelector(".load-more")?.remove();
    if (result.next_offset !== null && result.next_offset !== undefined) {
      offset = result.next_offset;
      const b = document.createElement("button");
      b.className = "secondary load-more";
      b.textContent = "Load older edits";
      b.onclick = async () => {
        b.disabled = true;
        try {
          await load();
        } catch (e) {
          b.disabled = false;
          b.textContent = "Try loading again";
        }
      };
      section.append(b);
    }
  };
  await load();
}
