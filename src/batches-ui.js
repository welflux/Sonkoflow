import { bulkWorkspace } from "./bulk-workspace.js";
function el(t, text) {
  const n = document.createElement(t);
  if (text) n.textContent = text;
  return n;
}
function note(n, e) {
  n.textContent = e.message ?? e;
  n.className = "notice";
}
export async function batchesPage(api, shell, project) {
  return bulkWorkspace(api, shell, project);
}
export async function batchPage(api, shell, id) {
  const page = shell("batches");
  page.innerHTML =
    '<a href="/app/batches" class="breadcrumb">← All batches</a><div class="page-heading"><h1 id="batch-name">Batch results</h1><button id="batch-cancel" class="danger">Cancel queued work</button></div><p id="batch-progress" role="status"></p><div id="batch-notice" class="notice"></div><div id="batch-download"></div><div id="batch-items" class="pack-gallery"></div>';
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
  const notice = page.querySelector("#batch-notice");
  page.querySelector("#batch-cancel").onclick = async () => {
    if (
      !confirm(
        "Cancel queued outputs? Running requests may finish and incur usage; saved results are retained.",
      )
    )
      return;
    try {
      await api(`/batches/${id}/cancel`, { method: "POST", body: "{}" });
      await refresh();
    } catch (e) {
      note(notice, e);
    }
  };
  async function refresh() {
    if (stopped) return;
    try {
      const r = await api(`/batches/${id}`);
      page.querySelector("#batch-name").textContent = r.batch.name;
      page.querySelector("#batch-progress").textContent =
        `${r.status.replaceAll("_", " ")} · ${r.counts.total} sources · ${r.counts.queued} queued · ${r.counts.processing} processing · ${r.counts.completed} completed · ${r.counts.failed} failed/partial · ${r.counts.cancelled} cancelled`;
      const list = page.querySelector("#batch-items");
      const selected = new Set(
        Array.from(list.querySelectorAll("input:checked")).map((c) => c.value),
      );
      list.replaceChildren();
      for (const item of r.items) {
        const card = el("article");
        card.className = "panel";
        const a = el(
          "a",
          `Source ${item.position + 1}: review outputs, quality and retries`,
        );
        a.href = `/app/packs/${item.pack_id}`;
        const image = el("img");
        image.loading = "lazy";
        image.src = `/api/images/${item.input_image_id}/content`;
        image.alt = `Original source ${item.position + 1}`;
        image.style.maxWidth = "160px";
        card.append(a, image);
        for (const o of item.outputs)
          card.append(
            el(
              "p",
              `${o.spec.name}: ${o.current?.status ?? "Missing record"} · quality ${o.current?.quality_state ?? "unavailable"} · ${o.current?.user_decision ?? "not approved"}${o.current?.message ? ` · ${o.current.message}` : ""}`,
            ),
          );
        if (item.progress.approved) {
          const label = el("label"),
            check = el("input");
          check.type = "checkbox";
          check.value = item.pack_id;
          check.checked = selected.has(item.pack_id);
          label.append(check, el("span", "Include approved outputs in ZIP"));
          card.append(label);
        }
        list.append(card);
      }
      const dl = page.querySelector("#batch-download");
      dl.replaceChildren();
      const download = el("button", "Download selected approved outputs");
      download.onclick = () => {
        const ids = Array.from(list.querySelectorAll("input:checked")).map(
          (c) => c.value,
        );
        if (!ids.length) {
          note(notice, "Select a source with approved outputs.");
          return;
        }
        location.assign(`/api/batches/${id}/download?packs=${ids.join(",")}`);
      };
      dl.append(download);
      if (r.counts.queued || r.counts.processing)
        timer = setTimeout(refresh, 3000);
    } catch (e) {
      note(notice, e);
    }
  }
  await refresh();
}
