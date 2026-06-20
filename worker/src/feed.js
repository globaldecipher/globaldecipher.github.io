// Shared incident-feed helpers for the Cloudflare Worker.
// Ported from the original GitHub Actions scripts; filesystem/git state is
// replaced by Cloudflare KV. The incident object shape is kept byte-compatible
// with what the front-end map (static/incident-map.js) expects.

export const PAKISTAN_TIME_ZONE = "Asia/Karachi";
export const ARCHIVE_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;

// KV keys.
export const FEED_KEY = "feed";
export const TELEGRAM_STATE_KEY = "telegram_state";

export const DISTRICTS = [
  { terms: ["bajaur", "loi sam"], district: "Bajaur", province: "Khyber Pakhtunkhwa", lat: 34.72, lng: 71.5 },
  { terms: ["lakki", "ghazni khel", "darra tang"], district: "Lakki Marwat", province: "Khyber Pakhtunkhwa", lat: 32.61, lng: 70.91 },
  { terms: ["tank", "wanda zalu", "wanda zalo", "wanda zulu"], district: "Tank", province: "Khyber Pakhtunkhwa", lat: 32.22, lng: 70.38 },
  { terms: ["wana", "south waziristan"], district: "South Waziristan", province: "Khyber Pakhtunkhwa", lat: 32.3, lng: 69.57 },
  { terms: ["dera ismail khan", "di khan"], district: "Dera Ismail Khan", province: "Khyber Pakhtunkhwa", lat: 31.83, lng: 70.9 },
  { terms: ["bannu"], district: "Bannu", province: "Khyber Pakhtunkhwa", lat: 32.99, lng: 70.6 },
  { terms: ["north waziristan", "mir ali", "miranshah", "spin wam", "shewa"], district: "North Waziristan", province: "Khyber Pakhtunkhwa", lat: 32.98, lng: 70.13 },
  { terms: ["lower south waziristan", "angoor adda"], district: "Lower South Waziristan", province: "Khyber Pakhtunkhwa", lat: 32.1, lng: 69.36 },
  { terms: ["kurram"], district: "Kurram", province: "Khyber Pakhtunkhwa", lat: 33.73, lng: 70.1 },
  { terms: ["hangu"], district: "Hangu", province: "Khyber Pakhtunkhwa", lat: 33.53, lng: 71.06 },
  { terms: ["karak"], district: "Karak", province: "Khyber Pakhtunkhwa", lat: 33.12, lng: 71.09 },
  { terms: ["khyber", "tirah"], district: "Khyber", province: "Khyber Pakhtunkhwa", lat: 34.03, lng: 71.13 },
  { terms: ["charsadda"], district: "Charsadda", province: "Khyber Pakhtunkhwa", lat: 34.15, lng: 71.74 },
  { terms: ["peshawar"], district: "Peshawar", province: "Khyber Pakhtunkhwa", lat: 34.01, lng: 71.56 },
  { terms: ["quetta", "mangla zarghoon", "shabaan"], district: "Quetta", province: "Balochistan", lat: 30.3, lng: 67.2 },
  { terms: ["khuzdar"], district: "Khuzdar", province: "Balochistan", lat: 27.8, lng: 66.62 },
  { terms: ["kech", "turbat"], district: "Kech", province: "Balochistan", lat: 26, lng: 63.05 },
  { terms: ["washuk"], district: "Washuk", province: "Balochistan", lat: 27.72, lng: 64.8 },
  { terms: ["ziarat"], district: "Ziarat", province: "Balochistan", lat: 30.38, lng: 67.73 },
  { terms: ["barkhan"], district: "Barkhan", province: "Balochistan", lat: 29.9, lng: 69.53 },
  { terms: ["nushki"], district: "Nushki", province: "Balochistan", lat: 29.55, lng: 66.02 },
  { terms: ["karachi"], district: "Karachi", province: "Sindh", lat: 24.86, lng: 67.01 },
  { terms: ["lahore"], district: "Lahore", province: "Punjab", lat: 31.52, lng: 74.36 },
  { terms: ["dera ghazi khan", "d g khan", "dg khan"], district: "Dera Ghazi Khan", province: "Punjab", lat: 30.05, lng: 70.64 },
  { terms: ["taunsa"], district: "Taunsa", province: "Punjab", lat: 30.7, lng: 70.65 },
  { terms: ["attock"], district: "Attock", province: "Punjab", lat: 33.77, lng: 72.36 },
  { terms: ["islamabad"], district: "Islamabad", province: "Islamabad", lat: 33.68, lng: 73.05 },
  { terms: ["gilgit"], district: "Gilgit", province: "Gilgit-Baltistan", lat: 35.92, lng: 74.31 }
];

export function clean(value) {
  return String(value || "").replace(/\r/g, "").trim();
}

