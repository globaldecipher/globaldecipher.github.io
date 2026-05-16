const navToggle = document.querySelector("[data-nav-toggle]");
const nav = document.querySelector("#site-nav");

if (navToggle && nav) {
  navToggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(open));
  });
}

const tools = document.querySelector("[data-content-tools]");
const list = document.querySelector("[data-content-list]");
const empty = document.querySelector("[data-empty-state]");

if (tools && list) {
  const input = tools.querySelector("[data-search-input]");
  const buttons = [...tools.querySelectorAll("[data-filter]")];
  const cards = [...list.querySelectorAll("[data-search]")];
  let activeFilter = "all";

  const applyFilters = () => {
    const query = input.value.trim().toLowerCase();
    let visible = 0;

    for (const card of cards) {
      const haystack = card.dataset.search || "";
      const region = card.dataset.region || "";
      const matchesSearch = !query || haystack.includes(query);
      const matchesFilter = activeFilter === "all" || haystack.includes(activeFilter.toLowerCase()) || region === activeFilter;
      const show = matchesSearch && matchesFilter;
      card.hidden = !show;
      if (show) visible += 1;
    }

    if (empty) empty.hidden = visible !== 0;
  };

  input.addEventListener("input", applyFilters);

  for (const button of buttons) {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter;
      for (const item of buttons) item.classList.toggle("active", item === button);
      applyFilters();
    });
  }
}

const intelPanel = document.querySelector("[data-intel-panel]");

if (intelPanel) {
  const tabs = [...intelPanel.querySelectorAll("[data-panel-tab]")];
  const views = [...intelPanel.querySelectorAll("[data-panel-view]")];

  for (const tabButton of tabs) {
    tabButton.addEventListener("click", () => {
      const target = tabButton.dataset.panelTab;
      for (const button of tabs) button.classList.toggle("active", button === tabButton);
      for (const view of views) view.classList.toggle("active", view.dataset.panelView === target);
    });
  }
}

const revealTargets = document.querySelectorAll(".content-card, .live-panel, .brand-panel, .method-steps span");

if ("IntersectionObserver" in window) {
  for (const item of revealTargets) item.classList.add("reveal");
  const revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.16 }
  );
  for (const item of revealTargets) revealObserver.observe(item);
}
