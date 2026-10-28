function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
function button(text, action, cls = "secondary") {
  const n = el("button", text, cls);
  n.type = "button";
  n.onclick = action;
  return n;
}
function option(select, label, value) {
  const n = el("option", label);
  n.value = value;
  select.append(n);
}
export async function libraryPage(api, shell) {
  const page = shell("library");
  page.innerHTML =
    '<div class="page-heading"><div><p class="eyebrow">YOUR WORK, IN ONE PLACE</p><h1>Image library.</h1><p>Originals, saved edits and the collections they belong to.</p></div><a class="button" href="/app">Upload to a project</a></div><div id="library-notice" class="notice" role="status"></div><details class="panel library-filter-panel"><summary>Search & filters</summary><form id="library-filters" class="library-filters"><label>Search images or projects<input name="search" maxlength="150" type="search"></label><label>Project<select name="project_id"><option value="">All projects</option><option value="unassigned">Unassigned</option></select></label><label>Image type<select name="role"><option value="">All images</option><option value="original">Original uploads</option><option value="generated">Generated outputs</option></select></label><label>Mode<select name="mode"><option value="">All modes</option><option value="product">Product</option><option value="portrait">Portrait</option><option value="personal">Personal</option></select></label><label>Status<select name="status"><option value="">All statuses</option><option value="ready">Uploaded</option><option value="queued">Queued</option><option value="running">Processing</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="uncertain">Outcome unknown</option><option value="cancelled">Cancelled</option></select></label><label>Review<select name="review"><option value="">All review states</option><option value="pending">Pending decision</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label><label>Sort<select name="sort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="name">Filename</option></select></label><label>From (UTC)<input name="after" type="date"></label><label>To (UTC)<input name="before" type="date"></label><label class="check-row"><input name="archived" type="checkbox"><span>Include archived projects</span></label><label class="check-row"><input name="trash" type="checkbox"><span>Recovery bin</span></label><button>Search library</button></form><p class="help">Files are normalized WebP. Trashed images remain recoverable for 30 days, count toward storage, and are permanently removed only by maintenance. Active generation or assessment prevents deletion.</p></details><div id="library-toolbar" class="result-actions"><span id="library-count" role="status">0 selected</span><button id="library-select" class="secondary">Select loaded</button><button id="library-view" class="secondary">List view</button><label>Move to<select id="library-move"><option value="">Unassigned</option></select></label><button id="library-organize" class="secondary">Move selected</button><button id="library-delete" class="danger">Trash selected</button><button id="library-restore" class="secondary">Restore selected</button><button id="library-download" class="secondary">Download links</button></div><div id="library-results" class="library-grid" aria-live="polite"></div><button id="library-more" class="secondary" hidden>Load more</button><section class="panel"><h2>Project organization</h2><form id="library-create"><label>Project name<input name="name" maxlength="100" required></label><label>Workflow<select name="audience"><option value="ecommerce">Products</option><option value="professional">Professional</option><option value="individual">Personal</option></select></label><button>Create project</button></form><div id="library-projects"></div></section><dialog id="library-dialog"><button id="library-close" class="secondary">Close preview</button><div id="library-preview"></div><div id="library-history"></div></dialog>';
  page.querySelector(".library-filter-panel").open =
    window.matchMedia("(min-width:701px)").matches;
  const bulk = el("div", null, "result-actions");
  bulk.id = "library-bulk";
  bulk.hidden = true;
  bulk.append(
    page.querySelector("#library-move").parentElement,
    ...["organize", "delete", "restore", "download"].map((key) =>
      page.querySelector(`#library-${key}`),
    ),
  );
  page.querySelector("#library-toolbar").append(bulk);
  const notice = page.querySelector("#library-notice"),
    form = page.querySelector("#library-filters"),
    results = page.querySelector("#library-results"),
    more = page.querySelector("#library-more"),
    selected = new Set();
  let mutating = false;
  let offset = 0,
    next = null,
    epoch = 0,
    images = [],
    list = false;
  function message(text) {
    notice.textContent = text.message ?? text;
  }
  const cap = await api("/library/capabilities");
  if (!cap.available) {
    message(
      "Image management requires the Phase 7 database migration. Existing project uploads remain available.",
    );
    return;
  }
  async function projects() {
    const currentProject = form.elements.project_id.value;
    const r = await api("/library/projects");
    form.elements.project_id.replaceChildren();
    option(form.elements.project_id, "All projects", "");
    option(form.elements.project_id, "Unassigned", "unassigned");
    const move = page.querySelector("#library-move");
    move.replaceChildren();
    option(move, "Unassigned", "");
    const container = page.querySelector("#library-projects");
    container.replaceChildren();
    for (const p of r.projects) {
      option(
        form.elements.project_id,
        `${p.name}${p.archived ? " (archived)" : ""}`,
        p.id,
      );
      if (!p.archived) option(move, p.name, p.id);
      const row = el("article", null, "library-project-row");
      const open = el("a", `${p.name}${p.archived ? " · Archived" : ""}`);
      open.href = `/app/library?project_id=${p.id}${p.archived ? "&archived=1" : ""}`;
      row.append(
        open,
        button("Rename", async () => {
          const name = prompt("New project name", p.name);
          if (!name) return;
          await projectAction(p.id, "rename", name);
        }),
        button(p.archived ? "Restore project" : "Archive project", () =>
          projectAction(p.id, p.archived ? "restore" : "archive"),
        ),
        button(
          "Delete empty project",
          async () => {
            if (
              !confirm(
                "Delete this empty project? Source records and images must be removed first; archive it to retain them.",
              )
            )
              return;
            await projectAction(p.id, "delete");
          },
          "danger",
        ),
      );
      container.append(row);
    }
    if (
      Array.from(form.elements.project_id.options).some(
        (o) => o.value === currentProject,
      )
    )
      form.elements.project_id.value = currentProject;
  }
  async function projectAction(id, action, value) {
    try {
      await api(`/library/projects/${id}`, {
        method: "POST",
        body: JSON.stringify({ action, ...(value ? { value } : {}) }),
      });
      await projects();
      await load();
    } catch (e) {
      message(e);
    }
  }
  function selection() {
    bulk.hidden = selected.size === 0;
    page.querySelector("#library-count").textContent =
      `${selected.size} selected`;
  }
  function query() {
    const p = new URLSearchParams();
    for (const [k, v] of new FormData(form)) {
      if (!v) continue;
      if (k === "after" || k === "before")
        p.set(k, `${v}T${k === "before" ? "23:59:59.999" : "00:00:00.000"}Z`);
      else if (k === "project_id" && v === "unassigned")
        p.set("unassigned", "1");
      else p.set(k, v === "on" ? "1" : v);
    }
    return p;
  }
  async function action(kind, value) {
    if (mutating) return;
    if (!selected.size) {
      message("Select at least one image.");
      return;
    }
    if (
      kind === "trash" &&
      !confirm(
        `Move ${selected.size} selected images to the recovery bin? Related outputs and accounting history are retained. Active work will prevent this action.`,
      )
    )
      return;
    const ids = [...selected];
    mutating = true;
    results.inert = true;
    const controls = page.querySelectorAll(
      "#library-toolbar button,#library-toolbar select",
    );
    controls.forEach((c) => (c.disabled = true));
    try {
      await api("/library/actions", {
        method: "POST",
        body: JSON.stringify({
          ids,
          action: kind,
          ...(value !== undefined ? { value } : {}),
        }),
      });
      message(`${ids.length} images updated.`);
      selected.clear();
      await load();
    } catch (e) {
      message(e);
    } finally {
      mutating = false;
      results.inert = false;
      controls.forEach((c) => (c.disabled = false));
    }
  }
  function card(image) {
    const article = el("article", null, "library-card");
    const label = el("label", null, "check-row"),
      check = el("input");
    check.type = "checkbox";
    check.checked = selected.has(image.id);
    check.setAttribute("aria-label", `Select ${image.filename}`);
    check.onchange = () => {
      check.checked ? selected.add(image.id) : selected.delete(image.id);
      selection();
    };
    label.append(check, el("strong", image.filename));
    article.append(label);
    if (!image.trashed_at) {
      const img = el("img");
      img.src = `/api/library/${image.id}/thumbnail`;
      img.loading = "lazy";
      img.width = 240;
      img.height = 200;
      img.alt = image.filename;
      img.onerror = () => {
        img.alt = "Preview unavailable. Open the image to retry.";
      };
      article.append(img);
    } else article.append(el("p", "In recovery bin"));
    article.append(
      el(
        "p",
        `${image.role === "original" ? "Original upload" : "Generated output"} · ${image.width} × ${image.height} · WebP`,
        "help",
      ),
      el(
        "p",
        `${image.project_name ?? "Unassigned"} · ${new Date(image.created_at).toLocaleDateString()}`,
        "help",
      ),
      el(
        "p",
        `${image.mode ?? "Upload"} · Generation: ${image.processing_status ?? image.image_status} · Assessment: ${image.quality_state ?? "none"}${image.quality_status ? ` (${image.quality_status.replaceAll("_", " ")})` : ""} · Decision: ${image.user_decision ?? "none"}`,
        "help",
      ),
    );
    if (!image.trashed_at) {
      if (image.role === "original") {
        const enhance = el("a", "Enhance this original");
        enhance.href = `/app/edit/${image.id}`;
        article.append(enhance);
      }
      article.append(
        button("Preview & versions", () => preview(image)),
        button("Rename", async () => {
          const name = prompt("Image filename", image.filename);
          if (!name) return;
          try {
            await api("/library/actions", {
              method: "POST",
              body: JSON.stringify({
                ids: [image.id],
                action: "rename",
                value: name,
              }),
            });
            await load();
          } catch (e) {
            message(e);
          }
        }),
      );
      const a = el("a", "Download");
      a.href = `/api/images/${image.id}/content?download=1`;
      article.append(a);
    }
    if (image.pack_id) {
      const a = el("a", "Open image pack");
      a.href = `/app/packs/${image.pack_id}`;
      article.append(a);
    }
    if (image.batch_id) {
      const a = el("a", "Open batch");
      a.href = `/app/batches/${image.batch_id}`;
      article.append(a);
    }
    return article;
  }
  async function load(append = false) {
    const version = ++epoch;
    more.disabled = true;
    if (!append) {
      offset = 0;
      images = [];
      selected.clear();
      results.replaceChildren(el("p", "Loading your library…"));
    }
    selection();
    try {
      const p = query();
      p.set("offset", String(offset));
      const r = await api(`/library?${p}`);
      if (version !== epoch) return;
      next = r.next_offset;
      images = append ? [...images, ...r.images] : r.images;
      results.replaceChildren();
      for (const image of images) results.append(card(image));
      if (!images.length)
        results.append(
          el(
            "p",
            "No images match these filters. Upload a photograph or change the search.",
            "empty",
          ),
        );
      more.hidden = next === null;
    } catch (e) {
      if (version === epoch) {
        message(e);
        if (!images.length)
          results.replaceChildren(
            el("p", "The library could not load. Use Search library to retry."),
          );
      }
    } finally {
      if (version === epoch) more.disabled = false;
    }
  }
  const dialog = page.querySelector("dialog");
  page.querySelector("#library-close").onclick = () => dialog.close();
  async function preview(image) {
    const slot = page.querySelector("#library-preview"),
      history = page.querySelector("#library-history");
    slot.replaceChildren(el("h2", image.filename));
    history.replaceChildren();
    const img = el("img");
    img.src = `/api/images/${image.id}/content`;
    img.alt = image.filename;
    slot.append(img);
    dialog.showModal();
    let historyOffset = 0;
    const loadHistory = async () => {
      try {
        const r = await api(
          `/library/${image.id}/history?offset=${historyOffset}`,
        );
        for (const j of r.jobs) {
          const item = el("article", null, "library-version");
          item.append(
            el(
              "p",
              `${j.mode} · ${j.status} · ${j.quality_state} · ${j.user_decision} · ${new Date(j.created_at).toLocaleString()}`,
            ),
          );
          const link = el("a", "Compare original and result / review");
          link.href = `/app/edits/${j.id}`;
          item.append(link);
          if (j.pack_id) {
            const pack = el("a", "Open this pack version");
            pack.href = `/app/packs/${j.pack_id}`;
            item.append(pack);
          }
          history.append(item);
        }
        if (r.next_offset !== null) {
          const b = button("More versions", async () => {
            b.remove();
            historyOffset = r.next_offset;
            await loadHistory();
          });
          history.append(b);
        }
        if (!r.jobs.length && historyOffset === 0)
          history.append(
            el("p", "No generated versions are associated with this image."),
          );
      } catch (e) {
        history.append(el("p", e.message));
      }
    };
    await loadHistory();
  }
  form.onsubmit = (e) => {
    e.preventDefault();
    load();
  };
  more.onclick = () => {
    offset = next;
    load(true);
  };
  page.querySelector("#library-select").onclick = () => {
    for (const image of images) selected.add(image.id);
    results.replaceChildren(...images.map(card));
    selection();
  };
  page.querySelector("#library-view").onclick = (e) => {
    list = !list;
    results.className = list ? "library-list" : "library-grid";
    e.target.textContent = list ? "Grid view" : "List view";
  };
  page.querySelector("#library-organize").onclick = () =>
    action("move", page.querySelector("#library-move").value || null);
  page.querySelector("#library-delete").onclick = () => action("trash");
  page.querySelector("#library-restore").onclick = () => action("restore");
  page.querySelector("#library-download").onclick = () => {
    if (!selected.size) {
      message("Select images first.");
      return;
    }
    const box = el("div");
    for (const image of images.filter(
      (i) => selected.has(i.id) && !i.trashed_at,
    )) {
      const a = el("a", `Download ${image.filename}`);
      a.href = `/api/images/${image.id}/content?download=1`;
      const p = el("p");
      p.append(a);
      box.append(p);
    }
    notice.replaceChildren(box);
  };
  page.querySelector("#library-create").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const f = e.target;
      await api("/projects", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(f))),
      });
      f.reset();
      await projects();
      message("Project created.");
    } catch (err) {
      message(err);
    }
  };
  await projects();
  const params = new URLSearchParams(location.search);
  if (params.get("project_id"))
    form.elements.project_id.value = params.get("project_id");
  form.elements.archived.checked = params.get("archived") === "1";
  await load();
}
