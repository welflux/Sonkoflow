import { accountFetch } from "./auth-request.js";
import { profilePage as renderProfilePage } from "./profile-ui.js";
import { accountPage as renderAccountPage } from "./auth-ui.js";
import { checkoutPage, billingPage, welcomePage } from "./billing-ui.js";
import { libraryPage } from "./library-ui.js";
import { projectDirectory } from "./projects-ui.js";
import { productionHub } from "./production-hub.js";
import { batchesPage, batchPage } from "./batches-ui.js";
import { brandStudio } from "./brand-ui.js";
import { packEditor, packResult, projectPacks } from "./packs-ui.js";
import {
  processingEditor,
  processingResult,
  projectProcessing,
} from "./processing-ui.js";
const root = document.querySelector("#workspace");
const signout = document.querySelector("#signout");
const audienceNames = {
  ecommerce: "E-commerce",
  professional: "Professional",
  individual: "Personal",
};
let profile;
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  arrow: '<path d="M6 18 18 6M6 6h12v12"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
let previewUrl;
function releasePreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = undefined;
}
window.addEventListener("pagehide", releasePreview);
async function api(path, options = {}) {
  const response = await accountFetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
    credentials: "same-origin",
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(
      data.error?.message || "Unable to complete the request.",
    );
    error.status = response.status;
    error.code = data.error?.code;
    throw error;
  }
  return data;
}
function message(target, text, isError = false) {
  target.textContent = text;
  target.className = `notice${isError ? " error" : ""}`;
  target.setAttribute("role", isError ? "alert" : "status");
}
function bindForm(form, handler) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.getAttribute("aria-busy") === "true") return;
    const button = form.querySelector("button[type=submit]");
    const notice = form.querySelector(".notice");
    button.disabled = true;
    const label = button.textContent;
    button.textContent = "Working…";
    form.setAttribute("aria-busy", "true");
    message(notice, "");
    try {
      await handler(new FormData(form), notice);
    } catch (error) {
      message(notice, error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = label;
      form.removeAttribute("aria-busy");
    }
  });
}
function accountPage() {
  renderAccountPage({ root, api, bindForm, message });
}
function shell(active) {
  releasePreview();
  root.innerHTML = `<div class="workspace-layout"><nav class="sidebar" aria-label="Workspace"><p>Your workspace</p><a href="/app" ${active === "projects" ? 'aria-current="page"' : ""}>${icon("grid")} Projects</a><a href="/app/production-hub" ${active === "hub" ? 'aria-current="page"' : ""}>${icon("spark")} Production Hub</a><a href="/app/library" ${active === "library" ? 'aria-current="page"' : ""}>${icon("grid")} Image library</a><a href="/app/batches" ${active === "batches" ? 'aria-current="page"' : ""}>${icon("grid")} Bulk processing</a><a href="/app/brands" ${active === "brands" ? 'aria-current="page"' : ""}>${icon("grid")} Brand Studio</a><a href="/app/billing" ${active === "billing" ? 'aria-current="page"' : ""}>${icon("grid")} Plan & usage</a><a href="/app/profile" ${active === "profile" ? 'aria-current="page"' : ""}>${icon("person")} Account profile</a><a href="/">${icon("arrow")} Product website</a></nav><section class="workspace-content"><div id="page"></div></section></div>`;
  signout.hidden = false;
  signout.onclick = async () => {
    signout.disabled = true;
    try {
      await api("/auth/signout", { method: "POST", body: "{}" });
      location.assign("/account/signin");
    } catch (error) {
      message(document.querySelector("#page-notice"), error.message, true);
      signout.disabled = false;
    }
  };
  return document.querySelector("#page");
}
async function projectsPage() {
  return projectDirectory({ api, shell, audience: profile.audience });
}
async function projectPage(id) {
  const page = shell("projects");
  const { projects } = await api("/projects");
  const project = projects.find((item) => item.id === id);
  if (!project) throw new Error("Project not found.");
  page.innerHTML =
    '<a class="breadcrumb" href="/app">← All projects</a><div class="page-heading"><div><p class="eyebrow">ORIGINAL PHOTOGRAPHS</p><h1 id="project-title"></h1><p>Upload, review, and download privately stored originals.</p></div><button class="danger" id="delete-project">Delete empty project</button></div><div id="page-notice" class="notice"></div><section class="panel upload-panel"><div class="upload-heading"><h2>Add a photograph</h2><p>One image. A new beginning.</p></div><form><label class="dropzone" id="dropzone"><span class="upload-symbol" aria-hidden="true">↑</span><strong>Drop a photograph here, or choose a file</strong><span>JPEG, PNG, or WebP · up to 10 MB</span><input name="image" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Photograph" required></label><div id="upload-preview" class="upload-preview" hidden><img alt="Selected photograph preview"><div><strong id="selected-name"></strong><p id="selected-meta"></p></div></div><p class="help">Maximum 25 megapixels; minimum 64 × 64 pixels. Images are normalized to WebP with metadata removed. No AI enhancement is applied. Your account can store 100 images and 250 MB. Upload only photographs you have permission to store; avoid sensitive content until privacy policies are published.</p><div class="notice" role="status"></div><button type="submit">Upload photograph</button></form></section><h2 class="section-title">Your photographs</h2><div id="images" aria-live="polite"></div>';
  page.querySelector("#project-title").textContent = project.name;
  page.querySelector("#delete-project").onclick = async () => {
    if (!confirm("Delete this empty project? This cannot be undone.")) return;
    try {
      await api(`/projects/${id}`, { method: "DELETE" });
      location.assign("/app");
    } catch (error) {
      message(page.querySelector("#page-notice"), error.message, true);
    }
  };
  let uploadId = crypto.randomUUID();
  const fileInput = page.querySelector("input[type=file]");
  const dropzone = page.querySelector("#dropzone");
  const uploadNotice = page.querySelector("form .notice");
  const selectFile = () => {
    uploadId = crypto.randomUUID();
    releasePreview();
    const preview = page.querySelector("#upload-preview");
    preview.hidden = true;
    message(uploadNotice, "");
    const file = fileInput.files[0];
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      message(
        uploadNotice,
        "Choose a JPEG, PNG, or WebP image no larger than 10 MB.",
        true,
      );
      fileInput.value = "";
      return;
    }
    previewUrl = URL.createObjectURL(file);
    preview.querySelector("img").src = previewUrl;
    page.querySelector("#selected-name").textContent = file.name;
    page.querySelector("#selected-meta").textContent =
      `${Math.ceil(file.size / 1024)} KB · Ready to upload`;
    preview.hidden = false;
  };
  fileInput.addEventListener("change", selectFile);
  for (const type of ["dragenter", "dragover"])
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add("is-dragging");
    });
  for (const type of ["dragleave", "drop"])
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.remove("is-dragging");
    });
  dropzone.addEventListener("drop", (event) => {
    if (page.querySelector("form").getAttribute("aria-busy") === "true") return;
    if (event.dataTransfer.files.length !== 1) {
      message(uploadNotice, "Choose one photograph at a time.", true);
      return;
    }
    fileInput.files = event.dataTransfer.files;
    selectFile();
  });
  bindForm(page.querySelector("form"), async (data, notice) => {
    const image = data.get("image");
    if (image.size > 10 * 1024 * 1024)
      throw new Error("Choose an image no larger than 10 MB.");
    data.set("project_id", id);
    data.set("id", uploadId);
    message(notice, "Uploading your photograph…");
    await api("/images", { method: "POST", body: data });
    await projectPage(id);
  });
  const result = await api(`/images?project_id=${encodeURIComponent(id)}`);
  void projectPacks(api, page, id);
  void projectProcessing(api, page, id).catch((error) => {
    const note = document.createElement("p");
    note.className = "notice error";
    note.setAttribute("role", "alert");
    note.textContent = `Saved edits could not load: ${error.message}`;
    page.querySelector(".processing-history")?.append(note);
  });
  const list = page.querySelector("#images");
  if (!result.images.length) {
    list.innerHTML =
      '<div class="empty"><span class="empty-art" aria-hidden="true">▱</span><h2>A clear canvas.</h2><p>The start of something worth keeping.<br>Your uploaded photographs will appear here.</p></div>';
    return;
  }
  list.className = "image-grid";
  for (const image of result.images) {
    const card = document.createElement("article");
    card.className = "image-card";
    if (image.status === "ready") {
      const photo = document.createElement("img");
      photo.src = `/api/images/${image.id}/content`;
      photo.alt = image.filename;
      photo.loading = "lazy";
      const open = document.createElement("button");
      open.className = "photo-preview-button";
      open.setAttribute("aria-label", `Preview ${image.filename}`);
      open.append(photo);
      open.onclick = () => openImagePreview(image, open);
      card.append(open);
    }
    const info = document.createElement("div");
    info.className = "image-info";
    const title = document.createElement("h3");
    title.textContent = image.filename;
    const meta = document.createElement("p");
    meta.textContent = `${image.width} × ${image.height} · ${Math.ceil(image.byte_size / 1024)} KB`;
    const status = document.createElement("span");
    status.className = "image-status";
    status.textContent =
      {
        ready: "Stored privately",
        pending: "Upload pending",
        deleting: "Deletion pending",
      }[image.status] || image.status;
    const actions = document.createElement("div");
    actions.className = "image-actions";
    if (image.status === "ready") {
      const download = document.createElement("a");
      download.href = `/api/images/${image.id}/content?download=1`;
      download.textContent = "Download WebP ↓";
      actions.append(download);
      if (image.role === "original") {
        const enhance = document.createElement("a");
        enhance.href = `/app/edit/${image.id}`;
        enhance.textContent = "Enhance photograph";
        enhance.className = "enhance-link";
        actions.append(enhance);
        const pack = document.createElement("a");
        pack.href = `/app/packs/new/${image.id}`;
        pack.textContent = "Create image pack";
        pack.className = "enhance-link";
        actions.append(pack);
      }
    }
    const remove = document.createElement("button");
    remove.className = "danger";
    remove.textContent = "Delete";
    remove.onclick = async () => {
      if (!confirm("Permanently delete this photograph?")) return;
      remove.disabled = true;
      try {
        await api(`/images/${image.id}`, { method: "DELETE" });
        await projectPage(id);
      } catch (error) {
        message(page.querySelector("#page-notice"), error.message, true);
        remove.disabled = false;
      }
    };
    actions.append(remove);
    info.append(title, meta, status, actions);
    card.append(info);
    list.append(card);
  }
}
function openImagePreview(image, trigger) {
  const dialog = document.createElement("dialog");
  dialog.className = "image-dialog";
  dialog.setAttribute("aria-labelledby", "preview-title");
  dialog.innerHTML =
    '<div class="dialog-toolbar"><h2 id="preview-title"></h2><button class="secondary" autofocus>Close preview ×</button></div><img class="dialog-photo"><div class="dialog-footer"><p></p><a class="button">Download WebP ↓</a></div>';
  dialog.querySelector("h2").textContent = image.filename;
  const photo = dialog.querySelector("img");
  photo.src = `/api/images/${image.id}/content`;
  photo.alt = image.filename;
  photo.onerror = () => {
    dialog.querySelector("p").textContent =
      "This photograph could not be loaded. Close the preview and try again.";
  };
  dialog.querySelector("p").textContent =
    `${image.width} × ${image.height} · Stored privately`;
  dialog.querySelector("a").href = `/api/images/${image.id}/content?download=1`;
  dialog.querySelector("button").onclick = () => dialog.close();
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        dialog.close();
    }
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    trigger.focus();
  });
  document.body.append(dialog);
  dialog.showModal();
}
async function profilePage() {
  await renderProfilePage({api, shell, profile, onProfile: value => { profile=value; }, message});
}
async function main() {
  if (
    location.pathname.startsWith("/account") ||
    location.pathname === "/app.html"
  ) {
    accountPage();
    return;
  }
  try {
    profile = (await api("/session")).profile;
    if (location.pathname === "/app/checkout") await checkoutPage(api, shell);
    else if (location.pathname === "/app/billing")
      await billingPage(api, shell);
    else if (location.pathname === "/app/welcome")
      await welcomePage(api, shell);
    else if (location.pathname === "/app/production-hub")
      await productionHub(api, shell);
    else if (location.pathname === "/app/library")
      await libraryPage(api, shell);
    else if (location.pathname === "/app/batches")
      await batchesPage(api, shell, new URLSearchParams(location.search).get("project"));
    else if (/^\/app\/batches\/[a-f0-9-]{36}$/.test(location.pathname))
      await batchPage(api, shell, location.pathname.split("/").pop());
    else if (location.pathname === "/app/brands") await brandStudio(api, shell);
    else if (/^\/app\/packs\/new\/[a-f0-9-]{36}$/.test(location.pathname))
      await packEditor(api, shell, location.pathname.split("/").pop());
    else if (/^\/app\/packs\/[a-f0-9-]{36}$/.test(location.pathname))
      await packResult(api, shell, location.pathname.split("/").pop());
    else if (/^\/app\/edit\/[a-f0-9-]{36}$/.test(location.pathname))
      await processingEditor(api, shell, location.pathname.split("/").pop());
    else if (/^\/app\/edits\/[a-f0-9-]{36}$/.test(location.pathname))
      await processingResult(api, shell, location.pathname.split("/").pop());
    else if (location.pathname === "/app/profile") await profilePage();
    else if (/^\/app\/projects\/[a-f0-9-]{36}$/.test(location.pathname))
      await projectPage(location.pathname.split("/").pop());
    else await projectsPage();
    // Workspace sections arrive after session/API reads, after the browser's
    // initial fragment navigation has already run. Resolve that intent now.
    if (location.hash) {
      let target;
      try {
        target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      } catch { /* Ignore malformed fragments without interrupting the page. */ }
      target?.scrollIntoView({ block: "start", behavior: "auto" });
    }
  } catch (error) {
    if (error.status === 401) {
      location.assign("/account/signin");
      return;
    }
    const notice = document.querySelector("#page-notice");
    if (notice) {
      message(notice, error.message, true);
      return;
    }
    root.innerHTML =
      '<section class="panel account-config"><p class="eyebrow">WORKSPACE UNAVAILABLE</p><h1>Let’s get connected.</h1><div class="notice error" role="alert"></div><p>Account and storage services must be configured before the workspace can open.</p><a href="/">Return to SONKOFLOW</a></section>';
    root.querySelector(".notice").textContent = error.message;
  }
}
main();
