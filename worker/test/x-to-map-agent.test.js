import assert from "node:assert/strict";
import { test } from "node:test";
import { unzipSync, strFromU8 } from "fflate";
import {
  acquireAgentLock,
  conversationReady,
  dailyInfographicSummary,
  decryptToken,
  effectiveIncidentDate,
  encryptToken,
  evaluateOwnerRules,
  highestXId,
  isTransientXError,
  normalizeXPost,
  publicationSafety,
  publicIncident,
  realIsoDate,
  releaseAgentLock,
  renewAgentLock,
  resolveSafeLocation,
  validateGeminiOutput,
  validateXApiRequestPath,
  xRetryDelaySeconds
} from "../src/x-to-map-agent.js";
import { pakistanDateFromIso } from "../src/feed.js";
import {
  benchmarkMonthlyArtifacts,
  buildMonthlyCharts,
  buildMonthlyCsv,
  buildMonthlyWorkbook,
  generateMonthlyDataPackage,
  monthlySummary
} from "../src/monthly-data-package.js";

const posts = [
  {
    x_post_id: "2073403718540972192",
    conversation_id: "2073403718540972192",
    parent_post_id: null,
    raw_text: "BREAKING: Security forces conducted an IBO in the Gorandi area of Turbat, Balochistan, eliminating three terrorists.",
    referenced_tweets_json: "[]",
    created_at: "2026-07-04T12:00:00.000Z",
    post_url: "https://x.com/Global_Decipher/status/2073403718540972192"
  }
];

function extraction(overrides = {}) {
  return {
    post_classification: "SINGLE_INCIDENT",
    classification_confidence: "high",
    classification_reason: "A concrete incident in Pakistan.",
    incidents: [{
      source_tweet_id: posts[0].x_post_id,
      incident_date: "2026-07-04",
      incident_date_source: "inferred_from_post_date",
      country: "Pakistan",
      province: "Balochistan",
      district: "Kech",
      locality: "Gorandi, Turbat",
      location_label: "Gorandi area of Turbat",
      incident_type: "Intelligence-based operation",
      category: "Counterterrorism operation",
      summary: "Security forces killed three terrorists during an intelligence-based operation in Turbat.",
      killed: 3,
      killed_forces: 0,
      killed_terrorists: 3,
      killed_civilians: 0,
      injured: null,
      arrested: 0,
      actor_or_group: "Security forces",
      confidence: "high",
      requires_review: false,
      reason_for_review: null,
      update_target_tweet_id: null,
      disqualifies_prior_incident: false,
      ...overrides
    }]
  };
}

test("keeps X IDs as strings and retains self-replies", () => {
  const normalized = normalizeXPost({
    id: "2073403718540972192",
    text: "Thread reply",
    author_id: "123",
    conversation_id: "2073403718540972000",
    in_reply_to_user_id: "123",
    referenced_tweets: [{ type: "replied_to", id: "2073403718540972000" }],
    created_at: "2026-07-04T12:00:00.000Z"
  });
  assert.equal(typeof normalized.x_post_id, "string");
  assert.equal(normalized.parent_post_id, "2073403718540972000");
});

test("an empty X response normalizes to no posts", () => {
  assert.deepEqual([].map(normalizeXPost).filter(Boolean), []);
});

test("temporary X failures use bounded backoff instead of failing every minute forever", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 20].map(xRetryDelaySeconds),
    [60, 120, 300, 600, 900, 900]
  );
  assert.equal(isTransientXError({ upstreamStatus: 503 }), true);
  assert.equal(isTransientXError({ status: 401 }), false);
});

test("moves the cursor to the greatest string X ID without number conversion", () => {
  assert.equal(highestXId([
    "999999999999999999",
    "2073403718540972192",
    "2073403718540972191"
  ]), "2073403718540972192");
});

test("converts X UTC timestamps to the correct Pakistan calendar date", () => {
  assert.equal(pakistanDateFromIso("2026-07-04T23:09:16.000Z"), "2026-07-05");
  assert.equal(pakistanDateFromIso("2026-07-04T18:59:59.000Z"), "2026-07-04");
  assert.equal(pakistanDateFromIso("not-a-date"), "");
});

test("an inferred incident always uses the Pakistan-local post date", () => {
  assert.equal(effectiveIncidentDate({
    incident_date: "2026-07-04",
    incident_date_source: "inferred_from_post_date"
  }, "2026-07-05"), "2026-07-05");
  assert.equal(effectiveIncidentDate({
    incident_date: "2026-07-03",
    incident_date_source: "explicit_in_post"
  }, "2026-07-05"), "2026-07-03");
});

