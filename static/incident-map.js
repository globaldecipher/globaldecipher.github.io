(function () {
  const root = document.querySelector("[data-incident-tracker]");
  if (!root) return;

  // Incident feed is served dynamically by the Cloudflare Worker (KV-backed),
  // not as a static file. Override with window.TGD_INCIDENTS_URL if the Worker
  // lives on a different host (e.g. a *.workers.dev or api.* subdomain).
  const DATA_URL = window.TGD_INCIDENTS_URL || "/api/incidents";
  const ARCHIVE_URL = "/assets/data/incidents.json?v=20260622-archive2";
  const HUBS_URL = "/assets/data/hubs.json";
  const MAP_URL = "/assets/pakistan-map.svg?v=20260702-kashmir";
  const HUB_INDEX = { organisations: [], regions: [] };
  fetch(HUBS_URL, { cache: "default" })
    .then((res) => res.ok ? res.json() : null)
    .then((data) => {
      if (!data) return;
      HUB_INDEX.organisations = data.organisations || [];
      HUB_INDEX.regions = data.regions || [];
      if (state.loaded) render();
    })
    .catch(() => {});

  function hubSlug(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
  function matchHub(text, kind) {
    const value = String(text || "").trim();
    if (!value) return null;
    const list = kind === "region" ? HUB_INDEX.regions : HUB_INDEX.organisations;
    const slug = hubSlug(value);
    let direct = list.find((h) => h.slug === slug);
    if (direct) return direct;
    const lower = value.toLowerCase();
    let bestPartial = null;
    for (const hub of list) {
      const label = hub.label.toLowerCase();
      if (label.length < 2) continue;
      const re = new RegExp(`(^|[^a-z0-9])${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
      if (re.test(lower)) {
        if (!bestPartial || hub.label.length > bestPartial.label.length) bestPartial = hub;
      }
    }
    return bestPartial;
  }
  function hubLink(label, kind) {
    const text = String(label || "").trim();
    if (!text) return "";
    const hub = matchHub(text, kind);
    if (hub) {
      const base = kind === "region" ? "regions" : "organisations";
      return `<a class="hub-link" href="/${base}/${hub.slug}/">${esc(text)}</a>`;
    }
    return esc(text);
  }
  const TZ = "Asia/Karachi";
  const ARCHIVE_DAYS = 0;
  const DAY_MS = 86400000;
  const PLAYBACK_MS = 1300;
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
    ["azad-jammu-and-kashmir", "Azad Jammu and Kashmir"],
    ["islamabad", "Islamabad Capital Territory"]
  ];
  const PROVINCE_LABELS = new Map(PROVINCES);
  const HOTSPOT_ANCHORS = new Map([
    ["balochistan", [0.45, 0.57]],
    ["khyber-pakhtunkhwa", [0.43, 0.55]],
    ["punjab", [0.46, 0.54]],
    ["sindh", [0.48, 0.52]],
    ["gilgit-baltistan", [0.51, 0.48]],
    ["azad-jammu-and-kashmir", [0.5, 0.5]],
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
    playback: false,
    activeView: "daily",
    selectedProvince: "",
    selectedIncident: "",
    loaded: false,
    filters: { province: "", category: "", severity: "", search: "" }
  };
  let playbackTimer = null;

  const mapFrame = root.querySelector("[data-map]");
  if (mapFrame && !mapFrame.querySelector('[data-province-hotspot="Azad Jammu and Kashmir"]')) {
    const hotspot = document.createElement("div");
    hotspot.className = "province-hotspot hotspot-ajk";
    hotspot.dataset.provinceHotspot = "Azad Jammu and Kashmir";
    hotspot.textContent = "0";
    const credit = mapFrame.querySelector(".tracker-map-credit");
    mapFrame.insertBefore(hotspot, credit || null);
  }

  const els = {
    sourceNote: qs("[data-source-note]"),
    lastUpdated: qs("[data-last-updated]"),
    metrics: qs("[data-metrics]"),
    timeline: qs("[data-timeline]"),
    weekly: qs("[data-weekly-analytics]"),
    mapFrame: qs("[data-map]"),
    mapHost: qs("[data-interactive-map]"),
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
  function archiveStart() { return ARCHIVE_DAYS ? addDays(state.today, -(ARCHIVE_DAYS - 1)) : ""; }
  function playbackStart() { return addDays(state.today, -29); }
  function inArchive(date) {
    const value = ms(date);
    if (!ARCHIVE_DAYS) return Number.isFinite(value) && value <= ms(state.today);
    return Number.isFinite(value) && value >= ms(archiveStart()) && value <= ms(state.today);
  }
  function formatDay(date, compact = false) {
    const value = ms(date);
    if (!Number.isFinite(value)) return date || "today";
    return new Intl.DateTimeFormat("en", { day: "numeric", month: compact ? "short" : "long", year: compact ? undefined : "numeric", timeZone: "UTC" }).format(new Date(value));
  }
  function provinceKey(value) {
    const compact = norm(value).replace(/[^a-z0-9]+/g, "");
    if (!compact) return "";
    if (compact === "kpk" || compact.includes("khyber") || compact.includes("pakhtunkhwa") || compact.includes("fata")) return "khyber-pakhtunkhwa";
    if (compact.includes("baloch") || compact.includes("baluch")) return "balochistan";
    if (compact.includes("sind")) return "sindh";
    if (compact.includes("punjab")) return "punjab";
    if (compact.includes("gilgit")) return "gilgit-baltistan";
    if (compact === "ajk" || compact.includes("azadjammu") || compact.includes("azadkashmir")) return "azad-jammu-and-kashmir";
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
  function playbackDates() { return Array.from({ length: 30 }, (_item, index) => addDays(playbackStart(), index)); }
  function rangeLabel() {
    if (state.mode === "archive") return "HISTORICAL ARCHIVE";
    if (state.mode === "last7") return "LAST 7 DAYS";
    if (state.mode === "last30") return "LAST 30 DAYS";
    if (state.mode === "week") return state.week.toUpperCase();
    return formatDay(state.date).toUpperCase();
  }
  function rangeContext() {
    if (state.mode === "archive") return "in the historical archive";
    if (state.mode === "last7") return "in the last 7 days";
    if (state.mode === "last30") return "in the last 30 days";
    if (state.mode === "week") return `in the ${state.week}`;
    return `on ${formatDay(state.date)}`;
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
    if (state.mode === "archive") return state.archive;
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
    const map = new Map(PROVINCES.map(([key, label]) => [key, { key, label, count: 0, fatalities: 0, injuries: 0, high: 0, districts: new Map(), actors: new Map(), categories: new Map(), split: { forces: 0, terrorists: 0, civilians: 0, total: 0 }, incidents: [] }]));
    items.forEach((incident) => {
      const key = provinceKey(incident.province);
      if (!map.has(key)) return;
      const group = map.get(key);
      const split = fatalityBreakdown(incident);
      group.count += 1;
      group.fatalities += Number(incident.fatalities || 0);
      group.injuries += Number(incident.injuries || 0);
      group.high += severityClass(incident.severity) === "high" ? 1 : 0;
      group.split.forces += split.forces;
      group.split.terrorists += split.terrorists;
      group.split.civilians += split.civilians;
      group.split.total += split.total;
      group.incidents.push(incident);
      addCount(group.districts, incident.district);
      addCount(group.actors, incident.actor || "Unspecified");
      addCount(group.categories, incident.category);
    });
    return map;
  }
  function groupSeverity(group) {
    if (!group?.count) return "none";
    if (group.high || group.fatalities >= 3 || group.injuries >= 5) return "high";
    if (group.fatalities || group.injuries || group.count >= 3) return "medium";
    return "low";
  }
  function trend(group) {
    if (!group.count) return `No incident logged ${rangeContext()}.`;
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
  function confidence(incident) {
    const status = norm(incident.status);
    const source = norm(incident.source);
    if (status.includes("official") || source.includes("ispr") || source.includes("police")) return { label: "Official claim", className: "official" };
    if (incident.verified) return { label: "Verified", className: "verified" };
    if (incident.source_url && !incident.imported) return { label: "Media report", className: "media" };
    return { label: "Initial report", className: "initial" };
  }
  function fatalityPills(split) {
    return `<div class="briefing-split">${FATALITY_GROUPS.map(([key, label]) => `<span><b>${count(split[key] || 0)}</b>${esc(label)}</span>`).join("")}</div>`;
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
      [state.playback ? "Pause timeline" : "Play timeline", "playback", "playback"],
      ["Historical archive", "archive", "archive"],
      ["Today", "date", state.today],
      ["Yesterday", "date", addDays(state.today, -1)],
      ["Last 7 days", "last7", "last7"],
      ["Last 30 days", "last30", "last30"],
      ...dates.map((date) => [formatDay(date, true), "date", date])
    ];
    els.timeline.innerHTML = buttons.map(([label, mode, value]) => {
      if (mode === "playback") return `<button type="button" class="playback-button${state.playback ? " is-active" : ""}" data-playback-toggle>${esc(label)}</button>`;
      const active = (mode === "archive" && state.mode === "archive") || (mode === "last7" && state.mode === "last7") || (mode === "last30" && state.mode === "last30") || (mode === "date" && state.mode === "date" && state.date === value);
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
    const selected = weeks.find((week) => week.label === state.week) || weeks[weeks.length - 1];
    const selectedIdx = weeks.indexOf(selected);
    const previous = selectedIdx > 0 ? weeks[selectedIdx - 1] : null;
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
    const mostActive = monthStats.slice().sort((a, b) => b.count - a.count || a.date.localeCompare(b.date))[0];
    const deadliest = monthStats.slice().sort((a, b) => b.fatalities - a.fatalities || a.date.localeCompare(b.date))[0];
    const summaryItems = [
      ["Most active day", mostActive?.count ? `${formatDay(mostActive.date, true)} (${count(mostActive.count)})` : "None"],
      ["Deadliest day", deadliest?.fatalities ? `${formatDay(deadliest.date, true)} (${count(deadliest.fatalities)})` : "None"],
      ["Most affected district", topLabels(countBy(monthItems, "district"), 1)[0] || "None"],
      ["Top category", topLabels(countBy(monthItems, "category"), 1)[0] || "None"]
    ].map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("");
    const splitStrip = (split) => FATALITY_GROUPS.map(([key, label]) => {
      const value = split[key];
      const width = split.total ? Math.round(value / split.total * 100) : 0;
      return `<div class="archive-split-row"><span>${esc(label)}</span><strong>${count(value)}</strong><i><b style="width:${Math.max(value ? 8 : 0, width)}%"></b></i></div>`;
    }).join("");
    const firstDate = state.archive.map((incident) => incident.date).sort()[0] || state.today;
    els.weekly.innerHTML = `
      <div class="weekly-chart-head"><span>Archive graphs</span><strong>${esc(formatDay(firstDate, true))} to ${esc(formatDay(state.today, true))}</strong><div class="archive-mode-switch"><button type="button" class="${state.archiveMode === "weekly" ? "is-active" : ""}" data-archive-mode="weekly">Weekly</button><button type="button" class="${state.archiveMode === "monthly" ? "is-active" : ""}" data-archive-mode="monthly">Recent days</button></div></div>
      <div class="archive-panel ${state.archiveMode === "monthly" ? "show-monthly" : "show-weekly"}">
        ${groupedWeekChart(weeks)}
        ${weekProfileRich(selected, previous)}
        <article class="weekly-chart-card monthly-archive"><h3>Last 30 days</h3><div class="monthly-summary"><strong>${count(monthItems.length)}</strong><span>incidents</span><strong>${count(monthSplit.total)}</strong><span>fatalities</span></div><div class="monthly-insight-strip">${summaryItems}</div><div class="archive-split">${splitStrip(monthSplit)}</div></article>
        ${calendarHeatmap(monthStats, maxDaily)}
      </div>`;
  }

  function groupedWeekChart(weeks) {
    const maxV = Math.max(...weeks.flatMap((w) => [w.count, w.fatalities, w.injuries]), 1);
    const tickStep = niceStep(maxV);
    const ticks = [];
    for (let v = 0; v <= maxV; v += tickStep) ticks.push(v);
    if (ticks[ticks.length - 1] < maxV) ticks.push(ticks[ticks.length - 1] + tickStep);
    const yMax = ticks[ticks.length - 1] || 1;
    const peakWeek = weeks.reduce((peak, w) => w.fatalities > (peak?.fatalities || -1) ? w : peak, null);
    const W = 640;
    const H = 240;
    const padL = 40, padR = 16, padT = 22, padB = 56;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const slot = innerW / weeks.length;
    const barW = Math.max(8, Math.min(20, (slot - 24) / 3));
    const gap = 3;
    const gridLines = ticks.map((tick) => {
      const y = padT + innerH - (tick / yMax) * innerH;
      return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${tick === 0 ? "#c0baa9" : "#ebe6d8"}" stroke-width="${tick === 0 ? 0.8 : 0.5}" ${tick === 0 ? "" : "stroke-dasharray=\"2 4\""}/><text x="${padL - 6}" y="${y + 3}" font-size="9" font-family="var(--mono)" text-anchor="end" fill="#888780">${count(tick)}</text>`;
    }).join("");
    const groups = weeks.map((week, i) => {
      const cx = padL + slot * i + slot / 2;
      const groupX = cx - (barW * 3 + gap * 2) / 2;
      const isPeak = peakWeek && week.label === peakWeek.label;
      const isSelected = state.mode === "week" && state.week === week.label;
      const bar = (val, idx, fill) => {
        const h = (val / yMax) * innerH;
        const y = padT + innerH - h;
        return `<rect x="${groupX + idx * (barW + gap)}" y="${y}" width="${barW}" height="${Math.max(h, val > 0 ? 1 : 0)}" fill="${fill}"/>`;
      };
      const incidentFill = isSelected ? "#0d1b2a" : "#1a2a3a";
      const fatalityFill = isPeak ? "#b91c2c" : "#A32D2D";
      const labelFill = isPeak ? "#b91c2c" : "#0d1b2a";
      return `<g class="grouped-week" data-week-select="${esc(week.label)}" tabindex="0" role="button" aria-label="${esc(week.label)}: ${count(week.count)} incidents, ${count(week.fatalities)} fatalities, ${count(week.injuries)} injuries">
        <rect x="${cx - slot / 2 + 4}" y="${padT}" width="${slot - 8}" height="${innerH + 24}" fill="transparent" class="grouped-week-hit"/>
        ${bar(week.count, 0, incidentFill)}
        ${bar(week.fatalities, 1, fatalityFill)}
        ${bar(week.injuries, 2, "#a17328")}
        <text x="${cx}" y="${padT + innerH + 18}" text-anchor="middle" font-size="10" font-family="var(--mono)" font-weight="700" fill="${labelFill}">${esc(week.label.replace(/\s*week$/i, "").toUpperCase())}</text>
        ${isPeak ? `<text x="${cx}" y="${padT + innerH + 34}" text-anchor="middle" font-size="9" font-family="var(--mono)" font-weight="700" fill="#b91c2c">PEAK</text>` : ""}
      </g>`;
    }).join("");
    const legend = [
      ["#0d1b2a", "Incidents"],
      ["#A32D2D", "Fatalities"],
      ["#a17328", "Injuries"]
    ].map(([fill, label]) => `<span class="legend-item"><i style="background:${fill}"></i>${esc(label)}</span>`).join("");
    return `<article class="weekly-chart-card grouped-week-chart">
      <div class="grouped-chart-head"><h3>Monthly trend</h3><div class="grouped-chart-legend">${legend}</div></div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Weekly incidents, fatalities, and injuries across the historical archive">
        ${gridLines}
        ${groups}
      </svg>
    </article>`;
  }

  function weekProfileRich(week, previous) {
    const delta = (curr, prev) => {
      if (prev == null) return "";
      const diff = curr - prev;
      if (diff === 0) return `<span class="delta delta-flat">— 0</span>`;
      const cls = diff > 0 ? "delta-up" : "delta-down";
      const sign = diff > 0 ? "↑" : "↓";
      return `<span class="delta ${cls}">${sign} ${count(Math.abs(diff))}</span>`;
    };
    const stat = (label, value, prev) => `<div class="rich-stat"><span>${esc(label)}</span><strong>${count(value)} ${delta(value, prev)}</strong></div>`;
    const splitMax = Math.max(week.split.forces, week.split.terrorists, week.split.civilians, 1);
    const splitRow = (label, value, fill) => {
      const pct = Math.round((value / splitMax) * 100);
      return `<div class="rich-split-row"><span class="rich-split-label">${esc(label)}</span><span class="rich-split-track"><b style="width:${Math.max(value ? 8 : 0, pct)}%; background:${fill}"></b></span><strong>${count(value)}</strong></div>`;
    };
    const tactics = top(week.categories, 4);
    const tacticMax = Math.max(...tactics.map(([, v]) => v), 1);
    const tacticColors = ["#A32D2D", "#a17328", "#2a3a4a", "#6b6b66"];
    const tacticRow = ([label, value], idx) => {
      const pct = Math.round((value / tacticMax) * 100);
      const dot = tacticColors[idx] || "#888780";
      return `<div class="rich-tactic-row"><span class="rich-tactic-label"><i style="background:${dot}"></i>${esc(label)}</span><span class="rich-tactic-track"><b style="width:${Math.max(value ? 8 : 0, pct)}%; background:${dot}"></b></span><strong>${count(value)}</strong></div>`;
    };
    const tacticsHtml = tactics.length
      ? tactics.map(tacticRow).join("")
      : `<p class="rich-empty">No category data for this week.</p>`;
    const prevSummary = previous
      ? `Compared with ${esc(previous.label.toLowerCase())}.`
      : `First archived week.`;
    return `<article class="weekly-chart-card week-profile-rich">
      <div class="rich-head"><h3>${esc(week.label)} profile</h3><span>${esc(prevSummary)}</span></div>
      <div class="rich-stats">
        ${stat("Incidents", week.count, previous?.count)}
        ${stat("Fatalities", week.fatalities, previous?.fatalities)}
        ${stat("Injuries", week.injuries, previous?.injuries)}
        ${stat("Districts", week.districts.size, previous?.districts.size)}
      </div>
      <div class="rich-section">
        <p class="rich-section-title">Who was hit</p>
        ${splitRow("Terrorists", week.split.terrorists, "#A32D2D")}
        ${splitRow("Forces", week.split.forces, "#2a3a4a")}
        ${splitRow("Civilians", week.split.civilians, "#888780")}
      </div>
      <div class="rich-section">
        <p class="rich-section-title">Tactics</p>
        ${tacticsHtml}
      </div>
    </article>`;
  }

  function calendarHeatmap(monthStats, maxDaily) {
    if (!monthStats.length) return "";
    const dows = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const dayCells = monthStats.map((day) => {
      const dt = new Date(`${day.date}T00:00:00Z`);
      const dow = (dt.getUTCDay() + 6) % 7;
      return { ...day, dow, dayNum: dt.getUTCDate(), monthShort: dt.toLocaleString("en", { month: "short", timeZone: "UTC" }) };
    });
    const first = dayCells[0];
    const lead = first.dow;
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    cells.push(...dayCells);
    while (cells.length % 7 !== 0) cells.push(null);
    const cols = cells.length / 7;
    const bucket = (count) => {
      if (!count) return 0;
      const ratio = count / maxDaily;
      if (ratio >= 0.7) return 5;
      if (ratio >= 0.45) return 4;
      if (ratio >= 0.22) return 3;
      if (ratio >= 0.08) return 2;
      return 1;
    };
    const fills = ["#f1efe8", "#FAECE7", "#F5C4B3", "#D85A30", "#993C1D", "#4A1B0C"];
    const cellHtml = cells.map((day, i) => {
      const col = Math.floor(i / 7);
      const row = i % 7;
      if (!day) return `<div class="cal-pad" data-col="${col}" data-row="${row}" aria-hidden="true"></div>`;
      const isActive = state.mode === "date" && state.date === day.date;
      const fill = fills[bucket(day.count)];
      return `<button type="button" class="cal-cell${isActive ? " is-active" : ""}" data-archive-day="${esc(day.date)}" style="background:${fill}; grid-column:${col + 1}; grid-row:${row + 1};" title="${esc(formatDay(day.date))}: ${count(day.count)} incidents, ${count(day.fatalities)} fatalities">
        <span class="cal-num">${day.dayNum}</span>
        ${day.count ? `<strong class="cal-count">${count(day.count)}</strong>` : ""}
      </button>`;
    }).join("");
    const dowLabels = dows.map((d, i) => `<span class="cal-dow" style="grid-column:1; grid-row:${i + 1};">${d}</span>`).join("");
    const legend = fills.slice(1).map((fill) => `<span style="background:${fill}"></span>`).join("");
    return `<article class="weekly-chart-card calendar-heatmap">
      <div class="cal-head"><h3>Recent calendar</h3><div class="cal-legend"><span>Low</span>${legend}<span>High</span></div></div>
      <div class="cal-grid" style="grid-template-columns: 36px repeat(${cols}, minmax(0, 1fr));">
        ${dowLabels}
        ${cellHtml}
      </div>
    </article>`;
  }

  function niceStep(maxV) {
    if (maxV <= 5) return 1;
    if (maxV <= 12) return 2;
    if (maxV <= 30) return 5;
    if (maxV <= 60) return 10;
    if (maxV <= 150) return 25;
    if (maxV <= 300) return 50;
    if (maxV <= 600) return 100;
    return Math.ceil(maxV / 5 / 50) * 50;
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
    const svg = doc.matches?.("svg") ? doc : doc.querySelector?.("svg");
    const viewBox = svg?.viewBox?.baseVal;
    if (!path || !frame || !viewBox?.width || !viewBox?.height) return;
    try {
      const box = path.getBBox();
      const [ax, ay] = HOTSPOT_ANCHORS.get(key) || [0.5, 0.5];
      const objectRect = els.mapHost.getBoundingClientRect();
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
      hotspot.classList.toggle("is-search-match", Boolean(state.filters.search && group?.count));
      ["none", "low", "medium", "high"].forEach((level) => hotspot.classList.toggle(`severity-${level}`, groupSeverity(group) === level));
      hotspot.style.setProperty("--severity-width", `${group?.count ? Math.min(7, 2 + group.high * 1.5) : 1}px`);
      hotspot.title = `${group?.label || hotspot.dataset.provinceHotspot}: ${count(group?.count || 0)} incidents`;
      hotspot.onmouseenter = (event) => showTooltip(group, event);
      hotspot.onmouseleave = hideTooltip;
      hotspot.onclick = () => selectProvince(group?.label || hotspot.dataset.provinceHotspot);
    });
    const doc = els.mapHost;
    const hasInteractiveMap = Boolean(doc?.querySelector("[data-region]"));
    els.mapFrame?.classList.toggle("has-interactive-map", hasInteractiveMap);
    if (hasInteractiveMap) {
      doc.querySelectorAll("[data-region]").forEach((path) => {
        const group = map.get(provinceKey(path.dataset.region));
        const searchMatch = Boolean(state.filters.search && group?.count);
        path.style.fill = color(group?.count || 0);
        path.style.stroke = searchMatch ? "#111827" : group?.count ? "rgba(68, 12, 16, 0.78)" : "rgba(31, 42, 56, 0.34)";
        path.style.strokeWidth = searchMatch ? "2.8" : group?.count ? "1.5" : "1";
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
  function statRaw(label, htmlValue) { return `<div><span>${esc(label)}</span><strong>${htmlValue || "—"}</strong></div>`; }
  function renderDetail() {
    const map = groups();
    const incident = state.filtered.find((item) => item.id === state.selectedIncident);
    if (incident) {
      const source = incident.source_url ? `<a href="${esc(incident.source_url)}" target="_blank" rel="noopener noreferrer">${esc(incident.source || "Open source")}</a>` : `<span>${esc(incident.source || "Source pending")}</span>`;
      const trust = confidence(incident);
      els.detail.innerHTML = `<div class="detail-panel-head"><span>Selected incident</span><button type="button" data-clear-detail>Clear</button></div><h3>${esc(incident.title)}</h3><span class="source-confidence ${esc(trust.className)}">${esc(trust.label)}</span><p>${esc(incident.summary)}</p><div class="detail-stats">${stat("Date", incident.date || "Unknown")}${stat("District", incident.district || "Unknown")}${statRaw("Actor", hubLink(incident.actor || "Unknown", "org"))}${stat("Casualties", casualty(incident))}${stat("Severity", incident.severity || "Unknown")}${stat("Category", incident.category || "Unknown")}</div><div class="detail-source"><span>Source</span>${source}</div>`;
      return;
    }
    const group = state.selectedProvince ? map.get(provinceKey(state.selectedProvince)) : null;
    if (group?.count) {
      const latest = group.incidents[0];
      const topActor = topLabels(group.actors, 1)[0] || "No actor";
      els.detail.innerHTML = `<div class="detail-panel-head"><span>Province briefing</span><button type="button" data-clear-detail>Clear</button></div><h3>${hubLink(group.label, "region")}</h3><p>${esc(trend(group))}</p><div class="briefing-tags"><span>${esc(topLabels(group.districts, 1)[0] || "No district")}</span><span>${hubLink(topActor, "org")}</span><span>${esc(topLabels(group.categories, 1)[0] || "No category")}</span></div>${fatalityPills(group.split)}<div class="detail-stats">${stat("Incidents", count(group.count))}${stat("Fatalities", count(group.fatalities))}${stat("Injuries", count(group.injuries))}${stat("Top districts", topLabels(group.districts, 3).join(", ") || "None")}${statRaw("Main actor", hubLink(topActor, "org"))}${stat("Dominant type", topLabels(group.categories, 1)[0] || "None")}${stat("Latest incident", latest ? `${latest.date} · ${latest.district}` : "None")}${stat("Fatality split", `F ${count(group.split.forces)} / T ${count(group.split.terrorists)} / C ${count(group.split.civilians)}`)}</div>`;
      return;
    }
    const fatalities = state.filtered.reduce((sum, item) => sum + Number(item.fatalities || 0), 0);
    const injuries = state.filtered.reduce((sum, item) => sum + Number(item.injuries || 0), 0);
    const topProvince = Array.from(map.values()).sort((a, b) => b.count - a.count)[0];
    const topActorLabel = topLabels(countBy(state.filtered, "actor"), 1)[0] || "None";
    els.detail.innerHTML = `<div class="detail-panel-head"><span>Daily briefing</span><strong>${esc(rangeLabel())}</strong></div><h3>${count(state.filtered.length)} incident${state.filtered.length === 1 ? "" : "s"} in focus</h3><p>Click a province number, week bar, or incident card to drill into the feed without leaving the map.</p><div class="detail-stats">${stat("Fatalities", count(fatalities))}${stat("Injuries", count(injuries))}${statRaw("Top province", topProvince?.count ? hubLink(topProvince.label, "region") : "None")}${stat("Top district", topLabels(countBy(state.filtered, "district"), 1)[0] || "None")}${statRaw("Top actor", topActorLabel === "None" ? "None" : hubLink(topActorLabel, "org"))}${stat("Archive", "Historical record")}</div>`;
  }
  function renderList() {
    els.resultCount.textContent = `${count(state.filtered.length)} shown`;
    if (!state.filtered.length) {
      const message = state.range.length ? "No incidents match these filters." : state.mode === "date" && !inArchive(state.date) ? "Date is outside the available historical record." : `No incidents logged ${rangeContext()} (Pakistan time).`;
      els.list.innerHTML = `<p class="tracker-empty">${esc(message)}</p>`;
      return;
    }
    els.list.innerHTML = state.filtered.map((incident, index) => {
      const source = incident.source_url ? `<a href="${esc(incident.source_url)}" target="_blank" rel="noopener noreferrer">${esc(incident.source || "Source")}</a>` : `<span>${esc(incident.source || "Source pending")}</span>`;
      const trust = confidence(incident);
      const searchMatch = Boolean(state.filters.search && matches(incident));
      return `<article class="incident-item${incident.id === state.selectedIncident ? " active" : ""}${searchMatch ? " search-matched" : ""}" data-incident-id="${esc(incident.id)}" tabindex="0"><div class="tracker-card-meta"><span>${index + 1}</span><span>${esc(incident.date)}</span><span>${esc(incident.province)}</span><span class="severity-tag ${esc(severityClass(incident.severity))}">${esc(incident.severity || "High")}</span><span class="source-confidence ${esc(trust.className)}">${esc(trust.label)}</span></div><h3>${esc(incident.title)}</h3><p>${esc(incident.summary)}</p><div class="tracker-card-foot"><span>${esc(incident.district)}</span><span>${esc(incident.category)}</span><span>${esc(casualty(incident))}</span><span>${esc(incident.status)}</span>${source}</div></article>`;
    }).join("");
  }
  function renderTabs() {
    els.tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.viewTab === state.activeView));
    els.panels.forEach((panel) => panel.classList.toggle("is-focused", panel.dataset.viewPanel === state.activeView));
  }
  function render(includeTimeline = true) {
    applyFilters();
    populateFilters();
    if (includeTimeline) renderTimeline();
    renderMetrics();
    renderWeekly();
    renderMap();
    renderDetail();
    renderList();
    renderTabs();
    els.sourceNote.textContent = `${count(state.filtered.length)} incident${state.filtered.length === 1 ? "" : "s"} ${rangeContext()}. Historical records remain available on this map.`;
  }
  function stopPlayback(renderControls = true) {
    if (playbackTimer) window.clearInterval(playbackTimer);
    playbackTimer = null;
    state.playback = false;
    if (renderControls) renderTimeline();
  }
  function stepPlayback() {
    const dates = playbackDates();
    const current = dates.indexOf(state.date);
    setDate(dates[(current + 1) % dates.length]);
    state.activeView = "daily";
    render(false);
  }
  function startPlayback() {
    stopPlayback(false);
    const dates = playbackDates();
    if (state.mode !== "date" || !dates.includes(state.date)) setDate(dates[0]);
    state.playback = true;
    render();
    playbackTimer = window.setInterval(stepPlayback, PLAYBACK_MS);
  }

  async function loadMap() {
    if (!els.mapHost) return;
    try {
      const response = await fetch(MAP_URL, { cache: "default" });
      if (!response.ok) throw new Error(`Map request failed: ${response.status}`);
      const parsed = new DOMParser().parseFromString(await response.text(), "image/svg+xml");
      const svg = parsed.documentElement;
      if (svg.nodeName.toLowerCase() !== "svg" || !svg.querySelector("[data-region]")) throw new Error("Map SVG is invalid");
      svg.setAttribute("aria-hidden", "true");
      svg.removeAttribute("role");
      els.mapHost.replaceChildren(document.importNode(svg, true));
      renderMap();
    } catch (_error) {
      els.mapFrame?.classList.remove("has-interactive-map");
    }
  }

  async function loadFeed() {
    try {
      state.today = pkToday();
      const readJson = async (url, options) => {
        const response = await fetch(url, options);
        if (!response.ok) throw new Error(`Feed returned ${response.status}`);
        return response.json();
      };
      const [liveResult, archiveResult] = await Promise.allSettled([
        readJson(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" }),
        readJson(ARCHIVE_URL, { cache: "default" })
      ]);
      const live = liveResult.status === "fulfilled" ? liveResult.value : {};
      const archive = archiveResult.status === "fulfilled" ? archiveResult.value : {};
      const byId = new Map();
      for (const incident of Array.isArray(archive.incidents) ? archive.incidents : []) byId.set(incident.id, incident);
      for (const incident of Array.isArray(live.incidents) ? live.incidents : []) byId.set(incident.id, incident);
      state.all = [...byId.values()].sort((a, b) => text(b.date).localeCompare(text(a.date)) || text(b.reported_at).localeCompare(text(a.reported_at)));
      if (!state.all.length) throw new Error("No incident records are available.");
      state.archive = state.all;
      if (!state.loaded) {
        state.date = state.archive[0]?.date || state.today;
        state.mode = "archive";
      }
      state.loaded = true;
      const latestDate = state.archive[0]?.date;
      els.lastUpdated.textContent = latestDate ? `Data through ${formatDay(latestDate)}` : "No recent records";
      render();
    } catch (error) {
      els.lastUpdated.textContent = "Feed unavailable";
      els.sourceNote.textContent = "The incident feed could not load. Please refresh the page.";
      els.list.innerHTML = `<p class="tracker-empty">${esc(error.message)}</p>`;
    }
  }

  root.addEventListener("click", (event) => {
    const playback = event.target.closest("[data-playback-toggle]");
    if (playback) {
      if (state.playback) stopPlayback();
      else startPlayback();
      return;
    }
    const timeline = event.target.closest("[data-timeline-mode]");
    if (timeline) {
      stopPlayback(false);
      if (timeline.dataset.timelineMode === "archive") {
        state.mode = "archive";
        state.week = "";
        state.selectedIncident = "";
      } else if (timeline.dataset.timelineMode === "last7") {
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
      stopPlayback(false);
      state.archiveMode = archiveMode.dataset.archiveMode === "monthly" ? "monthly" : "weekly";
      renderWeekly();
      return;
    }
    const archiveDay = event.target.closest("[data-archive-day]");
    if (archiveDay) {
      stopPlayback(false);
      setDate(archiveDay.dataset.archiveDay);
      state.activeView = "daily";
      render();
      qs("[data-view-panel='daily']")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const week = event.target.closest("[data-week-select]");
    if (week) {
      stopPlayback(false);
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
      stopPlayback(false);
      state.selectedIncident = card.dataset.incidentId;
      state.selectedProvince = "";
      render();
      els.detail?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (event.target.closest("[data-clear-detail]")) {
      stopPlayback(false);
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
      stopPlayback(false);
      if (field.dataset.filter === "date") setDate(field.value || state.today);
      else state.filters[field.dataset.filter] = field.value;
      state.selectedIncident = "";
      state.selectedProvince = "";
      render();
    });
  });
  window.addEventListener("resize", () => renderMap());
  window.addEventListener("beforeunload", () => stopPlayback(false));
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

  loadMap();
  loadFeed();
})();
