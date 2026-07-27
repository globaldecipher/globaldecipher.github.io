/* The Global Decipher — admin: Primary Sources.
   Uploads PDF / DOCX / plaintext into the Explorer's primary-source corpus.
   Text is extracted in the browser (pdfjs-dist / mammoth from CDN) so the
   Worker only chunks, embeds, and indexes. */
(function () {
  "use strict";

  const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs";
  const PDFJS_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs";
  const MAMMOTH_URL = "https://cdn.jsdelivr.net/npm/mammoth@1.9.0/mammoth.browser.min.js";
  const ENTITIES_URL = "/network-graph/data/entities.json";
  const FALLBACK_ENTITIES_URL = "https://theglobaldecipher.com/network-graph/data/entities.json";

  let entitiesCache = null;
  let pdfjsPromise = null;
  let mammothPromise = null;

  const el = (tag, attrs = {}, ...kids) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) node.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) node.append(kid.nodeType ? kid : document.createTextNode(kid));
    return node;
  };
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };
  const fmtBytes = (n) => {
    if (!n) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0; let v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
  };

  async function loadPdfjs() {
    if (pdfjsPromise) return pdfjsPromise;
    pdfjsPromise = (async () => {
      const mod = await import(PDFJS_URL);
      mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return mod;
    })();
    return pdfjsPromise;
  }

  async function loadMammoth() {
    if (mammothPromise) return mammothPromise;
    mammothPromise = new Promise((resolve, reject) => {
      if (window.mammoth) return resolve(window.mammoth);
      const s = document.createElement("script");
      s.src = MAMMOTH_URL;
      s.onload = () => resolve(window.mammoth);
      s.onerror = () => reject(new Error("Failed to load mammoth.js"));
      document.head.append(s);
    });
    return mammothPromise;
  }

  async function loadEntities() {
    if (entitiesCache && entitiesCache.length > 0) return entitiesCache;
    for (const url of [ENTITIES_URL, FALLBACK_ENTITIES_URL]) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) continue;
        const data = await res.json();
        const list = (data.entities || []).map((e) => ({
          id: e.id,
          name: e.name || e.id,
          type: e.type || "entity",
          stub: !!e.stub
        })).sort((a, b) => a.name.localeCompare(b.name));
        if (list.length > 0) {
          entitiesCache = list;
          return entitiesCache;
        }
      } catch (_e) { /* try next */ }
    }
    return [];
  }

  async function extractText(file) {
    const mime = file.type || "";
    const name = (file.name || "").toLowerCase();
    if (mime === "application/pdf" || name.endsWith(".pdf")) {
      const pdfjs = await loadPdfjs();
      const buf = await file.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map((it) => it.str).join(" "));
      }
      return pages.join("\n\n");
    }
    if (
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mime === "application/msword" ||
      name.endsWith(".docx") ||
      name.endsWith(".doc")
    ) {
      const mammoth = await loadMammoth();
      const buf = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: buf });
      return String(result?.value || "");
    }
    if (mime.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
      return await file.text();
    }
    throw new Error(`Unsupported file type: ${mime || name}`);
  }

  function statusLine(text, kind = "info") {
    return el("p", { class: `corpus-status corpus-status-${kind}` }, text);
  }

  async function renderPrimarySources(view, ctx) {
    const { api, toast } = ctx;
    clear(view);

    const heading = el("div", { class: "section-head" },
      el("h3", {}, "Primary Sources"),
      el("p", { class: "section-sub" },
        "Upload PDFs and Word docs to feed the Explorer's Ask assistant with primary-source passages. Files are stored in Cloudflare R2; text is chunked and searchable via Vectorize."
      )
    );

    const entities = await loadEntities();
    if (entities.length === 0) {
      view.append(el("section", { class: "card" }, heading, statusLine("Could not load entity list. Reload the page and try again.", "err")));
      return;
    }

    const entitySelect = el("select", { class: "input", id: "corpus-entity" },
      ...entities.map((e) => el("option", { value: e.id }, `${e.name}${e.stub ? " · stub" : ""}`))
    );
    const fileInput = el("input", { type: "file", accept: ".pdf,.docx,.doc,.txt,.md", id: "corpus-file", class: "input" });
    const titleInput = el("input", { type: "text", class: "input", id: "corpus-title", placeholder: "Citation title (optional — defaults to filename)" });
    const submit = el("button", { class: "btn", type: "submit" }, "Upload & ingest");
    const statusBox = el("div", { class: "corpus-status-box" });
    const listBox = el("div", { class: "corpus-list" });

    async function refreshList(entityId) {
      clear(listBox);
      listBox.append(statusLine(`Loading sources for ${entityId}…`, "info"));
      try {
        const data = await api(`/corpus?entity_id=${encodeURIComponent(entityId)}`);
        const sources = data?.sources || [];
        clear(listBox);
        if (sources.length === 0) {
          listBox.append(statusLine("No primary sources ingested for this entity yet.", "info"));
          return;
        }
        const table = el("table", { class: "corpus-table" },
          el("thead", {}, el("tr", {},
            el("th", {}, "Title"),
            el("th", {}, "File"),
            el("th", {}, "Size"),
            el("th", {}, "Chunks"),
            el("th", {}, "Ingested"),
            el("th", {}, "")
          )),
          el("tbody", {}, ...sources.map((src) => el("tr", {},
            el("td", {}, src.title || src.filename),
            el("td", {}, src.filename),
            el("td", {}, fmtBytes(src.bytes || 0)),
            el("td", {}, String(src.chunk_count || 0)),
            el("td", {}, (src.ingested_at || "").slice(0, 10)),
            el("td", {}, el("button", {
              class: "btn ghost small",
              onclick: async (e) => {
                if (!confirm(`Delete "${src.title || src.filename}"? This removes the file from R2 and the search index.`)) return;
                const btn = e.currentTarget;
                btn.disabled = true; btn.textContent = "Deleting…";
                try {
                  await api(`/corpus/${encodeURIComponent(src.source_id)}?entity_id=${encodeURIComponent(entityId)}`, { method: "DELETE" });
                  toast("Source removed.");
                  refreshList(entityId);
                } catch (err) {
                  toast(String(err.message || err), "err");
                  btn.disabled = false; btn.textContent = "Delete";
                }
              }
            }, "Delete"))
          )))
        );
        listBox.append(table);
      } catch (err) {
        clear(listBox);
        listBox.append(statusLine(`Failed to load sources: ${err.message || err}`, "err"));
      }
    }

    entitySelect.addEventListener("change", () => refreshList(entitySelect.value));

    const form = el("form", { class: "corpus-form", onsubmit: async (e) => {
      e.preventDefault();
      const entity_id = entitySelect.value;
      const file = fileInput.files?.[0];
      const title = titleInput.value.trim();
      if (!entity_id) { toast("Choose an entity.", "err"); return; }
      if (!file) { toast("Choose a file.", "err"); return; }

      clear(statusBox);
      statusBox.append(statusLine("Reading file…", "info"));
      submit.disabled = true; submit.textContent = "Ingesting…";
      try {
        clear(statusBox);
        statusBox.append(statusLine("Extracting text in browser…", "info"));
        const text = await extractText(file);
        if (!text || text.trim().length < 40) {
          throw new Error("Extracted text is empty. The document may be scanned images — OCR isn't supported yet.");
        }

        clear(statusBox);
        statusBox.append(statusLine(`Uploading and indexing (${fmtBytes(file.size)}, ${text.length.toLocaleString()} chars)…`, "info"));
        const fd = new FormData();
        fd.append("entity_id", entity_id);
        if (title) fd.append("title", title);
        fd.append("text", text);
        fd.append("file", file, file.name);

        const result = await api("/corpus/upload", { method: "POST", formData: fd });
        clear(statusBox);
        statusBox.append(statusLine(`Ingested ${result?.source?.chunk_count || 0} chunks from "${result?.source?.title || file.name}".`, "ok"));
        toast("Source ingested.");
        fileInput.value = "";
        titleInput.value = "";
        refreshList(entity_id);
      } catch (err) {
        clear(statusBox);
        statusBox.append(statusLine(String(err.message || err), "err"));
        toast(String(err.message || err), "err");
      } finally {
        submit.disabled = false; submit.textContent = "Upload & ingest";
      }
    } },
      el("div", { class: "corpus-row" },
        el("label", { class: "corpus-label" }, el("span", {}, "Entity"), entitySelect),
        el("label", { class: "corpus-label" }, el("span", {}, "File"), fileInput)
      ),
      el("label", { class: "corpus-label" }, el("span", {}, "Citation title"), titleInput),
      el("div", { class: "corpus-actions" }, submit),
      statusBox
    );

    view.append(el("section", { class: "card" },
      heading,
      form
    ));
    view.append(el("section", { class: "card" },
      el("div", { class: "section-head" },
        el("h3", {}, "Ingested sources"),
        el("p", { class: "section-sub" }, "Files stored in R2 and searchable by the Ask assistant.")
      ),
      listBox
    ));

    refreshList(entitySelect.value);
  }

  window.TGD_ADMIN_CORPUS = { render: renderPrimarySources };
})();
