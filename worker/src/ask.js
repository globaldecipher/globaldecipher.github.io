// /api/ask — source-bound Gemini assistant for TGD Explorer.
//
// The browser sends public structured profile data to this Worker. The Worker
// keeps the Gemini credential private, enforces small free-tier-friendly
// limits, and returns one concise answer with TGD source IDs.
//
// Secret:
//   GEMINI_API_KEY — set with `wrangler secret put GEMINI_API_KEY`
//
// Optional non-secret vars:
//   GEMINI_MODEL          defaults to gemini-3.1-flash-lite
//   GEMINI_FALLBACK_MODEL defaults to gemini-2.5-flash
//   GEMINI_REQUEST_TIMEOUT_MS defaults to 12000ms per model call
//   ASK_TOTAL_TIMEOUT_MS  defaults to 15000ms across primary + fallback
//   ASK_HOURLY_LIMIT      defaults to 8 requests per visitor
//   ASK_GLOBAL_DAILY_LIMIT defaults to 400 requests across the site

const MAX_QUESTION_LEN = 700;
const MAX_CONTEXT_BYTES = 100_000;
const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_CHARS = 12_000;
const DEFAULT_HOURLY_LIMIT = 8;
const DEFAULT_GLOBAL_DAILY_LIMIT = 400;
const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_FALLBACK_MODEL = "gemini-2.5-flash";
const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 15_000;
const ALLOWED_ROLES = new Set(["user", "assistant"]);
const FALLBACK_GEMINI_STATUSES = new Set([0, 408, 429, 500, 502, 503, 504]);

function cors(request, env) {
  const configured = String(env.SITE_URL || "https://theglobaldecipher.com").replace(/\/+$/, "");
  const origin = request.headers.get("origin");
  const allowed = !origin || origin === configured || origin === "https://www.theglobaldecipher.com"
    || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    allowed,
    headers: {
      "access-control-allow-origin": allowed && origin ? origin : configured,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
      "vary": "Origin"
    }
  };
}

function json(request, env, body, status = 200, extra = {}) {
  const { headers } = cors(request, env);
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers, ...extra }
  });
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clientIp(request) {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

async function consumeRateLimit(env, ip) {
  if (!env.INCIDENTS) return null;
  const hour = Math.floor(Date.now() / 3_600_000);
  const day = Math.floor(Date.now() / 86_400_000);
  const visitorKey = `ask:visitor:${hour}:${ip}`;
  const globalKey = `ask:global:${day}`;
  const [visitorRaw, globalRaw] = await Promise.all([
    env.INCIDENTS.get(visitorKey),
    env.INCIDENTS.get(globalKey)
  ]);
  const visitorCount = Number(visitorRaw || 0);
  const globalCount = Number(globalRaw || 0);
  const visitorLimit = positiveInt(env.ASK_HOURLY_LIMIT, DEFAULT_HOURLY_LIMIT);
  const globalLimit = positiveInt(env.ASK_GLOBAL_DAILY_LIMIT, DEFAULT_GLOBAL_DAILY_LIMIT);

  if (visitorCount >= visitorLimit) return "visitor";
  if (globalCount >= globalLimit) return "global";

  await Promise.all([
    env.INCIDENTS.put(visitorKey, String(visitorCount + 1), { expirationTtl: 4000 }),
    env.INCIDENTS.put(globalKey, String(globalCount + 1), { expirationTtl: 90_000 })
  ]);
  return null;
}

function cleanHistory(input) {
  if (!Array.isArray(input)) return [];
  let used = 0;
  const result = [];
  for (const turn of input.slice(-MAX_HISTORY_TURNS)) {
    const role = String(turn?.role || "");
    const content = String(turn?.content || "").trim();
    if (!ALLOWED_ROLES.has(role) || !content) continue;
    const remaining = MAX_HISTORY_CHARS - used;
    if (remaining <= 0) break;
    const bounded = content.slice(0, remaining);
    result.push({
      role: role === "assistant" ? "model" : "user",
      parts: [{ text: bounded }]
    });
    used += bounded.length;
  }
  return result;
}

function profileContext(entities) {
  return entities.map((entity) => ({
    id: entity?.id,
    name: entity?.name,
    aliases: entity?.aliases,
    type: entity?.type,
    founded: entity?.founded,
    dissolved: entity?.dissolved,
    status: entity?.status,
    ideology: entity?.ideology,
    country: entity?.country,
    countries: entity?.countries,
    summary: entity?.summary,
    designations: entity?.designations,
    leaders: entity?.leaders,
    financing: entity?.financing,
    attacks: entity?.attacks,
    relationships: entity?.relationships,
    sources: entity?.sources
  }));
}

function geminiEndpoint(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

function requestBodyForModel(base, model) {
  const generationConfig = { ...base.generationConfig };
  if (/^gemini-3(?:\.|-)/.test(model)) {
    generationConfig.thinkingConfig = { thinkingLevel: "low" };
  }
  return { ...base, generationConfig };
}

async function callGemini(model, apiKey, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(geminiEndpoint(model), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify(requestBodyForModel(body, model)),
      signal: controller.signal
    });
    const data = await upstream.json().catch(() => null);
    return {
      ok: upstream.ok,
      status: upstream.status,
      model,
      data,
      upstreamStatus: data?.error?.status || (upstream.ok ? "OK" : "unknown"),
      upstreamMessage: String(data?.error?.message || "").slice(0, 240)
    };
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return {
      ok: false,
      status: 0,
      model,
      data: null,
      upstreamStatus: timedOut ? "TIMEOUT" : "NETWORK_ERROR",
      upstreamMessage: timedOut
        ? `Gemini did not respond within ${timeoutMs}ms`
        : String(error?.message || "Network request failed").slice(0, 240)
    };
  } finally {
    clearTimeout(timer);
  }
}

