import fs from 'fs';
import path from 'path';

const DATA_PATH = 'static/data/incidents.json';
const STATE_PATH = 'static/data/telegram-state.json';
const DEBUG_PATH = 'static/data/telegram-debug.json';
const IMPORT_DIR = 'static/data/imports';
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || '').trim();
const DEBUG = String(process.env.TELEGRAM_DEBUG || '').toLowerCase() === 'true';
const PAKISTAN_TIME_ZONE = 'Asia/Karachi';
const ARCHIVE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const DISTRICTS = [
  { terms: ['bajaur', 'loi sam'], district: 'Bajaur', province: 'Khyber Pakhtunkhwa', lat: 34.72, lng: 71.5 },
  { terms: ['lakki', 'ghazni khel', 'darra tang'], district: 'Lakki Marwat', province: 'Khyber Pakhtunkhwa', lat: 32.61, lng: 70.91 },
  { terms: ['tank', 'wanda zalu', 'wanda zalo', 'wanda zulu'], district: 'Tank', province: 'Khyber Pakhtunkhwa', lat: 32.22, lng: 70.38 },
  { terms: ['wana', 'south waziristan'], district: 'South Waziristan', province: 'Khyber Pakhtunkhwa', lat: 32.3, lng: 69.57 },
  { terms: ['dera ismail khan', 'di khan'], district: 'Dera Ismail Khan', province: 'Khyber Pakhtunkhwa', lat: 31.83, lng: 70.9 },
  { terms: ['bannu'], district: 'Bannu', province: 'Khyber Pakhtunkhwa', lat: 32.99, lng: 70.6 },
  { terms: ['north waziristan', 'mir ali', 'miranshah', 'spin wam', 'shewa'], district: 'North Waziristan', province: 'Khyber Pakhtunkhwa', lat: 32.98, lng: 70.13 },
  { terms: ['lower south waziristan', 'angoor adda'], district: 'Lower South Waziristan', province: 'Khyber Pakhtunkhwa', lat: 32.1, lng: 69.36 },
  { terms: ['kurram'], district: 'Kurram', province: 'Khyber Pakhtunkhwa', lat: 33.73, lng: 70.1 },
  { terms: ['hangu'], district: 'Hangu', province: 'Khyber Pakhtunkhwa', lat: 33.53, lng: 71.06 },
  { terms: ['karak'], district: 'Karak', province: 'Khyber Pakhtunkhwa', lat: 33.12, lng: 71.09 },
  { terms: ['khyber', 'tirah'], district: 'Khyber', province: 'Khyber Pakhtunkhwa', lat: 34.03, lng: 71.13 },
  { terms: ['charsadda'], district: 'Charsadda', province: 'Khyber Pakhtunkhwa', lat: 34.15, lng: 71.74 },
  { terms: ['peshawar'], district: 'Peshawar', province: 'Khyber Pakhtunkhwa', lat: 34.01, lng: 71.56 },
  { terms: ['quetta', 'mangla zarghoon', 'shabaan'], district: 'Quetta', province: 'Balochistan', lat: 30.3, lng: 67.2 },
  { terms: ['khuzdar'], district: 'Khuzdar', province: 'Balochistan', lat: 27.8, lng: 66.62 },
  { terms: ['kech', 'turbat'], district: 'Kech', province: 'Balochistan', lat: 26, lng: 63.05 },
  { terms: ['washuk'], district: 'Washuk', province: 'Balochistan', lat: 27.72, lng: 64.8 },
  { terms: ['ziarat'], district: 'Ziarat', province: 'Balochistan', lat: 30.38, lng: 67.73 },
  { terms: ['barkhan'], district: 'Barkhan', province: 'Balochistan', lat: 29.9, lng: 69.53 },
  { terms: ['nushki'], district: 'Nushki', province: 'Balochistan', lat: 29.55, lng: 66.02 },
  { terms: ['karachi'], district: 'Karachi', province: 'Sindh', lat: 24.86, lng: 67.01 },
  { terms: ['lahore'], district: 'Lahore', province: 'Punjab', lat: 31.52, lng: 74.36 },
  { terms: ['dera ghazi khan', 'd g khan', 'dg khan'], district: 'Dera Ghazi Khan', province: 'Punjab', lat: 30.05, lng: 70.64 },
  { terms: ['taunsa'], district: 'Taunsa', province: 'Punjab', lat: 30.7, lng: 70.65 },
  { terms: ['attock'], district: 'Attock', province: 'Punjab', lat: 33.77, lng: 72.36 },
  { terms: ['islamabad'], district: 'Islamabad', province: 'Islamabad', lat: 33.68, lng: 73.05 },
  { terms: ['gilgit'], district: 'Gilgit', province: 'Gilgit-Baltistan', lat: 35.92, lng: 74.31 }
];

