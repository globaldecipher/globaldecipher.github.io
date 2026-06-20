// X (Twitter) account polling -> incident objects.
// Ported from .github/scripts/update-incidents-from-x.mjs.

import { slug } from "./feed.js";

const X_API = "https://api.twitter.com/2";

const NUMBER_WORDS = new Map([
  ["zero", 0], ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
  ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10], ["eleven", 11],
  ["twelve", 12], ["thirteen", 13], ["fourteen", 14], ["fifteen", 15],
  ["twenty", 20], ["thirty", 30], ["thirty-five", 35]
]);

const DISTRICTS = [
  { match: /\bbajaur|loi sam\b/i, district: "Bajaur", province: "Khyber Pakhtunkhwa", lat: 34.72, lng: 71.5 },
  { match: /\blakki|ghazni khel|darra tang\b/i, district: "Lakki Marwat", province: "Khyber Pakhtunkhwa", lat: 32.61, lng: 70.91 },
  { match: /\btank|wanda zalu|wanda zalo|wanda zulu\b/i, district: "Tank", province: "Khyber Pakhtunkhwa", lat: 32.22, lng: 70.38 },
  { match: /\bwana|south waziristan\b/i, district: "South Waziristan", province: "Khyber Pakhtunkhwa", lat: 32.3, lng: 69.57 },
  { match: /\bdera ismail khan|\bdi khan\b/i, district: "Dera Ismail Khan", province: "Khyber Pakhtunkhwa", lat: 31.83, lng: 70.9 },
  { match: /\bbannu\b/i, district: "Bannu", province: "Khyber Pakhtunkhwa", lat: 32.99, lng: 70.6 },
  { match: /\bpeshawar\b/i, district: "Peshawar", province: "Khyber Pakhtunkhwa", lat: 34.01, lng: 71.56 },
  { match: /\bquetta|mangla zarghoon\b/i, district: "Quetta", province: "Balochistan", lat: 30.3, lng: 67.2 },
  { match: /\bkhuzdar\b/i, district: "Khuzdar", province: "Balochistan", lat: 27.8, lng: 66.62 },
  { match: /\bkech|turbat\b/i, district: "Kech", province: "Balochistan", lat: 26, lng: 63.05 },
  { match: /\bkarachi\b/i, district: "Karachi", province: "Sindh", lat: 24.86, lng: 67.01 },
  { match: /\blahore\b/i, district: "Lahore", province: "Punjab", lat: 31.52, lng: 74.36 },
  { match: /\bislamabad\b/i, district: "Islamabad", province: "Islamabad", lat: 33.68, lng: 73.05 },
  { match: /\bgilgit\b/i, district: "Gilgit", province: "Gilgit-Baltistan", lat: 35.92, lng: 74.31 }
];

function compactText(text) {
  return String(text || "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  const text = String(value || "").toLowerCase();
  if (/^\d+$/.test(text)) return Number(text);
  return NUMBER_WORDS.get(text) ?? 0;
}

function extractCasualty(text, terms) {
  const number = "(\\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|thirty-five)";
  const before = new RegExp(`${number}\\s+(?:[\\w-]+\\s+){0,5}(?:${terms})`, "i");
  const after = new RegExp(`(?:${terms})\\s+(?:of\\s+)?${number}`, "i");
  const match = text.match(before) || text.match(after);
  return match ? toNumber(match[1]) : 0;
}

function classifyCategory(text) {
  if (/\bied|blast|explosion|bomb\b/i.test(text)) return "IED / Explosion";
  if (/\bdrone|quadcopter|uav\b/i.test(text)) return "Drone / Quadcopter";
  if (/\bibo|operation|intelligence-based|raid\b/i.test(text)) return "Counterterrorism operation";
  if (/\btargeted|assassinat|shot dead\b/i.test(text)) return "Targeted killing";
  if (/\bambush|attack|firing|clash\b/i.test(text)) return "Armed attack";
  return "Security incident";
}

function classifyActor(text) {
  if (/\bttp|pakistani taliban\b/i.test(text)) return "TTP";
  if (/\bbla|balochistan liberation army\b/i.test(text)) return "BLA";
  if (/\bsecurity forces|ctd|police|army|ibo|operation\b/i.test(text)) return "Security forces";
  if (/\bmilitant|armed men|terrorist\b/i.test(text)) return "Armed militants";
  return "Unidentified";
}

function classifySeverity(text, fatalities, injuries) {
  if (fatalities > 0 || injuries >= 3 || /\bied|blast|explosion|killed|dead\b/i.test(text)) return "High";
  if (/\battack|ambush|operation|ibo|drone|quadcopter|damaged\b/i.test(text)) return "Medium";
  return "Low";
}

function findDistrict(text) {
  return DISTRICTS.find((item) => item.match.test(text));
}

function isIncidentPost(text) {
  return /\b(attack|attacked|blast|explosion|ied|quadcopter|drone|killed|injured|wounded|operation|ibo|ambush|firing|militant|terrorist|security forces)\b/i.test(text);
}

function buildTitle(category, district, text) {
  const sentence = compactText(text).split(/[.!?]\s/)[0];
  if (sentence && sentence.length <= 92) return sentence;
  return `${category} reported in ${district}`;
}

async function xFetch(token, path) {
  const response = await fetch(`${X_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`X API ${response.status}: ${body.slice(0, 240)}`);
  }
  return response.json();
}

// Poll the account and return new incidents not already present (by source_url).
export async function pollX(env, existingIncidents) {
  const token = env.X_BEARER_TOKEN || "";
  const username = env.X_USERNAME || "Global_Decipher";
  if (!token) return [];

  const existingUrls = new Set(existingIncidents.map((incident) => incident.source_url).filter(Boolean));

  const user = await xFetch(token, `/users/by/username/${encodeURIComponent(username)}`);
  const userId = user?.data?.id;
  if (!userId) throw new Error(`Could not resolve X user ${username}`);

  const tweets = await xFetch(token, `/users/${userId}/tweets?max_results=20&exclude=retweets,replies&tweet.fields=created_at`);
  const added = [];

  for (const tweet of (tweets.data || []).slice().reverse()) {
    const sourceUrl = `https://x.com/${username}/status/${tweet.id}`;
    if (existingUrls.has(sourceUrl)) continue;

    const text = compactText(tweet.text);
    if (!isIncidentPost(text)) continue;

    const location = findDistrict(text);
    if (!location) continue;

    const fatalities = extractCasualty(text, "killed|dead|martyred");
    const injuries = extractCasualty(text, "injured|wounded");
    const category = classifyCategory(text);
    const date = String(tweet.created_at || new Date().toISOString()).slice(0, 10);

    added.push({
      id: `${date}-${slug(location.district)}-${slug(category)}-${tweet.id}`,
      date,
      time_label: "From X post",
      title: buildTitle(category, location.district, text),
      district: location.district,
      province: location.province,
      country: "Pakistan",
      lat: location.lat,
      lng: location.lng,
      category,
      actor: classifyActor(text),
      status: "Initial report",
      severity: classifySeverity(text, fatalities, injuries),
      fatalities,
      injuries,
      summary: text,
      source: "TGD X",
      source_url: sourceUrl,
      verified: false
    });
  }

  return added;
}
