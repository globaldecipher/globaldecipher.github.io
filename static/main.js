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
  if (navToggle && nav) {
    const setNavOpen = (open) => {
      nav.classList.toggle("open", open);
      navToggle.setAttribute("aria-expanded", String(open));
      navToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    };
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
  const searchToggle = $("[data-search-toggle]");
  const searchPanel = $("[data-site-search]");
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
      searchPanel.hidden = false;
      searchToggle.setAttribute("aria-expanded", "true");
      await load();
      render();
      window.requestAnimationFrame(() => input?.focus());
    };

    const closeSearch = () => {
      searchPanel.hidden = true;
      searchToggle.setAttribute("aria-expanded", "false");
    };

    searchToggle.addEventListener("click", async () => {
      if (searchPanel.hidden) await openSearch();
      else closeSearch();
    });
    input?.addEventListener("input", render);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !searchPanel.hidden) closeSearch();
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
      ".content-card, .snapshot-card, .gateway-card, .stat-card, .region-card, .method-steps span, .desk-list a, .intel-desk, .split-heading, .article-body, .article-sidebar, .hero h1, .hero-lead, .hero-meta, .hero-actions, .premium-cta"
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
})();
