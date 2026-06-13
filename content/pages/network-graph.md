---
title: "Network Graph"
date: "2026-06-13"
author: "TGD Research Desk"
type: "page"
eyebrow: "Intelligence tool"
summary: "Country-first research map of militant organisations, factions, fronts, and key actors, beginning with deep Pakistan coverage and designed to expand across Asia and the world."
extra_head: '<link rel="stylesheet" href="/assets/network-graph.css">'
---

<section class="network-graph-shell is-loading" data-network-graph>
  <div class="network-dashboard-head">
    <div>
      <p class="network-kicker">TGD NETWORK RESEARCH</p>
      <h2>ACTOR NETWORK GRAPH</h2>
      <p class="network-note" id="network-description" data-network-note>Start with Pakistan, then move outward across Asia and the world. Select a country to isolate its organisations, factions, fronts, leaders, and cross-border relationships.</p>
    </div>
    <div class="network-live-stack">
      <div class="network-status" role="status"><span class="network-pulse"></span><span data-network-stats>Initializing</span></div>
    </div>
  </div>
  <div class="network-stats-strip" data-stats-strip></div>
  <section class="network-country-browser" aria-labelledby="network-country-title">
    <div class="network-country-copy">
      <p class="network-country-eyebrow">Country intelligence</p>
      <h3 id="network-country-title">Choose a country. Read the network.</h3>
      <p>Pakistan is the first deep-coverage pack. Planned country packs remain visible so the database's expansion path is clear.</p>
    </div>
    <div class="network-country-actions">
      <button type="button" data-country-reset>World overview</button>
      <div class="network-country-list" data-country-list aria-label="Country coverage"></div>
    </div>
  </section>
  <p class="network-method-note"><strong>Research note:</strong> Inclusion records network relevance. Government proscription, UN listing, reported operational status, and TGD analytical category are separate fields. Open a record to inspect its source trail.</p>
  <div class="network-toolbar">
    <div class="network-toolbar-left">
      <div class="network-view-tabs">
        <button class="is-active" type="button" data-view-mode="country">Country view</button>
        <button type="button" data-view-mode="force">Network</button>
        <button type="button" data-view-mode="hierarchical">Organisation families</button>
        <button type="button" data-view-mode="radial">Regions</button>
      </div>
      <div class="network-filters-row">
        <label>Country<select data-filter="country"><option value="">All</option></select></label>
        <label>Region<select data-filter="region"><option value="">All</option></select></label>
        <label>Status<select data-filter="status"><option value="">All</option></select></label>
        <label>Connection<select data-filter="edge-type"><option value="">All</option></select></label>
        <label>Search<input data-network-search type="search" placeholder="Actor, group…"></label>
      </div>
    </div>
    <div class="network-legend-strip" data-network-legend></div>
  </div>
  <div class="network-canvas-wrap">
    <canvas id="network-canvas" role="img" aria-describedby="network-description" aria-label="Interactive network graph of militant actors and organisations"></canvas>
    <div class="network-tooltip" data-network-tooltip hidden></div>
    <div class="network-minimap"><canvas id="network-minimap-canvas"></canvas></div>
    <div class="network-zoom-controls">
      <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
      <button type="button" data-zoom="out" aria-label="Zoom out">−</button>
      <button type="button" data-zoom="reset" aria-label="Reset zoom">⟲</button>
    </div>
    <aside class="network-detail-panel" data-network-detail></aside>
  </div>
</section>

<script src="/assets/network-graph.js" defer></script>
