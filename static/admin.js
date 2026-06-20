/* The Global Decipher — admin panel.
   Talks to the Worker API (same origin via the /api/* route). Auth = one shared
   access key, sent as a Bearer token and kept in sessionStorage. */
(function () {
  "use strict";

  const API = window.TGD_API_BASE || "/api";
  const root = document.getElementById("admin-root");
  let KEY = sessionStorage.getItem("tgd_key") || "";

  // ---- helpers ----
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

  async function api(path, { method = "GET", body, auth = true } = {}) {
    const headers = {};
    if (auth && KEY) headers.authorization = "Bearer " + KEY;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(API + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
    return data;
  }

  let toastTimer;
  function toast(msg, kind = "ok") {
    let t = document.getElementById("toast");
    if (!t) { t = el("div", { id: "toast" }); document.body.append(t); }
    t.className = "toast " + kind;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
  }

  const slug = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  const today = () => new Date().toISOString().slice(0, 10);

  // ---- YAML front-matter (mirror of build.mjs / publish script) ----
  const yStr = (v) => JSON.stringify(String(v ?? ""));
  const yArr = (a) => "[" + a.map(yStr).join(", ") + "]";

  function buildMarkdown(fm, body) {
    const lines = ["---"];
    for (const [k, v] of Object.entries(fm)) {
      if (Array.isArray(v)) lines.push(`${k}: ${yArr(v)}`);
      else if (typeof v === "boolean") lines.push(`${k}: ${v}`);
      else lines.push(`${k}: ${yStr(v)}`);
    }
    lines.push("---", "", String(body || "").trim(), "");
    return lines.join("\n");
  }

  function parseMarkdown(text) {
    const m = String(text || "").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) return { fm: {}, body: text || "" };
    const fm = {};
    for (const line of m[1].split("\n")) {
      const mm = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
      if (!mm) continue;
      let v = mm[2].trim();
      if (v === "true" || v === "false") fm[mm[1]] = v === "true";
      else if (/^\[.*\]$/.test(v)) { try { fm[mm[1]] = JSON.parse(v); } catch { fm[mm[1]] = []; } }
      else { try { fm[mm[1]] = JSON.parse(v); } catch { fm[mm[1]] = v.replace(/^"|"$/g, ""); } }
    }
    return { fm, body: m[2].replace(/^\n+/, "") };
  }

  // ============================ LOGIN ============================
  function renderLogin(msg) {
    clear(root);
    const input = el("input", { type: "password", placeholder: "Access key", class: "field", autofocus: true });
    const submit = async () => {
      const key = input.value.trim();
      if (!key) return;
      KEY = key;
      try {
        await api("/admin/ping");
        sessionStorage.setItem("tgd_key", key);
        renderApp();
      } catch (e) {
        KEY = "";
        renderLogin("Wrong access key.");
        input.focus();
      }
    };
    root.append(el("div", { class: "login" },
      el("div", { class: "login-card" },
        el("div", { class: "wordmark" }, "THE GLOBAL DECIPHER"),
        el("div", { class: "login-sub" }, "Admin panel"),
        input,
        el("button", { class: "btn primary", onclick: submit }, "Enter"),
        msg ? el("p", { class: "err" }, msg) : null
      )
    ));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  }

  function logout() {
    sessionStorage.removeItem("tgd_key");
    KEY = "";
    renderLogin();
  }

  // ============================ APP SHELL ============================
  let activeTab = "incidents";
  function renderApp() {
    clear(root);
    const maint = el("label", { class: "maint" }, el("input", { type: "checkbox", id: "maint-toggle" }), el("span", {}, "Maintenance mode"));
    const header = el("header", { class: "topbar" },
      el("div", { class: "brand" }, "TGD Admin"),
      el("nav", { class: "tabs" },
        tabBtn("incidents", "Incidents"),
        tabBtn("content", "Articles & Profiles")
      ),
      el("div", { class: "topbar-right" }, maint, el("button", { class: "btn ghost", onclick: logout }, "Log out"))
    );
    const main = el("main", { id: "view", class: "view" });
    root.append(header, main);
    initMaintenance();
    showTab(activeTab);
  }

  function tabBtn(id, label) {
    return el("button", {
      class: "tab" + (activeTab === id ? " active" : ""),
      onclick: (e) => { activeTab = id; document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active")); e.currentTarget.classList.add("active"); showTab(id); }
    }, label);
  }

  function showTab(id) {
    const view = document.getElementById("view");
    clear(view);
    if (id === "incidents") renderIncidents(view);
    else renderContent(view);
  }

  // ---- maintenance toggle ----
  async function initMaintenance() {
    const cb = document.getElementById("maint-toggle");
    try { cb.checked = (await api("/maintenance", { auth: false })).on; } catch {}
    cb.addEventListener("change", async () => {
      try {
        await api("/maintenance", { method: "POST", body: { on: cb.checked } });
        toast(cb.checked ? "Maintenance mode ON — site is now locked." : "Maintenance mode OFF — site is live.", cb.checked ? "warn" : "ok");
      } catch (e) { cb.checked = !cb.checked; toast(e.message, "err"); }
    });
  }

  // ============================ INCIDENTS ============================
  const SEVERITY = ["High", "Medium", "Low"];
  const PROVINCES = ["Khyber Pakhtunkhwa", "Balochistan", "Sindh", "Punjab", "Gilgit-Baltistan", "Islamabad"];

  async function renderIncidents(view) {
    view.append(el("div", { class: "panel-head" },
      el("h2", {}, "Incidents"),
      el("button", { class: "btn primary", onclick: () => incidentForm(view) }, "+ New incident")
    ));
    const listEl = el("div", { class: "list" }, el("p", { class: "muted" }, "Loading…"));
    view.append(listEl);
    try {
      const feed = await api("/incidents", { auth: false });
      const items = feed.incidents || [];
      clear(listEl);
      if (!items.length) listEl.append(el("p", { class: "muted" }, "No incidents yet."));
      for (const it of items) {
        listEl.append(el("div", { class: "row" },
          el("div", { class: "row-main" },
            el("div", { class: "row-title" }, it.title || it.id),
            el("div", { class: "row-meta" }, `${it.date} · ${it.district || "?"}, ${it.province || ""} · ${it.severity || ""} · ${it.source || ""}`)
          ),
          el("div", { class: "row-actions" },
            el("button", { class: "btn small", onclick: () => incidentForm(view, it) }, "Edit"),
            el("button", { class: "btn small danger", onclick: () => deleteIncident(it, view) }, "Delete")
          )
        ));
      }
    } catch (e) {
      clear(listEl);
      listEl.append(el("p", { class: "err" }, "Could not load feed: " + e.message));
    }
  }

  function incidentForm(view, existing) {
    const it = existing || {};
    const f = {};
    const field = (label, key, opts = {}) => {
      let input;
      if (opts.type === "textarea") input = el("textarea", { class: "field", rows: opts.rows || 4 });
      else if (opts.select) { input = el("select", { class: "field" }); for (const o of opts.select) input.append(el("option", { value: o, selected: (it[key] || opts.default) === o }, o)); }
      else if (opts.type === "checkbox") input = el("input", { type: "checkbox" });
      else input = el("input", { class: "field", type: opts.type || "text" });
      if (opts.type === "checkbox") input.checked = Boolean(it[key]);
      else if (!opts.select) input.value = it[key] != null ? it[key] : (opts.default || "");
      f[key] = input;
      return el("label", { class: "fld" }, el("span", {}, label), input);
    };

    clear(view);
    view.append(el("div", { class: "panel-head" },
      el("h2", {}, existing ? "Edit incident" : "New incident"),
      el("button", { class: "btn ghost", onclick: () => showTab("incidents") }, "← Back")
    ));
    const form = el("div", { class: "form grid2" },
      field("Date (YYYY-MM-DD)", "date", { type: "date", default: today() }),
      field("Title", "title"),
      field("District / area", "district"),
      field("Province", "province", { select: PROVINCES }),
      field("Category", "category", { default: "Security incident" }),
      field("Severity", "severity", { select: SEVERITY, default: "Medium" }),
      field("Status", "status", { default: "Initial report" }),
      field("Reported actor", "actor", { default: "Unidentified" }),
      field("Fatalities", "fatalities", { type: "number", default: 0 }),
      field("Injuries", "injuries", { type: "number", default: 0 }),
      field("Latitude (optional)", "lat", { type: "number" }),
      field("Longitude (optional)", "lng", { type: "number" }),
      field("Source name", "source", { default: "TGD Desk" }),
      field("Source link", "source_url"),
      el("label", { class: "fld chk" }, el("span", {}, "Verified"), f.verified = el("input", { type: "checkbox" })),
      field("Summary", "summary", { type: "textarea", rows: 4 })
    );
    if (it.verified) f.verified.checked = true;
    view.append(form);
    view.append(el("div", { class: "form-actions" },
      el("button", { class: "btn primary", onclick: () => saveIncident(it, f, view) }, "Save incident")
    ));
  }

  async function saveIncident(existing, f, view) {
    const date = f.date.value || today();
    const title = f.title.value.trim();
    const district = f.district.value.trim();
    if (!date || !title) return toast("Date and title are required.", "err");
    const id = existing.id || `${date}-${slug(district || "incident")}-${slug(title)}`;
    const incident = {
      id, date,
      reported_at: existing.reported_at || `${date}T12:00:00.000Z`,
      time_label: existing.time_label || "Added by desk",
      title,
      district: district || "Unspecified",
      province: f.province.value,
      country: "Pakistan",
      lat: Number(f.lat.value) || 30.3753,
      lng: Number(f.lng.value) || 69.3451,
      category: f.category.value.trim() || "Security incident",
      actor: f.actor.value.trim() || "Unidentified",
      status: f.status.value.trim() || "Initial report",
      severity: f.severity.value,
      fatalities: Number(f.fatalities.value) || 0,
      injuries: Number(f.injuries.value) || 0,
      summary: f.summary.value.trim(),
      source: f.source.value.trim() || "TGD Desk",
      source_url: f.source_url.value.trim(),
      verified: f.verified.checked
    };
    try {
      await api("/incidents", { method: "POST", body: incident });
      toast("Saved. Map updates within a minute.");
      showTab("incidents");
    } catch (e) { toast(e.message, "err"); }
  }

  async function deleteIncident(it, view) {
    if (!confirm(`Delete "${it.title || it.id}"? This cannot be undone.`)) return;
    try {
      await api("/incidents/" + encodeURIComponent(it.id), { method: "DELETE" });
      toast("Deleted.");
      renderIncidents(clearView(view));
    } catch (e) { toast(e.message, "err"); }
  }
  const clearView = (view) => { const v = document.getElementById("view"); clear(v); return v; };

  // ============================ CONTENT (markdown) ============================
  const FOLDERS = [
    { key: "news", label: "News", type: "news", author: "TGD News Desk" },
    { key: "opinion", label: "Opinion", type: "opinion", author: "TGD Opinion Desk" },
    { key: "monitoring", label: "Monitoring", type: "monitoring", author: "TGD Monitoring Desk" },
    { key: "reports", label: "Reports", type: "reports", author: "TGD Research Desk" },
    { key: "profiles", label: "Profiles", type: "profiles", author: "TGD Research Desk" },
    { key: "pages", label: "Pages", type: "page", author: "" }
  ];
  let activeFolder = "news";

  async function renderContent(view) {
    const sel = el("select", { class: "field inline", onchange: (e) => { activeFolder = e.target.value; renderContent(clearView(view)); } });
    for (const fo of FOLDERS) sel.append(el("option", { value: fo.key, selected: fo.key === activeFolder }, fo.label));
    view.append(el("div", { class: "panel-head" },
      el("h2", {}, "Content"),
      el("div", { class: "head-tools" }, sel, el("button", { class: "btn primary", onclick: () => contentForm(view, null) }, "+ New"))
    ));
    const listEl = el("div", { class: "list" }, el("p", { class: "muted" }, "Loading…"));
    view.append(listEl);
    try {
      const { files } = await api("/content?folder=" + encodeURIComponent(activeFolder));
      clear(listEl);
      if (!files.length) listEl.append(el("p", { class: "muted" }, "No files yet."));
      for (const file of files) {
        listEl.append(el("div", { class: "row" },
          el("div", { class: "row-main" }, el("div", { class: "row-title" }, file.slug)),
          el("div", { class: "row-actions" },
            el("button", { class: "btn small", onclick: () => contentForm(view, file) }, "Edit"),
            el("button", { class: "btn small danger", onclick: () => deleteContent(file, view) }, "Delete")
          )
        ));
      }
    } catch (e) {
      clear(listEl);
      listEl.append(el("p", { class: "err" }, "Could not list files: " + e.message + (/configured|404/.test(e.message) ? " (is GITHUB_TOKEN set on the Worker?)" : "")));
    }
  }

  async function contentForm(view, file) {
    const folder = FOLDERS.find((f) => f.key === activeFolder);
    let fm = {}, body = "", sha = null, path = file ? file.path : null;
    if (file) {
      try { const got = await api("/content/file?path=" + encodeURIComponent(file.path)); const p = parseMarkdown(got.content); fm = p.fm; body = p.body; sha = got.sha; }
      catch (e) { return toast("Could not open file: " + e.message, "err"); }
    }
    const f = {};
    const fld = (label, key, opts = {}) => {
      let input;
      if (opts.type === "textarea") input = el("textarea", { class: "field mono", rows: opts.rows || 16 });
      else if (opts.type === "checkbox") input = el("input", { type: "checkbox" });
      else input = el("input", { class: "field", type: opts.type || "text" });
      if (opts.type === "checkbox") input.checked = Boolean(fm[key]);
      else input.value = fm[key] != null ? (Array.isArray(fm[key]) ? fm[key].join(", ") : fm[key]) : (opts.default || "");
      f[key] = input;
      return el("label", { class: "fld" + (opts.wide ? " wide" : "") }, el("span", {}, label), input);
    };

    clear(view);
    view.append(el("div", { class: "panel-head" },
      el("h2", {}, (file ? "Edit " : "New ") + folder.label.replace(/s$/, "")),
      el("button", { class: "btn ghost", onclick: () => renderContent(clearView(view)) }, "← Back")
    ));

    let form;
    if (activeFolder === "pages") {
      form = el("div", { class: "form" },
        el("div", { class: "grid2" },
          fld("Title", "title"),
          fld("Slug (url)", "slug", { default: file ? file.slug : "" }),
          fld("Eyebrow", "eyebrow"),
          fld("Summary", "summary", { wide: true })
        ),
        fld("Body (Markdown)", "__body", { type: "textarea" })
      );
    } else {
      form = el("div", { class: "form" },
        el("div", { class: "grid2" },
          fld("Title", "title"),
          fld("Date (YYYY-MM-DD)", "date", { type: "date", default: today() }),
          fld("Author / desk", "author", { default: folder.author }),
          fld("Category", "category"),
          fld("Region", "region", { default: "Pakistan" }),
          fld("Tags (comma separated)", "tags"),
          fld("Sensitivity", "sensitivity", { default: "standard" }),
          el("label", { class: "fld chk" }, el("span", {}, "Featured on homepage"), f.featured = el("input", { type: "checkbox" }))
        ),
        fld("Summary", "summary", { wide: true }),
        fld("Body (Markdown)", "__body", { type: "textarea" })
      );
      if (fm.featured) f.featured.checked = true;
    }
    f.__body.value = body;
    view.append(form);
    view.append(el("div", { class: "form-actions" },
      el("button", { class: "btn primary", onclick: () => saveContent({ folder, file, path, sha, f }, view) }, file ? "Save changes" : "Publish")
    ));
  }

  async function saveContent({ folder, file, path, sha, f }, view) {
    const title = f.title.value.trim();
    if (!title) return toast("Title is required.", "err");
    let fm, filePath;
    if (folder.key === "pages") {
      const pageSlug = (f.slug.value.trim() || slug(title));
      fm = { title, slug: pageSlug, type: "page", eyebrow: f.eyebrow.value.trim(), summary: f.summary.value.trim() };
      filePath = path || `content/pages/${pageSlug}.md`;
    } else {
      const date = f.date.value || today();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast("Date must be YYYY-MM-DD.", "err");
      const tags = f.tags.value.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
      fm = {
        title, date,
        author: f.author.value.trim() || folder.author,
        type: folder.type,
        category: f.category.value.trim() || "",
        region: f.region.value.trim() || "",
        summary: f.summary.value.trim(),
        tags,
        access: "free",
        sensitivity: f.sensitivity.value.trim() || "standard",
        featured: f.featured.checked
      };
      filePath = path || `content/${folder.key}/${date}-${slug(title)}.md`;
    }
    const markdown = buildMarkdown(fm, f.__body.value);

    try {
      // creating a brand-new file: if the path already exists, fetch its sha to overwrite
      if (!sha) {
        try { const existing = await api("/content/file?path=" + encodeURIComponent(filePath)); sha = existing.sha; } catch {}
      }
      await api("/content/file", { method: "PUT", body: { path: filePath, content: markdown, sha, message: `${file ? "Update" : "Publish"} ${filePath}` } });
      toast("Saved. Site rebuilds in ~1 minute.");
      renderContent(clearView(view));
    } catch (e) { toast(e.message, "err"); }
  }

  async function deleteContent(file, view) {
    if (!confirm(`Delete ${file.slug}? This removes the page from the site.`)) return;
    try {
      const got = await api("/content/file?path=" + encodeURIComponent(file.path));
      await api("/content/file", { method: "DELETE", body: { path: file.path, sha: got.sha, message: `Delete ${file.path}` } });
      toast("Deleted. Site rebuilds in ~1 minute.");
      renderContent(clearView(view));
    } catch (e) { toast(e.message, "err"); }
  }

  // ---- boot ----
  if (KEY) api("/admin/ping").then(renderApp).catch(() => renderLogin());
  else renderLogin();
})();
