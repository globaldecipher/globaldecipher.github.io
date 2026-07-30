import { strToU8, zipSync } from "fflate";
import { loadFeed, pakistanDateFromIso } from "./feed.js";

// The KV feed and the D1 incidents table use different field names for the
// same concepts. Normalising KV rows into the D1 shape lets the export write
// one code path for both sources.
function normaliseFeedIncident(row) {
  if (!row) return null;
  const split = row.fatality_breakdown || row.fatalities_breakdown || {};
  return {
    id: row.id,
    fingerprint: null,
    source_tweet_id: row.source_id || null,
    source_url: row.source_url || row.source || null,
    source_text: row.summary || null,
    tweet_created_at: row.tweet_created_at || (row.date ? `${row.date}T00:00:00Z` : null),
    incident_date: row.date || null,
    incident_date_source: row.incident_date_source || "manual",
    country: row.country || "Pakistan",
    province: row.province,
    district: row.district,
    locality: row.locality || null,
    location_label: row.location_label || null,
    latitude: row.lat ?? row.latitude ?? null,
    longitude: row.lng ?? row.longitude ?? null,
    location_precision: row.location_precision || null,
    incident_type: row.incident_type || row.category || null,
    category_name: row.category || null,
    summary: row.summary || row.title || null,
    killed: row.fatalities != null ? Number(row.fatalities) : null,
    killed_forces: split.forces != null ? Number(split.forces) : null,
    killed_terrorists: split.terrorists != null ? Number(split.terrorists) : null,
    killed_civilians: split.civilians != null ? Number(split.civilians) : null,
    injured: row.injuries != null ? Number(row.injuries) : null,
    actor_or_group: row.actor || null,
    confidence: row.confidence || null,
    status: row.status || "published",
    ingestion_source: row.ingestion_source || "curated"
  };
}

const TIME_ZONE = "Asia/Karachi";
const SOURCE_LABEL = "Source: The Global Decipher incident database";

function text(value) {
  return value == null ? "" : String(value);
}

function xml(value) {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function csvCell(value) {
  const raw = text(value);
  const cell = typeof value === "string" && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

function monthBounds(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    const error = new Error("Month must use YYYY-MM.");
    error.status = 400;
    throw error;
  }
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year, monthNumber, 1));
  return {
    start: `${month}-01`,
    end: next.toISOString().slice(0, 10)
  };
}

function countBy(rows, key, fallback = "Unspecified") {
  const grouped = new Map();
  for (const row of rows) {
    const name = text(row[key]).trim() || fallback;
    const current = grouped.get(name) || { name, incidents: 0, killed: 0, injured: 0 };
    current.incidents += 1;
    current.killed += Number(row.killed) || 0;
    current.injured += Number(row.injured) || 0;
    grouped.set(name, current);
  }
  return [...grouped.values()].sort((left, right) => (
    right.incidents - left.incidents || left.name.localeCompare(right.name)
  ));
}

function dailyTrend(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const day = row.incident_date || pakistanDateFromIso(row.tweet_created_at);
    grouped.set(day, (grouped.get(day) || 0) + 1);
  }
  return [...grouped].sort(([left], [right]) => left.localeCompare(right))
    .map(([name, incidents]) => ({ name, incidents }));
}

function countByStatus(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = text(row.status).trim() || "unknown";
    grouped.set(key, (grouped.get(key) || 0) + 1);
  }
  return Object.fromEntries(grouped);
}

export function monthlySummary(rows) {
  const published = rows.filter((row) => text(row.status).trim() === "published");
  return {
    totals: {
      incidents: rows.length,
      published: published.length,
      pending_review: rows.length - published.length,
      killed: rows.reduce((sum, row) => sum + (Number(row.killed) || 0), 0),
      injured: rows.reduce((sum, row) => sum + (Number(row.injured) || 0), 0)
    },
    by_status: countByStatus(rows),
    provinces: countBy(rows, "province"),
    districts: countBy(rows, "district"),
    incidentTypes: countBy(rows, "incident_type"),
    categories: countBy(rows, "category_name"),
    daily: dailyTrend(rows)
  };
}

function columnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function worksheetXml(rows, widths = []) {
  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
      if (typeof value === "number" && Number.isFinite(value)) {
        return `<c r="${ref}"${rowIndex === 0 ? ' s="1"' : ""}><v>${value}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"${rowIndex === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const columns = widths.length
    ? `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${columns}
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetData>${rowXml}</sheetData>
  <autoFilter ref="A1:${columnName(Math.max(0, (rows[0]?.length || 1) - 1))}${Math.max(1, rows.length)}"/>
</worksheet>`;
}

function workbookFiles(sheets) {
  const sheetEntries = sheets.map((sheet, index) => (
    `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  )).join("");
  const relationships = sheets.map((_, index) => (
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  )).join("");
  const overrides = sheets.map((_, index) => (
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )).join("");
  const files = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${overrides}
