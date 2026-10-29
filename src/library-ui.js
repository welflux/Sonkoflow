import "./library-workspace.css";
import { libraryUploads } from "./library-upload.js";
const modes = {
  product: "Product edit",
  portrait: "Portrait",
  personal: "Personal photograph",
};
const states = {
  ready: "Uploaded",
  queued: "Queued",
  running: "Processing",
  persisting: "Saving",
  completed: "Completed",
  failed: "Failed",
  uncertain: "Outcome unknown",
  cancelled: "Cancelled",
};
const shapes = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="1"/><path d="M16 8V3H3v13h5"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  folder: '<path d="M3 6h7l2 3h9v12H3z"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  list: '<path d="M8 5h13M8 12h13M8 19h13M3 5h1m-1 7h1m-1 7h1"/>',
};
function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined && text !== null) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = shapes[name] || shapes.image;
  return svg;
}
function button(text, action, cls = "secondary") {
  const n = el("button", text, cls);
  n.type = "button";
  n.onclick = action;
  return n;
}
function link(text, href, cls = "library-link") {
  const n = el("a", text, cls);
  n.href = href;
  return n;
}
function option(select, label, value) {
  const n = el("option", label);
  n.value = value;
  select.append(n);
}
function date(value, full = false) {
  const d = new Date(value);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString(
        undefined,
        full
          ? { dateStyle: "medium", timeStyle: "short" }
          : { dateStyle: "medium" },
      )
    : "Unavailable";
}
function size(value) {
  return Number.isFinite(Number(value)) && value !== undefined
    ? `${(Number(value) / 1048576).toLocaleString(undefined, { maximumFractionDigits: 2 })} MB`
    : "Size unavailable";
}
function badge(text, state = "active") {
  return el("span", text, `library-badge is-${state}`);
}

