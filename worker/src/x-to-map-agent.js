import {
  DISTRICTS,
  loadFeed,
  mergeIncidents,
  pakistanDateFromSeconds,
  saveFeed,
  severityFor,
  validateIncident
} from "./feed.js";
import { baseSecurityHeaders, readJsonLimited } from "./security.js";
import {
  benchmarkMonthlyArtifacts,
  generateMonthlyDataPackage,
  maybeGeneratePreviousMonthPackage,
  monthlySummary
} from "./monthly-data-package.js";

const X_API = "https://api.x.com/2";
const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
const EXPECTED_USERNAME = "Global_Decipher";
const X_TIMELINE_FIELDS = [
  "id",
  "text",
  "created_at",
  "author_id",
  "conversation_id",
  "referenced_tweets"
];
const X_TIMELINE_QUERY_KEYS = new Set([
  "since_id",
  "max_results",
  "exclude",
  "tweet.fields",
  "pagination_token"
]);
const GEMINI_TIMEOUT_MS = 15_000;
const X_TIMEOUT_MS = 10_000;
const MAX_UPSTREAM_BYTES = 1024 * 1024;
const THREAD_IDLE_MS = 3 * 60 * 1000;
const LOCK_SECONDS = 5 * 60;
const POST_CLASSES = [
  "SINGLE_INCIDENT",
  "INCIDENT_THREAD",
  "DAILY_ROUNDUP",
  "INFOGRAPHIC_RECAP",
  "MONTHLY_REPORT",
  "RESEARCH_OR_ARTICLE",
  "CLAIM_OR_STATEMENT",
  "UPDATE_OR_CORRECTION",
  "COMMENTARY",
  "NOT_RELEVANT"
];
const AUTO_PUBLISH_CLASSES = new Set(["SINGLE_INCIDENT", "INCIDENT_THREAD", "DAILY_ROUNDUP"]);
const CONFIDENCE_VALUES = new Set(["high", "medium", "low"]);
const DEFAULT_GLOBAL_INSTRUCTION = [
  "Extract only information explicitly stated in the supplied TGD post or thread.",
  "Do not infer missing facts. Do not create coordinates.",
  "Do not treat allegations or unclear claims as confirmed incidents.",
  "If a location, date, casualty figure, or incident type is unclear, return null and require review.",
  "A missing casualty figure is null; zero is allowed only when the post explicitly says none were reported.",
  "Monthly assessments, reports, research, infographics, commentary, and promotions never create map incidents.",
  "A quoted UPDATE may refer to an existing incident, but material corrections and motive changes require review.",
  "Return only valid JSON."
].join(" ");

const GEMINI_SCHEMA = {
  type: "object",
  properties: {
    post_classification: { type: "string", enum: POST_CLASSES },
    classification_confidence: { type: "string", enum: ["high", "medium", "low"] },
    classification_reason: { type: "string" },
    incidents: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source_tweet_id: { type: "string" },
          incident_date: { type: "string", nullable: true },
          incident_date_source: {
            type: "string",
            enum: ["explicit_in_post", "inferred_from_post_date", "unknown"]
          },
          country: { type: "string", nullable: true },
          province: { type: "string", nullable: true },
          district: { type: "string", nullable: true },
          locality: { type: "string", nullable: true },
          location_label: { type: "string", nullable: true },
          incident_type: { type: "string", nullable: true },
          category: { type: "string", nullable: true },
          summary: { type: "string", nullable: true },
          killed: { type: "integer", nullable: true },
          injured: { type: "integer", nullable: true },
          actor_or_group: { type: "string", nullable: true },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          requires_review: { type: "boolean" },
          reason_for_review: { type: "string", nullable: true },
          update_target_tweet_id: { type: "string", nullable: true },
          disqualifies_prior_incident: { type: "boolean" }
        },
        required: [
          "source_tweet_id",
          "incident_date",
          "incident_date_source",
          "country",
          "province",
          "district",
          "locality",
          "location_label",
          "incident_type",
          "category",
          "summary",
          "killed",
          "injured",
          "actor_or_group",
          "confidence",
          "requires_review",
          "reason_for_review",
          "update_target_tweet_id",
          "disqualifies_prior_incident"
        ]
      }
    }
  },
  required: [
    "post_classification",
    "classification_confidence",
    "classification_reason",
    "incidents"
  ]
};

export class AgentError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

function clean(value, maximum = 20_000) {
  return String(value == null ? "" : value).replace(/\r/g, "").trim().slice(0, maximum);
}

function nullableText(value, maximum = 500) {
  const normalized = clean(value, maximum);
  return normalized || null;
}

function nullableCount(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 100_000) return null;
  return number;
}

function safeJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: baseSecurityHeaders({
      "content-type": "application/json; charset=utf-8",
      ...headers
    })
  });
}

function redirect(location) {
  return new Response(null, {
    status: 302,
    headers: baseSecurityHeaders({ location })
  });
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(digest);
}

function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function encryptionKey(env) {
  const raw = clean(env.X_TOKEN_ENCRYPTION_KEY, 500);
  if (!raw) throw new AgentError("X_TOKEN_ENCRYPTION_KEY is not configured.", 503);
  let bytes;
  if (/^[a-f0-9]{64}$/i.test(raw)) {
    bytes = Uint8Array.from(raw.match(/.{2}/g), (pair) => Number.parseInt(pair, 16));
  } else {
    try {
      bytes = fromBase64Url(raw);
    } catch {
      bytes = new Uint8Array();
    }
  }
  if (bytes.byteLength !== 32) {
    throw new AgentError("X_TOKEN_ENCRYPTION_KEY must be a 32-byte base64url or 64-character hex key.", 503);
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(value, env) {
  if (!value) return null;
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(env),
    new TextEncoder().encode(value)
  );
  return `${base64Url(iv)}.${base64Url(ciphertext)}`;
}

export async function decryptToken(value, env) {
  if (!value) return null;
  const [ivValue, ciphertextValue] = String(value).split(".");
  if (!ivValue || !ciphertextValue) throw new AgentError("Stored X token is invalid.", 500);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(ivValue) },
      await encryptionKey(env),
      fromBase64Url(ciphertextValue)
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new AgentError("Stored X token could not be decrypted.", 500);
  }
}

async function readResponseJsonLimited(response, maximumBytes = MAX_UPSTREAM_BYTES) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new AgentError("An upstream response was too large.", 502);
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel("Response too large");
      throw new AgentError("An upstream response was too large.", 502);
    }
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  try {
    return output ? JSON.parse(output) : null;
  } catch {
    throw new AgentError("An upstream service returned invalid JSON.", 502);
  }
}

async function fetchWithTimeout(url, init, timeoutMs, service) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new AgentError(`${service} timed out.`, 504);
    throw new AgentError(`${service} could not be reached.`, 502);
  } finally {
    clearTimeout(timer);
  }
}

function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

async function metricIncrement(env, key, amount = 1, month = monthKey()) {
  await env.CONTENT_DB.prepare(`
    INSERT INTO agent_metrics(metric_month, metric_key, metric_value, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(metric_month, metric_key)
    DO UPDATE SET metric_value = metric_value + excluded.metric_value, updated_at = datetime('now')
  `).bind(month, key, amount).run();
}

async function logAgent(env, event, message, details = {}, level = "info") {
  await env.CONTENT_DB.prepare(`
    INSERT INTO agent_logs(level, event, message, details_json)
    VALUES (?, ?, ?, ?)
  `).bind(level, event, clean(message, 1000), JSON.stringify(details || {})).run();
}

async function stateGet(env, key, fallback = null) {
  const row = await env.CONTENT_DB.prepare("SELECT value FROM sync_state WHERE key = ?").bind(key).first();
  return row?.value ?? fallback;
}

async function stateSet(env, key, value) {
  await env.CONTENT_DB.prepare(`
    INSERT INTO sync_state(key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).bind(key, String(value)).run();
}

async function stateDelete(env, key) {
  await env.CONTENT_DB.prepare("DELETE FROM sync_state WHERE key = ?").bind(key).run();
}

function compareXIds(left, right) {
  const a = String(left || "").replace(/\D/g, "");
  const b = String(right || "").replace(/\D/g, "");
  return a.length - b.length || a.localeCompare(b);
}

export function highestXId(ids) {
  return ids.filter(Boolean).map(String).sort(compareXIds).at(-1) || null;
}

function oauthRedirectUri(request, env) {
  return clean(env.X_OAUTH_REDIRECT_URI) || `${new URL(request.url).origin}/api/agent/x/callback`;
}

async function exchangeXToken(body, env) {
  if (!env.X_CLIENT_ID || !env.X_CLIENT_SECRET) {
    throw new AgentError("X_CLIENT_ID and X_CLIENT_SECRET are not configured.", 503);
  }
  const response = await fetchWithTimeout(X_TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`)}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json"
    },
    body: new URLSearchParams(body).toString()
  }, X_TIMEOUT_MS, "X OAuth");
  const data = await readResponseJsonLimited(response);
  if (!response.ok || !data?.access_token) {
    throw new AgentError(`X OAuth failed (${response.status}).`, response.status === 400 ? 400 : 502);
  }
  return data;
}

