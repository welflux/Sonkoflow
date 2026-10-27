const root = document.querySelector("#workspace");
const signout = document.querySelector("#signout");
const audienceNames = {
  ecommerce: "E-commerce",
  professional: "Professional",
  individual: "Personal",
};
let profile;
async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers:
      options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" },
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
    const button = form.querySelector("button[type=submit]");
    const notice = form.querySelector(".notice");
    button.disabled = true;
    message(notice, "");
    try {
      await handler(new FormData(form), notice);
    } catch (error) {
      message(notice, error.message, true);
    } finally {
      button.disabled = false;
    }
  });
}
function accountPage() {
  const route = location.pathname.split("/").pop();
  const signup = route === "signup";
  const recovery = route === "recover";
  const reset = route === "reset";
  const confirm = route === "confirm";
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get("token_hash");
  const type = params.get("type");
  if (location.hash) history.replaceState(null, "", location.pathname);
  const title = signup
    ? "Create your account"
    : recovery
      ? "Reset your password"
      : reset
        ? "Choose a new password"
        : confirm
          ? "Confirm your email"
          : "Welcome back";
  root.innerHTML = `<div class="account-layout"><div class="account-intro"><p class="eyebrow">YOUR PHOTOGRAPHS. YOUR WORKSPACE.</p><h1>A considered place<br>for every image.</h1><p>Organize projects and securely store your original photographs. Start with the way you work: products, professional imagery, or personal memories.</p><div class="account-art"><span aria-hidden="true">✦</span><p>The foundation comes first.<br>AI editing and paid plans are not available yet.</p></div></div><section class="panel"><h2>${title}</h2><p>${signup ? "Verify your email to open a private photo workspace." : recovery ? "We’ll send a single-use recovery link to your email." : reset ? "Use at least 12 characters. You’ll sign in again after updating." : confirm ? "Continue to verify this single-use email link." : "Sign in to your projects and photographs."}</p><form id="account-form">${!reset && !confirm ? '<label>Email address<input name="email" type="email" autocomplete="email" required maxlength="254"></label>' : ""}${!recovery && !confirm ? `<label>Password<input name="password" type="password" minlength="12" maxlength="128" autocomplete="${signup || reset ? "new-password" : "current-password"}" required></label>` : ""}${signup ? '<p class="help">Use at least 12 characters. No image generation or payment is included. Do not upload sensitive photographs until the owner publishes the privacy and retention policies.</p>' : ""}<div class="notice" role="status"></div><button type="submit">${signup ? "Create account" : recovery ? "Send recovery email" : reset ? "Save password" : confirm ? "Confirm email" : "Sign in"}</button></form><nav class="account-links" aria-label="Account options"><a href="/account/${signup ? "signin" : "signup"}">${signup ? "Already have an account? Sign in" : "Create an account"}</a><a href="/account/recover">Forgot password?</a><a href="/">Back to SONKOFLOW</a></nav></section></div>`;
  bindForm(root.querySelector("form"), async (data, notice) => {
    const body = Object.fromEntries(data);
    if (confirm) {
      if (!token || !type)
        throw new Error(
          "This link is missing its confirmation token. Request a new email.",
        );
      const result = await api("/auth/confirm", {
        method: "POST",
        body: JSON.stringify({ token_hash: token, type }),
      });
      location.assign(result.recovery ? "/account/reset" : "/app");
      return;
    }
    const endpoint = signup
      ? "signup"
      : recovery
        ? "recover"
        : reset
          ? "password"
          : "signin";
    const result = await api(`/auth/${endpoint}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (signup || recovery) {
      message(notice, result.message);
      return;
    }
    location.assign(reset ? "/account/signin" : "/app");
  });
}
function shell(active) {
  root.innerHTML = `<div class="workspace-layout"><nav class="sidebar" aria-label="Workspace"><p>YOUR WORKSPACE</p><a href="/app" ${active === "projects" ? 'aria-current="page"' : ""}>▦ &nbsp; Projects</a><a href="/app/profile" ${active === "profile" ? 'aria-current="page"' : ""}>◉ &nbsp; Account profile</a><a href="/">↗ &nbsp; Product website</a><p class="scope-note">Private originals, organized.<br>AI processing is not available in this phase.</p></nav><section class="workspace-content"><div id="page"></div></section></div>`;
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
  const page = shell("projects");
  page.innerHTML =
    '<div class="page-heading"><div><p class="eyebrow">A PLACE TO BEGIN</p><h1>Your projects</h1><p>Keep original photographs organized around your work.</p></div></div><div id="page-notice" class="notice"></div><section class="panel compact-form"><h2>Create a project</h2><form><div class="inline-row"><label>Project name<input name="name" required maxlength="100" placeholder="e.g. Autumn collection"></label><label>Workflow<select name="audience"><option value="ecommerce">E-commerce products</option><option value="professional">Professional imagery</option><option value="individual">Personal photographs</option></select></label></div><div class="notice"></div><button type="submit">Create project</button></form></section><div id="projects"></div>';
  page.querySelector("select").value = profile.audience;
  bindForm(page.querySelector("form"), async (data) => {
    await api("/projects", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(data)),
    });
    await projectsPage();
  });
  const result = await api("/projects");
  const list = page.querySelector("#projects");
  if (!result.projects.length) {
    list.innerHTML =
      '<div class="empty"><span aria-hidden="true">⌑</span><h2>Your next chapter starts here.</h2><p>Create a project to upload and organize your photographs.</p></div>';
    return;
  }
  list.className = "project-grid";
  for (const project of result.projects) {
    const card = document.createElement("article");
    card.className = "project-card";
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = audienceNames[project.audience];
    const link = document.createElement("a");
    link.href = `/app/projects/${project.id}`;
    link.textContent = project.name;
    const date = document.createElement("p");
    date.textContent = `Created ${new Date(project.created_at).toLocaleDateString()}`;
    card.append(tag, document.createElement("br"), link, date);
    list.append(card);
  }
}
async function projectPage(id) {
  const page = shell("projects");
  const { projects } = await api("/projects");
  const project = projects.find((item) => item.id === id);
  if (!project) throw new Error("Project not found.");
  page.innerHTML =
    '<a class="breadcrumb" href="/app">← All projects</a><div class="page-heading"><div><p class="eyebrow">ORIGINAL PHOTOGRAPHS</p><h1 id="project-title"></h1><p>Upload, review, and download privately stored originals.</p></div><button class="danger" id="delete-project">Delete empty project</button></div><div id="page-notice" class="notice"></div><section class="panel compact-form"><h2>Add a photograph</h2><p>JPEG, PNG, or WebP · up to 10 MB and 25 megapixels · minimum 64 × 64 pixels. Images are normalized to WebP with metadata removed. This is not AI enhancement.</p><form><label>Photograph<input name="image" type="file" accept="image/jpeg,image/png,image/webp" required></label><p class="help">Private account limit: 100 images and 250 MB. Upload only photographs you have permission to store. Review privacy policies before uploading sensitive content.</p><div class="notice"></div><button type="submit">Upload photograph</button></form></section><div id="images"></div>';
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
  page.querySelector("input[type=file]").addEventListener("change", () => {
    uploadId = crypto.randomUUID();
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
  const list = page.querySelector("#images");
  if (!result.images.length) {
    list.innerHTML =
      '<div class="empty"><span aria-hidden="true">▧</span><h2>A clear canvas.</h2><p>Your uploaded photographs will appear here.</p></div>';
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
      card.append(photo);
    }
    const info = document.createElement("div");
    info.className = "image-info";
    const title = document.createElement("h3");
    title.textContent = image.filename;
    const meta = document.createElement("p");
    meta.textContent = `${image.width} × ${image.height} · ${Math.ceil(image.byte_size / 1024)} KB · ${image.status}`;
    const actions = document.createElement("div");
    actions.className = "image-actions";
    if (image.status === "ready") {
      const download = document.createElement("a");
      download.href = `/api/images/${image.id}/content?download=1`;
      download.textContent = "Download WebP ↓";
      actions.append(download);
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
    info.append(title, meta, actions);
    card.append(info);
    list.append(card);
  }
}
async function profilePage() {
  const page = shell("profile");
  page.innerHTML =
    '<div class="page-heading"><div><p class="eyebrow">YOUR PERSPECTIVE</p><h1>Account profile</h1><p>Choose the workflow that best fits your photographs.</p></div></div><div id="page-notice" class="notice"></div><section class="panel profile-form"><form><label>Display name<input name="display_name" maxlength="100" autocomplete="name"></label><label>Primary workflow<select name="audience"><option value="ecommerce">E-commerce products</option><option value="professional">Professional imagery</option><option value="individual">Personal photographs</option></select></label><div class="notice"></div><button type="submit">Save profile</button></form><p class="help">To change your password, sign out and request a password recovery email.</p></section>';
  page.querySelector("input").value = profile.display_name;
  page.querySelector("select").value = profile.audience;
  bindForm(page.querySelector("form"), async (data, notice) => {
    const result = await api("/profile", {
      method: "PATCH",
      body: JSON.stringify(Object.fromEntries(data)),
    });
    profile = result.profile;
    message(notice, "Your profile has been saved.");
  });
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
    if (location.pathname === "/app/profile") await profilePage();
    else if (/^\/app\/projects\/[a-f0-9-]{36}$/.test(location.pathname))
      await projectPage(location.pathname.split("/").pop());
    else await projectsPage();
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
