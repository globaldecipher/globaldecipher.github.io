import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMonthlyAnalytics,
  generateMonthlyReportDraft,
  previousMonth,
  renderCasualtyChart,
  renderRankingChart,
  renderTrendChart
} from "../src/analytics.js";
import { validateIncident } from "../src/feed.js";

const incidents = [
  {
    id: "may-1",
    date: "2026-05-03",
    title: "Incident one",
    summary: "Summary",
    district: "Bajaur",
    province: "Khyber Pakhtunkhwa",
    category: "IED",
    actor: "TTP",
    source: "Dawn",
    source_url: "https://example.com/1",
    lat: 34.72,
    lng: 71.5,
    severity: "High",
    fatalities: 3,
    fatality_breakdown: { forces: 2, terrorists: 0, civilians: 1 },
    injuries: 4,
    verified: true
  },
  {
    id: "may-2",
    date: "2026-05-19",
    title: "Incident two",
    summary: "Summary",
    district: "Quetta",
    province: "Balochistan",
    category: "Security operation",
    actor: "Security Forces / ISKP",
    source: "Official statement",
    source_url: "",
    lat: 30.3,
    lng: 67.2,
    severity: "Medium",
    fatalities: 2,
    fatality_breakdown: { forces: 0, terrorists: 2, civilians: 0 },
    injuries: 0,
    verified: false
  },
  {
    id: "apr-1",
    date: "2026-04-10",
    title: "Previous incident",
    summary: "Summary",
    district: "Peshawar",
    province: "Khyber Pakhtunkhwa",
    category: "Attack",
    actor: "TTP",
    source: "Reuters",
    source_url: "https://example.com/3",
    lat: 34.01,
    lng: 71.56,
    severity: "Medium",
    fatalities: 1,
    injuries: 1
  }
];

test("builds monthly comparisons, rankings and casualty totals", () => {
  const analytics = buildMonthlyAnalytics(incidents, "2026-05");

  assert.equal(analytics.label, "May 2026");
  assert.deepEqual(analytics.totals, {
    incidents: 2,
    fatalities: 5,
    injuries: 4,
    verified: 1,
    districts: 2
  });
  assert.equal(analytics.previous.month, "2026-04");
  assert.equal(analytics.change.incidents, 1);
  assert.equal(analytics.casualties.forces, 2);
  assert.equal(analytics.casualties.terrorists, 2);
  assert.equal(analytics.casualties.civilians, 1);
  assert.ok(analytics.actors.some((row) => row.name === "TTP" && row.count === 1));
  assert.equal(analytics.provinces.length, 2);
  assert.equal(analytics.sourceCoverage.linked, 1);
});

test("renders accessible SVG charts", () => {
  const analytics = buildMonthlyAnalytics(incidents, "2026-05");
  for (const svg of [
    renderTrendChart(analytics),
    renderRankingChart(analytics),
    renderCasualtyChart(analytics)
  ]) {
    assert.match(svg, /^<svg/);
    assert.match(svg, /<title id="title">/);
    assert.match(svg, /editorial review required/);
    assert.doesNotMatch(svg, /undefined|NaN/);
  }
});

test("handles January to December rollover", () => {
  assert.equal(previousMonth("2026-01"), "2025-12");
});

test("validates incident fields before publishing", () => {
  assert.deepEqual(validateIncident(incidents[0]), []);
  const errors = validateIncident({
    ...incidents[0],
    date: "2026-02-31",
    source_url: "javascript:alert(1)",
    injuries: -1
  });
  assert.ok(errors.some((error) => error.includes("real date")));
  assert.ok(errors.some((error) => error.includes("positive number")));
  assert.ok(errors.some((error) => error.includes("HTTP or HTTPS")));
});

test("creates a private D1 report draft and stores three charts in R2", async () => {
  const media = new Map();
  const kv = new Map([["feed", JSON.stringify({ incidents })]]);
  const statements = [];
  const env = {
    INCIDENTS: {
      async get(key) { return kv.get(key) ?? null; },
      async put(key, value) { kv.set(key, value); }
    },
    MEDIA: {
      async put(key, value, options) { media.set(key, { value, options }); }
    },
    CONTENT_DB: {
      prepare(sql) {
        statements.push(sql);
        return {
          bind() {
            return {
              async first() { return null; },
              async run() { return { meta: { changes: 1 } }; }
            };
          }
        };
      }
    }
  };

  const result = await generateMonthlyReportDraft(env, "2026-05");

  assert.equal(result.created, true);
  assert.match(result.path, /^content\/reports\/2026-05-31-/);
  assert.equal(media.size, 3);
  assert.ok([...media.keys()].every((key) => key.startsWith("generated/monthly/2026-05/")));
  assert.ok(statements.some((sql) => sql.includes("INSERT INTO content")));
  assert.ok(kv.has("monthly-report:2026-05"));
});
