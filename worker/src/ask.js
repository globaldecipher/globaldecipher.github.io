// /api/ask — Explorer's "Ask the database" panel.
//
// The client posts: { entityId: string, question: string, context: { entities: Entity[] } }
//
// The Worker proxies to the Anthropic Messages API with a locked system prompt
// that forbids any answer not grounded in the provided structured data and
// requires `[src-…]` citations. Streaming SSE flows straight back to the
// browser unaltered so the React panel can render token-by-token.
//
// Keys & limits:
//   ANTHROPIC_API_KEY  — secret (wrangler secret put ANTHROPIC_API_KEY)
//   ANTHROPIC_MODEL    — optional var; defaults to claude-sonnet-4-6
//   ASK_RATE_LIMIT_KV  — optional KV binding for IP-keyed rate-limit (10 / hour)

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type"
};
const MAX_QUESTION_LEN = 1500;
const MAX_CONTEXT_BYTES = 180_000; // ~45k tokens of context max

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...extra }
  });
}

async function clientIp(request) {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf;
  return request.headers.get("x-forwarded-for") || "unknown";
}

async function rateLimited(env, ip) {
  if (!env.INCIDENTS) return false; // KV not bound — skip
  const key = `ask:rl:${ip}:${Math.floor(Date.now() / 3_600_000)}`;
  const raw = await env.INCIDENTS.get(key);
  const n = Number(raw || 0);
  if (n >= 10) return true;
  // 1h TTL (slightly larger than the window so the slot survives the count)
  await env.INCIDENTS.put(key, String(n + 1), { expirationTtl: 4000 });
  return false;
}

export async function askDatabase(request, env, ctx) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  let payload;
  try { payload = await request.json(); }
  catch { return json({ error: "Invalid JSON body" }, 400); }

  const question = String(payload?.question || "").trim();
  const entityId = String(payload?.entityId || "").trim();
  const entities = Array.isArray(payload?.context?.entities) ? payload.context.entities : [];

  if (!question) return json({ error: "Missing question" }, 400);
  if (!entityId) return json({ error: "Missing entityId" }, 400);
  if (entities.length === 0) return json({ error: "Missing context.entities" }, 400);
  if (question.length > MAX_QUESTION_LEN) return json({ error: "Question too long" }, 413);

  const contextJson = JSON.stringify(entities);
  if (contextJson.length > MAX_CONTEXT_BYTES) {
    return json({ error: "Context too large; narrow the selection." }, 413);
  }

  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: "ANTHROPIC_API_KEY not configured on Worker." }, 503);
  }

  const ip = await clientIp(request);
  if (await rateLimited(env, ip)) {
    return json({ error: "Rate limit reached. Try again in an hour." }, 429);
  }

  const system = [
    "You are a research assistant for The Global Decipher (TGD), a Pakistan-focused terrorism research database.",
    "You may ONLY answer using the structured profile data provided below. Do not introduce any fact that is not present in the data.",
    "For every factual claim, cite the source id in square brackets — e.g. [src-iskp-1]. Use the source ids exactly as they appear in the data.",
    "If the data does not contain the answer, say so explicitly. Do not speculate.",
    "Be concise. Researchers value precision over volume.",
    "When asked for comparison, structure as side-by-side bullet points.",
    "",
    `The active entity is "${entityId}".`,
    "",
    "Structured profile data follows (JSON). Do not output JSON; write English prose with bracketed citations.",
    "",
    contextJson
  ].join("\n");

  const model = env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      system,
      stream: true,
      messages: [{ role: "user", content: question }]
    })
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return json({ error: "Upstream error", detail: text.slice(0, 400) }, upstream.status || 502);
  }

  // Pass the SSE stream through directly. Cloudflare workers handle this natively.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      ...CORS
    }
  });
}