</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheetEntries}</sheets>
</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relationships}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0D1B2A"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
</styleSheet>`)
  };
  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheetXml(sheet.rows, sheet.widths));
  });
  return files;
}

function breakdownRows(rows) {
  return [
    ["Name", "Incidents", "Killed", "Injured"],
    ...rows.map((row) => [row.name, row.incidents, row.killed, row.injured])
  ];
}

export function buildMonthlyWorkbook(rows, month) {
  const summary = monthlySummary(rows);
  const bounds = monthBounds(month);
  const lastDay = new Date(new Date(`${bounds.end}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
  const statusLines = Object.entries(summary.by_status)
    .sort(([, a], [, b]) => b - a)
    .map(([status, count]) => [`  · ${status}`, count]);
  const incidentRows = [
    [
      "Incident date", "Incident date source", "TGD post date", "Province", "District",
      "Locality", "Incident type", "Category", "Killed", "Injured", "Actor / group",
      "Summary", "Source X URL", "Latitude", "Longitude", "Publication status"
    ],
    ...rows.map((row) => [
      row.incident_date || "Unknown — use TGD post date",
      row.incident_date_source || "unknown",
      pakistanDateFromIso(row.tweet_created_at),
      row.province,
      row.district,
      row.locality,
      row.incident_type,
      row.category_name,
      row.killed == null ? "Not stated" : Number(row.killed),
      row.injured == null ? "Not stated" : Number(row.injured),
      row.actor_or_group,
      row.summary,
      row.source_url,
      row.latitude,
      row.longitude,
      row.status
    ])
  ];
  const sheets = [
    { name: "All Incidents", rows: incidentRows, widths: [14, 19, 14, 22, 22, 22, 25, 25, 11, 11, 28, 70, 48, 12, 12, 16] },
    {
      name: "Monthly Summary",
      rows: [
        ["Metric", "Value"],
        ["Reporting month", month],
        ["Reporting period (from)", bounds.start],
        ["Reporting period (to, inclusive)", lastDay],
        ["Total incidents in range", summary.totals.incidents],
        ["  · Published", summary.totals.published],
        ["  · Not yet published (needs review / duplicate / rejected)", summary.totals.pending_review],
        ...statusLines,
        ["Total killed (known figures, all statuses)", summary.totals.killed],
        ["Total injured (known figures, all statuses)", summary.totals.injured],
        ["Data source", SOURCE_LABEL],
        ["Coverage note", "This export includes every incident in the range — published and pending. Filter the 'Publication status' column in the All Incidents sheet to isolate one status."],
        ["Uncertainty note", "Unknown casualty figures remain blank and are not converted to zero."]
      ],
      widths: [46, 72]
    },
    { name: "Province Breakdown", rows: breakdownRows(summary.provinces), widths: [30, 14, 14, 14] },
    { name: "District Breakdown", rows: breakdownRows(summary.districts), widths: [30, 14, 14, 14] },
    { name: "Incident Type Breakdown", rows: breakdownRows(summary.incidentTypes), widths: [34, 14, 14, 14] },
    { name: "Category Breakdown", rows: breakdownRows(summary.categories), widths: [34, 14, 14, 14] }
  ];
  // Store-only ZIP keeps monthly generation within the free Worker CPU budget.
  // The workbook is slightly larger but still tiny at TGD's monthly volume.
  return zipSync(workbookFiles(sheets), { level: 0 });
}

export function buildMonthlyCsv(rows) {
  const headers = [
    "incident_date", "incident_date_source", "tgd_post_date", "province", "district",
    "locality", "incident_type", "category", "killed", "injured", "actor_or_group",
    "summary", "source_x_url", "latitude", "longitude", "publication_status"
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push([
      row.incident_date || "",
      row.incident_date_source || "unknown",
      pakistanDateFromIso(row.tweet_created_at),
      row.province,
      row.district,
      row.locality,
      row.incident_type,
      row.category_name,
      row.killed,
      row.injured,
      row.actor_or_group,
      row.summary,
      row.source_url,
      row.latitude,
      row.longitude,
      row.status
    ].map(csvCell).join(","));
  }
  return "\uFEFF" + lines.join("\r\n");
}