export async function libraryPage(api, shell) {
  const page = shell("library");
  page.classList.add("library-workspace");
  page.closest(".workspace-layout")?.classList.add("library-screen");
  page.innerHTML = `
 <header class="page-heading library-heading"><div><p class="eyebrow">PRIVATE ASSET WORKSPACE</p><h1>Image library</h1><p>Find, review and organize your originals and saved outputs.</p></div><div class="library-header-actions"><button type="button" id="library-projects-open" class="secondary" disabled>Projects</button><button type="button" id="library-upload-open" disabled>Upload images <span aria-hidden="true">↗</span></button></div></header>
 <div id="library-notice" class="notice" role="status"></div>
 <section class="library-browser" aria-label="Private image library">
  <div class="library-tabs-row"><div role="tablist" aria-label="Asset location"><button type="button" role="tab" id="library-active-tab" aria-selected="true">All assets</button><button type="button" role="tab" id="library-trash-tab" aria-selected="false">Recovery bin</button></div><details class="library-storage-info"><summary aria-label="Storage and recovery information">ⓘ</summary><div><strong>Private storage & recovery</strong><p>Files are stored as normalized WebP. Items in the recovery bin count toward storage and can be restored for <span id="library-retention">30</span> days. Eligible files are permanently removed by maintenance after that period. Active generation or assessment prevents trashing.</p><a href="/app/billing">View storage usage ↗</a></div></details><span class="library-private-label">Private workspace storage</span></div>
  <form id="library-filters" class="library-search-form"><div class="library-search-ribbon"><label class="library-search"><span class="library-sr-only">Search images or projects</span><span id="library-search-icon"></span><input name="search" type="search" maxlength="150" placeholder="Search filenames or projects" autocomplete="off"></label><label class="library-ribbon-field"><span class="library-sr-only">Project</span><select name="project_id" aria-label="Project"><option value="">All projects</option><option value="unassigned">Unassigned</option></select></label><label class="library-ribbon-field"><span class="library-sr-only">Mode</span><select name="mode" aria-label="Mode"><option value="">All modes</option><option value="product">Product</option><option value="portrait">Portrait</option><option value="personal">Personal</option></select></label><button type="submit" class="secondary" aria-label="Search library"><span class="library-submit-label">Search library</span></button></div>
  <details class="library-filter-panel"><summary>Advanced filters</summary><div class="library-advanced-grid"><label>Image type<select name="role" aria-label="Image type"><option value="">All images</option><option value="original">Original uploads</option><option value="generated">Generated outputs</option></select></label><label>Status<select name="status" aria-label="Status"><option value="">All statuses</option><option value="ready">Uploaded</option><option value="queued">Queued</option><option value="running">Processing</option><option value="persisting">Saving</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="uncertain">Outcome unknown</option><option value="cancelled">Cancelled</option></select></label><label>Review<select name="review" aria-label="Review"><option value="">All review states</option><option value="pending">Pending decision</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label><label>From (UTC)<input name="after" type="date"></label><label>To (UTC)<input name="before" type="date"></label><label class="library-check"><input name="archived" type="checkbox">Include archived projects</label></div></details><input name="trash" type="checkbox" hidden aria-label="Recovery bin filter"></form>
  <div id="library-toolbar" class="library-toolbar"><div class="library-result-summary"><span id="library-loaded" role="status">Loading library…</span><span id="library-count" role="status">0 selected</span><button type="button" class="library-quiet" id="library-reset">Clear filters</button></div><div class="library-view-tools"><label class="library-sort"><span class="library-sr-only">Sort</span><select name="sort" form="library-filters" aria-label="Sort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Filename</option></select></label><label class="library-density">Size<input id="library-density" type="range" min="40" max="88" step="8" value="48" aria-label="Thumbnail size"></label><div class="library-view-switch" role="group" aria-label="Library view"><button type="button" id="library-list-view" class="secondary" aria-label="List view" aria-pressed="true"></button><button type="button" id="library-grid-view" class="secondary" aria-label="Grid view" aria-pressed="false"></button></div><div class="library-batch-menu"><button type="button" id="library-batch-toggle" disabled aria-expanded="false" aria-controls="library-bulk">Batch actions (0)</button><div id="library-bulk" hidden><div class="library-bulk-heading"><strong>Selected assets</strong><button type="button" class="library-quiet" id="library-clear-selection">Clear selection</button></div><label>Move to<select id="library-move" aria-label="Move to"><option value="">Unassigned</option></select></label><button type="button" id="library-organize" class="secondary">Move selected</button><button type="button" id="library-download" class="secondary">Download links</button><button type="button" id="library-delete" class="danger">Trash selected</button><button type="button" id="library-restore" class="secondary">Restore selected</button><p>Actions apply to selected loaded records, up to 100 at a time.</p></div></div></div></div>
  <div id="library-results" class="library-list" aria-live="polite"></div><div class="library-load-more"><button type="button" id="library-more" class="secondary" hidden>Load more assets</button></div>
 </section>
 <dialog id="library-dialog" class="library-theater" aria-labelledby="library-preview-title"><header><div><span class="library-micro">ASSET INSPECTION</span><h2 id="library-preview-title">Asset preview</h2></div><button type="button" id="library-close" class="secondary">Close preview</button></header><div class="library-inspection"><div id="library-preview" class="library-photo-stage"></div><aside class="library-inspection-details"><div id="library-metadata"></div><section><h3>Version history & lineage</h3><div id="library-history"></div></section></aside></div></dialog>
 <dialog id="library-project-dialog" class="library-drawer" aria-labelledby="library-project-title"><header><div><span class="library-micro">WORKSPACE ORGANIZATION</span><h2 id="library-project-title">Projects</h2></div><button type="button" class="secondary" data-close-projects>Close projects</button></header><div class="library-drawer-body"><p>Organize assets into collections without changing their processing history.</p><details class="library-project-create"><summary>Create a project</summary><form id="library-create"><label>Project name<input name="name" maxlength="100" required></label><label>Workflow<select name="audience" aria-label="Workflow"><option value="ecommerce">Products</option><option value="professional">Professional</option><option value="individual">Personal</option></select></label><button type="submit">Create project</button></form></details><div id="library-project-feedback" role="status"></div><div id="library-projects"></div><a class="library-link" href="/app">Open project workspace ↗</a></div></dialog>
 <dialog id="library-edit-dialog" class="library-edit-dialog" aria-labelledby="library-edit-title"><form><h2 id="library-edit-title">Rename asset</h2><label>Name<input name="value" required maxlength="150"></label><div role="status"></div><div class="library-dialog-actions"><button type="button" class="secondary" data-cancel-edit>Cancel</button><button type="submit">Save name</button></div></form></dialog>
 <dialog id="library-download-dialog" class="library-edit-dialog" aria-labelledby="library-download-title"><header><h2 id="library-download-title">Selected downloads</h2><button type="button" class="secondary" data-close-download>Close downloads</button></header><p>Download private originals and saved images individually. Approved ZIP exports are available in their linked image packs and batches.</p><div id="library-download-links"></div></dialog>
 <dialog id="library-upload-dialog" class="library-edit-dialog" aria-labelledby="library-upload-title"><header><div><span class="library-micro">PRIVATE ORIGINALS</span><h2 id="library-upload-title">Upload photographs</h2></div><button type="button" class="secondary" data-close-upload>Close upload</button></header><form><label>Upload project<select name="project" required aria-label="Upload project"></select></label><label class="library-upload-picker">Choose photographs<input name="files" type="file" multiple accept="image/jpeg,image/png,image/webp"></label><p>JPEG, PNG or WebP · up to 10 MB / 25 MP per photograph · minimum 64 × 64 pixels. Upload up to 10 at a time. Actual account limits apply.</p><div class="library-upload-queue"></div><div role="status"></div><button type="submit" disabled>Upload originals</button></form></dialog>`;
  page.querySelector("#library-search-icon").append(icon("search"));
  page
    .querySelector('.library-search-ribbon button[type="submit"]')
    .append(icon("search"));
  page.querySelector("#library-list-view").append(icon("list"));
  page.querySelector("#library-grid-view").append(icon("grid"));
  const form = page.querySelector("#library-filters"),
    results = page.querySelector("#library-results"),
    notice = page.querySelector("#library-notice"),
    more = page.querySelector("#library-more"),
    bulk = page.querySelector("#library-bulk"),
    batchButton = page.querySelector("#library-batch-toggle"),
    dialog = page.querySelector("#library-dialog"),
    projectDialog = page.querySelector("#library-project-dialog"),
    editDialog = page.querySelector("#library-edit-dialog"),
    selected = new Set();
  let images = [],
    projectRows = [],
    next = null,
    epoch = 0,
    previewEpoch = 0,
    previewController,
    mutating = false,
    list = true,
    ready = false,
    retention = 30,
    searchTimer,
    editSave,
    editBusy = false,
    loading = false;
  function message(value, error = false) {
    notice.textContent = value?.message ?? value;
    notice.className = `notice${error ? " error" : ""}`;
    notice.setAttribute("role", error ? "alert" : "status");
  }
  function menu(open) {
    bulk.hidden = !open;
    batchButton.setAttribute("aria-expanded", String(open));
  }
  function selection() {
    page.querySelector("#library-count").textContent =
      `${selected.size} selected`;
    batchButton.textContent = `Batch actions (${selected.size})`;
    batchButton.disabled = !selected.size || mutating;
    page
      .querySelector("#library-count")
      .classList.toggle("library-sr-only", !selected.size);
    page.querySelector("#library-reset").hidden = !hasFilters();
    if (!selected.size) menu(false);
    page.querySelector("#library-delete").hidden = form.elements.trash.checked;
    page.querySelector("#library-restore").hidden =
      !form.elements.trash.checked;
    page.querySelector("#library-download").disabled =
      form.elements.trash.checked || mutating;
    const check = results.querySelector("#library-select");
    if (check) {
      check.checked =
        !!images.length &&
        images.slice(0, 100).every((image) => selected.has(image.id));
      check.setAttribute(
        "aria-label",
        images.length > 100
          ? "Select first 100 loaded assets"
          : "Select loaded assets",
      );
      check.indeterminate = selected.size > 0 && !check.checked;
      check.disabled = mutating || !images.length;
    }
    for (const row of results.querySelectorAll("[data-asset-id]")) {
      const chosen = selected.has(row.dataset.assetId);
      row.classList.toggle("is-selected", chosen);
      const check = row.querySelector("input[type=checkbox]");
      if (check) check.checked = chosen;
    }
  }
  function selectImage(image, check) {
    if (check.checked && selected.size >= 100) {
      check.checked = false;
      message("Select up to 100 assets at a time", true);
      return;
    }
    check.checked ? selected.add(image.id) : selected.delete(image.id);
    selection();
  }
  function selectLoaded(check) {
    if (!check.checked) selected.clear();
    else {
      selected.clear();
      images.slice(0, 100).forEach((image) => selected.add(image.id));
      if (images.length > 100)
        message(
          "The first 100 loaded assets are selected. Clear this selection before working on another group.",
        );
    }
    selection();
  }
  function copyId(id) {
    return (
      navigator.clipboard
        ?.writeText(id)
        .then(() => message("Asset ID copied"))
        .catch(() =>
          message(
            "Copy is unavailable in this browser. The full asset ID is shown in the preview.",
            true,
          ),
        ) ?? message("The full asset ID is shown in the preview.", true)
    );
  }
  function checkCell(image) {
    const input = el("input");
    input.type = "checkbox";
    input.checked = selected.has(image.id);
    input.setAttribute("aria-label", `Select ${image.filename}`);
    input.onchange = () => selectImage(image, input);
    return input;
  }
  function thumbnail(image) {
    const b = button("", () => preview(image), "library-thumbnail");
    b.setAttribute("aria-label", `Preview ${image.filename}`);
    if (!image.trashed_at) {
      const img = el("img");
      img.src = `/api/library/${image.id}/thumbnail`;
      img.loading = "lazy";
      img.width = 56;
      img.height = 56;
      img.alt = image.filename;
      img.onerror = () => {
        img.remove();
        b.append(icon("image"));
        b.title = "Preview unavailable · open to retry";
      };
      b.append(img);
    } else {
      b.append(icon("trash"));
      b.title = "Restore to view the photograph";
    }
    return b;
  }
  function identity(image) {
    const box = el("div", null, "library-asset-identity"),
      name = button(image.filename, () => preview(image), "library-filename"),
      id = el("div", null, "library-asset-id");
    id.append(el("code", `ID ${image.id.slice(0, 13)}…`));
    const copy = button("", () => copyId(image.id), "library-icon-button");
    copy.append(icon("copy"));
    copy.setAttribute("aria-label", `Copy asset ID for ${image.filename}`);
    id.append(copy);
    box.append(name, id, el("span", date(image.created_at), "library-created"));
    return box;
  }
  function projectLink(image) {
    return image.library_project_id
      ? link(
          image.project_name || "Open project",
          `/app/library?project_id=${image.library_project_id}${image.archived ? "&archived=1" : ""}`,
          "library-project-token",
        )
      : el("span", "Unassigned", "library-muted");
  }
  function lifecycle(image) {
    const box = el("div", null, "library-lifecycle");
    box.append(
      badge(
        image.trashed_at ? "Recovery bin" : "Active",
        image.trashed_at ? "recovery" : "active",
      ),
    );
    if (image.trashed_at) {
      const days = Math.max(
        0,
        Math.ceil(
          (new Date(image.trashed_at).getTime() +
            retention * 86400000 -
            Date.now()) /
            86400000,
        ),
      );
      box.append(
        el("small", days ? `${days} days remaining` : "Recovery period ended"),
      );
    } else
      box.append(
        el(
          "small",
          image.role === "original"
            ? "Original upload"
            : states[image.processing_status] ||
                image.image_status ||
                "Saved output",
        ),
      );
    return box;
  }
  function reviewCell(image) {
    const box = el("div", null, "library-review-cell");
    box.append(
      badge(
        image.role === "original"
          ? "Source original"
          : image.user_decision === "approved"
            ? "Approved"
            : image.user_decision === "rejected"
              ? "Rejected"
              : "Awaiting review",
        image.user_decision === "rejected" && image.role !== "original"
          ? "recovery"
          : "review",
      ),
    );
    if (image.job_id && !image.trashed_at)
      box.append(
        link(
          image.role === "original"
            ? "View related edit ↗"
            : "Compare & review ↗",
          `/app/edits/${image.job_id}`,
        ),
      );
    return box;
  }
  function rowActions(image) {
    const actions = el("div", null, "library-row-actions");
    if (!image.trashed_at) {
      const download = link(
        "",
        `/api/images/${image.id}/content?download=1`,
        "library-icon-button",
      );
      download.append(icon("download"));
      download.setAttribute("aria-label", `Download ${image.filename}`);
      actions.append(download);
    }
    const details = el("details", null, "library-row-menu"),
      summary = el("summary", "•••");
    summary.setAttribute("aria-label", `Actions for ${image.filename}`);
    const box = el("div");
    box.append(
      button("Preview & versions", () => preview(image), "library-quiet"),
    );
    if (!image.trashed_at) {
      box.append(
        button(
          "Rename",
          () =>
            rename("Rename asset", image.filename, 150, async (value) => {
              await api("/library/actions", {
                method: "POST",
                body: JSON.stringify({
                  ids: [image.id],
                  action: "rename",
                  value,
                }),
              });
              await load();
            }),
          "library-quiet",
        ),
      );
      if (image.role === "original")
        box.append(link("Enhance this original", `/app/edit/${image.id}`));
      box.append(
        button(
          "Move to recovery bin",
          () => action("trash", undefined, [image.id]),
          "library-quiet",
        ),
      );
    } else
      box.append(
        button(
          "Restore asset",
          () => action("restore", undefined, [image.id]),
          "library-quiet",
        ),
      );
    if (image.pack_id)
      box.append(link("Open image pack", `/app/packs/${image.pack_id}`));
    if (image.batch_id)
      box.append(link("Open batch", `/app/batches/${image.batch_id}`));
    details.append(summary, box);
    actions.append(details);
    return actions;
  }
  const renderedRecords = new WeakMap();
  function render(keepRows = false) {
    const retained = keepRows
      ? new Map(
          [...results.querySelectorAll("[data-asset-id]")].map((row) => [
            row.dataset.assetId,
            row,
          ]),
        )
      : new Map();
    results.replaceChildren();
    results.className = list ? "library-list" : "library-grid";
    if (!images.length) {
      empty();
      selection();
      return;
    }
    if (list) {
      const wrap = el("div", null, "library-ledger-scroll");
      wrap.tabIndex = 0;
      wrap.setAttribute("role", "region");
      wrap.setAttribute("aria-label", "Asset ledger");
      const table = el("table", null, "library-ledger"),
        caption = el("caption", "Private asset ledger", "library-sr-only"),
        head = el("thead"),
        tr = el("tr"),
        th = el("th");
      th.scope = "col";
      const all = el("input");
      all.type = "checkbox";
      all.id = "library-select";
      all.setAttribute("aria-label", "Select loaded assets");
      all.onchange = () => selectLoaded(all);
      th.append(all);
      tr.append(th);
      for (const title of [
        "Preview",
        "Asset detail & ID",
        "Project",
        "Mode",
        "Lifecycle",
        "Dimensions",
        "Audit review",
        "Actions",
      ]) {
        const h = el("th", title);
        h.scope = "col";
        tr.append(h);
      }
      head.append(tr);
      const body = el("tbody");
      for (const image of images) {
        const existing = retained.get(image.id);
        if (existing && renderedRecords.get(existing) === image) {
          body.append(existing);
          continue;
        }
        const row = el("tr", null, "library-card");
        renderedRecords.set(row, image);
        row.dataset.assetId = image.id;
        const cells = [
          checkCell(image),
          thumbnail(image),
          identity(image),
          projectLink(image),
          el(
            "span",
            image.role === "original"
              ? "Source original"
              : modes[image.mode] || "Saved output",
          ),
          lifecycle(image),
          el("div", null, "library-dimensions"),
          reviewCell(image),
          rowActions(image),
        ];
        cells[6].append(
          el("span", `${image.width} × ${image.height}`),
          el("small", size(image.byte_size)),
        );
        for (const child of cells) {
          const cell = el("td");
          cell.append(child);
          row.append(cell);
        }
        body.append(row);
      }
      table.append(caption, head, body);
      wrap.append(table);
      results.append(wrap);
    } else
      for (const image of images) {
        const existing = retained.get(image.id);
        if (existing && renderedRecords.get(existing) === image) {
          results.append(existing);
          continue;
        }
        const card = el("article", null, "library-card");
        renderedRecords.set(card, image);
        card.dataset.assetId = image.id;
        const visual = el("div", null, "library-gallery-visual");
        visual.append(thumbnail(image), checkCell(image));
        card.append(
          visual,
          identity(image),
          projectLink(image),
          el(
            "p",
            `${image.width} × ${image.height} · ${size(image.byte_size)}`,
            "library-card-meta",
          ),
          lifecycle(image),
          reviewCell(image),
          rowActions(image),
        );
        results.append(card);
      }
    selection();
  }
  function hasFilters() {
    return !!(
      form.elements.search.value ||
      form.elements.project_id.value ||
      form.elements.mode.value ||
      form.elements.role.value ||
      form.elements.status.value ||
      form.elements.review.value ||
      form.elements.after.value ||
      form.elements.before.value ||
      form.elements.archived.checked
    );
  }
  function empty() {
    const box = el("div", null, "library-empty-state");
    box.append(icon(form.elements.trash.checked ? "trash" : "image"));
    const filtered = hasFilters();
    box.append(
      el(
        "h2",
        filtered
          ? "No assets match these filters"
          : form.elements.trash.checked
            ? "Your recovery bin is empty"
            : "Your library starts with an original",
      ),
      el(
        "p",
        filtered
          ? "Try another search or clear the current filters."
          : form.elements.trash.checked
            ? "Images you move to the recovery bin will appear here."
            : "Upload your photographs into a project, then keep originals and saved edits together.",
      ),
    );
    const actions = el("div", null, "library-empty-actions");
    if (filtered) actions.append(button("Clear filters", resetFilters));
    if (!form.elements.trash.checked)
      actions.append(
        button(
          "Upload photographs",
          () => uploads.open([], form.elements.project_id.value),
          "library-primary",
        ),
      );
    box.append(actions);
    if (!form.elements.trash.checked)
      box.append(
        el(
          "small",
          "You can also drop photographs here to choose their upload project",
        ),
      );
    results.append(box);
  }
  function query() {
    const p = new URLSearchParams();
    for (const [key, value] of new FormData(form)) {
      if (!value) continue;
      if (key === "after" || key === "before")
        p.set(
          key,
          `${value}T${key === "before" ? "23:59:59.999" : "00:00:00.000"}Z`,
        );
      else if (key === "project_id" && value === "unassigned")
        p.set("unassigned", "1");
      else p.set(key, value === "on" ? "1" : value);
    }
    return p;
  }
  async function load(append = false) {
    if (!ready || mutating) return;
    clearTimeout(searchTimer);
    if (
      form.elements.after.value &&
      form.elements.before.value &&
      form.elements.after.value > form.elements.before.value
    ) {
      message("Choose an end date on or after the start date", true);
      return;
    }
    const oldScroll = results.querySelector(".library-ledger-scroll"),
      scroll =
        append && oldScroll
          ? { top: oldScroll.scrollTop, left: oldScroll.scrollLeft }
          : null;
    const version = ++epoch,
      requestOffset = append ? next : 0;
    loading = true;
    more.disabled = true;
    results.setAttribute("aria-busy", "true");
    if (!append) {
      images = [];
      selected.clear();
      results.className = "library-loading";
      results.replaceChildren(
        el("div", "Loading your private assets…", "library-loading-state"),
      );
      page.querySelector("#library-loaded").textContent = "Loading library…";
    }
    selection();
    const p = query();
    history.replaceState(
      null,
      "",
      `${location.pathname}${p.size ? "?" + p : ""}`,
    );
    p.set("offset", String(requestOffset ?? 0));
    try {
      const response = await api(`/library?${p}`);
      if (version !== epoch) return;
      images = append
        ? [
            ...new Map(
              [...images, ...response.images].map((image) => [image.id, image]),
            ).values(),
          ]
        : response.images;
      next = response.next_offset;
      render(append);
      if (scroll) {
        const area = results.querySelector(".library-ledger-scroll");
        if (area) {
          area.scrollTop = scroll.top;
          area.scrollLeft = scroll.left;
        }
      }
      page.querySelector("#library-loaded").textContent =
        `${images.length} assets loaded${next !== null ? " · more available" : ""}`;
      more.hidden = next === null;
    } catch (error) {
      if (version === epoch) {
        message(error, true);
        if (!append) {
          page.querySelector("#library-loaded").textContent =
            "Library unavailable";
          results.className = "library-error-state";
          results.replaceChildren(
            el("h2", "Your library could not load"),
            el(
              "p",
              "Your assets remain stored. Retry this search to reconnect.",
            ),
            button("Retry library", () => load()),
          );
          more.hidden = true;
        }
      }
    } finally {
      if (version === epoch) {
        loading = false;
        more.disabled = false;
        results.setAttribute("aria-busy", "false");
      }
    }
  }
  function lock(value) {
    mutating = value;
    results.inert = value;
    for (const c of page.querySelectorAll(
      "#library-filters input,#library-filters select,#library-filters button,#library-toolbar button,#library-toolbar select,#library-projects-open,#library-upload-open",
    )) {
      if (value) {
        c.dataset.wasDisabled = String(c.disabled);
        c.disabled = true;
      } else if (c.dataset.wasDisabled !== undefined) {
        c.disabled = c.dataset.wasDisabled === "true";
        delete c.dataset.wasDisabled;
      }
    }
    selection();
  }
  async function action(kind, value, ids = [...selected]) {
    if (mutating) return;
    if (!ids.length) {
      message("Select at least one asset", true);
      return;
    }
    if (
      kind === "trash" &&
      !confirm(
        `Move ${ids.length} selected images to the recovery bin? Existing generation and accounting history are retained. Active work prevents this action.`,
      )
    )
      return;
    ++epoch;
    loading = false;
    more.disabled = false;
    results.setAttribute("aria-busy", "false");
    lock(true);
    try {
      await api("/library/actions", {
        method: "POST",
        body: JSON.stringify({
          ids,
          action: kind,
          ...(value !== undefined ? { value } : {}),
        }),
      });
      selected.clear();
      menu(false);
      lock(false);
      await load();
      message(
        `${ids.length} assets ${kind === "trash" ? "moved to recovery" : kind === "restore" ? "restored" : "updated"}`,
      );
    } catch (error) {
      message(error, true);
    } finally {
      lock(false);
    }
  }
  async function projects() {
    const r = await api("/library/projects");
    projectRows = r.projects;
    const current = form.elements.project_id.value,
      move = page.querySelector("#library-move");
    form.elements.project_id.replaceChildren();
    option(form.elements.project_id, "All projects", "");
    option(form.elements.project_id, "Unassigned", "unassigned");
    move.replaceChildren();
    option(move, "Unassigned", "");
    const host = page.querySelector("#library-projects");
    host.replaceChildren();
    for (const p of projectRows) {
      option(
        form.elements.project_id,
        `${p.name}${p.archived ? " (archived)" : ""}`,
        p.id,
      );
      if (!p.archived) option(move, p.name, p.id);
      const card = el("article", null, "library-project-item");
      const title = el("div");
      title.append(
        link(
          p.name,
          `/app/library?project_id=${p.id}${p.archived ? "&archived=1" : ""}`,
        ),
        badge(
          p.archived ? "Archived" : "Active",
          p.archived ? "recovery" : "active",
        ),
      );
      card.append(title);
      const actions = el("div", null, "library-project-actions");
      actions.append(
        button(
          "Rename",
          () =>
            rename("Rename project", p.name, 100, (value) =>
              projectAction(p.id, "rename", value),
            ),
          "library-quiet",
        ),
        button(
          p.archived ? "Restore project" : "Archive project",
          () =>
            void projectAction(p.id, p.archived ? "restore" : "archive").catch(
              () => {},
            ),
          "library-quiet",
        ),
        button(
          "Delete empty project",
          () => {
            if (
              confirm(
                "Delete this empty project? Projects retaining assets or processing history cannot be deleted. Archive it to retain that history.",
              )
            )
              void projectAction(p.id, "delete").catch(() => {});
          },
          "library-quiet",
        ),
      );
      card.append(actions);
      host.append(card);
    }
    if (!projectRows.length)
      host.append(
        el(
          "div",
          "Create your first project to organize private uploads.",
          "library-project-empty",
        ),
      );
    if ([...form.elements.project_id.options].some((o) => o.value === current))
      form.elements.project_id.value = current;
  }
  async function projectAction(id, action, value) {
    const feedback = page.querySelector("#library-project-feedback");
    try {
      await api(`/library/projects/${id}`, {
        method: "POST",
        body: JSON.stringify({ action, ...(value ? { value } : {}) }),
      });
      await projects();
      await load();
      feedback.textContent = "Project updated";
    } catch (error) {
      feedback.textContent = error.message;
      throw error;
    }
  }
  function rename(title, value, max, save) {
    page.querySelector("#library-edit-title").textContent = title;
    const f = editDialog.querySelector("form");
    f.elements.value.value = value;
    f.elements.value.maxLength = max;
    f.querySelector("[role=status]").textContent = "";
    editSave = save;
    editDialog.showModal();
    f.elements.value.select();
  }
  editDialog.querySelector("form").onsubmit = async (event) => {
    event.preventDefault();
    if (editBusy) return;
    const f = event.target,
      controls = [...f.querySelectorAll("input,button")];
    editBusy = true;
    controls.forEach((c) => (c.disabled = true));
    try {
      await editSave(f.elements.value.value.trim());
      editDialog.close();
      message("Name updated");
    } catch (error) {
      f.querySelector("[role=status]").textContent = error.message;
    } finally {
      editBusy = false;
      controls.forEach((c) => (c.disabled = false));
    }
  };
  editDialog.querySelector("[data-cancel-edit]").onclick = () => {
    if (!editBusy) editDialog.close();
  };
  editDialog.addEventListener("cancel", (event) => {
    if (editBusy) event.preventDefault();
  });
  const uploads = libraryUploads({
    dialog: page.querySelector("#library-upload-dialog"),
    api,
    projects: () => projectRows,
    onComplete: () => load(),
    message,
  });
  page.querySelector("#library-upload-open").onclick = () => {
    if (!mutating) uploads.open([], form.elements.project_id.value);
  };
  page.querySelector("#library-projects-open").onclick = () =>
    projectDialog.showModal();
  page.querySelector("[data-close-projects]").onclick = () =>
    projectDialog.close();
  page.querySelector("#library-create").onsubmit = async (event) => {
    event.preventDefault();
    const f = event.target,
      submit = f.querySelector("button"),
      feedback = page.querySelector("#library-project-feedback");
    submit.disabled = true;
    try {
      await api("/projects", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(f))),
      });
      f.reset();
      await projects();
      feedback.textContent = "Project created";
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  };
  function resetFilters() {
    const trash = form.elements.trash.checked;
    form.reset();
    form.elements.trash.checked = trash;
    void load();
  }
  page.querySelector("#library-reset").onclick = resetFilters;
  form.onsubmit = (event) => {
    event.preventDefault();
    void load();
  };
  form.elements.search.oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => load(), 300);
  };
  form.addEventListener("change", (event) => {
    if (event.target !== form.elements.search) void load();
  });
  page.querySelector("[name=sort]").onchange = () => load();
  for (const [id, trash] of [
    ["library-active-tab", false],
    ["library-trash-tab", true],
  ]) {
    const tab = page.querySelector("#" + id);
    tab.onclick = () => {
      if (mutating) return;
      form.elements.trash.checked = trash;
      for (const [other, active] of [
        ["library-active-tab", !trash],
        ["library-trash-tab", trash],
      ])
        page
          .querySelector("#" + other)
          .setAttribute("aria-selected", String(active));
      void load();
    };
    tab.onkeydown = (event) => {
      if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        const other = page.querySelector(
          trash ? "#library-active-tab" : "#library-trash-tab",
        );
        other.focus();
        other.click();
      }
    };
  }
  more.onclick = () => {
    if (!loading) void load(true);
  };
  batchButton.onclick = () => menu(bulk.hidden);
  page.querySelector("#library-clear-selection").onclick = () => {
    selected.clear();
    selection();
  };
  page.querySelector("#library-organize").onclick = () =>
    action("move", page.querySelector("#library-move").value || null);
  page.querySelector("#library-delete").onclick = () => action("trash");
  page.querySelector("#library-restore").onclick = () => action("restore");
  page.querySelector("#library-download").onclick = () => {
    const host = page.querySelector("#library-download-links");
    host.replaceChildren();
    for (const image of images.filter(
      (image) => selected.has(image.id) && !image.trashed_at,
    ))
      host.append(
        link(
          `Download ${image.filename}`,
          `/api/images/${image.id}/content?download=1`,
        ),
      );
    page.querySelector("#library-download-dialog").showModal();
  };
  page.querySelector("[data-close-download]").onclick = () =>
    page.querySelector("#library-download-dialog").close();
  for (const [id, value] of [
    ["library-list-view", true],
    ["library-grid-view", false],
  ])
    page.querySelector("#" + id).onclick = () => {
      list = value;
      page
        .querySelector("#library-list-view")
        .setAttribute("aria-pressed", String(list));
      page
        .querySelector("#library-grid-view")
        .setAttribute("aria-pressed", String(!list));
      render();
    };
  page.querySelector("#library-density").oninput = (event) => {
    results.style.setProperty("--library-thumb", `${event.target.value}px`);
    results.style.setProperty(
      "--library-row-padding",
      `${5 + (Number(event.target.value) - 40) / 8}px`,
    );
    results.style.setProperty(
      "--library-gallery-width",
      `${Number(event.target.value) * 3.5}px`,
    );
  };
  page.addEventListener("click", (event) => {
    if (!event.target.closest(".library-batch-menu")) menu(false);
  });
  page.addEventListener("keydown", (event) => {
    if (event.key === "Escape") menu(false);
  });
  results.ondragover = (event) => {
    if (event.dataTransfer.types.includes("Files") && ready && !mutating) {
      event.preventDefault();
      results.classList.add("is-dragging");
    }
  };
  results.ondragleave = (event) => {
    if (!results.contains(event.relatedTarget))
      results.classList.remove("is-dragging");
  };
  results.ondrop = (event) => {
    event.preventDefault();
    results.classList.remove("is-dragging");
    if (ready && !mutating && event.dataTransfer.files.length)
      uploads.open(
        [...event.dataTransfer.files],
        form.elements.project_id.value,
      );
  };
  page.querySelector("#library-close").onclick = () => dialog.close();
  dialog.addEventListener("close", () => {
    previewEpoch++;
    previewController?.abort();
    page.querySelector("#library-preview").replaceChildren();
  });
  async function preview(image) {
    const version = ++previewEpoch;
    previewController?.abort();
    previewController = new AbortController();
    page.querySelector("#library-preview-title").textContent = image.filename;
    const photo = page.querySelector("#library-preview"),
      meta = page.querySelector("#library-metadata"),
      historyHost = page.querySelector("#library-history");
    photo.replaceChildren();
    meta.replaceChildren();
    historyHost.replaceChildren(
      el("p", "Loading saved lineage…", "library-muted"),
    );
    if (image.trashed_at)
      photo.append(
        icon("trash"),
        el("p", "Restore this asset to view its photograph"),
      );
    else {
      const status = el("span", "Loading full image…", "library-image-state"),
        img = el("img");
      img.src = `/api/images/${image.id}/content`;
      img.alt = image.filename;
      img.onload = () => status.remove();
      img.onerror = () => {
        img.remove();
        status.textContent =
          "Image preview is unavailable. Close and reopen to retry.";
      };
      photo.append(status, img);
    }
    meta.append(el("h3", "Asset details"));
    const dl = el("dl", null, "library-metadata");
    for (const [label, value] of [
      ["Asset ID", image.id],
      [
        "Type",
        image.role === "original" ? "Original upload" : "Generated output",
      ],
      ["Dimensions", `${image.width} × ${image.height} px`],
      ["Stored size", size(image.byte_size)],
      ["Created", date(image.created_at, true)],
      ["Format", "Normalized WebP"],
    ]) {
      const row = el("div");
      row.append(el("dt", label), el("dd", value));
      dl.append(row);
    }
    meta.append(
      dl,
      projectLink(image),
      button("Copy asset ID", () => copyId(image.id), "secondary"),
    );
    if (!image.trashed_at) {
      meta.append(
        link("Download image", `/api/images/${image.id}/content?download=1`),
      );
      if (image.role === "original")
        meta.append(link("Enhance this original", `/app/edit/${image.id}`));
    }
    if (image.pack_id)
      meta.append(link("Open image pack", `/app/packs/${image.pack_id}`));
    if (image.batch_id)
      meta.append(link("Open batch", `/app/batches/${image.batch_id}`));
    if (!dialog.open) dialog.showModal();
    if (image.trashed_at) {
      historyHost.replaceChildren(
        el("p", "Restore this asset to access its stored versions."),
      );
      return;
    }
    let historyOffset = 0,
      historyLoading = false;
    const renderedJobs = new Set();
    async function historyPage(append = false) {
      if (historyLoading) return;
      historyLoading = true;
      let moreButton = historyHost.querySelector("button");
      if (moreButton) moreButton.disabled = true;
      try {
        const r = await api(
          `/library/${image.id}/history?offset=${historyOffset}`,
          { signal: previewController.signal },
        );
        if (version !== previewEpoch || !dialog.open) return;
        if (!append) {
          historyHost.replaceChildren();
          renderedJobs.clear();
        }
        historyHost.querySelector(".library-history-more")?.remove();
        historyHost.querySelector(".library-history-retry")?.remove();
        for (const job of r.jobs) {
          if (renderedJobs.has(job.id)) continue;
          renderedJobs.add(job.id);
          const item = el("article", null, "library-version"),
            heading = el("div", null, "library-version-heading");
          heading.append(
            badge(
              states[job.status] || job.status,
              job.status === "failed" ? "recovery" : "active",
            ),
            el("span", date(job.created_at, true)),
          );
          item.append(
            heading,
            el("strong", modes[job.mode] || job.mode),
            el(
              "p",
              `Assessment: ${job.quality_state || "Unavailable"} · Decision: ${job.user_decision || "Pending"}`,
            ),
          );
          if (job.input_image_id) {
            item.append(el("small", `Source ${job.input_image_id}`));
            if (job.input_image_id !== image.id)
              item.append(
                link(
                  "Open source photograph ↗",
                  `/app/edit/${job.input_image_id}`,
                ),
              );
          }
          if (job.instructions) {
            const details = el("details");
            details.append(
              el("summary", "Saved editing instructions"),
              el("p", job.instructions),
            );
            item.append(details);
          }
          const brand = job.settings?.brand_snapshot;
          if (brand)
            item.append(
              el(
                "p",
                `Brand: ${brand.profile_name || brand.profile_id} · revision ${brand.profile_revision}`,
              ),
              link("Open Brand Studio ↗", "/app/brands"),
            );
          if (job.output_image_id || job.status === "completed")
            item.append(
              link(
                "Compare original & result / review ↗",
                `/app/edits/${job.id}`,
              ),
            );
          if (job.pack_id)
            item.append(
              link("Open this pack version", `/app/packs/${job.pack_id}`),
            );
          historyHost.append(item);
        }
        if (!r.jobs.length && !append)
          historyHost.append(
            el("p", "No generated versions are associated with this image."),
          );
        if (r.next_offset !== null && r.next_offset !== undefined) {
          const b = button(
            "More versions",
            () => {
              historyOffset = r.next_offset;
              void historyPage(true);
            },
            "secondary library-history-more",
          );
          historyHost.append(b);
        }
      } catch (error) {
        if (version === previewEpoch && !previewController.signal.aborted) {
          if (!append) historyHost.replaceChildren();
          historyHost.append(
            el("p", `Version history unavailable: ${error.message}`),
            button(
              "Retry versions",
              () => historyPage(append),
              "secondary library-history-retry",
            ),
          );
          if (moreButton) moreButton.disabled = false;
        }
      } finally {
        historyLoading = false;
      }
    }
    await historyPage();
  }
  try {
    const cap = await api("/library/capabilities");
    if (!cap.available)
      throw Error(
        "Image management is not available right now. Your project uploads remain accessible.",
      );
    retention = Number.isInteger(cap.retention_days) ? cap.retention_days : 30;
    page.querySelector("#library-retention").textContent = String(retention);
    await projects();
    const params = new URLSearchParams(location.search);
    for (const name of [
      "search",
      "project_id",
      "role",
      "mode",
      "status",
      "review",
      "sort",
      "after",
      "before",
    ]) {
      const input = form.elements[name],
        value = params.get(name);
      if (value !== null)
        input.value =
          name === "after" || name === "before" ? value.slice(0, 10) : value;
    }
    if (params.get("unassigned") === "1")
      form.elements.project_id.value = "unassigned";
    form.elements.archived.checked = params.get("archived") === "1";
    form.elements.trash.checked = params.get("trash") === "1";
    page
      .querySelector("#library-active-tab")
      .setAttribute("aria-selected", String(!form.elements.trash.checked));
    page
      .querySelector("#library-trash-tab")
      .setAttribute("aria-selected", String(form.elements.trash.checked));
    ready = true;
    page.querySelector("#library-projects-open").disabled = false;
    page.querySelector("#library-upload-open").disabled = false;
    await load();
  } catch (error) {
    page.querySelector("#library-loaded").textContent = "Library unavailable";
    results.className = "library-error-state";
    results.replaceChildren(
      el("h2", "Image Library is unavailable"),
      el("p", error.message),
      link("Open project workspace ↗", "/app"),
    );
    message(error, true);
  }
}
