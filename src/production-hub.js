import "./production-hub.css";
const modes = {
  product: "Product photo enhancement",
  portrait: "Professional portraits",
  personal: "Personal photo enhancement",
  pack: "Product image packs",
};
const features = [
  {
    id: "product",
    category: "editing",
    title: "Product photography",
    description:
      "Shape the light, refine the background and prioritize the product you actually photographed.",
    image: "footwear",
    alt: "Ivory sneaker on a sunlit studio plinth",
    eyebrow: "PRODUCT PHOTO ENHANCEMENT",
    action: "Open product editor",
    mode: "product",
    kind: "product",
    tags: "lighting shadows color cleanup ecommerce",
  },
  {
    id: "portraits",
    category: "editing",
    title: "Professional portraits",
    description:
      "A considered headshot with realistic light, natural texture and recognizable identity.",
    image: "portrait",
    alt: "Professional portrait of a woman against a blue background",
    eyebrow: "PROFESSIONAL IMAGERY",
    action: "Create a portrait",
    mode: "portrait",
    kind: "portrait",
    tags: "headshot people face professional",
  },
  {
    id: "personal",
    category: "editing",
    title: "Personal photographs",
    description:
      "Balance light, color and clarity while keeping the people and moments recognizable.",
    image: "lifestyle",
    alt: "Two craftspeople sharing a moment in a pottery studio",
    eyebrow: "PERSONAL PHOTO ENHANCEMENT",
    action: "Enhance a photograph",
    mode: "personal",
    kind: "personal",
    tags: "people family natural color memories",
  },
  {
    id: "lighting",
    category: "editing",
    title: "Lighting & backgrounds",
    description:
      "Keep the original setting or choose a clean neutral or professional studio direction.",
    image: "interior",
    alt: "Sunlight falling across a cream sofa and a quiet interior",
    eyebrow: "CHOOSE YOUR DIRECTION",
    action: "Explore editing options",
    mode: "product",
    kind: "lighting",
    tags: "studio neutral background cleanup light shadow",
  },
  {
    id: "packs",
    category: "production",
    title: "One product, a considered collection",
    description:
      "Choose clean listing, lifestyle, visible detail, square social and wide promotional outputs from one original.",
    image: "footwear",
    alt: "Illustrated canvas studies of the same ivory sneaker",
    eyebrow: "PRODUCT IMAGE PACKS",
    action: "Build an image pack",
    mode: "pack",
    kind: "packs",
    wide: true,
    tags: "five output listing lifestyle detail square social wide promotional canvas",
  },
  {
    id: "bulk",
    category: "production",
    title: "Bulk processing",
    description:
      "Stage product photographs, select shared outputs and review the allowance before you run.",
    image: "apparel",
    alt: "Product photographs staged in an illustrated batch queue",
    eyebrow: "A CONNECTED PRODUCTION RUN",
    action: "Prepare a batch",
    href: "/app/batches",
    kind: "bulk",
    tags: "batch queue multiple upload folder reservation",
  },
  {
    id: "brand",
    category: "production",
    title: "Brand Studio",
    description:
      "Save palettes, product styling and reusable presets. Add an optional logo treatment to product outputs.",
    image: "serum",
    alt: "Amber serum bottle and packaging with an illustrated brand palette",
    eyebrow: "YOUR VISUAL LANGUAGE",
    action: "Open Brand Studio",
    href: "/app/brands",
    kind: "brand",
    tags: "logo palette identity presets colors reusable settings",
  },
  {
    id: "review",
    category: "workflow",
    title: "Review & compare",
    description:
      "Inspect saved results against their originals and make a deliberate approval or rejection decision.",
    image: "objects",
    alt: "Detailed photographic still life with an illustrated inspection region",
    eyebrow: "LOOK CLOSER BEFORE YOU KEEP",
    action: "Review saved results",
    href: "/app/library?role=generated&review=pending",
    kind: "review",
    tags: "quality comparison original approval reject audit assessment",
  },
  {
    id: "library",
    category: "workflow",
    title: "Image library",
    description:
      "Search originals and saved edits, follow their history and organize your private assets.",
    image: "objects",
    alt: "Illustrated image-library mosaic of products and portraits",
    eyebrow: "EVERY ASSET, CONNECTED",
    action: "Browse image library",
    href: "/app/library",
    kind: "library",
    tags: "search filters recovery restore trash storage versions history",
  },
  {
    id: "projects",
    category: "workflow",
    title: "Projects",
    description:
      "Keep each collection together with asset counts, recent production activity and project controls.",
    image: "apparel",
    alt: "Photographic collections arranged in illustrated project folders",
    eyebrow: "A HOME FOR EACH COLLECTION",
    action: "Open project directory",
    href: "/app",
    kind: "projects",
    tags: "folders campaign organize archive rename directory",
  },
  {
    id: "exports",
    category: "workflow",
    title: "Downloads & exports",
    description:
      "Download private WebP files, or collect approved outputs through existing pack and batch ZIP downloads.",
    image: "apparel",
    alt: "Leather tote product photograph with an illustrated WebP download label",
    eyebrow: "FROM REVIEW TO DELIVERY",
    action: "Find saved downloads",
    href: "/app/library?role=generated",
    kind: "exports",
    tags: "download webp zip archive approved batch pack export",
  },
];
function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
function arrow() {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = '<path d="M6 18 18 6M6 6h12v12"/>';
  return s;
}
function photo(name, alt, cls = "", eager = false) {
  const img = el("img", undefined, cls);
  img.src = `/images/${name}${name === "serum" ? "" : "-small"}.webp`;
  if (name !== "serum") {
    img.srcset = `/images/${name}-small.webp 640w, /images/${name}.webp 1280w`;
    img.sizes = "(max-width: 600px) 92vw, (max-width: 1100px) 45vw, 420px";
  }
  img.alt = alt;
  img.loading = eager ? "eager" : "lazy";
  img.decoding = "async";
  img.width = 640;
  img.height = 480;
  return img;
}
function button(text, fn, cls = "secondary") {
  const b = el("button", text, cls);
  b.type = "button";
  b.onclick = fn;
  return b;
}
function link(text, href, cls) {
  const a = el("a", text, cls);
  a.href = href;
  return a;
}
function illustration(f) {
  const art = el("div", undefined, `hub-art hub-art-${f.kind}`);
  art.setAttribute("aria-label", f.alt);
  art.setAttribute("role", f.kind === "lighting" ? "group" : "img");
  if (f.kind === "packs") {
    ["Clean listing", "Visible detail", "Wide promotion"].forEach(
      (label, i) => {
        const frame = el(
          "div",
          undefined,
          `hub-pack-frame hub-pack-frame-${i}`,
        );
        frame.append(photo("footwear", ""), el("span", label));
        art.append(frame);
      },
    );
    art.append(el("span", "5 output types", "hub-art-tag"));
  } else if (f.kind === "bulk") {
    ["footwear", "apparel", "serum"].forEach((name, i) => {
      const frame = el("div", undefined, "hub-queue-frame");
      frame.style.setProperty("--hub-stack", i);
      frame.append(photo(name, ""), el("span", `0${i + 1}`));
      art.append(frame);
    });
    art.append(el("span", "Stage → Review → Run", "hub-art-tag"));
  } else if (f.kind === "library") {
    const grid = el("div", undefined, "hub-library-mosaic");
    ["footwear", "portrait", "objects", "apparel"].forEach((name) =>
      grid.append(photo(name, "")),
    );
    art.append(grid, el("span", "Originals + saved edits", "hub-art-tag"));
  } else if (f.kind === "projects") {
    ["apparel", "footwear", "objects"].forEach((name, i) => {
      const folder = el("div", undefined, "hub-visual-folder");
      folder.style.setProperty("--hub-stack", i);
      folder.append(photo(name, ""));
      art.append(folder);
    });
    art.append(el("span", "Your private collections", "hub-art-tag"));
  } else {
    art.append(photo(f.image, ""));
    if (f.kind === "brand") {
      const palette = el("div", undefined, "hub-palette");
      ["ink", "sky", "sun", "paper"].forEach((color) =>
        palette.append(el("span", undefined, `hub-color-${color}`)),
      );
      art.append(
        palette,
        el("span", "Palette · styling · presets", "hub-art-tag"),
      );
    } else if (f.kind === "lighting") {
      art.append(
        el("div", undefined, "hub-light-sweep"),
        el("span", "A lighting direction study", "hub-art-tag"),
      );
    } else if (f.kind === "review") {
      art.append(
        el("span", undefined, "hub-inspection-frame"),
        el("span", "Compare the details", "hub-art-tag"),
      );
    } else if (f.kind === "exports") {
      const file = el("div", undefined, "hub-file-label");
      file.append(
        el("strong", "WEBP"),
        el("span", "Private download"),
        arrow(),
      );
      art.append(file);
    } else
      art.append(
        el(
          "span",
          f.kind === "product"
            ? "Light · background · shadows"
            : f.kind === "portrait"
              ? "Realistic light. Recognizable you."
              : "A natural photographic finish.",
          "hub-art-tag",
        ),
      );
  }
  if (f.kind === "lighting") {
    const control = el("input", undefined, "hub-light-control");
    control.type = "range";
    control.min = "0";
    control.max = "100";
    control.value = "50";
    control.setAttribute("aria-label", "Illustrative warm-light balance");
    control.oninput = () =>
      art.style.setProperty("--hub-light-balance", `${control.value}%`);
    art.append(control);
  }
  return art;
}
export async function productionHub(api, shell) {
  const page = shell("hub");
  page.classList.add("production-hub");
  page.closest(".workspace-layout")?.classList.add("hub-screen");
  document.title = "Production Hub — SonkoFlow";
  page.innerHTML = `<header class="page-heading hub-heading"><div><p class="eyebrow">YOUR PRODUCTION TOOLKIT</p><h1>Production Hub</h1><p>Find your next direction. Start with what’s already yours.</p></div><a href="/app/library" class="hub-header-link">Your image library ↗</a></header><div id="page-notice" class="notice" role="status"></div>
 <section class="hub-hero" aria-labelledby="hub-hero-title"><div class="hub-hero-copy"><span class="hub-micro">AN ORIGINAL IS JUST THE BEGINNING</span><h2 id="hub-hero-title">Good photographs.<br><em>More possibilities.</em></h2><p>Product stories. Professional portraits. The moments you keep. Bring your own photograph and give it a considered new direction.</p><button type="button" id="hub-start">Start with a photograph <span aria-hidden="true">↗</span></button><a href="#hub-toolkit" class="hub-hero-secondary">Discover your toolkit ↓</a><div class="hub-hero-index"><span>01 / YOUR ORIGINAL</span><span>02 / YOUR DIRECTION</span><span>03 / YOUR REVIEW</span></div></div><div class="hub-hero-visual"><div class="hub-orbit" aria-hidden="true"></div><figure class="hub-hero-main"><img id="hub-hero-photo" src="/images/footwear.webp" alt="Concept studio photograph of an ivory sneaker on a stone plinth" width="1280" height="960"><figcaption id="hub-hero-caption">PRODUCT PHOTOGRAPHY</figcaption></figure><figure class="hub-hero-portrait"><img src="/images/portrait-small.webp" alt="Concept professional portrait" width="640" height="640" loading="lazy"><figcaption>Another side of you</figcaption></figure><div class="hub-hero-note"><span>YOUR ORIGINAL.</span><strong>New direction.</strong><span class="hub-note-line" aria-hidden="true"></span></div><div class="hub-hero-choices" role="group" aria-label="Showcase subject"><button type="button" data-subject="product" aria-pressed="true">Products</button><button type="button" data-subject="portrait" aria-pressed="false">Portraits</button><button type="button" data-subject="personal" aria-pressed="false">Personal</button></div></div></section>
 <div class="hub-artwork-note">Showcase images are concept illustrations, not customer photographs or results generated by SonkoFlow.</div>
 <aside id="hub-availability" class="hub-availability" aria-live="polite" hidden></aside>
 <section id="hub-toolkit" class="hub-toolkit" aria-labelledby="hub-toolkit-title"><header class="hub-toolkit-heading"><div><span class="hub-micro">FROM FIRST EDIT TO FINAL COLLECTION</span><h2 id="hub-toolkit-title">Choose what comes next</h2></div><label class="hub-search"><span class="hub-sr">Find a tool</span><input type="search" id="hub-search" placeholder="Find a tool…" maxlength="100"></label></header><div class="hub-filter-ribbon"><div class="hub-categories" role="group" aria-label="Tool categories"><button type="button" data-category="all" aria-pressed="true">All tools</button><button type="button" data-category="editing" aria-pressed="false">Photo editing</button><button type="button" data-category="production" aria-pressed="false">Product production</button><button type="button" data-category="workflow" aria-pressed="false">Your workflow</button></div><span id="hub-tool-count" role="status"></span></div><div id="hub-feature-grid" class="hub-feature-grid"></div><div id="hub-no-tools" class="hub-empty" hidden><h3>No tools match this search</h3><p>Try another term or browse the complete toolkit.</p><button type="button" class="secondary" id="hub-reset">Show all tools</button></div></section>
 <section class="hub-path" aria-labelledby="hub-path-title"><div><span class="hub-micro">KEEP THE ORIGINAL. CHOOSE THE DIRECTION.</span><h2 id="hub-path-title">From a single photograph<br>to a collection that feels yours</h2><a href="/app">Open your projects ↗</a></div><ol><li><span>01</span><div><strong>Bring an original</strong><p>Upload a photograph you have permission to edit.</p></div></li><li><span>02</span><div><strong>Review before you run</strong><p>Choose the workflow and check its allowance and availability.</p></div></li><li><span>03</span><div><strong>Look closer, then keep</strong><p>Inspect the saved result before you approve or download.</p></div></li></ol></section>
 <footer class="hub-footer"><span>Your photographs. A connected production workflow.</span><div><a href="/app/billing">Plan & usage ↗</a><a href="/app/profile">Account settings ↗</a></div></footer>
 <dialog id="hub-source-picker" class="hub-source-picker" aria-labelledby="hub-picker-title"><header><div><span class="hub-micro">START WITH YOUR OWN PHOTOGRAPH</span><h2 id="hub-picker-title">Choose an original</h2></div><button type="button" class="secondary" id="hub-picker-close" aria-label="Close photograph picker">×</button></header><div class="hub-picker-controls"><label>Workflow<select id="hub-picker-mode" aria-label="Workflow"></select></label><label>Filter loaded originals<input type="search" id="hub-source-search" placeholder="Filename or project" maxlength="100"></label></div><p id="hub-picker-help">Choose a ready original from your private image library. Opening an editor does not start generation.</p><div id="hub-picker-notice" class="notice" role="status"></div><div id="hub-source-grid" class="hub-source-grid"></div><button type="button" class="secondary" id="hub-source-more" hidden>Load more originals</button><footer><a href="/app/library">Upload or organize photographs ↗</a><span>Generation requires a separate review and confirmation.</span></footer></dialog>`;
  const grid = page.querySelector("#hub-feature-grid"),
    picker = page.querySelector("#hub-source-picker"),
    sourceGrid = page.querySelector("#hub-source-grid"),
    sourceNotice = page.querySelector("#hub-picker-notice"),
    modeSelect = page.querySelector("#hub-picker-mode"),
    sourceNodes = new Map();
  let category = "all",
    heroMode = "product",
    sourceRows = [],
    offset = 0,
    sourceEpoch = 0,
    controller,
    busy = false,
    hasLoaded = false;
  let observer;
  if (
    "IntersectionObserver" in window &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("hub-in-view");
            if (entry.target.classList.contains("hub-tool-card"))
              observer.unobserve(entry.target);
          } else if (entry.target.classList.contains("hub-hero"))
            entry.target.classList.remove("hub-in-view");
        }),
      { threshold: 0.08 },
    );
    observer.observe(page.querySelector(".hub-hero"));
    window.addEventListener("pagehide", () => observer.disconnect(), {
      once: true,
    });
  }
  function toolCard(f) {
    const card = el(
      "article",
      undefined,
      `hub-tool-card${f.wide ? " hub-tool-wide" : ""}`,
    );
    card.id = `hub-tool-${f.id}`;
    card.dataset.category = f.category;
    card.append(illustration(f));
    const copy = el("div", undefined, "hub-tool-copy");
    copy.append(
      el("span", f.eyebrow, "hub-micro"),
      el("h3", f.title),
      el("p", f.description),
    );
    const action = f.href
      ? link(f.action, f.href, "hub-tool-action")
      : button(f.action, () => openPicker(f.mode), "hub-tool-action");
    action.append(arrow());
    copy.append(action);
    card.append(copy);
    if (observer) {
      card.classList.add("hub-reveal");
      observer.observe(card);
    }
    return card;
  }
  const cards = features.map((f) => ({ f, card: toolCard(f) }));
  cards.forEach(({ card }) => grid.append(card));
  function filter() {
    const query = page.querySelector("#hub-search").value.trim().toLowerCase();
    let count = 0;
    cards.forEach(({ f, card }) => {
      const show =
        (category === "all" || f.category === category) &&
        `${f.title} ${f.description} ${f.tags}`.toLowerCase().includes(query);
      card.hidden = !show;
      if (show) {
        count++;
        if (observer) observer.observe(card);
      }
    });
    grid.classList.toggle("hub-filtered", category !== "all" || !!query);
    page.querySelector("#hub-tool-count").textContent =
      `${count} ${count === 1 ? "tool" : "tools"}`;
    page.querySelector("#hub-no-tools").hidden = count !== 0;
  }
  page.querySelectorAll("[data-category]").forEach(
    (b) =>
      (b.onclick = () => {
        category = b.dataset.category;
        page
          .querySelectorAll("[data-category]")
          .forEach((other) =>
            other.setAttribute("aria-pressed", String(other === b)),
          );
        filter();
      }),
  );
  page.querySelector("#hub-search").oninput = filter;
  page.querySelector("#hub-reset").onclick = () => {
    category = "all";
    page.querySelector("#hub-search").value = "";
    page
      .querySelectorAll("[data-category]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.category === "all")),
      );
    filter();
  };
  filter();
  const subjects = {
    product: {
      image: "footwear",
      caption: "PRODUCT PHOTOGRAPHY",
      alt: "Concept studio photograph of an ivory sneaker on a stone plinth",
    },
    portrait: {
      image: "portrait",
      caption: "PROFESSIONAL PORTRAITS",
      alt: "Concept professional portrait of a woman against a blue background",
    },
    personal: {
      image: "lifestyle",
      caption: "PERSONAL PHOTOGRAPHS",
      alt: "Concept photograph of two craftspeople in a pottery studio",
    },
  };
  page.querySelectorAll("[data-subject]").forEach(
    (b) =>
      (b.onclick = () => {
        heroMode = b.dataset.subject;
        const subject = subjects[heroMode],
          img = page.querySelector("#hub-hero-photo");
        img.src = `/images/${subject.image}.webp`;
        img.alt = subject.alt;
        page.querySelector("#hub-hero-caption").textContent = subject.caption;
        page
          .querySelectorAll("[data-subject]")
          .forEach((other) =>
            other.setAttribute("aria-pressed", String(other === b)),
          );
      }),
  );
  page.querySelector("#hub-start").onclick = () => openPicker(heroMode);
  for (const [value, name] of Object.entries(modes)) {
    const option = el("option", name);
    option.value = value;
    modeSelect.append(option);
  }
  function tell(message, error = false) {
    sourceNotice.textContent = message;
    sourceNotice.className = `notice${error ? " error" : ""}`;
    sourceNotice.setAttribute("role", error ? "alert" : "status");
  }
  function sourceHref(image) {
    return modeSelect.value === "pack"
      ? `/app/packs/new/${encodeURIComponent(image.id)}`
      : `/app/edit/${encodeURIComponent(image.id)}?mode=${modeSelect.value}`;
  }
  function renderSources() {
    sourceGrid.replaceChildren();
    const query = page
      .querySelector("#hub-source-search")
      .value.trim()
      .toLowerCase();
    const shown = sourceRows.filter((i) =>
      `${i.filename} ${i.project_name || ""}`.toLowerCase().includes(query),
    );
    shown.forEach((image) => {
      let a = sourceNodes.get(image.id);
      if (!a) {
        a = link("", sourceHref(image), "hub-source-card");
        const img = el("img");
        img.src = `/api/library/${encodeURIComponent(image.id)}/thumbnail`;
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        img.onerror = () => {
          img.hidden = true;
          a.classList.add("hub-source-unavailable");
        };
        a.append(
          img,
          el("strong", image.filename),
          el("span", image.project_name || "Unassigned"),
          arrow(),
        );
        sourceNodes.set(image.id, a);
      }
      a.href = sourceHref(image);
      a.setAttribute(
        "aria-label",
        `Use ${image.filename} for ${modes[modeSelect.value]}`,
      );
      sourceGrid.append(a);
    });
    if (!shown.length && hasLoaded) {
      const empty = el("div", undefined, "hub-source-empty");
      empty.append(
        el(
          "h3",
          sourceRows.length
            ? "No loaded originals match"
            : "No ready originals yet",
        ),
        el(
          "p",
          sourceRows.length
            ? "Try another filename or project, or load more originals."
            : "Add a photograph to your image library, then return to choose a direction.",
        ),
      );
      if (!sourceRows.length)
        empty.append(link("Open image library ↗", "/app/library"));
      sourceGrid.append(empty);
    }
    const hint =
      modeSelect.value === "pack"
        ? "Choose an original product photograph for a multi-output pack."
        : modeSelect.value === "product"
          ? "Choose a photograph of the actual product you want to edit."
          : modeSelect.value === "portrait"
            ? "Choose a photograph of the person you want to portray."
            : "Choose a personal photograph you have permission to edit.";
    page.querySelector("#hub-picker-help").textContent =
      hint + " Opening an editor does not start generation.";
  }
  async function loadSources(reset = false) {
    if (busy && !reset) return;
    if (reset) {
      controller?.abort();
      sourceEpoch++;
      sourceRows = [];
      offset = 0;
      hasLoaded = false;
    }
    const epoch = sourceEpoch;
    controller = new AbortController();
    busy = true;
    tell("Loading private originals…");
    sourceGrid.setAttribute("aria-busy", "true");
    page.querySelector("#hub-source-more").disabled = true;
    try {
      const data = await api(`/library?role=original&offset=${offset ?? 0}`, {
        signal: controller.signal,
      });
      if (epoch !== sourceEpoch || !picker.open) return;
      const known = new Set(sourceRows.map((i) => i.id));
      sourceRows.push(
        ...(data.images || []).filter(
          (i) =>
            i.role === "original" &&
            i.image_status === "ready" &&
            !i.trashed_at &&
            !known.has(i.id),
        ),
      );
      offset = data.next_offset ?? null;
      hasLoaded = true;
      renderSources();
      tell(
        `${sourceRows.length} ready ${sourceRows.length === 1 ? "original" : "originals"} loaded`,
      );
      page.querySelector("#hub-source-more").hidden = offset === null;
    } catch (error) {
      if (epoch !== sourceEpoch || error.name === "AbortError") return;
      tell(
        error.message || "Originals could not be loaded. Please try again.",
        true,
      );
      const retry = button(
        "Retry loading originals",
        () => loadSources(!hasLoaded),
        "secondary",
      );
      sourceNotice.append(document.createTextNode(" "), retry);
    } finally {
      if (epoch === sourceEpoch) {
        busy = false;
        sourceGrid.setAttribute("aria-busy", "false");
        page.querySelector("#hub-source-more").disabled = false;
      }
    }
  }
  function openPicker(mode) {
    sourceRows = [];
    sourceNodes.clear();
    hasLoaded = false;
    modeSelect.value = Object.hasOwn(modes, mode) ? mode : "product";
    page.querySelector("#hub-source-search").value = "";
    sourceGrid.replaceChildren();
    page.querySelector("#hub-source-more").hidden = true;
    picker.showModal();
    renderSources();
    void loadSources(true);
  }
  page.querySelector("#hub-picker-close").onclick = () => picker.close();
  picker.addEventListener("close", () => {
    sourceEpoch++;
    controller?.abort();
    busy = false;
    sourceRows = [];
    sourceNodes.clear();
    sourceGrid.replaceChildren();
  });
  page.querySelector("#hub-source-more").onclick = () => loadSources();
  modeSelect.onchange = renderSources;
  page.querySelector("#hub-source-search").oninput = renderSources;
  window.addEventListener(
    "pagehide",
    () => {
      sourceEpoch++;
      controller?.abort();
    },
    { once: true },
  );
  const available = page.querySelector("#hub-availability");
  try {
    const cap = await api("/processing/capabilities");
    if (!cap.enabled) {
      available.hidden = false;
      available.append(
        el(
          "span",
          "Explore and prepare your workflow. Image generation is awaiting service activation.",
        ),
        link("Plan & usage ↗", "/app/billing"),
      );
    }
  } catch {
    available.hidden = false;
    available.append(
      el(
        "span",
        "Live availability could not be checked. Each editor confirms access before processing.",
      ),
      link("Plan & usage ↗", "/app/billing"),
    );
  }
}
