---
title: "Incident Map"
date: "2026-05-18"
author: "TGD Monitoring Desk"
type: "page"
eyebrow: "Live tracker"
summary: "A public-source incident tracker for security events monitored by The Global Decipher."
---

<style>@import url("/assets/incident-map.css");</style>

<section class="incident-tracker-shell" data-incident-tracker>
  <div class="incident-tracker-top">
    <div>
      <p class="tracker-kicker">TGD live monitoring</p>
      <h2>Pakistan incident map</h2>
      <p class="tracker-note" data-source-note>Loading tracker feed.</p>
    </div>
    <div class="tracker-refresh"><span class="tracker-pulse"></span><span data-last-updated>Loading</span></div>
  </div>
  <div class="tracker-metrics" data-metrics></div>
  <div class="tracker-controls" aria-label="Incident filters">
    <label>Province<select data-filter="province"><option value="">All provinces</option></select></label>
    <label>Category<select data-filter="category"><option value="">All categories</option></select></label>
    <label>Severity<select data-filter="severity"><option value="">All severities</option></select></label>
    <label>Search<input data-filter="search" type="search" placeholder="District, actor, keyword"></label>
  </div>
  <div class="tracker-grid">
    <section class="tracker-map-panel" aria-label="Incident map">
      <div class="tracker-map-head">
        <div><span class="map-label">Pakistan live map</span><strong data-map-count>0 incidents</strong></div>
        <div class="tracker-legend"><span><i class="legend-dot high"></i>High</span><span><i class="legend-dot medium"></i>Medium</span><span><i class="legend-dot low"></i>Low</span></div>
      </div>
      <div class="tracker-map-plane" data-map>
        <img class="tracker-pakistan-map" src="/assets/pakistan-map.svg" alt="" aria-hidden="true" loading="eager">
        <div class="tracker-place label-kp">Khyber Pakhtunkhwa</div>
        <div class="tracker-place label-balochistan">Balochistan</div>
        <div class="tracker-place label-punjab">Punjab</div>
        <div class="tracker-place label-sindh">Sindh</div>
        <div class="tracker-map-credit">Boundary: Natural Earth</div>
        <div class="tracker-marker-layer" data-marker-layer></div>
      </div>
    </section>
    <aside class="tracker-log-panel" aria-label="Incident log">
      <div class="tracker-log-head"><span>Incident log</span><strong data-result-count>0 shown</strong></div>
      <div class="incident-list" data-incident-list></div>
    </aside>
  </div>
</section>

<script src="/assets/incident-map.js" defer></script>
