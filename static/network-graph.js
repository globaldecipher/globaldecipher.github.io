/**
 * TGD Network Graph v3 – Spread-out, full-width force-directed graph
 * Vanilla JS · No dependencies · Retina-ready
 * ──────────────────────────────────────────────────────── */
;(function () {
  'use strict';

  /* ───────── physics tuned for SPREAD OUT graph ───────── */
  const REPULSION     = 48000;
  const SPRING_K      = 0.0008;
  const SPRING_REST   = 320;
  const CENTER_FORCE  = 0.002;
  const DAMPING       = 0.82;
  const COOL_RATE     = 0.9992;
  const MIN_ENERGY    = 0.02;
  const OVERLAP_FORCE = 4;
  const ZOOM_MIN      = 0.2;
  const ZOOM_MAX      = 5;
  const ZOOM_STEP     = 0.12;
  const HIT_PAD       = 8;
  const GRID_SIZE     = 200;
  const TOOLTIP_OFFSET = 14;
  const PARTICLE_SPEED = 0.35;
  const PARTICLE_COUNT = 2;

  const ORG_RADIUS  = { min: 32, max: 38 };
  const IND_RADIUS  = { min: 18, max: 22 };

  /* ───────── theme palettes ───────── */
  const THEMES = {
    light: {
      bg: '#fafaf7', dot: 'rgba(0,0,0,0.045)', text: '#1a1a1a',
      muted: '#6b7280', border: '#d1d5db', surface: '#ffffff',
      dimAlpha: 0.06, labelFill: '#1a1a1a', edgeAlpha: 0.4,
      selGlow: 'rgba(99,102,241,0.35)', hoverRing: 'rgba(99,102,241,0.5)',
      particleAlpha: 0.6,
    },
    dark: {
      bg: '#0d0f14', dot: 'rgba(255,255,255,0.03)', text: '#e5e7eb',
      muted: '#9ca3af', border: '#374151', surface: '#1a1c24',
      dimAlpha: 0.06, labelFill: '#e5e7eb', edgeAlpha: 0.45,
      selGlow: 'rgba(129,140,248,0.4)', hoverRing: 'rgba(129,140,248,0.55)',
      particleAlpha: 0.75,
    },
  };

  /* ───────── helpers ───────── */
  const clamp   = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp    = (a, b, t) => a + (b - a) * t;
  const dist    = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  function hexToRGBA(hex, a) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function unique(values) { return [...new Set((values || []).filter(Boolean))]; }

  /* ───────── spatial hash ───────── */
  class SpatialHash {
    constructor(cs) { this.cs = cs; this.map = new Map(); }
    _key(x, y) { return `${Math.floor(x / this.cs)},${Math.floor(y / this.cs)}`; }
    clear() { this.map.clear(); }
    insert(n) { const k = this._key(n.x, n.y); if (!this.map.has(k)) this.map.set(k, []); this.map.get(k).push(n); }
    query(x, y, r) {
      const out = [];
      const cx1 = Math.floor((x-r)/this.cs), cx2 = Math.floor((x+r)/this.cs);
      const cy1 = Math.floor((y-r)/this.cs), cy2 = Math.floor((y+r)/this.cs);
      for (let cx = cx1; cx <= cx2; cx++)
        for (let cy = cy1; cy <= cy2; cy++) {
          const b = this.map.get(`${cx},${cy}`);
          if (b) for (const n of b) out.push(n);
        }
      return out;
    }
  }

  /* ═══════════════════════════════════════════════
     INIT
     ═══════════════════════════════════════════════ */
  function init() {
    const root = document.querySelector('[data-network-graph]');
    if (!root) return;
    const canvas = document.getElementById('network-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const mmCanvas = document.getElementById('network-minimap-canvas');
    const mmCtx = mmCanvas ? mmCanvas.getContext('2d') : null;

    let nodes = [], edges = [], regionMap = {}, edgeTypeMap = {};
    let sourceIndex = {}, countryCatalog = [];
    let nodeById = {};
    let W = 0, H = 0, dpr = 1;
    let panX = 0, panY = 0, zoom = 1, targetZoom = 1;
    let temperature = 1;
    let simRunning = true;
    let selectedNode = null, hoveredNode = null, hoveredEdge = null;
    let dragNode = null, isPanning = false;
    let pointerDown = false, pointerMoved = false;
    let lastPointerPos = { x: 0, y: 0 };
    let theme = getTheme();
    let viewMode = 'country';
    let filterCountry = '', filterRegion = '', filterStatus = '', filterEdgeType = '', searchQuery = '';
    let layoutTransitionProgress = 1;
    let layoutTargets = null;
    let layoutGroupLabels = [];
    const spatialHash = new SpatialHash(GRID_SIZE);
    let pinchDist0 = null, pinchZoom0 = 1;
    let pulsePhase = 0;
    let introProgress = 0;
    let particles = [];
    let frameCount = 0;

    function getTheme() { return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; }
    function palette() { return THEMES[theme]; }

    const themeObserver = new MutationObserver(() => { theme = getTheme(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    /* ── sizing ── */
    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      W = rect.width; H = rect.height;
      dpr = window.devicePixelRatio || 1;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      if (mmCanvas) {
        const mr = mmCanvas.parentElement.getBoundingClientRect();
        mmCanvas.width = mr.width * dpr; mmCanvas.height = mr.height * dpr;
        mmCanvas.style.width = mr.width + 'px'; mmCanvas.style.height = mr.height + 'px';
      }
    }
    resize();
    window.addEventListener('resize', debounce(resize, 150));

    let tooltip = root.querySelector('.network-tooltip');
    const detailPanel = root.querySelector('.network-detail-panel');

    /* ── data ── */
    function fetchJson(url) {
      return fetch(url).then(r => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); });
    }

    function mergeNetworkData(datasets, catalog) {
      const nodeMap = new Map();
      const edgeMap = new Map();
      const regionMapById = new Map();
      const edgeTypeMapById = new Map();
      const arrays = ['aliases', 'countries', 'designations', 'operatingAreas', 'sources', 'tags'];
      const mergedSources = {};

      for (const data of datasets) {
        Object.assign(mergedSources, data.sourceIndex || {});
        for (const node of data.nodes || []) {
          const previous = nodeMap.get(node.id) || {};
          const merged = { ...previous, ...node };
          arrays.forEach(key => { merged[key] = unique([...(previous[key] || []), ...(node[key] || [])]); });
          nodeMap.set(node.id, merged);
        }
        for (const edge of data.edges || []) {
          const key = edge.id || `${edge.source}|${edge.target}|${edge.type}|${edge.label || ''}`;
          const previous = edgeMap.get(key) || {};
          edgeMap.set(key, { ...previous, ...edge, sources: unique([...(previous.sources || []), ...(edge.sources || [])]) });
        }
        for (const region of data.regions || []) regionMapById.set(region.id, region);
        for (const type of data.edgeTypes || []) edgeTypeMapById.set(type.id, type);
      }

      return {
        meta: datasets[0]?.meta || {},
        nodes: [...nodeMap.values()],
        edges: [...edgeMap.values()],
        regions: [...regionMapById.values()],
        edgeTypes: [...edgeTypeMapById.values()],
        sourceIndex: mergedSources,
        countries: catalog.countries || [],
        coverageNote: catalog.meta?.coverage_note || '',
      };
    }

    Promise.all([
      fetchJson('/assets/data/network-data.json'),
      fetchJson('/assets/data/network-catalog.json'),
    ])
      .then(async ([core, catalog]) => {
        const packEntries = (catalog.countries || []).filter(country => country.data);
        const packs = await Promise.all(packEntries.map(country => fetchJson(country.data).catch(err => {
          console.error('[network-graph pack]', country.id, err);
          return { nodes: [], edges: [] };
        })));
        return mergeNetworkData([core, ...packs], catalog);
      })
      .then(data => { buildGraph(data); root.classList.remove('is-loading'); loop(); })
      .catch(err => console.error('[network-graph]', err));

    function buildGraph(data) {
      sourceIndex = data.sourceIndex || {};
      countryCatalog = data.countries || [];
      const defaultCountry = countryCatalog.find(country => country.default && country.data);
      filterCountry = defaultCountry?.label || '';
      (data.regions || []).forEach(r => { regionMap[r.id] = r; regionMap[r.label] = r; });
      (data.edgeTypes || []).forEach(e => { edgeTypeMap[e.id] = e; });

      /* spread initial positions WIDELY */
      const count = (data.nodes || []).length;
      nodes = (data.nodes || []).map((n, i) => {
        const isOrg = n.type === 'organisation';
        const r = isOrg
          ? lerp(ORG_RADIUS.min, ORG_RADIUS.max, Math.random())
          : lerp(IND_RADIUS.min, IND_RADIUS.max, Math.random());
        const angle = (2 * Math.PI * i) / count;
        const spread = Math.min(W, H) * 0.45;
        return {
          ...n,
          x: W/2 + Math.cos(angle) * spread * (0.6 + Math.random() * 0.4),
          y: H/2 + Math.sin(angle) * spread * (0.6 + Math.random() * 0.4),
          vx: 0, vy: 0, radius: r, pinned: false,
          _visible: true, _alpha: 1, _connections: [],
          _introDelay: i * 0.05, _introAlpha: 0,
        };
      });
      nodeById = {};
      nodes.forEach(n => { nodeById[n.id] = n; });

      edges = (data.edges || []).map(e => ({
        ...e, sourceNode: nodeById[e.source], targetNode: nodeById[e.target],
        _visible: true, _alpha: 1,
      })).filter(e => e.sourceNode && e.targetNode);

      edges.forEach(e => {
        e.sourceNode._connections.push(e);
        e.targetNode._connections.push(e);
      });

      initParticles();
      temperature = 1;
      simRunning = true;
      introProgress = 0;
      populateFilters(data);
      populateCountryBrowser(data);
      buildLegend(data);
      populateStats();
      updateStats();
      applyFilters();
      applyLayout(viewMode);
    }

    function initParticles() {
      particles = [];
      edges.forEach(e => {
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          particles.push({ edge: e, t: Math.random(), speed: PARTICLE_SPEED * (0.6 + Math.random() * 0.8) });
        }
      });
    }

    /* ── populate filters ── */
    function populateFilters(data) {
      const countrySel = root.querySelector('[data-filter="country"]');
      const regionSel = root.querySelector('[data-filter="region"]');
      const statusSel = root.querySelector('[data-filter="status"]');
      const edgeSel   = root.querySelector('[data-filter="edge-type"]');
      if (countrySel) {
        const countries = unique(nodes.flatMap(nodeCountries)).sort();
        countrySel.innerHTML = '<option value="">All</option>' +
          countries.map(country => `<option value="${esc(country)}">${esc(country)}</option>`).join('');
        countrySel.value = filterCountry;
      }
      if (regionSel) {
        const regions = [...new Set(nodes.map(n => n.region).filter(Boolean))].sort();
        regionSel.innerHTML = '<option value="">All</option>' +
          regions.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
      }
      if (statusSel) {
        const statuses = [...new Set(nodes.map(n => n.status).filter(Boolean))].sort();
        statusSel.innerHTML = '<option value="">All</option>' +
          statuses.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
      }
      if (edgeSel) {
        const types = (data.edgeTypes || []).filter(t => edges.some(e => e.type === t.id));
        edgeSel.innerHTML = '<option value="">All</option>' +
          types.map(t => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('');
      }
    }

    function nodeCountries(node) {
      return unique([...(node.countries || []), node.country]);
    }

    function populateCountryBrowser() {
      const list = root.querySelector('[data-country-list]');
      if (!list) return;
      list.innerHTML = countryCatalog.map(country => {
        const available = Boolean(country.data);
        const count = nodes.filter(node => nodeCountries(node).includes(country.label)).length;
        return `<button type="button" class="network-country-card ${available ? 'is-available' : 'is-planned'}" data-country-value="${esc(country.label)}" ${available ? '' : 'disabled'} aria-pressed="${filterCountry === country.label}">
          <span class="network-country-name">${esc(country.label)}</span>
          <span class="network-country-status">${available ? `${count} records` : esc(country.status || 'Planned')}</span>
        </button>`;
      }).join('');

      list.querySelectorAll('[data-country-value]:not(:disabled)').forEach(button => {
        button.addEventListener('click', () => selectCountry(button.dataset.countryValue));
      });
      root.querySelector('[data-country-reset]')?.addEventListener('click', () => selectCountry(''));
      updateCountryBrowser();
    }

    function updateCountryBrowser() {
      root.querySelectorAll('[data-country-value]').forEach(button => {
        const active = button.dataset.countryValue === filterCountry;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      root.querySelector('[data-country-reset]')?.classList.toggle('is-active', !filterCountry);
    }

    function selectCountry(country) {
      filterCountry = country;
      const select = root.querySelector('[data-filter="country"]');
      if (select) select.value = country;
      updateCountryBrowser();
      applyFilters();
      setViewMode('country');
    }

    /* ── build legend ── */
    function buildLegend(data) {
      const el = root.querySelector('[data-network-legend]');
      if (!el) return;
      const usedRegions = [...new Set(nodes.map(n => n.region).filter(Boolean))];
      const usedEdgeTypes = [...new Set(edges.map(e => e.type).filter(Boolean))];
      let html = '<p class="network-legend-title">Regions</p>';
      usedRegions.forEach(r => {
        const reg = regionMap[r];
        const color = reg ? reg.color : '#b91c2c';
        html += `<div class="network-legend-item"><span class="network-legend-dot" style="background:${color}"></span>${esc(r)}</div>`;
      });
      html += '<p class="network-legend-title">Connections</p>';
      usedEdgeTypes.slice(0, 8).forEach(tid => {
        const et = edgeTypeMap[tid];
        if (!et) return;
        const cls = et.dash ? 'dashed' : '';
        html += `<div class="network-legend-item"><span class="network-legend-line ${cls}" style="background:${et.color};color:${et.color}"></span>${esc(et.label)}</div>`;
      });
      el.innerHTML = html;
    }

    /* ── stats strip ── */
    function populateStats() {
      const strip = root.querySelector('[data-stats-strip]');
      if (!strip) return;
      const individuals = nodes.filter(n => n.type !== 'organisation').length;
      const orgs = nodes.filter(n => n.type === 'organisation').length;
      const countryCount = new Set(nodes.flatMap(nodeCountries)).size;
      strip.innerHTML = `
        <div class="network-metric"><span class="network-metric-label">People</span><strong class="network-metric-value">${individuals}</strong><span class="network-metric-note">Named individuals</span></div>
        <div class="network-metric"><span class="network-metric-label">Organisations</span><strong class="network-metric-value">${orgs}</strong><span class="network-metric-note">Networks & groups</span></div>
        <div class="network-metric"><span class="network-metric-label">Connections</span><strong class="network-metric-value">${edges.length}</strong><span class="network-metric-note">Mapped relationships</span></div>
        <div class="network-metric"><span class="network-metric-label">Countries</span><strong class="network-metric-value">${countryCount}</strong><span class="network-metric-note">Referenced jurisdictions</span></div>
      `;
    }

    /* ══════════════════════════════
       PHYSICS — tuned for spacing
       ══════════════════════════════ */
    function simulate() {
      if (!simRunning) return;

      spatialHash.clear();
      for (const n of nodes) if (n._visible) spatialHash.insert(n);

      /* repulsion */
      for (const a of nodes) {
        if (!a._visible) continue;
        if (a.pinned || a === dragNode) continue;
        const nearby = spatialHash.query(a.x, a.y, GRID_SIZE * 3);
        for (const b of nearby) {
          if (b === a) continue;
          let dx = a.x - b.x, dy = a.y - b.y;
          let d = Math.sqrt(dx*dx + dy*dy) || 1;
          const minDist = a.radius + b.radius + 12;
          const f = (REPULSION * temperature) / (d * d);
          a.vx += (dx/d) * f;
          a.vy += (dy/d) * f;
          /* hard overlap push */
          if (d < minDist) {
            const push = (minDist - d) * OVERLAP_FORCE;
            a.vx += (dx/d) * push;
            a.vy += (dy/d) * push;
          }
        }
        /* centering */
        a.vx += (W/2 - a.x) * CENTER_FORCE * temperature;
        a.vy += (H/2 - a.y) * CENTER_FORCE * temperature;
      }

      /* springs */
      for (const e of edges) {
        if (!e._visible) continue;
        const a = e.sourceNode, b = e.targetNode;
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.sqrt(dx*dx + dy*dy) || 1;
        const f = SPRING_K * (d - SPRING_REST) * temperature;
        const fx = (dx/d)*f, fy = (dy/d)*f;
        if (!a.pinned && a !== dragNode) { a.vx += fx; a.vy += fy; }
        if (!b.pinned && b !== dragNode) { b.vx -= fx; b.vy -= fy; }
      }

      /* integrate */
      let totalEnergy = 0;
      for (const n of nodes) {
        if (!n._visible) { n.vx = 0; n.vy = 0; continue; }
        if (n.pinned || n === dragNode) { n.vx = 0; n.vy = 0; continue; }
        n.vx *= DAMPING; n.vy *= DAMPING;
        /* clamp max velocity */
        const speed = Math.sqrt(n.vx*n.vx + n.vy*n.vy);
        if (speed > 15) { n.vx = (n.vx/speed)*15; n.vy = (n.vy/speed)*15; }
        n.x += n.vx; n.y += n.vy;
        totalEnergy += n.vx*n.vx + n.vy*n.vy;
      }

      /* layout transition */
      if (layoutTransitionProgress < 1 && layoutTargets) {
        layoutTransitionProgress = Math.min(1, layoutTransitionProgress + 0.03);
        const t = easeInOutCubic(layoutTransitionProgress);
        for (const n of nodes) {
          if (!n._visible) continue;
          const tgt = layoutTargets[n.id];
          if (!tgt) continue;
          n.x = lerp(n.x, tgt.x, t * 0.12);
          n.y = lerp(n.y, tgt.y, t * 0.12);
        }
        if (layoutTransitionProgress >= 1) layoutTargets = null;
      }

      temperature *= COOL_RATE;
      if (temperature < 0.008) temperature = 0.008;
      if (totalEnergy < MIN_ENERGY && viewMode === 'force' && layoutTransitionProgress >= 1) simRunning = false;
    }

    function easeInOutCubic(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2; }
    function reheat() { temperature = 0.4; simRunning = true; }

    /* ══════════════════════════════
       RENDERING
       ══════════════════════════════ */
    function draw() {
      const p = palette();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = p.bg;
      ctx.fillRect(0, 0, W, H);
      drawDotGrid(p);

      introProgress = Math.min(1, introProgress + 0.015);
      for (const n of nodes) {
        const t = clamp((introProgress - n._introDelay) / 0.3, 0, 1);
        n._introAlpha = easeInOutCubic(t);
      }

      ctx.save();
      ctx.translate(W/2, H/2);
      ctx.scale(zoom, zoom);
      ctx.translate(-W/2 + panX, -H/2 + panY);

      const vp = viewportBounds();

      drawGroupLabels(p, vp);
      for (const e of edges) drawEdge(e, p, vp);
      updateParticles(p);
      for (const n of nodes) drawNode(n, p, vp);

      ctx.restore();

      if (Math.abs(zoom - targetZoom) > 0.001) zoom = lerp(zoom, targetZoom, 0.18);
      else zoom = targetZoom;

      pulsePhase += 0.04;
      frameCount++;
      if (frameCount % 4 === 0) drawMinimap(p);
    }

    function drawDotGrid(p) {
      const spacing = 28;
      const sz = spacing * zoom;
      if (sz < 4) return;
      const ox = ((panX*zoom + W/2) % sz + sz) % sz;
      const oy = ((panY*zoom + H/2) % sz + sz) % sz;
      ctx.fillStyle = p.dot;
      for (let x = ox; x < W; x += sz) {
        for (let y = oy; y < H; y += sz) {
          ctx.beginPath();
          ctx.arc(x, y, 0.8, 0, Math.PI*2);
          ctx.fill();
        }
      }
    }

    function viewportBounds() {
      const hw = (W/2)/zoom, hh = (H/2)/zoom;
      const cx = W/2 - panX, cy = H/2 - panY;
      return { x1: cx-hw-120, y1: cy-hh-120, x2: cx+hw+120, y2: cy+hh+120 };
    }
    function inView(n, vp) { return n.x+n.radius > vp.x1 && n.x-n.radius < vp.x2 && n.y+n.radius > vp.y1 && n.y-n.radius < vp.y2; }
    function inViewEdge(e, vp) {
      const a = e.sourceNode, b = e.targetNode;
      return Math.max(a.x,b.x) > vp.x1 && Math.min(a.x,b.x) < vp.x2 &&
             Math.max(a.y,b.y) > vp.y1 && Math.min(a.y,b.y) < vp.y2;
    }

    function drawGroupLabels(p, vp) {
      if (viewMode !== 'country') return;
      ctx.save();
      ctx.font = "900 10px 'IBM Plex Mono',monospace";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const label of layoutGroupLabels) {
        if (label.x < vp.x1 || label.x > vp.x2 || label.y < vp.y1 || label.y > vp.y2) continue;
        const textLabel = label.text.length > 36 ? label.text.slice(0, 34) + '…' : label.text;
        const width = ctx.measureText(textLabel.toUpperCase()).width;
        ctx.fillStyle = hexToRGBA(p.bg, 0.9);
        ctx.fillRect(label.x - width / 2 - 8, label.y - 10, width + 16, 20);
        ctx.fillStyle = p.muted;
        ctx.fillText(textLabel.toUpperCase(), label.x, label.y);
      }
      ctx.restore();
    }

    /* ── edges ── */
    function drawEdge(e, p, vp) {
      if (!e._visible) return;
      if (!inViewEdge(e, vp)) return;
      const a = e.sourceNode, b = e.targetNode;
      const introA = Math.min(a._introAlpha, b._introAlpha);
      if (introA < 0.01) return;

      let alpha = Math.min(e._alpha, a._alpha, b._alpha) * introA;
      if (selectedNode || hoveredNode) {
        const hl = selectedNode || hoveredNode;
        alpha = (e.sourceNode === hl || e.targetNode === hl) ? 0.9 * introA : p.dimAlpha;
      }

      const et = edgeTypeMap[e.type];
      const color = et ? et.color : p.muted;
      const dashed = et ? et.dash : false;
      const bez = edgeBezier(a, b);

      ctx.save();
      ctx.globalAlpha = alpha * p.edgeAlpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = (selectedNode || hoveredNode) && (e.sourceNode === (selectedNode||hoveredNode) || e.targetNode === (selectedNode||hoveredNode)) ? 2.5 : 1.5;
      if (dashed) ctx.setLineDash([7, 5]);

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(bez.cpx, bez.cpy, b.x, b.y);
      ctx.stroke();

      drawArrow(a, b, bez.cpx, bez.cpy, color, alpha * p.edgeAlpha);
      ctx.setLineDash([]);
      ctx.restore();
    }

    function edgeBezier(a, b) {
      const mx = (a.x+b.x)/2, my = (a.y+b.y)/2;
      const dx = b.x-a.x, dy = b.y-a.y;
      const d = Math.sqrt(dx*dx+dy*dy) || 1;
      const off = Math.min(d*0.1, 40);
      return { cpx: mx + (-dy/d)*off, cpy: my + (dx/d)*off };
    }

    function drawArrow(a, b, cpx, cpy, color, alpha) {
      const t = 0.58;
      const px = (1-t)*(1-t)*a.x + 2*(1-t)*t*cpx + t*t*b.x;
      const py = (1-t)*(1-t)*a.y + 2*(1-t)*t*cpy + t*t*b.y;
      const tx = 2*(1-t)*(cpx-a.x) + 2*t*(b.x-cpx);
      const ty = 2*(1-t)*(cpy-a.y) + 2*t*(b.y-cpy);
      const ang = Math.atan2(ty, tx);
      const sz = 7;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(sz, 0); ctx.lineTo(-sz, -sz*0.5); ctx.lineTo(-sz, sz*0.5);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    /* ── particles ── */
    function updateParticles(p) {
      for (const pt of particles) {
        const e = pt.edge;
        if (!e._visible) continue;
        const a = e.sourceNode, b = e.targetNode;
        const introA = Math.min(a._introAlpha, b._introAlpha);
        if (introA < 0.3) continue;

        pt.t += pt.speed * 0.008;
        if (pt.t > 1) pt.t -= 1;

        if (selectedNode || hoveredNode) {
          const hl = selectedNode || hoveredNode;
          if (e.sourceNode !== hl && e.targetNode !== hl) continue;
        }

        const et = edgeTypeMap[e.type];
        const color = et ? et.color : '#b91c2c';
        const bez = edgeBezier(a, b);
        const t = pt.t;
        const px = (1-t)*(1-t)*a.x + 2*(1-t)*t*bez.cpx + t*t*b.x;
        const py = (1-t)*(1-t)*a.y + 2*(1-t)*t*bez.cpy + t*t*b.y;

        ctx.save();
        ctx.globalAlpha = p.particleAlpha * 0.7 * introA;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI*2);
        ctx.fillStyle = hexToRGBA(color, 0.12);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI*2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
      }
    }

    /* ── nodes ── */
    function drawNode(n, p, vp) {
      if (!n._visible) return;
      if (!inView(n, vp)) return;
      if (n._introAlpha < 0.01) return;

      let alpha = n._alpha * n._introAlpha;
      if (selectedNode || hoveredNode) {
        const hl = selectedNode || hoveredNode;
        if (n === hl) alpha = 1;
        else if (isConnected(hl, n)) alpha = 0.85 * n._introAlpha;
        else alpha = p.dimAlpha;
      }

      const regionColor = getRegionColor(n);
      const isOrg = n.type === 'organisation';
      const r = n.radius;

      ctx.save();
      ctx.globalAlpha = alpha;

      /* selected glow */
      if (n === selectedNode) {
        const pulse = 1 + Math.sin(pulsePhase) * 0.2;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 10 + pulse * 6, 0, Math.PI*2);
        ctx.fillStyle = hexToRGBA(regionColor, 0.08);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 6 + pulse * 4, 0, Math.PI*2);
        ctx.strokeStyle = hexToRGBA(regionColor, 0.25);
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      /* hover ring */
      if (n === hoveredNode && n !== selectedNode) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 5, 0, Math.PI*2);
        ctx.strokeStyle = p.hoverRing;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      /* org outer dashed ring */
      if (isOrg) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 5, 0, Math.PI*2);
        ctx.strokeStyle = hexToRGBA(regionColor, 0.35);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      /* shadow */
      ctx.shadowColor = hexToRGBA(regionColor, 0.25);
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 4;

      /* body */
      const grad = ctx.createRadialGradient(n.x - r*0.25, n.y - r*0.25, r*0.05, n.x, n.y, r);
      grad.addColorStop(0, hexToRGBA(regionColor, 0.95));
      grad.addColorStop(1, hexToRGBA(regionColor, 0.6));
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI*2);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      /* border */
      ctx.strokeStyle = hexToRGBA(regionColor, 0.85);
      ctx.lineWidth = 2;
      ctx.stroke();

      /* letter */
      ctx.fillStyle = '#fff';
      ctx.font = `${isOrg ? 'bold ':''}${Math.round(r*0.6)}px 'IBM Plex Sans',system-ui,sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n.label.charAt(0).toUpperCase(), n.x, n.y + 1);

      /* label */
      ctx.globalAlpha = alpha * 0.88;
      const fs = isOrg ? 11 : 9.5;
      ctx.font = `${isOrg ? '700':'600'} ${fs}px 'IBM Plex Sans',system-ui,sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      let label = n.label;
      if (label.length > 22) label = label.slice(0, 20) + '…';

      const tw = ctx.measureText(label).width;
      ctx.fillStyle = hexToRGBA(p.bg, 0.75);
      ctx.fillRect(n.x - tw/2 - 3, n.y + r + 5, tw + 6, fs + 5);
      ctx.fillStyle = p.labelFill;
      ctx.fillText(label, n.x, n.y + r + 7);

      ctx.restore();
    }

    function getRegionColor(n) {
      const rObj = regionMap[n.region] || regionMap[String(n.region).toLowerCase()];
      return rObj ? rObj.color : '#b91c2c';
    }
    function isConnected(a, b) {
      return a._connections.some(e =>
        e._visible && ((e.sourceNode === a && e.targetNode === b) || (e.targetNode === a && e.sourceNode === b))
      );
    }

    /* ── minimap ── */
    function drawMinimap(p) {
      if (!mmCtx || !mmCanvas) return;
      const mw = mmCanvas.width / dpr, mh = mmCanvas.height / dpr;
      mmCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      mmCtx.clearRect(0, 0, mw, mh);
      mmCtx.fillStyle = p.bg;
      mmCtx.fillRect(0, 0, mw, mh);

      const visibleNodes = nodes.filter(n => n._visible);
      if (!visibleNodes.length) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of visibleNodes) {
        if (n.x-n.radius < minX) minX = n.x-n.radius;
        if (n.y-n.radius < minY) minY = n.y-n.radius;
        if (n.x+n.radius > maxX) maxX = n.x+n.radius;
        if (n.y+n.radius > maxY) maxY = n.y+n.radius;
      }
      const pad = 40;
      minX -= pad; minY -= pad; maxX += pad; maxY += pad;
      const rangeX = maxX-minX || 1, rangeY = maxY-minY || 1;
      const sc = Math.min(mw/rangeX, mh/rangeY);
      const offX = (mw - rangeX*sc)/2, offY = (mh - rangeY*sc)/2;

      mmCtx.strokeStyle = hexToRGBA(p.muted, 0.15);
      mmCtx.lineWidth = 0.5;
      for (const e of edges) {
        if (!e._visible) continue;
        mmCtx.beginPath();
        mmCtx.moveTo(offX+(e.sourceNode.x-minX)*sc, offY+(e.sourceNode.y-minY)*sc);
        mmCtx.lineTo(offX+(e.targetNode.x-minX)*sc, offY+(e.targetNode.y-minY)*sc);
        mmCtx.stroke();
      }
      for (const n of nodes) {
        if (!n._visible) continue;
        mmCtx.beginPath();
        mmCtx.arc(offX+(n.x-minX)*sc, offY+(n.y-minY)*sc, Math.max(1.5, n.radius*sc*0.4), 0, Math.PI*2);
        mmCtx.fillStyle = hexToRGBA(getRegionColor(n), n === selectedNode ? 1 : 0.6);
        mmCtx.fill();
      }
      const vp = viewportBounds();
      mmCtx.strokeStyle = hexToRGBA('#b91c2c', 0.5);
      mmCtx.lineWidth = 1;
      mmCtx.strokeRect(offX+(vp.x1-minX)*sc, offY+(vp.y1-minY)*sc, (vp.x2-vp.x1)*sc, (vp.y2-vp.y1)*sc);
    }

    /* ══════════════════════════════
       HIT TESTING
       ══════════════════════════════ */
    function screenToWorld(sx, sy) {
      return { x: (sx-W/2)/zoom + W/2-panX, y: (sy-H/2)/zoom + H/2-panY };
    }
    function hitNode(wx, wy) {
      for (let i = nodes.length-1; i >= 0; i--) {
        if (!nodes[i]._visible) continue;
        if (dist({x:wx,y:wy}, nodes[i]) < nodes[i].radius + HIT_PAD) return nodes[i];
      }
      return null;
    }
    function hitEdge(wx, wy) {
      for (const e of edges) {
        if (!e._visible) continue;
        const a = e.sourceNode, b = e.targetNode;
        if (wx < Math.min(a.x,b.x)-12 || wx > Math.max(a.x,b.x)+12) continue;
        if (wy < Math.min(a.y,b.y)-12 || wy > Math.max(a.y,b.y)+12) continue;
        const bez = edgeBezier(a, b);
        for (let t = 0; t <= 1; t += 0.04) {
          const px = (1-t)*(1-t)*a.x + 2*(1-t)*t*bez.cpx + t*t*b.x;
          const py = (1-t)*(1-t)*a.y + 2*(1-t)*t*bez.cpy + t*t*b.y;
          if (Math.hypot(wx-px, wy-py) < 10) return e;
        }
      }
      return null;
    }

    /* ══════════════════════════════
       INTERACTION
       ══════════════════════════════ */
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', () => { hoveredNode = null; hoveredEdge = null; hideTooltip(); });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDblClick);

    function canvasCoords(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX-r.left, y: e.clientY-r.top }; }

    function onPointerDown(e) {
      if (e.pointerType === 'touch' && !e.isPrimary) return;
      const pos = canvasCoords(e);
      const w = screenToWorld(pos.x, pos.y);
      pointerDown = true; pointerMoved = false;
      lastPointerPos = pos;
      const hit = hitNode(w.x, w.y);
      if (hit) { dragNode = hit; canvas.setPointerCapture(e.pointerId); }
      else { isPanning = true; canvas.setPointerCapture(e.pointerId); }
    }

    function onPointerMove(e) {
      const pos = canvasCoords(e);
      const w = screenToWorld(pos.x, pos.y);
      if (dragNode) {
        pointerMoved = true;
        dragNode.x = w.x; dragNode.y = w.y;
        dragNode.vx = 0; dragNode.vy = 0;
        reheat();
      } else if (isPanning && pointerDown) {
        pointerMoved = true;
        panX += (pos.x - lastPointerPos.x) / zoom;
        panY += (pos.y - lastPointerPos.y) / zoom;
      } else {
        const hit = hitNode(w.x, w.y);
        hoveredNode = hit;
        canvas.style.cursor = hit ? 'pointer' : 'default';
        if (!hit) { hoveredEdge = hitEdge(w.x, w.y); canvas.style.cursor = hoveredEdge ? 'pointer' : 'default'; }
        else hoveredEdge = null;
        updateTooltip(pos, hit, hoveredEdge);
      }
      lastPointerPos = pos;
    }

    function onPointerUp(e) {
      if (dragNode) {
        if (pointerMoved) dragNode.pinned = true;
        else selectNode(dragNode);
        dragNode = null;
      } else if (!pointerMoved && pointerDown) {
        deselectNode();
      }
      isPanning = false; pointerDown = false;
      canvas.releasePointerCapture(e.pointerId);
    }

    function onDblClick(e) {
      const pos = canvasCoords(e);
      const w = screenToWorld(pos.x, pos.y);
      const hit = hitNode(w.x, w.y);
      if (hit) { hit.pinned = false; reheat(); }
    }

    function onWheel(e) { e.preventDefault(); targetZoom = clamp(targetZoom + (-Math.sign(e.deltaY)) * ZOOM_STEP * targetZoom, ZOOM_MIN, ZOOM_MAX); }

    /* touch pinch */
    canvas.addEventListener('touchstart', e => { if (e.touches.length === 2) { e.preventDefault(); pinchDist0 = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY); pinchZoom0 = zoom; } }, { passive: false });
    canvas.addEventListener('touchmove', e => { if (e.touches.length === 2 && pinchDist0) { e.preventDefault(); const d = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY); targetZoom = clamp(pinchZoom0*(d/pinchDist0), ZOOM_MIN, ZOOM_MAX); } }, { passive: false });
    canvas.addEventListener('touchend', () => { pinchDist0 = null; });

    /* ══════════════════════════════
       TOOLTIP
       ══════════════════════════════ */
    function updateTooltip(pos, node, edge) {
      if (node) {
        tooltip.innerHTML = `<strong>${esc(node.label)}</strong>${node.org ? `<br><span style="opacity:.6">${esc(node.org)}</span>` : ''}${node.region ? `<br><span style="opacity:.5">${esc(node.region)}</span>` : ''}${node.status ? `<br><em>${esc(node.status)}</em>` : ''}`;
        positionTooltip(pos); tooltip.hidden = false; tooltip.style.display = 'block';
      } else if (edge) {
        tooltip.innerHTML = `<strong>${esc(edge.label || edge.type)}</strong>`;
        positionTooltip(pos); tooltip.hidden = false; tooltip.style.display = 'block';
      } else hideTooltip();
    }
    function positionTooltip(pos) {
      let tx = pos.x+TOOLTIP_OFFSET, ty = pos.y+TOOLTIP_OFFSET;
      const tw = tooltip.offsetWidth||180, th = tooltip.offsetHeight||60;
      if (tx+tw > W-8) tx = pos.x-tw-TOOLTIP_OFFSET;
      if (ty+th > H-8) ty = pos.y-th-TOOLTIP_OFFSET;
      tooltip.style.left = Math.max(4,tx)+'px'; tooltip.style.top = Math.max(4,ty)+'px';
    }
    function hideTooltip() { tooltip.hidden = true; tooltip.style.display = 'none'; }

    /* ══════════════════════════════
       DETAIL PANEL
       ══════════════════════════════ */
    function resolveSources(ids) {
      return unique(ids).map(id => ({ id, ...(sourceIndex[id] || { label: id }) }));
    }

    function selectNode(n) {
      selectedNode = n;
      if (!detailPanel) return;

      const connected = [];
      for (const e of n._connections) {
        if (!e._visible) continue;
        const other = e.sourceNode === n ? e.targetNode : e.sourceNode;
        connected.push({ node: other, edge: e });
      }
      const statusClass = (n.status||'').toLowerCase().replace(/\s+/g,'-');
      const sources = resolveSources(n.sources);
      const countries = nodeCountries(n);

      detailPanel.innerHTML = `
        <button class="network-detail-close" aria-label="Close">&times;</button>
        <div class="detail-section">
          <h3>${esc(n.label)}</h3>
          ${n.status ? `<span class="network-status-badge status-${statusClass}">${esc(n.status)}</span>` : ''}
        </div>
        <div class="detail-section">
          <dl>
            ${n.org ? `<div><dt>Organisation</dt><dd>${esc(n.org)}</dd></div>` : ''}
            ${n.category ? `<div><dt>Category</dt><dd>${esc(n.category)}</dd></div>` : ''}
            ${countries.length ? `<div><dt>Country relevance</dt><dd>${countries.map(esc).join(', ')}</dd></div>` : ''}
            ${n.region ? `<div><dt>Region</dt><dd>${esc(n.region)}</dd></div>` : ''}
            ${n.cluster ? `<div><dt>Research cluster</dt><dd>${esc(n.cluster)}</dd></div>` : ''}
            ${n.role ? `<div><dt>Role</dt><dd>${esc(n.role)}</dd></div>` : ''}
            ${n.operatingAreas?.length ? `<div><dt>Operating areas</dt><dd>${n.operatingAreas.map(esc).join(', ')}</dd></div>` : ''}
          </dl>
        </div>
        ${n.summary ? `<div class="detail-section"><p class="network-detail-summary">${esc(n.summary)}</p></div>` : ''}
        ${n.aliases?.length ? `<div class="detail-section"><h4>Aliases and alternate names</h4><div class="network-detail-tags">${n.aliases.map(alias => `<span>${esc(alias)}</span>`).join('')}</div></div>` : ''}
        ${n.designations?.length ? `<div class="detail-section"><h4>Designation records</h4><ul class="network-detail-records">${n.designations.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div>` : ''}
        ${connected.length ? `<div class="detail-section">
          <h4>Connections (${connected.length})</h4>
          <ul class="network-detail-connections">
            ${connected.map(c => `<li>
              <button class="network-detail-link" data-node-id="${esc(c.node.id)}">${esc(c.node.label)}</button>
              <small>${esc(c.edge.label || c.edge.type)}</small>
            </li>`).join('')}
          </ul>
        </div>` : ''}
        ${sources.length ? `<div class="detail-section">
          <h4>Primary sources</h4>
          <ul class="network-detail-sources">
            ${sources.map(source => `<li>${source.url ? `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.label)}</a>` : esc(source.label)}</li>`).join('')}
          </ul>
        </div>` : ''}
        ${n.url ? `<div class="detail-section"><a class="network-detail-profile" href="${esc(n.url)}">View full profile →</a></div>` : ''}
      `;

      detailPanel.classList.add('is-open');
      detailPanel.querySelector('.network-detail-close')?.addEventListener('click', deselectNode);
      detailPanel.querySelectorAll('.network-detail-link').forEach(btn => {
        btn.addEventListener('click', () => {
          const target = nodeById[btn.dataset.nodeId];
          if (target) { selectNode(target); panToNode(target); }
        });
      });
    }
    function deselectNode() { selectedNode = null; if (detailPanel) detailPanel.classList.remove('is-open'); }
    function panToNode(n) { panX = -(n.x - W/2); panY = -(n.y - H/2); }

    /* ══════════════════════════════
       FILTERS
       ══════════════════════════════ */
    root.querySelectorAll('[data-filter]').forEach(el => {
      el.addEventListener('change', () => {
        const k = el.dataset.filter;
        if (k === 'country') { filterCountry = el.value; updateCountryBrowser(); }
        else if (k === 'region') filterRegion = el.value;
        else if (k === 'status') filterStatus = el.value;
        else if (k === 'edge-type') filterEdgeType = el.value;
        applyFilters();
        if (viewMode !== 'force') applyLayout(viewMode);
        else reheat();
      });
    });
    const searchInput = root.querySelector('[data-network-search]');
    if (searchInput) searchInput.addEventListener('input', debounce(() => {
      searchQuery = searchInput.value.trim().toLowerCase();
      applyFilters();
      if (viewMode !== 'force') applyLayout(viewMode);
    }, 200));

    function applyFilters() {
      const has = filterCountry || filterRegion || filterStatus || filterEdgeType || searchQuery;
      for (const n of nodes) {
        if (!has) { n._visible = true; n._alpha = 1; continue; }
        let match = true;
        if (filterCountry && !nodeCountries(n).some(country => country.toLowerCase() === filterCountry.toLowerCase())) match = false;
        if (filterRegion && (n.region||'').toLowerCase() !== filterRegion.toLowerCase()) match = false;
        if (filterStatus && (n.status||'').toLowerCase() !== filterStatus.toLowerCase()) match = false;
        if (searchQuery) {
          const hay = `${n.label} ${n.org||''} ${n.role||''} ${n.category||''} ${n.cluster||''} ${(n.tags||[]).join(' ')} ${(n.aliases||[]).join(' ')} ${nodeCountries(n).join(' ')} ${(n.designations||[]).join(' ')}`.toLowerCase();
          if (!hay.includes(searchQuery)) match = false;
        }
        n._visible = match;
        n._alpha = match ? 1 : THEMES[theme].dimAlpha;
      }
      for (const e of edges) {
        if (!has) { e._visible = true; e._alpha = 1; continue; }
        let m = e.sourceNode._visible && e.targetNode._visible;
        if (filterEdgeType && e.type !== filterEdgeType) m = false;
        e._visible = m;
        e._alpha = m ? 1 : THEMES[theme].dimAlpha;
      }
      if (selectedNode && !selectedNode._visible) deselectNode();
      updateStats();
    }

    function updateStats() {
      const el = root.querySelector('[data-network-stats]');
      if (!el) return;
      const vn = nodes.filter(n => n._visible).length;
      const ve = edges.filter(e => e._visible).length;
      el.textContent = `${filterCountry || 'World'} · ${vn} records · ${ve} connections`;
    }

    /* ══════════════════════════════
       VIEW MODES
       ══════════════════════════════ */
    root.querySelectorAll('[data-view-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        setViewMode(btn.dataset.viewMode);
      });
    });

    function setViewMode(mode) {
      viewMode = mode;
      root.querySelectorAll('[data-view-mode]').forEach(button => {
        button.classList.toggle('is-active', button.dataset.viewMode === mode);
      });
      applyLayout(mode);
    }

    function applyLayout(mode) {
      layoutTargets = {};
      layoutGroupLabels = [];
      layoutTransitionProgress = 0;
      panX = 0; panY = 0; targetZoom = 1;
      if (mode === 'country') layoutCountry();
      else if (mode === 'hierarchical') layoutHierarchical();
      else if (mode === 'radial') layoutRadial();
      else { for (const n of nodes) n.pinned = false; layoutTargets = null; layoutTransitionProgress = 1; temperature = 0.8; simRunning = true; return; }
      simRunning = true;
      temperature = 0.008;
    }

    function layoutCountry() {
      const visible = nodes.filter(n => n._visible);
      const groups = new Map();
      for (const node of visible) {
        const key = filterCountry
          ? (node.cluster || node.org || 'Other Pakistan-linked records')
          : (node.country || nodeCountries(node)[0] || node.region || 'Global');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(node);
      }

      const entries = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
      if (!entries.length) return;
      const aspect = Math.max(0.7, W / Math.max(H, 1));
      const cols = Math.max(1, Math.ceil(Math.sqrt(entries.length * aspect)));
      const rows = Math.max(1, Math.ceil(entries.length / cols));
      const cellW = W / cols;
      const cellH = H / rows;

      entries.forEach(([, members], groupIndex) => {
        const col = groupIndex % cols;
        const row = Math.floor(groupIndex / cols);
        const cx = cellW * (col + 0.5);
        const cy = cellH * (row + 0.5);
        layoutGroupLabels.push({ text: entries[groupIndex][0], x: cx, y: cy - Math.min(cellH * 0.4, 145) });
        const ordered = [...members].sort((a, b) => (a.type === 'organisation' ? -1 : 1) - (b.type === 'organisation' ? -1 : 1) || a.label.localeCompare(b.label));
        ordered.forEach((node, index) => {
          if (index === 0) {
            layoutTargets[node.id] = { x: cx, y: cy };
            return;
          }
          const ring = Math.floor((index - 1) / 8);
          const place = (index - 1) % 8;
          const countOnRing = Math.min(8, ordered.length - 1 - ring * 8);
          const radius = Math.min(Math.min(cellW, cellH) * 0.38, 60 + ring * 55);
          const angle = -Math.PI / 2 + (2 * Math.PI * place) / Math.max(countOnRing, 1);
          layoutTargets[node.id] = { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
        });
      });
    }

    function layoutHierarchical() {
      const orgs = nodes.filter(n => n._visible && n.type === 'organisation');
      const inds = nodes.filter(n => n._visible && n.type !== 'organisation');
      const cx = W/2, cy = H/2;
      orgs.forEach((n, i) => {
        const a = (2*Math.PI*i)/(orgs.length||1);
        const r = Math.min(W,H)*0.18;
        layoutTargets[n.id] = { x: cx+Math.cos(a)*r, y: cy+Math.sin(a)*r };
      });
      const groups = {};
      inds.forEach(n => { const k = n.org||'__none__'; if (!groups[k]) groups[k]=[]; groups[k].push(n); });
      Object.entries(groups).forEach(([key, members]) => {
        let ocx = cx, ocy = cy;
        const orgNode = nodes.find(o => o._visible && o.type === 'organisation' && o.label === key);
        if (orgNode && layoutTargets[orgNode.id]) { ocx = layoutTargets[orgNode.id].x; ocy = layoutTargets[orgNode.id].y; }
        const ring = Math.min(W,H)*0.32;
        members.forEach((n, i) => {
          const a = (2*Math.PI*i)/members.length;
          layoutTargets[n.id] = { x: ocx+Math.cos(a)*ring, y: ocy+Math.sin(a)*ring };
        });
      });
    }

    function layoutRadial() {
      const cx = W/2, cy = H/2;
      const regionGroups = {};
      nodes.filter(n => n._visible).forEach(n => { const k = n.region||'Other'; if (!regionGroups[k]) regionGroups[k]=[]; regionGroups[k].push(n); });
      const keys = Object.keys(regionGroups);
      keys.forEach((key, ri) => {
        const ga = (2*Math.PI*ri)/keys.length;
        const members = regionGroups[key];
        const base = Math.min(W,H)*0.26;
        members.forEach((n, i) => {
          const rr = base + i * 50;
          const spread = 0.6;
          const a = ga + (i - members.length/2) * spread / members.length;
          layoutTargets[n.id] = { x: cx+Math.cos(a)*rr, y: cy+Math.sin(a)*rr };
        });
      });
    }

    /* ── zoom controls ── */
    root.querySelectorAll('[data-zoom]').forEach(btn => {
      btn.addEventListener('click', () => {
        const a = btn.dataset.zoom;
        if (a === 'in') targetZoom = clamp(targetZoom + ZOOM_STEP*targetZoom, ZOOM_MIN, ZOOM_MAX);
        else if (a === 'out') targetZoom = clamp(targetZoom - ZOOM_STEP*targetZoom, ZOOM_MIN, ZOOM_MAX);
        else { targetZoom = 1; panX = 0; panY = 0; }
      });
    });

    /* ── keyboard ── */
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      switch (e.key) {
        case 'Escape': deselectNode(); break;
        case '+': case '=': targetZoom = clamp(targetZoom + ZOOM_STEP*targetZoom, ZOOM_MIN, ZOOM_MAX); break;
        case '-': case '_': targetZoom = clamp(targetZoom - ZOOM_STEP*targetZoom, ZOOM_MIN, ZOOM_MAX); break;
        case '0': targetZoom = 1; panX = 0; panY = 0; break;
        case 'f': case 'F':
          if (!document.fullscreenElement) root.requestFullscreen?.();
          else document.exitFullscreen?.();
          break;
      }
    });

    /* ── loop ── */
    function loop() { simulate(); draw(); requestAnimationFrame(loop); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
