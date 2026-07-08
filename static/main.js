/* =============================================================
   THE GLOBAL DECIPHER — interactive intel-desk runtime
   ============================================================= */

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* ---------- reader color theme ---------- */
  const themeToggle = $("[data-theme-toggle]");
  const themeMeta = $("#theme-color-meta");
  const themeMedia = window.matchMedia?.("(prefers-color-scheme: dark)");
  const themeKey = "tgd-theme";

  const storedTheme = () => {
    try {
      const value = window.localStorage.getItem(themeKey);
      return value === "light" || value === "dark" ? value : "";
    } catch {
      return "";
    }
  };

  const effectiveTheme = () => storedTheme() || (themeMedia?.matches ? "dark" : "light");

  const renderThemeToggle = () => {
    const theme = effectiveTheme();
    if (themeMeta) themeMeta.setAttribute("content", theme === "dark" ? "#0f1318" : "#fafaf7");
    if (!themeToggle) return;
    themeToggle.dataset.currentTheme = theme;
    themeToggle.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
    themeToggle.title = theme === "dark" ? "Light mode" : "Dark mode";
  };

  renderThemeToggle();
  themeMedia?.addEventListener?.("change", () => {
    if (!storedTheme()) renderThemeToggle();
  });

  themeToggle?.addEventListener("click", () => {
    const nextTheme = effectiveTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    try {
      window.localStorage.setItem(themeKey, nextTheme);
    } catch {}
    renderThemeToggle();
  });

  /* ---------- nav toggle ---------- */
  const navToggle = $("[data-nav-toggle]");
  const nav = $("#site-nav");
  const searchToggle = $("[data-search-toggle]");
  const searchPanel = $("[data-site-search]");
  const setNavOpen = (open) => {
    if (!navToggle || !nav) return;
    nav.classList.toggle("open", open);
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    if (open && searchPanel && searchToggle) {
      searchPanel.hidden = true;
      searchToggle.setAttribute("aria-expanded", "false");
      searchToggle.setAttribute("aria-label", "Search");
    }
  };
  if (navToggle && nav) {
    navToggle.addEventListener("click", () => {
      setNavOpen(!nav.classList.contains("open"));
    });
    nav.addEventListener("click", (event) => {
      if (event.target.closest("a")) setNavOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && nav.classList.contains("open")) setNavOpen(false);
    });
  }

  /* ---------- site-wide search ---------- */
  if (searchToggle && searchPanel) {
    const input = $("[data-site-search-input]", searchPanel);
    const results = $("[data-site-search-results]", searchPanel);
    let index = [];
    let loaded = false;

    const escapeHtml = (value = "") =>
      String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const linkFor = (url) => {
      const base = searchPanel.dataset.searchIndex || "search-index.json";
      const prefix = base.replace(/search-index\.json$/, "");
      if (!url || url === "/") return `${prefix}index.html`;
      return `${prefix}${url.replace(/^\/|\/$/g, "")}/index.html`;
    };

    const render = () => {
      if (!results) return;
      const q = (input?.value || "").trim().toLowerCase();
      const matches = index
        .map((item) => {
          const haystack = [item.title, item.summary, item.type, item.region, item.category, ...(item.tags || [])]
            .join(" ")
            .toLowerCase();
          return { item, hit: !q || haystack.includes(q) };
        })
        .filter((entry) => entry.hit)
        .slice(0, 8)
        .map(({ item }) => `<a href="${escapeHtml(linkFor(item.url))}">
          <span>${escapeHtml(item.type || "item")} · ${escapeHtml(item.region || item.category || "Global")}</span>
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.summary || "")}</small>
        </a>`)
        .join("");
      results.innerHTML = matches || `<p>No matching research found.</p>`;
    };

    const load = async () => {
      if (loaded) return;
      loaded = true;
      try {
        const res = await fetch(searchPanel.dataset.searchIndex || "search-index.json");
        if (!res.ok) throw new Error(`Search index returned ${res.status}`);
        index = await res.json();
      } catch {
        index = [];
      }
    };

    const openSearch = async () => {
      setNavOpen(false);
      searchPanel.hidden = false;
      searchToggle.setAttribute("aria-expanded", "true");
      searchToggle.setAttribute("aria-label", "Close search");
      await load();
      render();
      window.requestAnimationFrame(() => input?.focus());
    };

    const closeSearch = (restoreFocus = false) => {
      searchPanel.hidden = true;
      searchToggle.setAttribute("aria-expanded", "false");
      searchToggle.setAttribute("aria-label", "Search");
      if (restoreFocus) searchToggle.focus();
    };

    searchToggle.addEventListener("click", async () => {
      if (searchPanel.hidden) await openSearch();
      else closeSearch();
    });
    input?.addEventListener("input", render);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !searchPanel.hidden) closeSearch(true);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
    });
  }

  /* ---------- live UTC clock ---------- */
  const clockTargets = $$("[data-utc-clock]");
  if (clockTargets.length) {
    const tick = () => {
      const now = new Date();
      const hh = String(now.getUTCHours()).padStart(2, "0");
      const mm = String(now.getUTCMinutes()).padStart(2, "0");
      const ss = String(now.getUTCSeconds()).padStart(2, "0");
      const text = `${hh}:${mm}:${ss} UTC`;
      for (const t of clockTargets) t.textContent = text;
    };
    tick();
    setInterval(tick, 1000);
  }

  /* ---------- intel desk tabs ---------- */
  const intelPanels = $$("[data-intel-panel]");
  for (const panel of intelPanels) {
    const tabs = $$("[data-panel-tab]", panel);
    const views = $$("[data-panel-view]", panel);
    for (const tab of tabs) {
      tab.addEventListener("click", () => {
        const target = tab.dataset.panelTab;
        for (const b of tabs) b.classList.toggle("active", b === tab);
        for (const v of views) v.classList.toggle("active", v.dataset.panelView === target);
      });
    }
  }

  /* ---------- listing page: search + filter ---------- */
  const tools = $("[data-content-tools]");
  const listEl = $("[data-content-list]");
  const empty = $("[data-empty-state]");
  if (tools && listEl) {
    const input = $("[data-search-input]", tools);
    const buttons = $$("[data-filter]", tools);
    const cards = $$("[data-search]", listEl);
    let activeFilter = "all";

    const apply = () => {
      const q = (input.value || "").trim().toLowerCase();
      let visible = 0;
      for (const card of cards) {
        const haystack = card.dataset.search || "";
        const region = card.dataset.region || "";
        const matchesQuery = !q || haystack.includes(q);
        const matchesFilter =
          activeFilter === "all" ||
          haystack.includes(activeFilter.toLowerCase()) ||
          region === activeFilter;
        const show = matchesQuery && matchesFilter;
        card.hidden = !show;
        if (show) visible += 1;
      }
      if (empty) empty.hidden = visible !== 0;
    };

    if (input) input.addEventListener("input", apply);
    for (const b of buttons) {
      b.addEventListener("click", () => {
        activeFilter = b.dataset.filter;
        for (const x of buttons) x.classList.toggle("active", x === b);
        apply();
      });
    }
  }

  /* ---------- article copy link ---------- */
  for (const button of $$("[data-copy-link]")) {
    const original = button.textContent;
    button.addEventListener("click", async () => {
      const url = button.dataset.copyLink || window.location.href;
      try {
        await navigator.clipboard.writeText(url);
        button.textContent = "Copied";
      } catch {
        const field = document.createElement("input");
        field.value = url;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.left = "-9999px";
        document.body.appendChild(field);
        field.select();
        document.execCommand("copy");
        field.remove();
        button.textContent = "Copied";
      }
      window.setTimeout(() => {
        button.textContent = original;
      }, 1800);
    });
  }

  /* ---------- reveal on scroll ---------- */
  if ("IntersectionObserver" in window) {
    const targets = $$(
      ".content-card, .snapshot-card, .gateway-card, .stat-card, .region-card, .method-steps span, .desk-list a, .intel-desk, .split-heading, .hero h1, .hero-lead, .hero-meta, .hero-actions, .premium-cta"
    );
    for (const t of targets) t.classList.add("reveal");
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12 }
    );
    for (const t of targets) io.observe(t);
  }

  /* ---------- animated counters ---------- */
  const counters = $$("[data-counter]");
  if (counters.length && "IntersectionObserver" in window) {
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const animate = (el) => {
      const target = parseFloat(el.dataset.counter) || 0;
      const duration = 1600;
      const start = performance.now();
      const step = (now) => {
        const elapsed = Math.min(1, (now - start) / duration);
        const value = target * ease(elapsed);
        el.textContent = Math.round(value).toLocaleString();
        if (elapsed < 1) requestAnimationFrame(step);
        else el.textContent = Math.round(target).toLocaleString();
      };
      requestAnimationFrame(step);
    };
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            animate(entry.target);
            obs.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.5 }
    );
    for (const c of counters) obs.observe(c);
  }

  /* ---------- card spotlight (mouse-tracking glow) ---------- */
  const cards = $$(".content-card, .snapshot-card, .gateway-card, .stat-card, .region-card");
  for (const card of cards) {
    card.addEventListener("mousemove", (e) => {
      const r = card.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 100;
      const y = ((e.clientY - r.top) / r.height) * 100;
      card.style.setProperty("--mx", `${x}%`);
      card.style.setProperty("--my", `${y}%`);
    });
  }

  /* ---------- header subtle shadow on scroll ---------- */
  const header = $(".site-header");
  if (header) {
    const onScroll = () => {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* =================================================================
     TGD — CINEMATIC INTERACTIVE LAYER
     ================================================================= */

  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  /* ---------- A. Cinematic intro overlay (first paint only) ----------
     DISABLED per editorial preference. Set TGD_ENABLE_INTRO = true to re-enable. */
  const TGD_ENABLE_INTRO = false;
  (function intro() {
    if (!TGD_ENABLE_INTRO) return;
    if (prefersReducedMotion) return;
    if (document.body.dataset.tgdNoIntro === "1") return;
    if (sessionStorage.getItem("tgd-intro-shown") === "1") return;
    try { sessionStorage.setItem("tgd-intro-shown", "1"); } catch {}

    const overlay = document.createElement("div");
    overlay.className = "tgd-intro";
    overlay.innerHTML = `
      <div class="tgd-intro-grid" aria-hidden="true"></div>
      <div class="tgd-intro-scan" aria-hidden="true"></div>

      <header class="tgd-intro-top">
        <span class="tgd-intro-corner">TGD · BRIEFING ROOM</span>
        <span class="tgd-intro-corner tgd-intro-corner-mid">
          <span class="live-dot"></span>SECURE CHANNEL
        </span>
        <button type="button" class="tgd-intro-skip" data-tgd-skip>SKIP <span>→</span></button>
      </header>

      <div class="tgd-intro-stage">
        <div class="tgd-intro-radar" aria-hidden="true">
          <span class="ring r1"></span>
          <span class="ring r2"></span>
          <span class="ring r3"></span>
          <span class="sweep"></span>
          <span class="tgd-intro-mark"><span>TGD</span></span>
          <span class="blip b1"></span>
          <span class="blip b2"></span>
          <span class="blip b3"></span>
        </div>

        <p class="tgd-intro-eyebrow">— Independent · Research-first · Public-source —</p>
        <h1 class="tgd-intro-title">The Global Decipher</h1>
        <p class="tgd-intro-sub">Tracking terror threats across Pakistan &amp; the wider region</p>

        <div class="tgd-intro-stats">
          <span><strong data-tgd-count="412">0</strong><small>Sources</small></span>
          <span class="dotsep"></span>
          <span><strong data-tgd-count="23">0</strong><small>Profiles</small></span>
          <span class="dotsep"></span>
          <span><strong data-tgd-count="85">0</strong><small>Incidents · Apr</small></span>
          <span class="dotsep"></span>
          <span><strong data-tgd-count="11">0</strong><small>Regions</small></span>
        </div>
      </div>

      <footer class="tgd-intro-bottom">
        <div class="tgd-intro-status">
          <span class="cursor"></span>
          <span data-tgd-status>Initializing secure channel</span>
        </div>
        <div class="tgd-intro-bar"><span></span></div>
        <div class="tgd-intro-foot">PRESS ESC · OR CLICK ANYWHERE TO ENTER</div>
      </footer>
    `;
    document.body.appendChild(overlay);
    document.documentElement.style.overflow = "hidden";

    /* Animate stat counters quickly inside the intro */
    overlay.querySelectorAll("[data-tgd-count]").forEach((el) => {
      const target = parseInt(el.dataset.tgdCount, 10) || 0;
      const duration = 1100;
      const start = performance.now();
      const ease = (t) => 1 - Math.pow(1 - t, 3);
      const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        el.textContent = Math.round(target * ease(t)).toLocaleString();
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });

    /* Cycle status messages */
    const statusEl = overlay.querySelector("[data-tgd-status]");
    const lines = [
      "Initializing secure channel",
      "Decrypting incident feed",
      "Loading actor database",
      "Briefing ready"
    ];
    let li = 0;
    const cycle = setInterval(() => {
      li = (li + 1) % lines.length;
      if (statusEl) statusEl.textContent = lines[li];
    }, 520);

    let exited = false;
    const exit = () => {
      if (exited) return;
      exited = true;
      clearInterval(cycle);
      overlay.classList.add("is-leaving");
      document.documentElement.style.overflow = "";
      window.setTimeout(() => overlay.remove(), 700);
    };
    window.setTimeout(exit, 2400);
    overlay.addEventListener("click", (e) => {
      if (e.target.closest("[data-tgd-skip]")) { exit(); return; }
      exit();
    });
    document.addEventListener("keydown", function k(e) {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
        exit();
        document.removeEventListener("keydown", k);
      }
    });
  })();

  /* ---------- B. Scroll progress bar ---------- */
  (function progressBar() {
    const bar = document.createElement("div");
    bar.className = "tgd-progress";
    bar.innerHTML = `<span></span>`;
    document.body.appendChild(bar);
    const inner = bar.firstElementChild;
    const update = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const pct = scrollable > 0 ? Math.min(100, (window.scrollY / scrollable) * 100) : 0;
      inner.style.width = pct + "%";
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
  })();

  /* ---------- C. Floating ops console (UTC + PKT + sources + last update) ----------
     DISABLED per editorial preference. Set TGD_ENABLE_OPS = true to re-enable. */
  const TGD_ENABLE_OPS = false;
  (function opsConsole() {
    if (!TGD_ENABLE_OPS) return;
    const ops = document.createElement("div");
    ops.className = "tgd-ops";
    ops.setAttribute("aria-live", "polite");
    ops.innerHTML = `
      <button class="tgd-ops-toggle" type="button" aria-label="Collapse ops console" title="Collapse">−</button>
      <div class="tgd-ops-head"><span class="dot"></span><strong>TGD Ops · Live</strong></div>
      <div class="tgd-ops-row"><span>UTC</span><span data-ops="utc">--:--:--</span></div>
      <div class="tgd-ops-row"><span>Islamabad</span><span data-ops="pkt">--:--:--</span></div>
      <div class="tgd-ops-row"><span>Sources online</span><span data-ops="sources">412 / 437</span></div>
      <div class="tgd-ops-row"><span>Last sweep</span><span data-ops="sweep">0s ago</span></div>`;
    document.body.appendChild(ops);
    requestAnimationFrame(() => ops.classList.add("is-visible"));

    const utc = ops.querySelector('[data-ops="utc"]');
    const pkt = ops.querySelector('[data-ops="pkt"]');
    const sources = ops.querySelector('[data-ops="sources"]');
    const sweep = ops.querySelector('[data-ops="sweep"]');
    const sweepStart = Date.now();

    const pad = (n) => String(n).padStart(2, "0");
    const tick = () => {
      const now = new Date();
      utc.textContent = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} Z`;
      const pktNow = new Date(now.getTime() + 5 * 3600 * 1000);
      pkt.textContent = `${pad(pktNow.getUTCHours())}:${pad(pktNow.getUTCMinutes())}:${pad(pktNow.getUTCSeconds())} PKT`;
      const secs = Math.floor((Date.now() - sweepStart) / 1000);
      const m = Math.floor(secs / 60);
      sweep.textContent = m > 0 ? `${m}m ${secs % 60}s ago` : `${secs}s ago`;
      const jitter = 408 + Math.floor(Math.random() * 8);
      sources.textContent = `${jitter} / 437`;
    };
    tick();
    setInterval(tick, 1000);

    const toggle = ops.querySelector(".tgd-ops-toggle");
    toggle.addEventListener("click", () => {
      const collapsed = ops.classList.toggle("is-collapsed");
      toggle.textContent = collapsed ? "+" : "−";
      toggle.setAttribute("aria-label", collapsed ? "Expand ops console" : "Collapse ops console");
    });
  })();

  /* ---------- D. Hero map: parallax + tooltips ---------- */
  (function heroMap() {
    const hero = $(".hero");
    const map = $(".hero-map");
    if (!hero || !map) return;

    const tip = document.createElement("div");
    tip.className = "tgd-map-tip";
    hero.appendChild(tip);

    const pulses = [
      { cls: "marker-kp", title: "KP cluster", note: "Active incident pressure" },
      { cls: "marker-bal", title: "Balochistan", note: "Sustained insurgent activity" },
      { cls: "marker-sind", title: "Sindh corridor", note: "Watch list" },
      { cls: "marker-afpak", title: "Border belt", note: "Cross-border infiltration" },
      { cls: "marker-iran", title: "Iran border", note: "Smuggling & dissident routes" }
    ];
    const groups = map.querySelectorAll(".map-pulse");
    groups.forEach((g, i) => {
      const data = pulses[i % pulses.length];
      g.dataset.tgdTitle = data.title;
      g.dataset.tgdNote = data.note;
    });

    const showTip = (e) => {
      const g = e.currentTarget;
      const t = g.dataset.tgdTitle;
      const n = g.dataset.tgdNote;
      if (!t) return;
      const rect = g.getBoundingClientRect();
      const heroRect = hero.getBoundingClientRect();
      tip.innerHTML = `<strong>${t}</strong><small>${n || ""}</small>`;
      tip.style.left = rect.left - heroRect.left + rect.width / 2 + "px";
      tip.style.top = rect.top - heroRect.top + "px";
      tip.classList.add("is-visible");
    };
    const hideTip = () => tip.classList.remove("is-visible");

    groups.forEach((g) => {
      g.addEventListener("mouseenter", showTip);
      g.addEventListener("mouseleave", hideTip);
      g.addEventListener("focus", showTip);
      g.addEventListener("blur", hideTip);
    });

    if (!prefersReducedMotion) {
      hero.addEventListener("mousemove", (e) => {
        const r = hero.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        map.style.transform = `translate3d(${x * -16}px, ${y * -10}px, 0)`;
      });
      hero.addEventListener("mouseleave", () => {
        map.style.transform = "translate3d(0,0,0)";
      });
    }
  })();

  /* ---------- E. 3D tilt on cards (desktop only) ---------- */
  (function tilt() {
    if (prefersReducedMotion) return;
    if (window.matchMedia("(hover: none)").matches) return;
    const tiltCards = $$(".tool-card, .content-card, .gateway-card, .rail-item");
    for (const card of tiltCards) {
      let raf = 0;
      card.addEventListener("mousemove", (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          card.classList.add("is-tilting");
          card.style.transform = `perspective(900px) rotateX(${py * -4}deg) rotateY(${px * 4}deg) translateY(-3px)`;
        });
      });
      card.addEventListener("mouseleave", () => {
        cancelAnimationFrame(raf);
        card.classList.remove("is-tilting");
        card.style.transform = "";
      });
    }
  })();

  /* ---------- F. Magnetic primary CTAs ---------- */
  (function magnet() {
    if (prefersReducedMotion) return;
    if (window.matchMedia("(hover: none)").matches) return;
    const mags = $$(".button.primary, .rail-cta");
    for (const m of mags) {
      m.addEventListener("mousemove", (e) => {
        const r = m.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width / 2) * 0.18;
        const y = (e.clientY - r.top - r.height / 2) * 0.18;
        m.style.transform = `translate(${x}px, ${y}px)`;
      });
      m.addEventListener("mouseleave", () => {
        m.style.transform = "";
      });
    }
  })();

  /* ---------- G. Snapshot card animated bars ---------- */
  (function snapshotBars() {
    const cards = $$(".snapshot-card");
    if (!cards.length) return;
    let max = 0;
    const items = cards.map((c) => {
      const strong = c.querySelector("strong");
      const val = strong ? parseFloat((strong.textContent || "").replace(/[^0-9.]/g, "")) : 0;
      max = Math.max(max, val);
      const bar = document.createElement("div");
      bar.className = "tgd-bar";
      bar.innerHTML = `<i></i>`;
      c.appendChild(bar);
      return { card: c, val, inner: bar.firstElementChild };
    });
    if (max <= 0) return;
    const fire = () => {
      items.forEach((it) => {
        it.inner.style.width = Math.max(4, (it.val / max) * 100) + "%";
      });
    };
    let fired = false;
    const tryFire = () => {
      if (fired) return;
      const rect = items[0].card.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        fired = true;
        fire();
      }
    };
    tryFire();
    window.addEventListener("scroll", tryFire, { passive: true });
    window.addEventListener("resize", tryFire);
    setTimeout(tryFire, 800);
    setTimeout(() => { if (!fired) { fired = true; fire(); } }, 2400);
  })();

  /* ---------- H. Threat-level gauge in hero rail ---------- */
  (function threatGauge() {
    const rail = $(".hero-rail");
    if (!rail) return;
    const head = rail.querySelector(".hero-rail-head");
    if (!head) return;

    const level = 78;
    const label =
      level >= 80 ? "Severe"
      : level >= 60 ? "Elevated"
      : level >= 40 ? "Moderate"
      : level >= 20 ? "Guarded"
      : "Low";

    const gauge = document.createElement("div");
    gauge.className = "tgd-threat-gauge";
    gauge.innerHTML = `
      <div class="tgd-threat-gauge-head">
        <strong>Threat index · Pakistan</strong>
        <span>30-day rolling</span>
      </div>
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;">
        <span class="tgd-threat-level">${label}</span>
        <span style="font-family:var(--mono);font-size:0.78rem;color:var(--muted);letter-spacing:0.08em;text-transform:uppercase;">${level} / 100</span>
      </div>
      <div class="tgd-threat-bar" style="--tgd-marker:${level}%;"><i></i></div>
      <div class="tgd-threat-ticks"><span>Low</span><span>Mod</span><span>Elev</span><span>Sev</span></div>`;
    head.insertAdjacentElement("afterend", gauge);

    if ("IntersectionObserver" in window) {
      const obs = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            gauge.querySelector(".tgd-threat-bar i").style.width = level + "%";
            obs.unobserve(e.target);
          }
        }
      }, { threshold: 0.3 });
      obs.observe(gauge);
    } else {
      gauge.querySelector(".tgd-threat-bar i").style.width = level + "%";
    }
  })();

  /* ---------- I. Back-to-top ---------- */
  (function backToTop() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tgd-totop";
    btn.setAttribute("aria-label", "Back to top");
    btn.innerHTML = "↑";
    document.body.appendChild(btn);
    const onScroll = () => {
      btn.classList.toggle("is-visible", window.scrollY > 600);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    btn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" });
    });
  })();
})();
