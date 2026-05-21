---
title: "Incident Map"
date: "2026-05-18"
author: "TGD Monitoring Desk"
type: "page"
eyebrow: "Live tracker"
summary: "A public-source incident tracker for security events monitored by The Global Decipher."
---

<style>
@import url("/assets/incident-map.css?v=20260519-map-command");
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

<script src="/assets/incident-map.js?v=20260521-weekly-graphs" defer></script>