export function lower(value) {
  return clean(value).toLowerCase();
}

export function slug(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

export function numberField(value) {
  const match = clean(value).match(/\d+/);
  return match ? Number(match[0]) : 0;
}

export function normalProvince(value) {
  const compact = lower(value).replace(/[^a-z0-9]+/g, "");
  if (compact === "kpk" || compact.includes("khyber")) return "Khyber Pakhtunkhwa";
  if (compact.includes("baloch") || compact.includes("baluch")) return "Balochistan";
  if (compact.includes("punjab")) return "Punjab";
  if (compact.includes("sindh") || compact.includes("sind")) return "Sindh";
  if (compact.includes("gilgit")) return "Gilgit-Baltistan";
  if (compact.includes("islamabad")) return "Islamabad";
  return clean(value) || "Pakistan";
}

export function findDistrict(text, fields = {}) {
  const haystack = lower(`${fields.district || ""} ${fields.province || ""} ${text}`);
  const matched = DISTRICTS.find((item) => item.terms.some((term) => haystack.includes(term)));
  if (matched) return matched;
  return { district: fields.district || "Unspecified", province: normalProvince(fields.province || "Pakistan"), lat: 30.3753, lng: 69.3451 };
}

export function severityFor(fatalities, injuries) {
  if (fatalities > 0 || injuries >= 3) return "High";
  if (injuries > 0) return "Medium";
  return "Low";
}

// ---- Date helpers (Pakistan Standard Time) ----

function datePartsInPakistan(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PAKISTAN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

export function pakistanDateFromSeconds(seconds = Math.floor(Date.now() / 1000)) {
  const date = new Date(Number(seconds) * 1000);
  const parts = datePartsInPakistan(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isoFromSeconds(seconds) {
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? new Date(value * 1000).toISOString() : new Date().toISOString();
}

function dateToUtcMs(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function dateFromUtcMs(ms) {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function archiveStartDate(today) {
  return dateFromUtcMs(dateToUtcMs(today) - (ARCHIVE_DAYS - 1) * DAY_MS);
}

export function withinArchiveWindow(incident, today) {
  const value = dateToUtcMs(incident?.date);
  const start = dateToUtcMs(archiveStartDate(today));
  const end = dateToUtcMs(today);
  // Keep records with an unparseable date so nothing is silently dropped.
  if (!Number.isFinite(value)) return true;
  return value >= start && value <= end;
}

export function isTestIncident(incident) {
  const text = lower(`${incident?.source || ""} ${incident?.source_url || ""} ${incident?.summary || ""} ${incident?.title || ""}`);
  return text.includes("test incident") || text.includes("webhook test") || text === "test";
}

export function sortIncidents(incidents) {
  return incidents.slice().sort((a, b) => (
    String(b.date || "").localeCompare(String(a.date || "")) ||
    String(b.reported_at || "").localeCompare(String(a.reported_at || "")) ||
    String(b.id || "").localeCompare(String(a.id || ""))
  ));
}

export function defaultFeed() {
  return {
    last_updated: new Date().toISOString(),
    time_zone: PAKISTAN_TIME_ZONE,
    current_day: pakistanDateFromSeconds(),
    source_note: "Incident feed uses Pakistan Standard Time. Map points are district-level approximations for reader orientation and should not be treated as precise coordinates.",
    archive_days: ARCHIVE_DAYS,
    incidents: []
  };
}

// ---- KV access ----

export async function loadFeed(env) {
  const raw = await env.INCIDENTS.get(FEED_KEY);
  if (!raw) return defaultFeed();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.incidents)) parsed.incidents = [];
    return parsed;
  } catch {
    return defaultFeed();
  }
}

export async function saveFeed(env, feed) {
  await env.INCIDENTS.put(FEED_KEY, JSON.stringify(feed));
}

export async function loadTelegramState(env) {
  const raw = await env.INCIDENTS.get(TELEGRAM_STATE_KEY);
  if (!raw) return { last_update_id: 0 };
  try {
    return JSON.parse(raw);
  } catch {
    return { last_update_id: 0 };
  }
}

export async function saveTelegramState(env, state) {
  await env.INCIDENTS.put(TELEGRAM_STATE_KEY, JSON.stringify(state));
}

// Merge new incidents into the existing list: drop test rows, dedupe by id,
// prune outside the archive window, and sort newest-first.
export function mergeIncidents(existing, added, today) {
  const byId = new Map();
  for (const incident of existing) {
    if (!incident || isTestIncident(incident)) continue;
    byId.set(incident.id, incident);
  }
  for (const incident of added) {
    if (!incident || isTestIncident(incident)) continue;
    byId.set(incident.id, incident); // new wins on id collision
  }
  const kept = [...byId.values()].filter((incident) => withinArchiveWindow(incident, today));
  return sortIncidents(kept);
}