test("X API allowlist permits only the TGD timeline shape and users/me", () => {
  assert.equal(validateXApiRequestPath("/users/me").kind, "me");
  assert.deepEqual(
    validateXApiRequestPath(
      "/users/123456/tweets?since_id=123455&max_results=100&exclude=retweets&tweet.fields=id,text,created_at,author_id,conversation_id,referenced_tweets"
    ),
    {
      kind: "timeline",
      userId: "123456",
      url: "https://api.x.com/2/users/123456/tweets?since_id=123455&max_results=100&exclude=retweets&tweet.fields=id,text,created_at,author_id,conversation_id,referenced_tweets"
    }
  );
});

test("X API allowlist blocks search, user lookups, social graph, media fields, and expansions", () => {
  const blocked = [
    "/tweets/search/recent?query=Pakistan",
    "/users/123456",
    "/users/123456/mentions",
    "/users/123456/followers",
    "/users/123456/following",
    "/tweets/123456",
    "/users/123456/tweets?max_results=5&expansions=attachments.media_keys",
    "/users/123456/tweets?max_results=5&tweet.fields=id,attachments",
    "/users/me?user.fields=id,username"
  ];
  for (const path of blocked) {
    assert.throws(() => validateXApiRequestPath(path), /Blocked|does not permit/);
  }
});

test("accepts one high-confidence Pakistan incident", () => {
  const parsed = validateGeminiOutput(extraction(), posts);
  const location = resolveSafeLocation(parsed.incidents[0]);
  const safety = publicationSafety(parsed, parsed.incidents[0], location);
  assert.equal(location.district, "Kech");
  assert.equal(parsed.incidents[0].killed_terrorists, 3);
  assert.equal(safety.publish, true);
});

test("publishes the structured fatality breakdown used by the incident map", () => {
  const incident = publicIncident({
    id: "incident-1",
    incident_date: "2026-07-05",
    tweet_created_at: "2026-07-05T09:00:00.000Z",
    killed: 3,
    killed_forces: 0,
    killed_terrorists: 3,
    killed_civilians: 0
  });
  assert.deepEqual(incident.fatality_breakdown, {
    forces: 0,
    terrorists: 3,
    civilians: 0
  });
});

test("does not confuse Khyber Pakhtunkhwa province text with Khyber district", () => {
  const parsed = validateGeminiOutput(extraction({
    province: "Khyber Pakhtunkhwa",
    district: "Peshawar",
    locality: "Peshawar",
    location_label: "Peshawar"
  }), posts);
  const location = resolveSafeLocation(parsed.incidents[0]);
  assert.equal(location.province, "Khyber Pakhtunkhwa");
  assert.equal(location.district, "Peshawar");
});

test("withholds a location when the stated province conflicts with the district", () => {
  const parsed = validateGeminiOutput(extraction({
    province: "Sindh",
    district: "Kech",
    locality: "Turbat",
    location_label: "Turbat"
  }), posts);
  assert.equal(resolveSafeLocation(parsed.incidents[0]), null);
});

test("rejects impossible calendar dates before publication", () => {
  assert.equal(realIsoDate("2026-99-99"), null);
  const parsed = validateGeminiOutput(extraction({ incident_date: "2026-99-99" }), posts);
  const location = resolveSafeLocation(parsed.incidents[0]);
  assert.equal(parsed.incidents[0].incident_date, null);
  assert.equal(publicationSafety(parsed, parsed.incidents[0], location, null, {
    postDate: "2026-07-04"
  }).publish, false);
});

test("withholds an explicitly stated incident date later than its source post", () => {
  const parsed = validateGeminiOutput(extraction({
    incident_date: "2026-07-05",
    incident_date_source: "explicit_in_post"
  }), posts);
  const location = resolveSafeLocation(parsed.incidents[0]);
  const safety = publicationSafety(parsed, parsed.incidents[0], location, null, {
    postDate: "2026-07-04"
  });
  assert.equal(safety.dateValid, false);
  assert.equal(safety.publish, false);
});

