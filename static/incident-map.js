(function () {
  const root = document.querySelector("[data-incident-tracker]");
  if (!root) return;

  const DATA_URL = "/assets/data/incidents.json";
  const TZ = "Asia/Karachi";
  const ARCHIVE_DAYS = 31;
  const DAY_MS = 86400000;
  const FATALITY_GROUPS = [
    ["forces", "Forces"],
    ["terrorists", "Terrorists"],
    ["civilians", "Civilians"]
  ];

  const PROVINCES = [
    ["balochistan", "Balochistan"],
    ["khyber-pakhtunkhwa", "Khyber Pakhtunkhwa"],
    ["punjab", "Punjab"],
    ["sindh", "Sindh"],
    ["gilgit-baltistan", "Gilgit-Baltistan"],
    ["islamabad", "Islamabad Capital Territory"]
  ];
  const PROVINCE_LABELS = new Map(PROVINCES);
  const HOTSPOT_ANCHORS = new Map([
    ["balochistan", [0.45, 0.57]],
    ["khyber-pakhtunkhwa", [0.43, 0.55]],
    ["punjab", [0.46, 0.54]],
    ["sindh", [0.48, 0.52]],
    ["gilgit-baltistan", [0.51, 0.48]],
    ["islamabad", [0.5, 0.5]]
  ]);

  const state = {
    all: [],
    archive: [],
    range: [],
    filtered: [],
    today: pkToday(),
    date: pkToday(),
    mode: "date",
    week: "",
    archiveMode: "weekly",
    fatalityBreakdownOpen: false,
    activeView: "daily",
    selectedProvince: "",
    selectedIncident: "",
    loaded: false,
    filters: { province: "", category: "", severity: "", search: "" }
  };

  const els = {
    sourceNote: qs("[data-source-note]"),
    lastUpdated: qs("[data-last-updated]"),
    metrics: qs("[data-metrics]"),
    timeline: qs("[data-timeline]"),
    weekly: qs("[data-weekly-analytics]"),
    mapObject: qs(".tracker-pakistan-map"),
    mapTitle: qs("[data-map-title]"),
    mapCount: qs("[data-map-count]"),
    tooltip: qs("[data-map-tooltip]"),
    detail: qs("[data-detail-panel]"),
    list: qs("[data-incident-list]"),
    resultCount: qs("[data-result-count]"),
    filters: Array.from(root.querySelectorAll("[data-filter]")),
    tabs: Array.from(root.querySelectorAll("[data-view-tab]")),
    panels: Array.from(root.querySelectorAll("[data-view-panel]")),
    hotspots: Array.from(root.querySelectorAll("[data-province-hotspot]"))
  };

  function qs(selector) { return root.querySelector(selector); }
  function text(value) { return String(value ?? ""); }
  function clean(value) { return text(value).trim(); }
  function norm(value) { return clean(value).toLowerCase(); }
  function esc(value) {
    return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function count(value) { return new Intl.NumberFormat("en").format(Number(value || 0)); }
  function number(value) {
    const valueNumber = Number(value || 0);
    return Number.isFinite(valueNumber) ? valueNumber : 0;
  }
  function pkToday() {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const byType = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  }
  function ms(date) {
    const match = text(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? Date.UTC(+match[1], +match[2] - 1, +match[3]) : NaN;
  }
  function fromMs(value) {
    const date = new Date(value);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }
  function addDays(date, days) { return fromMs(ms(date) + days * DAY_MS); }
  function archiveStart() { return addDays(state.today, -(ARCHIVE_DAYS - 1)); }
  function inArchive(date) {
    const value = ms(date);
    return Number.isFinite(value) && value >= ms(archiveStart()) && value <= ms(state.today);
  }
  function formatDay(date, compact = false) {
    const value = ms(date);
    if (!Number.isFinite(value)) return date || "today";
    return new Intl.DateTimeFormat("en", { day: "numeric", month: compact ? "short" : "long", year: compact ? undefined : "numeric", timeZone: "UTC" }).format(new Date(value));
  }
  function formatUpdated(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value || "Unknown";
    return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: TZ }).format(date);
  }
  function provinceKey(value) {
    const compact = norm(value).replace(/[^a-z0-9]+/g, "");
    if (!compact) return "";
    if (compact === "kpk" || compact.includes("khyber") || compact.includes("pakhtunkhwa") || compact.includes("fata")) return "khyber-pakhtunkhwa";
    if (compact.includes("baloch") || compact.includes("baluch")) return "balochistan";
    if (compact.includes("sind")) return "sindh";
    if (compact.includes("punjab")) return "punjab";
    if (compact.includes("gilgit")) return "gilgit-baltistan";
    if (compact.includes("islamabad") || compact.includes("ict")) return "islamabad";
    return compact;
  }
  function provinceLabel(value) { return PROVINCE_LABELS.get(provinceKey(value)) || clean(value) || "Pakistan"; }
  function severityClass(value) {
    const label = norm(value);
    if (label.includes("low")) return "low";
    if (label.includes("medium")) return "medium";
    return "high";
  }
  function weekLabel(incident) {
    const given = clean(incident.week_label || incident.week);
    if (given) return given;
    const day = Number(text(incident.date).slice(8, 10));
    if (!day) return "Archive week";
    if (day <= 7) return "1st week";
    if (day <= 10) return "2nd week";
    if (day <= 17) return "3rd week";
    if (day <= 24) return "4th week";
    return "5th week";
  }
  function weekOrder(label) { return Number((norm(label).match(/\d+/) || [99])[0]); }
  function addCount(map, key, amount = 1) {
    const label = clean(key);
    if (label) map.set(label, (map.get(label) || 0) + amount);
  }
  function countBy(items, key) {
    const map = new Map();
    items.forEach((item) => addCount(map, item[key] || "Unspecified"));
    return map;
  }
  function top(map, limit = 3) {
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
  }
  function topLabels(map, limit = 3) { return top(map, limit).map(([label]) => label); }
  function rangeLabel() {
    if (state.mode === "last7") return "LAST 7 DAYS";
    if (state.mode === "last30") return "LAST 30 DAYS";
    if (state.mode === "week") return state.week.toUpperCase();
    return formatDay(state.date).toUpperCase();
  }
  function setDate(date) {
    state.mode = "date";
    state.week = "";
    state.date = /^\d{4}-\d{2}-\d{2}$/.test(text(date)) ? date : state.today;
    state.selectedIncident = "";
    const dateInput = els.filters.find((field) => field.dataset.filter === "date");
    if (dateInput) dateInput.value = state.date;
  }

  function selectedRange() {
    if (state.mode === "last7") {
      const start = ms(addDays(state.today, -6));
      const end = ms(state.today);
      return state.archive.filter((incident) => ms(incident.date) >= start && ms(incident.date) <= end);
    }
    if (state.mode === "last30") {
      const start = ms(addDays(state.today, -29));
      const end = ms(state.today);
      return state.archive.filter((incident) => ms(incident.date) >= start && ms(incident.date) <= end);
    }
    if (state.mode === "week") return state.archive.filter((incident) => weekLabel(incident) === state.week);
    return state.archive.filter((incident) => incident.date === state.date);
  }
  function matches(incident) {
    const haystack = [incident.title, incident.district, incident.province, incident.category, incident.actor, incident.status, incident.summary].map(norm).join(" ");
    return (!state.filters.province || incident.province === state.filters.province) &&
      (!state.filters.category || incident.category === state.filters.category) &&
      (!state.filters.severity || incident.severity === state.filters.severity) &&
      (!state.filters.search || haystack.includes(norm(state.filters.search)));
  }
  function applyFilters() {
    state.range = selectedRange();
    state.filtered = state.range.filter(matches);
    if (state.selectedProvince && !state.filtered.some((incident) => provinceLabel(incident.province) === state.selectedProvince)) state.selectedProvince = "";
    if (state.selectedIncident && !state.filtered.some((incident) => incident.id === state.selectedIncident)) state.selectedIncident = "";
  }

  function groups(items = state.filtered) {
    const map = new Map(PROVINCES.map(([key, label]) => [key, { key, label, count: 0, fatalities: 0, injuries: 0, high: 0, districts: new Map(), actors: new Map(), categories: new Map(), incidents: [] }]));
    items.forEach((incident) => {
      const key = provinceKey(incident.province);
      if (!map.has(key)) return;
      const group = map.get(key);
      group.count += 1;
      group.fatalities += Number(incident.fatalities || 0);
      group.injuries += Number(incident.injuries || 0);
      group.high += severityClass(incident.severity) === "high" ? 1 : 0;
      group.incidents.push(incident);
      addCount(group.districts, incident.district);
      addCount(group.actors, incident.actor || "Unspecified");
      addCount(group.categories, incident.category);
    });
    return map;
  }
  function trend(group) {
    if (!group.count) return `No incident logged for ${rangeLabel().toLowerCase()}.`;
    const cats = topLabels(group.categories, 2).join(" ").toLowerCase();
    if (group.fatalities + group.injuries >= 5) return "High-impact reporting in current selection.";
    if (group.high >= 2) return "High-severity activity is concentrated here.";
    if (cats.includes("counterterrorism")) return "Security operations dominate the selection.";
    if (cats.includes("drone") || cats.includes("quadcopter")) return "Drone and quadcopter reporting is active.";
    if (cats.includes("ied") || cats.includes("explosion")) return "Explosive incidents are prominent.";
    return "Comparatively limited activity in the selected feed.";
  }
  function sourceBreakdown(incident) {
    const source = incident.fatality_breakdown || incident.fatalities_breakdown || incident.fatalities_by || {};
    return {
      forces: number(source.forces ?? source.security_forces ?? source.force ?? source.forces_casualties),
      terrorists: number(source.terrorists ?? source.militants ?? source.militant ?? source.militants_casualties),
      civilians: number(source.civilians ?? source.civilian ?? source.civilian_casualties)
    };
  }
  function inferFatalityGroup(incident) {
    const total = number(incident.fatalities);
    if (!total) return "";
    const body = norm([incident.title, incident.summary, incident.category, incident.actor, incident.status].join(" "));
    if ((body.includes("security operation") || body.includes("counterterrorism") || body.includes("security forces")) && /\b(terrorist|militant|insurgent|ttp|iskp|commander)\b/.test(body)) return "terrorists";
    if (/\b(police|policeman|constable|fc|ctd|soldier|sepoy|security personnel|security official|frontier corps|levies)\b/.test(body)) return "forces";
    if (/\b(civilian|student|child|children|tribal elder|teacher|principal|road worker|labourer|laborer|resident|people|person)\b/.test(body)) return "civilians";
    if (/\b(terrorist|militant|insurgent|ttp|iskp|commander)\b/.test(body) && /\b(killed|dead|death)\b/.test(body)) return "terrorists";
    return "";
  }
  function fatalityBreakdown(incident) {
    const total = number(incident.fatalities);
    const split = sourceBreakdown(incident);
    const classified = split.forces + split.terrorists + split.civilians;
    if (!classified && total) {
      const group = inferFatalityGroup(incident);
      if (group) split[group] = total;
    }
    split.total = total;
    split.classified = Math.min(total || classified, split.forces + split.terrorists + split.civilians);
    split.unclassified = Math.max(0, total - split.classified);
    return split;
  }
  function fatalityTotals(items = state.filtered) {
    return items.reduce((totals, incident) => {
      const split = fatalityBreakdown(incident);
      totals.forces += split.forces;
      totals.terrorists += split.terrorists;
      totals.civilians += split.civilians;
      totals.total += split.total;
      totals.classified += split.classified;
      totals.unclassified += split.unclassified;
      return totals;
    }, { forces: 0, terrorists: 0, civilians: 0, total: 0, classified: 0, unclassified: 0 });
  }

  function fillSelect(select, values, allLabel) {
    const current = select.value;
    select.innerHTML = [`<option value="">${esc(allLabel)}</option>`].concat(values.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`)).join("");
    select.value = values.includes(current) ? current : "";
    return select.value;
  }
  function populateFilters() {
    els.filters.forEach((field) => {
      const key = field.dataset.filter;
      if (key === "date") {
        field.min = archiveStart();
        field.max = state.today;
        field.value = state.date;
        return;
      }
      if (field.tagName !== "SELECT") return;
      const values = Array.from(new Set(state.range.map((incident) => incident[key]).filter(Boolean))).sort((a, b) => a.localeCompare(b));
      state.filters[key] = fillSelect(field, values, { province: "All provinces", category: "All categories", severity: "All severities" }[key] || "All");
    });
  }

  function renderTimeline() {
    const dates = Array.from(new Set(state.archive.map((incident) => incident.date))).sort().slice(-31);
    const buttons = [
      ["Today", "date", state.today],
      ["Yesterday", "date", addDays(state.today, -1)],
      ["Last 7 days", "last7", "last7"],
      ["Last 30 days", "last30", "last30"],
      ...dates.map((date) => [formatDay(date, true), "date", date])
    ];
    els.timeline.innerHTML = buttons.map(([label, mode, value]) => {
      const active = (mode === "last7" && state.mode === "last7") || (mode === "last30" && state.mode === "last30") || (mode === "date" && state.mode === "date" && state.date === value);
      return `<button type="button" class="${active ? "is-active" : ""}" data-timeline-mode="${esc(mode)}" data-timeline-value="${esc(value)}">${esc(label)}</button>`;
    }).join("");
  }
  function renderMetrics() {
    const fatalities = state.filtered.reduce((sum, item) => sum + Number(item.fatalities || 0), 0);
    const fatalitySplit = fatalityTotals();
    const injuries = state.filtered.reduce((sum, item) => sum + Number(item.injuries || 0), 0);
    const districts = new Set(state.filtered.map((item) => item.district).filter(Boolean)).size;
    const topProvince = topLabels(countBy(state.filtered, "province"), 1)[0] || "None";
    const high = state.filtered.filter((item) => severityClass(item.severity) === "high").length;
    const metric = (label, value, note, extra = "") => `<article class="tracker-metric"><span class="metric-label">${esc(label)}</span><strong class="metric-value">${count(value)}</strong><span class="metric-note">${esc(note)}</span>${extra}</article>`;
    const splitRows = FATALITY_GROUPS.map(([key, label]) => {
      const value = fatalitySplit[key];
      const width = fatalitySplit.total ? Math.round(value / fatalitySplit.total * 100) : 0;
      return `<div class="fatality-row"><span>${esc(label)}</span><strong>${count(value)}</strong><i><b style="width:${Math.max(value ? 8 : 0, width)}%"></b></i></div>`;
    }).join("");
    const splitNote = fatalitySplit.unclassified ? `<p>${count(fatalitySplit.unclassified)} fatalit${fatalitySplit.unclassified === 1 ? "y" : "ies"} not classified in source rows.</p>` : "";
    els.metrics.innerHTML = [
      ["Incidents", state.filtered.length, rangeLabel()],
      ["Fatalities", fatalities, "Click for Forces / Terrorists / Civilians", `<button class="fatality-toggle" type="button" data-fatality-toggle aria-expanded="${state.fatalityBreakdownOpen ? "true" : "false"}">Breakdown</button><div class="fatality-breakdown${state.fatalityBreakdownOpen ? " is-open" : ""}">${splitRows}${splitNote}</div>`],
      ["Injuries", injuries, "Reported in feed"],
      ["Districts", districts, topProvince],
      ["High severity", high, "Marked for review"]
    ].map(([label, value, note, extra]) => metric(label, value, note, extra)).join("");
  }

  function renderWeekly() {
    const weekMap = new Map();
    state.archive.forEach((incident) => {
      const label = weekLabel(incident);
      if (!weekMap.has(label)) weekMap.set(label, { label, count: 0, fatalities: 0, injuries: 0, provinces: new Map(), districts: new Map(), actors: new Map(), categories: new Map(), split: { forces: 0, terrorists: 0, civilians: 0 } });
      const group = weekMap.get(label);
      const split = fatalityBreakdown(incident);
      group.count += 1;
      group.fatalities += Number(incident.fatalities || 0);
      group.injuries += Number(incident.injuries || 0);
      group.split.forces += split.forces;
      group.split.terrorists += split.terrorists;
      group.split.civilians += split.civilians;
      addCount(group.provinces, incident.province || "Unspecified");
      addCount(group.districts, incident.district || "Unspecified");
      addCount(group.actors, incident.actor || "Unspecified");
      addCount(group.categories, incident.category || "Security incident");
    });
    const weeks = Array.from(weekMap.values()).sort((a, b) => weekOrder(a.label) - weekOrder(b.label) || a.label.localeCompare(b.label));
    if (!weeks.length) { els.weekly.innerHTML = ""; return; }
    const maxIncidents = Math.max(...weeks.map((week) => week.count), 1);
    const maxFatalities = Math.max(...weeks.map((week) => week.fatalities), 1);
    const selected = weeks.find((week) => week.label === state.week) || weeks[weeks.length - 1];
    const weekItems = state.archive.filter((incident) => weekLabel(incident) === selected.label);
    const monthStart = addDays(state.today, -29);
    const monthDays = Array.from({ length: 30 }, (_item, index) => addDays(monthStart, index));
    const byDate = new Map(monthDays.map((date) => [date, { date, count: 0, fatalities: 0, injuries: 0 }]));
    state.archive.forEach((incident) => {
      if (!byDate.has(incident.date)) return;
      const day = byDate.get(incident.date);
      day.count += 1;
      day.fatalities += number(incident.fatalities);
      day.injuries += number(incident.injuries);
    });
    const monthStats = Array.from(byDate.values());
    const monthItems = state.archive.filter((incident) => ms(incident.date) >= ms(monthStart) && ms(incident.date) <= ms(state.today));
    const maxDaily = Math.max(...monthStats.map((day) => day.count), 1);
    const monthSplit = fatalityTotals(monthItems);
    const selectedSplit = FATALITY_GROUPS.map(([key, label]) => `<span><b>${count(selected.split[key])}</b>${esc(label)}</span>`).join("");
    const splitStrip = (split) => FATALITY_GROUPS.map(([key, label]) => {
      const value = split[key];
      const width = split.total ? Math.round(value / split.total * 100) : 0;
      return `<div class="archive-split-row"><span>${esc(label)}</span><strong>${count(value)}</strong><i><b style="width:${Math.max(value ? 8 : 0, width)}%"></b></i></div>`;
    }).join("");
    const row = (week, value, max, detail, type) => `<button type="button" class="weekly-bar-row ${type}${state.mode === "week" && state.week === week.label ? " is-active" : ""}" data-week-select="${esc(week.label)}"><span class="weekly-bar-label">${esc(week.label)}</span><span class="weekly-bar-track"><span style="width:${Math.max(value ? 8 : 0, Math.round(value / max * 100))}%"></span></span><strong>${count(value)}</strong><em>${esc(detail)}</em></button>`;
    const monthHeat = monthStats.map((day) => {
      const active = state.mode === "date" && state.date === day.date;
      const intensity = day.count ? Math.max(18, Math.round(day.count / maxDaily * 100)) : 0;
      return `<button type="button" class="${active ? "is-active" : ""}" data-archive-day="${esc(day.date)}" title="${esc(formatDay(day.date))}: ${count(day.count)} incidents"><span>${esc(formatDay(day.date, true).replace(" ", "\n"))}</span><i style="height:${intensity}%"></i><strong>${count(day.count)}</strong></button>`;
    }).join("");
    els.weekly.innerHTML = `
      <div class="weekly-chart-head"><span>Archive graphs</span><strong>${esc(formatDay(archiveStart(), true))} to ${esc(formatDay(state.today, true))}</strong><div class="archive-mode-switch"><button type="button" class="${state.archiveMode === "weekly" ? "is-active" : ""}" data-archive-mode="weekly">Weekly</button><button type="button" class="${state.archiveMode === "monthly" ? "is-active" : ""}" data-archive-mode="monthly">30 days</button></div></div>
      <div class="archive-panel ${state.archiveMode === "monthly" ? "show-monthly" : "show-weekly"}">
        <article class="weekly-chart-card weekly-bars"><h3>Weekly pace</h3>${weeks.map((week) => row(week, week.count, maxIncidents, topLabels(week.provinces, 1)[0] || "No province", "incident")).join("")}</article>
        <article class="weekly-chart-card weekly-bars"><h3>Weekly fatalities</h3>${weeks.map((week) => row(week, week.fatalities, maxFatalities, `${count(week.injuries)} injured`, "fatality")).join("")}</article>
        <article class="weekly-chart-card weekly-focus"><h3>${esc(selected.label)} profile</h3><strong>${count(selected.count)}</strong><p>${count(selected.fatalities)} fatalities, ${count(selected.injuries)} injuries across ${count(selected.provinces.size)} province${selected.provinces.size === 1 ? "" : "s"}.</p><div class="weekly-split">${selectedSplit}</div><div>${topLabels(selected.categories, 3).map((label) => `<span>${esc(label)}</span>`).join("")}</div></article>
        <article class="weekly-chart-card monthly-archive"><h3>Last 30 days</h3><div class="monthly-summary"><strong>${count(monthItems.length)}</strong><span>incidents</span><strong>${count(monthSplit.total)}</strong><span>fatalities</span></div><div class="archive-split">${splitStrip(monthSplit)}</div></article>
        <article class="weekly-chart-card monthly-heat"><h3>Daily archive</h3><div class="month-heat-grid">${monthHeat}</div></article>
      </div>`;
  }

  function color(count) {
    if (count >= 10) return "#6f090d";
    if (count >= 5) return "#8d1116";
    if (count >= 2) return "#c33a3d";
    if (count >= 1) return "#e5b0b0";
    return "#d9d9d7";
  }
  function svgPath(doc, key) {
    return Array.from(doc.querySelectorAll("[data-region]")).find((path) => provinceKey(path.dataset.region) === key);
  }
  function positionHotspot(doc, hotspot) {
    const key = provinceKey(hotspot.dataset.provinceHotspot);
    const path = svgPath(doc, key);
    const frame = hotspot.closest("[data-map]");
    const viewBox = doc.documentElement?.viewBox?.baseVal;
    if (!path || !frame || !viewBox?.width || !viewBox?.height) return;
    try {
      const box = path.getBBox();
      const [ax, ay] = HOTSPOT_ANCHORS.get(key) || [0.5, 0.5];
      const objectRect = els.mapObject.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      hotspot.style.left = `${objectRect.left - frameRect.left + objectRect.width * ((box.x + box.width * ax - viewBox.x) / viewBox.width)}px`;
      hotspot.style.top = `${objectRect.top - frameRect.top + objectRect.height * ((box.y + box.height * ay - viewBox.y) / viewBox.height)}px`;
    } catch (_error) {}
  }
  function showTooltip(group, event) {
    if (!group || !els.tooltip) return;
    els.tooltip.innerHTML = `<strong>${esc(group.label)}</strong><span>${count(group.count)} incident${group.count === 1 ? "" : "s"}</span><span>${count(group.fatalities)} fatalit${group.fatalities === 1 ? "y" : "ies"}</span><span>Top district: ${esc(topLabels(group.districts, 1)[0] || "None")}</span>`;
    const rect = els.tooltip.closest("[data-map]").getBoundingClientRect();
    els.tooltip.style.left = `${(event?.clientX || rect.left + rect.width / 2) - rect.left}px`;
    els.tooltip.style.top = `${(event?.clientY || rect.top + rect.height / 2) - rect.top}px`;
    els.tooltip.hidden = false;
  }
  function hideTooltip() { if (els.tooltip) els.tooltip.hidden = true; }
  function selectProvince(label) {
    state.selectedProvince = provinceLabel(label);
    state.selectedIncident = "";
    render();
  }
  function renderMap() {
    const map = groups();
    els.mapTitle.textContent = rangeLabel();
    els.mapCount.textContent = `${count(state.filtered.length)} incident${state.filtered.length === 1 ? "" : "s"}`;
    els.hotspots.forEach((hotspot) => {
      const group = map.get(provinceKey(hotspot.dataset.provinceHotspot));
      hotspot.textContent = count(group?.count || 0);
      hotspot.classList.toggle("is-empty", !group?.count);
      hotspot.classList.toggle("is-selected", group?.label === state.selectedProvince);
      hotspot.title = `${group?.label || hotspot.dataset.provinceHotspot}: ${count(group?.count || 0)} incidents`;
      hotspot.onmouseenter = (event) => showTooltip(group, event);
      hotspot.onmouseleave = hideTooltip;
      hotspot.onclick = () => selectProvince(group?.label || hotspot.dataset.provinceHotspot);
    });
    const doc = els.mapObject?.contentDocument;
    if (doc) {
      doc.querySelectorAll("[data-region]").forEach((path) => {
        const group = map.get(provinceKey(path.dataset.region));
        path.style.fill = color(group?.count || 0);
        path.style.stroke = group?.count ? "rgba(68, 12, 16, 0.78)" : "rgba(31, 42, 56, 0.34)";
        path.style.cursor = "pointer";
        path.onmouseenter = (event) => showTooltip(group, event);
        path.onmouseleave = hideTooltip;
        path.onclick = () => selectProvince(group?.label || path.dataset.region);
      });
      els.hotspots.forEach((hotspot) => positionHotspot(doc, hotspot));
    }
  }

  function casualty(incident) { return `${count(incident.fatalities)} killed / ${count(incident.injuries)} injured`; }
  function stat(label, value) { return `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`; }
  function renderDetail() {
    const map = groups();
    const incident = state.filtered.find((item) => item.id === state.selectedIncident);
    if (incident) {
      const source = incident.source_url ? `<a href="${esc(incident.source_url)}" target="_blank" rel="noopener noreferrer">${esc(incident.source || "Open source")}</a>` : `<span>${esc(incident.source || "Source pending")}</span>`;
      els.detail.innerHTML = `<div class="detail-panel-head"><span>Selected incident</span><button type="button" data-clear-detail>Clear</button></div><h3>${esc(incident.title)}</h3><p>${esc(incident.summary)}</p><div class="detail-stats">${stat("Date", incident.date || "Unknown")}${stat("District", incident.district || "Unknown")}${stat("Actor", incident.actor || "Unknown")}${stat("Casualties", casualty(incident))}${stat("Severity", incident.severity || "Unknown")}${stat("Category", incident.category || "Unknown")}</div><div class="detail-source"><span>Source</span>${source}</div>`;
      return;
    }
    const group = state.selectedProvince ? map.get(provinceKey(state.selectedProvince)) : null;
    if (group?.count) {
      els.detail.innerHTML = `<div class="detail-panel-head"><span>Province briefing</span><button type="button" data-clear-detail>Clear</button></div><h3>${esc(group.label)}</h3><p>${esc(trend(group))}</p><div class="detail-stats">${stat("Incidents", count(group.count))}${stat("Fatalities", count(group.fatalities))}${stat("Injuries", count(group.injuries))}${stat("Top districts", topLabels(group.districts, 3).join(", ") || "None")}${stat("Active actors", topLabels(group.actors, 3).join(", ") || "None")}${stat("Latest", group.incidents[0]?.date || "None")}</div>`;
      return;
    }
    const fatalities = state.filtered.reduce((sum, item) => sum + Number(item.fatalities || 0), 0);
    const injuries = state.filtered.reduce((sum, item) => sum + Number(item.injuries || 0), 0);
    const topProvince = Array.from(map.values()).sort((a, b) => b.count - a.count)[0];
    els.detail.innerHTML = `<div class="detail-panel-head"><span>Daily briefing</span><strong>${esc(rangeLabel())}</strong></div><h3>${count(state.filtered.length)} incident${state.filtered.length === 1 ? "" : "s"} in focus</h3><p>Click a province number, week bar, or incident card to drill into the feed without leaving the map.</p><div class="detail-stats">${stat("Fatalities", count(fatalities))}${stat("Injuries", count(injuries))}${stat("Top province", topProvince?.count ? topProvince.label : "None")}${stat("Top district", topLabels(countBy(state.filtered, "district"), 1)[0] || "None")}${stat("Top actor", topLabels(countBy(state.filtered, "actor"), 1)[0] || "None")}${stat("Archive", `${ARCHIVE_DAYS} days`)}</div>`;
  }
  function renderList() {
    els.resultCount.textContent = `${count(state.filtered.length)} shown`;
    if (!state.filtered.length) {
      const message = state.range.length ? "No incidents match these filters." : state.mode === "date" && !inArchive(state.date) ? `Date is outside the ${ARCHIVE_DAYS}-day archive window.` : `No incidents logged for ${rangeLabel().toLowerCase()} Pakistan time yet.`;
      els.list.innerHTML = `<p class="tracker-empty">${esc(message)}</p>`;
      return;
    }
    els.list.innerHTML = state.filtered.map((incident, index) => {
      const source = incident.source_url ? `<a href="${esc(incident.source_url)}" target="_blank" rel="noopener noreferrer">${esc(incident.source || "Source")}</a>` : `<span>${esc(incident.source || "Source pending")}</span>`;
      return `<article class="incident-item${incident.id === state.selectedIncident ? " active" : ""}" data-incident-id="${esc(incident.id)}" tabindex="0"><div class="tracker-card-meta"><span>${index + 1}</span><span>${esc(incident.date)}</span><span>${esc(incident.province)}</span><span class="severity-tag ${esc(severityClass(incident.severity))}">${esc(incident.severity || "High")}</span></div><h3>${esc(incident.title)}</h3><p>${esc(incident.summary)}</p><div class="tracker-card-foot"><span>${esc(incident.district)}</span><span>${esc(incident.category)}</span><span>${esc(casualty(incident))}</span><span>${esc(incident.status)}</span>${source}</div></article>`;
    }).join("");
  }
  function renderTabs() {
    els.tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.viewTab === state.activeView));
    els.panels.forEach((panel) => panel.classList.toggle("is-focused", panel.dataset.viewPanel === state.activeView));
  }
  function render() {
    applyFilters();
    populateFilters();
    renderTimeline();
    renderMetrics();
    renderWeekly();
    renderMap();
    renderDetail();
    renderList();
    renderTabs();
    els.sourceNote.textContent = `${count(state.filtered.length)} incident${state.filtered.length === 1 ? "" : "s"} in ${rangeLabel().toLowerCase()}. Archive keeps the latest ${ARCHIVE_DAYS} Pakistan-time days.`;
  }

  async function loadFeed() {
    try {
      state.today = pkToday();
      const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Feed returned ${response.status}`);
      const data = await response.json();
      state.all = Array.isArray(data.incidents) ? data.incidents.slice().sort((a, b) => text(b.date).localeCompare(text(a.date)) || text(b.reported_at).localeCompare(text(a.reported_at))) : [];
      state.archive = state.all.filter((incident) => inArchive(incident.date));
      if (!state.loaded && !state.archive.some((incident) => incident.date === state.date)) setDate(state.archive[0]?.date || state.today);
      state.loaded = true;
      els.lastUpdated.textContent = `Updated ${formatUpdated(data.last_updated)}`;
      render();
    } catch (error) {
      els.lastUpdated.textContent = "Feed unavailable";
      els.sourceNote.textContent = "The incident feed could not load. Please refresh the page.";
      els.list.innerHTML = `<p class="tracker-empty">${esc(error.message)}</p>`;
    }
  }

  root.addEventListener("click", (event) => {
    const timeline = event.target.closest("[data-timeline-mode]");
    if (timeline) {
      if (timeline.dataset.timelineMode === "last7") {
        state.mode = "last7";
        state.week = "";
        state.selectedIncident = "";
      } else if (timeline.dataset.timelineMode === "last30") {
        state.mode = "last30";
        state.week = "";
        state.selectedIncident = "";
      } else setDate(timeline.dataset.timelineValue);
      render();
      return;
    }
    const fatalityToggle = event.target.closest("[data-fatality-toggle]");
    if (fatalityToggle) {
      state.fatalityBreakdownOpen = !state.fatalityBreakdownOpen;
      renderMetrics();
      return;
    }
    const archiveMode = event.target.closest("[data-archive-mode]");
    if (archiveMode) {
      state.archiveMode = archiveMode.dataset.archiveMode === "monthly" ? "monthly" : "weekly";
      renderWeekly();
      return;
    }
    const archiveDay = event.target.closest("[data-archive-day]");
    if (archiveDay) {
      setDate(archiveDay.dataset.archiveDay);
      state.activeView = "daily";
      render();
      qs("[data-view-panel='daily']")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const week = event.target.closest("[data-week-select]");
    if (week) {
      state.mode = "week";
      state.week = week.dataset.weekSelect;
      state.archiveMode = "weekly";
      state.selectedIncident = "";
      state.activeView = "daily";
      render();
      qs("[data-view-panel='daily']")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const card = event.target.closest("[data-incident-id]");
    if (card) {
      state.selectedIncident = card.dataset.incidentId;
      state.selectedProvince = "";
      render();
      els.detail?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (event.target.closest("[data-clear-detail]")) {
      state.selectedIncident = "";
      state.selectedProvince = "";
      render();
      return;
    }
    const tab = event.target.closest("[data-view-tab]");
    if (tab) {
      state.activeView = tab.dataset.viewTab;
      renderTabs();
      qs(`[data-view-panel="${CSS.escape(state.activeView)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  root.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-incident-id]")) {
      event.preventDefault();
      state.selectedIncident = event.target.dataset.incidentId;
      state.selectedProvince = "";
      render();
    }
  });
  els.filters.forEach((field) => {
    field.addEventListener("input", () => {
      if (field.dataset.filter === "date") setDate(field.value || state.today);
      else state.filters[field.dataset.filter] = field.value;
      state.selectedIncident = "";
      state.selectedProvince = "";
      render();
    });
  });
  els.mapObject?.addEventListener("load", () => renderMap());
  window.addEventListener("resize", () => renderMap());
  window.setInterval(loadFeed, 90000);
  window.setInterval(() => {
    const next = pkToday();
    if (next !== state.today) {
      const previous = state.today;
      state.today = next;
      if (state.date === previous) setDate(next);
      loadFeed();
    }
  }, 30000);

  loadFeed();
})();
