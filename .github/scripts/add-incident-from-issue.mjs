import fs from "fs";

const DISTRICT_COORDS = new Map(Object.entries({
  bajaur: [34.72, 71.50],
  "lakki marwat": [32.61, 70.91],
  tank: [32.22, 70.38],
  "south waziristan": [32.30, 69.57],
  "north waziristan": [32.97, 70.09],
  "dera ismail khan": [31.83, 70.90],
  "dera ismail khan tank": [31.95, 70.55],
  "di khan": [31.83, 70.90],
  quetta: [30.30, 67.20],
  peshawar: [34.01, 71.56],
  bannu: [32.99, 70.60],
  khyber: [34.07, 71.15],
  kohat: [33.59, 71.44],
  karachi: [24.86, 67.01],
  lahore: [31.52, 74.36],
  islamabad: [33.68, 73.05]
}));

function normalize(input = "") {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizePlace(input = "") {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function clean(input = "") {
  const value = input.trim();
  return value === "_No response_" ? "" : value;
}

function firstLine(input = "") {
  return clean(input).split("\n").map((line) => line.trim()).find(Boolean) || "";
}

function parseIssueForm(markdown = "") {
  const fields = new Map();
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let label = "";
  let buffer = [];

  const flush = () => {
    if (!label) return;
    fields.set(normalize(label), clean(buffer.join("\n")));
  };

  for (const line of lines) {
    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (heading) {
      flush();
      label = heading[1];
      buffer = [];
    } else if (label) {
      buffer.push(line);
    }
  }

  flush();
  return fields;
}

function requireField(fields, label) {
  const value = clean(fields.get(normalize(label)) || "");
  if (!value) throw new Error(`Missing required field: ${label}`);
  return value;
}

function numberField(fields, label) {
  const value = firstLine(fields.get(normalize(label)) || "0").replace(/,/g, "");
  if (!value) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative number.`);
  return parsed;
}

function optionalNumber(fields, label) {
  const value = firstLine(fields.get(normalize(label)) || "").replace(/,/g, "");
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a number.`);
  return parsed;
}

function slugify(input = "") {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function lookupCoords(district) {
  const normalized = normalizePlace(district);
  if (DISTRICT_COORDS.has(normalized)) return DISTRICT_COORDS.get(normalized);
  for (const [place, coords] of DISTRICT_COORDS) {
    if (normalized.includes(place) || place.includes(normalized)) return coords;
  }
  return [30.3753, 69.3451];
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value).replace(/\n/g, " ")}\n`);
}

function main() {
  if (!process.env.GITHUB_EVENT_PATH) {
    throw new Error("GITHUB_EVENT_PATH is missing.");
  }

  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const issue = event.issue;
  if (!issue) throw new Error("This workflow needs a GitHub issue form event.");

  const fields = parseIssueForm(issue.body || "");
  const title = firstLine(requireField(fields, "Incident title"));
  const date = firstLine(requireField(fields, "Date"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Date must use YYYY-MM-DD format, for example 2026-05-18.");
  }

  const district = firstLine(requireField(fields, "District or area"));
  const province = firstLine(requireField(fields, "Province"));
  const category = firstLine(requireField(fields, "Category"));
  const severity = firstLine(requireField(fields, "Severity"));
  const status = firstLine(requireField(fields, "Status"));
  const summary = requireField(fields, "Public summary").replace(/\n+/g, " ");
  const sourceUrl = firstLine(requireField(fields, "Source link"));
  const source = firstLine(requireField(fields, "Source type")) || "Source";
  const timeLabel = firstLine(fields.get(normalize("Time label")) || "") || "Reported today";
  const actor = firstLine(fields.get(normalize("Reported actor")) || "") || "Unidentified";
  const fatalities = numberField(fields, "Fatalities");
  const injuries = numberField(fields, "Injuries");
  const manualLat = optionalNumber(fields, "Latitude");
  const manualLng = optionalNumber(fields, "Longitude");
  const [lookupLat, lookupLng] = lookupCoords(district);
  const lat = manualLat ?? lookupLat;
  const lng = manualLng ?? lookupLng;
  const id = `${date}-${slugify(district)}-${slugify(title)}`;

  const incident = {
    id,
    date,
    reported_at: `${date}T12:00:00.000Z`,
    time_label: timeLabel,
    title,
    district,
    province,
    country: "Pakistan",
    lat,
    lng,
    category,
    actor,
    status,
    severity,
    fatalities,
    injuries,
    summary,
    source,
    source_url: sourceUrl,
    verified: status.toLowerCase() === "confirmed"
  };

  // Incidents now live in Cloudflare KV behind the Worker, not in a committed
  // file. Emit the parsed incident as a payload; the workflow POSTs it to the
  // Worker's authed ingest endpoint.
  const payloadPath = "incident-payload.json";
  fs.writeFileSync(payloadPath, JSON.stringify(incident, null, 2), "utf8");

  writeOutput("incident_title", title);
  writeOutput("incident_id", id);
  writeOutput("incident_payload", payloadPath);
  console.log(`Wrote incident payload for "${title}" to ${payloadPath}`);
}

try {
  main();
} catch (error) {
  console.error(`::error::${error.message}`);
  process.exit(1);
}
