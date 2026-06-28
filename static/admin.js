/* The Global Decipher — admin panel.
   Talks to the Worker API (same origin via the /api/* route). Auth = one shared
   access key, sent as a Bearer token and kept in sessionStorage. */
(function () {
  "use strict";

  const API = window.TGD_API_BASE || "/api";
  const root = document.getElementById("admin-root");
  let KEY = sessionStorage.getItem("tgd_key") || "";

  // ---- theme ----
  const THEME_KEY = "tgd_theme";
  function preferredTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  function applyTheme(theme) {
    document.body.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    document.querySelectorAll(".theme-toggle-btn").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.theme === theme);
    });
    // Toast UI: its "dark" stylesheet only activates when this class is present.
    document.querySelectorAll(".editor-mount").forEach((m) => {
      m.classList.toggle("toastui-editor-dark", theme === "dark");
    });
  }
  applyTheme(preferredTheme());

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
        tabBtn("content", "Articles & Profiles"),
        tabBtn("activity", "Activity")
      ),
      el("div", { class: "topbar-right" }, themeToggle(), maint, el("button", { class: "btn ghost", onclick: logout }, "Log out"))
    );
    const main = el("main", { id: "view", class: "view" });
    root.append(header, main);
    initMaintenance();
    showTab(activeTab);
  }

  function themeToggle() {
    const setTheme = (next) => {
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
    };
    const sun = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
    const moon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    const current = document.body.getAttribute("data-theme") || "dark";
    const wrap = el("div", { class: "theme-toggle", role: "group", "aria-label": "Theme" },
      el("button", {
        type: "button",
        class: "theme-toggle-btn" + (current === "light" ? " is-active" : ""),
        "data-theme": "light",
        title: "Light theme",
        "aria-label": "Light theme",
        html: sun,
        onclick: () => setTheme("light")
      }),
      el("button", {
        type: "button",
        class: "theme-toggle-btn" + (current === "dark" ? " is-active" : ""),
        "data-theme": "dark",
        title: "Dark theme",
        "aria-label": "Dark theme",
        html: moon,
        onclick: () => setTheme("dark")
      })
    );
    return wrap;
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
    else if (id === "activity") renderActivity(view);
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

  function incidentFatalityBreakdown(incident = {}) {
    const source = incident.fatality_breakdown || incident.fatalities_breakdown || incident.fatalities_by || {};
    const value = (...keys) => {
      for (const key of keys) {
        if (source[key] != null && source[key] !== "") return Number(source[key]) || 0;
      }
      return 0;
    };
    const forces = value("forces", "security_forces", "force", "forces_casualties");
    const terrorists = value("terrorists", "militants", "militant", "militants_casualties");
    const civilians = value("civilians", "civilian", "civilian_casualties");
    const total = Number(incident.fatalities) || 0;
    return {
      forces,
      terrorists,
      civilians,
      unclassified: Math.max(0, total - forces - terrorists - civilians)
    };
  }

  async function renderIncidents(view) {
    view.append(pageHead(
      "Incidents",
      "Live feed that powers the public incident map. Edits show up on the map within a minute.",
      el("button", { class: "btn primary", onclick: () => incidentForm(view) }, "+ New incident")
    ));

    const searchInput = el("input", { type: "search", placeholder: "Filter by title, district, category, actor…", "aria-label": "Search incidents" });
    const countEl = el("div", { class: "list-meta" }, "Loading…");
    view.append(el("div", { class: "list-toolbar" },
      el("div", { class: "list-search" }, searchInput),
      countEl
    ));

    const selected = new Set();
    const bulkCount = el("span", { class: "bulk-count" }, "0 selected");
    const bulkBar = el("div", { class: "bulk-bar", id: "incident-bulk-bar" },
      bulkCount,
      el("div", { class: "bulk-actions" },
        el("button", { class: "btn small", onclick: () => bulkVerifyIncidents(true) }, "Verify"),
        el("button", { class: "btn small", onclick: () => bulkVerifyIncidents(false) }, "Unverify"),
        el("button", { class: "btn small", onclick: () => bulkCategorizeIncidents() }, "Re-categorize"),
        el("button", { class: "btn small danger", onclick: () => bulkDeleteIncidents() }, "Delete"),
        el("button", { class: "btn small ghost", onclick: () => clearSelection() }, "Clear")
      )
    );
    view.append(bulkBar);

    const listEl = el("div", { class: "list" }, el("p", { class: "muted" }, "Loading…"));
    view.append(listEl);

    let items = [];

    function clearSelection() {
      selected.clear();
      paintSelection();
    }
    function paintSelection() {
      bulkBar.classList.toggle("is-active", selected.size > 0);
      bulkCount.textContent = `${selected.size} selected`;
      listEl.querySelectorAll(".row").forEach((r) => {
        const id = r.dataset.id;
        const isSel = selected.has(id);
        r.classList.toggle("is-selected", isSel);
        const cb = r.querySelector("input[type=checkbox]");
        if (cb) cb.checked = isSel;
      });
    }

    async function bulkVerifyIncidents(verified) {
      const targets = items.filter((it) => selected.has(it.id));
      if (!targets.length) return;
      try {
        await api("/incidents", { method: "POST", body: { incidents: targets.map((it) => ({ ...it, verified })) } });
        toast(`${targets.length} incident${targets.length === 1 ? "" : "s"} ${verified ? "verified" : "unverified"}.`);
        clearSelection();
        await reload();
      } catch (e) { toast(e.message, "err"); }
    }
    async function bulkDeleteIncidents() {
      const targets = items.filter((it) => selected.has(it.id));
      if (!targets.length) return;
      if (!confirm(`Delete ${targets.length} incident${targets.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
      try {
        for (const it of targets) {
          await api("/incidents/" + encodeURIComponent(it.id), { method: "DELETE" });
        }
        toast(`${targets.length} deleted.`);
        clearSelection();
        await reload();
      } catch (e) { toast(e.message, "err"); }
    }
    async function bulkCategorizeIncidents() {
      const targets = items.filter((it) => selected.has(it.id));
      if (!targets.length) return;
      pickFromList("Re-categorize incidents", "Category to apply to " + targets.length + " selected incident" + (targets.length === 1 ? "" : "s") + ":", CATEGORIES, async (newCat) => {
        if (!newCat) return;
        try {
          await api("/incidents", { method: "POST", body: { incidents: targets.map((it) => ({ ...it, category: newCat })) } });
          toast(`Re-categorized ${targets.length} incident${targets.length === 1 ? "" : "s"} to “${newCat}”.`);
          clearSelection();
          await reload();
        } catch (e) { toast(e.message, "err"); }
      });
    }

    let query = "";
    function renderRows() {
      clear(listEl);
      const q = query.trim().toLowerCase();
      const filtered = !q ? items : items.filter((it) => {
        const hay = [it.title, it.id, it.district, it.province, it.category, it.actor].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      });
      countEl.textContent = q ? `${filtered.length} of ${items.length} incidents` : `${items.length} incidents`;
      if (!filtered.length) {
        listEl.append(el("div", { class: "list-empty" }, q ? "No incidents match this filter." : "No incidents yet. Click “+ New incident” to add one."));
        return;
      }
      for (const it of filtered) {
        const sevChip = it.severity ? el("span", { class: SEV_CHIP[it.severity] || "chip" }, it.severity) : null;
        const verChip = it.verified ? el("span", { class: "chip chip-verified" }, "Verified") : null;
        const metaBits = [];
        metaBits.push(el("span", {}, it.date || "—"));
        metaBits.push(el("span", { class: "dot" }));
        metaBits.push(el("span", {}, [it.district, it.province].filter(Boolean).join(", ") || "Unspecified"));
        if (it.category) { metaBits.push(el("span", { class: "dot" })); metaBits.push(el("span", {}, it.category)); }
        if (sevChip) metaBits.push(sevChip);
        if (verChip) metaBits.push(verChip);
        const checkbox = el("input", {
          type: "checkbox",
          "aria-label": "Select incident",
          onchange: (e) => {
            if (e.target.checked) selected.add(it.id);
            else selected.delete(it.id);
            paintSelection();
          }
        });
        if (selected.has(it.id)) checkbox.checked = true;
        const row = el("div", { class: "row" + (selected.has(it.id) ? " is-selected" : ""), "data-id": it.id },
          el("div", { class: "row-check" }, checkbox),
          el("div", { class: "row-main" },
            el("div", { class: "row-title" }, it.title || it.id),
            el("div", { class: "row-meta" }, ...metaBits)
          ),
          el("div", { class: "row-actions" },
            el("button", { class: "btn small", onclick: () => incidentForm(view, it) }, "Edit"),
            el("button", { class: "btn small danger", onclick: () => deleteIncident(it, view) }, "Delete")
          )
        );
        listEl.append(row);
      }
    }

    async function reload() {
      try {
        const feed = await api("/incidents", { auth: false });
        items = feed.incidents || [];
        renderRows();
      } catch (e) {
        clear(listEl);
        listEl.append(el("p", { class: "err" }, "Could not load feed: " + e.message));
      }
    }

    searchInput.addEventListener("input", () => { query = searchInput.value; renderRows(); });
    await reload();
  }

  function incidentForm(view, existing) {
    const it = existing || {};
    const existingFatalities = incidentFatalityBreakdown(it);
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
        add("security_forces_fatalities", "Security forces fatalities", { type: "number", min: 0, default: existingFatalities.forces, hint: "Confirmed security personnel killed." }),
        add("terrorist_fatalities", "Terrorist fatalities", { type: "number", min: 0, default: existingFatalities.terrorists, hint: "Confirmed terrorists or militants killed." }),
        add("injuries", "Injuries", { type: "number", min: 0, default: 0, hint: "Reported wounded." })
      ),

      // ---- Source & verification ----
      // Source link sits above the verified checkbox so the verification step
      // reads as a consequence of having a source on file.
      section("Source & verification", "Where the report comes from and whether the desk has confirmed it.",
        add("source", "Source name", { default: it.source || "TGD Desk", placeholder: "e.g. Dawn, AFP, TGD Desk", hint: "Outlet or desk that filed the report." }),
        add("source_url", "Source link", { type: "url", optional: true, wide: true, placeholder: "https://…", hint: "Direct link to the article or official statement." }),
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
    const existingFatalities = incidentFatalityBreakdown(existing);
    const forcesFatalities = Number(f.security_forces_fatalities.value) || 0;
    const terroristFatalities = Number(f.terrorist_fatalities.value) || 0;
    const breakdownChanged = forcesFatalities !== existingFatalities.forces || terroristFatalities !== existingFatalities.terrorists;
    const unclassifiedFatalities = breakdownChanged ? 0 : existingFatalities.unclassified;
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
      fatalities: forcesFatalities + terroristFatalities + existingFatalities.civilians + unclassifiedFatalities,
      fatality_breakdown: {
        forces: forcesFatalities,
        terrorists: terroristFatalities,
        civilians: existingFatalities.civilians
      },
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
    // Keep the editor JavaScript, stylesheet, and icon sheet on one known-good
    // version. `latest` can update one asset before the others, leaving the
    // editor usable but its formatting icons blank.
    toastJs: "https://uicdn.toast.com/editor/3.2.2/toastui-editor-all.min.js",
    toastCss: "https://uicdn.toast.com/editor/3.2.2/toastui-editor.min.css",
    toastDarkCss: "https://uicdn.toast.com/editor/3.2.2/theme/toastui-editor-dark.min.css",
    mammothJs: "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js",
    turndownJs: "https://cdn.jsdelivr.net/npm/turndown@7.1.2/dist/turndown.min.js",
    turndownGfmJs: "https://cdn.jsdelivr.net/npm/turndown-plugin-gfm@1.0.2/dist/turndown-plugin-gfm.js",
    jszipJs: "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"
  };
  const _scriptPromises = new Map();
  function loadScript(url) {
    // Cache the *promise* so parallel callers wait for the same load, instead
    // of resolving early on a tag that exists but hasn't executed yet.
    if (_scriptPromises.has(url)) return _scriptPromises.get(url);
    const existing = document.querySelector(`script[data-tgd-src="${url}"]`);
    if (existing && existing.dataset.tgdLoaded === "1") {
      const ready = Promise.resolve();
      _scriptPromises.set(url, ready);
      return ready;
    }
    const p = new Promise((resolve, reject) => {
      const s = existing || document.createElement("script");
      if (!existing) {
        s.src = url; s.async = true; s.dataset.tgdSrc = url;
        document.head.appendChild(s);
      }
      s.addEventListener("load", () => { s.dataset.tgdLoaded = "1"; resolve(); }, { once: true });
      s.addEventListener("error", () => {
        _scriptPromises.delete(url);
        reject(new Error("Failed to load " + url));
      }, { once: true });
    });
    _scriptPromises.set(url, p);
    return p;
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
    const theme = document.body.getAttribute("data-theme") || "dark";
    // Toast UI's dark stylesheet only activates when this class is present.
    container.classList.toggle("toastui-editor-dark", theme === "dark");
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
      theme: theme,
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
    addVisibleEditorToolbar(container, editor);
    decorateEditorToolbar(container);
    addEditorHistoryControls(container, editor);
    setupEditorWorkspace(container, editor);
    setupEditorPasteHandler(container, editor);
    return editor;
  }

  // A labelled toolbar is intentionally kept alongside Toast UI's icon toolbar.
  // It makes the common writing actions obvious (and still usable if a CDN icon
  // sprite is slow to load or blocked by a browser extension).
  function addVisibleEditorToolbar(container, editor) {
    const toolbar = container.querySelector(".toastui-editor-toolbar");
    if (!toolbar || toolbar.querySelector(".editor-format-controls")) return;
    const actions = [
      ["heading", "Heading levels 1 to 3", "H1–H3"],
      ["bold", "Bold", "B"],
      ["italic", "Italic", "I"],
      ["strike", "Strikethrough", "S"],
      ["link", "Insert link", "Link"],
      ["ul", "Bullet list", "• List"],
      ["ol", "Numbered list", "1. List"],
      ["quote", "Quote", "Quote"],
      ["table", "Insert table", "Table"],
      ["image", "Upload image", "Image"]
    ];
    const fontPicker = el("select", {
      class: "editor-font-picker",
      "aria-label": "Editor font",
      title: "Editor font — published articles use the TGD reading font",
      onchange: (event) => applyEditorFont(container, event.target.value)
    },
    el("option", { value: "serif" }, "TGD article font"),
    el("option", { value: "sans" }, "Sans serif"),
    el("option", { value: "mono" }, "Monospace"));
    const controls = el("div", { class: "editor-format-controls", role: "toolbar", "aria-label": "Text formatting" },
      fontPicker,
      actions.map(([action, label, text]) => el("button", {
        type: "button",
        class: `editor-format-btn editor-format-${action}`,
        title: label,
        "aria-label": label,
        onmousedown: (event) => event.preventDefault(),
        onclick: () => runEditorAction(container, editor, action)
      }, text))
    );
    toolbar.prepend(controls);
  }

  function runEditorAction(container, editor, action) {
    editor.focus();
    const nativeAction = { ul: "bullet-list", ol: "ordered-list" }[action] || action;
    const nativeButton = container.querySelector(`.toastui-editor-toolbar-icons.${nativeAction}`);
    if (nativeButton && !nativeButton.disabled) {
      nativeButton.click();
      return;
    }
    // The native button is preferred because it also handles dialogs (links,
    // tables, and uploads). This fallback covers straightforward formatting.
    try { editor.exec(action); } catch {}
  }

  function applyEditorFont(container, font) {
    container.classList.remove("editor-font-serif", "editor-font-sans", "editor-font-mono");
    container.classList.add(`editor-font-${font}`);
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
    // Toast UI Editor exposes history as exec commands. Dispatching a synthetic
    // KeyboardEvent does NOT trigger ProseMirror's history plugin (it only
    // listens to native input events), so call the command directly.
    editor.focus();
    try { editor.exec(redo ? "redo" : "undo"); } catch {}
  }

  // ---------------------------- Word / HTML paste ----------------------------
  // Toast UI's default paste handler chokes on Word's markup (MSO namespaces,
  // nested tables, inline styles), which is why pasted tables vanish or become
  // plain paragraphs. We intercept the paste, scrub the HTML, convert tables
  // through the same pipeline as the .docx import, then drop clean markdown at
  // the cursor.
  function setupEditorPasteHandler(container, editor) {
    const handler = (event) => {
      const clipboardData = event.clipboardData || window.clipboardData;
      if (!clipboardData) return;
      const html = clipboardData.getData("text/html");
      if (!html) return;
      const looksLikeWord = /mso-|MsoNormal|urn:schemas-microsoft-com|<o:p|class="?Mso/i.test(html);
      const hasTable = /<table[\s>]/i.test(html);
      if (!looksLikeWord && !hasTable) return;

      event.preventDefault();
      event.stopPropagation();
      convertAndInsertPastedHtml(editor, html).catch((err) => {
        toast("Couldn't convert pasted content: " + (err?.message || err), "warn");
      });
    };
    // Capture phase so we run before Toast UI / ProseMirror's own paste handlers.
    container.addEventListener("paste", handler, true);
    // Pre-load Turndown so the first paste isn't delayed by a CDN round-trip.
    loadScript(CDN.turndownJs).then(() => loadScript(CDN.turndownGfmJs)).catch(() => {});
  }

  async function convertAndInsertPastedHtml(editor, rawHtml) {
    await loadScript(CDN.turndownJs);
    await loadScript(CDN.turndownGfmJs);
    const markdown = pastedHtmlToMarkdown(rawHtml);
    if (!markdown) return;

    // WYSIWYG's replaceSelection inserts plain text, so the markdown source
    // would appear verbatim. Switch to markdown mode, splice the text in, and
    // switch back — Toast UI re-parses the document on mode change.
    const wasWysiwyg = typeof editor.isWysiwygMode === "function"
      ? editor.isWysiwygMode()
      : editor.getCurrentModeEditor?.()?.constructor?.name !== "MdEditor";
    if (wasWysiwyg && typeof editor.changeMode === "function") {
      editor.changeMode("markdown", true);
    }
    try {
      editor.replaceSelection(markdown);
    } catch {
      const current = editor.getMarkdown ? editor.getMarkdown() : "";
      editor.setMarkdown((current ? current + "\n\n" : "") + markdown, false);
    }
    if (wasWysiwyg && typeof editor.changeMode === "function") {
      editor.changeMode("wysiwyg", true);
    }
    editor.focus();
  }

  function pastedHtmlToMarkdown(rawHtml) {
    // 1. Drop Office conditional comments and namespace tags before parsing —
    //    they survive DOMParser intact and confuse the converter downstream.
    let cleaned = String(rawHtml || "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<\/?(?:o|w|m|v):[^>]*>/gi, "")
      .replace(/<\?xml[^>]*\?>/gi, "");

    const doc = new DOMParser().parseFromString(cleaned, "text/html");

    // 2. Strip Office styling and useless attributes that distort Turndown's
    //    output (mso-*, MsoNormal classes, layout widths, language tags).
    doc.querySelectorAll("*").forEach((node) => {
      node.removeAttribute("style");
      node.removeAttribute("class");
      node.removeAttribute("lang");
      node.removeAttribute("valign");
      node.removeAttribute("align");
      node.removeAttribute("width");
      node.removeAttribute("height");
    });
    // Drop link/meta/style nodes that Word pastes leak into the body.
    doc.querySelectorAll("link, meta, style, script").forEach((n) => n.remove());
    // Collapse empty paragraphs (Word inserts many).
    doc.querySelectorAll("p").forEach((p) => {
      if (!p.textContent.trim() && !p.querySelector("img,br")) p.remove();
    });

    // 3. Tables: route through the docx-import placeholder/restore pipeline so
    //    a clean GFM table replaces Turndown's lossy approximation.
    const pastedTables = [];
    doc.querySelectorAll("table").forEach((table) => {
      const rows = Array.from(table.querySelectorAll("tr"))
        .map((tr) => Array.from(tr.querySelectorAll("td,th"))
          .map((cell) => (cell.textContent || "").replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim()))
        .filter((row) => row.some(Boolean));
      if (rows.length > 1 && rows[0].length > 1) {
        const placeholder = doc.createElement("p");
        placeholder.textContent = `${TABLE_MARKER_PREFIX}${pastedTables.length}${TABLE_MARKER_SUFFIX}`;
        pastedTables.push(rows);
        table.replaceWith(placeholder);
      } else {
        // Single-row or single-column "tables" Word generates for layout —
        // flatten into paragraphs so they don't drop out entirely.
        const wrap = doc.createElement("div");
        rows.forEach((row) => {
          row.filter(Boolean).forEach((text) => {
            const p = doc.createElement("p");
            p.textContent = text;
            wrap.appendChild(p);
          });
        });
        table.replaceWith(wrap);
      }
    });

    const td = new window.TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      emDelimiter: "*",
      bulletListMarker: "-"
    });
    if (window.turndownPluginGfm?.gfm) td.use(window.turndownPluginGfm.gfm);

    const intermediateMarkdown = td.turndown(doc.body.innerHTML);
    return restoreDocxTables(intermediateMarkdown, pastedTables)
      .replace(/\n{3,}/g, "\n\n")
      .trim();
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

  // Marker uses letters+digits only — Turndown escapes `[`, `]`, `_` etc., so
  // the old `[[TGD_TABLE_${i}]]` form survived the round-trip as `\[\[…\]\]`
  // and the restore regex never matched, leaving the placeholder visible.
  const TABLE_MARKER_PREFIX = "TGDXTBLX";
  const TABLE_MARKER_SUFFIX = "XPLHDR";
  function normalizeImportedTables(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    // Turndown's table output and Word's table markup disagree often enough to
    // split a table into ordinary paragraphs. Preserve a stable placeholder;
    // `restoreDocxTables` replaces it with clean Markdown after conversion.
    doc.querySelectorAll("table").forEach((table, index) => {
      const placeholder = doc.createElement("p");
      placeholder.textContent = `${TABLE_MARKER_PREFIX}${index}${TABLE_MARKER_SUFFIX}`;
      table.replaceWith(placeholder);
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
    const tableCell = (value) => String(value || "").replace(/\r?\n+/g, "<br>").replace(/\|/g, "\\|").trim();
    const tableMarkdown = (rows) => {
      const width = Math.max(...rows.map((row) => row.length));
      const normalizedRows = rows.map((row) => Array.from({ length: width }, (_, index) => tableCell(row[index])));
      if (!normalizedRows.length || normalizedRows[0].some((cell) => !cell)) return "";
      return [
        `| ${normalizedRows[0].join(" | ")} |`,
        `| ${normalizedRows[0].map(() => "---").join(" | ")} |`,
        ...normalizedRows.slice(1).map((row) => `| ${row.join(" | ")} |`)
      ].join("\n");
    };
    const newMarker = new RegExp(`${TABLE_MARKER_PREFIX}(\\d+)${TABLE_MARKER_SUFFIX}`, "g");
    // Also handle the legacy escaped bracket form in case older drafts contain it
    const legacyMarker = /\\?\[\\?\[TGD_TABLE_(\d+)\\?\]\\?\]/g;
    return String(markdown || "")
      .replace(newMarker, (_m, index) => tableMarkdown(tables[Number(index)] || []))
      .replace(legacyMarker, (_m, index) => tableMarkdown(tables[Number(index)] || []));
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

    const searchInput = el("input", { type: "search", placeholder: "Filter by title or slug…", "aria-label": "Search content" });
    const countEl = el("div", { class: "list-meta" }, "Loading…");
    view.append(el("div", { class: "list-toolbar" },
      el("div", { class: "list-search" }, searchInput),
      countEl
    ));

    const listEl = el("div", { class: "list" }, el("p", { class: "muted" }, "Loading…"));
    view.append(listEl);

    let files = [];
    let query = "";

    function renderRows() {
      clear(listEl);
      const q = query.trim().toLowerCase();
      const filtered = !q ? files : files.filter((file) => {
        const hay = [file.title, file.slug, file.path].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      });
      countEl.textContent = q ? `${filtered.length} of ${files.length} in ${folder.label.toLowerCase()}` : `${files.length} in ${folder.label.toLowerCase()}`;
      if (!filtered.length) {
        listEl.append(el("div", { class: "list-empty" }, q ? "No files match this filter." : "No files in this section yet."));
        return;
      }
      for (const file of filtered) {
        listEl.append(el("div", { class: "row no-check" },
          el("div", { class: "row-main" },
            el("div", { class: "row-title" }, file.title || file.slug),
            el("div", { class: "row-meta" },
              el("span", {}, file.slug),
              el("span", { class: "dot" }),
              el("span", {}, file.date || file.updated_at?.slice(0, 10) || "—"),
              el("span", { class: `chip ${file.status === "published" ? "chip-verified" : ""}` }, file.status === "published" ? "Published" : "Draft")
            )
          ),
          el("div", { class: "row-actions" },
            file.status === "published"
              ? null
              : el("button", { class: "btn small primary", onclick: () => publishContent(file, view) }, "Publish"),
            el("button", { class: "btn small", onclick: () => contentForm(view, file) }, "Edit"),
            activeFolder === "pages"
              ? null
              : el("button", { class: "btn small", onclick: () => duplicateContent(file, view) }, "Duplicate"),
            el("button", { class: "btn small danger", onclick: () => deleteContent(file, view) }, "Delete")
          )
        ));
      }
    }

    searchInput.addEventListener("input", () => { query = searchInput.value; renderRows(); });

    try {
      const res = await api("/content?folder=" + encodeURIComponent(activeFolder));
      files = res.files || [];
      renderRows();
    } catch (e) {
      clear(listEl);
      listEl.append(el("p", { class: "err" }, "Could not list files: " + e.message));
    }
  }

  async function duplicateContent(file, view) {
    try {
      const got = await api("/content/file?path=" + encodeURIComponent(file.path));
      const parsed = parseMarkdown(got.content);
      // Start the duplicate as an unsaved draft pre-filled from the source.
      // Date moves to today, status drops to draft, "(copy)" is appended so
      // the slug derives differently.
      const fm = { ...parsed.fm };
      fm.title = (fm.title || file.slug) + " (copy)";
      fm.date = today();
      fm.status = "draft";
      fm.featured = false;
      const draft = { fm, body: parsed.body };
      contentForm(view, null, draft);
    } catch (e) { toast("Could not duplicate: " + e.message, "err"); }
  }

  async function contentForm(view, file, seed) {
    const folder = FOLDERS.find((f) => f.key === activeFolder);
    let fm = {}, body = "", sha = null, path = file ? file.path : null;
    if (file) {
      try { const got = await api("/content/file?path=" + encodeURIComponent(file.path)); const p = parseMarkdown(got.content); fm = p.fm; body = p.body; sha = got.sha; }
      catch (e) { return toast("Could not open file: " + e.message, "err"); }
    } else if (seed) {
      fm = seed.fm || {};
      body = seed.body || "";
    }
    // Heal stale table placeholders that escaped the old import bug. The raw
    // table data is gone after a save, so we show a clear instruction instead
    // of a cryptic `[[TGD_TABLE_0]]` token sitting in the rendered body.
    let staleTables = 0;
    body = body.replace(/\\?\[\\?\[TGD_TABLE_(\d+)\\?\]\\?\]/g, (_m, idx) => {
      staleTables++;
      return `> **⚠ Table ${Number(idx) + 1} missing.** Re-drop the original Word file onto the import card above to restore it.`;
    });
    if (staleTables > 0) {
      setTimeout(() => toast(`${staleTables} table${staleTables === 1 ? "" : "s"} need re-importing. Drop the original .docx onto the import card.`, "warn"), 800);
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
    // The editor mounts asynchronously after this point. If the user drops a
    // file during those few seconds, the callback must wait for the editor
    // (or the markdown fallback) to be ready, otherwise `setMarkdown` is a
    // silent no-op and the imported body never reaches the form.
    let editorReadyResolve;
    const editorReady = new Promise((resolve) => { editorReadyResolve = resolve; });
    let importCard = null;
    if (activeFolder !== "pages") {
      importCard = makeImportCard(async ({ markdown, title }) => {
        if (!f.title.value && title) f.title.value = title;
        const stripFirstHeading = markdown.replace(/^#+\s+.+\n+/, "");
        await editorReady;
        if (window.__tgdEditor) {
          window.__tgdEditor.setMarkdown(stripFirstHeading);
        } else if (f.__fallbackBody) {
          f.__fallbackBody.value = stripFirstHeading;
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
    const autosaveStatus = el("span", { class: "autosave-status", id: "autosave-status" },
      el("span", { class: "autosave-dot" }),
      el("span", { class: "autosave-text" }, "Not saved yet")
    );
    view.append(el("div", { class: "form-actions" },
      autosaveStatus,
      el("span", { class: "spacer" }),
      el("button", { class: "btn ghost", onclick: () => { stopAutosave(); renderContent(clearView(view)); } }, "Cancel"),
      activeFolder === "pages"
        ? null
        : el("button", { class: "btn ghost", onclick: () => previewContent({ folder, f, tagChips }) }, "Preview"),
      activeFolder === "pages"
        ? el("button", { class: "btn primary", onclick: () => saveContent({ folder, file, path, sha, f, tagChips }, view) }, file ? "Save changes" : "Save page")
        : el("button", { class: "btn ghost", onclick: () => saveContent({ folder, file, path, sha, f, tagChips }, view, "draft") }, "Save draft"),
      activeFolder === "pages"
        ? null
        : el("button", { class: "btn primary", onclick: () => saveContent({ folder, file, path, sha, f, tagChips }, view, "published") }, "Publish to website")
    ));

    // Wire up summary counter (live char/word count with sweet-spot signal).
    if (f.summary) attachSummaryCounter(f.summary);

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
      // Always release the import gate, whether the editor or its fallback won.
      editorReadyResolve?.();
    } else {
      editorReadyResolve?.();
    }

    // Autosave drafts every ~15s. Pages are always published — skip them.
    if (activeFolder !== "pages") {
      startAutosave({ folder, file, sha, f, tagChips, view });
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
      stopAutosave();
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

  // ============================ SUMMARY COUNTER ============================
  // Live character + word counter for the summary field. The 155-char target
  // matches Google's typical meta-description truncation point.
  function attachSummaryCounter(input) {
    const META_SWEET_SPOT = 155;
    const counter = el("span", { class: "summary-counter" },
      el("span", { class: "chars" }, "0"),
      el("span", { class: "muted" }, "/ 155 chars"),
      el("span", { class: "dot" }),
      el("span", { class: "words" }, "0 words")
    );

    // Slot the counter into the field's label row instead of stacking it below.
    const label = input.closest(".fld")?.querySelector(".fld-label");
    if (label) label.append(counter);

    const update = () => {
      const v = input.value || "";
      const chars = v.length;
      const words = (v.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
      counter.querySelector(".chars").textContent = String(chars);
      counter.querySelector(".words").textContent = `${words} word${words === 1 ? "" : "s"}`;
      counter.classList.remove("is-good", "is-over", "is-way-over");
      if (chars === 0) { /* default */ }
      else if (chars <= META_SWEET_SPOT) counter.classList.add("is-good");
      else if (chars <= META_SWEET_SPOT + 30) counter.classList.add("is-over");
      else counter.classList.add("is-way-over");
    };
    input.addEventListener("input", update);
    update();
  }

  // ============================ AUTOSAVE ============================
  // Polls the editor + form state every 15s; if anything changed since the
  // last save, persists as a draft. Skipped for Pages (which are always
  // published). The timer is cleared on cancel/save to avoid clobbering a
  // future form mount.
  let autosaveTimer = null;
  let lastAutosaveBody = null;
  let lastAutosaveTitle = null;

  function stopAutosave() {
    if (autosaveTimer) clearInterval(autosaveTimer);
    autosaveTimer = null;
    lastAutosaveBody = null;
    lastAutosaveTitle = null;
  }

  function setAutosaveStatus(kind, text) {
    const status = document.getElementById("autosave-status");
    if (!status) return;
    status.classList.remove("is-saving", "is-saved", "is-error");
    if (kind) status.classList.add(`is-${kind}`);
    status.querySelector(".autosave-text").textContent = text;
  }

  function formatRelative(date) {
    const diff = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (diff < 5) return "just now";
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }

  // Probe once per session: is the updated worker live? If not, autosave is
  // disabled (the old worker would treat each tick as a real publish and
  // trigger a Pages rebuild). The check pings /api/audit which only exists in
  // the new worker.
  let workerSupportsAutosave = null;
  async function probeWorkerForAutosave() {
    if (workerSupportsAutosave !== null) return workerSupportsAutosave;
    try {
      await api("/audit?limit=1");
      workerSupportsAutosave = true;
    } catch {
      workerSupportsAutosave = false;
    }
    return workerSupportsAutosave;
  }

  function startAutosave(ctx) {
    stopAutosave();
    let savedAt = null;
    let disabled = false;
    probeWorkerForAutosave().then((ok) => {
      if (!ok) {
        disabled = true;
        setAutosaveStatus(null, "Autosave off (worker pending)");
      }
    });
    const tick = async () => {
      if (disabled) return;
      const title = ctx.f.title?.value?.trim() || "";
      const body = window.__tgdEditor ? window.__tgdEditor.getMarkdown() : (ctx.f.__fallbackBody?.value || "");
      // Need a title to derive a slug. No title → nothing to save yet.
      if (!title) {
        if (!savedAt) setAutosaveStatus(null, "Autosave waits for a title");
        return;
      }
      if (lastAutosaveBody === body && lastAutosaveTitle === title) {
        if (savedAt) setAutosaveStatus("saved", `Saved ${formatRelative(savedAt)}`);
        return;
      }
      setAutosaveStatus("saving", "Saving draft…");
      try {
        await saveDraftQuiet(ctx, title, body);
        savedAt = new Date();
        lastAutosaveBody = body;
        lastAutosaveTitle = title;
        setAutosaveStatus("saved", `Saved ${formatRelative(savedAt)}`);
      } catch (e) {
        setAutosaveStatus("error", "Autosave failed");
      }
    };
    autosaveTimer = setInterval(tick, 15000);
    // Refresh the "Saved Xs ago" label every 5s without re-hitting the API.
    setInterval(() => {
      const status = document.getElementById("autosave-status");
      if (!status || !savedAt || !status.classList.contains("is-saved")) return;
      status.querySelector(".autosave-text").textContent = `Saved ${formatRelative(savedAt)}`;
    }, 5000);
  }

  // Lightweight save for autosave: writes draft status, doesn't redirect or
  // toast, and doesn't trigger a public-site rebuild (the worker only rebuilds
  // for status: "published" entries that change publish state).
  async function saveDraftQuiet(ctx, title, body) {
    const { folder, file, f, tagChips } = ctx;
    const date = f.date?.value || today();
    const tags = tagChips ? tagChips.getTags() : [];
    const fm = {
      title, date,
      author: (f.author?.value || "").trim() || folder.author,
      type: folder.type,
      category: (f.category?.value || "").trim(),
      region: (f.region?.value || "").trim(),
      summary: (f.summary?.value || "").trim(),
      tags,
      access: "free",
      sensitivity: (f.sensitivity?.value || "").trim() || "standard",
      status: "draft",
      featured: Boolean(f.featured?.checked)
    };
    const filePath = (file && file.path) || ctx.path || `content/${folder.key}/${date}-${slug(title)}.md`;
    let sha = ctx.sha;
    if (!sha) {
      try { const existing = await api("/content/file?path=" + encodeURIComponent(filePath)); sha = existing.sha; } catch {}
    }
    const markdown = buildMarkdown(fm, body);
    await api("/content/file", { method: "PUT", body: { path: filePath, content: markdown, sha, message: `Autosave ${filePath}`, autosave: true } });
    // Update ctx so subsequent autosaves work against the existing row.
    ctx.path = filePath;
    ctx.sha = (await api("/content/file?path=" + encodeURIComponent(filePath)).catch(() => ({}))).sha || sha;
  }

  // ============================ PREVIEW ============================
  // Opens a new tab with the current draft rendered into the public article
  // shell. Client-side render — uses the Toast UI markdown-to-HTML pipeline
  // already loaded for the editor, plus a minimal serif layout so it reads the
  // way the published article will.
  function previewContent({ folder, f, tagChips }) {
    const title = f.title?.value?.trim() || "Untitled draft";
    const date = f.date?.value || today();
    const author = f.author?.value?.trim() || folder.author;
    const summary = f.summary?.value?.trim() || "";
    const category = f.category?.value?.trim() || "";
    const tags = tagChips ? tagChips.getTags() : [];
    const body = window.__tgdEditor ? window.__tgdEditor.getHTML() : "";

    const tagsHtml = tags.length ? `<div class="preview-tags">${tags.map((t) => `<span>#${escapeHtml(t)}</span>`).join(" ")}</div>` : "";
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)} — preview</title>
<style>
  body { margin: 0; background: #f6f5f1; color: #1c1a14; font: 17px/1.7 Georgia, "Times New Roman", serif; }
  .banner { background: #d4af5a; color: #1a1407; padding: 10px 24px; font: 600 12px/1 "IBM Plex Mono", monospace; letter-spacing: 0.15em; text-transform: uppercase; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 48px 24px 96px; }
  .eyebrow { font: 600 11px/1 "IBM Plex Mono", monospace; letter-spacing: 0.18em; text-transform: uppercase; color: #9c7b1f; margin-bottom: 16px; }
  h1 { font-size: 38px; line-height: 1.15; margin: 0 0 16px; letter-spacing: -0.01em; }
  .lede { font-size: 18px; line-height: 1.55; color: #3a352a; margin: 0 0 24px; }
  .meta { color: #6b6555; font-size: 13.5px; border-top: 1px solid #e3dfd4; border-bottom: 1px solid #e3dfd4; padding: 12px 0; margin-bottom: 36px; }
  article :is(h2, h3) { margin-top: 1.8em; }
  article p { margin: 1em 0; }
  article blockquote { border-left: 3px solid #d4af5a; margin: 1.5em 0; padding: 4px 0 4px 20px; color: #3a352a; font-style: italic; }
  article img { max-width: 100%; height: auto; border-radius: 6px; }
  article table { width: 100%; border-collapse: collapse; margin: 1.5em 0; font-size: 0.95em; }
  article th, article td { padding: 10px 14px; border-bottom: 1px solid #e3dfd4; text-align: left; vertical-align: top; }
  article th { background: rgba(212, 175, 90, 0.12); }
  .preview-tags { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e3dfd4; color: #6b6555; font: 500 13px/1.4 "IBM Plex Sans", sans-serif; }
  .preview-tags span { margin-right: 12px; }
  @media (prefers-color-scheme: dark) {
    body { background: #0e1116; color: #e6edf3; }
    .lede { color: #c4ccd6; }
    .meta { color: #8b96a5; border-color: #2a323d; }
    .eyebrow { color: #d4af5a; }
    article blockquote { color: #c4ccd6; }
    article th, article td { border-color: #2a323d; }
    article th { background: rgba(212, 175, 90, 0.14); }
    .preview-tags { border-color: #2a323d; color: #8b96a5; }
  }
</style></head>
<body>
  <div class="banner">Preview · not published</div>
  <div class="wrap">
    ${category ? `<div class="eyebrow">${escapeHtml(category)}</div>` : ""}
    <h1>${escapeHtml(title)}</h1>
    ${summary ? `<p class="lede">${escapeHtml(summary)}</p>` : ""}
    <div class="meta">${escapeHtml(author || "")} · ${escapeHtml(date)}</div>
    <article>${body}</article>
    ${tagsHtml}
  </div>
</body></html>`;

    const tab = window.open("", "_blank");
    if (!tab) { toast("Pop-up blocked — allow pop-ups for preview.", "warn"); return; }
    tab.document.open();
    tab.document.write(html);
    tab.document.close();
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ============================ MODAL (small dialog) ============================
  function pickFromList(title, message, options, onPick) {
    const select = el("select", { class: "field" }, ...options.map((o) => el("option", { value: o }, o)));
    const overlay = el("div", { class: "modal-overlay", onclick: (e) => { if (e.target === overlay) close(); } },
      el("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title },
        el("h3", {}, title),
        el("p", { class: "modal-body" }, message),
        select,
        el("div", { class: "modal-actions", style: "margin-top:16px" },
          el("button", { class: "btn ghost", onclick: () => close() }, "Cancel"),
          el("button", { class: "btn primary", onclick: () => { const v = select.value; close(); onPick(v); } }, "Apply")
        )
      )
    );
    function close() { overlay.remove(); document.removeEventListener("keydown", esc); }
    function esc(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", esc);
    document.body.append(overlay);
    select.focus();
  }

  // ============================ ACTIVITY LOG ============================
  async function renderActivity(view) {
    view.append(pageHead(
      "Activity",
      "Every content and incident change, newest first. Single shared key, so “who” is whoever holds it.",
    ));
    const listEl = el("div", { class: "audit-list" }, el("p", { class: "muted" }, "Loading…"));
    view.append(listEl);
    try {
      const { entries } = await api("/audit?limit=200");
      clear(listEl);
      if (!entries.length) {
        listEl.append(el("div", { class: "list-empty" }, "No activity logged yet. New saves, publishes, and deletes will appear here."));
        return;
      }
      for (const e of entries) {
        const when = e.timestamp ? formatAuditTimestamp(e.timestamp) : "—";
        listEl.append(el("div", { class: "audit-row" },
          el("span", { class: "audit-when", title: e.timestamp || "" }, when),
          el("span", { class: `audit-action ${e.action}` }, e.action),
          el("span", { class: "audit-target" }, e.label || e.target || "—"),
          el("span", { class: "audit-kind" }, e.kind || "")
        ));
      }
    } catch (err) {
      clear(listEl);
      listEl.append(el("p", { class: "err" }, "Could not load activity: " + err.message));
    }
  }

  function formatAuditTimestamp(iso) {
    try {
      const d = new Date(iso);
      const today = new Date();
      const sameDay = d.toDateString() === today.toDateString();
      const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (sameDay) return time;
      return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
    } catch { return iso; }
  }

  // ---- boot ----
  if (KEY) api("/admin/ping").then(renderApp).catch(() => renderLogin());
  else renderLogin();
})();