function chartSvg(title, rows, valueKey = "incidents", limit = 12) {
  const items = rows.slice(0, limit);
  const width = 960;
  const rowHeight = 42;
  const height = Math.max(220, 120 + items.length * rowHeight);
  const max = Math.max(1, ...items.map((row) => Number(row[valueKey]) || 0));
  const bars = items.map((row, index) => {
    const y = 82 + index * rowHeight;
    const barWidth = Math.round(((Number(row[valueKey]) || 0) / max) * 560);
    return `<text x="24" y="${y + 18}" font-family="Arial, sans-serif" font-size="14" fill="#0d1b2a">${xml(row.name)}</text>
<rect x="300" y="${y}" width="${barWidth}" height="24" rx="4" fill="#a17328"/>
<text x="${310 + barWidth}" y="${y + 18}" font-family="Arial, sans-serif" font-size="13" fill="#0d1b2a">${Number(row[valueKey]) || 0}</text>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">${xml(title)}</title>
<desc id="desc">${xml(SOURCE_LABEL)}</desc>
<rect width="100%" height="100%" fill="#fafaf7"/>
<text x="24" y="38" font-family="Georgia, serif" font-size="24" font-weight="700" fill="#0d1b2a">${xml(title)}</text>
<text x="24" y="${height - 24}" font-family="Arial, sans-serif" font-size="12" fill="#6b6b66">${xml(SOURCE_LABEL)}</text>
${bars}
</svg>`;
}

export function buildMonthlyCharts(rows, month) {
  const summary = monthlySummary(rows);
  return [
    { name: "incidents-by-province", title: `Incidents by province — ${month}`, svg: chartSvg(`Incidents by province — ${month}`, summary.provinces) },
    { name: "incidents-by-district", title: `Incidents by district — ${month}`, svg: chartSvg(`Incidents by district — ${month}`, summary.districts) },
    { name: "incidents-by-type", title: `Incidents by incident type — ${month}`, svg: chartSvg(`Incidents by incident type — ${month}`, summary.incidentTypes) },
    { name: "incidents-by-category", title: `Incidents by category — ${month}`, svg: chartSvg(`Incidents by category — ${month}`, summary.categories) },
    { name: "killed-by-province", title: `Known fatalities by province — ${month}`, svg: chartSvg(`Known fatalities by province — ${month}`, summary.provinces, "killed") },
    { name: "daily-trend", title: `Daily trend of TGD-posted incidents — ${month}`, svg: chartSvg(`Daily trend of TGD-posted incidents — ${month}`, summary.daily) }
  ];
}

function syntheticMonthlyRows(rowCount, month) {
  const count = Math.max(1, Math.min(500, Number(rowCount) || 300));
  return Array.from({ length: count }, (_, index) => ({
    id: `probe-${index + 1}`,
    incident_date: `${month}-${String((index % 28) + 1).padStart(2, "0")}`,
    incident_date_source: "explicit_in_post",
    tweet_created_at: `${month}-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
    province: index % 2 ? "Khyber Pakhtunkhwa" : "Balochistan",
    district: index % 2 ? "Peshawar" : "Kech",
    locality: index % 2 ? "Peshawar" : "Turbat",
    incident_type: index % 3 ? "Armed attack" : "Counterterrorism operation",
    category_name: index % 3 ? "Armed attack" : "Counterterrorism operation",
    killed: index % 5 === 0 ? null : index % 4,
    injured: index % 7 === 0 ? null : index % 6,
    actor_or_group: "Unidentified",
    summary: `Runtime probe incident ${index + 1}; representative monthly export row.`,
    source_url: `https://x.com/Global_Decipher/status/${2073403718540972000n + BigInt(index)}`,
    latitude: index % 2 ? 34.01 : 26,
    longitude: index % 2 ? 71.56 : 63.05,
    status: "published"
  }));
}

export function benchmarkMonthlyArtifacts(rowCount = 300, month = "2026-06", includeCharts = true) {
  const rows = syntheticMonthlyRows(rowCount, month);
  const started = performance.now();
  const workbook = buildMonthlyWorkbook(rows, month);
  const csv = buildMonthlyCsv(rows);
  const charts = includeCharts ? buildMonthlyCharts(rows, month) : [];
  const buildMs = performance.now() - started;
  return {
    row_count: rows.length,
    include_charts: includeCharts,
    build_ms: Number(buildMs.toFixed(3)),
    xlsx_bytes: workbook.byteLength,
    csv_bytes: strToU8(csv).byteLength,
    chart_count: charts.length,
    chart_bytes: charts.reduce((total, chart) => total + strToU8(chart.svg).byteLength, 0)
  };
}

export async function generateMonthlyDataPackage(env, month, options = {}) {
  if (!env.MEDIA) {
    const error = new Error("The MEDIA R2 binding is not configured.");
    error.status = 503;
    throw error;
  }
  const bounds = monthBounds(month);
  // The Monthly Summary sheet breaks results down by status, so this pulls the
  // full range (published + needs_review + possible_duplicate) rather than only
  // published rows — a package that only shows the published tail confused the
  // desk into thinking uploads had failed.
  const result = await env.CONTENT_DB.prepare(`
    SELECT *
    FROM incidents
    WHERE status IN ('published', 'needs_review', 'possible_duplicate')
      AND COALESCE(incident_date, date(tweet_created_at, '+5 hours')) >= ?
      AND COALESCE(incident_date, date(tweet_created_at, '+5 hours')) < ?
    ORDER BY COALESCE(incident_date, date(tweet_created_at, '+5 hours')), tweet_created_at, id
  `).bind(bounds.start, bounds.end).all();
  const d1Rows = result.results || [];
  // Manual admin uploads write to the KV feed only, not D1 — so the export
  // pulls those too, filters to the month, and merges with D1 by id.
  const feed = await loadFeed(env).catch(() => ({ incidents: [] }));
  const feedRows = (feed?.incidents || [])
    .filter((incident) => String(incident?.date || "").startsWith(`${month}-`))
    .map(normaliseFeedIncident)
    .filter(Boolean);
  const seen = new Set(d1Rows.map((row) => row.id));
  const rows = [
    ...d1Rows,
    ...feedRows.filter((row) => row.id && !seen.has(row.id))
  ].sort((left, right) => {
    const leftDate = left.incident_date || pakistanDateFromIso(left.tweet_created_at) || "";
    const rightDate = right.incident_date || pakistanDateFromIso(right.tweet_created_at) || "";
    return leftDate.localeCompare(rightDate) || String(left.id).localeCompare(String(right.id));
  });
  const versionRow = await env.CONTENT_DB.prepare(
    "SELECT COALESCE(MAX(version), 0) AS version FROM monthly_exports WHERE report_month = ?"
  ).bind(month).first();
  const version = Number(versionRow?.version || 0) + 1;
  const prefix = `agent-exports/${month}/v${version}`;
  const csvKey = `${prefix}/tgd-incidents-${month}.csv`;
  const xlsxKey = `${prefix}/tgd-incidents-${month}.xlsx`;
  const includeCharts = options.includeCharts ?? String(env.MONTHLY_CHARTS_ENABLED || "true") !== "false";
  const buildStarted = performance.now();
  const charts = includeCharts ? buildMonthlyCharts(rows, month) : [];
  const workbook = buildMonthlyWorkbook(rows, month);
  const csv = buildMonthlyCsv(rows);
  const buildMs = performance.now() - buildStarted;

  await Promise.all([
    env.MEDIA.put(csvKey, csv, {
      httpMetadata: { contentType: "text/csv; charset=utf-8" },
      customMetadata: { reportMonth: month, version: String(version), source: SOURCE_LABEL }
    }),
    env.MEDIA.put(xlsxKey, workbook, {
      httpMetadata: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      customMetadata: { reportMonth: month, version: String(version), source: SOURCE_LABEL }
    }),
    ...charts.map((chart) => env.MEDIA.put(`${prefix}/${chart.name}.svg`, chart.svg, {
      httpMetadata: { contentType: "image/svg+xml; charset=utf-8" },
      customMetadata: { reportMonth: month, version: String(version), title: chart.title }
    }))
  ]);

  const chartMetadata = charts.map((chart) => ({
    name: chart.name,
    title: chart.title,
    object_key: `${prefix}/${chart.name}.svg`
  }));
  await env.CONTENT_DB.prepare(`
    INSERT INTO monthly_exports (
      report_month, timezone, xlsx_object_key, csv_object_key, charts_metadata, status, version
    ) VALUES (?, ?, ?, ?, ?, 'ready', ?)
  `).bind(month, TIME_ZONE, xlsxKey, csvKey, JSON.stringify(chartMetadata), version).run();

  const published = rows.filter((row) => text(row.status).trim() === "published").length;
  const lastDayIso = new Date(new Date(`${bounds.end}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
  return {
    month,
    version,
    incident_count: rows.length,
    published_count: published,
    pending_count: rows.length - published,
    period: { from: bounds.start, to: lastDayIso },
    include_charts: includeCharts,
    build_ms: Number(buildMs.toFixed(3)),
    xlsx_object_key: xlsxKey,
    csv_object_key: csvKey,
    charts: chartMetadata
  };
}

export async function maybeGeneratePreviousMonthPackage(env, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  if (values.day !== "01") return { created: false, reason: "not-first-day" };
  const current = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, 1));
  current.setUTCMonth(current.getUTCMonth() - 1);
  const month = current.toISOString().slice(0, 7);
  const existing = await env.CONTENT_DB.prepare(
    "SELECT id FROM monthly_exports WHERE report_month = ? LIMIT 1"
  ).bind(month).first();
  if (existing) return { created: false, reason: "already-generated", month };
  return { created: true, package: await generateMonthlyDataPackage(env, month) };
}
