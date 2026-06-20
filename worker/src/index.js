// The Global Decipher — incident-feed Worker.
//
// Replaces the old GitHub Actions pollers + incidents.json commit/deploy loop.
//   scheduled(): every 5 min poll Telegram (and every 15 min poll X), merge new
//                incidents into Cloudflare KV. No git commit, no site rebuild.
//   fetch():     GET  /api/incidents  -> serve the KV feed (this is what the map
//                                        on the site reads at runtime)
//                POST /api/incidents  -> authed manual ingest (issue-form workflow)
//                GET  /               -> health check
//
// KV namespace binding: INCIDENTS
// Secrets: TELEGRAM_BOT_TOKEN, X_BEARER_TOKEN, ADMIN_TOKEN
// Vars:    TELEGRAM_CHAT_ID, X_USERNAME

import {
  loadFeed,
  saveFeed,
  saveTelegramState,
  mergeIncidents,
  pakistanDateFromSeconds,
  archiveStartDate,
  ARCHIVE_DAYS,
  PAKISTAN_TIME_ZONE
} from "./feed.js";
import { pollTelegram } from "./telegram.js";
import { pollX } from "./x.js";

const FEED_PATHS = new Set(["/api/incidents", "/incidents"]);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type"
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...extraHeaders }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: true, service: "tgd-incidents" });
    }

    if (!FEED_PATHS.has(url.pathname)) {
      return json({ error: "Not found" }, 404);
    }

    if (request.method === "GET") {
      // Edge-cache for 60s, keyed by path only so the map's ?t=<ts> cache-buster
      // doesn't blow past KV's free read quota under traffic.
      const cache = caches.default;
      const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: "GET" });
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      const feed = await loadFeed(env);
      const response = json(feed, 200, { "cache-control": "public, max-age=60" });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    if (request.method === "POST") {
      const auth = request.headers.get("authorization") || "";
      const token = auth.replace(/^Bearer\s+/i, "");
      if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
        return json({ error: "Unauthorized" }, 401);
      }
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ error: "Invalid JSON body" }, 400);
      }
      const incoming = Array.isArray(payload) ? payload : Array.isArray(payload?.incidents) ? payload.incidents : [payload];
      const valid = incoming.filter((item) => item && item.id && item.date);
      if (!valid.length) {
        return json({ error: "No valid incidents (each needs at least id and date)" }, 400);
      }

      const today = pakistanDateFromSeconds();
      const feed = await loadFeed(env);
      feed.incidents = mergeIncidents(feed.incidents, valid, today);
      stampFeed(feed, today);
      await saveFeed(env, feed);
      return json({ ok: true, added: valid.length, total: feed.incidents.length });
    }

    return json({ error: "Method not allowed" }, 405);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPollers(env));
  }
};

function stampFeed(feed, today) {
  feed.time_zone = PAKISTAN_TIME_ZONE;
  feed.current_day = today;
  feed.archive_days = ARCHIVE_DAYS;
  feed.archive_start = archiveStartDate(today);
  feed.last_updated = new Date().toISOString();
}

async function runPollers(env) {
  const today = pakistanDateFromSeconds();
  const feed = await loadFeed(env);
  const existing = Array.isArray(feed.incidents) ? feed.incidents : [];
  const existingIds = new Set(existing.map((incident) => incident.id));

  let telegram = { added: [], lastUpdateId: 0 };
  try {
    telegram = await pollTelegram(env, existingIds);
  } catch (error) {
    console.error("Telegram poll failed:", error.message);
  }

  // X is rate-limited on the free tier, so only poll it on the quarter hour.
  let xAdded = [];
  if (env.X_BEARER_TOKEN && new Date().getUTCMinutes() % 15 === 0) {
    try {
      xAdded = await pollX(env, existing.concat(telegram.added));
    } catch (error) {
      console.error("X poll failed:", error.message);
    }
  }

  const added = telegram.added.concat(xAdded);
  const before = existing.length;
  const merged = mergeIncidents(existing, added, today);
  const feedChanged =
    added.length > 0 ||
    merged.length !== before ||
    feed.current_day !== today ||
    feed.archive_start !== archiveStartDate(today);

  if (feedChanged) {
    feed.incidents = merged;
    stampFeed(feed, today);
    await saveFeed(env, feed);
  }

  if (telegram.lastUpdateId > 0) {
    await saveTelegramState(env, { last_update_id: telegram.lastUpdateId });
  }

  console.log(`Telegram +${telegram.added.length}, X +${xAdded.length}; feed now ${merged.length} (was ${before}).`);
}
