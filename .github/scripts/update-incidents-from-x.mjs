import fs from "fs";

const DATA_PATH = "static/data/incidents.json";
const RETENTION_DAYS = 31;
const X_USERNAME = process.env.X_USERNAME || "Global_Decipher";
const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN || "";
const X_API = "https://api.twitter.com/2";

const NUMBER_WORDS = new Map([
  ["zero", 0],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["twenty", 20],
  ["thirty", 30],
  ["thirty-five", 35]
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

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

function compactText(text) {
  return String(text || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56);
}

function dateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function retentionCutoff(now = new Date()) {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS + 1);
  return cutoff;
}

function pruneOldIncidents(incidents, now = new Date()) {
  const cutoff = retentionCutoff(now);
  return incidents.filter((incident) => {
    const incidentDate = dateValue(incident.date);
    return !incidentDate || incidentDate >= cutoff;
  });
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

async function xFetch(path) {
  const response = await fetch(`${X_API}${path}`, {
    headers: { Authorization: `Bearer ${X_BEARER_TOKEN}` }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`X API ${response.status}: ${body.slice(0, 240)}`);
  }
  return response.json();
}

async function main() {
  if (!X_BEARER_TOKEN) {
    console.log("X_BEARER_TOKEN is not configured; skipping X import.");
    setOutput("added_count", 0);
    return;
  }

  const feed = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const incidents = Array.isArray(feed.incidents) ? feed.incidents : [];
  const existingUrls = new Set(incidents.map((incident) => incident.source_url).filter(Boolean));

  const user = await xFetch(`/users/by/username/${encodeURIComponent(X_USERNAME)}`);
  const userId = user?.data?.id;
  if (!userId) throw new Error(`Could not resolve X user ${X_USERNAME}`);

  const tweets = await xFetch(`/users/${userId}/tweets?max_results=20&exclude=retweets,replies&tweet.fields=created_at`);
  const added = [];

  for (const tweet of (tweets.data || []).slice().reverse()) {
    const sourceUrl = `https://x.com/${X_USERNAME}/status/${tweet.id}`;
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

  const nextIncidents = pruneOldIncidents(added.concat(incidents))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const changed = added.length > 0 || nextIncidents.length !== incidents.length;

  if (changed) {
    feed.retention_days = RETENTION_DAYS;
    feed.incidents = nextIncidents;
    feed.last_updated = new Date().toISOString();
    fs.writeFileSync(DATA_PATH, `${JSON.stringify(feed, null, 2)}\n`);
  }

  console.log(`Added ${added.length} incident(s) from X.`);
  setOutput("added_count", added.length);
  setOutput("changed_count", changed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