test("accepts an inferred Pakistan date even when Gemini echoed the UTC date", () => {
  const parsed = validateGeminiOutput(extraction({
    incident_date: "2026-07-04",
    incident_date_source: "inferred_from_post_date"
  }), posts);
  const location = resolveSafeLocation(parsed.incidents[0]);
  const safety = publicationSafety(parsed, parsed.incidents[0], location, null, {
    postDate: "2026-07-05"
  });
  assert.equal(safety.dateValid, true);
  assert.equal(safety.publish, true);
});

test("owner review rules deterministically block automatic publication", () => {
  const parsed = validateGeminiOutput(extraction(), posts);
  const location = resolveSafeLocation(parsed.incidents[0]);
  const ownerRules = evaluateOwnerRules([{
    title: "Review Turbat",
    rule_type: "always_review",
    rule_text: "Turbat"
  }], posts[0], parsed.incidents[0]);
  const safety = publicationSafety(parsed, parsed.incidents[0], location, null, {
    postDate: "2026-07-04",
    ownerRules
  });
  assert.equal(ownerRules.requiresReview, true);
  assert.equal(safety.publish, false);
});

test("owner ignore rules deterministically suppress automatic publication", () => {
  const parsed = validateGeminiOutput(extraction(), posts);
  const location = resolveSafeLocation(parsed.incidents[0]);
  const ownerRules = evaluateOwnerRules([{
    title: "Ignore exercises",
    rule_type: "ignore",
    rule_text: "exercise"
  }], { raw_text: "Security forces conducted an exercise in Turbat." }, parsed.incidents[0]);
  const safety = publicationSafety(parsed, parsed.incidents[0], location, null, {
    postDate: "2026-07-04",
    ownerRules
  });
  assert.equal(ownerRules.ignore, true);
  assert.equal(safety.publish, false);
});

test("preserves missing casualties as null rather than zero", () => {
  const parsed = validateGeminiOutput(extraction({ killed: null, injured: null, arrested: null }), posts);
  assert.equal(parsed.incidents[0].killed, null);
  assert.equal(parsed.incidents[0].injured, null);
  assert.equal(parsed.incidents[0].arrested, null);
});

test("daily infographic totals use published D1 fields without rereading X", () => {
  const result = dailyInfographicSummary([
    {
      id: "one",
      incident_date: "2026-07-05",
      district: "Kech",
      province: "Balochistan",
      latitude: 26,
      longitude: 63.05,
      category_name: "Counterterrorism operation",
      summary: "Three militants were killed and two suspects were arrested.",
      killed: 3,
      injured: 0,
      arrested: 2
    },
    {
      id: "two",
      incident_date: "2026-07-05",
      district: "Bannu",
      province: "Khyber Pakhtunkhwa",
      latitude: 32.99,
      longitude: 70.6,
      category_name: "Armed attack",
      summary: "One officer was injured.",
      killed: 0,
      injured: 1,
      arrested: null
    }
  ], "2026-07-05");
  assert.deepEqual(
    {
      incidents: result.total_incidents,
      killed: result.killed,
      injured: result.injured,
      arrested: result.arrested
    },
    { incidents: 2, killed: 3, injured: 1, arrested: 2 }
  );
});

test("a daily roundup can return several separate incidents", () => {
  const second = {
    ...extraction().incidents[0],
    source_tweet_id: posts[0].x_post_id,
    district: "Gwadar",
    locality: "Jiwani",
    summary: "A second distinct incident was reported in Jiwani."
  };
  const value = extraction();
  value.post_classification = "DAILY_ROUNDUP";
  value.incidents.push(second);
  const parsed = validateGeminiOutput(value, posts);
  assert.equal(parsed.incidents.length, 2);
});

test("an active self-reply thread waits for three quiet minutes", () => {
  const now = Date.parse("2026-07-04T12:03:00.000Z");
  const thread = [{
    ...posts[0],
    parent_post_id: "2073403718540972000",
    raw_json: JSON.stringify({ in_reply_to_user_id: "123" }),
    created_at: "2026-07-04T12:02:30.000Z"
  }];
  assert.equal(conversationReady(thread, "123", now), false);
  assert.equal(conversationReady(thread, "123", now + 3 * 60 * 1000), true);
});

test("an infographic recap cannot auto-publish", () => {
  const parsed = validateGeminiOutput({
    ...extraction(),
    post_classification: "INFOGRAPHIC_RECAP",
    incidents: []
  }, posts);
  assert.equal(publicationSafety(parsed, {}, null).publish, false);
});

