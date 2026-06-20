// The Global Decipher — incident-feed + admin API Worker.
//
//   scheduled(): poll X (every 15 min) and prune the feed to the archive window.
//   fetch():
//     GET    /api/incidents          public — serve the KV feed (the map reads this)
//     POST   /api/incidents          authed — add/edit incident(s) (merge by id)
//     DELETE /api/incidents/<id>     authed — remove an incident
//     GET    /api/maintenance        public — { on: bool }
//     POST   /api/maintenance        authed — { on: bool } toggle site maintenance
//     GET    /api/admin/ping         authed — validate the access key
//     GET    /api/content?folder=    authed — list markdown files in content/<folder>
//     GET    /api/content/file?path= authed — read one markdown file { content, sha }
//     PUT    /api/content/file       authed — create/update a markdown file (commits to GitHub)
//     DELETE /api/content/file       authed — delete a markdown file (commits to GitHub)
//     GET    /                       health check
//
// KV binding: INCIDENTS   Secrets: ADMIN_TOKEN, GITHUB_TOKEN, X_BEARER_TOKEN (optional)
// Vars: X_USERNAME, GITHUB_REPO, GITHUB_BRANCH

import {
  loadFeed,
  saveFeed,
  mergeIncidents,
  deleteIncidentById,
  pakistanDateFromSeconds,
  archiveStartDate,
  ARCHIVE_DAYS,
  PAKISTAN_TIME_ZONE,
  MAINTENANCE_KEY
} from "./feed.js";
import { pollX } from "./x.js";
import { listContent, getFile, putFile, deleteFile } from "./github.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type"
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...extraHeaders }
  });
}

function authed(request, env) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return Boolean(env.ADMIN_TOKEN) && token === env.ADMIN_TOKEN;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (path === "/" || path === "/health") return json({ ok: true, service: "tgd-incidents" });

    try {
      // ---- Incident feed (public read) ----
      if ((path === "/api/incidents" || path === "/incidents") && method === "GET") {
        const cache = caches.default;
        const cacheKey = new Request(`${url.origin}${path}`, { method: "GET" });
        const hit = await cache.match(cacheKey);
        if (hit) return hit;
        const feed = await loadFeed(env);
        const res = json(feed, 200, { "cache-control": "public, max-age=60" });
        ctx.waitUntil(cache.put(cacheKey, res.clone()));
        return res;
      }

      // ---- Maintenance flag (public read) ----
      if (path === "/api/maintenance" && method === "GET") {
        const flag = await env.INCIDENTS.get(MAINTENANCE_KEY);
        return json({ on: flag === "on" });
      }

      // ---- Everything below requires the access key ----
      const needsAuth = path.startsWith("/api/");
      if (needsAuth && !authed(request, env)) return json({ error: "Unauthorized" }, 401);

      if (path === "/api/admin/ping") return json({ ok: true });

      if (path === "/api/maintenance" && method === "POST") {
        const body = await readJson(request);
        const on = body?.on === true || body?.on === "on" || body?.on === "true";
        await env.INCIDENTS.put(MAINTENANCE_KEY, on ? "on" : "off");
        return json({ ok: true, on });
      }

      // ---- Incidents: add / edit ----
      if (path === "/api/incidents" && method === "POST") {
        const payload = await readJson(request);
        const incoming = Array.isArray(payload) ? payload : Array.isArray(payload?.incidents) ? payload.incidents : [payload];
        const valid = incoming.filter((i) => i && i.id && i.date);
        if (!valid.length) return json({ error: "Each incident needs at least id and date" }, 400);
        const today = pakistanDateFromSeconds();
        const feed = await loadFeed(env);
        feed.incidents = mergeIncidents(feed.incidents, valid, today);
        stampFeed(feed, today);
        await saveFeed(env, feed);
        return json({ ok: true, added: valid.length, total: feed.incidents.length });
      }

      // ---- Incidents: delete ----
      if (path.startsWith("/api/incidents/") && method === "DELETE") {
        const id = decodeURIComponent(path.slice("/api/incidents/".length));
        const today = pakistanDateFromSeconds();
        const feed = await loadFeed(env);
        const removed = deleteIncidentById(feed, id);
        if (removed) {
          stampFeed(feed, today);
          await saveFeed(env, feed);
        }
        return json({ ok: removed, removed, total: feed.incidents.length });
      }

      // ---- Content (markdown files via GitHub) ----
      if (path === "/api/content" && method === "GET") {
        const folder = url.searchParams.get("folder") || "";
        return json({ files: await listContent(env, folder) });
      }
      if (path === "/api/content/file" && method === "GET") {
        const filePath = url.searchParams.get("path") || "";
        return json(await getFile(env, filePath));
      }
      if (path === "/api/content/file" && method === "PUT") {
        const body = await readJson(request);
        if (!body?.path || typeof body.content !== "string") return json({ error: "path and content are required" }, 400);
        return json(await putFile(env, body.path, body.content, body.message, body.sha));
      }
      if (path === "/api/content/file" && method === "DELETE") {
        const body = await readJson(request);
        if (!body?.path || !body?.sha) return json({ error: "path and sha are required" }, 400);
        return json(await deleteFile(env, body.path, body.sha, body.message));
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({ error: error.message || "Server error" }, error.status || 500);
    }
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

  let xAdded = [];
  if (env.X_BEARER_TOKEN && new Date().getUTCMinutes() % 15 === 0) {
    try {
      xAdded = await pollX(env, existing);
    } catch (error) {
      console.error("X poll failed:", error.message);
    }
  }

  const before = existing.length;
  const merged = mergeIncidents(existing, xAdded, today);
  const changed =
    xAdded.length > 0 ||
    merged.length !== before ||
    feed.current_day !== today ||
    feed.archive_start !== archiveStartDate(today);

  if (changed) {
    feed.incidents = merged;
    stampFeed(feed, today);
    await saveFeed(env, feed);
  }
  console.log(`X +${xAdded.length}; feed now ${merged.length} (was ${before}).`);
}
