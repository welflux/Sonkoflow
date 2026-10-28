const statuses = {
  passed: "Passed",
  needs_review: "Needs Review",
  failed: "Failed",
  unavailable: "Unavailable",
};
export function qualitySummary(job) {
  if (job.quality_state === "pending") return "Queued";
  if (job.quality_state === "running") return "Assessing";
  if (job.quality_state === "unavailable") return "Unavailable";
  if (job.quality_state === "completed")
    return statuses[job.quality_report?.status] ?? "Needs Review";
  return ["queued", "running", "persisting"].includes(job.status)
    ? "Awaiting generation"
    : "Not assessed";
}
async function intentKey(scope, value) {
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(value)),
      ),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  let prior;
  try {
    prior = JSON.parse(sessionStorage.getItem(scope) || "null");
  } catch {}
  const id =
    prior?.digest === digest && /^[a-f0-9-]{36}$/.test(prior.id)
      ? prior.id
      : crypto.randomUUID();
  try {
    sessionStorage.setItem(scope, JSON.stringify({ digest, id }));
  } catch {}
  return id;
}
function element(tag, text, className) {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (className) e.className = className;
  return e;
}
export function renderQuality(container, job, api, refresh) {
  container.replaceChildren();
  container.hidden = job.mode !== "product";
  if (container.hidden) return;
  container.append(element("h2", "Product quality review"));
  const note = element(
    "p",
    "Automated checks support your review. They cannot certify exact product fidelity, and never approve a result for you.",
    "help",
  );
  container.append(note);
  if (job.pack_id) {
    const back = element("a", "Back to product pack", "text-link");
    back.href = `/app/packs/${job.pack_id}`;
    container.append(back);
  }
  if (job.quality_parent_id) {
    const a = element(
      "a",
      `View previous result · retry ${job.quality_retry_number}`,
      "text-link",
    );
    a.href = `/app/edits/${job.quality_parent_id}`;
    container.append(a);
  }
  if (!job.quality_state || job.quality_state === "not_applicable") {
    container.append(
      element(
        "p",
        "Quality review is not available for this record. Compare the photographs yourself.",
      ),
    );
    return;
  }
  if (["pending", "running"].includes(job.quality_state)) {
    container.append(
      element(
        "p",
        job.quality_state === "pending"
          ? "Assessment queued. Your generated photograph is already saved."
          : "Checking image properties and product preservation…",
        "quality-status",
      ),
    );
    return;
  }
  const result = job.quality_report;
  const heading = element(
    "p",
    job.quality_state === "unavailable"
      ? "Assessment unavailable — review needed"
      : (statuses[result?.status] ?? "Needs Review"),
    "quality-status",
  );
  heading.dataset.state = result?.status ?? "needs_review";
  container.append(heading);
  const list = element("ul", null, "quality-checks");
  for (const check of result?.checks ?? []) {
    const item = element("li");
    item.dataset.state = check.status;
    item.append(
      element(
        "h3",
        `${check.label} · ${statuses[check.status] ?? "Needs Review"}`,
      ),
    );
    const method =
      check.method === "objective"
        ? "Measured file property"
        : check.method === "heuristic"
          ? "Computer-vision review signal"
          : check.method === "vision"
            ? "Probabilistic AI assessment"
            : check.method === "customer"
              ? "Customer review required"
              : "Assessment availability";
    item.append(
      element(
        "p",
        `${method}${check.confidence ? ` · AI-reported confidence: ${check.confidence} (not calibrated)` : ""}`,
        "help",
      ),
      element("p", check.explanation),
    );
    list.append(item);
  }
  container.append(list);
  const feedback = element("p", null, "notice");
  feedback.setAttribute("role", "status");
  container.append(feedback);
  const fail = (e) => {
    feedback.textContent = e.message;
    feedback.className = "notice error";
    feedback.setAttribute("role", "alert");
  };
  const decision = element(
    "p",
    `Your decision: ${job.user_decision === "approved" ? "Approved" : job.user_decision === "rejected" ? "Rejected" : "Awaiting your review"}.`,
    "customer-decision",
  );
  container.append(decision);
  if (job.output_image_id) {
    const ack = element("label", null, "check-row"),
      checkbox = element("input");
    checkbox.type = "checkbox";
    ack.append(
      checkbox,
      element(
        "span",
        "I compared the original and result, including labels and fine product details.",
      ),
    );
    container.append(ack);
    const actions = element("div", null, "quality-decisions");
    container.append(actions);
    for (const [value, label] of [
      ["approved", "Approve result"],
      ["rejected", "Reject result"],
    ]) {
      const button = element("button", label);
      button.type = "button";
      button.disabled = true;
      checkbox.addEventListener("change", () => {
        button.disabled = !checkbox.checked;
      });
      button.onclick = async () => {
        actions.querySelectorAll("button").forEach((b) => (b.disabled = true));
        try {
          const expected_revision = job.decision_revision ?? 0;
          const request_key = await intentKey(`sonkoflow-decision:${job.id}`, {
            decision: value,
            expected_revision,
          });
          await api(`/jobs/${job.id}/decision`, {
            method: "POST",
            body: JSON.stringify({
              decision: value,
              request_key,
              expected_revision,
              reviewed: true,
            }),
          });
          await refresh();
        } catch (e) {
          fail(e);
          actions
            .querySelectorAll("button")
            .forEach((b) => (b.disabled = !checkbox.checked));
        }
      };
      actions.append(button);
    }
  }
  if (job.quality_decisions?.length) {
    const details = element("details"),
      summary = element("summary", "Saved decision history");
    details.append(summary);
    for (const event of job.quality_decisions)
      details.append(
        element(
          "p",
          `${event.decision === "approved" ? "Approved" : "Rejected"} · ${new Date(event.at).toLocaleString()}`,
        ),
      );
    container.append(details);
  }
  const used = job.quality_retry_used ?? job.quality_retry_number ?? 0,
    limit = job.quality_retry_limit ?? 0;
  container.append(
    element("h3", "Request a controlled retry"),
    element(
      "p",
      `${used} of ${limit} retries used for this edit family. Each retry creates a separately metered image edit and, if enabled, a vision assessment. Existing results remain saved.`,
      "help",
    ),
  );
  if (
    used >= limit ||
    job.user_decision === "approved" ||
    !job.input_image_id
  ) {
    container.append(
      element(
        "p",
        used >= limit
          ? "The retry limit has been reached."
          : job.user_decision === "approved"
            ? "Reject this result first if you want a corrected version."
            : "The original photograph is unavailable.",
      ),
    );
    return;
  }
  const form = element("form", null, "quality-retry-form"),
    targets = element("fieldset");
  targets.append(element("legend", "Choose the concern to correct"));
  const seen = new Set();
  for (const check of result?.checks ?? []) {
    if (
      check.status === "passed" ||
      check.status === "unavailable" ||
      seen.has(check.id) ||
      check.id === "assessment_availability"
    )
      continue;
    seen.add(check.id);
    const label = element("label", null, "check-row"),
      input = element("input");
    input.type = "checkbox";
    input.name = "target";
    input.value = check.id;
    label.append(input, element("span", check.label));
    targets.append(label);
  }
  const manual = element("label", null, "check-row"),
    choice = element("input");
  choice.type = "checkbox";
  choice.name = "target";
  choice.value = "customer_detail";
  manual.append(choice, element("span", "A specific detail I noticed"));
  targets.append(manual);
  form.append(targets);
  const label = element("label", "Describe the correction"),
    text = element("textarea");
  text.name = "instructions";
  text.maxLength = 800;
  text.rows = 3;
  label.append(text);
  form.append(label);
  form.append(
    element(
      "p",
      "The original upload remains the reference. A retry addresses only your selected concerns and keeps the same preservation settings. An unavailable assessment alone does not establish a reason to regenerate.",
      "help",
    ),
  );
  const consentLabel = element("label", null, "check-row"),
    consent = element("input");
  consent.type = "checkbox";
  consent.required = true;
  consentLabel.append(
    consent,
    element(
      "span",
      "I authorize another OpenAI edit. It can incur additional usage, and any earlier interrupted request may already have incurred a charge.",
    ),
  );
  form.append(consentLabel);
  const submit = element("button", "Generate controlled retry");
  submit.type = "submit";
  form.append(submit);
  container.append(form);
  let retryCanGenerate = false;
  let retryQuote = null,
    retryRevision = 0;
  if (job.pack_id) {
    submit.disabled = true;
    const quoteButton = element("button", "Review retry allowance");
    quoteButton.type = "button";
    form.insertBefore(quoteButton, submit);
    const quoteNotice = element("p", null, "help");
    form.insertBefore(quoteNotice, submit);
    form.addEventListener("input", (event) => {
      if (event.target === consent) return;
      retryRevision++;
      retryQuote = null;
      retryCanGenerate = false;
      submit.disabled = true;
      quoteNotice.textContent =
        "Review the updated retry allowance before generating.";
    });
    quoteButton.onclick = async () => {
      const revision = retryRevision;
      quoteButton.disabled = true;
      try {
        const targets = Array.from(
          form.querySelectorAll("input[name=target]:checked"),
        ).map((e) => e.value);
        const quoted = await api(`/packs/outputs/${job.id}/retry-plan`, {
          method: "POST",
          body: JSON.stringify({ targets, instructions: text.value.trim() }),
        });
        if (revision !== retryRevision)
          throw new Error(
            "Retry requirements changed. Review the updated allowance.",
          );
        retryQuote = quoted.quote_fingerprint;
        retryCanGenerate = quoted.can_generate;
        quoteNotice.textContent = `Estimated use: ${quoted.estimated_credits} credits. Required hold: ${quoted.reserved_credits}. Available: ${quoted.allowance.available_credits}.`;
        submit.disabled = !quoted.can_generate;
      } catch (e) {
        fail(e);
      } finally {
        quoteButton.disabled = false;
      }
    };
  }
  form.onsubmit = async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const targets = Array.from(
        form.querySelectorAll("input[name=target]:checked"),
      ).map((e) => e.value);
      if (!targets.length)
        throw new Error(
          "Select a reported concern or a specific detail you noticed.",
        );
      if (targets.includes("customer_detail") && !text.value.trim())
        throw new Error("Describe the specific product detail to correct.");
      const body = {
        ...(job.pack_id ? { quote_fingerprint: retryQuote } : {}),
        targets,
        instructions: text.value.trim(),
        provider_consent: true,
        acknowledge_uncertain: true,
      };
      const submission_key = await intentKey(
        `sonkoflow-quality-retry:${job.id}`,
        body,
      );
      const result = await api(`/jobs/${job.id}/quality-retry`, {
        method: "POST",
        body: JSON.stringify({ ...body, submission_key }),
      });
      location.assign(`/app/edits/${result.job.id}`);
    } catch (e) {
      fail(e);
      if (
        job.pack_id &&
        ["pack_quote_stale", "insufficient_credits"].includes(e.code)
      ) {
        retryQuote = null;
        retryCanGenerate = false;
      }
      submit.disabled = !!job.pack_id && (!retryQuote || !retryCanGenerate);
    }
  };
}