test("a monthly report cannot auto-publish", () => {
  const parsed = validateGeminiOutput({
    ...extraction(),
    post_classification: "MONTHLY_REPORT",
    incidents: []
  }, posts);
  assert.equal(publicationSafety(parsed, {}, null).publish, false);
});

test("a quote-post correction is withheld for review", () => {
  const parsed = validateGeminiOutput({
    ...extraction(),
    post_classification: "UPDATE_OR_CORRECTION",
    incidents: [extraction({
      update_target_tweet_id: "2073095965696032921",
      disqualifies_prior_incident: true
    }).incidents[0]]
  }, posts);
  const location = resolveSafeLocation(parsed.incidents[0]);
  const safety = publicationSafety(parsed, parsed.incidents[0], location);
  assert.equal(safety.updateOrCorrection, true);
  assert.equal(safety.publish, false);
});

test("a missing location is withheld", () => {
  const parsed = validateGeminiOutput(extraction({
    province: null,
    district: null,
    locality: null,
    location_label: null
  }), posts);
  assert.equal(resolveSafeLocation(parsed.incidents[0]), null);
  assert.equal(publicationSafety(parsed, parsed.incidents[0], null).publish, false);
});

test("a non-Pakistan incident is withheld", () => {
  const parsed = validateGeminiOutput(extraction({
    country: "Iran",
    province: "Sistan and Baluchestan",
    district: "Zahedan"
  }), posts);
  assert.equal(resolveSafeLocation(parsed.incidents[0]), null);
});

test("an ambiguous Pakistan location is withheld instead of using the country centre", () => {
  const parsed = validateGeminiOutput(extraction({
    country: "Pakistan",
    province: "Balochistan",
    district: null,
    locality: "a remote area",
    location_label: "southern region"
  }), posts);
  assert.equal(resolveSafeLocation(parsed.incidents[0]), null);
});

test("a possible duplicate cannot auto-publish", () => {
  const parsed = validateGeminiOutput(extraction(), posts);
  const location = resolveSafeLocation(parsed.incidents[0]);
  assert.equal(publicationSafety(parsed, parsed.incidents[0], location, { id: "existing" }).publish, false);
});

test("Gemini cannot attach an incident to an unknown post ID", () => {
  assert.throws(
    () => validateGeminiOutput(extraction({ source_tweet_id: "111" }), posts),
    /outside the supplied thread/
  );
});

