---
title: "Incident Map"
date: "2026-05-18"
author: "TGD Monitoring Desk"
type: "page"
eyebrow: "Live tracker"
summary: "A public-source incident tracker for security events monitored by The Global Decipher."
---

<style>@import url("/assets/incident-map.css?v=20260518-clean-map");</style>

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
  <section class="provincial-breakdown" data-provincial-breakdown aria-label="Current provincial breakdown">
    <div class="breakdown-heading">
      <div class="breakdown-title"><span>Current</span><span>Provincial</span><span>Breakdown</span></div>
      <div class="breakdown-status"><span data-map-count>0 incidents</span><span>Live incident feed</span></div>
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

<script src="/assets/incident-map.js?v=20260518-clean-map" defer></script>
