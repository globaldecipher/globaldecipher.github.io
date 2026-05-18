(function () {
  const root = document.querySelector("[data-incident-tracker]");
  if (!root) return;

  const DATA_URL = "/assets/data/incidents.json";
  const BOUNDS = { minLat: 23.4, maxLat: 37.3, minLng: 60.5, maxLng: 78.4 };
  const state = { incidents: [], filtered: [], activeId: "", filters: { province: "", category: "", severity: "", search: "" } };
  const els = {
    sourceNote: root.querySelector("[data-source-note]"),
    lastUpdated: root.querySelector("[data-last-updated]"),
    metrics: root.querySelector("[data-metrics]"),
    markerLayer: root.querySelector("[data-marker-layer]"),
    incidentList: root.querySelector("[data-incident-list]"),
    mapCount: root.querySelector("[data-map-count]"),
    resultCount: root.querySelector("[data-result-count]"),
    filters: Array.from(root.querySelectorAll("[data-filter]"))
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function normalise(value) {
    return String(value || "").trim().toLowerCase();
  }

  function formatCount(value) {
    return new Intl.NumberFormat("en").format(Number(value || 0));
  }

  function formatDate(value) {
    if (!value) return "Unknown";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Karachi"
    }).format(date);
  }

  function severityClass(value) {
    const severity = normalise(value);
    if (severity.includes("low")) return "low";
    if (severity.includes("medium")) return "medium";
    return "high";
  }

  function project(incident) {
    const lng = Number(incident.lng);
    const lat = Number(incident.lat);
    const x = ((lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * 100;
    const y = (1 - ((lat - BOUNDS.minLat) / (BOUNDS.maxLat - BOUNDS.minLat))) * 100;
    return {
      x: Math.max(5, Math.min(95, x)),
      y: Math.max(6, Math.min(94, y))
    };
  }

  function uniqueValues(key) {
    return Array.from(new Set(state.incidents.map((incident) => incident[key]).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  function fillSelect(select, values, allLabel) {
    const current = select.value;
    select.innerHTML = [`<option value="">${escapeHtml(allLabel)}</option>`]
      .concat(values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`))
      .join("");
    select.value = values.includes(current) ? current : "";
  }

  function populateFilters() {
    for (const field of els.filters) {
      const key = field.dataset.filter;
      if (field.tagName !== "SELECT") continue;
      const labels = {
        province: "All provinces",
        category: "All categories",
        severity: "All severities"
      };
      fillSelect(field, uniqueValues(key), labels[key] || "All");
    }
  }

  function matchesFilters(incident) {
    const haystack = [
      incident.title,
      incident.district,
      incident.province,
      incident.category,
      incident.actor,
      incident.status,
      incident.summary
    ].map(normalise).join(" ");
    return (!state.filters.province || incident.province === state.filters.province)
      && (!state.filters.category || incident.category === state.filters.category)
      && (!state.filters.severity || incident.severity === state.filters.severity)
      && (!state.filters.search || haystack.includes(normalise(state.filters.search)));
  }

  function applyFilters() {
    state.filtered = state.incidents.filter(matchesFilters);
  }

  function metric(label, value, note) {
    return `<article class="tracker-metric"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${escapeHtml(value)}</strong><span class="metric-note">${escapeHtml(note)}</span></article>`;
  }

  function renderMetrics() {
    const fatalities = state.filtered.reduce((sum, item) => sum + Number(item.fatalities || 0), 0);
    const injuries = state.filtered.reduce((sum, item) => sum + Number(item.injuries || 0), 0);
    const provinces = new Set(state.filtered.map((item) => item.province).filter(Boolean)).size;
    const high = state.filtered.filter((item) => severityClass(item.severity) === "high").length;
    els.metrics.innerHTML = [
      metric("Incidents", formatCount(state.filtered.length), "Shown after filters"),
      metric("Fatalities", formatCount(fatalities), "Reported in feed"),
      metric("Injuries", formatCount(injuries), "Reported in feed"),
      metric("Provinces", formatCount(provinces), "Current spread"),
      metric("High severity", formatCount(high), "Marked for review")
    ].join("");
  }

  function renderMap() {
    els.markerLayer.innerHTML = state.filtered.map((incident, index) => {
      const point = project(incident);
      const active = incident.id === state.activeId ? " active" : "";
      const severity = severityClass(incident.severity);
      return `<button class="map-marker ${severity}${active}" type="button" style="left:${point.x}%;top:${point.y}%;" data-marker-id="${escapeHtml(incident.id)}" aria-label="${escapeHtml(incident.title)}">${index + 1}</button>`;
    }).join("");
    els.mapCount.textContent = `${formatCount(state.filtered.length)} incident${state.filtered.length === 1 ? "" : "s"}`;
  }

  function renderList() {
    els.resultCount.textContent = `${formatCount(state.filtered.length)} shown`;
    if (!state.filtered.length) {
      els.incidentList.innerHTML = `<p class="tracker-empty">No incidents match these filters.</p>`;
      return;
    }
    els.incidentList.innerHTML = state.filtered.map((incident, index) => {
      const active = incident.id === state.activeId ? " active" : "";
      const casualtyLine = `${formatCount(incident.fatalities)} killed / ${formatCount(incident.injuries)} injured`;
      const source = incident.source_url
        ? `<a href="${escapeHtml(incident.source_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(incident.source || "Source")}</a>`
        : `<span>${escapeHtml(incident.source || "Source pending")}</span>`;
      return `<article class="incident-item${active}" data-incident-id="${escapeHtml(incident.id)}">
        <div class="tracker-card-meta"><span>${index + 1}</span><span>${escapeHtml(incident.date)}</span><span>${escapeHtml(incident.province)}</span><span>${escapeHtml(incident.category)}</span></div>
        <h3>${escapeHtml(incident.title)}</h3>
        <p>${escapeHtml(incident.summary)}</p>
        <div class="tracker-card-foot"><span>${escapeHtml(incident.district)}</span><span>${escapeHtml(incident.severity)}</span><span>${escapeHtml(casualtyLine)}</span><span>${escapeHtml(incident.status)}</span>${source}</div>
      </article>`;
    }).join("");
  }

  function render() {
    applyFilters();
    renderMetrics();
    renderMap();
    renderList();
  }

  function setActive(id) {
    state.activeId = id;
    renderMap();
    renderList();
    const card = root.querySelector(`[data-incident-id="${CSS.escape(id)}"]`);
    if (card) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  async function loadFeed() {
    try {
      const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Feed returned ${response.status}`);
      const data = await response.json();
      state.incidents = Array.isArray(data.incidents)
        ? data.incidents.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
        : [];
      els.sourceNote.textContent = data.source_note || "";
      els.lastUpdated.textContent = `Updated ${formatDate(data.last_updated)}`;
      populateFilters();
      render();
    } catch (error) {
      els.lastUpdated.textContent = "Feed unavailable";
      els.sourceNote.textContent = "The incident feed could not load. Please refresh the page.";
      els.incidentList.innerHTML = `<p class="tracker-empty">${escapeHtml(error.message)}</p>`;
    }
  }

  els.filters.forEach((field) => {
    field.addEventListener("input", () => {
      state.filters[field.dataset.filter] = field.value;
      state.activeId = "";
      render();
    });
  });

  root.addEventListener("click", (event) => {
    const marker = event.target.closest("[data-marker-id]");
    if (marker) setActive(marker.dataset.markerId);
  });

  loadFeed();
  window.setInterval(loadFeed, 90000);
})();