const INCIDENT_PATTERN = /attack|blast|explosion|ied|quadcopter|drone|killed|injured|operation|ibo|ambush|firing|militant|terrorist/i;

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function clean(value) {
  return String(value || '').replace(/\r/g, '').trim();
}

function slug(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function lower(value) {
  return clean(value).toLowerCase();
}

function parseFields(text) {
  const fields = {};
  for (const line of clean(text).split('\n')) {
    const match = line.match(/^\s*([^:]+)\s*:\s*(.+?)\s*$/);
    if (!match) continue;
    fields[match[1].toLowerCase().replace(/[^a-z0-9]+/g, '_')] = match[2].trim();
  }
  return fields;
}

function findDistrict(text, fields = {}) {
  const haystack = lower(`${fields.district || ''} ${fields.province || ''} ${text}`);
  const matched = DISTRICTS.find((item) => item.terms.some((term) => haystack.includes(term)));
  if (matched) return matched;
  return { district: fields.district || 'Unspecified', province: normalProvince(fields.province || 'Pakistan'), lat: 30.3753, lng: 69.3451 };
}

function normalProvince(value) {
  const compact = lower(value).replace(/[^a-z0-9]+/g, '');
  if (compact === 'kpk' || compact.includes('khyber')) return 'Khyber Pakhtunkhwa';
  if (compact.includes('baloch') || compact.includes('baluch')) return 'Balochistan';
  if (compact.includes('punjab')) return 'Punjab';
  if (compact.includes('sindh') || compact.includes('sind')) return 'Sindh';
  if (compact.includes('gilgit')) return 'Gilgit-Baltistan';
  if (compact.includes('islamabad')) return 'Islamabad';
  return clean(value) || 'Pakistan';
}

function numberField(value) {
  const match = clean(value).match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function integerCell(value) {
  const match = clean(value).match(/-?\d+/);
  return match ? Number(match[0]) : 0;
}

function datePartsInPakistan(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PAKISTAN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function pakistanDateFromSeconds(seconds = Math.floor(Date.now() / 1000)) {
  const date = new Date(Number(seconds) * 1000);
  const parts = datePartsInPakistan(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isoFromSeconds(seconds) {
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? new Date(value * 1000).toISOString() : new Date().toISOString();
}

function isoFromDate(value) {
  return `${clean(value)}T12:00:00.000Z`;
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

function archiveStartDate(today) {
  return dateFromUtcMs(dateToUtcMs(today) - (ARCHIVE_DAYS - 1) * DAY_MS);
}

function withinArchiveWindow(incident, today) {
  const value = dateToUtcMs(incident?.date);
  const start = dateToUtcMs(archiveStartDate(today));
  const end = dateToUtcMs(today);
  return Number.isFinite(value) && value >= start && value <= end;
}

function incidentLike(text, fields) {
  if (fields.district || fields.summary || fields.type || fields.category) return true;
  return INCIDENT_PATTERN.test(text);
}

function getMessage(update) {
  return update.channel_post || update.edited_channel_post || update.message || update.edited_message || null;
}

function updateType(update) {
  if (update.channel_post) return 'channel_post';
  if (update.edited_channel_post) return 'edited_channel_post';
  if (update.message) return 'message';
  if (update.edited_message) return 'edited_message';
  return 'unknown';
}

function sourceUrl(message) {
  const username = message.chat?.username;
  if (!username || !message.message_id) return '';
  return `https://t.me/${username}/${message.message_id}`;
}

function normalCategory(value) {
  const category = clean(value) || 'Security incident';
  if (/ied|bomb/i.test(category)) return 'IED / Explosion';
  if (/security operation|counter/i.test(category)) return 'Counterterrorism Operation';
  if (/drone|quadcopter/i.test(category)) return 'Drone / Quadcopter';
  return category;
}

function severityFor(fatalities, injuries, abductions, assetsDamaged) {
  if (fatalities > 0 || injuries >= 3 || abductions > 0) return 'High';
  if (injuries > 0 || (assetsDamaged && !/^none$/i.test(assetsDamaged))) return 'Medium';
  return 'Low';
}

function buildIncident(update) {
  const message = getMessage(update);
  const text = message?.text || message?.caption || '';
  const fields = parseFields(text);
  if (!incidentLike(text, fields)) return null;

  const messageSeconds = Number(message.date) || Math.floor(Date.now() / 1000);
  const location = findDistrict(text, fields);
  const date = pakistanDateFromSeconds(messageSeconds);
  const category = fields.type || fields.category || 'Security incident';
  const summary = fields.summary || clean(text).split('\n').filter((line) => !/^\s*[^:]+\s*:/.test(line)).join(' ') || clean(text);
  const fatalities = numberField(fields.killed || fields.fatalities);
  const injuries = numberField(fields.injured || fields.injuries);
  const severity = fields.severity || (fatalities > 0 || injuries >= 3 ? 'High' : 'Medium');

  return {
    id: `${date}-telegram-${message.chat.id}-${message.message_id}-${slug(location.district || 'incident')}`,
    date,
    reported_at: isoFromSeconds(messageSeconds),
    time_label: 'From Telegram feed',
    title: fields.title || `${category} reported in ${location.district}`,
    district: location.district,
    province: fields.province ? normalProvince(fields.province) : location.province,
    country: 'Pakistan',
    lat: location.lat,
    lng: location.lng,
    category,
    actor: fields.actor || 'Unidentified',
    status: fields.status || 'Initial report',
    severity,
    fatalities,
    injuries,
    summary,
    source: 'TGD Telegram',
    source_url: fields.source || sourceUrl(message),
    verified: false
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const source = String(text || '').replace(/^\uFEFF/, '');

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') inQuotes = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = (rows.shift() || []).map((header) => clean(header));
  return rows
    .filter((values) => values.some((value) => clean(value)))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, clean(values[index])])));
}

function importPaths() {
  if (!fs.existsSync(IMPORT_DIR)) return [];
  return fs.readdirSync(IMPORT_DIR)
    .filter((name) => name.toLowerCase().endsWith('.csv'))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => path.join(IMPORT_DIR, name));
}

function importedIncident(row, filePath) {
  const date = clean(row.Date);
  const uid = clean(row['Incident UID']);
  if (!date || !uid) return null;

  const district = clean(row.District) || 'Unspecified';
  const locationText = `${district} ${row.Location || ''} ${row['Incident Description'] || ''}`;
  const location = findDistrict(locationText, { district, province: row.Province });
  const category = normalCategory(row['Attack Method']);
  const civilianFatalities = integerCell(row.Civilian_Casualties);
  const militantFatalities = integerCell(row.Militants_Casualties);
  const forceFatalities = integerCell(row.Forces_Casualties);
  const civilianInjuries = integerCell(row.Civilian_Injuries);
  const militantInjuries = integerCell(row.Militants_Injuries);
  const forceInjuries = integerCell(row.Forces_Injuries);
  const fatalities = civilianFatalities + militantFatalities + forceFatalities;
  const injuries = civilianInjuries + militantInjuries + forceInjuries;
  const abductions = integerCell(row.Abductions);
  const assetsDamaged = clean(row['Assets Damaged']);
  const claim = clean(row.Claim);
  const actor = !claim || /^unclaimed$/i.test(claim) ? 'Unidentified' : claim;

  return {
    id: `import-${slug(uid)}`,
    date,
    reported_at: isoFromDate(date),
    time_label: row['Week Number'] || 'Imported weekly dataset',
    title: `${category} reported in ${location.district}`,
    district: location.district,
    province: normalProvince(row.Province || location.province),
    country: 'Pakistan',
    lat: location.lat,
    lng: location.lng,
    category,
    actor,
    status: /^unclaimed$/i.test(claim) ? 'Imported record' : 'Claimed / recorded',
    severity: severityFor(fatalities, injuries, abductions, assetsDamaged),
    fatalities,
    injuries,
    summary: clean(row['Incident Description']) || clean(row['Casualty Description']) || `${category} reported in ${location.district}.`,
    source: 'TGD weekly dataset',
    source_url: '',
    verified: false,
    imported: true,
    import_source: path.basename(filePath),
    incident_uid: uid,
    week_label: clean(row['Week Number']),
    target_type: clean(row['Target Type']),
    assets_damaged: assetsDamaged,
    abductions,
    casualty_note: clean(row['Casualty Description'])
  };
}

function importedIncidents(todayPakistan) {
  const imported = [];
  for (const filePath of importPaths()) {
    const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
    for (const row of rows) {
      const incident = importedIncident(row, filePath);
      if (incident && withinArchiveWindow(incident, todayPakistan)) imported.push(incident);
    }
  }
  return sortIncidents(imported);
}

function isTestIncident(incident) {
  const text = lower(`${incident?.source || ''} ${incident?.source_url || ''} ${incident?.summary || ''} ${incident?.title || ''}`);
  return text.includes('test incident') || text.includes('webhook test') || text === 'test';
}

async function telegramRaw(method, body = {}) {
  const response = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return response.json();
}

async function telegram(method, body = {}) {
  const data = await telegramRaw(method, body);
  if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description || 'unknown error'}`);
  return data.result;
}

function isWebhookConflict(description = '') {
  return /webhook is active/i.test(String(description));
}

async function getUpdatesWithWebhookRecovery(body) {
  const firstAttempt = await telegramRaw('getUpdates', body);
  if (firstAttempt.ok) return firstAttempt.result;

  if (!isWebhookConflict(firstAttempt.description)) {
    throw new Error(`Telegram getUpdates failed: ${firstAttempt.description || 'unknown error'}`);
  }

  console.log('Telegram webhook is active; deleting webhook before polling for updates.');
  const deleteResult = await telegramRaw('deleteWebhook', { drop_pending_updates: false });
  if (!deleteResult.ok) {
    throw new Error(`Telegram deleteWebhook failed: ${deleteResult.description || 'unknown error'}`);
  }

  const retry = await telegramRaw('getUpdates', body);
  if (!retry.ok) throw new Error(`Telegram getUpdates failed after deleteWebhook: ${retry.description || 'unknown error'}`);
  return retry.result;
}

async function clearWebhookBeforePolling() {
  const webhook = await telegramSafe('getWebhookInfo');
  const info = webhook.ok ? webhook.result : null;
  if (!info?.url) return webhook;

  console.log('Telegram webhook is configured; deleting webhook before polling for updates.');
  const deleted = await telegramSafe('deleteWebhook', { drop_pending_updates: false });
  if (!deleted.ok) throw new Error(`Telegram deleteWebhook failed: ${deleted.error}`);
  return telegramSafe('getWebhookInfo');
}

async function telegramSafe(method, body = {}) {
  const data = await telegramRaw(method, body);
  if (!data.ok) return { ok: false, error: data.description || 'unknown error' };
  return { ok: true, result: data.result };
}

function debugResult(update, reason, fields = {}) {
  const message = getMessage(update);
  const messageSeconds = Number(message?.date || 0);
  return {
    update_id: update.update_id || 0,
    type: updateType(update),
    reason,
    chat_id: message?.chat?.id ? String(message.chat.id) : '',
    chat_type: message?.chat?.type || '',
    message_id: message?.message_id || 0,
    message_date_utc: messageSeconds ? isoFromSeconds(messageSeconds) : '',
    message_date_pakistan: messageSeconds ? pakistanDateFromSeconds(messageSeconds) : '',
    has_text: Boolean(message?.text || message?.caption),
    field_keys: Object.keys(fields)
  };
}

function sortIncidents(incidents) {
  return incidents.sort((a, b) => (
    String(b.date || '').localeCompare(String(a.date || '')) ||
    String(b.reported_at || '').localeCompare(String(a.reported_at || '')) ||
    String(b.id || '').localeCompare(String(a.id || ''))
  ));
}

async function main() {
  const feed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const todayPakistan = pakistanDateFromSeconds();
  const originalIncidents = Array.isArray(feed.incidents) ? feed.incidents : [];
  const manualImported = importedIncidents(todayPakistan);
  const manualIds = new Set(manualImported.map((incident) => incident.id));
  const cleanedExisting = originalIncidents.filter((incident) => !manualIds.has(incident.id) && !isTestIncident(incident));
  const archivedExisting = cleanedExisting.filter((incident) => withinArchiveWindow(incident, todayPakistan));
  const state = fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : { last_update_id: 0 };
  const offset = Number(state.last_update_id || 0) + 1;

  let updates = [];
  let botCheck = { ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' };
  let chatCheck = { ok: false, error: 'TELEGRAM_CHAT_ID not configured' };
  let memberCheck = { ok: false, error: 'bot unavailable' };
  let webhookCheck = { ok: false, error: 'bot unavailable' };

  if (TOKEN && CHAT_ID) {
    botCheck = await telegramSafe('getMe');
    chatCheck = await telegramSafe('getChat', { chat_id: CHAT_ID });
    memberCheck = botCheck.ok ? await telegramSafe('getChatMember', { chat_id: CHAT_ID, user_id: botCheck.result.id }) : { ok: false, error: 'bot unavailable' };
    webhookCheck = botCheck.ok ? await clearWebhookBeforePolling() : { ok: false, error: 'bot unavailable' };
    updates = await getUpdatesWithWebhookRecovery({
      offset,
      timeout: 0,
      allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post']
    });
  }

  let lastUpdateId = Number(state.last_update_id || 0);
  const existingIds = new Set(manualImported.concat(archivedExisting).map((incident) => incident.id));
  const added = [];
  const debug = {
    checked_at: new Date().toISOString(),
    current_day_pakistan: todayPakistan,
    archive_days: ARCHIVE_DAYS,
    archive_start: archiveStartDate(todayPakistan),
    import_sources: importPaths().map((filePath) => path.basename(filePath)),
    imported_count: manualImported.length,
    removed_test_count: originalIncidents.length - cleanedExisting.length - originalIncidents.filter((incident) => manualIds.has(incident.id)).length,
    time_zone: PAKISTAN_TIME_ZONE,
    offset,
    expected_chat_id: CHAT_ID,
    bot: botCheck.ok ? {
      id: botCheck.result.id,
      username: botCheck.result.username,
      can_join_groups: botCheck.result.can_join_groups,
      can_read_all_group_messages: botCheck.result.can_read_all_group_messages
    } : { error: botCheck.error },
    chat: chatCheck.ok ? { id: String(chatCheck.result.id), type: chatCheck.result.type, title: chatCheck.result.title || '', username: chatCheck.result.username || '' } : { error: chatCheck.error },
    bot_member: memberCheck.ok ? { status: memberCheck.result.status, can_post_messages: Boolean(memberCheck.result.can_post_messages) } : { error: memberCheck.error },
    webhook: webhookCheck.ok ? {
      active: Boolean(webhookCheck.result.url),
      pending_update_count: webhookCheck.result.pending_update_count,
      last_error_date: webhookCheck.result.last_error_date || 0,
      last_error_message: webhookCheck.result.last_error_message || ''
    } : { error: webhookCheck.error },
    updates_count: updates.length,
    results: []
  };

  for (const update of updates) {
    lastUpdateId = Math.max(lastUpdateId, Number(update.update_id || 0));
    const message = getMessage(update);
    const text = message?.text || message?.caption || '';
    const fields = parseFields(text);

    if (!message) {
      debug.results.push(debugResult(update, 'no_supported_message', fields));
      continue;
    }
    if (String(message.chat?.id) !== CHAT_ID) {
      debug.results.push(debugResult(update, 'chat_mismatch', fields));
      continue;
    }
    if (!incidentLike(text, fields)) {
      debug.results.push(debugResult(update, 'not_incident_text', fields));
      continue;
    }

    const incident = buildIncident(update);
    if (!incident) {
      debug.results.push(debugResult(update, 'parse_failed', fields));
      continue;
    }
    if (!withinArchiveWindow(incident, todayPakistan)) {
      debug.results.push(debugResult(update, 'outside_archive_window', fields));
      continue;
    }
    if (isTestIncident(incident)) {
      debug.results.push(debugResult(update, 'test_incident_ignored', fields));
      continue;
    }
    if (existingIds.has(incident.id)) {
      debug.results.push(debugResult(update, 'duplicate', fields));
      continue;
    }

    existingIds.add(incident.id);
    added.push(incident);
    debug.results.push(debugResult(update, 'added', fields));
  }

  if (lastUpdateId > Number(state.last_update_id || 0)) {
    fs.writeFileSync(STATE_PATH, `${JSON.stringify({ last_update_id: lastUpdateId }, null, 2)}\n`);
  }

  if (DEBUG || updates.length || manualImported.length) {
    fs.writeFileSync(DEBUG_PATH, `${JSON.stringify(debug, null, 2)}\n`);
  }

  const mergedIncidents = sortIncidents(manualImported.concat(added, archivedExisting));
  const archiveChanged = JSON.stringify(sortIncidents(originalIncidents.slice())) !== JSON.stringify(mergedIncidents);
  const metadataChanged = feed.current_day !== todayPakistan || feed.archive_days !== ARCHIVE_DAYS || feed.archive_start !== archiveStartDate(todayPakistan);
  if (added.length || archiveChanged || metadataChanged) {
    feed.time_zone = PAKISTAN_TIME_ZONE;
    feed.current_day = todayPakistan;
    feed.archive_days = ARCHIVE_DAYS;
    feed.archive_start = archiveStartDate(todayPakistan);
    feed.import_sources = importPaths().map((filePath) => path.basename(filePath));
    feed.incidents = mergedIncidents;
    feed.last_updated = new Date().toISOString();
    fs.writeFileSync(DATA_PATH, `${JSON.stringify(feed, null, 2)}\n`);
  }

  console.log(`Read ${updates.length} Telegram update(s); added ${added.length} incident(s).`);
  console.log(`Imported ${manualImported.length} weekly incident(s).`);
  console.log(`Archive window: ${archiveStartDate(todayPakistan)} to ${todayPakistan}; retained ${mergedIncidents.length} incident(s).`);
  if (chatCheck.ok) console.log(`Telegram chat check ok: ${chatCheck.result.type} ${chatCheck.result.title || chatCheck.result.username || ''}`);
  else console.log(`Telegram chat check failed: ${chatCheck.error}`);
  if (memberCheck.ok) console.log(`Bot member status: ${memberCheck.result.status}`);
  else console.log(`Bot member check failed: ${memberCheck.error}`);
  if (botCheck.ok && botCheck.result.can_read_all_group_messages === false && chatCheck.ok && /group$/i.test(chatCheck.result.type || '')) {
    console.log('Bot privacy appears enabled; disable privacy in BotFather if normal group messages should become tracker updates.');
  }
  if (webhookCheck.ok) console.log(`Telegram webhook active after recovery: ${Boolean(webhookCheck.result.url)}; pending updates: ${webhookCheck.result.pending_update_count}`);
  else console.log(`Telegram webhook check failed: ${webhookCheck.error}`);
  setOutput('added_count', added.length);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
