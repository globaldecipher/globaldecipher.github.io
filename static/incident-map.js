(function () {
  const root = document.querySelector('[data-incident-tracker]');
  if (!root) return;

  const DATA_URL = '/assets/data/incidents.json';
  const PAKISTAN_TIME_ZONE = 'Asia/Karachi';
  const ARCHIVE_DAYS = 30;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const PROVINCES = [
    { key: 'balochistan', label: 'Balochistan' },
    { key: 'khyber-pakhtunkhwa', label: 'Khyber Pakhtunkhwa' },
    { key: 'sindh', label: 'Sindh' },
    { key: 'punjab', label: 'Punjab' },
    { key: 'gilgit-baltistan', label: 'Gilgit-Baltistan' },
    { key: 'islamabad', label: 'Islamabad Capital Territory' }
  ];
  const PROVINCE_LABELS = new Map(PROVINCES.map((province) => [province.key, province.label]));
  const HOTSPOT_ANCHORS = new Map([
    ['balochistan', { x: 0.42, y: 0.58 }],
    ['khyber-pakhtunkhwa', { x: 0.44, y: 0.56 }],
    ['sindh', { x: 0.52, y: 0.58 }],
    ['punjab', { x: 0.42, y: 0.54 }],
    ['gilgit-baltistan', { x: 0.52, y: 0.48 }],
    ['islamabad', { x: 0.5, y: 0.5 }]
  ]);

  const state = {
    allIncidents: [],
    archivedIncidents: [],
    incidents: [],
    filtered: [],
    currentDate: todayInPakistan(),
    selectedDate: todayInPakistan(),
    filters: { date: todayInPakistan(), province: '', category: '', severity: '', search: '' }
  };

  const els = {
    sourceNote: root.querySelector('[data-source-note]'),
    lastUpdated: root.querySelector('[data-last-updated]'),
    metrics: root.querySelector('[data-metrics]'),
    weeklyAnalytics: root.querySelector('[data-weekly-analytics]'),
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

  function dateToUtcMs(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return NaN;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function dateFromUtcMs(ms) {
    const date = new Date(ms);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function addDays(value, days) {
    const ms = dateToUtcMs(value);
    if (!Number.isFinite(ms)) return value;
    return dateFromUtcMs(ms + days * DAY_MS);
  }

  function archiveStartDate() {
    return addDays(state.currentDate, -(ARCHIVE_DAYS - 1));
  }

  function isWithinArchiveWindow(value) {
    const ms = dateToUtcMs(value);
    const start = dateToUtcMs(archiveStartDate());
    const end = dateToUtcMs(state.currentDate);
    return Number.isFinite(ms) && ms >= start && ms <= end;
  }

  function formatPakistanDay(value) {
    const ms = dateToUtcMs(value);
    if (!Number.isFinite(ms)) return value || 'today';
    return new Intl.DateTimeFormat('en', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(ms));
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

  function sortIncidents(incidents) {
    return incidents.slice().sort((a, b) => (
      String(b.date || '').localeCompare(String(a.date || '')) ||
      String(b.reported_at || '').localeCompare(String(a.reported_at || '')) ||
      String(b.id || '').localeCompare(String(a.id || ''))
    ));
  }

  function fallbackWeekLabel(value) {
    const day = Number(String(value || '').slice(8, 10));
    if (!day) return 'Archive week';
    if (day <= 7) return '1st week';
    if (day <= 10) return '2nd week';
    if (day <= 17) return '3rd week';
    if (day <= 24) return '4th week';
    return '5th week';
  }

  function weekLabel(incident) {
    return String(incident.week_label || incident.week || fallbackWeekLabel(incident.date)).trim();
  }

  function weekOrder(label) {
    const text = normalise(label);
    const number = Number((text.match(/\d+/) || [0])[0]);
    return number || 99;
  }

  function setSelectedDate(value) {
    const nextDate = String(value || '').match(/^\d{4}-\d{2}-\d{2}$/) ? value : state.currentDate;
    state.selectedDate = nextDate;
    state.filters.date = nextDate;
    state.incidents = state.archivedIncidents.filter((incident) => String(incident.date || '') === nextDate);
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
    if (!group.count) return `No incident logged for ${formatPakistanDay(state.selectedDate)}.`;
    const categories = topLabels(group.categories, 2).join(' ').toLowerCase();
    if (group.fatalities + group.injuries >= 5) return 'High-impact reporting in selected day.';
    if (group.high >= 2) return 'High-severity activity concentrated in this day.';
    if (categories.includes('counterterrorism')) return 'Security operations dominate selected day.';
    if (categories.includes('drone') || categories.includes('quadcopter')) return 'Drone and quadcopter reporting is active.';
    if (categories.includes('ied') || categories.includes('explosion')) return 'Explosive incidents are prominent.';
    return 'Comparatively limited activity in selected day.';
  }

  function provinceColor(count) {
    if (count >= 6) return '#7f0c10';
    if (count >= 3) return '#c3202b';
    if (count >= 1) return '#e7b2b2';
    return '#d9d9d7';
  }

  function findProvincePath(doc, key) {
    return Array.from(doc.querySelectorAll('[data-region]')).find((path) => provinceKey(path.dataset.region) === key);
  }

  function positionHotspotInsideProvince(doc, hotspot) {
    const key = provinceKey(hotspot.dataset.provinceHotspot);
    const path = findProvincePath(doc, key);
    const frame = els.mapObject?.closest('[data-map]');
    const svg = doc.documentElement;
    const viewBox = svg?.viewBox?.baseVal;
    if (!path || !frame || !viewBox || !viewBox.width || !viewBox.height) return;

    try {
      const box = path.getBBox();
      const anchor = HOTSPOT_ANCHORS.get(key) || { x: 0.5, y: 0.5 };
      const objectRect = els.mapObject.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      const x = (box.x + box.width * anchor.x - viewBox.x) / viewBox.width;
      const y = (box.y + box.height * anchor.y - viewBox.y) / viewBox.height;
      hotspot.style.left = String(objectRect.left - frameRect.left + objectRect.width * x) + 'px';
      hotspot.style.top = String(objectRect.top - frameRect.top + objectRect.height * y) + 'px';
    } catch (_error) {
      // Keep the CSS fallback if the embedded SVG is not ready yet.
    }
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
    els.provinceHotspots.forEach((hotspot) => positionHotspotInsideProvince(doc, hotspot));
  }

  function renderProvinceCards(groups) {
    const activeGroups = PROVINCES
      .map((province) => groups.get(province.key))
      .filter((group) => group && group.count > 0)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    if (els.provincePanel) {
      els.provincePanel.innerHTML = activeGroups.length ? activeGroups.map((group) => {
        const key = group.key;
        const districts = topLabels(group.districts).join(', ') || 'None in selected day';
        const actorLabels = topLabels(group.actors).filter((actor) => !/unidentified|unspecified/i.test(actor));
        const actors = (actorLabels.length ? actorLabels : topLabels(group.actors)).join(', ') || 'None in selected day';
        return `<article class='province-card' data-province-card='${esc(group.label)}'><h3>${esc(PROVINCE_LABELS.get(key) || group.label)}</h3><div class='province-total'><strong>${formatCount(group.count)}</strong><span>Total Attack${group.count === 1 ? '' : 's'}</span></div><div class='province-detail'><span>Most affected district${group.districts.size === 1 ? '' : 's'}</span><strong>${esc(districts)}</strong></div><div class='province-detail'><span>Most active actor</span><strong>${esc(actors)}</strong></div><div class='province-detail'><span>Trends</span><p class='province-trend'>${esc(trendFor(group))}</p></div></article>`;
      }).join('') : `<p class='breakdown-empty'>No incidents logged for ${esc(formatPakistanDay(state.selectedDate))} Pakistan time.</p>`;
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
    return select.value;
  }

  function populateFilters() {
    for (const field of els.filters) {
      const key = field.dataset.filter;
      if (key === 'date') {
        field.min = archiveStartDate();
        field.max = state.currentDate;
        field.value = state.selectedDate;
        field.title = `Archive available from ${formatPakistanDay(field.min)} to ${formatPakistanDay(field.max)}.`;
        continue;
      }
      if (field.tagName !== 'SELECT') continue;
      const labels = { province: 'All provinces', category: 'All categories', severity: 'All severities' };
      state.filters[key] = fillSelect(field, uniqueValues(key), labels[key] || 'All');
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
      metric('Incidents', formatCount(state.filtered.length), 'Selected date'),
      metric('Fatalities', formatCount(fatalities), 'Reported in feed'),
      metric('Injuries', formatCount(injuries), 'Reported in feed'),
      metric('Provinces', formatCount(provinces), 'Daily spread'),
      metric('High severity', formatCount(high), 'Marked for review')
    ].join('');
  }

  function weeklyGroups() {
    const groups = new Map();
    for (const incident of state.archivedIncidents) {
      const label = weekLabel(incident);
      if (!groups.has(label)) {
        groups.set(label, { label, count: 0, fatalities: 0, injuries: 0, provinces: new Map(), categories: new Map() });
      }
      const group = groups.get(label);
      group.count += 1;
      group.fatalities += Number(incident.fatalities || 0);
      group.injuries += Number(incident.injuries || 0);
      addCount(group.provinces, incident.province || 'Unspecified');
      addCount(group.categories, incident.category || 'Security incident');
    }
    return Array.from(groups.values()).sort((a, b) => weekOrder(a.label) - weekOrder(b.label) || a.label.localeCompare(b.label));
  }

  function barRow(label, value, max, detail, className = '') {
    const percent = max ? Math.max(5, Math.round((value / max) * 100)) : 0;
    return `<div class='weekly-bar-row ${esc(className)}'><div class='weekly-bar-label'>${esc(label)}</div><div class='weekly-bar-track'><span style='width:${percent}%'></span></div><strong>${esc(formatCount(value))}</strong><em>${esc(detail || '')}</em></div>`;
  }

  function renderWeeklyAnalytics() {
    if (!els.weeklyAnalytics) return;
    const groups = weeklyGroups();
    if (!groups.length) {
      els.weeklyAnalytics.innerHTML = '';
      return;
    }
    const maxIncidents = Math.max(...groups.map((group) => group.count), 1);
    const maxFatalities = Math.max(...groups.map((group) => group.fatalities), 1);
    const incidentRows = groups.map((group) => {
      const topProvince = topLabels(group.provinces, 1)[0] || 'No province';
      return barRow(group.label, group.count, maxIncidents, topProvince);
    }).join('');
    const fatalityRows = groups.map((group) => {
      const detail = `${formatCount(group.injuries)} injured`;
      return barRow(group.label, group.fatalities, maxFatalities, detail, 'is-fatality');
    }).join('');
    const latest = groups[groups.length - 1];
    const categories = topLabels(latest.categories, 4).map((category) => `<span>${esc(category)}</span>`).join('');
    els.weeklyAnalytics.innerHTML = `<div class='weekly-chart-head'><span>Weekly archive graphs</span><strong>${esc(formatPakistanDay(archiveStartDate()))} to ${esc(formatPakistanDay(state.currentDate))}</strong></div><div class='weekly-chart-grid'><article class='weekly-chart-card'><h3>Incident volume</h3>${incidentRows}</article><article class='weekly-chart-card'><h3>Fatalities by week</h3>${fatalityRows}</article><article class='weekly-chart-card weekly-focus'><h3>Latest week profile</h3><strong>${esc(latest.label)}</strong><p>${formatCount(latest.count)} incidents, ${formatCount(latest.fatalities)} fatalities, ${formatCount(latest.injuries)} injuries.</p><div>${categories}</div></article></div>`;
  }

  function renderMap() {
    els.markerLayer.innerHTML = '';
    els.mapCount.textContent = `${formatCount(state.filtered.length)} incident${state.filtered.length === 1 ? '' : 's'}`;
  }

  function renderList() {
    els.resultCount.textContent = `${formatCount(state.filtered.length)} shown`;
    if (!state.filtered.length) {
      const archiveText = isWithinArchiveWindow(state.selectedDate)
        ? `No incidents logged for ${formatPakistanDay(state.selectedDate)} Pakistan time yet.`
        : `Date is outside the ${ARCHIVE_DAYS}-day archive window.`;
      const emptyMessage = state.incidents.length ? 'No incidents match these filters.' : archiveText;
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
    renderWeeklyAnalytics();
    renderProvinceCards(provinceGroups());
    renderMap();
    renderList();
  }

  function renderSourceNote() {
    const count = state.incidents.length;
    const incidentLabel = count === 1 ? 'incident' : 'incidents';
    els.sourceNote.textContent = formatCount(count) + ' ' + incidentLabel + ' mapped for ' + formatPakistanDay(state.selectedDate) + '. Archive keeps the latest ' + ARCHIVE_DAYS + ' Pakistan-time days.';
  }

  async function loadFeed() {
    try {
      state.currentDate = todayInPakistan();
      const response = await fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) throw new Error('Feed returned ' + response.status);
      const data = await response.json();
      const allIncidents = Array.isArray(data.incidents) ? data.incidents.slice() : [];
      state.allIncidents = sortIncidents(allIncidents);
      state.archivedIncidents = state.allIncidents.filter((incident) => isWithinArchiveWindow(incident.date));
      setSelectedDate(state.filters.date || state.currentDate);
      renderSourceNote();
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
    const nextToday = todayInPakistan();
    if (nextToday === state.currentDate) return;
    const previousToday = state.currentDate;
    state.currentDate = nextToday;
    if (state.filters.date === previousToday) state.filters.date = nextToday;
    loadFeed();
  }

  els.filters.forEach((field) => {
    field.addEventListener('input', () => {
      const key = field.dataset.filter;
      if (key === 'date') {
        setSelectedDate(field.value || state.currentDate);
        populateFilters();
      } else {
        state.filters[key] = field.value;
      }
      renderSourceNote();
      render();
    });
  });

  if (els.mapObject) {
    els.mapObject.addEventListener('load', () => renderProvinceCards(provinceGroups()));
  }

  window.addEventListener('resize', () => renderProvinceCards(provinceGroups()));

  loadFeed();
  window.setInterval(loadFeed, 90000);
  window.setInterval(refreshIfPakistanDayChanged, 30000);
})();