import "./design-system.css";
import "./pricing.css";
const money = (c) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
const features = {
  free: [
    "Personal, portrait & product editing",
    "One Low-quality square sample",
    "Original/result comparison & downloads",
    "3 projects · 10 images · 25 MB",
    "No product packs or bulk generation",
  ],
  starter: [
    "All three enhancement modes",
    "Low & Medium quality",
    "Multi-view product packs",
    "Brand Studio & saved presets",
    "Bulk requests up to 3 sources",
    "100 images · 250 MB shared storage",
  ],
  pro: [
    "Everything in Starter",
    "High-quality output option",
    "Larger processing allowance",
    "Bulk requests up to 5 sources",
    "Independent review & controlled retries",
    "100 images · 250 MB shared storage",
  ],
  payg: [
    "All three core enhancement modes",
    "Low & Medium quality",
    "Product packs use the same units",
    "No recurring payment",
    "No bulk or Brand Studio generation",
  ],
};
let data,
  period = "month",
  selected = "free";
const dialog = document.querySelector("#plan-dialog");
async function api(path, body) {
  const r = await fetch(`/api${path}`, {
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    credentials: "same-origin",
  });
  const value = await r.json();
  if (!r.ok)
    throw new Error(
      value.error?.message ?? "This service is unavailable. Please try again.",
    );
  return value;
}
function offerId(plan) {
  return plan === "free"
    ? "free"
    : `${plan}_${period === "year" ? "annual" : "monthly"}`;
}
function select(id) {
  selected = id;
  drawOrder();
  if (!dialog.open) dialog.showModal();
}
function list(items) {
  const ul = el("ul");
  for (const text of items) ul.append(el("li", text));
  return ul;
}
function renderCards() {
  for (const button of document.querySelectorAll("[data-period]"))
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.period === period),
    );
  const cards = document.querySelector("#plan-cards");
  cards.replaceChildren();
  for (const key of ["free", "starter", "pro"]) {
    const p = data.plans[key],
      o = data.offers[offerId(key)],
      card = el(
        "article",
        null,
        `plan-card ${key === "starter" ? "recommended" : ""}`,
      );
    if (key === "starter")
      card.append(el("span", "A considered starting point", "recommend-tag"));
    card.append(el("h3", p.name), el("p", p.description, "plan-description"));
    const price = el("p", null, "plan-price");
    price.append(
      el(
        "strong",
        o.kind === "free"
          ? "$0"
          : money(period === "year" ? o.cents / 12 : o.cents),
      ),
      el("span", o.kind === "free" ? " / to start" : " / month"),
    );
    card.append(
      price,
      el(
        "p",
        o.kind === "free"
          ? "No card. One lifetime sample."
          : period === "year"
            ? `${money(o.cents)} billed yearly · ${o.units.toLocaleString()} units up front`
            : `${money(o.cents)} billed monthly`,
        "billing-caption",
      ),
      el(
        "p",
        `${o.units.toLocaleString()} processing units${o.kind === "free" ? " once" : period === "year" ? " per paid year" : " per paid month"}`,
        "allowance",
      ),
    );
    const b = el(
      "button",
      key === "free" ? "Start free" : `Choose ${p.name}`,
      "price-button",
    );
    b.onclick = () => select(offerId(key));
    card.append(
      b,
      list(features[key]),
      el(
        "p",
        "Usage estimates and available units determine how many outputs you can request.",
        "card-note",
      ),
    );
    cards.append(card);
  }
}
function render() {
  renderCards();
  const once = document.querySelector("#once-cards");
  for (const key of ["small_pack", "studio_pack"]) {
    const o = data.offers[key],
      card = el("article", null, "once-card");
    card.append(
      el(
        "p",
        key === "small_pack" ? "A small project" : "A little more room",
        "price-eyebrow",
      ),
      el("h3", `${o.units} processing units`),
      el("p", `${money(o.cents)} · pay once`, "once-price"),
      el("p", "No renewal. No expiry while your account exists."),
    );
    const b = el("button", "Choose one-time pack", "price-button secondary");
    b.onclick = () => select(key);
    card.append(b);
    once.append(card);
  }
  const rows = [
    [
      "Processing allowance",
      "20 units once",
      "100 units / monthly payment",
      "250 units / monthly payment",
    ],
    ["AI quality", "Low · square canvas", "Low & Medium", "Low, Medium & High"],
    ["Personal / portrait / product", "Included", "Included", "Included"],
    [
      "Multi-view product packs",
      "Not included",
      "Metered per output",
      "Metered per output",
    ],
    ["Bulk source limit", "Not included", "Up to 3", "Up to 5"],
    ["Brand Studio generation", "Not included", "Included", "Included"],
    ["Local product quality checks", "Included", "Included", "Included"],
    [
      "Optional AI quality assessment",
      "Not included",
      "Uses additional units",
      "Uses additional units",
    ],
    ["Projects", "3", "100", "100"],
    ["Saved images / storage", "10 / 25 MB", "100 / 250 MB", "100 / 250 MB"],
    ["Comparison, history & downloads", "Included", "Included", "Included"],
    ["Unlimited AI processing", "Not offered", "Not offered", "Not offered"],
  ];
  const tbody = document.querySelector("#comparison tbody");
  for (const row of rows) {
    const tr = el("tr");
    row.forEach((text, index) => {
      const c = el(index ? "td" : "th", text);
      if (!index) c.scope = "row";
      tr.append(c);
    });
    tbody.append(tr);
  }
  document.querySelector("#billing-toggle").hidden = !data.annual_supported;
  document.querySelector("#pricing-status").textContent =
    data.reason ??
    "Choose a plan, review its terms, then approve securely at PayPal. Your allowance activates only after payment verification.";
}
function drawOrder() {
  const o = data.offers[selected],
    p = data.plans[o.plan];
  document.querySelector("#order-plan-name").textContent =
    o.kind === "one_time" ? `${o.units} units. Your own pace.` : p.name;
  document.querySelector("#order-plan-copy").textContent = p.description;
  const target = document.querySelector("#order-features");
  target.replaceChildren(...features[o.plan].map((text) => el("li", text)));
  document.querySelector("#order-title").textContent =
    o.kind === "free"
      ? "A good place to begin."
      : o.kind === "one_time"
        ? "Your one-time pack."
        : `Your ${p.name} plan.`;
  const tabs = document.querySelector("#order-plan-tabs");
  tabs.replaceChildren();
  if (o.kind !== "one_time")
    for (const plan of ["free", "starter", "pro"]) {
      const b = el("button", data.plans[plan].name);
      b.type = "button";
      b.setAttribute("aria-pressed", String(o.plan === plan));
      b.onclick = () => select(offerId(plan));
      tabs.append(b);
    }
  const periods = document.querySelector("#order-periods");
  periods.replaceChildren();
  if (o.kind === "subscription") {
    for (const choice of data.annual_supported
      ? ["month", "year"]
      : ["month"]) {
      const offer =
          data.offers[`${o.plan}_${choice === "year" ? "annual" : "monthly"}`],
        label = el("label", null, "period-option"),
        radio = el("input");
      radio.type = "radio";
      radio.name = "billing-period";
      radio.value = choice;
      radio.checked = o.interval === choice;
      radio.onchange = () => {
        period = choice;
        selected = offerId(o.plan);
        renderCards();
        drawOrder();
      };
      label.append(
        radio,
        el(
          "span",
          choice === "year"
            ? `Yearly · ${money(offer.cents)} today · ${money(offer.cents / 12)}/month equivalent`
            : `Monthly · ${money(offer.cents)} today`,
        ),
      );
      periods.append(label);
    }
  }
  const summary = document.querySelector("#order-summary");
  summary.replaceChildren(
    el("span", o.kind === "free" ? "Today" : "Order total"),
    el("strong", money(o.cents)),
    el(
      "p",
      `${o.units.toLocaleString()} units ${o.kind === "subscription" ? (o.interval === "year" ? "granted up front per paid year" : "per paid month") : "once"}`,
    ),
  );
  document.querySelector("#order-policy").textContent =
    o.kind === "subscription"
      ? `Renews ${o.interval === "year" ? "yearly" : "monthly"} until cancelled. Unused units remain in your prepaid balance. No automatic usage top-ups.`
      : o.kind === "one_time"
        ? "One payment. No automatic renewal. Units remain available while your account exists."
        : "Verified email required. One Low-quality square edit within the sample budget, once activated. No payment card.";
  document.querySelector("#order-status").textContent =
    data.reason ??
    "You will review the final order while signed in before leaving for PayPal.";
}
for (const b of document.querySelectorAll("[data-period]"))
  b.onclick = () => {
    period = b.dataset.period;
    for (const button of document.querySelectorAll("[data-period]"))
      button.setAttribute("aria-pressed", String(button === b));
    renderCards();
  };
document.querySelector("#close-order").onclick = () => dialog.close();
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      dialog.close();
  }
});
async function continueSelection(e, signingIn = false) {
  e.preventDefault();
  const b = e.currentTarget;
  b.disabled = true;
  try {
    await api("/public/billing/intents", { offer_id: selected });
    let authenticated = false;
    try {
      await api("/session");
      authenticated = true;
    } catch {}
    location.assign(
      authenticated
        ? "/app/checkout"
        : signingIn
          ? "/account/signin?next=checkout"
          : "/account/signup?next=checkout",
    );
  } catch (err) {
    document.querySelector("#order-status").textContent = err.message;
  } finally {
    b.disabled = false;
  }
}
document.querySelector("#continue-order").onclick = continueSelection;
document.querySelector(".existing-account").onclick = (e) =>
  continueSelection(e, true);
try {
  data = await api("/public/pricing");
  render();
} catch (e) {
  document.querySelector("#pricing-status").textContent =
    "Plan information could not load. Please refresh, or use the account links to access your workspace.";
}
