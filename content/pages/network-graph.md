---
title: "Network Graph"
date: "2026-06-09"
author: "TGD Research Desk"
type: "page"
eyebrow: "Intelligence tool"
summary: "Interactive force-directed network visualization of militant actors, organisations, and their relationships — built from TGD's research profile database."
extra_head: '<link rel="stylesheet" href="/assets/network-graph.css?v=20260610-guidance">'
---

<section class="network-graph-shell is-loading" data-network-graph>
  <div class="network-dashboard-head">
    <div>
      <p class="network-kicker">TGD NETWORK INTELLIGENCE</p>
      <h2>READ THE NETWORK</h2>
      <p class="network-note" id="network-description" data-network-note>Each circle is an actor or organisation. Lines show leadership, affiliation, rivalry, operational links, and succession. Click any node to open the profile context.</p>
      <div class="network-credibility">Built from TGD public-source profile records. Public research only; no operational guidance.</div>
    </div>
    <div class="network-live-stack">
      <div class="network-status" role="status" aria-live="polite"><span class="network-pulse"></span><span data-network-stats>Initializing</span></div>
      <p data-network-story-summary>Start with the overview, then choose a guided view to follow one network at a time.</p>
    </div>
  </div>
  <div class="network-workbench">
    <div class="network-control-rail">
      <div class="network-story-panel">
        <div>
          <p class="network-story-kicker">Guided views</p>
          <strong>Pick a route into the map</strong>
        </div>
        <div class="network-story-buttons" data-network-stories>
          <button class="is-active" type="button" data-story-mode="overview" aria-pressed="true">Overview</button>
          <button type="button" data-story-mode="alqaeda" aria-pressed="false">Al-Qaeda network</button>
          <button type="button" data-story-mode="islamic-state" aria-pressed="false">Islamic State</button>
          <button type="button" data-story-mode="south-asia" aria-pressed="false">Pakistan / South Asia</button>
          <button type="button" data-story-mode="africa" aria-pressed="false">African theatres</button>
          <button type="button" data-story-mode="lone-actors" aria-pressed="false">Lone actors</button>
        </div>
      </div>
      <div class="network-stats-strip" data-stats-strip></div>
      <div class="network-reader-guide" aria-label="How to read the network">
        <div><strong>Circles</strong><span>Actors and organisations in the TGD profile database.</span></div>
        <div><strong>Lines</strong><span>Mapped relationships such as command, affiliation, rivalry, and succession.</span></div>
        <div><strong>Click</strong><span>Open a concise panel with status, role, region, connections, and the full profile link.</span></div>
      </div>
      <div class="network-toolbar">
        <div class="network-toolbar-left">
          <div class="network-view-tabs">
            <button class="is-active" type="button" data-view-mode="clustered" aria-pressed="true">Clustered</button>
            <button type="button" data-view-mode="regional" aria-pressed="false">By region</button>
            <button type="button" data-view-mode="force" aria-pressed="false">Free drift</button>
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
    </div>
    <div class="network-canvas-wrap">
      <div class="network-canvas-callout" data-network-canvas-callout>
        <span data-network-callout-kicker>Overview</span>
        <strong data-network-callout-title>29 actors · 34 connections visible</strong>
        <p data-network-callout-body>Click a circle to open profile context. Use guided views to follow one network at a time.</p>
      </div>
      <canvas id="network-canvas" role="img" aria-describedby="network-description" aria-label="Interactive network graph of militant actors and organisations"></canvas>
      <p class="network-error" data-network-error role="alert" hidden>The network could not load. Use the profile index below to continue browsing.</p>
      <div class="network-tooltip" data-network-tooltip hidden></div>
      <div class="network-minimap"><canvas id="network-minimap-canvas"></canvas></div>
      <div class="network-zoom-controls">
        <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
        <button type="button" data-zoom="out" aria-label="Zoom out">−</button>
        <button type="button" data-zoom="reset" aria-label="Reset zoom">⟲</button>
      </div>
      <aside class="network-detail-panel" data-network-detail></aside>
    </div>
  </div>
  <details class="network-profile-index">
    <summary>Browse mapped profiles without the graph</summary>
    <div class="network-profile-index-grid" data-network-profile-index></div>
  </details>
</section>

<script src="/assets/network-graph.js?v=20260610-guidance" defer></script>
