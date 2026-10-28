import { brandPicker, brandHistory } from "./brand-ui.js";
import { renderQuality, qualitySummary } from "./quality-ui.js";
const names = {
  queued: "Queued",
  running: "Generating",
  persisting: "Saving",
  completed: "Saved",
  failed: "Failed",
  cancelled: "Cancelled",
  uncertain: "Outcome unknown",
};
function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function notify(target, text, error = false) {
  target.textContent = text;
  target.className = `notice${error ? " error" : ""}`;
  target.setAttribute("role", error ? "alert" : "status");
}
async function keyFor(scope, body) {
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
  let prior;
  try {
    prior = JSON.parse(sessionStorage.getItem(scope) || "null");
  } catch {}
  const id = prior?.digest === digest ? prior.id : crypto.randomUUID();
  try {
    sessionStorage.setItem(scope, JSON.stringify({ digest, id }));
  } catch {}
  return id;
}
export async function packEditor(api, shell, imageId) {
  const page = shell("projects");
  page.innerHTML =
    '<a class="breadcrumb" id="pack-project">← Back to project</a><div class="page-heading"><div><p class="eyebrow">ONE PRODUCT, A CONSIDERED COLLECTION</p><h1>Your product. Five possibilities.</h1><p>Select the views you need. Review the plan before any generation starts.</p></div></div><div id="page-notice" class="notice" role="status"></div><div class="editor-layout"><figure class="reference-panel"><img id="pack-reference" alt="Original product reference"><figcaption>Every output uses this original photograph.</figcaption><label>Existing product photograph<select id="pack-source"></select></label><a id="pack-upload" class="text-link">Upload a new original in this project</a></figure><section class="panel"><form id="pack-form"><h2>Build your image pack</h2><button type="button" id="pack-all" class="secondary">Select complete pack</button><div id="pack-options" class="pack-options"></div><label>Context for lifestyle and promotional scenes<textarea name="scene" maxlength="300" rows="2" placeholder="e.g. A quiet kitchen counter in soft morning light"></textarea></label><p class="help">Lifestyle and promotional outputs are creative compositions. Environmental objects are not included product accessories.</p><label>Detail to focus on<textarea name="detail_focus" maxlength="180" rows="2" placeholder="e.g. The visible stitching on the upper"></textarea></label><p class="help">Only visible source details can be referenced. A generated closer view cannot verify unseen features or recover lost information.</p><label>Additional product instructions<textarea name="instructions" maxlength="800" rows="2"></textarea></label><label class="check-row"><input name="acknowledge_uncertain" type="checkbox"><span>I understand that any earlier interrupted request may have incurred usage; a new pack can incur additional usage.</span></label><div id="pack-form-notice" class="notice" role="status"></div><button type="submit" id="pack-review" disabled>Review pack plan</button></form><section id="pack-quote" class="pack-quote" hidden></section></section></div>';
  const { image } = await api(`/images/${imageId}`),
    cap = await api("/packs/capabilities");
  if (image.role !== "original" || image.status !== "ready")
    throw new Error("Choose a ready original product photograph.");
  page.querySelector("#pack-project").href =
    `/app/projects/${image.project_id}`;
  page.querySelector("#pack-upload").href =
    `/app/projects/${image.project_id}#dropzone`;
  page.querySelector("#pack-reference").src = `/api/images/${image.id}/content`;
  const selector = page.querySelector("#pack-source");
  try {
    const source = await api(`/images?project_id=${image.project_id}`);
    for (const item of source.images ?? []) {
      if (item.role === "original" && item.status === "ready") {
        const option = el("option", item.filename);
        option.value = item.id;
        selector.append(option);
      }
    }
  } catch {}
  if (!selector.options.length) {
    const option = el("option", image.filename);
    option.value = image.id;
    selector.append(option);
  }
  selector.value = image.id;
  selector.onchange = () => location.assign(`/app/packs/new/${selector.value}`);
  const form = page.querySelector("#pack-form"),
    options = page.querySelector("#pack-options"),
    quoteBox = page.querySelector("#pack-quote"),
    review = page.querySelector("#pack-review");
  for (const [type, spec] of Object.entries(cap.outputs ?? {})) {
    const card = el("div", null, "pack-option"),
      label = el("label", null, "check-row"),
      choice = el("input");
    choice.type = "checkbox";
    choice.name = "output";
    choice.value = type;
    choice.checked = type === "listing";
    label.append(choice, el("strong", spec.name));
    card.append(
      label,
      el(
        "p",
        `${spec.size.replace("x", " × ")} · ${spec.aspect} · ${spec.creative ? "Creative composition" : "Preservation-focused"}`,
        "help",
      ),
      el("p", spec.description, "help"),
    );
    const qlabel = el("label", `${spec.name} quality`),
      quality = el("select");
    quality.name = `quality-${type}`;
    for (const q of cap.qualities ?? []) {
      const option = el(
        "option",
        q === "high" ? "High" : q === "medium" ? "Medium" : "Low",
      );
      option.value = q;
      quality.append(option);
    }
    quality.value = cap.default_quality;
    qlabel.append(quality);
    card.append(qlabel);
    options.append(card);
  }
  page.querySelector("#pack-all").disabled = cap.max_outputs < 5;
  page.querySelector("#pack-all").title =
    `Current limit: ${cap.max_outputs} outputs per pack.`;
  page
    .querySelector("#pack-options")
    .prepend(
      el("p", `Choose up to ${cap.max_outputs} output types per pack.`, "help"),
    );
  let selectionRevision = 0;
  page.querySelector("#pack-all").onclick = () => {
    selectionRevision++;
    form
      .querySelectorAll("input[name=output]")
      .forEach((c) => (c.checked = true));
    quoteBox.hidden = true;
  };
  form.oninput = () => {
    selectionRevision++;
    quoteBox.hidden = true;
  };
  const brand = await brandPicker(api, form, {
    pack: true,
    onChange: () => {
      selectionRevision++;
      quoteBox.hidden = true;
    },
  });
  if (!cap.enabled) {
    notify(
      page.querySelector("#pack-form-notice"),
      "Image packs are unavailable until the owner configures pack estimates, allowance and database support. Your original is retained.",
    );
    return;
  }
  review.disabled = false;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const revision = selectionRevision;
    review.disabled = true;
    quoteBox.hidden = true;
    try {
      const outputs = Array.from(
        form.querySelectorAll("input[name=output]:checked"),
      ).map((c) => ({
        type: c.value,
        quality: form.elements[`quality-${c.value}`].value,
      }));
      if (!outputs.length) throw new Error("Choose at least one output type.");
      if (outputs.length > cap.max_outputs)
        throw new Error(
          `Choose at most ${cap.max_outputs} outputs for this pack.`,
        );
      const body = {
        ...(brand.value() ? { brand: brand.value() } : {}),
        project_id: image.project_id,
        input_image_id: image.id,
        outputs,
        scene:
          form.elements.scene.value.trim() ||
          "A restrained, realistic environment appropriate for this product.",
        detail_focus:
          form.elements.detail_focus.value.trim() ||
          "Only details clearly visible in the original photograph.",
        instructions: form.elements.instructions.value.trim(),
        acknowledge_uncertain: form.elements.acknowledge_uncertain.checked,
      };
      const quote = await api("/packs/quote", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (revision !== selectionRevision)
        throw new Error(
          "Selections changed. Review the updated plan before generating.",
        );
      quoteBox.replaceChildren();
      quoteBox.hidden = false;
      quoteBox.append(el("h2", "Your planned outputs"));
      const list = el("ul", null, "pack-plan-list");
      for (const o of quote.outputs)
        list.append(
          el(
            "li",
            `${o.name} · ${o.size.replace("x", " × ")} · ${o.quality} quality · estimated ${o.estimated_credits} credits; hold ${o.reserved_credits}`,
          ),
        );
      quoteBox.append(list);
      quoteBox.append(
        el(
          "p",
          `Estimated use: ${quote.estimated_credits} credits. Required allowance hold: ${quote.reserved_credits} credits.`,
          "pack-credit-total",
        ),
        el(
          "p",
          `Available: ${quote.allowance.available_credits} credits · Already reserved: ${quote.allowance.reserved_credits} credits.`,
        ),
        el(
          "p",
          "Estimates use the configured model prices and token estimates for each canvas and quality. Actual usage varies. Unused reservations are released when usage is known; unknown provider outcomes remain held for reconciliation. Credits are internal usage allowance; no payment or subscription is offered.",
          "help",
        ),
      );
      const label = el("label", null, "check-row"),
        consent = el("input");
      consent.type = "checkbox";
      label.append(
        consent,
        el(
          "span",
          "I authorize these OpenAI edits and any enabled vision assessments, understand the usage reservation, and will review product fidelity.",
        ),
      );
      quoteBox.append(label);
      const status = el("p", null, "notice");
      status.setAttribute("role", "status");
      quoteBox.append(status);
      const generate = el("button", "Generate image pack");
      generate.type = "button";
      generate.disabled = true;
      consent.onchange = () =>
        (generate.disabled = !consent.checked || !quote.can_generate);
      quoteBox.append(generate);
      if (!quote.can_generate)
        notify(
          status,
          "Insufficient available allowance for this hold. No generation has started.",
          true,
        );
      generate.onclick = async () => {
        generate.disabled = true;
        try {
          const request = {
            ...body,
            quote_fingerprint: quote.quote_fingerprint,
            provider_consent: true,
          };
          const submission_key = await keyFor(
            `sonkoflow-pack:${image.id}`,
            request,
          );
          const result = await api("/packs", {
            method: "POST",
            body: JSON.stringify({ ...request, submission_key }),
          });
          location.assign(`/app/packs/${result.pack.id}`);
        } catch (e) {
          notify(status, e.message, true);
          generate.disabled = !consent.checked;
        }
      };
    } catch (e) {
      notify(page.querySelector("#pack-form-notice"), e.message, true);
    } finally {
      review.disabled = false;
    }
  };
}
export async function packResult(api, shell, id) {
  const page = shell("projects");
  page.innerHTML =
    '<a class="breadcrumb" id="pack-back">← Back to project</a><div class="page-heading"><div><p class="eyebrow">YOUR SAVED COLLECTION</p><h1>Product image pack</h1><p id="pack-progress" role="status"></p></div><div id="pack-archive"></div></div><div id="page-notice" class="notice" role="status"></div><p class="help">Each output has its own generation and quality status. A saved result is not customer-approved automatically. A ZIP includes the latest completed, approved version of each output type; partial packs can be downloaded.</p><div id="pack-gallery" class="pack-gallery"></div>';
  const cards = new Map();
  let serial = 0;
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
  const refresh = async () => {
    if (stopped) return;
    const sequence = ++serial;
    try {
      const result = await api(`/packs/${id}`);
      if (sequence !== serial || stopped) return;
      if (
        result.pack.configuration?.brand_snapshot &&
        !page.querySelector(".brand-history")
      ) {
        const history = brandHistory(result.pack.configuration.brand_snapshot);
        history.append(
          el(
            "p",
            "Each pack output keeps the canvas shown on its card. This style preview uses the first planned output.",
            "help",
          ),
        );
        page.querySelector("#pack-gallery").before(history);
      }
      const p = result.progress;
      page.querySelector("#pack-back").href = result.pack.project_id
        ? `/app/projects/${result.pack.project_id}`
        : "/app";
      page.querySelector("#pack-progress").textContent =
        `${p.completed} of ${p.total} types have saved results · ${p.failed} latest attempts failed, cancelled or uncertain · ${p.pending} latest outputs processing · ${p.reviewing} assessments pending · ${p.approved} approved`;
      const archive = page.querySelector("#pack-archive");
      archive.replaceChildren();
      if (p.approved) {
        const a = el("a", `Download approved ZIP (${p.approved})`, "button");
        a.href = `/api/packs/${id}/download`;
        archive.append(a);
      } else
        archive.append(
          el("p", "Approve a saved result to enable ZIP download.", "help"),
        );
      const gallery = page.querySelector("#pack-gallery");
      for (const output of result.outputs) {
        const digest = JSON.stringify(output),
          prior = cards.get(output.type);
        if (prior?.digest === digest) continue;
        const card = el("section", null, "panel pack-output");
        card.dataset.type = output.type;
        card.append(
          el("h2", output.spec.name),
          el(
            "p",
            `${output.spec.aspect} · ${output.spec.size.replace("x", " × ")} · ${output.spec.creative ? "Creative composition — review required" : "Preservation-focused edit"}`,
            "help",
          ),
        );
        const job = output.current;
        if (!job) {
          card.append(el("p", "No job record is available for this output."));
          if (prior) prior.card.replaceWith(card);
          else gallery.append(card);
          cards.set(output.type, { digest, card });
          continue;
        }
        card.append(
          el(
            "p",
            `${names[job.status] ?? job.status} · Quality: ${qualitySummary(job)} · Your decision: ${job.user_decision ?? "pending"}`,
            "pack-output-status",
          ),
        );
        if (job.credit_reservations) {
          const recorded = job.credit_reservations.filter(
              (r) => r.stage === "generation" && r.dispatched_at,
            ).length,
            spent = job.credit_reservations.reduce(
              (n, r) => n + (r.actual_credits ?? 0),
              0,
            );
          card.append(
            el(
              "p",
              `${recorded} generation dispatch attempts recorded · ${spent} credits reconciled · Initial estimate ${job.pack_estimated_credits} credits. Unknown usage remains reserved.`,
              "help",
            ),
          );
        }
        const comparison = el("div", null, "result-comparison");
        for (const [label, photo] of [
          ["Original reference", result.pack.input_image_id],
          [
            "Generated output",
            job.status === "completed" ? job.output_image_id : null,
          ],
        ]) {
          const figure = el("figure"),
            slot = el("div", null, "result-image");
          if (photo) {
            const img = el("img");
            img.src = `/api/images/${photo}/content`;
            img.alt = `${output.spec.name} — ${label}`;
            img.onerror = () =>
              slot.replaceChildren(
                el(
                  "p",
                  "The saved photograph could not be loaded. Open full review or reload to retry.",
                ),
              );
            slot.append(img);
          } else
            slot.append(
              el(
                "p",
                label === "Generated output"
                  ? job.message || "A completed output is not available."
                  : "Original photograph was deleted.",
              ),
            );
          figure.append(slot, el("figcaption", label));
          comparison.append(figure);
        }
        card.append(comparison);
        if (job.message) card.append(el("p", job.message, "notice error"));
        const actions = el("div", null, "result-actions");
        const link = el("a", "Open full review", "text-link");
        link.href = `/app/edits/${job.id}`;
        actions.append(link);
        if (job.status === "completed" && job.output_image_id) {
          const a = el("a", "Download image ↓", "button");
          a.href = `/api/images/${job.output_image_id}/content?download=1`;
          actions.append(a);
        }
        if (
          job.status === "queued" ||
          (job.status === "failed" && job.safe_to_retry)
        ) {
          const retry = job.status === "failed",
            button = el(
              "button",
              retry ? "Retry eligible output" : "Cancel queued output",
            );
          button.onclick = async () => {
            button.disabled = true;
            try {
              await api(`/jobs/${job.id}/${retry ? "retry" : "cancel"}`, {
                method: "POST",
                body: "{}",
              });
              await refresh();
            } catch (e) {
              notify(page.querySelector("#page-notice"), e.message, true);
              button.disabled = false;
            }
          };
          if (retry)
            card.append(
              el(
                "p",
                `An eligible provider retry reserves ${job.pack_reserved_credits} credits again. Unused reservations from the rejected attempt were released. No uncertain request is repeated automatically.`,
                "help",
              ),
            );
          actions.append(button);
        }
        card.append(actions);
        if (output.approved && output.approved.id !== job.id) {
          const older = el(
            "a",
            "A previous approved version is retained and included in the ZIP.",
            "text-link",
          );
          older.href = `/app/edits/${output.approved.id}`;
          card.append(older);
        }
        if (job.status === "completed") {
          const details = el("details", null, "pack-review"),
            summary = el(
              "summary",
              "Quality findings, approve/reject & controlled retry",
            ),
            panel = el("div");
          details.append(summary, panel);
          renderQuality(panel, job, api, refresh);
          card.append(details);
        }
        if (output.versions.length > 1) {
          const history = el("details"),
            summary = el(
              "summary",
              `Output history (${output.versions.length} versions)`,
            );
          history.append(summary);
          for (const version of output.versions) {
            const a = el(
              "a",
              `Version ${(version.quality_retry_number ?? 0) + 1} · ${names[version.status] ?? version.status} · ${version.user_decision ?? "pending"}`,
              "text-link",
            );
            a.href = `/app/edits/${version.id}`;
            history.append(a);
          }
          card.append(history);
        }
        if (prior) {
          const open = prior.card.querySelector(".pack-review")?.open;
          prior.card.replaceWith(card);
          if (open && card.querySelector(".pack-review"))
            card.querySelector(".pack-review").open = true;
        } else gallery.append(card);
        cards.set(output.type, { digest, card });
      }
      clearTimeout(timer);
      if (p.pending || p.reviewing) timer = setTimeout(refresh, 3500);
    } catch (e) {
      notify(page.querySelector("#page-notice"), e.message, true);
      if (!stopped && e.status !== 401) timer = setTimeout(refresh, 10000);
    }
  };
  await refresh();
}
export async function projectPacks(api, page, projectId) {
  const section = el("section", null, "processing-history");
  section.append(el("h2", "Product image packs"));
  page.append(section);
  try {
    const cap = await api("/packs/capabilities");
    if (!cap.history_available) {
      section.append(
        el(
          "p",
          "Pack history will appear when product packs are configured.",
          "help",
        ),
      );
      return;
    }
    let offset = 0;
    const load = async () => {
      const result = await api(
        `/packs?project_id=${projectId}&offset=${offset}`,
      );
      for (const pack of result.packs) {
        const a = el(
          "a",
          `${pack.configuration.outputs.length} product views · ${new Date(pack.created_at).toLocaleDateString()}`,
          "job-history-card",
        );
        a.href = `/app/packs/${pack.id}`;
        section.append(a);
      }
      section.querySelector("button")?.remove();
      if (result.next_offset != null) {
        offset = result.next_offset;
        const b = el("button", "Load older packs");
        b.onclick = async () => {
          b.disabled = true;
          try {
            await load();
          } catch {
            b.disabled = false;
          }
        };
        section.append(b);
      }
      if (!result.packs.length && offset === 0)
        section.append(
          el(
            "p",
            "Choose “Create image pack” on a ready original, or upload a new product photograph above.",
            "help",
          ),
        );
    };
    await load();
  } catch {
    section.append(
      el(
        "p",
        "Pack history is currently unavailable. Existing originals remain accessible.",
        "help",
      ),
    );
  }
}
