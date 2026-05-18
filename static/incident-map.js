(function () {
  const root = document.querySelector('[data-incident-tracker]');
  if (!root) return;

  const DATA_URL = '/assets/data/incidents.json';
  const PAKISTAN_TIME_ZONE = 'Asia/Karachi';
  const PROVINCES = [
    { key: 'balochistan', label: 'Balochistan' },
    { key: 'khyber-pakhtunkhwa', label: 'Khyber Pakhtunkhwa' },
    { key: 'sindh', label: 'Sindh' },
    { key: 'punjab', label: 'Punjab' },
    { key: 'gilgit-baltistan', label: 'Gilgit-Baltistan' },
    { key: 'islamabad', label: 'Islamabad Capital Territory' }
  ];
  const PROVINCE_LABELS = new Map(PROVINCES.map((province) => [province.key, province.label]));

  const state = {
    allIncidents: [],
    incidents: [],
    filtered: [],
    currentDate: todayInPakistan(),
    filters: { province: '', category: '', severity: '', search: '' }
  };

  const els = {
    sourceNote: root.querySelector('[data-source-note]'),
    lastUpdated: root.querySelector('[data-last-updated]'),
    metrics: root.querySelector('[data-metrics]'),
    markerLayer: root.querySelector('[data-marker-layer]'),
    mapObject: root.querySelector('.tracker-pakistan-map'),
    incidentList: root.querySelector('[data-incident-list]'),
    mapCount: root.querySelector('[data-map-count]'),
    resultCount: root.querySelector('[data-result-count]'),
    filters: Array.from(root.querySelectorAll('[data-filter]')),
    provincePanel: root.querySelector('[data-province-cards]'),
    provinceHotspots: Array.from(root.querySelectorAll('[data-province-hotspot]'))
  };

  function esc(value) {
    return String(value ?? '')
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split(String.fromCharCode(34)).join('&quot;')
      .split(String.fromCharCode(39)).join('&#39;');
  }

  function normalise(value) {
    return String(value || '').trim().toLowerCase();
  }

  function formatCount(value) {
    return new Intl.NumberFormat('en').format(Number(value || 0));
  }

  function pakistanDateFromDate(date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: PAKISTAN_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const byType = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
  }

  function todayInPakistan() {
    return pakistanDateFromDate(new Date());
  }

  function formatPakistanDay(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return value || 'today';
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return new Intl.DateTimeFormat('en', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
  }

  function formatDate(value) {
    if (!value) return 'Unknown';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: PAKISTAN_TIME_ZONE }).format(date);
  }

  function severityClass(value) {
    const severity = normalise(value);
    if (severity.includes('low')) return 'low';
    if (severity.includes('medium')) return 'medium';
    return 'high';
  }

  function provinceKey(value) {
    const compact = normalise(value).replace(/[^a-z0-9]+/g, '');
    if (!compact) return '';
    if (compact.includes('baloch') || compact.includes('baluch')) return 'balochistan';
    if (compact.includes('khyber') || compact === 'kp' || compact.includes('fata')) return 'khyber-pakhtunkhwa';
    if (compact.includes('sind')) return 'sindh';
    if (compact.includes('punjab')) return 'punjab';
    if (compact.includes('gilgit') || compact.includes('northernareas')) return 'gilgit-baltistan';
    if (compact.includes('islamabad') || compact.includes('fct')) return 'islamabad';
    return compact;
  }

  function addCount(map, value, amount = 1) {
    const label = String(value || '').trim();
    if (label) map.set(label, (map.get(label) || 0) + amount);
  }

  function topLabels(map, limit = 3) {
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([label]) => label);
  }

  function visibleIncidentsForPakistanDay(incidents) {
    state.currentDate = todayInPakistan();
    return incidents.filter((incident) => String(incident.date || '') === state.currentDate);
  }

  function provinceGroups() {
    const groups = new Map(PROVINCES.map((province) => [province.key, {
      ...province,
      count: 0,
      fatalities: 0,
      injuries: 0,
      high: 0,
      districts: new Map(),
      actors: new Map(),
      categories: new Map()
    }]));

    for (const incident of state.filtered) {
      const key = provinceKey(incident.province);
      if (!groups.has(key)) continue;
      const group = groups.get(key);
      group.count += 1;
      group.fatalities += Number(incident.fatalities || 0);
      group.injuries += Number(incident.injuries || 0);
      if (severityClass(incident.severity) === 'high') group.high += 1;
      addCount(group.districts, incident.district);
      addCount(group.actors, incident.actor || 'Unspecified');
      addCount(group.categories, incident.category);
    }
    return groups;
  }

  function trendFor(group) {
    if (!group.count) return `No incident logged for ${formatPakistanDay(state.currentDate)}.`;
    const categories = topLabels(group.categories, 2).join(' ').toLowerCase();
    if (group.fatalities + group.injuries >= 5) return 'High-impact reporting in current feed.';
    if (group.high >= 2) return 'High-severity activity concentrated in this cycle.';
    if (categories.includes('counterterrorism')) return 'Security operations dominate current feed.';
    if (categories.includes('drone') || categories.includes('quadcopter')) return 'Drone and quadcopter reporting is active.';
    if (categories.includes('ied') || categories.includes('explosion')) return 'Explosive incidents are prominent.';
    return 'Comparatively limited activity in current feed.';
  }

  function provinceColor(count) {
    if (count >= 6) return '#7f0c10';
    if (count >= 3) return '#c3202b';
    if (count >= 1) return '#e7b2b2';
    return '#d9d9d7';
  }

  function updateProvinceMap(groups) {
    const doc = els.mapObject?.contentDocument;
    if (!doc) return;
    doc.querySelectorAll('[data-region]').forEach((path) => {
      const group = groups.get(provinceKey(path.dataset.region));
      const count = group?.count || 0;
      path.style.fill = provinceColor(count);
      path.style.stroke = count ? 'rgba(70, 10, 14, 0.72)' : 'rgba(31, 42, 56, 0.32)';
    });
  }

  function renderProvinceCards(groups) {
    const activeGroups = PROVINCES
      .map((province) => groups.get(province.key))
      .filter((group) => group && group.count > 0)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    if (els.provincePanel) {
      els.provincePanel.innerHTML = activeGroups.length ? activeGroups.map((group) => {
        const key = group.key;
        const districts = topLabels(group.districts).join(', ') || 'None in current feed';
        const actorLabels = topLabels(group.actors).filter((actor) => !/unidentified|unspecified/i.test(actor));
        const actors = (actorLabels.length ? actorLabels : topLabels(group.actors)).join(', ') || 'None in current feed';
        return `<article class='province-card' data-province-card='${esc(group.label)}'><h3>${esc(PROVINCE_LABELS.get(key) || group.label)}</h3><div class='province-total'><strong>${formatCount(group.count)}</strong><span>Total Attack${group.count === 1 ? '' : 's'}</span></div><div class='province-detail'><span>Most affected district${group.districts.size === 1 ? '' : 's'}</span><strong>${esc(districts)}</strong></div><div class='province-detail'><span>Most active actor</span><strong>${esc(actors)}</strong></div><div class='province-detail'><span>Trends</span><p class='province-trend'>${esc(trendFor(group))}</p></div></article>`;
      }).join('') : `<p class='breakdown-empty'>No incidents logged for ${esc(formatPakistanDay(state.currentDate))} Pakistan time.</p>`;
    }

    for (const hotspot of els.provinceHotspots) {
      const group = groups.get(provinceKey(hotspot.dataset.provinceHotspot));
      const count = group?.count || 0;
      hotspot.textContent = formatCount(count);
      hotspot.classList.toggle('is-empty', count === 0);
      hotspot.title = `${group?.label || hotspot.dataset.provinceHotspot}: ${formatCount(count)} incident${count === 1 ? '' : 's'}`;
    }
    updateProvinceMap(groups);
  }

  function uniqueValues(key) {
    return Array.from(new Set(state.incidents.map((incident) => incident[key]).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  function fillSelect(select, values, allLabel) {
    const current = select.value;
    select.innerHTML = [`<option value=''>${esc(allLabel)}</option>`]
      .concat(values.map((value) => `<option value='${esc(value)}'>${esc(value)}</option>`))
      .join('');
    select.value = values.includes(current) ? current : '';
  }

  function populateFilters() {
    for (const field of els.filters) {
      const key = field.dataset.filter;
      if (field.tagName !== 'SELECT') continue;
      const labels = { province: 'All provinces', category: 'All categories', severity: 'All severities' };
      fillSelect(field, uniqueValues(key), labels[key] || 'All');
    }
  }

  function matchesFilters(incident) {
    const haystack = [incident.title, incident.district, incident.province, incident.category, incident.actor, incident.status, incident.summary]
      .map(normalise)
      .join(' ');
    return (!state.filters.province || incident.province === state.filters.province) &&
      (!state.filters.category || incident.category === state.filters.category) &&
      (!state.filters.severity || incident.severity === state.filters.severity) &&
      (!state.filters.search || haystack.includes(normalise(state.filters.search)));
  }

  function applyFilters() {
    state.filtered = state.incidents.filter(matchesFilters);
  }

  function metric(label, value, note) {
    return `<article class='tracker-metric'><span class='metric-label'>${esc(label)}</span><strong class='metric-value'>${esc(value)}</strong><span class='metric-note'>${esc(note)}</span></article>`;
  }

  function renderMetrics() {
    const fatalities = state.filtered.reduce((sum, item) => sum + Number(item.fatalities || 0), 0);
    const injuries = state.filtered.reduce((sum, item) => sum + Number(item.injuries || 0), 0);
    const provinces = new Set(state.filtered.map((item) => item.province).filter(Boolean)).size;
    const high = state.filtered.filter((item) => severityClass(item.severity) === 'high').length;
    els.metrics.innerHTML = [
      metric('Incidents', formatCount(state.filtered.length), 'Shown for today'),
      metric('Fatalities', formatCount(fatalities), 'Reported in feed'),
      metric('Injuries', formatCount(injuries), 'Reported in feed'),
      metric('Provinces', formatCount(provinces), 'Current spread'),
      metric('High severity', formatCount(high), 'Marked for review')
    ].join('');
  }

  function renderMap() {
    els.markerLayer.innerHTML = '';
    els.mapCount.textContent = `${formatCount(state.filtered.length)} incident${state.filtered.length === 1 ? '' : 's'}`;
  }

  function renderList() {
    els.resultCount.textContent = `${formatCount(state.filtered.length)} shown`;
    if (!state.filtered.length) {
      const emptyMessage = state.incidents.length ? 'No incidents match these filters.' : `No incidents logged for ${formatPakistanDay(state.currentDate)} Pakistan time yet.`;
      els.incidentList.innerHTML = `<p class='tracker-empty'>${esc(emptyMessage)}</p>`;
      return;
    }

    els.incidentList.innerHTML = state.filtered.map((incident, index) => {
      const casualtyLine = `${formatCount(incident.fatalities)} killed / ${formatCount(incident.injuries)} injured`;
      const source = incident.source_url ? `<a href='${esc(incident.source_url)}' target='_blank' rel='noopener noreferrer'>${esc(incident.source || 'Source')}</a>` : `<span>${esc(incident.source || 'Source pending')}</span>`;
      return `<article class='incident-item' data-incident-id='${esc(incident.id)}'><div class='tracker-card-meta'><span>${index + 1}</span><span>${esc(incident.date)}</span><span>${esc(incident.province)}</span><span>${esc(incident.category)}</span></div><h3>${esc(incident.title)}</h3><p>${esc(incident.summary)}</p><div class='tracker-card-foot'><span>${esc(incident.district)}</span><span>${esc(incident.severity)}</span><span>${esc(casualtyLine)}</span><span>${esc(incident.status)}</span>${source}</div></article>`;
    }).join('');
  }

  function render() {
    applyFilters();
    renderMetrics();
    renderProvinceCards(provinceGroups());
    renderMap();
    renderList();
  }

  function renderSourceNote(data) {
    const base = data.source_note || '';
    const dayNote = `Showing ${formatPakistanDay(state.currentDate)} Pakistan time.`;
    els.sourceNote.textContent = [base, dayNote].filter(Boolean).join(' ');
  }

  async function loadFeed() {
    try {
      const response = await fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) throw new Error('Feed returned ' + response.status);
      const data = await response.json();
      const allIncidents = Array.isArray(data.incidents) ? data.incidents.slice() : [];
      state.allIncidents = allIncidents.sort((a, b) => (
        String(b.date || '').localeCompare(String(a.date || '')) ||
        String(b.reported_at || '').localeCompare(String(a.reported_at || '')) ||
        String(b.id || '').localeCompare(String(a.id || ''))
      ));
      state.incidents = visibleIncidentsForPakistanDay(state.allIncidents);
      renderSourceNote(data);
      els.lastUpdated.textContent = 'Updated ' + formatDate(data.last_updated);
      populateFilters();
      render();
    } catch (error) {
      els.lastUpdated.textContent = 'Feed unavailable';
      els.sourceNote.textContent = 'The incident feed could not load. Please refresh the page.';
      els.incidentList.innerHTML = `<p class='tracker-empty'>${esc(error.message)}</p>`;
    }
  }

  function refreshIfPakistanDayChanged() {
    if (todayInPakistan() !== state.currentDate) loadFeed();
  }

  els.filters.forEach((field) => {
    field.addEventListener('input', () => {
      state.filters[field.dataset.filter] = field.value;
      render();
    });
  });

  if (els.mapObject) {
    els.mapObject.addEventListener('load', () => renderProvinceCards(provinceGroups()));
  }

  loadFeed();
  window.setInterval(loadFeed, 90000);
  window.setInterval(refreshIfPakistanDayChanged, 30000);
})();
