---
title: "Incident Map"
date: "2026-05-18"
author: "TGD Monitoring Desk"
type: "page"
eyebrow: "Live tracker"
summary: "A public-source incident tracker for security events monitored by The Global Decipher."
---

<style>
@import url("/assets/incident-map.css?v=20260522-direct-archive");
.tracker-controls{grid-template-columns:minmax(150px,.8fr) repeat(3,minmax(0,1fr)) minmax(240px,1.3fr)}
.tracker-analytics{display:grid;gap:12px;border:1px solid var(--line);background:#fff;padding:16px}
.weekly-chart-head{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--line);padding-bottom:12px;font-family:var(--mono);font-weight:900;text-transform:uppercase;letter-spacing:.1em}
.weekly-chart-head span{color:var(--red);font-size:.7rem}.weekly-chart-head strong{font-size:.7rem;color:var(--muted)}
.weekly-chart-grid{display:grid;grid-template-columns:1fr 1fr minmax(230px,.8fr);gap:14px}.weekly-chart-card{display:grid;align-content:start;gap:10px;border:1px solid rgba(31,42,56,.12);padding:14px;background:#fff}.weekly-chart-card h3{margin:0;color:var(--ink);font-family:var(--sans);font-size:.92rem;font-weight:900;text-transform:uppercase;letter-spacing:.02em}
.weekly-bar-row{display:grid;grid-template-columns:72px minmax(100px,1fr) 42px;align-items:center;gap:9px}.weekly-bar-label{font-family:var(--mono);font-size:.65rem;font-weight:900;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}.weekly-bar-track{height:12px;background:var(--paper-2);border:1px solid rgba(31,42,56,.08);overflow:hidden}.weekly-bar-track span{display:block;height:100%;background:#7b0008}.weekly-bar-row.is-fatality .weekly-bar-track span{background:#c3202b}.weekly-bar-row strong{font-family:var(--serif-display);font-size:1.1rem;line-height:1}.weekly-bar-row em{grid-column:2/4;color:var(--muted);font-size:.74rem;font-style:normal;line-height:1.25}.weekly-focus strong{font-family:var(--serif-display);font-size:2rem;line-height:.9;color:#7b0008}.weekly-focus p{margin:0;color:var(--text-soft);font-size:.88rem;line-height:1.45}.weekly-focus div{display:flex;flex-wrap:wrap;gap:6px}.weekly-focus span{display:inline-flex;padding:5px 7px;background:var(--paper-2);color:var(--muted);font-family:var(--mono);font-size:.62rem;font-weight:900;text-transform:uppercase;letter-spacing:.05em}
@media (max-width:1180px){.tracker-controls,.weekly-chart-grid{grid-template-columns:1fr}}
</style>

<section class="incident-tracker-shell" data-incident-tracker>
  <div class="incident-tracker-top">
    <div>
      <p class="tracker-kicker">TGD LIVE MONITORING</p>
      <h2>PAKISTAN INCIDENT MAP</h2>
      <p class="tracker-note" data-source-note>Loading tracker feed.</p>
    </div>
    <div class="tracker-refresh"><span class="tracker-pulse"></span><span data-last-updated>Loading</span></div>
  </div>
  <div class="tracker-metrics" data-metrics></div>
  <div class="tracker-controls" aria-label="Incident filters">
    <label>Date<input data-filter="date" type="date" aria-label="Select archive date"></label>
    <label>Province<select data-filter="province"><option value="">All provinces</option></select></label>
    <label>Category<select data-filter="category"><option value="">All categories</option></select></label>
    <label>Severity<select data-filter="severity"><option value="">All severities</option></select></label>
    <label>Search<input data-filter="search" type="search" placeholder="District, actor, keyword"></label>
  </div>
  <section class="tracker-analytics" data-weekly-analytics aria-label="Weekly incident graphs"></section>
  <section class="provincial-breakdown" data-provincial-breakdown aria-label="Daily provincial breakdown">
    <div class="breakdown-heading">
      <div class="breakdown-title"><span>Daily</span><span>Provincial</span><span>Breakdown</span></div>
      <div class="breakdown-status"><span data-map-count>0 incidents</span><span>Selected date feed</span></div>
    </div>
    <div class="breakdown-stage">
      <div class="breakdown-map-frame" data-map>
        <object class="tracker-pakistan-map" data="/assets/pakistan-map.svg" type="image/svg+xml" aria-hidden="true" tabindex="-1"></object>
        <div class="tracker-marker-layer" data-marker-layer></div>
        <div class="province-hotspot hotspot-kp" data-province-hotspot="Khyber Pakhtunkhwa">0</div>
        <div class="province-hotspot hotspot-balochistan" data-province-hotspot="Balochistan">0</div>
        <div class="province-hotspot hotspot-sindh" data-province-hotspot="Sindh">0</div>
        <div class="province-hotspot hotspot-punjab" data-province-hotspot="Punjab">0</div>
        <div class="province-hotspot hotspot-gb" data-province-hotspot="Gilgit-Baltistan">0</div>
        <div class="province-hotspot hotspot-ict" data-province-hotspot="Islamabad">0</div>
        <div class="tracker-map-credit">Boundary: Natural Earth</div>
      </div>
      <div class="active-province-panel" data-province-cards></div>
    </div>
  </section>
  <div class="tracker-grid">
    <aside class="tracker-log-panel" aria-label="Incident log">
      <div class="tracker-log-head"><span>Incident log</span><strong data-result-count>0 shown</strong></div>
      <div class="incident-list" data-incident-list></div>
    </aside>
  </div>
</section>

<script>
(function () {
  const dataPath = "/assets/data/incidents.json";
  const imports = ["/assets/data/imports/may-2026-weeks-1-4.csv"];
  const archiveDays = 31;
  const dayMs = 24 * 60 * 60 * 1000;
  const nativeFetch = window.fetch.bind(window);
  const districts = [
    ["bajaur|loi sam|mamund|mamond", "Bajaur", "Khyber Pakhtunkhwa", 34.72, 71.5],
    ["lakki|ghazni khel|darra tang", "Lakki Marwat", "Khyber Pakhtunkhwa", 32.61, 70.91],
    ["tank|wanda zalu|wanda zalo|wanda zulu", "Tank", "Khyber Pakhtunkhwa", 32.22, 70.38],
    ["south waziristan|wana", "South Waziristan", "Khyber Pakhtunkhwa", 32.3, 69.57],
    ["lower south waziristan|angoor adda", "Lower South Waziristan", "Khyber Pakhtunkhwa", 32.1, 69.36],
    ["dera ismail khan|di khan|kulachi", "Dera Ismail Khan", "Khyber Pakhtunkhwa", 31.83, 70.9],
    ["bannu|jani khel|fateh khel", "Bannu", "Khyber Pakhtunkhwa", 32.99, 70.6],
    ["north waziristan|mir ali|miranshah|spin wam|shewa", "North Waziristan", "Khyber Pakhtunkhwa", 32.98, 70.13],
    ["kurram", "Kurram", "Khyber Pakhtunkhwa", 33.73, 70.1],
    ["hangu", "Hangu", "Khyber Pakhtunkhwa", 33.53, 71.06],
    ["karak", "Karak", "Khyber Pakhtunkhwa", 33.12, 71.09],
    ["khyber|tirah", "Khyber", "Khyber Pakhtunkhwa", 34.03, 71.13],
    ["charsadda", "Charsadda", "Khyber Pakhtunkhwa", 34.15, 71.74],
    ["peshawar|matni", "Peshawar", "Khyber Pakhtunkhwa", 34.01, 71.56],
    ["quetta|mangla zarghoon|shabaan", "Quetta", "Balochistan", 30.3, 67.2],
    ["kech|turbat", "Kech", "Balochistan", 26, 63.05],
    ["washuk", "Washuk", "Balochistan", 27.72, 64.8],
    ["ziarat", "Ziarat", "Balochistan", 30.38, 67.73],
    ["barkhan", "Barkhan", "Balochistan", 29.9, 69.53],
    ["nushki", "Nushki", "Balochistan", 29.55, 66.02],
    ["attock", "Attock", "Punjab", 33.77, 72.36],
    ["taunsa|chitrota", "Taunsa", "Punjab", 30.7, 70.65],
    ["dera ghazi khan|d g khan|dg khan", "Dera Ghazi Khan", "Punjab", 30.05, 70.64]
  ];
  function clean(value) { return String(value || "").replace(/\r/g, "").trim(); }
  function lower(value) { return clean(value).toLowerCase(); }
  function slug(value) { return lower(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80); }
  function dateMs(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
  }
  function todayPakistan() {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const byType = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  }
  function inArchive(date) {
    const today = dateMs(todayPakistan());
    const value = dateMs(date);
    return Number.isFinite(value) && value >= today - (archiveDays - 1) * dayMs && value <= today;
  }
  function province(value) {
    const compact = lower(value).replace(/[^a-z0-9]+/g, "");
    if (compact === "kpk" || compact.includes("khyber") || compact.includes("pakhtunkhwa")) return "Khyber Pakhtunkhwa";
    if (compact.includes("baloch") || compact.includes("baluch")) return "Balochistan";
    if (compact.includes("punjab")) return "Punjab";
    if (compact.includes("sind")) return "Sindh";
    if (compact.includes("gilgit")) return "Gilgit-Baltistan";
    if (compact.includes("islamabad")) return "Islamabad";
    return clean(value) || "Pakistan";
  }
  function findPlace(text, fallbackDistrict, fallbackProvince) {
    const haystack = lower(`${fallbackDistrict || ""} ${fallbackProvince || ""} ${text}`);
    for (const [terms, district, prov, lat, lng] of districts) {
      if (terms.split("|").some((term) => haystack.includes(term))) return { district, province: prov, lat, lng };
    }
    return { district: clean(fallbackDistrict) || "Unspecified", province: province(fallbackProvince), lat: 30.3753, lng: 69.3451 };
  }
  function category(value) {
    const text = lower(value);
    if (text.includes("vbied")) return "VBIED";
    if (text.includes("ied") || text.includes("bomb") || text.includes("explosion")) return "IED / Explosion";
    if (text.includes("security operation")) return "Counterterrorism Operation";
    if (text.includes("drone") || text.includes("quadcopter")) return "Drone / Quadcopter";
    if (text.includes("suicide")) return "Suicide Bombing";
    if (text.includes("infighting")) return "Militant Infighting / Clash";
    return clean(value) || "Security incident";
  }
  function number(value) {
    const match = clean(value).match(/-?\d+/);
    return match ? Number(match[0]) : 0;
  }
  function parseCsv(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (char === '"') {
          if (text[index + 1] === '"') { field += '"'; index += 1; }
          else quoted = false;
        } else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ",") { row.push(field); field = ""; }
      else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (char !== "\r") field += char;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    const headers = (rows.shift() || []).map(clean);
    return rows.filter((values) => values.some(clean)).map((values) => Object.fromEntries(headers.map((header, index) => [header, clean(values[index])])));
  }
  function rowIncident(row, source) {
    const date = clean(row.Date);
    const uid = clean(row["Incident UID"]);
    if (!date || !uid || !inArchive(date)) return null;
    const place = findPlace(`${row.District || ""} ${row.Location || ""} ${row["Incident Description"] || ""}`, row.District, row.Province);
    const fatalities = number(row.Civilian_Casualties) + number(row.Militants_Casualties) + number(row.Forces_Casualties);
    const injuries = number(row.Civilian_Injuries) + number(row.Militants_Injuries) + number(row.Forces_Injuries);
    const abductions = number(row.Abductions);
    const assets = clean(row["Assets Damaged"]);
    const claim = clean(row.Claim);
    const type = category(row["Attack Method"]);
    return {
      id: `import-${slug(uid)}`,
      date,
      reported_at: `${date}T12:00:00.000Z`,
      time_label: clean(row["Week Number"]) || "Imported weekly dataset",
      title: `${type} reported in ${place.district}`,
      district: place.district,
      province: province(row.Province || place.province),
      country: "Pakistan",
      lat: place.lat,
      lng: place.lng,
      category: type,
      actor: !claim || /^unclaimed$/i.test(claim) ? "Unidentified" : claim,
      status: /^unclaimed$/i.test(claim) ? "Imported record" : "Claimed / recorded",
      severity: fatalities > 0 || injuries >= 3 || abductions > 0 ? "High" : injuries > 0 || (assets && !/^none$/i.test(assets)) ? "Medium" : "Low",
      fatalities,
      injuries,
      summary: clean(row["Incident Description"]) || clean(row["Casualty Description"]) || `${type} reported in ${place.district}.`,
      source: "TGD weekly dataset",
      source_url: "",
      verified: false,
      imported: true,
      import_source: source,
      incident_uid: uid,
      week_label: clean(row["Week Number"])
    };
  }
  function isTest(incident) {
    const text = lower(`${incident.source || ""} ${incident.source_url || ""} ${incident.summary || ""} ${incident.title || ""}`);
    return text.includes("test incident") || text.includes("webhook test") || text === "test";
  }
  async function loadImports() {
    const records = [];
    for (const url of imports) {
      try {
        const response = await nativeFetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) continue;
        for (const row of parseCsv(await response.text())) {
          const incident = rowIncident(row, url.split("/").pop());
          if (incident) records.push(incident);
        }
      } catch (_error) {}
    }
    return records;
  }
  window.fetch = async function patchedFetch(input, init) {
    const requestUrl = typeof input === "string" ? input : input.url;
    if (!String(requestUrl).includes(dataPath)) return nativeFetch(input, init);
    const response = await nativeFetch(input, init);
    const data = await response.clone().json();
    const imported = await loadImports();
    const importedDates = new Set(imported.map((incident) => incident.date));
    const byId = new Map(imported.map((incident) => [incident.id, incident]));
    for (const incident of Array.isArray(data.incidents) ? data.incidents : []) {
      if (!incident || isTest(incident) || !inArchive(incident.date) || importedDates.has(incident.date)) continue;
      if (!byId.has(incident.id)) byId.set(incident.id, incident);
    }
    data.incidents = Array.from(byId.values()).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.reported_at || "").localeCompare(String(a.reported_at || "")));
    data.archive_days = archiveDays;
    data.import_sources = imports.map((url) => url.split("/").pop());
    return new Response(JSON.stringify(data), { status: response.status, headers: { "content-type": "application/json" } });
  };
})();
</script>
<script src="/assets/incident-map.js?v=20260522-direct-archive" defer></script>