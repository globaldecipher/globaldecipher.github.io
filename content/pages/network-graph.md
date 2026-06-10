---
title: "Network Graph"
date: "2026-06-09"
author: "TGD Research Desk"
type: "page"
eyebrow: "Intelligence tool"
summary: "Interactive force-directed network visualization of militant actors, organisations, and their relationships — built from TGD's research profile database."
extra_head: '<link rel="stylesheet" href="/assets/network-graph.css">'
---

<section class="network-graph-shell is-loading" data-network-graph>
  <div class="network-dashboard-head">
    <div>
      <p class="network-kicker">TGD NETWORK INTELLIGENCE</p>
      <h2>ACTOR NETWORK GRAPH</h2>
      <p class="network-note" data-network-note>Mapping relationships between militant actors and organisations across TGD's research database. Drag, zoom, click any node.</p>
    </div>
    <div class="network-live-stack">
      <div class="network-status"><span class="network-pulse"></span><span data-network-stats>Initializing</span></div>
    </div>
  </div>
  <div class="network-stats-strip" data-stats-strip></div>
  <div class="network-toolbar">
    <div class="network-toolbar-left">
      <div class="network-view-tabs">
        <button class="is-active" type="button" data-view-mode="force">Force layout</button>
        <button type="button" data-view-mode="hierarchical">Hierarchical</button>
        <button type="button" data-view-mode="radial">Radial</button>
      </div>
      <div class="network-filters-row">
        <label>Region<select data-filter="region"><option value="">All</option></select></label>
        <label>Status<select data-filter="status"><option value="">All</option></select></label>
        <label>Connection<select data-filter="edge-type"><option value="">All</option></select></label>
        <label>Search<input data-network-search type="search" placeholder="Actor, group…"></label>
      </div>
    </div>
    <div class="network-legend-strip" data-network-legend></div>
  </div>
  <div class="network-canvas-wrap">
    <canvas id="network-canvas"></canvas>
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