async function saveXTokens(env, token) {
  const expiresIn = Math.max(60, Number(token.expires_in) || 7200);
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  await env.CONTENT_DB.prepare(`
    INSERT INTO x_oauth_tokens(
      id, access_token_encrypted, refresh_token_encrypted, token_type, scope, expires_at, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      access_token_encrypted = excluded.access_token_encrypted,
      refresh_token_encrypted = COALESCE(excluded.refresh_token_encrypted, x_oauth_tokens.refresh_token_encrypted),
      token_type = excluded.token_type,
      scope = excluded.scope,
      expires_at = excluded.expires_at,
      updated_at = datetime('now')
  `).bind(
    await encryptToken(token.access_token, env),
    await encryptToken(token.refresh_token, env),
    clean(token.token_type || "bearer", 30),
    clean(token.scope, 300),
    expiresAt
  ).run();
}

async function currentAccessToken(env, forceRefresh = false) {
  const row = await env.CONTENT_DB.prepare("SELECT * FROM x_oauth_tokens WHERE id = 1").first();
  if (!row) throw new AgentError("Connect @Global_Decipher to X before starting the agent.", 409);
  const expiresAt = new Date(row.expires_at).getTime();
  if (!forceRefresh && expiresAt > Date.now() + 60_000) {
    return decryptToken(row.access_token_encrypted, env);
  }
  const refreshToken = await decryptToken(row.refresh_token_encrypted, env);
  if (!refreshToken) throw new AgentError("The X connection expired and has no refresh token.", 409);
  const refreshed = await exchangeXToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env.X_CLIENT_ID
  }, env);
  await saveXTokens(env, refreshed);
  return refreshed.access_token;
}

export function validateXApiRequestPath(path) {
  const requestPath = clean(path, 2048);
  let url;
  try {
    url = new URL(`${X_API}${requestPath}`);
  } catch {
    throw new AgentError("Blocked an invalid X API request.", 500);
  }
  if (url.origin !== "https://api.x.com") {
    throw new AgentError("Blocked an X API request outside the approved host.", 500);
  }
  if (url.pathname === "/2/users/me") {
    if ([...url.searchParams].length) {
      throw new AgentError("GET /2/users/me does not permit extra query parameters.", 500);
    }
    return { kind: "me", userId: null, url: url.toString() };
  }
  const timeline = url.pathname.match(/^\/2\/users\/(\d{1,20})\/tweets$/);
  if (!timeline) {
    throw new AgentError("Blocked an X API endpoint outside the TGD-owned timeline allowlist.", 500);
  }
  for (const key of url.searchParams.keys()) {
    if (!X_TIMELINE_QUERY_KEYS.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new AgentError(`Blocked unapproved X timeline parameter: ${key}.`, 500);
    }
  }
  if (url.searchParams.has("exclude") && url.searchParams.get("exclude") !== "retweets") {
    throw new AgentError("Only retweet exclusion is approved for the X timeline.", 500);
  }
  if (url.searchParams.has("since_id") && !/^\d{1,20}$/.test(url.searchParams.get("since_id"))) {
    throw new AgentError("Blocked an invalid X timeline cursor.", 500);
  }
  if (url.searchParams.has("max_results")) {
    const maximum = Number(url.searchParams.get("max_results"));
    if (!Number.isInteger(maximum) || maximum < 5 || maximum > 100) {
      throw new AgentError("Blocked an invalid X timeline result limit.", 500);
    }
  }
  const fields = (url.searchParams.get("tweet.fields") || "")
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  if (fields.some((field) => !X_TIMELINE_FIELDS.includes(field))) {
    throw new AgentError("Blocked unapproved X timeline fields or expansions.", 500);
  }
  return { kind: "timeline", userId: timeline[1], url: url.toString() };
}

async function xApiRequest(env, path, retryAuth = true) {
  const approved = validateXApiRequestPath(path);
  if (approved.kind === "timeline") {
    const connectedUserId = await stateGet(env, "x_user_id", "");
    if (!connectedUserId || approved.userId !== connectedUserId) {
      throw new AgentError("Blocked an X timeline request for an account other than the connected TGD account.", 500);
    }
  }
  const token = await currentAccessToken(env);
  const response = await fetchWithTimeout(approved.url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" }
  }, X_TIMEOUT_MS, "X API");
  if (response.status === 401 && retryAuth) {
    await currentAccessToken(env, true);
    return xApiRequest(env, path, false);
  }
  const data = await readResponseJsonLimited(response);
  if (!response.ok) {
    const error = new AgentError(
      response.status === 429 ? "X API rate limit reached; the cursor was not moved." : `X API request failed (${response.status}).`,
      response.status === 429 ? 429 : 502
    );
    error.retryAfter = response.headers.get("x-rate-limit-reset");
    throw error;
  }
  return data || {};
}

export async function beginXOAuth(request, env) {
  const state = randomToken(32);
  const verifier = randomToken(48);
  const challenge = await sha256(verifier);
  await stateSet(env, `x_oauth_state:${state}`, JSON.stringify({
    verifier,
    expires_at: Date.now() + 10 * 60 * 1000,
    redirect_uri: oauthRedirectUri(request, env)
  }));
  const url = new URL(X_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.X_CLIENT_ID || "");
  url.searchParams.set("redirect_uri", oauthRedirectUri(request, env));
  url.searchParams.set("scope", "tweet.read users.read offline.access");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { authorization_url: url.toString() };
}

export async function completeXOAuth(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) throw new AgentError(`X authorization was cancelled: ${oauthError}.`, 400);
  if (!code || !state) throw new AgentError("X authorization callback is incomplete.", 400);
  const stateKey = `x_oauth_state:${state}`;
  const stored = safeJson(await stateGet(env, stateKey, ""), null);
  await stateDelete(env, stateKey);
  if (!stored || stored.expires_at < Date.now()) throw new AgentError("X authorization session expired.", 400);

  const token = await exchangeXToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: stored.redirect_uri,
    code_verifier: stored.verifier,
    client_id: env.X_CLIENT_ID
  }, env);
  await saveXTokens(env, token);
  const me = await xApiRequest(env, "/users/me");
  const username = clean(me?.data?.username, 100);
  if (username.toLowerCase() !== EXPECTED_USERNAME.toLowerCase()) {
    await env.CONTENT_DB.prepare("DELETE FROM x_oauth_tokens WHERE id = 1").run();
    throw new AgentError(`Connected X account is @${username || "unknown"}, not @${EXPECTED_USERNAME}.`, 403);
  }
  const userId = clean(me?.data?.id, 30);
  if (!/^\d{1,20}$/.test(userId)) throw new AgentError("X did not return a valid account ID.", 502);
  await stateSet(env, "x_user_id", userId);
  await stateSet(env, "x_username", username);

  // Seed the cursor from only the latest few posts. Nothing is imported.
  const latest = await xApiRequest(
    env,
    `/users/${encodeURIComponent(userId)}/tweets?max_results=5&exclude=retweets&tweet.fields=id,created_at`
  );
  const cursor = highestXId((latest.data || []).map((post) => post.id));
  if (cursor) await stateSet(env, "last_tweet_id", cursor);
  await stateSet(env, "last_x_post_detected", cursor || "");
  await logAgent(env, "x_connected", `Connected @${username}; live cursor seeded without importing old posts.`, {
    user_id: userId,
    cursor
  });
  return { username, user_id: userId, cursor };
}

export function normalizeXPost(post) {
  const id = clean(post?.id, 30);
  const authorId = clean(post?.author_id, 30);
  const conversationId = clean(post?.conversation_id || id, 30);
  if (!/^\d{1,20}$/.test(id)) return null;
  const references = Array.isArray(post?.referenced_tweets) ? post.referenced_tweets : [];
  const parent = references.find((reference) => reference.type === "replied_to")?.id || null;
  return {
    x_post_id: id,
    conversation_id: conversationId || id,
    parent_post_id: parent,
    raw_text: clean(post?.text, 20_000),
    raw_json: JSON.stringify(post),
    referenced_tweets_json: JSON.stringify(references),
    created_at: clean(post?.created_at, 40) || new Date().toISOString(),
    post_url: `https://x.com/${EXPECTED_USERNAME}/status/${id}`,
    author_id: authorId
  };
}