function logGeminiFailure(result, attempt) {
  console.error(JSON.stringify({
    message: "Gemini request failed",
    attempt,
    status: result.status,
    model: result.model,
    upstreamStatus: result.upstreamStatus,
    upstreamMessage: result.upstreamMessage
  }));
}

function shouldUseFallback(result) {
  return !result.ok && FALLBACK_GEMINI_STATUSES.has(result.status);
}

export async function askDatabase(request, env) {
  const access = cors(request, env);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: access.headers });
  }
  if (!access.allowed) return json(request, env, { error: "This endpoint is available only from TGD Explorer." }, 403);

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_CONTEXT_BYTES + MAX_HISTORY_CHARS + 5000) {
    return json(request, env, { error: "The selected research context is too large. Open a narrower profile." }, 413);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json(request, env, { error: "Invalid request." }, 400);
  }

  const question = String(payload?.question || "").trim();
  const entityId = String(payload?.entityId || "").trim();
  const entities = Array.isArray(payload?.context?.entities) ? payload.context.entities : [];
  if (!question) return json(request, env, { error: "Enter a research question." }, 400);
  if (!entityId || entities.length === 0) return json(request, env, { error: "Open a researched profile before asking." }, 400);
  if (question.length > MAX_QUESTION_LEN) {
    return json(request, env, { error: `Keep the question under ${MAX_QUESTION_LEN} characters.` }, 413);
  }

  const contextJson = JSON.stringify(profileContext(entities));
  if (contextJson.length > MAX_CONTEXT_BYTES) {
    return json(request, env, { error: "The selected research context is too large. Open a narrower profile." }, 413);
  }
  if (!env.GEMINI_API_KEY) {
    return json(request, env, { error: "The research assistant is being configured. The sourced profiles remain available." }, 503);
  }

  const limited = await consumeRateLimit(env, clientIp(request));
  if (limited === "visitor") {
    return json(request, env, { error: "You have reached the hourly research-assistant limit. Please try again later." }, 429);
  }
  if (limited === "global") {
    return json(request, env, { error: "Today’s free research-assistant allowance is full. Please try again tomorrow." }, 429);
  }

  const system = [
    "You are the source-bound research assistant for The Global Decipher (TGD), a terrorism research database.",
    "Answer only from the structured TGD profile data supplied below. Never add outside facts or guess.",
    "Every factual sentence must include one or more exact source IDs in square brackets, for example [src-iskp-1]. Put each source ID in its own brackets; never combine multiple IDs inside one bracket.",
    "If the supplied data cannot answer the question, say exactly what is missing.",
    "Distinguish confirmed facts, reported claims, analytical assessments, and unknowns.",
    "Do not provide operational guidance that could facilitate violence, targeting, weapons construction, recruitment, financing, concealment, or evasion. Redirect such requests to high-level historical or prevention-focused analysis.",
    "Use neutral research language. Do not glorify organisations or individuals.",
    "Prefer concise paragraphs or a small comparison table. End with a one-sentence verification note.",
    "",
    `Active entity ID: ${entityId}`,
    "",
    "Structured TGD profile data (JSON):",
    contextJson
  ].join("\n");

  const model = String(env.GEMINI_MODEL || DEFAULT_MODEL);
  const fallbackModel = String(env.GEMINI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL);
  const requestTimeout = Math.min(
    positiveInt(env.GEMINI_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS),
    DEFAULT_REQUEST_TIMEOUT_MS
  );
  const totalTimeout = Math.min(
    positiveInt(env.ASK_TOTAL_TIMEOUT_MS, DEFAULT_TOTAL_TIMEOUT_MS),
    DEFAULT_TOTAL_TIMEOUT_MS
  );
  const contents = cleanHistory(payload?.history);
  contents.push({ role: "user", parts: [{ text: question }] });

  const requestBody = {
    system_instruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      temperature: 0.15,
      maxOutputTokens: 600
    }
  };

  const deadline = Date.now() + totalTimeout;
  const availableTime = () => Math.min(requestTimeout, Math.max(1, deadline - Date.now()));

  let result = await callGemini(model, env.GEMINI_API_KEY, requestBody, availableTime());
  if (!result.ok) logGeminiFailure(result, "primary");

  if (
    shouldUseFallback(result)
    && fallbackModel
    && fallbackModel !== model
    && deadline - Date.now() > 200
  ) {
    result = await callGemini(fallbackModel, env.GEMINI_API_KEY, requestBody, availableTime());
    if (!result.ok) logGeminiFailure(result, "fallback");
  }

  if (!result.ok) {
    if (result.upstreamStatus === "TIMEOUT" || Date.now() >= deadline) {
      return json(request, env, {
        error: "The research assistant reached its 15-second limit. Please try a narrower question."
      }, 504);
    }
    const message = result.status === 429
      ? "The free Gemini allowance is temporarily exhausted. Please try again later."
      : "The research assistant is temporarily unavailable.";
    return json(request, env, { error: message }, result.status === 429 ? 429 : 502);
  }

  const answer = result.data?.candidates?.[0]?.content?.parts
    ?.map((part) => part?.text || "")
    .join("")
    .trim();
  if (!answer) {
    return json(request, env, { error: "Gemini did not return a source-grounded answer. Try a narrower question." }, 502);
  }

  return json(request, env, {
    answer,
    model: result.model,
    fallback: result.model !== model
  });
}
