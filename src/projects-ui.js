import "./projects-workspace.css";
const workflows = {
  ecommerce: "Products",
  professional: "Professional",
  individual: "Personal",
};
const drawings = {
  folder: '<path d="M3 7h7l2 2h9v11H3z"/><path d="M3 7V4h7l2 3"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  list: '<path d="M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  arrow: '<path d="M6 18 18 6M6 6h12v12"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
};
function node(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
function icon(name) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = drawings[name];
  return s;
}
function link(text, href, cls) {
  const a = node("a", text, cls);
  a.href = href;
  return a;
}
function button(text, action, cls = "secondary") {
  const b = node("button", text, cls);
  b.type = "button";
  b.onclick = action;
  return b;
}
function relative(value) {
  const difference = Math.max(0, Date.now() - Date.parse(value));
  if (!Number.isFinite(difference)) return "Not available";
  const days = Math.floor(difference / 86400000),
    hours = Math.floor(difference / 3600000),
    minutes = Math.floor(difference / 60000);
  return days > 30
    ? new Date(value).toLocaleDateString()
    : days
      ? `${days}d ago`
      : hours
        ? `${hours}h ago`
        : minutes
          ? `${minutes}m ago`
          : "Just now";
}
export async function projectDirectory({ api, shell, audience }) {
  const page = shell("projects");
  page.classList.add("projects-workspace");
  page.closest(".workspace-layout")?.classList.add("projects-screen");
  page.innerHTML = `<header class="page-heading projects-heading"><div><p class="eyebrow">PRODUCTION WORKSPACE</p><h1>Your projects</h1><p>Organize originals, guide production and keep every result connected.</p></div><button id="project-new" type="button">+ New project</button></header>
  <div id="page-notice" class="notice" role="status"></div>
  <section class="projects-overview" aria-label="Workspace overview"><div><span>Active projects</span><strong id="projects-active">—</strong></div><div><span>Project assets</span><strong id="projects-assets">—</strong><small>Ready files · excludes recovery bin</small></div><div><span>Archived projects</span><strong id="projects-archived">—</strong></div><a href="/app/library">Open image library <span aria-hidden="true">↗</span></a></section>
  <section class="projects-directory" aria-label="Project directory"><header class="projects-directory-heading"><div><h2>Project directory</h2><span id="projects-count" role="status">Loading projects…</span></div><button type="button" class="secondary" id="projects-refresh">Refresh</button></header>
  <div class="projects-toolbar"><label class="projects-search"><span class="projects-sr">Search projects</span><input type="search" id="projects-search" placeholder="Search projects…" maxlength="100"></label><label><span class="projects-sr">Workflow filter</span><select id="projects-workflow" aria-label="Workflow filter"><option value="">All workflows</option><option value="ecommerce">Products</option><option value="professional">Professional</option><option value="individual">Personal</option></select></label><label><span class="projects-sr">Project state</span><select id="projects-state" aria-label="Project state"><option value="active">Active projects</option><option value="archived">Archived projects</option><option value="all">All projects</option></select></label><label><span class="projects-sr">Sort projects</span><select id="projects-sort" aria-label="Sort projects"><option value="activity">Recent activity</option><option value="name">Alphabetical</option><option value="volume">Most assets</option><option value="created">Newest created</option></select></label><div class="projects-views" role="group" aria-label="Project layout"><button type="button" class="secondary" id="projects-grid" aria-label="Grid view" aria-pressed="true"></button><button type="button" class="secondary" id="projects-list" aria-label="List view" aria-pressed="false"></button></div></div>
  <div id="projects-results" class="projects-grid" aria-live="polite" aria-busy="true"></div><footer class="projects-directory-foot"><span>Private to your account</span><a href="/app/billing">Plan & storage usage ↗</a></footer></section>
  <dialog class="projects-dialog" id="project-editor" aria-labelledby="project-editor-title"><header><div><span class="projects-micro">PROJECT SETTINGS</span><h2 id="project-editor-title">New project</h2></div><button type="button" class="secondary" data-close-editor aria-label="Close project settings">×</button></header><form><label>Project name<input name="name" required maxlength="100" placeholder="e.g. Autumn product collection"></label><label id="project-workflow-label">Workflow<select name="audience"><option value="ecommerce">E-commerce products</option><option value="professional">Professional imagery</option><option value="individual">Personal photographs</option></select></label><p id="project-editor-help">A private home for your originals and saved results. Creating a project does not start generation or use processing units.</p><div class="notice" role="status"></div><footer><button type="button" class="secondary" data-close-editor>Cancel</button><button type="submit">Create project</button></footer></form></dialog>
  <dialog class="projects-dialog" id="project-confirm" aria-labelledby="project-confirm-title"><header><h2 id="project-confirm-title">Archive project</h2><button type="button" class="secondary" data-close-confirm aria-label="Close archive confirmation">×</button></header><p id="project-confirm-description"></p><div class="notice" role="alert"></div><footer><button type="button" class="secondary" data-close-confirm>Cancel</button><button type="button" id="project-confirm-action">Archive project</button></footer></dialog>
  <dialog class="projects-dialog" id="project-exports" aria-labelledby="project-exports-title"><header><h2 id="project-exports-title">Production exports</h2><button type="button" class="secondary" data-close-exports aria-label="Close production exports">×</button></header><p>ZIP downloads are available for approved image packs and batches. A full-project archive is not available. Individual asset downloads are in the image library.</p><div id="project-export-links"></div></dialog>`;
  page.querySelector(".projects-search").prepend(icon("search"));
  page.querySelector("#projects-grid").append(icon("grid"));
  page.querySelector("#projects-list").append(icon("list"));
  const results = page.querySelector("#projects-results"),
    notice = page.querySelector("#page-notice"),
    editor = page.querySelector("#project-editor"),
    confirmDialog = page.querySelector("#project-confirm");
  let rows = [],
    loaded = false,
    failed = false,
    epoch = 0,
    editing = null,
    pendingAction = null,
    saving = false,
    list = false;
  function tell(target, text, error = false) {
    target.textContent = text;
    target.className = `notice${error ? " error" : ""}`;
    target.setAttribute("role", error ? "alert" : "status");
  }
  function closeMenus() {
    page
      .querySelectorAll(".project-actions[open]")
      .forEach((d) => (d.open = false));
  }
  page.addEventListener("click", (e) => {
    if (!e.target.closest(".project-actions")) closeMenus();
  });
  page.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenus();
  });
  function openEditor(project = null) {
    closeMenus();
    editing = project;
    const f = editor.querySelector("form");
    f.reset();
    f.elements.name.value = project?.name || "";
    f.elements.audience.value = audience || "individual";
    page.querySelector("#project-workflow-label").hidden = !!project;
    page.querySelector("#project-editor-title").textContent = project
      ? "Rename project"
      : "New project";
    f.querySelector("[type=submit]").textContent = project
      ? "Save changes"
      : "Create project";
    page.querySelector("#project-editor-help").textContent = project
      ? "Rename this project without changing its photographs or production history."
      : "A private home for your originals and saved results. Creating a project does not start generation or use processing units.";
    tell(f.querySelector(".notice"), "");
    editor.showModal();
    f.elements.name.focus();
  }
  page.querySelector("#project-new").onclick = () => openEditor();
  page.querySelectorAll("[data-close-editor]").forEach(
    (b) =>
      (b.onclick = () => {
        if (!saving) editor.close();
      }),
  );
  editor.addEventListener("cancel", (e) => {
    if (saving) e.preventDefault();
  });
  function confirmArchive(p) {
    closeMenus();
    pendingAction = p;
    const action = p.archived ? "Restore" : "Archive";
    page.querySelector("#project-confirm-title").textContent =
      `${action} project`;
    page.querySelector("#project-confirm-action").textContent =
      `${action} project`;
    page.querySelector("#project-confirm-description").textContent = p.archived
      ? `Restore “${p.name}” to the active directory. Its saved files and history stay intact.`
      : `Archive “${p.name}”? It will be hidden from active project lists. Saved files and production history remain available, and you can restore it later.`;
    tell(confirmDialog.querySelector(".notice"), "");
    confirmDialog.showModal();
  }
  page.querySelectorAll("[data-close-confirm]").forEach(
    (b) =>
      (b.onclick = () => {
        if (!saving) confirmDialog.close();
      }),
  );
  confirmDialog.addEventListener("cancel", (e) => {
    if (saving) e.preventDefault();
  });
  page.querySelector("[data-close-exports]").onclick = () =>
    page.querySelector("#project-exports").close();
  function exports(p) {
    closeMenus();
    const host = page.querySelector("#project-export-links");
    host.replaceChildren(
      link("Open project packs & results ↗", `/app/projects/${p.id}`),
      link(
        "Open batch history ↗",
        `/app/batches?project=${p.id}#batch-history`,
      ),
      link(
        "Download individual assets ↗",
        `/app/library?project_id=${p.id}${p.archived ? "&archived=1" : ""}`,
      ),
    );
    page.querySelector("#project-exports").showModal();
  }
  function menu(p) {
    const d = node("details", undefined, "project-actions"),
      s = node("summary");
    s.setAttribute("aria-label", `Actions for ${p.name}`);
    s.append(icon("more"));
    d.append(s);
    const m = node("div", undefined, "project-action-menu");
    m.append(
      button("Rename project", () => openEditor(p)),
      link(
        "Browse project assets ↗",
        `/app/library?project_id=${p.id}${p.archived ? "&archived=1" : ""}`,
      ),
      button("Production exports", () => exports(p)),
    );
    if (!p.archived && p.audience === "ecommerce")
      m.append(link("Prepare bulk batch ↗", `/app/batches?project=${p.id}`));
    m.append(
      button(p.archived ? "Restore project" : "Archive project", () =>
        confirmArchive(p),
      ),
    );
    d.append(m);
    d.addEventListener("toggle", () => {
      d.classList.remove("opens-up");
      if (d.open) {
        page.querySelectorAll(".project-actions[open]").forEach((other) => {
          if (other !== d) other.open = false;
        });
        const menuBounds = m.getBoundingClientRect();
        if (
          menuBounds.bottom > innerHeight - 12 &&
          d.getBoundingClientRect().top > menuBounds.height + 12
        )
          d.classList.add("opens-up");
      }
    });
    return d;
  }
  function card(p) {
    const c = node("article", undefined, "project-directory-card");
    c.dataset.projectId = p.id;
    const top = node("div", undefined, "project-card-top"),
      mark = node("span", undefined, "project-folder-mark");
    mark.append(icon("folder"));
    top.append(
      mark,
      node("span", workflows[p.audience] || "Project", "project-workflow"),
      node(
        "span",
        p.archived ? "Archived" : "Active",
        `project-state${p.archived ? " is-archived" : ""}`,
      ),
    );
    const heading = node("h3");
    heading.append(
      link(
        p.name,
        p.archived
          ? `/app/library?project_id=${p.id}&archived=1`
          : `/app/projects/${p.id}`,
      ),
    );
    const identifier = node(
      "span",
      `PROJECT ${p.id.slice(0, 8).toUpperCase()}`,
      "project-fingerprint",
    );
    const body = node("div", undefined, "project-card-meta");
    const amount = node("div", undefined, "project-asset-count");
    amount.append(
      node(
        "strong",
        p.metadata_available ? Number(p.asset_count).toLocaleString() : "—",
      ),
      node("span", "stored assets"),
    );
    const brand = node("div", undefined, "project-brand");
    brand.append(
      node("span", "Latest operation brand"),
      node(
        "strong",
        p.last_operation?.brand?.name ||
          (p.metadata_available
            ? p.last_operation
              ? "No brand applied"
              : "No saved operation"
            : "Metadata unavailable"),
      ),
    );
    if (p.last_operation?.brand?.revision)
      brand.append(
        node("small", `Saved revision ${p.last_operation.brand.revision}`),
      );
    else brand.append(node("small", "Configured per product edit"));
    body.append(amount, brand);
    const bottom = node("footer");
    const activity = node("div", undefined, "project-activity");
    activity.append(
      node(
        "span",
        p.metadata_available
          ? "Last production activity"
          : "Activity unavailable",
      ),
    );
    if (p.last_activity_at) {
      const t = node("time", relative(p.last_activity_at));
      t.dateTime = p.last_activity_at;
      t.title = new Date(p.last_activity_at).toLocaleString();
      activity.append(
        t,
        node(
          "small",
          p.activity_kind === "operation"
            ? `${{ product: "Product edit", portrait: "Headshot", personal: "Personal edit" }[p.last_operation?.mode] || "Saved operation"} · ${{ queued: "Queued", running: "Processing", persisting: "Saving", completed: "Completed", failed: "Failed", cancelled: "Cancelled", uncertain: "Outcome unknown" }[p.last_operation?.status] || "Recorded"}`
            : p.activity_kind === "upload"
              ? "Photograph added"
              : "Project created",
        ),
      );
    } else activity.append(node("strong", "—"));
    bottom.append(activity, menu(p));
    c.append(top, identifier, heading, body, bottom);
    return c;
  }
  function render() {
    results.replaceChildren();
    results.setAttribute("aria-busy", String(!loaded && !failed));
    if (!loaded) {
      const empty = node("div", undefined, "projects-empty");
      empty.append(
        icon("folder"),
        node(
          "h3",
          failed ? "Projects could not be loaded" : "Loading your projects",
        ),
        node(
          "p",
          failed
            ? "Your saved projects have not been changed. Retry to reconnect to the directory."
            : "Retrieving project records and production metadata.",
        ),
      );
      if (failed) empty.append(button("Retry loading projects", load));
      results.append(empty);
      return;
    }
    const search = page
        .querySelector("#projects-search")
        .value.trim()
        .toLowerCase(),
      workflow = page.querySelector("#projects-workflow").value,
      state = page.querySelector("#projects-state").value,
      sort = page.querySelector("#projects-sort").value;
    const shown = rows.filter(
      (p) =>
        (state === "all" || p.archived === (state === "archived")) &&
        (!workflow || p.audience === workflow) &&
        p.name.toLowerCase().includes(search),
    );
    shown.sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "volume"
          ? (b.asset_count ?? -1) - (a.asset_count ?? -1) ||
            a.name.localeCompare(b.name)
          : sort === "created"
            ? Date.parse(b.created_at) - Date.parse(a.created_at)
            : Date.parse(b.last_activity_at || b.created_at) -
                Date.parse(a.last_activity_at || a.created_at) ||
              a.name.localeCompare(b.name),
    );
    results.className = list ? "projects-list" : "projects-grid";
    page.querySelector("#projects-count").textContent =
      `${shown.length} of ${rows.length} projects`;
    if (!shown.length) {
      const empty = node("div", undefined, "projects-empty");
      empty.append(
        icon("folder"),
        node(
          "h3",
          !rows.length
            ? "Create your first project"
            : state === "archived" && !search && !workflow
              ? "No archived projects"
              : "No matching projects",
        ),
        node(
          "p",
          !rows.length
            ? "Keep your original photographs and production results together in one private project."
            : "Change the search or filters to see other projects.",
        ),
      );
      empty.append(
        !rows.length
          ? button("+ New project", () => openEditor(), "")
          : button("Reset filters", () => {
              page.querySelector("#projects-search").value = "";
              page.querySelector("#projects-workflow").value = "";
              page.querySelector("#projects-state").value = "active";
              render();
            }),
      );
      results.append(empty);
    } else shown.forEach((p) => results.append(card(p)));
  }
  async function load() {
    const request = ++epoch;
    page.querySelector("#projects-refresh").disabled = true;
    results.setAttribute("aria-busy", "true");
    try {
      const data = await api("/projects/directory");
      if (request !== epoch) return;
      rows = data.projects;
      loaded = true;
      failed = false;
      page.querySelector("#projects-active").textContent = rows.filter(
        (p) => !p.archived,
      ).length;
      page.querySelector("#projects-archived").textContent = rows.filter(
        (p) => p.archived,
      ).length;
      page.querySelector("#projects-assets").textContent = rows.every(
        (p) => p.metadata_available,
      )
        ? rows.reduce((n, p) => n + p.asset_count, 0).toLocaleString()
        : "—";
      tell(
        notice,
        rows.some((p) => !p.metadata_available)
          ? "Some production metadata could not be loaded. Project links remain available; refresh to retry."
          : "",
      );
      render();
    } catch (e) {
      if (request !== epoch) return;
      failed = true;
      tell(notice, e.message, true);
      if (!loaded)
        page.querySelector("#projects-count").textContent =
          "Directory unavailable";
      render();
    } finally {
      if (request === epoch) {
        page.querySelector("#projects-refresh").disabled = false;
        results.setAttribute("aria-busy", "false");
      }
    }
  }
  editor.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    if (saving) return;
    const form = e.currentTarget,
      name = form.elements.name.value.trim();
    if (!name) {
      form.elements.name.setCustomValidity("Enter a project name");
      form.reportValidity();
      return;
    }
    saving = true;
    form.querySelector("[type=submit]").disabled = true;
    form.setAttribute("aria-busy", "true");
    tell(form.querySelector(".notice"), "");
    try {
      if (editing)
        await api(`/library/projects/${editing.id}`, {
          method: "POST",
          body: JSON.stringify({ action: "rename", value: name }),
        });
      else
        await api("/projects", {
          method: "POST",
          body: JSON.stringify({
            name,
            audience: form.elements.audience.value,
          }),
        });
      editor.close();
      await load();
    } catch (error) {
      tell(form.querySelector(".notice"), error.message, true);
    } finally {
      saving = false;
      form.querySelector("[type=submit]").disabled = false;
      form.removeAttribute("aria-busy");
    }
  };
  editor.querySelector("[name=name]").oninput = (e) =>
    e.target.setCustomValidity("");
  page.querySelector("#project-confirm-action").onclick = async () => {
    if (saving || !pendingAction) return;
    saving = true;
    const b = page.querySelector("#project-confirm-action");
    b.disabled = true;
    try {
      await api(`/library/projects/${pendingAction.id}`, {
        method: "POST",
        body: JSON.stringify({
          action: pendingAction.archived ? "restore" : "archive",
        }),
      });
      confirmDialog.close();
      await load();
    } catch (e) {
      tell(confirmDialog.querySelector(".notice"), e.message, true);
    } finally {
      saving = false;
      b.disabled = false;
    }
  };
  for (const id of [
    "projects-search",
    "projects-workflow",
    "projects-state",
    "projects-sort",
  ])
    page
      .querySelector("#" + id)
      .addEventListener(id === "projects-search" ? "input" : "change", render);
  for (const [id, value] of [
    ["projects-grid", false],
    ["projects-list", true],
  ])
    page.querySelector("#" + id).onclick = () => {
      list = value;
      page
        .querySelector("#projects-grid")
        .setAttribute("aria-pressed", String(!list));
      page
        .querySelector("#projects-list")
        .setAttribute("aria-pressed", String(list));
      render();
    };
  page.querySelector("#projects-refresh").onclick = load;
  render();
  await load();
}
