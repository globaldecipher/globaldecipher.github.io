import fs from 'fs';

const DATA_PATH = 'static/data/incidents.json';
const STATE_PATH = 'static/data/telegram-state.json';
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || '').trim();

const DISTRICTS = [
  { terms: ['bajaur', 'loi sam'], district: 'Bajaur', province: 'Khyber Pakhtunkhwa', lat: 34.72, lng: 71.5 },
  { terms: ['lakki', 'ghazni khel', 'darra tang'], district: 'Lakki Marwat', province: 'Khyber Pakhtunkhwa', lat: 32.61, lng: 70.91 },
  { terms: ['tank', 'wanda zalu', 'wanda zalo', 'wanda zulu'], district: 'Tank', province: 'Khyber Pakhtunkhwa', lat: 32.22, lng: 70.38 },
  { terms: ['wana', 'south waziristan'], district: 'South Waziristan', province: 'Khyber Pakhtunkhwa', lat: 32.3, lng: 69.57 },
  { terms: ['dera ismail khan', 'di khan'], district: 'Dera Ismail Khan', province: 'Khyber Pakhtunkhwa', lat: 31.83, lng: 70.9 },
  { terms: ['bannu'], district: 'Bannu', province: 'Khyber Pakhtunkhwa', lat: 32.99, lng: 70.6 },
  { terms: ['peshawar'], district: 'Peshawar', province: 'Khyber Pakhtunkhwa', lat: 34.01, lng: 71.56 },
  { terms: ['quetta', 'mangla zarghoon'], district: 'Quetta', province: 'Balochistan', lat: 30.3, lng: 67.2 },
  { terms: ['khuzdar'], district: 'Khuzdar', province: 'Balochistan', lat: 27.8, lng: 66.62 },
  { terms: ['kech', 'turbat'], district: 'Kech', province: 'Balochistan', lat: 26, lng: 63.05 },
  { terms: ['karachi'], district: 'Karachi', province: 'Sindh', lat: 24.86, lng: 67.01 },
  { terms: ['lahore'], district: 'Lahore', province: 'Punjab', lat: 31.52, lng: 74.36 },
  { terms: ['islamabad'], district: 'Islamabad', province: 'Islamabad', lat: 33.68, lng: 73.05 },
  { terms: ['gilgit'], district: 'Gilgit', province: 'Gilgit-Baltistan', lat: 35.92, lng: 74.31 }
];

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function clean(value) {
  return String(value || '').replace(/\r/g, '').trim();
}

function slug(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
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

function findDistrict(text, fields) {
  const haystack = lower(`${fields.district || ''} ${fields.province || ''} ${text}`);
  const matched = DISTRICTS.find((item) => item.terms.some((term) => haystack.includes(term)));
  if (matched) return matched;
  return {
    district: fields.district || 'Unspecified',
    province: fields.province || 'Pakistan',
    lat: 30.3753,
    lng: 69.3451
  };
}

function numberField(value) {
  const match = clean(value).match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function incidentLike(text, fields) {
  if (fields.district || fields.summary || fields.type) return true;
  return /attack|blast|explosion|ied|quadcopter|drone|killed|injured|operation|ibo|ambush|firing|militant|terrorist/i.test(text);
}

function sourceUrl(message) {
  const username = message.chat?.username;
  if (!username || !message.message_id) return '';
  return `https://t.me/${username}/${message.message_id}`;
}

function buildIncident(update) {
  const message = update.channel_post || update.edited_channel_post;
  const text = message?.text || message?.caption || '';
  const fields = parseFields(text);
  if (!incidentLike(text, fields)) return null;

  const location = findDistrict(text, fields);
  const date = new Date((message.date || Math.floor(Date.now() / 1000)) * 1000).toISOString().slice(0, 10);
  const category = fields.type || fields.category || 'Security incident';
  const summary = fields.summary || clean(text).split('\n').filter((line) => !/^\s*[^:]+\s*:/.test(line)).join(' ') || clean(text);
  const fatalities = numberField(fields.killed || fields.fatalities);
  const injuries = numberField(fields.injured || fields.injuries);
  const severity = fields.severity || (fatalities > 0 || injuries >= 3 ? 'High' : 'Medium');

  return {
    id: `${date}-telegram-${message.chat.id}-${message.message_id}-${slug(location.district || 'incident')}`,
    date,
    time_label: 'From Telegram feed',
    title: fields.title || `${category} reported in ${location.district}`,
    district: location.district,
    province: fields.province || location.province,
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

async function telegram(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description || response.status}`);
  return data.result;
}

async function main() {
  if (!TOKEN || !CHAT_ID) {
    console.log('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured; skipping.');
    setOutput('added_count', 0);
    return;
  }

  const feed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const state = fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : { last_update_id: 0 };
  const offset = Number(state.last_update_id || 0) + 1;
  const updates = await telegram('getUpdates', { offset, timeout: 0, allowed_updates: ['channel_post', 'edited_channel_post'] });

  let lastUpdateId = Number(state.last_update_id || 0);
  const existingIds = new Set((feed.incidents || []).map((incident) => incident.id));
  const added = [];

  for (const update of updates) {
    lastUpdateId = Math.max(lastUpdateId, Number(update.update_id || 0));
    const message = update.channel_post || update.edited_channel_post;
    if (!message || String(message.chat?.id) !== CHAT_ID) continue;
    const incident = buildIncident(update);
    if (!incident || existingIds.has(incident.id)) continue;
    existingIds.add(incident.id);
    added.push(incident);
  }

  if (lastUpdateId > Number(state.last_update_id || 0)) {
    fs.writeFileSync(STATE_PATH, `${JSON.stringify({ last_update_id: lastUpdateId }, null, 2)}\n`);
  }

  if (added.length) {
    feed.incidents = added.concat(feed.incidents || []).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    feed.last_updated = new Date().toISOString();
    fs.writeFileSync(DATA_PATH, `${JSON.stringify(feed, null, 2)}\n`);
  }

  console.log(`Added ${added.length} Telegram incident(s).`);
  setOutput('added_count', added.length);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