test("OAuth tokens encrypt and decrypt without leaving plaintext", async () => {
  const env = { X_TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" };
  const encrypted = await encryptToken("secret-refresh-token", env);
  assert.doesNotMatch(encrypted, /secret-refresh-token/);
  assert.equal(await decryptToken(encrypted, env), "secret-refresh-token");
});

function lockEnvironment(initialLockedUntil = 0) {
  const state = { ownerId: null, lockedUntil: initialLockedUntil };
  return {
    state,
    env: {
      CONTENT_DB: {
        prepare(sql) {
          return {
            bind(...values) {
              return {
                async run() {
                  let changes = 0;
                  if (sql.includes("locked_until < ?")) {
                    if (state.lockedUntil < values[2]) {
                      state.ownerId = values[0];
                      state.lockedUntil = values[1];
                      changes = 1;
                    }
                  } else if (sql.includes("SET owner_id = NULL")) {
                    if (state.ownerId === values[0]) {
                      state.ownerId = null;
                      state.lockedUntil = 0;
                      changes = 1;
                    }
                  } else if (sql.includes("WHERE name = 'x_to_map' AND owner_id = ?")) {
                    if (state.ownerId === values[1]) {
                      state.lockedUntil = values[0];
                      changes = 1;
                    }
                  }
                  return { meta: { changes } };
                }
              };
            }
          };
        }
      }
    }
  };
}

test("agent lock renewal and release require the same owner lease", async () => {
  const first = lockEnvironment();
  const lease = await acquireAgentLock(first.env);
  assert.ok(lease);
  const oldExpiry = lease.expiresAt;
  await renewAgentLock(first.env, lease);
  assert.ok(lease.expiresAt > oldExpiry);
  assert.equal(first.state.ownerId, lease.owner);
  assert.equal(first.state.lockedUntil, lease.expiresAt);
  assert.equal(await releaseAgentLock(first.env, lease), true);
  assert.equal(first.state.ownerId, null);
  assert.equal(first.state.lockedUntil, 0);

  const second = lockEnvironment();
  const staleLease = await acquireAgentLock(second.env);
  second.state.ownerId = "another-owner";
  second.state.lockedUntil = staleLease.expiresAt + 1;
  assert.equal(await releaseAgentLock(second.env, staleLease), false);
  assert.equal(second.state.ownerId, "another-owner");
});

test("monthly calculations use only supplied published rows and retain uncertainty", () => {
  const rows = [{
    incident_date: null,
    incident_date_source: "unknown",
    tweet_created_at: "2026-07-04T12:00:00.000Z",
    province: "Balochistan",
    district: "Kech",
    incident_type: "Counterterrorism operation",
    category_name: "Counterterrorism operation",
    killed: null,
    injured: 2,
    status: "published"
  }];
  const summary = monthlySummary(rows);
  assert.deepEqual(summary.totals, { incidents: 1, killed: 0, injured: 2 });
  assert.match(buildMonthlyCsv(rows), /unknown/);
});

test("monthly CSV neutralizes spreadsheet formulas in text fields", () => {
  const csv = buildMonthlyCsv([{
    incident_date: "2026-07-04",
    tweet_created_at: "2026-07-04T12:00:00.000Z",
    province: "Balochistan",
    district: "Kech",
    summary: "=HYPERLINK(\"https://example.invalid\",\"click\")",
    status: "published"
  }]);
  assert.match(csv, /'=HYPERLINK/);
});

test("monthly XLSX is a real zip workbook with six sheets", () => {
  const workbook = buildMonthlyWorkbook([], "2026-07");
  const files = unzipSync(workbook);
  const xml = strFromU8(files["xl/workbook.xml"]);
  assert.match(xml, /All Incidents/);
  assert.match(xml, /Monthly Summary/);
  assert.match(xml, /Category Breakdown/);
  assert.equal(Object.keys(files).filter((name) => name.startsWith("xl/worksheets/sheet")).length, 6);
});

test("monthly charts carry the TGD source label", () => {
  const charts = buildMonthlyCharts([], "2026-07");
  assert.equal(charts.length, 6);
  assert.ok(charts.every((chart) => chart.svg.includes("The Global Decipher incident database")));
});

test("monthly runtime probe can benchmark charts or XLSX-only fallback", () => {
  const withCharts = benchmarkMonthlyArtifacts(300, "2026-06", true);
  const withoutCharts = benchmarkMonthlyArtifacts(300, "2026-06", false);
  assert.equal(withCharts.row_count, 300);
  assert.equal(withCharts.chart_count, 6);
  assert.ok(withCharts.xlsx_bytes > 0);
  assert.equal(withoutCharts.chart_count, 0);
  assert.equal(withoutCharts.chart_bytes, 0);
  assert.ok(withoutCharts.xlsx_bytes > 0);
});

test("monthly package writes versioned CSV, XLSX, and six charts to R2", async () => {
  const objects = new Map();
  const inserts = [];
  const row = {
    incident_date: "2026-07-04",
    incident_date_source: "explicit_in_post",
    tweet_created_at: "2026-07-04T12:00:00.000Z",
    province: "Balochistan",
    district: "Kech",
    locality: "Turbat",
    incident_type: "Counterterrorism operation",
    category_name: "Counterterrorism operation",
    killed: 3,
    injured: null,
    actor_or_group: "Security forces",
    summary: "Three terrorists were killed during an operation.",
    source_url: "https://x.com/Global_Decipher/status/2073403718540972192",
    latitude: 26,
    longitude: 63.05,
    status: "published"
  };
  const env = {
    CONTENT_DB: {
      prepare(sql) {
        return {
          bind(...values) {
            return {
              async all() {
                if (sql.includes("FROM incidents")) return { results: [row] };
                throw new Error("Unexpected all query");
              },
              async first() {
                if (sql.includes("MAX(version)")) return { version: 0 };
                throw new Error("Unexpected first query");
              },
              async run() {
                inserts.push({ sql, values });
                return { success: true };
              }
            };
          }
        };
      }
    },
    MEDIA: {
      async put(key, value, options) {
        objects.set(key, { value, options });
      }
    }
  };
  const result = await generateMonthlyDataPackage(env, "2026-07");
  assert.equal(result.version, 1);
  assert.equal(result.incident_count, 1);
  assert.equal(objects.size, 8);
  assert.ok(objects.has("agent-exports/2026-07/v1/tgd-incidents-2026-07.csv"));
  assert.ok(objects.has("agent-exports/2026-07/v1/tgd-incidents-2026-07.xlsx"));
  assert.equal(inserts.length, 1);
});
