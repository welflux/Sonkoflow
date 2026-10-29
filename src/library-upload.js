// Private original uploads only. No generation or allowance operation is started here.
export function libraryUploads({ dialog, api, projects, onComplete, message }) {
  let rows = [],
    busy = false;
  const form = dialog.querySelector("form"),
    select = form.elements.project,
    files = form.elements.files,
    queue = dialog.querySelector(".library-upload-queue"),
    submit = form.querySelector("[type=submit]"),
    feedback = dialog.querySelector("[role=status]");
  function render() {
    queue.replaceChildren();
    for (const row of rows) {
      const line = document.createElement("div");
      line.className = "library-upload-row";
      const name = document.createElement("strong");
      name.textContent = row.file.name;
      const status = document.createElement("span");
      status.textContent = row.saved
        ? "Uploaded privately"
        : row.uploading
          ? "Uploading…"
          : row.error || "Ready";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "library-quiet";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${row.file.name}`);
      remove.disabled = busy;
      remove.onclick = () => {
        rows = rows.filter((r) => r !== row);
        render();
      };
      line.append(name, status, remove);
      queue.append(line);
    }
    submit.disabled =
      busy ||
      !select.value ||
      !rows.length ||
      rows.some((r) => r.invalid) ||
      rows.every((r) => r.saved);
    submit.textContent = busy ? "Uploading…" : "Upload originals";
  }
  function add(incoming) {
    if (busy) return;
    if (rows.length + incoming.length > 10) {
      feedback.textContent =
        "Choose up to 10 photographs per upload. No files from this selection were added.";
      return;
    }
    for (const file of incoming) {
      const invalid = !["image/jpeg", "image/png", "image/webp"].includes(
        file.type,
      )
        ? "Choose JPEG, PNG or WebP"
        : file.size > 10485760
          ? "Exceeds 10 MB per photograph"
          : null;
      rows.push({
        file,
        id: crypto.randomUUID(),
        saved: false,
        invalid,
        error: invalid,
      });
    }
    render();
  }
  files.onchange = () => {
    add([...files.files]);
    files.value = "";
  };
  select.onchange = () => {
    if (rows.some((r) => r.saved)) {
      rows = [];
      feedback.textContent =
        "Uploaded originals remain in their previous project. Choose files for this project.";
    }
    render();
  };
  for (const close of dialog.querySelectorAll("[data-close-upload]"))
    close.onclick = () => {
      if (!busy) dialog.close();
    };
  dialog.addEventListener("cancel", (e) => {
    if (busy) e.preventDefault();
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (submit.disabled || busy) return;
    busy = true;
    select.disabled = true;
    files.disabled = true;
    feedback.textContent = "";
    render();
    const project = select.value;
    let uploaded = 0;
    try {
      for (const row of rows) {
        if (row.saved) continue;
        row.uploading = true;
        row.error = null;
        render();
        const data = new FormData();
        data.set("id", row.id);
        data.set("project_id", project);
        data.set("image", row.file);
        try {
          await api("/images", { method: "POST", body: data });
          row.saved = true;
          uploaded++;
        } catch (error) {
          row.error = error.message;
          row.invalid =
            error.status && error.status < 500 && error.status !== 429;
          throw error;
        } finally {
          row.uploading = false;
          render();
        }
      }
      feedback.textContent = "Your originals have been uploaded privately.";
      await onComplete();
      message("Original photographs uploaded to your project");
    } catch (error) {
      feedback.textContent = error.message;
      if (uploaded) await onComplete();
    } finally {
      busy = false;
      select.disabled = false;
      files.disabled = false;
      render();
    }
  };
  return {
    open(incoming = [], preferred = "") {
      if (busy) return;
      rows = [];
      feedback.textContent = "";
      select.replaceChildren();
      const first = document.createElement("option");
      first.value = "";
      first.textContent = "Choose a project";
      select.append(first);
      for (const p of projects().filter((p) => !p.archived)) {
        const o = document.createElement("option");
        o.value = p.id;
        o.textContent = p.name;
        select.append(o);
      }
      if ([...select.options].some((o) => o.value === preferred))
        select.value = preferred;
      if (!select.value && select.options.length === 2)
        select.selectedIndex = 1;
      add(incoming);
      render();
      if (!dialog.open) dialog.showModal();
    },
    get busy() {
      return busy;
    },
  };
}
