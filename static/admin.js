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

  async function api(path, { method = "GET", body, formData, auth = true } = {}) {
    const headers = {};
    if (auth && KEY) headers.authorization = "Bearer " + KEY;
    if (body !== undefined) headers["content-type"] = "application/json";
    const payload = formData || (body !== undefined ? JSON.stringify(body) : undefined);
    const res = await fetch(API + path, { method, headers, body: payload });
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
        el("h2", {}, "Admin panel"),
        el("p", { class: "login-sub" }, "Sign in with the shared access key to manage incidents and content."),
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
    const sw = el("button", {
      type: "button",
      class: "switch",
      role: "switch",
      "aria-checked": "false",
      "aria-label": "Toggle maintenance mode",
      id: "maint-switch"
    });
    const labelText = el("span", { class: "maint-title" }, "Maintenance mode");
    const status = el("span", { class: "maint-status", id: "maint-status" }, "Checking…");
    const labelBox = el("span", { class: "maint-label", id: "maint-label" }, labelText, status);
    const maint = el("div", { class: "maint", title: "Toggle public-site maintenance gate" }, sw, labelBox);
    const header = el("header", { class: "topbar" },
      el("div", { class: "brand" }, "TGD ADMIN"),
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
  function applyMaintenanceState(on) {
    const sw = document.getElementById("maint-switch");
    const label = document.getElementById("maint-label");
    const status = document.getElementById("maint-status");
    if (!sw) return;
    sw.setAttribute("aria-checked", on ? "true" : "false");
    sw.removeAttribute("aria-busy");
    sw.disabled = false;
    label.classList.toggle("is-on", on);
    label.classList.remove("is-loading");
    status.textContent = on ? "Site locked" : "Site live";
  }
  function setMaintenanceLoading(text) {
    const sw = document.getElementById("maint-switch");
    const label = document.getElementById("maint-label");
    const status = document.getElementById("maint-status");
    if (!sw) return;
    sw.setAttribute("aria-busy", "true");
    sw.disabled = true;
    label.classList.add("is-loading");
    status.textContent = text || "Updating…";
  }

  async function initMaintenance() {
    setMaintenanceLoading("Checking…");
    let current = false;
    try { current = Boolean((await api("/maintenance", { auth: false })).on); } catch {}
    applyMaintenanceState(current);
    document.getElementById("maint-switch").addEventListener("click", async (e) => {
      const sw = e.currentTarget;
      if (sw.getAttribute("aria-busy") === "true") return;
      const next = sw.getAttribute("aria-checked") !== "true";
      setMaintenanceLoading(next ? "Locking site…" : "Unlocking site…");
      try {
        await api("/maintenance", { method: "POST", body: { on: next } });
        applyMaintenanceState(next);
        toast(next ? "Maintenance mode ON — site is now locked." : "Maintenance mode OFF — site is live.", next ? "warn" : "ok");
      } catch (err) {
        applyMaintenanceState(!next);
        toast(err.message, "err");
      }
    });
  }

  // ============================ UI PRIMITIVES ============================
  function pageHead(title, subtitle, ...actions) {
    return el("div", { class: "page-head" },
      el("div", { class: "page-head-text" },
        el("h1", {}, title),
        subtitle ? el("p", { class: "page-sub" }, subtitle) : null
      ),
      actions.length ? el("div", { class: "page-head-actions" }, ...actions) : null
    );
  }

  function section(title, subtitle, ...children) {
    return el("section", { class: "card" },
      el("div", { class: "section-head" },
        el("h3", {}, title),
        subtitle ? el("p", { class: "section-sub" }, subtitle) : null
      ),
      el("div", { class: "fields" }, ...children)
    );
  }

  /* Field renderer.
     opts: {
       type: "text"|"date"|"number"|"textarea"|"checkbox"|"url",
       select: [...options],
       datalist: [...suggestions],
       default, placeholder, rows, hint, required, wide, optional, min, max, step
     }
     Returns { wrap, input } so the caller can stash the input ref. */
  function makeField(label, opts = {}, currentValue) {
    let input;
    const inputId = "fld-" + Math.random().toString(36).slice(2, 9);
    if (opts.type === "textarea") {
      input = el("textarea", { class: "field" + (opts.mono ? " mono" : ""), rows: opts.rows || 4, id: inputId, placeholder: opts.placeholder || "" });
      input.value = currentValue != null ? currentValue : (opts.default || "");
    } else if (opts.select) {
      input = el("select", { class: "field", id: inputId });
      const cur = currentValue != null && currentValue !== "" ? currentValue : opts.default;
      for (const o of opts.select) input.append(el("option", { value: o, selected: cur === o }, o));
    } else if (opts.type === "checkbox") {
      input = el("input", { type: "checkbox", id: inputId });
      input.checked = Boolean(currentValue);
    } else {
      const attrs = { class: "field", type: opts.type || "text", id: inputId, placeholder: opts.placeholder || "" };
      if (opts.min != null) attrs.min = opts.min;
      if (opts.max != null) attrs.max = opts.max;
      if (opts.step != null) attrs.step = opts.step;
      if (opts.datalist) attrs.list = inputId + "-list";
      input = el("input", attrs);
      input.value = currentValue != null && currentValue !== "" ? currentValue : (opts.default || "");
    }

    // checkbox uses a different layout (label sits to the right)
    if (opts.type === "checkbox") {
      const wrap = el("label", { class: "fld chk" + (opts.wide ? " wide" : ""), for: inputId },
        input,
        el("div", { class: "chk-body" },
          el("span", { class: "fld-label" }, label),
          opts.hint ? el("span", { class: "fld-hint" }, opts.hint) : null
        )
      );
      return { wrap, input };
    }

    const labelNode = el("label", { class: "fld-label", for: inputId },
      el("span", {}, label),
      opts.required ? el("span", { class: "req", title: "Required" }, "*") :
      opts.optional ? el("span", { class: "opt" }, "Optional") : null
    );
    const children = [labelNode, input];
    if (opts.datalist) {
      const dl = el("datalist", { id: inputId + "-list" });
      for (const v of opts.datalist) dl.append(el("option", { value: v }));
      children.push(dl);
    }
    if (opts.hint) children.push(el("p", { class: "fld-hint" }, opts.hint));

    const wrap = el("div", { class: "fld" + (opts.wide ? " wide" : "") }, ...children);
    return { wrap, input };
  }

  // ============================ INCIDENTS ============================
  const SEVERITY = ["High", "Medium", "Low"];
  const PROVINCES = ["Khyber Pakhtunkhwa", "Balochistan", "Sindh", "Punjab", "Gilgit-Baltistan", "Islamabad", "Azad Kashmir"];
  const CATEGORIES = [
    "Attack",
    "Suicide Bombing / Explosion",
    "IED / Explosion",
    "IED Recovery / Defusal",
    "Targeted Killing / Shooting",
    "Clash / Armed Encounter",
    "Counterterrorism Operation",
    "Intelligence-Based Operation",
    "Search Operation / Clash",
    "Curfew / Security Operation",
    "Security incident"
  ];
  const STATUSES = ["Initial report", "Developing", "Confirmed", "Resolved", "Disputed"];
  const ACTORS = [
    "Tehreek-e-Taliban Pakistan (TTP)",
    "Hafiz Gul Bahadur Group",
    "Jamaat-ul-Ahrar",
    "Hizb-ul-Ahrar",
    "Lashkar-e-Islam",
    "Islamic State Khorasan Province (ISKP)",
    "Balochistan Liberation Army (BLA)",
    "Baloch Raji Aajoi Sangar (BRAS)",
    "Security Forces",
    "Counter Terrorism Department (CTD)",
    "Security Forces / Tehreek-e-Taliban Pakistan (TTP)",
    "Security Forces / Militants",
    "Unidentified Militants",
    "Unidentified Terrorists",
    "Unidentified"
  ];
  const SEV_CHIP = { High: "chip chip-high", Medium: "chip chip-medium", Low: "chip chip-low" };

  async function renderIncidents(view) {
    view.append(pageHead(
      "Incidents",
      "Live feed that powers the public incident map. Edits show up on the map within a minute.",
      el("button", { class: "btn primary", onclick: () => incidentForm(view) }, "+ New incident")
    ));
    const listEl = el("div", { class: "list" }, el("p", { class: "muted" }, "Loading…"));
    view.append(listEl);
    try {
      const feed = await api("/incidents", { auth: false });
      const items = feed.incidents || [];
      clear(listEl);
      if (!items.length) { listEl.append(el("div", { class: "list-empty" }, "No incidents yet. Click “+ New incident” to add one.")); return; }
      for (const it of items) {
        const sevChip = it.severity ? el("span", { class: SEV_CHIP[it.severity] || "chip" }, it.severity) : null;
        const verChip = it.verified ? el("span", { class: "chip chip-verified" }, "Verified") : null;
        const metaBits = [];
        metaBits.push(el("span", {}, it.date || "—"));
        metaBits.push(el("span", { class: "dot" }));
        metaBits.push(el("span", {}, [it.district, it.province].filter(Boolean).join(", ") || "Unspecified"));
        if (it.category) { metaBits.push(el("span", { class: "dot" })); metaBits.push(el("span", {}, it.category)); }
        if (sevChip) metaBits.push(sevChip);
        if (verChip) metaBits.push(verChip);
        listEl.append(el("div", { class: "row" },
          el("div", { class: "row-main" },
            el("div", { class: "row-title" }, it.title || it.id),
            el("div", { class: "row-meta" }, ...metaBits)
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
    const add = (key, label, opts) => {
      const { wrap, input } = makeField(label, opts, it[key]);
      f[key] = input;
      return wrap;
    };

    clear(view);
    view.append(pageHead(
      existing ? "Edit incident" : "New incident",
      existing ? "Update the fields below. Required fields are marked with a red asterisk." : "Fill in the fields below to publish a new incident to the live feed. Required fields are marked with a red asterisk.",
      el("button", { class: "btn ghost", onclick: () => showTab("incidents") }, "← Back to list")
    ));

    const form = el("div", { class: "form" },
      // ---- Basics ----
      section("Basics", "When it happened and a short headline. This is what readers see first.",
        add("date", "Date", { type: "date", default: today(), required: true, hint: "Use the local date in Pakistan." }),
        add("title", "Headline", { required: true, placeholder: "e.g. Swabi school attack", hint: "Short, plain-language summary of the event." }),
        (() => {
          const { wrap, input } = makeField("Brief summary", {
            type: "textarea",
            rows: 4,
            required: true,
            wide: true,
            placeholder: "1–3 sentences describing what happened, where, and what's confirmed.",
            hint: "Shown on the map popup and incident list. Keep it factual."
          }, it.summary);
          f.summary = input;
          return wrap;
        })()
      ),

      // ---- Location ----
      section("Location", "Where the incident took place. District + province are required; coordinates are optional but improve map accuracy.",
        add("district", "District / area", { required: true, placeholder: "e.g. Swabi", hint: "City, town, or district name." }),
        add("province", "Province", { select: PROVINCES, default: it.province || "Khyber Pakhtunkhwa", required: true }),
        add("lat", "Latitude", { type: "number", step: "any", optional: true, placeholder: "e.g. 34.1167", hint: "Decimal degrees. Leave blank to default to the Pakistan centroid (30.3753)." }),
        add("lng", "Longitude", { type: "number", step: "any", optional: true, placeholder: "e.g. 72.4667", hint: "Decimal degrees. Leave blank to default to the Pakistan centroid (69.3451)." })
      ),

      // ---- Classification ----
      section("Classification", "Type and severity. Used to filter the public map and surface trends in the monthly report.",
        add("category", "Category", { required: true, default: "Security incident", datalist: CATEGORIES, placeholder: "Pick or type a category", hint: "Pick from suggestions or enter a new one." }),
        add("severity", "Severity", { select: SEVERITY, default: it.severity || "Medium", required: true, hint: "High = mass casualty or strategic target. Low = minor or contained." }),
        add("status", "Reporting status", { default: it.status || "Initial report", datalist: STATUSES, hint: "How firm is the information at the time of publishing." })
      ),

      // ---- Actors & casualties ----
      section("Actors & casualties", "Who was involved, and the human toll. Use the slash-separated convention to capture both sides where applicable (e.g. “Security Forces / TTP”).",
        add("actor", "Reported actor(s)", { default: it.actor || "Unidentified", datalist: ACTORS, wide: true, placeholder: "e.g. Security Forces / Tehreek-e-Taliban Pakistan (TTP)", hint: "Pick from suggestions for known groups, or enter custom. Use “/” to list two sides." }),
        add("fatalities", "Fatalities", { type: "number", min: 0, default: 0, hint: "Confirmed dead, including attackers if known." }),
        add("injuries", "Injuries", { type: "number", min: 0, default: 0, hint: "Reported wounded." })
      ),

      // ---- Source & verification ----
      section("Source & verification", "Where the report comes from and whether the desk has confirmed it.",
        add("source", "Source name", { default: it.source || "TGD Desk", placeholder: "e.g. Dawn, AFP, TGD Desk", hint: "Outlet or desk that filed the report." }),
        add("source_url", "Source link", { type: "url", optional: true, placeholder: "https://…", hint: "Direct link to the article or official statement." }),
        add("verified", "Mark as verified", { type: "checkbox", wide: true, hint: "Tick once the desk has confirmed details through a second source." })
      )
    );

    view.append(form);
    view.append(el("div", { class: "form-actions" },
      el("span", { class: "form-hint" }, existing ? "Changes go live immediately." : "Will appear on the map within ~1 minute."),
      el("span", { class: "spacer" }),
      el("button", { class: "btn ghost", onclick: () => showTab("incidents") }, "Cancel"),
      el("button", { class: "btn primary", onclick: () => saveIncident(it, f, view) }, existing ? "Save changes" : "Publish incident")
    ));
  }

  async function saveIncident(existing, f, view) {
    const date = f.date.value || today();
    const title = f.title.value.trim();
    const district = f.district.value.trim();
    const summary = f.summary.value.trim();
    if (!date) return toast("Date is required.", "err");
    if (!title) return toast("Headline is required.", "err");
    if (!district) return toast("District / area is required.", "err");
    if (!summary) return toast("Brief summary is required.", "err");
    const id = existing.id || `${date}-${slug(district || "incident")}-${slug(title)}`;
    const incident = {
      id, date,
      reported_at: existing.reported_at || `${date}T12:00:00.000Z`,
      time_label: existing.time_label || "Added by desk",
      title,
      district,
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
      summary,
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

  // ============================ EXTERNAL LIBS (loaded on demand) ============================
  const CDN = {
    toastJs: "https://uicdn.toast.com/editor/latest/toastui-editor-all.min.js",
    toastCss: "https://uicdn.toast.com/editor/latest/toastui-editor.min.css",
    toastDarkCss: "https://uicdn.toast.com/editor/latest/theme/toastui-editor-dark.min.css",
    mammothJs: "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js",
    turndownJs: "https://cdn.jsdelivr.net/npm/turndown@7.1.2/dist/turndown.min.js",
    turndownGfmJs: "https://cdn.jsdelivr.net/npm/turndown-plugin-gfm@1.0.2/dist/turndown-plugin-gfm.js",
    jszipJs: "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"
  };
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-tgd-src="${url}"]`)) return resolve();
      const s = document.createElement("script");
      s.src = url; s.async = true; s.dataset.tgdSrc = url;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load " + url));
      document.head.appendChild(s);
    });
  }
  function loadCss(url) {
    if (document.querySelector(`link[data-tgd-href="${url}"]`)) return;
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = url; l.dataset.tgdHref = url;
    document.head.appendChild(l);
  }

  // ============================ WYSIWYG EDITOR ============================
  async function uploadMedia(blob, name = "image") {
    const file = blob instanceof File ? blob : new File([blob], name, { type: blob.type || "application/octet-stream" });
    const formData = new FormData();
    formData.append("file", file, file.name || name);
    return api("/media", { method: "POST", formData });
  }

  async function imageFromMammoth(image, index) {
    const base64 = await image.read("base64");
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const extension = image.contentType?.split("/").pop() || "png";
    const blob = new Blob([bytes], { type: image.contentType || "image/png" });
    const uploaded = await uploadMedia(blob, `word-image-${index + 1}.${extension}`);
    return { src: uploaded.url };
  }

  // Mounts the visual editor. Uploaded media is stored in R2 and saved as a
  // normal image URL, never as unreadable base64 text inside an article.
  async function mountMarkdownEditor(container, initialMarkdown, opts = {}) {
    loadCss(CDN.toastCss);
    loadCss(CDN.toastDarkCss);
    await loadScript(CDN.toastJs);
    const editor = new window.toastui.Editor({
      el: container,
      initialValue: initialMarkdown || "",
      initialEditType: "wysiwyg",
      previewStyle: "tab",
      height: opts.height || "560px",
      usageStatistics: false,
      theme: "dark",
      autofocus: false,
      hideModeSwitch: false,
      toolbarItems: [
        ["heading", "bold", "italic", "strike"],
        ["hr", "quote"],
        ["ul", "ol", "task", "indent", "outdent"],
        ["table", "image", "link"],
        ["code", "codeblock"],
        ["scrollSync"]
      ],
      hooks: {
        addImageBlobHook: async (blob, callback) => {
          try {
            const uploaded = await uploadMedia(blob, blob.name || "image");
            const altText = (blob.name || "image").replace(/\.[a-z]+$/i, "");
            callback(uploaded.url, altText);
          } catch (err) {
            toast("Could not upload image: " + err.message, "err");
          }
        }
      }
    });
    decorateEditorToolbar(container);
    addEditorHistoryControls(container, editor);
    setupEditorWorkspace(container, editor);
    return editor;
  }

  function decorateEditorToolbar(container) {
    const labels = {
      heading: "Heading",
      bold: "Bold",
      italic: "Italic",
      strike: "Strikethrough",
      hr: "Divider",
      quote: "Quote",
      ul: "Bullet list",
      ol: "Numbered list",
      task: "Task list",
      indent: "Increase indent",
      outdent: "Decrease indent",
      table: "Insert table",
      image: "Upload image",
      link: "Insert link",
      code: "Inline code",
      codeblock: "Code block",
      scrollSync: "Scroll sync"
    };
    container.querySelectorAll(".toastui-editor-toolbar-icons").forEach((button) => {
      const name = Object.keys(labels).find((key) => button.classList.contains(key));
      if (!name) return;
      button.setAttribute("title", labels[name]);
      button.setAttribute("aria-label", labels[name]);
    });
  }

  function addEditorHistoryControls(container, editor) {
    const toolbar = container.querySelector(".toastui-editor-toolbar");
    if (!toolbar || toolbar.querySelector(".editor-history-controls")) return;
    const controls = el("div", { class: "editor-history-controls" },
      el("button", {
        type: "button",
        class: "editor-history-btn",
        title: "Undo (Command/Ctrl + Z)",
        "aria-label": "Undo",
        onclick: () => sendHistoryShortcut(container, editor, false)
      }, "↶"),
      el("button", {
        type: "button",
        class: "editor-history-btn",
        title: "Redo (Command/Ctrl + Shift + Z)",
        "aria-label": "Redo",
        onclick: () => sendHistoryShortcut(container, editor, true)
      }, "↷")
    );
    toolbar.prepend(controls);
  }

  function sendHistoryShortcut(container, editor, redo) {
    const isMac = /mac|iphone|ipad/i.test(navigator.platform || "");
    editor.focus();
    const target = container.querySelector(".ProseMirror, .toastui-editor-md-container textarea");
    if (!target) return;
    target.dispatchEvent(new KeyboardEvent("keydown", {
      key: "z",
      code: "KeyZ",
      metaKey: isMac,
      ctrlKey: !isMac,
      shiftKey: redo,
      bubbles: true,
      cancelable: true
    }));
  }

  function setupEditorWorkspace(container, editor) {
    const card = container.closest(".editor-card");
    const outline = card?.querySelector(".editor-outline-list");
    const stats = card?.querySelector(".editor-stats");
    const focusButton = card?.querySelector(".editor-focus-btn");
    if (!card || !outline || !stats) return;

    const renderContext = () => {
      const markdown = editor.getMarkdown();
      const words = (markdown.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
      const minutes = Math.max(1, Math.ceil(words / 220));
      stats.textContent = `${words.toLocaleString()} words · ${minutes} min read`;

      const headings = [...markdown.matchAll(/^(#{1,3})\s+(.+)$/gm)].map((match) => ({
        level: match[1].length,
        label: match[2].replace(/[*_`]/g, "").trim()
      }));
      clear(outline);
      if (!headings.length) {
        outline.append(el("span", { class: "editor-outline-empty" }, "No headings"));
        return;
      }
      headings.forEach((heading, index) => outline.append(el("button", {
        type: "button",
        class: `editor-outline-item level-${heading.level}`,
        title: heading.label,
        onclick: () => {
          const targets = container.querySelectorAll(".ProseMirror h1, .ProseMirror h2, .ProseMirror h3");
          targets[index]?.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, heading.label)));
    };

    focusButton?.addEventListener("click", () => {
      const active = card.classList.toggle("is-focus");
      document.body.classList.toggle("editor-focus-active", active);
      focusButton.textContent = active ? "Exit focus" : "Focus editor";
      focusButton.setAttribute("aria-pressed", active ? "true" : "false");
      editor.setHeight(active ? "calc(100vh - 164px)" : "620px");
    });
    editor.on("change", renderContext);
    renderContext();
  }

  // ============================ WORD (.docx) IMPORT ============================
  async function importDocx(file) {
    await loadScript(CDN.mammothJs);
    await loadScript(CDN.turndownJs);
    await loadScript(CDN.turndownGfmJs);
    await loadScript(CDN.jszipJs);
    const arrayBuffer = await file.arrayBuffer();
    const tablesPromise = extractDocxTables(arrayBuffer);
    let imageIndex = 0;
    const result = await window.mammoth.convertToHtml(
      { arrayBuffer },
      {
        convertImage: window.mammoth.images.imgElement((image) => imageFromMammoth(image, imageIndex++))
      }
    );
    const td = new window.TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", emDelimiter: "*" });
    if (window.turndownPluginGfm?.gfm) td.use(window.turndownPluginGfm.gfm);
    // Preserve <figure>/<figcaption> as markdown image with caption-as-title
    td.addRule("figureImage", {
      filter: (node) => node.nodeName === "FIGURE" && node.querySelector("img"),
      replacement: (_c, node) => {
        const img = node.querySelector("img");
        const cap = node.querySelector("figcaption")?.textContent?.trim() || "";
        const alt = img.getAttribute("alt") || cap || "";
        const src = img.getAttribute("src") || "";
        return cap ? `\n\n![${alt}](${src} "${cap}")\n\n` : `\n\n![${alt}](${src})\n\n`;
      }
    });
    const importedTables = await tablesPromise;
    const markdown = restoreDocxTables(
      td.turndown(normalizeImportedTables(result.value)),
      importedTables
    ).replace(/\n{3,}/g, "\n\n").trim();
    // Best-effort title: first heading in the markdown
    const titleMatch = markdown.match(/^#+\s+(.+?)\s*$/m);
    const title = titleMatch ? titleMatch[1].trim() : file.name.replace(/\.docx?$/i, "").replace(/[-_]+/g, " ");
    return { markdown, title, tables: importedTables.length, images: imageIndex, warnings: result.messages || [] };
  }

  function normalizeImportedTables(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("table").forEach((table) => {
      const firstRow = table.rows[0];
      if (!firstRow || firstRow.querySelector("th")) return;
      // Word tables do not identify header cells. Treat the first row as the
      // header so the imported Markdown retains a useful, editable structure.
      [...firstRow.cells].forEach((cell) => {
        const heading = doc.createElement("th");
        for (const attribute of cell.attributes) heading.setAttribute(attribute.name, attribute.value);
        heading.innerHTML = cell.innerHTML;
        cell.replaceWith(heading);
      });
    });
    return doc.body.innerHTML;
  }

  async function extractDocxTables(arrayBuffer) {
    const zip = await window.JSZip.loadAsync(arrayBuffer);
    const documentFile = zip.file("word/document.xml");
    if (!documentFile) return [];
    const xml = await documentFile.async("string");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const descendants = (node, name) => Array.from(node.getElementsByTagNameNS("*", name));
    const directChildren = (node, name) => Array.from(node.children).filter((child) => child.localName === name);
    const textFromCell = (cell) => descendants(cell, "p")
      .map((paragraph) => descendants(paragraph, "t").map((text) => text.textContent || "").join("").trim())
      .filter(Boolean)
      .join(" ");

    return descendants(doc, "tbl")
      .map((table) => directChildren(table, "tr")
        .map((row) => directChildren(row, "tc").map(textFromCell))
        .filter((row) => row.some(Boolean)))
      .filter((table) => table.length > 1 && table[0].length > 1);
  }

  function restoreDocxTables(markdown, tables) {
    const blocks = String(markdown || "").split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
    const comparable = (value) => String(value || "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[\\*_`]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const tableCell = (value) => String(value || "").replace(/\r?\n+/g, "<br>").replace(/\|/g, "\\|").trim();

    for (const rows of tables) {
      const width = Math.max(...rows.map((row) => row.length));
      const normalizedRows = rows.map((row) => Array.from({ length: width }, (_, index) => tableCell(row[index])));
      const cells = normalizedRows.flat();
      if (!cells.length || cells.some((cell) => !cell)) continue;
      const start = blocks.findIndex((block, index) => (
        index + cells.length <= blocks.length
        && cells.every((cell, offset) => comparable(blocks[index + offset]) === comparable(cell))
      ));
      if (start < 0) continue;
      const tableMarkdown = [
        `| ${normalizedRows[0].join(" | ")} |`,
        `| ${normalizedRows[0].map(() => "---").join(" | ")} |`,
        ...normalizedRows.slice(1).map((row) => `| ${row.join(" | ")} |`)
      ].join("\n");
      blocks.splice(start, cells.length, tableMarkdown);
    }
    return blocks.join("\n\n");
  }

  // ============================ TAG CHIPS ============================
  function makeTagChips(initial = []) {
    const wrap = el("div", { class: "tagchips" });
    const input = el("input", { class: "tagchip-input", type: "text", placeholder: "Type a tag and press Enter" });
    let tags = Array.isArray(initial) ? [...initial] : (typeof initial === "string" && initial ? initial.split(/\s*,\s*/) : []);

    function render() {
      clear(wrap);
      for (const tag of tags) {
        const chip = el("span", { class: "tagchip" },
          el("span", {}, tag),
          el("button", { type: "button", class: "tagchip-remove", "aria-label": "Remove tag",
            onclick: () => { tags = tags.filter((t) => t !== tag); render(); } }, "×")
        );
        wrap.append(chip);
      }
      wrap.append(input);
    }
    function add(value) {
      const t = String(value || "").trim();
      if (!t || tags.includes(t)) return;
      tags.push(t);
      input.value = "";
      render();
    }
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(input.value); }
      else if (e.key === "Backspace" && !input.value && tags.length) { tags.pop(); render(); }
    });
    input.addEventListener("blur", () => { if (input.value.trim()) add(input.value); });
    wrap.addEventListener("click", (e) => { if (e.target === wrap) input.focus(); });
    render();
    return { wrap, getTags: () => [...tags] };
  }

  // ============================ CONTENT (markdown) ============================
  const FOLDERS = [
    { key: "news", label: "News", singular: "news article", type: "news", author: "TGD News Desk" },
    { key: "opinion", label: "Opinion", singular: "opinion piece", type: "opinion", author: "TGD Opinion Desk" },
    { key: "monitoring", label: "Monitoring", singular: "monitoring note", type: "monitoring", author: "TGD Monitoring Desk" },
    { key: "reports", label: "Reports", singular: "report", type: "reports", author: "TGD Research Desk" },
    { key: "profiles", label: "Profiles", singular: "profile", type: "profiles", author: "TGD Research Desk" },
    { key: "pages", label: "Pages", singular: "page", type: "page", author: "" }
  ];
  const SENSITIVITY = ["standard", "elevated", "restricted"];
  const PUBLICATION_STATUS = ["draft", "published"];
  let activeFolder = "news";

  async function renderContent(view) {
    const folder = FOLDERS.find((f) => f.key === activeFolder);
    const sel = el("select", { class: "field inline", onchange: (e) => { activeFolder = e.target.value; renderContent(clearView(view)); } });
    for (const fo of FOLDERS) sel.append(el("option", { value: fo.key, selected: fo.key === activeFolder }, fo.label));
    view.append(pageHead(
      "Articles & Profiles",
      "Create and review research drafts before making them public.",
      el("label", { class: "fld-label", style: "margin:0" }, el("span", {}, "Section"), sel),
      el("button", { class: "btn primary", onclick: () => contentForm(view, null) }, "+ New " + folder.singular)
    ));
    const listEl = el("div", { class: "list" }, el("p", { class: "muted" }, "Loading…"));
    view.append(listEl);
    try {
      const { files } = await api("/content?folder=" + encodeURIComponent(activeFolder));
      clear(listEl);
      if (!files.length) { listEl.append(el("div", { class: "list-empty" }, "No files in this section yet.")); return; }
      for (const file of files) {
        listEl.append(el("div", { class: "row" },
          el("div", { class: "row-main" },
            el("div", { class: "row-title" }, file.slug),
            el("div", { class: "row-meta" }, el("span", {}, file.path), el("span", { class: `chip ${file.status === "published" ? "chip-verified" : ""}` }, file.status === "published" ? "Published" : "Draft"))
          ),
          el("div", { class: "row-actions" },
            file.status === "published"
              ? null
              : el("button", { class: "btn small primary", onclick: () => publishContent(file, view) }, "Publish to website"),
            el("button", { class: "btn small", onclick: () => contentForm(view, file) }, "Edit"),
            el("button", { class: "btn small danger", onclick: () => deleteContent(file, view) }, "Delete")
          )
        ));
      }
    } catch (e) {
      clear(listEl);
      listEl.append(el("p", { class: "err" }, "Could not list files: " + e.message));
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
    const add = (key, label, opts) => {
      let current = fm[key];
      if (Array.isArray(current)) current = current.join(", ");
      const { wrap, input } = makeField(label, opts, current);
      f[key] = input;
      return wrap;
    };

    clear(view);
    view.append(pageHead(
      (file ? "Edit " : "New ") + folder.singular,
      file ? `Editing ${path}` : "Drop a Word document below to auto-fill the form, or write from scratch.",
      el("button", { class: "btn ghost", onclick: () => renderContent(clearView(view)) }, "← Back to list")
    ));

    // ---- Word import drop zone (skip for Pages) ----
    let importCard = null;
    if (activeFolder !== "pages") {
      importCard = makeImportCard(async ({ markdown, title }) => {
        if (!f.title.value && title) f.title.value = title;
        const stripFirstHeading = markdown.replace(/^#+\s+.+\n+/, "");
        if (window.__tgdEditor) {
          window.__tgdEditor.setMarkdown(stripFirstHeading);
        }
        toast("Word document imported. Review and publish when ready.");
      });
    }

    // ---- Tag chips (for non-page collections) ----
    let tagChips = null;

    let form;
    if (activeFolder === "pages") {
      form = el("div", { class: "form" },
        section("Identity", "How the page is named and addressed.",
          add("title", "Title", { required: true, placeholder: "e.g. About TGD" }),
          add("slug", "Slug (URL)", { required: true, default: file ? file.slug : "", placeholder: "about", hint: "Becomes /pages/{slug}/ on the site." }),
          add("eyebrow", "Eyebrow", { optional: true, placeholder: "e.g. About", hint: "Short label shown above the title." }),
          add("summary", "Summary", { type: "textarea", rows: 3, wide: true, optional: true, hint: "One or two sentences used in meta description and previews." })
        ),
        editorSection("Page body", "")
      );
    } else {
      const initialTags = Array.isArray(fm.tags) ? fm.tags : (typeof fm.tags === "string" && fm.tags ? fm.tags.split(/\s*,\s*/) : []);
      tagChips = makeTagChips(initialTags);
      form = el("div", { class: "form" },
        section("Identity", "Title, date, and the desk that filed it. Used in the article header and feed listings.",
          add("title", "Title", { required: true, placeholder: "Headline" }),
          add("date", "Publish date", { type: "date", default: today(), required: true }),
          add("author", "Author / desk", { default: folder.author, hint: "Defaults to the desk for this section." }),
          add("summary", "Summary", { type: "textarea", rows: 3, wide: true, required: true, hint: "Shown in feed cards, search results, and social previews." })
        ),
        section("Classification & tags", "How the article is filed and surfaced.",
          add("category", "Category", { optional: true, placeholder: "e.g. KP, Security operations" }),
          add("region", "Region", { default: "Pakistan", hint: "Geographic region. Used for filtering." }),
          el("div", { class: "fld wide" },
            el("label", { class: "fld-label" }, el("span", {}, "Tags"), el("span", { class: "opt" }, "Optional")),
            tagChips.wrap,
            el("p", { class: "fld-hint" }, "Press Enter or comma to add. Backspace clears the last one. Used for related-article links.")
          ),
          add("sensitivity", "Sensitivity", { select: SENSITIVITY, default: fm.sensitivity || "standard", hint: "“Elevated” adds an editorial note. “Restricted” hides from public listings." }),
          add("status", "Publication status", { select: PUBLICATION_STATUS, default: fm.status || "draft", hint: "Drafts stay private until an editor publishes them." }),
          add("featured", "Feature on homepage", { type: "checkbox", wide: true, hint: "Pins this piece to the homepage hero rail." })
        ),
        editorSection("Article body", "")
      );
      if (fm.featured) f.featured.checked = true;
    }

    if (importCard) view.append(importCard);
    view.append(form);
    view.append(el("div", { class: "form-actions" },
      el("span", { class: "form-hint" }, "Drafts stay private. Published work appears after the site refreshes."),
      el("span", { class: "spacer" }),
      el("button", { class: "btn ghost", onclick: () => renderContent(clearView(view)) }, "Cancel"),
      activeFolder === "pages"
        ? el("button", { class: "btn primary", onclick: () => saveContent({ folder, file, path, sha, f, tagChips }, view) }, file ? "Save changes" : "Save page")
        : el("button", { class: "btn ghost", onclick: () => saveContent({ folder, file, path, sha, f, tagChips }, view, "draft") }, "Save draft"),
      activeFolder === "pages"
        ? null
        : el("button", { class: "btn primary", onclick: () => saveContent({ folder, file, path, sha, f, tagChips }, view, "published") }, "Publish to website")
    ));

    // Mount the WYSIWYG editor into the placeholder div after the DOM is in place.
    const editorMount = document.getElementById("editor-mount");
    if (editorMount) {
      editorMount.innerHTML = '<div class="editor-loading">Loading editor…</div>';
      try {
        const editor = await mountMarkdownEditor(editorMount, body, { height: "560px" });
        window.__tgdEditor = editor;
      } catch (err) {
        editorMount.innerHTML = "";
        const { wrap, input } = makeField("Body (Markdown)", { type: "textarea", rows: 20, mono: true, wide: true, required: true, hint: "Editor failed to load — falling back to raw markdown." }, body);
        editorMount.append(wrap);
        f.__fallbackBody = input;
        toast("Rich editor failed to load — using markdown fallback.", "warn");
      }
    }
  }

  // Section card that holds the editor mount point.
  function editorSection(title, subtitle) {
    return el("section", { class: "card editor-card" },
      el("div", { class: "section-head" },
        el("h3", {}, title),
        subtitle ? el("p", { class: "section-sub" }, subtitle) : null
      ),
      el("div", { class: "editor-workbench" },
        el("aside", { class: "editor-outline", "aria-label": "Document outline" },
          el("div", { class: "editor-outline-title" }, "Outline"),
          el("div", { class: "editor-outline-list" })
        ),
        el("div", { class: "editor-canvas" },
          el("div", { class: "editor-utilitybar" },
            el("span", { class: "editor-stats", "aria-live": "polite" }, "0 words · 1 min read"),
            el("button", { type: "button", class: "editor-focus-btn", "aria-pressed": "false" }, "Focus editor")
          ),
          el("div", { id: "editor-mount", class: "editor-mount" })
        )
      )
    );
  }

  // The blue drop zone at the top of an article form.
  function makeImportCard(onImported) {
    const input = el("input", { type: "file", accept: ".docx", id: "docx-input", style: "display:none" });
    const status = el("p", { class: "import-status muted" }, "Supports .docx files. Images embed automatically.");
    const card = el("section", { class: "card import-card" },
      el("div", { class: "import-head" },
        el("div", {},
          el("h3", { class: "import-title" }, "Import from Word document"),
          el("p", { class: "section-sub" }, "Drag a .docx file here, or click to browse. The system extracts the title, body, formatting, hyperlinks, and embedded images.")
        ),
        el("button", { class: "btn primary", onclick: () => input.click() }, "Choose .docx")
      ),
      el("div", { class: "import-drop", id: "import-drop" },
        el("div", { class: "import-drop-inner" },
          el("div", { class: "import-icon" }, "↑"),
          el("div", { class: "import-drop-text" }, "Drop a Word document anywhere in this box"),
          status
        )
      ),
      input
    );

    async function handleFile(file) {
      if (!file) return;
      if (!/\.docx$/i.test(file.name)) { toast("Please drop a .docx file.", "err"); return; }
      status.textContent = "Reading " + file.name + "…";
      status.classList.remove("muted");
      try {
        const result = await importDocx(file);
        const importedParts = [];
        if (result.tables) importedParts.push(`${result.tables} table${result.tables === 1 ? "" : "s"}`);
        if (result.images) importedParts.push(`${result.images} image${result.images === 1 ? "" : "s"}`);
        status.textContent = `Imported ${file.name}` + (importedParts.length ? ` · ${importedParts.join(", ")}` : "") + (result.warnings.length ? ` (${result.warnings.length} formatting note${result.warnings.length === 1 ? "" : "s"})` : "");
        await onImported(result);
      } catch (err) {
        status.textContent = "Import failed: " + err.message;
        status.classList.add("err");
        toast("Could not import: " + err.message, "err");
      }
    }

    input.addEventListener("change", () => handleFile(input.files[0]));
    setTimeout(() => {
      const drop = document.getElementById("import-drop");
      if (!drop) return;
      ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
      ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("is-over"); }));
      drop.addEventListener("drop", (e) => { const file = e.dataTransfer?.files?.[0]; if (file) handleFile(file); });
    }, 0);

    return card;
  }

  async function saveContent({ folder, file, path, sha, f, tagChips }, view, statusOverride) {
    const title = f.title.value.trim();
    if (!title) return toast("Title is required.", "err");
    const editorBody = window.__tgdEditor ? window.__tgdEditor.getMarkdown() : (f.__fallbackBody ? f.__fallbackBody.value : "");
    let fm, filePath;
    if (folder.key === "pages") {
      const pageSlug = (f.slug.value.trim() || slug(title));
      fm = { title, slug: pageSlug, type: "page", eyebrow: f.eyebrow.value.trim(), summary: f.summary.value.trim() };
      filePath = path || `content/pages/${pageSlug}.md`;
    } else {
      const date = f.date.value || today();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast("Date must be YYYY-MM-DD.", "err");
      const summary = f.summary.value.trim();
      if (!summary) return toast("Summary is required.", "err");
      const tags = tagChips ? tagChips.getTags() : [];
      fm = {
        title, date,
        author: f.author.value.trim() || folder.author,
        type: folder.type,
        category: f.category.value.trim() || "",
        region: f.region.value.trim() || "",
        summary,
        tags,
        access: "free",
        sensitivity: f.sensitivity.value.trim() || "standard",
        status: statusOverride || (f.status.value === "published" ? "published" : "draft"),
        featured: f.featured.checked
      };
      filePath = path || `content/${folder.key}/${date}-${slug(title)}.md`;
    }
    const markdown = buildMarkdown(fm, editorBody);

    try {
      if (!sha) {
        try { const existing = await api("/content/file?path=" + encodeURIComponent(filePath)); sha = existing.sha; } catch {}
      }
      await api("/content/file", { method: "PUT", body: { path: filePath, content: markdown, sha, message: `${file ? "Update" : "Publish"} ${filePath}` } });
      toast(fm.status === "published" ? "Published. Site refreshes shortly." : "Draft saved.");
      // Clean up editor instance to avoid leaks on re-mount
      try { window.__tgdEditor?.destroy(); } catch {}
      window.__tgdEditor = null;
      renderContent(clearView(view));
    } catch (e) { toast(e.message, "err"); }
  }

  async function publishContent(file, view) {
    if (!confirm(`Publish “${file.slug}” to the website? It will become public after the site refreshes.`)) return;
    try {
      const got = await api("/content/file?path=" + encodeURIComponent(file.path));
      const parsed = parseMarkdown(got.content);
      parsed.fm.status = "published";
      await api("/content/file", {
        method: "PUT",
        body: {
          path: file.path,
          content: buildMarkdown(parsed.fm, parsed.body),
          sha: got.sha,
          message: `Publish ${file.path}`
        }
      });
      toast("Published. Site refreshes shortly.");
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
