/* =============================================================
   THE GLOBAL DECIPHER — interactive intel-desk runtime
   ============================================================= */

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /* ---------- nav toggle ---------- */
  const navToggle = $("[data-nav-toggle]");
  const nav = $("#site-nav");
  if (navToggle && nav) {
    navToggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", String(open));
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

  /* ---------- reveal on scroll ---------- */
  if ("IntersectionObserver" in window) {
    const targets = $$(
      ".content-card, .stat-card, .region-card, .method-steps span, .desk-list a, .intel-desk, .split-heading, .article-body, .hero h1, .hero-lead, .hero-meta, .hero-actions, .premium-cta"
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
  const cards = $$(".content-card, .stat-card, .region-card");
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
