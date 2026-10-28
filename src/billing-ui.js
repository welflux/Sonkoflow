import "./commerce-app.css";
function el(t, text, cls) {
  const n = document.createElement(t);
  if (text) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
function button(text, fn) {
  const b = el("button", text);
  b.type = "button";
  b.onclick = fn;
  return b;
}
const money = (c) => `$${(c / 100).toFixed(2)}`;
export async function checkoutPage(api, shell) {
  const page = shell("billing");
  page.innerHTML =
    '<div class="page-heading"><div><p class="eyebrow">YOUR NEXT CHAPTER</p><h1>A clear next step.</h1><p>Review your selection. Your account changes only after server verification.</p></div></div><div id="checkout-notice" class="notice" role="status"></div><div class="commerce-layout"><aside class="commerce-visual"><p>YOUR ORIGINAL. A CONSIDERED FINISH.</p><h2 id="checkout-plan"></h2><p id="checkout-description"></p><img src="/images/footwear.webp" alt="Illustrative product photography" width="1536" height="1024"><small>Illustrative artwork. Results require review.</small></aside><section class="panel commerce-order"><h2>Order summary</h2><div id="checkout-summary"></div><div id="checkout-actions" class="result-actions"></div><a href="/pricing">Compare plans or choose another allowance</a><p class="help">USD total shown before PayPal approval. No automatic usage top-ups. Provider conversion terms may apply. Tax and merchant disclosures must be reviewed before checkout activation.</p></section></div>';
  const notice = page.querySelector("#checkout-notice"),
    catalog = await api("/public/pricing"),
    current = await api("/billing/current"),
    c = current.checkout,
    actions = page.querySelector("#checkout-actions");
  if (!c) {
    notice.textContent = "Choose a plan or one-time pack to continue.";
    const a = el("a", "View plans", "button");
    a.href = "/pricing";
    actions.append(a);
    return;
  }
  const o = catalog.offers[c.offer_id],
    plan = catalog.plans[o.plan];
  page.querySelector("#checkout-plan").textContent =
    o.kind === "one_time" ? `${o.units} units. Your own pace.` : plan.name;
  page.querySelector("#checkout-description").textContent = plan.description;
  const summary = page.querySelector("#checkout-summary");
  summary.append(
    el(
      "p",
      o.kind === "subscription"
        ? `Subscription · billed ${o.interval === "year" ? "yearly" : "monthly"}`
        : o.kind === "one_time"
          ? "One-time purchase · no renewal"
          : "Free account · no card",
    ),
    el("strong", money(c.amount_cents), "commerce-total"),
    el(
      "p",
      `${c.units.toLocaleString()} processing units${o.interval === "year" ? " granted up front per paid year" : o.interval === "month" ? " per paid month" : " once"}`,
    ),
    el(
      "p",
      o.kind === "subscription"
        ? "Renews until cancelled. Granted units stay in your balance after cancellation."
        : o.kind === "free"
          ? "One lifetime sample within the processing budget. No card or renewal."
          : "Purchased units do not expire while your account exists.",
      "help",
    ),
  );
  const workspace = el("a", "Open your workspace", "button secondary");
  workspace.href = "/app/welcome";
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
  async function renderState() {
    if (stopped) return;
    const state = await api(`/billing/checkouts/${c.id}`);
    if (stopped) return;
    const paid = ["paid", "active"].includes(state.checkout.status);
    if (paid) {
      actions.replaceChildren(workspace);
      notice.textContent =
        "Payment verified. Your processing allowance is ready in your account.";
      return true;
    }
    if (state.checkout.status === "refunded") {
      notice.textContent =
        "This payment was refunded. Your balance reflects the verified adjustment.";
      actions.replaceChildren(workspace);
      return true;
    }
    return false;
  }
  if (["paid", "active", "refunded"].includes(c.status)) {
    await renderState();
    return;
  }
  if (!current.enabled || (o.kind !== "free" && !current.paypal_ready)) {
    notice.textContent =
      "Your selection is saved. Sample processing and secure checkout are awaiting service activation; no payment was taken. You can organize your workspace now.";
    actions.append(
      workspace,
      button("Refresh availability", () => location.reload()),
    );
    return;
  }
  if (o.kind === "free") {
    actions.append(
      button("Open my free workspace", async (e) => {
        e.currentTarget.disabled = true;
        try {
          await api("/billing/free", { method: "POST", body: "{}" });
          location.assign("/app/welcome");
        } catch (err) {
          notice.textContent = err.message;
          e.currentTarget.disabled = false;
        }
      }),
    );
    return;
  }
  const pay = button("Continue securely with PayPal", async (e) => {
    e.currentTarget.disabled = true;
    try {
      const r = await api(`/billing/checkouts/${c.id}/start`, {
        method: "POST",
        body: "{}",
      });
      location.assign(r.approval_url);
    } catch (err) {
      notice.textContent = err.message;
      e.currentTarget.disabled = false;
    }
  });
  actions.append(pay);
  const params = new URLSearchParams(location.search);
  if (params.has("cancelled"))
    notice.textContent =
      "You returned from PayPal. Approval alone does not activate an allowance; check the verified order status below.";
  const check = button("Check payment status", async () => {
    try {
      if (!(await renderState()))
        notice.textContent =
          "Payment is awaiting a verified provider notification. Your allowance has not been activated yet.";
    } catch (err) {
      notice.textContent = err.message;
    }
  });
  actions.append(check);
  if (params.has("returned")) {
    pay.disabled = true;
    notice.textContent =
      "Checking PayPal and waiting for verified payment confirmation…";
    try {
      if (o.kind === "one_time")
        await api(`/billing/checkouts/${c.id}/capture`, {
          method: "POST",
          body: "{}",
        });
      let checks = 0;
      const poll = async () => {
        try {
          if (await renderState()) return;
          if (!stopped && ++checks < 20) timer = setTimeout(poll, 3000);
          else {
            notice.textContent =
              "Verification is still pending. You can return to this saved order or check its status again; no duplicate allowance is granted.";
            pay.disabled = false;
          }
        } catch (err) {
          notice.textContent = err.message;
          pay.disabled = false;
        }
      };
      await poll();
    } catch (err) {
      notice.textContent = err.message;
      pay.disabled = false;
    }
  }
}
export async function billingPage(api, shell) {
  const page = shell("billing");
  page.innerHTML =
    '<div class="page-heading"><div><p class="eyebrow">YOUR ROOM TO CREATE</p><h1>Plan & usage.</h1><p>A single balance for edits, packs and bulk outputs.</p></div><a class="button" href="/pricing">Explore allowances</a></div><div id="billing-notice" class="notice" role="status"></div><section class="panel" id="billing-balance"></section><section class="panel"><h2>Subscription</h2><div id="billing-subscriptions"></div></section><section class="panel"><h2>Verified payments</h2><div id="billing-receipts"></div></section><p class="help">Units are prepaid processing allowance, not a fixed image count or cash balance. Reservations reduce available units while work runs. Paid features last through the verified billing period; your stored projects and granted units remain after cancellation, within account limits. No automatic usage top-ups.</p>';
  try {
    const data = await api("/billing/account"),
      a = data.account,
      available = a.balance_credits - a.reserved_credits;
    page
      .querySelector("#billing-balance")
      .append(
        el(
          "h2",
          data.plan === "payg"
            ? "Pay as you go"
            : data.plan[0].toUpperCase() + data.plan.slice(1),
        ),
        el(
          "p",
          `${available.toLocaleString()} available units`,
          "commerce-balance",
        ),
        el(
          "p",
          `${a.reserved_credits} reserved · ${a.balance_credits} remaining before reservations`,
        ),
      );
    if (available < 0)
      page.querySelector("#billing-notice").textContent =
        "Your balance has a deficit after metered usage or a payment adjustment. New processing is paused until it is resolved.";
    else if (available < 20)
      page.querySelector("#billing-notice").textContent =
        "Your available allowance is running low. Review each operation estimate or choose a one-time pack.";
    const receiptList = page.querySelector("#billing-receipts");
    for (const receipt of data.receipts ?? []) {
      const item = el("article");
      item.append(
        el(
          "h3",
          `${receipt.units} processing units · ${money(receipt.amount_cents)}`,
        ),
        el(
          "p",
          `${new Date(receipt.created_at).toLocaleString()} · ${receipt.payment_id}`,
        ),
      );
      if (receipt.refunded_cents)
        item.append(
          el(
            "p",
            `${money(receipt.refunded_cents)} refunded; corresponding units removed.`,
          ),
        );
      receiptList.append(item);
    }
    if (!data.receipts?.length)
      receiptList.append(el("p", "No verified payments yet."));
    const container = page.querySelector("#billing-subscriptions");
    if (!data.subscriptions.length)
      container.append(el("p", "No verified subscription."));
    for (const sub of data.subscriptions) {
      const card = el("article");
      card.append(
        el("h3", sub.plan === "pro" ? "Pro" : "Starter"),
        el(
          "p",
          `${sub.state} · paid-through ${new Date(sub.paid_until).toLocaleString()}`,
        ),
      );
      if (["active", "suspended", "failed"].includes(sub.state))
        card.append(
          button("Cancel future renewal", async (e) => {
            if (
              !confirm(
                "Stop future subscription renewals? Your verified paid period and previously granted units are retained.",
              )
            )
              return;
            e.currentTarget.disabled = true;
            try {
              await api(`/billing/subscriptions/${sub.provider_id}/cancel`, {
                method: "POST",
                body: "{}",
              });
              await billingPage(api, shell);
            } catch (err) {
              page.querySelector("#billing-notice").textContent = err.message;
              e.currentTarget.disabled = false;
            }
          }),
        );
      container.append(card);
    }
  } catch (e) {
    page.querySelector("#billing-notice").textContent = e.message;
    page
      .querySelector("#billing-balance")
      .append(
        el(
          "p",
          "Your existing projects remain available. No payment or allowance activation is claimed until billing can be verified.",
        ),
      );
  }
}
export async function welcomePage(api, shell) {
  const page = shell("projects");
  page.innerHTML =
    '<div class="page-heading"><div><p class="eyebrow">A SPACE FOR YOUR PERSPECTIVE</p><h1>Make yourself at home.</h1><p>Start with a real photograph. Keep your original close.</p></div></div><div id="welcome-notice" class="notice" role="status"></div><div class="commerce-welcome"><section class="panel"><span class="eyebrow">01 · YOUR COLLECTION</span><h2>Give your project a name.</h2><form id="welcome-project"><label>Project name<input name="name" maxlength="100" required placeholder="e.g. The autumn collection"></label><label>What are you working on?<select name="audience"><option value="ecommerce">Product photography</option><option value="professional">Professional portraits</option><option value="individual">Personal photographs</option></select></label><button>Create my first project</button></form></section><aside class="panel"><p class="eyebrow">02 · YOUR REFERENCE</p><h2>Bring your own original.</h2><p>Upload JPEG, PNG or WebP in your project. We validate the photograph and keep it private.</p><p class="eyebrow">03 · A CONSIDERED FINISH</p><h2>Choose. Review. Download.</h2><p>Choose an available mode and quality, review the usage reservation, then compare the actual saved result with your original. Generative details need your review.</p><a href="/app/library">Open your existing library</a><a href="/app/billing">See your plan & remaining units</a></aside></div>';
  try {
    const a = await api("/billing/account");
    page.querySelector("#welcome-notice").textContent =
      `${a.account.balance_credits - a.account.reserved_credits} processing units available. Your plan and reservation limits apply.`;
  } catch {
    page.querySelector("#welcome-notice").textContent =
      "Your account is ready for organization. Processing availability depends on billing and provider activation.";
  }
  const form = page.querySelector("form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const b = form.querySelector("button");
    b.disabled = true;
    try {
      const r = await api("/projects", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      location.assign(`/app/projects/${r.project.id}`);
    } catch (err) {
      page.querySelector("#welcome-notice").textContent = err.message;
      b.disabled = false;
    }
  };
}
