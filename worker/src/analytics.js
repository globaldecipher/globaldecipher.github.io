import { loadFeed } from "./feed.js";
import { getFile, putFile } from "./content.js";
import { logAudit } from "./audit.js";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const GENERATED_PREFIX = "generated/monthly/";
const REPORT_MARKER_PREFIX = "monthly-report:";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function add(map, key, values) {
  const label = String(key || "Unspecified").trim() || "Unspecified";
  const current = map.get(label) || { name: label, incidents: 0, fatalities: 0, injuries: 0 };
  current.incidents += 1;
  current.fatalities += number(values.fatalities);
  current.injuries += number(values.injuries);
  map.set(label, current);
}

function rank(map, limit = 8) {
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function dateParts(month) {
  if (!MONTH_RE.test(month)) throw new Error("Month must use YYYY-MM.");
  const [year, monthNumber] = month.split("-").map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const end = `${month}-${String(lastDay).padStart(2, "0")}`;
  const label = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${start}T00:00:00Z`));
  return { year, monthNumber, start, end, lastDay, label };
}

export function previousMonth(month) {
  const { year, monthNumber } = dateParts(month);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthBeforeDate(date) {
  const match = String(date || "").match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) throw new Error("Date must use YYYY-MM-DD.");
  return previousMonth(`${match[1]}-${match[2]}`);
}

function fatalityBreakdown(incident) {
  const split = incident?.fatality_breakdown || incident?.fatalities_breakdown || incident?.fatalities_by || {};
  const forces = number(split.forces ?? split.security_forces);
  const terrorists = number(split.terrorists ?? split.militants);
  const civilians = number(split.civilians ?? split.civilian);
  const total = number(incident?.fatalities);
  return {
    forces,
    terrorists,
    civilians,
    unclassified: Math.max(0, total - forces - terrorists - civilians),
    total
  };
}

function summaryFor(items) {
  const districts = new Set();
  const totals = {
    incidents: items.length,
    fatalities: 0,
    injuries: 0,
    verified: 0,
    districts: 0
  };
  for (const incident of items) {
    totals.fatalities += number(incident.fatalities);
    totals.injuries += number(incident.injuries);
    if (incident.verified) totals.verified += 1;
    if (incident.district) districts.add(incident.district);
  }
  totals.districts = districts.size;
  return totals;
}

function change(current, previous) {
  return current - previous;
}

export function buildMonthlyAnalytics(incidents, month) {
  const period = dateParts(month);
  const previous = previousMonth(month);
  const currentItems = (incidents || []).filter((incident) => String(incident?.date || "").startsWith(`${month}-`));
  const previousItems = (incidents || []).filter((incident) => String(incident?.date || "").startsWith(`${previous}-`));
  const totals = summaryFor(currentItems);
  const previousTotals = summaryFor(previousItems);
  const provinces = new Map();
  const actors = new Map();
  const tactics = new Map();
  const weeks = Array.from({ length: Math.ceil(period.lastDay / 7) }, (_, index) => ({
    label: `Week ${index + 1}`,
    start: `${month}-${String(index * 7 + 1).padStart(2, "0")}`,
    end: `${month}-${String(Math.min(period.lastDay, index * 7 + 7)).padStart(2, "0")}`,
    incidents: 0,
    fatalities: 0,
    injuries: 0
  }));
  const casualties = { forces: 0, terrorists: 0, civilians: 0, unclassified: 0, total: 0 };
  let withSourceLink = 0;

  for (const incident of currentItems) {
    add(provinces, incident.province, incident);
    for (const actor of String(incident.actor || "")
      .split("/")
      .map((value) => value.trim())
      .filter((value) => value && !/^unidentified$/i.test(value))) {
      actors.set(actor, (actors.get(actor) || 0) + 1);
    }
    const tactic = String(incident.category || "Unspecified").trim() || "Unspecified";
    tactics.set(tactic, (tactics.get(tactic) || 0) + 1);
    const day = Number(String(incident.date || "").slice(8, 10));
    const week = weeks[Math.max(0, Math.min(weeks.length - 1, Math.floor((day - 1) / 7)))];
    if (week) {
      week.incidents += 1;
      week.fatalities += number(incident.fatalities);
      week.injuries += number(incident.injuries);
    }
    const split = fatalityBreakdown(incident);
    for (const key of Object.keys(casualties)) casualties[key] += split[key];
    if (/^https?:\/\//i.test(String(incident.source_url || ""))) withSourceLink += 1;
  }

  return {
    month,
    label: period.label,
    period: { start: period.start, end: period.end },
    totals,
    previous: { month: previous, ...previousTotals },
    change: {
      incidents: change(totals.incidents, previousTotals.incidents),
      fatalities: change(totals.fatalities, previousTotals.fatalities),
      injuries: change(totals.injuries, previousTotals.injuries)
    },
    weeks,
    provinces: [...provinces.values()]
      .sort((a, b) => b.incidents - a.incidents || b.fatalities - a.fatalities || a.name.localeCompare(b.name)),
    actors: rank(actors),
    tactics: rank(tactics),
    casualties,
    sourceCoverage: {
      linked: withSourceLink,
      verified: totals.verified,
      total: totals.incidents
    }
  };
}

function xml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function chartShell(title, subtitle, body, height = 620) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${xml(title)}</title>
  <desc id="desc">${xml(subtitle)}</desc>
  <rect width="1200" height="${height}" fill="#f7f5ef"/>
  <rect x="54" y="48" width="4" height="52" fill="#b91c2c"/>
  <text x="78" y="72" font-family="Georgia, serif" font-size="30" font-weight="700" fill="#0d1b2a">${xml(title)}</text>
  <text x="78" y="99" font-family="Arial, sans-serif" font-size="14" fill="#6b6b66">${xml(subtitle)}</text>
  ${body}
  <text x="54" y="${height - 28}" font-family="Arial, sans-serif" font-size="12" fill="#777">Source: TGD incident database · generated draft · editorial review required</text>
</svg>`;
}

export function renderTrendChart(analytics) {
  const values = analytics.weeks.flatMap((week) => [week.incidents, week.fatalities, week.injuries]);
  const max = Math.max(1, ...values);
  const chartTop = 155;
  const chartHeight = 320;
  const slot = 1040 / Math.max(analytics.weeks.length, 1);
  const barWidth = Math.min(34, slot / 4);
  const colors = ["#0d1b2a", "#b91c2c", "#a17328"];
  const bars = analytics.weeks.map((week, index) => {
    const center = 95 + slot * index + slot / 2;
    const entries = [week.incidents, week.fatalities, week.injuries];
    const rects = entries.map((value, itemIndex) => {
      const height = value / max * chartHeight;
      const x = center + (itemIndex - 1) * (barWidth + 8) - barWidth / 2;
      return `<rect x="${x}" y="${chartTop + chartHeight - height}" width="${barWidth}" height="${height}" fill="${colors[itemIndex]}"/><text x="${x + barWidth / 2}" y="${chartTop + chartHeight - height - 8}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="${colors[itemIndex]}">${value}</text>`;
    }).join("");
    return `${rects}<text x="${center}" y="${chartTop + chartHeight + 28}" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#0d1b2a">${xml(week.label)}</text>`;
  }).join("");
  const legend = [
    ["#0d1b2a", "Incidents"],
    ["#b91c2c", "Fatalities"],
    ["#a17328", "Injuries"]
  ].map(([color, label], index) => `<rect x="${780 + index * 125}" y="118" width="12" height="12" fill="${color}"/><text x="${798 + index * 125}" y="129" font-family="Arial, sans-serif" font-size="12" fill="#444">${label}</text>`).join("");
  return chartShell(
    `${analytics.label} incident trend`,
    `${analytics.period.start} to ${analytics.period.end}`,
    `${legend}<line x1="78" y1="${chartTop + chartHeight}" x2="1122" y2="${chartTop + chartHeight}" stroke="#c7c1b5"/>${bars}`
  );
}

export function renderRankingChart(analytics) {
  const rows = analytics.provinces.slice(0, 8);
  const max = Math.max(1, ...rows.map((row) => row.incidents));
  const body = rows.map((row, index) => {
    const y = 165 + index * 52;
    const width = row.incidents / max * 700;
    return `<text x="78" y="${y + 19}" font-family="Arial, sans-serif" font-size="15" fill="#0d1b2a">${xml(row.name)}</text>
      <rect x="330" y="${y}" width="${width}" height="28" fill="#b91c2c"/>
      <text x="${344 + width}" y="${y + 19}" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#0d1b2a">${row.incidents} incidents · ${row.fatalities} fatalities</text>`;
  }).join("");
  return chartShell(`${analytics.label} province comparison`, "Incident count by province", body);
}

export function renderCasualtyChart(analytics) {
  const rows = [
    ["Security forces", analytics.casualties.forces, "#0d1b2a"],
    ["Militants", analytics.casualties.terrorists, "#b91c2c"],
    ["Civilians", analytics.casualties.civilians, "#a17328"],
    ["Unclassified", analytics.casualties.unclassified, "#888780"]
  ];
  const max = Math.max(1, ...rows.map((row) => row[1]));
  const body = rows.map(([label, value, color], index) => {
    const y = 180 + index * 78;
    const width = value / max * 760;
    return `<text x="78" y="${y + 25}" font-family="Arial, sans-serif" font-size="17" fill="#0d1b2a">${xml(label)}</text>
      <rect x="280" y="${y}" width="${width}" height="38" fill="${color}"/>
      <text x="${296 + width}" y="${y + 25}" font-family="Arial, sans-serif" font-size="17" font-weight="700" fill="#0d1b2a">${value}</text>`;
  }).join("");
  return chartShell(`${analytics.label} casualty breakdown`, `${analytics.casualties.total} recorded fatalities`, body);
}

function tableRows(rows, cells) {
  return rows.length
    ? rows.map((row) => `| ${cells(row).join(" | ")} |`).join("\n")
    : "| No recorded data | — |";
}

function signed(value) {
  if (!value) return "no change";
  return `${value > 0 ? "+" : ""}${value}`;
}

function reportMarkdown(analytics, urls) {
  const sourcePct = analytics.sourceCoverage.total
    ? Math.round(analytics.sourceCoverage.linked / analytics.sourceCoverage.total * 100)
    : 0;
  return `> **Automated draft — editorial review required.** Check every total, source link, actor attribution and analytical sentence before publication.

## Executive summary

The TGD incident database records **${analytics.totals.incidents} incidents**, **${analytics.totals.fatalities} fatalities** and **${analytics.totals.injuries} injuries** during ${analytics.label}. Compared with ${analytics.previous.month}, this is ${signed(analytics.change.incidents)} incidents, ${signed(analytics.change.fatalities)} fatalities and ${signed(analytics.change.injuries)} injuries.

![Weekly incident, fatality and injury trend](${urls.trend} "${analytics.label} weekly trend")

## Province comparison

![Incidents by province](${urls.provinces} "${analytics.label} province comparison")

| Province | Incidents | Fatalities | Injuries |
| --- | ---: | ---: | ---: |
${tableRows(analytics.provinces, (row) => [row.name, row.incidents, row.fatalities, row.injuries])}

## Casualty breakdown

![Fatalities by affected group](${urls.casualties} "${analytics.label} casualty breakdown")

| Group | Fatalities |
| --- | ---: |
| Security forces | ${analytics.casualties.forces} |
| Militants | ${analytics.casualties.terrorists} |
| Civilians | ${analytics.casualties.civilians} |
| Unclassified | ${analytics.casualties.unclassified} |

## Leading reported actors

| Actor | Incident records |
| --- | ---: |
${tableRows(analytics.actors, (row) => [row.name, row.count])}

## Leading tactics and categories

| Category | Incident records |
| --- | ---: |
${tableRows(analytics.tactics, (row) => [row.name, row.count])}

## Data-quality check

- ${analytics.sourceCoverage.linked} of ${analytics.sourceCoverage.total} records (${sourcePct}%) include a source link.
- ${analytics.sourceCoverage.verified} records are marked verified.
- ${analytics.totals.districts} districts appear in the monthly dataset.
- Review unclassified fatalities, duplicate events and mixed actor labels before publication.

## Editor analysis

_Replace this section with the desk's reviewed assessment. Do not publish the automated draft without human verification._
`;
}

async function storeChart(env, key, svg) {
  if (!env.MEDIA) throw new Error("R2 media storage is not connected.");
  await env.MEDIA.put(key, svg, {
    httpMetadata: {
      contentType: "image/svg+xml; charset=utf-8",
      cacheControl: "public, max-age=31536000, immutable"
    },
    customMetadata: { generatedBy: "tgd-monthly-automation" }
  });
  return `/media/${key}`;
}

export async function getMonthlyAnalytics(env, month) {
  const feed = await loadFeed(env);
  return buildMonthlyAnalytics(feed.incidents || [], month);
}

export async function generateMonthlyReportDraft(env, month) {
  const analytics = await getMonthlyAnalytics(env, month);
  if (!analytics.totals.incidents) {
    return { created: false, reason: `No incident records found for ${month}.`, analytics };
  }
  const labelSlug = analytics.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const slug = `${analytics.period.end}-${labelSlug}-security-review`;
  const path = `content/reports/${slug}.md`;
  try {
    await getFile(env, path);
    return { created: false, reason: "A monthly report draft already exists.", path, analytics };
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  const prefix = `${GENERATED_PREFIX}${month}`;
  const urls = {
    trend: await storeChart(env, `${prefix}/trend.svg`, renderTrendChart(analytics)),
    provinces: await storeChart(env, `${prefix}/provinces.svg`, renderRankingChart(analytics)),
    casualties: await storeChart(env, `${prefix}/casualties.svg`, renderCasualtyChart(analytics))
  };
  const frontMatter = {
    title: `${analytics.label} Pakistan Security Review`,
    date: analytics.period.end,
    author: "TGD Research Desk",
    type: "reports",
    category: "Monthly",
    region: "Pakistan",
    summary: `Automated editorial draft covering ${analytics.totals.incidents} incident records during ${analytics.label}.`,
    tags: ["Pakistan", "Monthly Review", "Incident Data"],
    access: "free",
    sensitivity: "standard",
    status: "draft",
    featured: false
  };
  const markdown = [
    "---",
    ...Object.entries(frontMatter).map(([key, value]) => (
      Array.isArray(value)
        ? `${key}: ${JSON.stringify(value)}`
        : typeof value === "boolean"
          ? `${key}: ${value}`
          : `${key}: ${JSON.stringify(String(value))}`
    )),
    "---",
    "",
    reportMarkdown(analytics, urls)
  ].join("\n");
  const saved = await putFile(env, path, markdown);
  await logAudit(env, {
    action: "generate",
    kind: "content",
    target: path,
    label: frontMatter.title,
    sha: saved.sha,
    actor: "automation"
  });
  if (env.INCIDENTS) {
    await env.INCIDENTS.put(`${REPORT_MARKER_PREFIX}${month}`, new Date().toISOString());
  }
  return { created: true, path, urls, analytics, sha: saved.sha };
}

export async function maybeGeneratePreviousMonthDraft(env, today) {
  if (!String(today).endsWith("-01")) return { created: false, reason: "Not the first day of the month." };
  const month = monthBeforeDate(today);
  const marker = `${REPORT_MARKER_PREFIX}${month}`;
  if (env.INCIDENTS && await env.INCIDENTS.get(marker)) {
    return { created: false, reason: "Monthly draft already generated.", month };
  }
  const result = await generateMonthlyReportDraft(env, month);
  if (!result.created && result.path && env.INCIDENTS) {
    await env.INCIDENTS.put(marker, new Date().toISOString());
  }
  return result;
}