async function storeXPostsAndCursor(env, posts) {
  if (!posts.length) return null;
  const statements = posts.map((post) => env.CONTENT_DB.prepare(`
    INSERT INTO x_posts(
      x_post_id, conversation_id, parent_post_id, raw_text, raw_json,
      referenced_tweets_json, created_at, post_url, processing_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'stored')
    ON CONFLICT(x_post_id) DO NOTHING
  `).bind(
    post.x_post_id,
    post.conversation_id,
    post.parent_post_id,
    post.raw_text,
    post.raw_json,
    post.referenced_tweets_json,
    post.created_at,
    post.post_url
  ));
  const cursor = highestXId(posts.map((post) => post.x_post_id));
  statements.push(env.CONTENT_DB.prepare(`
    INSERT INTO sync_state(key, value, updated_at)
    VALUES ('last_tweet_id', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).bind(cursor));
  await env.CONTENT_DB.batch(statements);
  return cursor;
}

async function fetchNewXPosts(env) {
  const userId = await stateGet(env, "x_user_id");
  const cursor = await stateGet(env, "last_tweet_id");
  if (!userId) throw new AgentError("The X account is not connected.", 409);
  if (!cursor) throw new AgentError("The live X cursor has not been initialized.", 409);
  const fields = X_TIMELINE_FIELDS.join(",");
  const params = new URLSearchParams({
    since_id: cursor,
    max_results: "100",
    exclude: "retweets",
    "tweet.fields": fields
  });
  const returned = [];
  let nextToken = "";
  for (let page = 0; page < 10; page += 1) {
    if (nextToken) params.set("pagination_token", nextToken);
    const response = await xApiRequest(
      env,
      `/users/${encodeURIComponent(userId)}/tweets?${params.toString()}`
    );
    returned.push(...(response.data || []));
    nextToken = clean(response?.meta?.next_token, 200);
    if (!nextToken) break;
  }
  const posts = returned
    .map(normalizeXPost)
    .filter((post) => post && (!post.author_id || post.author_id === userId))
    .sort((left, right) => compareXIds(left.x_post_id, right.x_post_id));
  if (!posts.length) return { posts: [], cursor };
  const newCursor = await storeXPostsAndCursor(env, posts);
  await metricIncrement(env, "x_posts_read", posts.length);
  await stateSet(env, "last_x_post_detected", newCursor);
  return { posts, cursor: newCursor };
}

function builtInExamples() {
  return [
    {
      pattern: "BREAKING or NEWS ALERT describes one attack or security operation at a named Pakistan location.",
      decision: "SINGLE_INCIDENT; extract one incident if the facts and location are clear."
    },
    {
      pattern: "UPDATE quote-post changes casualties or attribution for a previously posted incident.",
      decision: "UPDATE_OR_CORRECTION; link to the earlier source and require review for material changes."
    },
    {
      pattern: "Later post says an apparent killing was caused by professional rivalry or a business dispute.",
      decision: "UPDATE_OR_CORRECTION; disqualifying motive requires review and must not create a terrorism marker."
    },
    {
      pattern: "Pakistan Monthly Terrorism and Counter Terrorism Assessment or a research publication.",
      decision: "MONTHLY_REPORT or RESEARCH_OR_ARTICLE; zero new map incidents."
    },
    {
      pattern: "Several clearly separate events are listed in one post or thread.",
      decision: "DAILY_ROUNDUP; return one structured incident object per distinct event."
    }
  ];
}

async function promptContext(env) {
  const [rules, examples, categories] = await Promise.all([
    env.CONTENT_DB.prepare(`
      SELECT title, rule_text, rule_type, province
      FROM agent_rules WHERE active = 1 ORDER BY id LIMIT 80
    `).all(),
    env.CONTENT_DB.prepare(`
      SELECT original_agent_output, owner_correction, owner_reason
      FROM correction_examples
      WHERE approved_for_future_prompt = 1
      ORDER BY id DESC LIMIT 12
    `).all(),
    env.CONTENT_DB.prepare(`
      SELECT category_name FROM incident_categories
      WHERE active = 1 ORDER BY sort_order, category_name
    `).all()
  ]);
  const globalRules = (rules.results || []).filter((rule) => rule.rule_type === "global_instruction");
  return {
    globalInstruction: [
      DEFAULT_GLOBAL_INSTRUCTION,
      ...globalRules.map((rule) => clean(rule.rule_text, 3000)).filter(Boolean)
    ].join("\n"),
    rules: rules.results || [],
    corrections: examples.results || [],
    categories: (categories.results || []).map((row) => row.category_name),
    builtInExamples: builtInExamples()
  };
}

function geminiPrompt(posts, context) {
  return [
    "You classify and extract incident data from posts published by The Global Decipher (@Global_Decipher).",
    context.globalInstruction,
    "",
    "TGD-specific examples:",
    JSON.stringify(context.builtInExamples),
    "",
    "Owner-approved rules:",
    JSON.stringify(context.rules),
    "",
    "Owner-approved correction examples:",
    JSON.stringify(context.corrections),
    "",
    `Allowed category labels: ${context.categories.join(", ")}.`,
    "If no allowed category is exact, use Security incident.",
    "A source_tweet_id must be one of the supplied post IDs.",
    "Create incidents only for posts whose processing_status is not processed. Processed posts are thread context only.",
    "For an incident inferred to occur on the post date, set incident_date_source to inferred_from_post_date.",
    "For a full thread, create separate incident objects only when the thread clearly describes distinct events.",
    "",
    "Posts (oldest to newest):",
    JSON.stringify(posts.map((post) => ({
      id: post.x_post_id,
      created_at: post.created_at,
      conversation_id: post.conversation_id,
      parent_post_id: post.parent_post_id,
      processing_status: post.processing_status,
      referenced_tweets: safeJson(post.referenced_tweets_json, []),
      text: post.raw_text
    })))
  ].join("\n");
}

async function callGemini(env, posts, context = null) {
  if (!env.GEMINI_API_KEY) throw new AgentError("GEMINI_API_KEY is not configured.", 503);
  const model = clean(env.INCIDENT_GEMINI_MODEL || env.GEMINI_MODEL || "gemini-2.5-flash", 100);
  const prompt = context || await promptContext(env);
  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: "You are TGD's conservative incident-data formatter. Accuracy is more important than inclusion." }]
        },
        contents: [{ role: "user", parts: [{ text: geminiPrompt(posts, prompt) }] }],
        generationConfig: {
          temperature: 0.05,
          maxOutputTokens: 5000,
          responseMimeType: "application/json",
          responseSchema: GEMINI_SCHEMA
        }
      })
    },
    GEMINI_TIMEOUT_MS,
    "Gemini"
  );
  const data = await readResponseJsonLimited(response);
  if (!response.ok) {
    throw new AgentError(
      response.status === 429 ? "Gemini allowance is temporarily exhausted." : `Gemini extraction failed (${response.status}).`,
      response.status === 429 ? 429 : 502
    );
  }
  const raw = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  if (!raw) throw new AgentError("Gemini returned no structured result.", 502);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AgentError("Gemini returned invalid JSON.", 502);
  }
  await metricIncrement(env, "gemini_calls", 1);
  return validateGeminiOutput(parsed, posts);
}

export function validateGeminiOutput(value, posts) {
  if (!value || typeof value !== "object") throw new AgentError("Gemini result is not an object.", 502);
  const postIds = new Set(posts.map((post) => String(post.x_post_id)));
  const classification = POST_CLASSES.includes(value.post_classification)
    ? value.post_classification
    : "NOT_RELEVANT";
  const confidence = CONFIDENCE_VALUES.has(value.classification_confidence)
    ? value.classification_confidence
    : "low";
  const incidents = (Array.isArray(value.incidents) ? value.incidents : []).slice(0, 30).map((incident) => {
    const sourceTweetId = clean(incident?.source_tweet_id, 30);
    const rawIncidentDate = clean(incident?.incident_date, 40);
    const incidentDate = realIsoDate(rawIncidentDate);
    if (!postIds.has(sourceTweetId)) throw new AgentError("Gemini referenced a post outside the supplied thread.", 502);
    return {
      source_tweet_id: sourceTweetId,
      incident_date: incidentDate,
      incident_date_invalid: Boolean(rawIncidentDate && !incidentDate),
      incident_date_source: ["explicit_in_post", "inferred_from_post_date", "unknown"].includes(incident.incident_date_source)
        ? incident.incident_date_source
        : "unknown",
      country: nullableText(incident.country, 100),
      province: nullableText(incident.province, 100),
      district: nullableText(incident.district, 100),
      locality: nullableText(incident.locality, 160),
      location_label: nullableText(incident.location_label, 200),
      incident_type: nullableText(incident.incident_type, 120),
      category: nullableText(incident.category, 120),
      summary: nullableText(incident.summary, 900),
      killed: nullableCount(incident.killed),
      injured: nullableCount(incident.injured),
      actor_or_group: nullableText(incident.actor_or_group, 180),
      confidence: CONFIDENCE_VALUES.has(incident.confidence) ? incident.confidence : "low",
      requires_review: incident.requires_review === true,
      reason_for_review: nullableText(incident.reason_for_review, 500),
      update_target_tweet_id: nullableText(incident.update_target_tweet_id, 30),
      disqualifies_prior_incident: incident.disqualifies_prior_incident === true
    };
  });
  return {
    post_classification: classification,
    classification_confidence: confidence,
    classification_reason: clean(value.classification_reason, 700),
    incidents
  };
}

function normalizeLocationText(value) {
  return clean(value, 200).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function realIsoDate(value) {
  const normalized = clean(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) return null;
  return normalized;
}

function normalizedProvince(value) {
  const normalized = normalizeLocationText(value);
  const compact = normalized.replace(/\s+/g, "");
  if (["kp", "kpk", "khyberpakhtunkhwa", "northwestfrontierprovince", "nwfp"].includes(compact)) {
    return "khyber pakhtunkhwa";
  }
  if (["balochistan", "baluchistan"].includes(compact)) return "balochistan";
  if (["gb", "gilgitbaltistan"].includes(compact)) return "gilgit baltistan";
  if (["ict", "islamabadcapitalterritory", "islamabad"].includes(compact)) return "islamabad";
  return normalized;
}

function locationMatches(item, value) {
  const haystack = ` ${normalizeLocationText(value)} `;
  const district = normalizeLocationText(item.district);
  if (district && haystack.includes(` ${district} `)) return true;
  return item.terms.some((term) => {
    const normalized = normalizeLocationText(term);
    return normalized && haystack.includes(` ${normalized} `);
  });
}

export function resolveSafeLocation(incident) {
  const country = normalizeLocationText(incident.country);
  if (country !== "pakistan") return null;
  const districtText = normalizeLocationText(incident.district);
  const localityText = normalizeLocationText(incident.locality);
  const locationText = normalizeLocationText(incident.location_label);
  if (!districtText && !localityText && !locationText) return null;
  const expectedProvince = normalizedProvince(incident.province);
  const directDistrict = DISTRICTS.filter((item) => locationMatches(item, districtText));
  const localityMatches = DISTRICTS.filter((item) => (
    locationMatches(item, localityText) || locationMatches(item, locationText)
  ));
  const candidates = directDistrict.length ? directDistrict : localityMatches;
  const provinceSafe = candidates.filter((item) => (
    !expectedProvince || normalizedProvince(item.province) === expectedProvince
  ));
  const unique = new Map(provinceSafe.map((item) => [item.district, item]));
  if (unique.size !== 1) return null;
  const matched = [...unique.values()][0];
  return {
    country: "Pakistan",
    province: matched.province,
    district: matched.district,
    locality: incident.locality,
    location_label: incident.location_label || [incident.locality, matched.district].filter(Boolean).join(", "),
    latitude: matched.lat,
    longitude: matched.lng,
    location_precision: "district-centroid"
  };
}

function rulePhrases(ruleText) {
  return clean(ruleText, 3000)
    .split(/[\n,;]+/)
    .map((value) => normalizeLocationText(value))
    .filter((value) => value.length >= 3);
}

export function evaluateOwnerRules(rules, post, decision) {
  const active = Array.isArray(rules) ? rules : [];
  const searchable = normalizeLocationText([
    post?.raw_text,
    decision?.summary,
    decision?.incident_type,
    decision?.province,
    decision?.district,
    decision?.locality
  ].filter(Boolean).join(" "));
  const province = normalizedProvince(decision?.province);
  const reviewRules = [];
  const ignoreRules = [];
  for (const rule of active) {
    const type = clean(rule?.rule_type, 80);
    if (type === "province_review") {
      const ruleProvince = normalizedProvince(rule?.province || rule?.rule_text);
      if (ruleProvince && ruleProvince === province) reviewRules.push(rule);
      continue;
    }
    if (type !== "always_review" && type !== "ignore") continue;
    if (!rulePhrases(rule?.rule_text).some((phrase) => searchable.includes(phrase))) continue;
    if (type === "ignore") ignoreRules.push(rule);
    else reviewRules.push(rule);
  }
  return {
    ignore: ignoreRules.length > 0,
    requiresReview: reviewRules.length > 0,
    reasons: [
      ...ignoreRules.map((rule) => `Owner rule “${clean(rule.title, 160) || clean(rule.rule_text, 120)}” ignores this post.`),
      ...reviewRules.map((rule) => `Owner rule “${clean(rule.title, 160) || clean(rule.rule_text, 120)}” requires review.`)
    ]
  };
}

function normalizedWords(value) {
  const stop = new Set(["the", "a", "an", "in", "at", "on", "of", "and", "to", "for", "with", "after", "during"]);
  return new Set(normalizeLocationText(value).split(" ").filter((word) => word.length > 2 && !stop.has(word)));
}

function similarity(left, right) {
  const a = normalizedWords(left);
  const b = normalizedWords(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const value of a) if (b.has(value)) overlap += 1;
  return overlap / Math.max(a.size, b.size);
}

async function incidentFingerprint(incident, location) {
  return sha256([
    incident.incident_date || "",
    location.province,
    location.district,
    incident.locality || "",
    incident.incident_type || "",
    [...normalizedWords(incident.summary || "")].sort().slice(0, 16).join(" ")
  ].join("|"));
}

async function duplicateCandidate(env, incident, location, fingerprint, excludeId = null) {
  const rows = await env.CONTENT_DB.prepare(`
    SELECT id, fingerprint, incident_date, incident_type, killed, injured, summary
    FROM incidents
    WHERE status IN ('published', 'needs_review', 'possible_duplicate')
      AND province = ?
      AND district = ?
      AND (? IS NULL OR id != ?)
      AND COALESCE(incident_date, substr(tweet_created_at, 1, 10)) >= date('now', '-14 day')
    ORDER BY updated_at DESC
    LIMIT 40
  `).bind(location.province, location.district, excludeId, excludeId).all();
  for (const row of rows.results || []) {
    if (row.fingerprint === fingerprint) return row;
    const typeMatches = normalizeLocationText(row.incident_type) === normalizeLocationText(incident.incident_type);
    const casualtyMatches = (
      (row.killed == null || incident.killed == null || Number(row.killed) === incident.killed)
      && (row.injured == null || incident.injured == null || Number(row.injured) === incident.injured)
    );
    if (typeMatches && casualtyMatches && similarity(row.summary, incident.summary) >= 0.62) return row;
  }
  return null;
}

function categoryName(category, allowed) {
  const wanted = clean(category, 120);
  return allowed.includes(wanted) ? wanted : "Security incident";
}

async function insertIncident(env, post, decision, extraction, allowedCategories, rules = [], existingId = null) {
  const location = resolveSafeLocation(decision);
  const postDate = realIsoDate(clean(post.created_at, 40).slice(0, 10));
  const fingerprint = location ? await incidentFingerprint(decision, location) : await sha256(
    `${decision.source_tweet_id}|${decision.summary || ""}|${crypto.randomUUID()}`
  );
  const duplicate = location ? await duplicateCandidate(env, decision, location, fingerprint, existingId) : null;
  const ownerRules = evaluateOwnerRules(rules, post, decision);
  const safety = publicationSafety(extraction, decision, location, duplicate, {
    postDate,
    ownerRules
  });
  const classificationAllowed = safety.classificationAllowed;
  const updateOrCorrection = safety.updateOrCorrection;
  const publish = safety.publish;
  const status = ownerRules.ignore
    ? "rejected"
    : duplicate
      ? "possible_duplicate"
      : publish
        ? "published"
        : "needs_review";
  const reasons = [
    decision.reason_for_review,
    !location ? "Location could not be matched to the vetted Pakistan district gazetteer." : null,
    !classificationAllowed ? `Post class ${extraction.post_classification} is not eligible for automatic publication.` : null,
    extraction.classification_confidence !== "high" ? "Post classification confidence is not high." : null,
    decision.confidence !== "high" ? "Incident extraction confidence is not high." : null,
    !safety.dateValid ? "Incident date is invalid or later than the source post date." : null,
    updateOrCorrection ? "Updates and corrections require review before changing an existing public record." : null,
    duplicate ? `Possible duplicate of ${duplicate.id}.` : null,
    ...ownerRules.reasons
  ].filter(Boolean);
  const incidentDate = decision.incident_date
    || (decision.incident_date_source === "inferred_from_post_date" ? postDate : null);
  const id = existingId || crypto.randomUUID();
  const category = categoryName(decision.category, allowedCategories);
  await env.CONTENT_DB.batch([
    env.CONTENT_DB.prepare(`
      INSERT INTO incidents(
        id, fingerprint, source_tweet_id, source_url, source_text, tweet_created_at,
        incident_date, incident_date_source, country, province, district, locality,
        location_label, latitude, longitude, location_precision, incident_type,
        category_name, summary, killed, injured, actor_or_group, confidence, status,
        review_reason, duplicate_of, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        fingerprint = excluded.fingerprint,
        source_tweet_id = excluded.source_tweet_id,
        source_url = excluded.source_url,
        source_text = excluded.source_text,
        tweet_created_at = excluded.tweet_created_at,
        incident_date = excluded.incident_date,
        incident_date_source = excluded.incident_date_source,
        country = excluded.country,
        province = excluded.province,
        district = excluded.district,
        locality = excluded.locality,
        location_label = excluded.location_label,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        location_precision = excluded.location_precision,
        incident_type = excluded.incident_type,
        category_name = excluded.category_name,
        summary = excluded.summary,
        killed = excluded.killed,
        injured = excluded.injured,
        actor_or_group = excluded.actor_or_group,
        confidence = excluded.confidence,
        status = excluded.status,
        review_reason = excluded.review_reason,
        duplicate_of = excluded.duplicate_of,
        published_at = excluded.published_at,
        updated_at = datetime('now')
    `).bind(
      id,
      fingerprint,
      decision.source_tweet_id,
      post.post_url,
      post.raw_text,
      post.created_at,
      incidentDate,
      decision.incident_date_source,
      location?.country || decision.country,
      location?.province || decision.province,
      location?.district || decision.district,
      location?.locality || decision.locality,
      location?.location_label || decision.location_label,
      location?.latitude ?? null,
      location?.longitude ?? null,
      location?.location_precision || null,
      decision.incident_type,
      category,
      decision.summary,
      decision.killed,
      decision.injured,
      decision.actor_or_group,
      decision.confidence,
      status,
      reasons.join(" "),
      duplicate?.id || null,
      publish ? new Date().toISOString() : null
    ),
    env.CONTENT_DB.prepare(`
      INSERT OR IGNORE INTO incident_sources(incident_id, x_post_id, source_role)
      VALUES (?, ?, ?)
    `).bind(
      id,
      decision.source_tweet_id,
      extraction.post_classification === "UPDATE_OR_CORRECTION" ? "update" : "primary"
    )
  ]);
  return { id, status };
}

export function publicationSafety(extraction, decision, location, duplicate = null, options = {}) {
  const classificationAllowed = AUTO_PUBLISH_CLASSES.has(extraction.post_classification);
  const explicitDate = decision.incident_date ? realIsoDate(decision.incident_date) : null;
  const postDate = options.postDate ? realIsoDate(options.postDate) : null;
  const dateValid = Boolean(
    !decision.incident_date_invalid
    && ((explicitDate && (!postDate || explicitDate <= postDate))
    || (!decision.incident_date && decision.incident_date_source === "inferred_from_post_date" && postDate)
    || (!options.postDate && explicitDate))
  );
  const hasMinimumFacts = Boolean(
    location
    && decision.incident_type
    && decision.summary
    && dateValid
  );
  const updateOrCorrection = extraction.post_classification === "UPDATE_OR_CORRECTION"
    || decision.disqualifies_prior_incident;
  const publish = (
    classificationAllowed
    && extraction.classification_confidence === "high"
    && decision.confidence === "high"
    && decision.requires_review !== true
    && hasMinimumFacts
    && !duplicate
    && !updateOrCorrection
    && options.ownerRules?.ignore !== true
    && options.ownerRules?.requiresReview !== true
  );
  return { publish, classificationAllowed, hasMinimumFacts, updateOrCorrection, dateValid };
}

async function processConversation(env, posts) {
  const context = await promptContext(env);
  const extraction = await callGemini(env, posts, context);
  const allowed = context.categories;
  const byId = new Map(posts.map((post) => [String(post.x_post_id), post]));
  const reusableByPost = new Map();
  for (const post of posts.filter((item) => item.processing_status === "pending_retry")) {
    const rows = await env.CONTENT_DB.prepare(`
      SELECT id FROM incidents
      WHERE source_tweet_id = ? AND status IN ('needs_review', 'possible_duplicate', 'failed')
      ORDER BY created_at, id
    `).bind(post.x_post_id).all();
    reusableByPost.set(String(post.x_post_id), (rows.results || []).map((row) => row.id));
  }
  const created = [];
  for (const decision of extraction.incidents) {
    const post = byId.get(decision.source_tweet_id);
    if (!post) continue;
    const reusable = reusableByPost.get(decision.source_tweet_id) || [];
    const existingId = reusable.shift() || null;
    created.push(await insertIncident(env, post, decision, extraction, allowed, context.rules, existingId));
  }
  const superseded = [...reusableByPost.values()].flat();
  if (superseded.length) {
    const placeholders = superseded.map(() => "?").join(", ");
    await env.CONTENT_DB.prepare(`
      UPDATE incidents
      SET status = 'superseded',
          review_reason = trim(COALESCE(review_reason, '') || ' Superseded by owner-requested Gemini retry.'),
          updated_at = datetime('now')
      WHERE id IN (${placeholders})
    `).bind(...superseded).run();
  }
  await env.CONTENT_DB.batch(posts.map((post) => env.CONTENT_DB.prepare(`
    UPDATE x_posts
    SET classification = ?, classification_confidence = ?, processing_status = 'processed',
        error_message = NULL, gemini_output = ?, updated_at_system = datetime('now')
    WHERE x_post_id = ?
  `).bind(
    extraction.post_classification,
    extraction.classification_confidence,
    JSON.stringify(extraction),
    post.x_post_id
  )));
  return { extraction, created };
}

function isSelfReply(post, userId) {
  const raw = safeJson(post.raw_json, {});
  return Boolean(post.parent_post_id && clean(raw?.in_reply_to_user_id, 30) === String(userId));
}

export function conversationReady(posts, userId, now = Date.now()) {
  const newest = Math.max(...posts.map((post) => new Date(post.created_at).getTime()).filter(Number.isFinite));
  const containsSelfReply = posts.some((post) => isSelfReply(post, userId));
  return !containsSelfReply || newest <= now - THREAD_IDLE_MS;
}

async function processPendingPosts(env, keepLock = null) {
  const pending = await env.CONTENT_DB.prepare(`
    SELECT * FROM x_posts
    WHERE processing_status IN ('stored', 'pending_retry', 'waiting_thread')
    ORDER BY created_at, x_post_id
    LIMIT 100
  `).all();
  const pendingRows = pending.results || [];
  if (!pendingRows.length) return { processed_posts: 0, published: 0, review: 0, ignored: 0 };
  const userId = await stateGet(env, "x_user_id", "");
  const conversationIds = [...new Set(pendingRows.map((post) => post.conversation_id || post.x_post_id))];
  let processedPosts = 0;
  let published = 0;
  let review = 0;
  let ignored = 0;
  for (const conversationId of conversationIds) {
    if (keepLock) await keepLock();
    const result = await env.CONTENT_DB.prepare(`
      SELECT * FROM x_posts WHERE conversation_id = ? ORDER BY created_at, x_post_id
    `).bind(conversationId).all();
    const posts = result.results || [];
    if (!conversationReady(posts, userId)) {
      await env.CONTENT_DB.prepare(`
        UPDATE x_posts SET processing_status = 'waiting_thread', updated_at_system = datetime('now')
        WHERE conversation_id = ? AND processing_status != 'processed'
      `).bind(conversationId).run();
      continue;
    }
    try {
      const completed = await processConversation(env, posts);
      processedPosts += posts.length;
      for (const item of completed.created) {
        if (item.status === "published") published += 1;
        else if (item.status === "rejected") ignored += 1;
        else review += 1;
      }
      if (!completed.created.length) ignored += posts.length;
    } catch (error) {
      await env.CONTENT_DB.prepare(`
        UPDATE x_posts
        SET processing_status = 'pending_retry', error_message = ?, updated_at_system = datetime('now')
        WHERE conversation_id = ? AND processing_status != 'processed'
      `).bind(clean(error?.message || error, 500), conversationId).run();
      await metricIncrement(env, "errors", 1);
      await logAgent(env, "processing_failed", error?.message || String(error), { conversation_id: conversationId }, "error");
    }
  }
  return { processed_posts: processedPosts, published, review, ignored };
}

function publicIncident(row) {
  const fatalities = row.killed == null ? null : Number(row.killed);
  const injuries = row.injured == null ? null : Number(row.injured);
  return {
    id: row.id,
    date: row.incident_date || clean(row.tweet_created_at, 40).slice(0, 10),
    date_source: row.incident_date_source,
    reported_at: row.tweet_created_at,
    time_label: row.incident_date ? "Incident date" : "TGD post date",
    title: clean(row.summary, 180) || `${row.incident_type || "Security incident"} in ${row.district || "Pakistan"}`,
    district: row.district,
    province: row.province,
    country: row.country,
    locality: row.locality,
    location_label: row.location_label,
    lat: Number(row.latitude),
    lng: Number(row.longitude),
    location_precision: row.location_precision,
    category: row.category_name || "Security incident",
    incident_type: row.incident_type,
    actor: row.actor_or_group || "Unidentified",
    status: "Initial report",
    severity: severityFor(fatalities || 0, injuries || 0),
    fatalities,
    injuries,
    summary: row.summary,
    source: "TGD X",
    source_url: row.source_url,
    source_tweet_id: row.source_tweet_id,
    verified: false,
    automated: true,
    ingestion_source: "x-api-gemini",
    published_at: row.published_at,
    updated_at: row.updated_at
  };
}

async function syncPublishedFeed(env) {
  const rows = await env.CONTENT_DB.prepare(`
    SELECT * FROM incidents WHERE status = 'published' ORDER BY COALESCE(incident_date, tweet_created_at) DESC
  `).all();
  const feed = await loadFeed(env);
  const curated = (feed.incidents || []).filter((incident) => incident.ingestion_source !== "x-api-gemini");
  feed.incidents = mergeIncidents(
    curated,
    (rows.results || []).map(publicIncident),
    pakistanDateFromSeconds()
  );
  feed.last_updated = new Date().toISOString();
  feed.time_zone = "Asia/Karachi";
  await saveFeed(env, feed);
  await stateSet(env, "last_map_update", feed.last_updated);
  return feed;
}

export async function updatePublishedAgentIncidents(env, candidates) {
  const ids = [...new Set((candidates || []).map((incident) => clean(incident?.id, 60)).filter(Boolean))];
  if (!ids.length) return new Set();
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await env.CONTENT_DB.prepare(`
    SELECT * FROM incidents WHERE status = 'published' AND id IN (${placeholders})
  `).bind(...ids).all();
  const existingById = new Map((rows.results || []).map((row) => [row.id, row]));
  const updates = [];
  for (const incident of candidates || []) {
    const existing = existingById.get(clean(incident?.id, 60));
    if (!existing) continue;
    const errors = validateIncident(incident);
    if (errors.length) throw new AgentError(errors.join(" "), 400);
    const incidentDate = realIsoDate(incident.date);
    const reportedDate = realIsoDate(clean(existing.tweet_created_at, 40).slice(0, 10));
    if (!incidentDate || (reportedDate && incidentDate > reportedDate)) {
      throw new AgentError("Incident date must be real and cannot be later than the TGD post date.", 400);
    }
    const latitude = Number(incident.lat);
    const longitude = Number(incident.lng);
    const decision = {
      incident_date: incidentDate,
      locality: nullableText(incident.locality, 160),
      incident_type: nullableText(incident.incident_type || incident.category, 120),
      summary: nullableText(incident.summary, 900)
    };
    const location = {
      province: clean(incident.province, 100),
      district: clean(incident.district, 100)
    };
    const fingerprint = await incidentFingerprint(decision, location);
    updates.push(env.CONTENT_DB.prepare(`
      UPDATE incidents SET
        fingerprint = ?,
        incident_date = ?,
        incident_date_source = ?,
        country = ?,
        province = ?,
        district = ?,
        locality = ?,
        location_label = ?,
        latitude = ?,
        longitude = ?,
        location_precision = ?,
        incident_type = ?,
        category_name = ?,
        summary = ?,
        killed = ?,
        injured = ?,
        actor_or_group = ?,
        updated_at = datetime('now')
      WHERE id = ? AND status = 'published'
    `).bind(
      fingerprint,
      incidentDate,
      clean(incident.date_source, 40) || existing.incident_date_source,
      clean(incident.country, 100) || existing.country || "Pakistan",
      location.province,
      location.district,
      decision.locality,
      nullableText(incident.location_label, 200) || existing.location_label,
      latitude,
      longitude,
      clean(incident.location_precision, 80) || existing.location_precision,
      decision.incident_type,
      clean(incident.category, 120) || existing.category_name || "Security incident",
      decision.summary,
      incident.fatalities == null ? null : Number(incident.fatalities),
      incident.injuries == null ? null : Number(incident.injuries),
      clean(incident.actor, 180) || null,
      existing.id
    ));
  }
  if (updates.length) {
    await env.CONTENT_DB.batch(updates);
    await syncPublishedFeed(env);
  }
  return new Set(updates.length ? candidates.filter((incident) => existingById.has(incident.id)).map((incident) => incident.id) : []);
}

export async function removePublishedAgentIncident(env, id) {
  const existing = await env.CONTENT_DB.prepare(
    "SELECT id FROM incidents WHERE id = ? AND status = 'published'"
  ).bind(id).first();
  if (!existing) return false;
  await env.CONTENT_DB.prepare(`
    UPDATE incidents SET
      status = 'rejected',
      review_reason = trim(COALESCE(review_reason, '') || ' Removed from the public map by the owner.'),
      published_at = NULL,
      updated_at = datetime('now')
    WHERE id = ? AND status = 'published'
  `).bind(id).run();
  await syncPublishedFeed(env);
  return true;
}

export async function acquireAgentLock(env) {
  const now = Math.floor(Date.now() / 1000);
  const until = now + LOCK_SECONDS;
  const owner = randomToken(18);
  const result = await env.CONTENT_DB.prepare(`
    UPDATE agent_run_lock
    SET owner_id = ?, locked_until = ?, updated_at = datetime('now')
    WHERE name = 'x_to_map' AND locked_until < ?
  `).bind(owner, until, now).run();
  return Number(result.meta?.changes || 0) === 1 ? { owner, expiresAt: until } : null;
}

export async function renewAgentLock(env, lease) {
  const until = Math.max(
    Math.floor(Date.now() / 1000) + LOCK_SECONDS,
    Number(lease.expiresAt || 0) + 1
  );
  const result = await env.CONTENT_DB.prepare(`
    UPDATE agent_run_lock
    SET locked_until = ?, updated_at = datetime('now')
    WHERE name = 'x_to_map' AND owner_id = ?
  `).bind(until, lease.owner).run();
  if (Number(result.meta?.changes || 0) !== 1) {
    throw new AgentError("The agent execution lock was lost; processing stopped safely.", 409);
  }
  lease.expiresAt = until;
  return lease;
}

export async function releaseAgentLock(env, lease) {
  if (!lease?.owner) return false;
  const result = await env.CONTENT_DB.prepare(`
    UPDATE agent_run_lock
    SET owner_id = NULL, locked_until = 0, updated_at = datetime('now')
    WHERE name = 'x_to_map' AND owner_id = ?
  `).bind(lease.owner).run();
  return Number(result.meta?.changes || 0) === 1;
}

export async function runXToMapAgent(env, options = {}) {
  if (!env.CONTENT_DB || !env.INCIDENTS) throw new AgentError("Agent storage bindings are not configured.", 503);
  if (!options.force && await stateGet(env, "agent_enabled", "false") !== "true") {
    return { ok: true, skipped: true, reason: "agent-paused" };
  }
  const lease = await acquireAgentLock(env);
  if (!lease) return { ok: true, skipped: true, reason: "another-run-active" };
  const startedAt = new Date().toISOString();
  await metricIncrement(env, "cron_runs", 1);
  try {
    const fetched = await fetchNewXPosts(env);
    await renewAgentLock(env, lease);
    await stateSet(env, "last_successful_x_check", new Date().toISOString());
    const processed = await processPendingPosts(env, () => renewAgentLock(env, lease));
    if (processed.published > 0) await syncPublishedFeed(env);
    await stateDelete(env, "last_error");
    const result = {
      ok: true,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      x_posts_returned: fetched.posts.length,
      cursor: fetched.cursor,
      ...processed
    };
    if (result.x_posts_returned || result.processed_posts || result.published || result.review) {
      await logAgent(env, "cron_complete", "X-to-Map run completed.", result);
    }
    return result;
  } catch (error) {
    await metricIncrement(env, "errors", 1);
    await stateSet(env, "last_error", clean(error?.message || error, 1000));
    await logAgent(env, "cron_failed", error?.message || String(error), {
      started_at: startedAt,
      status: error?.status || 500
    }, "error");
    throw error;
  } finally {
    await releaseAgentLock(env, lease);
  }
}

function filterFeed(feed, url) {
  const province = clean(url.searchParams.get("province"), 100).toLowerCase();
  const district = clean(url.searchParams.get("district"), 100).toLowerCase();
  const category = clean(url.searchParams.get("category"), 120).toLowerCase();
  const incidentType = clean(url.searchParams.get("incident_type"), 120).toLowerCase();
  const dateFrom = clean(url.searchParams.get("date_from"), 10);
  const dateTo = clean(url.searchParams.get("date_to"), 10);
  const incidents = (feed.incidents || []).filter((incident) => (
    (!province || clean(incident.province).toLowerCase() === province)
    && (!district || clean(incident.district).toLowerCase() === district)
    && (!category || clean(incident.category).toLowerCase() === category)
    && (!incidentType || clean(incident.incident_type || incident.category).toLowerCase() === incidentType)
    && (!dateFrom || clean(incident.date, 10) >= dateFrom)
    && (!dateTo || clean(incident.date, 10) <= dateTo)
  ));
  return { ...feed, incidents };
}

export async function publicIncidentFeed(request, env) {
  const feed = filterFeed(await loadFeed(env), new URL(request.url));
  return json(feed, 200, { "cache-control": "public, max-age=60, must-revalidate" });
}

export async function publicIncidentUpdates(request, env) {
  const after = new URL(request.url).searchParams.get("after") || "1970-01-01T00:00:00.000Z";
  const rows = await env.CONTENT_DB.prepare(`
    SELECT * FROM incidents
    WHERE status = 'published' AND updated_at > ?
    ORDER BY updated_at LIMIT 500
  `).bind(after).all();
  return json({
    after,
    generated_at: new Date().toISOString(),
    incidents: (rows.results || []).map(publicIncident)
  }, 200, { "cache-control": "public, max-age=60, must-revalidate" });
}

export async function handleAgentPublicRequest(request, env) {
  const path = new URL(request.url).pathname;
  if (path !== "/api/agent/x/callback" || request.method !== "GET") return null;
  try {
    await completeXOAuth(request, env);
    return redirect("/admin/#agent=x-connected");
  } catch (error) {
    console.error(JSON.stringify({ message: "X OAuth callback failed", error: error?.message || String(error) }));
    const url = new URL("/admin/", request.url);
    url.hash = `agent=x-error&message=${encodeURIComponent(error?.message || "X connection failed")}`;
    return redirect(url.toString());
  }
}

async function agentStatus(env) {
  const [
    metrics,
    review,
    failed,
    duplicates,
    today,
    lastExport,
    oauth,
    logs,
    settings
  ] = await Promise.all([
    env.CONTENT_DB.prepare("SELECT metric_key, metric_value FROM agent_metrics WHERE metric_month = ?").bind(monthKey()).all(),
    env.CONTENT_DB.prepare("SELECT COUNT(*) AS count FROM incidents WHERE status = 'needs_review'").first(),
    env.CONTENT_DB.prepare("SELECT COUNT(*) AS count FROM x_posts WHERE processing_status IN ('failed', 'pending_retry')").first(),
    env.CONTENT_DB.prepare("SELECT COUNT(*) AS count FROM incidents WHERE status = 'possible_duplicate'").first(),
    env.CONTENT_DB.prepare("SELECT COUNT(*) AS count FROM incidents WHERE status = 'published' AND date(published_at) = date('now')").first(),
    env.CONTENT_DB.prepare("SELECT * FROM monthly_exports ORDER BY generated_at DESC LIMIT 1").first(),
    env.CONTENT_DB.prepare("SELECT expires_at, scope, updated_at FROM x_oauth_tokens WHERE id = 1").first(),
    env.CONTENT_DB.prepare("SELECT * FROM agent_logs ORDER BY id DESC LIMIT 25").all(),
    env.CONTENT_DB.prepare("SELECT key, value, updated_at FROM sync_state").all()
  ]);
  const metricMap = Object.fromEntries((metrics.results || []).map((row) => [row.metric_key, Number(row.metric_value) || 0]));
  const state = Object.fromEntries((settings.results || []).map((row) => [row.key, row.value]));
  const ownedReads = metricMap.x_posts_read || 0;
  return {
    enabled: state.agent_enabled === "true",
    x_connected: Boolean(oauth),
    x_username: state.x_username || null,
    x_user_id: state.x_user_id || null,
    last_successful_x_check: state.last_successful_x_check || null,
    last_x_post_detected: state.last_x_post_detected || null,
    last_map_update: state.last_map_update || null,
    last_error: state.last_error || null,
    target_country: state.target_country || "Pakistan",
    incidents_published_today: Number(today?.count || 0),
    waiting_for_review: Number(review?.count || 0),
    possible_duplicates: Number(duplicates?.count || 0),
    failed_jobs: Number(failed?.count || 0),
    x_posts_read_this_month: ownedReads,
    estimated_x_cost_usd: Number((ownedReads * 0.001).toFixed(3)),
    x_cost_warning: ownedReads >= 500 ? "alert" : ownedReads >= 350 ? "warning" : null,
    gemini_calls_this_month: metricMap.gemini_calls || 0,
    cron_runs_this_month: metricMap.cron_runs || 0,
    errors_this_month: metricMap.errors || 0,
    exports_this_month: metricMap.exports_generated || 0,
    last_monthly_export: lastExport || null,
    oauth: oauth || null,
    logs: logs.results || []
  };
}

async function reviewQueue(env) {
  const rows = await env.CONTENT_DB.prepare(`
    SELECT i.*, xp.raw_text AS x_post_text, xp.gemini_output, xp.classification,
           xp.classification_confidence
    FROM incidents i
    LEFT JOIN x_posts xp ON xp.x_post_id = i.source_tweet_id
    WHERE i.status IN ('needs_review', 'possible_duplicate', 'failed')
    ORDER BY i.updated_at DESC
    LIMIT 300
  `).all();
  return rows.results || [];
}

function editableIncident(body) {
  const allowed = [
    "incident_date", "incident_date_source", "country", "province", "district",
    "locality", "location_label", "latitude", "longitude", "location_precision",
    "incident_type", "category_name", "summary", "killed", "injured",
    "actor_or_group", "confidence"
  ];
  return Object.fromEntries(allowed.filter((key) => Object.hasOwn(body || {}, key)).map((key) => [key, body[key]]));
}

async function updateReviewItem(env, id, body) {
  const existing = await env.CONTENT_DB.prepare("SELECT * FROM incidents WHERE id = ?").bind(id).first();
  if (!existing) throw new AgentError("Review item not found.", 404);
  const action = clean(body?.action, 30);
  const edits = editableIncident(body?.incident || {});
  const merged = { ...existing, ...edits };
  let status = existing.status;
  let duplicateOf = existing.duplicate_of;
  let publishedAt = existing.published_at;
  if (action === "publish") {
    const latitude = Number(merged.latitude);
    const longitude = Number(merged.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
        || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new AgentError("A valid latitude and longitude are required before publication.", 400);
    }
    if (!merged.country || !merged.district || !merged.province || !merged.incident_type || !merged.summary) {
      throw new AgentError("Country, province, district, incident type, and summary are required.", 400);
    }
    if (normalizeLocationText(merged.country) !== "pakistan") {
      throw new AgentError("The current incident map accepts Pakistan incidents only.", 400);
    }
    const incidentDate = realIsoDate(merged.incident_date);
    const postDate = realIsoDate(clean(existing.tweet_created_at, 40).slice(0, 10));
    if (!incidentDate || (postDate && incidentDate > postDate)) {
      throw new AgentError("Incident date must be real and cannot be later than the TGD post date.", 400);
    }
    if (merged.killed != null && nullableCount(merged.killed) == null) {
      throw new AgentError("Killed must be blank, zero, or a positive whole number.", 400);
    }
    if (merged.injured != null && nullableCount(merged.injured) == null) {
      throw new AgentError("Injured must be blank, zero, or a positive whole number.", 400);
    }
    status = "published";
    publishedAt = new Date().toISOString();
    duplicateOf = null;
  } else if (action === "reject") {
    status = "rejected";
  } else if (action === "duplicate") {
    if (!body?.duplicate_of) throw new AgentError("Choose the incident this duplicates.", 400);
    status = "rejected";
    duplicateOf = clean(body.duplicate_of, 60);
  } else if (action === "merge") {
    const target = clean(body?.merge_into, 60);
    if (!target) throw new AgentError("Choose an incident to merge into.", 400);
    await env.CONTENT_DB.prepare(`
      INSERT OR IGNORE INTO incident_sources(incident_id, x_post_id, source_role)
      SELECT ?, x_post_id, 'update' FROM incident_sources WHERE incident_id = ?
    `).bind(target, id).run();
    status = "rejected";
    duplicateOf = target;
  } else if (action === "retry") {
    await env.CONTENT_DB.prepare(`
      UPDATE x_posts SET processing_status = 'pending_retry', error_message = NULL
      WHERE x_post_id = ?
    `).bind(existing.source_tweet_id).run();
    status = "needs_review";
  } else if (action !== "save") {
    throw new AgentError("Unknown review action.", 400);
  }
  const fields = {
    ...edits,
    status,
    duplicate_of: duplicateOf,
    published_at: publishedAt,
    review_reason: clean(body?.review_reason ?? existing.review_reason, 1000)
  };
  const columns = Object.keys(fields);
  await env.CONTENT_DB.prepare(`
    UPDATE incidents SET ${columns.map((column) => `${column} = ?`).join(", ")}, updated_at = datetime('now')
    WHERE id = ?
  `).bind(...columns.map((column) => fields[column]), id).run();
  if (body?.correction_note) {
    const post = await env.CONTENT_DB.prepare(
      "SELECT gemini_output FROM x_posts WHERE x_post_id = ?"
    ).bind(existing.source_tweet_id).first();
    await env.CONTENT_DB.prepare(`
      INSERT INTO correction_examples(
        original_x_post_id, original_agent_output, owner_correction, owner_reason,
        approved_for_future_prompt
      ) VALUES (?, ?, ?, ?, ?)
    `).bind(
      existing.source_tweet_id,
      post?.gemini_output || "{}",
      JSON.stringify(edits),
      clean(body.correction_note, 1000),
      body.use_as_future_example === true ? 1 : 0
    ).run();
  }
  if (status === "published" || existing.status === "published") await syncPublishedFeed(env);
  return env.CONTENT_DB.prepare("SELECT * FROM incidents WHERE id = ?").bind(id).first();
}

async function listRules(env) {
  const [rules, categories, examples] = await Promise.all([
    env.CONTENT_DB.prepare("SELECT * FROM agent_rules ORDER BY active DESC, id DESC").all(),
    env.CONTENT_DB.prepare("SELECT * FROM incident_categories ORDER BY sort_order, category_name").all(),
    env.CONTENT_DB.prepare(`
      SELECT * FROM correction_examples ORDER BY id DESC LIMIT 100
    `).all()
  ]);
  return { rules: rules.results || [], categories: categories.results || [], correction_examples: examples.results || [] };
}

async function saveRule(env, body, id = null) {
  const title = clean(body?.title, 160);
  const ruleText = clean(body?.rule_text, 3000);
  const ruleType = clean(body?.rule_type, 80);
  const allowedTypes = new Set([
    "global_instruction", "always_review", "ignore", "classification_example",
    "extraction_example", "province_review"
  ]);
  if (!title || !ruleText || !allowedTypes.has(ruleType)) throw new AgentError("Valid title, rule text, and rule type are required.", 400);
  if (id) {
    await env.CONTENT_DB.prepare(`
      UPDATE agent_rules
      SET title = ?, rule_text = ?, rule_type = ?, province = ?, active = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(title, ruleText, ruleType, nullableText(body.province, 100), body.active === false ? 0 : 1, id).run();
  } else {
    await env.CONTENT_DB.prepare(`
      INSERT INTO agent_rules(title, rule_text, rule_type, province, active)
      VALUES (?, ?, ?, ?, ?)
    `).bind(title, ruleText, ruleType, nullableText(body.province, 100), body.active === false ? 0 : 1).run();
  }
}

async function saveCategory(env, body, id = null) {
  const name = clean(body?.category_name, 120);
  if (!name) throw new AgentError("Category name is required.", 400);
  if (id) {
    await env.CONTENT_DB.prepare(`
      UPDATE incident_categories
      SET category_name = ?, category_group = ?, active = ?, sort_order = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(name, nullableText(body.category_group, 120), body.active === false ? 0 : 1, Number(body.sort_order) || 0, id).run();
  } else {
    await env.CONTENT_DB.prepare(`
      INSERT INTO incident_categories(category_name, category_group, active, sort_order)
      VALUES (?, ?, ?, ?)
    `).bind(name, nullableText(body.category_group, 120), body.active === false ? 0 : 1, Number(body.sort_order) || 0).run();
  }
}

async function exportsList(env) {
  const rows = await env.CONTENT_DB.prepare(
    "SELECT * FROM monthly_exports ORDER BY report_month DESC, version DESC LIMIT 120"
  ).all();
  return (rows.results || []).map((row) => ({
    ...row,
    charts_metadata: safeJson(row.charts_metadata, [])
  }));
}

async function exportDownload(request, env) {
  const key = clean(new URL(request.url).searchParams.get("key"), 1024);
  if (!key.startsWith("agent-exports/") || key.includes("..")) throw new AgentError("Invalid export key.", 400);
  const object = await env.MEDIA.get(key);
  if (!object?.body) throw new AgentError("Export file not found.", 404);
  const headers = new Headers(baseSecurityHeaders());
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-disposition", `attachment; filename="${key.split("/").pop().replace(/"/g, "")}"`);
  return new Response(object.body, { headers });
}

export async function handleAgentAdmin(request, env, ctx, adminPath) {
  const method = request.method;
  const url = new URL(request.url);
  if (adminPath === "/agent/status" && method === "GET") return json(await agentStatus(env));
  if (adminPath === "/agent/x/connect" && method === "POST") return json(await beginXOAuth(request, env));
  if (adminPath === "/agent/pause" && method === "POST") {
    await stateSet(env, "agent_enabled", "false");
    return json({ ok: true, enabled: false });
  }
  if (adminPath === "/agent/resume" && method === "POST") {
    if (!(await env.CONTENT_DB.prepare("SELECT id FROM x_oauth_tokens WHERE id = 1").first())) {
      throw new AgentError("Connect @Global_Decipher before resuming the agent.", 409);
    }
    await stateSet(env, "agent_enabled", "true");
    return json({ ok: true, enabled: true });
  }
  if ((adminPath === "/agent/run" || adminPath === "/agent/test-latest") && method === "POST") {
    return json(await runXToMapAgent(env, { force: true }));
  }
  if (adminPath === "/agent/review" && method === "GET") return json({ items: await reviewQueue(env) });
  if (adminPath.startsWith("/agent/review/") && method === "POST") {
    const id = decodeURIComponent(adminPath.slice("/agent/review/".length));
    return json(await updateReviewItem(env, id, await readJsonLimited(request)));
  }
  if (adminPath === "/agent/rules" && method === "GET") return json(await listRules(env));
  if (adminPath === "/agent/rules" && method === "POST") {
    await saveRule(env, await readJsonLimited(request));
    return json(await listRules(env), 201);
  }
  if (adminPath.startsWith("/agent/rules/") && method === "PUT") {
    const id = Number(adminPath.slice("/agent/rules/".length));
    await saveRule(env, await readJsonLimited(request), id);
    return json(await listRules(env));
  }
  if (adminPath.startsWith("/agent/rules/") && method === "DELETE") {
    const id = Number(adminPath.slice("/agent/rules/".length));
    await env.CONTENT_DB.prepare("DELETE FROM agent_rules WHERE id = ?").bind(id).run();
    return json(await listRules(env));
  }
  if (adminPath === "/agent/categories" && method === "POST") {
    await saveCategory(env, await readJsonLimited(request));
    return json(await listRules(env), 201);
  }
  if (adminPath.startsWith("/agent/categories/") && method === "PUT") {
    const id = Number(adminPath.slice("/agent/categories/".length));
    await saveCategory(env, await readJsonLimited(request), id);
    return json(await listRules(env));
  }
  if (adminPath === "/agent/exports" && method === "GET") return json({ exports: await exportsList(env) });
  if (adminPath === "/agent/exports/generate" && method === "POST") {
    const body = await readJsonLimited(request);
    const result = await generateMonthlyDataPackage(env, clean(body?.month, 7), {
      includeCharts: typeof body?.include_charts === "boolean" ? body.include_charts : undefined
    });
    await metricIncrement(env, "exports_generated", 1);
    return json(result, 201);
  }
  if (adminPath === "/agent/exports/probe" && method === "POST") {
    const body = await readJsonLimited(request);
    return json(benchmarkMonthlyArtifacts(
      Math.min(500, Math.max(1, Number(body?.row_count) || 300)),
      clean(body?.month, 7) || "2026-06",
      body?.include_charts !== false
    ));
  }
  if (adminPath === "/agent/exports/download" && method === "GET") return exportDownload(request, env);
  if (adminPath === "/agent/logs" && method === "GET") {
    const rows = await env.CONTENT_DB.prepare("SELECT * FROM agent_logs ORDER BY id DESC LIMIT 300").all();
    return json({ logs: rows.results || [] });
  }
  if (adminPath === "/agent/monthly-summary" && method === "GET") {
    const month = clean(url.searchParams.get("month"), 7);
    const start = `${month}-01`;
    const [year, monthNumber] = month.split("-").map(Number);
    const end = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
    const rows = await env.CONTENT_DB.prepare(`
      SELECT * FROM incidents
      WHERE status = 'published'
        AND COALESCE(incident_date, substr(tweet_created_at, 1, 10)) >= ?
        AND COALESCE(incident_date, substr(tweet_created_at, 1, 10)) < ?
    `).bind(start, end).all();
    return json(monthlySummary(rows.results || []));
  }
  return null;
}

export async function runAgentMonthlyAutomation(env) {
  try {
    const result = await maybeGeneratePreviousMonthPackage(env);
    if (result.created) {
      await metricIncrement(env, "exports_generated", 1);
      await logAgent(env, "monthly_export_created", "Previous month data package created.", result.package);
    }
    return result;
  } catch (error) {
    await metricIncrement(env, "errors", 1);
    await logAgent(env, "monthly_export_failed", error?.message || String(error), {}, "error");
    throw error;
  }
}
