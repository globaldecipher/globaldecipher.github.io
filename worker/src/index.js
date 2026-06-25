// The Global Decipher — incident-feed + admin API Worker.
//
//   scheduled(): optionally poll X and maintain the historical incident archive.
//   fetch():
//     GET    /api/incidents          public — serve the KV feed (the map reads this)
//     POST   /api/incidents          authed — add/edit incident(s) (merge by id)
//     DELETE /api/incidents/<id>     authed — remove an incident
//     GET    /api/maintenance        public — { on: bool }
//     POST   /api/maintenance        authed — { on: bool } toggle site maintenance
//     GET    /api/admin/ping         authed — validate the access key
//     GET    /api/content?folder=    public — list articles in a collection (D1)
//     GET    /api/content/file?path= public — read one article { content, sha }
//     GET    /api/content/dump?folder= public — bulk fetch all rows in a collection (used by build)
//     PUT    /api/content/file       authed — create/update an article (D1) + trigger Pages rebuild
//     DELETE /api/content/file       authed — delete an article (D1) + trigger Pages rebuild
//     POST   /api/media              authed — upload an image, PDF, or DOCX to R2
//     GET    /media/<key>            public — serve uploaded research media
//     GET    /                       health check
//
// KV binding: INCIDENTS   D1 binding: CONTENT_DB
// Secrets: ADMIN_TOKEN, X_BEARER_TOKEN (optional), PAGES_DEPLOY_HOOK (optional)
// Vars: X_USERNAME

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
import { listContent, getFile, putFile, deleteFile, dumpCollection, triggerRebuild } from "./content.js";
import { uploadMedia, readMedia } from "./media.js";
import { logAudit, listAudit, actorFingerprint } from "./audit.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type"
};
const INCIDENT_CACHE_VERSION = "archive-v4";

function incidentCacheKey(url) {
  return new Request(`${url.origin}/api/incidents?cache=${INCIDENT_CACHE_VERSION}`, { method: "GET" });
}

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

function bearerToken(request) {
  return (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

// Light front-matter scrapers for audit-log labelling — cheaper than importing
// the full markdown parser. They tolerate either bare or quoted YAML values.
function frontMatter(content) {
  const m = String(content || "").match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : "";
}
function parseTitle(content) {
  const fm = frontMatter(content);
  const m = fm.match(/^title:\s*(.+)$/m);
  if (!m) return null;
  return m[1].trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "");
}
function parseStatus(content) {
  const fm = frontMatter(content);
  const m = fm.match(/^status:\s*(.+)$/m);
  if (!m) return null;
  return m[1].trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (path === "/" || path === "/health") return json({ ok: true, service: "tgd-incidents" });

    try {
      if (path.startsWith("/media/") && method === "GET") {
        const object = await readMedia(env, path.slice("/media/".length));
        if (!object) return new Response("Not found", { status: 404 });
        const headers = new Headers();
        headers.set("content-type", object.httpMetadata?.contentType || "application/octet-stream");
        headers.set("cache-control", object.httpMetadata?.cacheControl || "public, max-age=31536000, immutable");
        if (object.httpEtag) headers.set("etag", object.httpEtag);
        return new Response(object.body, { headers });
      }

      // ---- Incident feed (public read) ----
      if ((path === "/api/incidents" || path === "/incidents") && method === "GET") {
        const cache = caches.default;
        const cacheKey = incidentCacheKey(url);
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

      // ---- Published content dump (public, used by the static-site build) ----
      if (path === "/api/content/dump" && method === "GET") {
        const folder = url.searchParams.get("folder") || "";
        return json({ items: await dumpCollection(env, folder) });
      }

      // ---- Everything below requires the access key ----
      const needsAuth = path.startsWith("/api/");
      if (needsAuth && !authed(request, env)) return json({ error: "Unauthorized" }, 401);

      if (path === "/api/admin/ping") return json({ ok: true });

      // ---- Admin content reads (drafts are never exposed publicly) ----
      if (path === "/api/content" && method === "GET") {
        const folder = url.searchParams.get("folder") || "";
        return json({ files: await listContent(env, folder) });
      }
      if (path === "/api/content/file" && method === "GET") {
        const filePath = url.searchParams.get("path") || "";
        return json(await getFile(env, filePath));
      }

      if (path === "/api/media" && method === "POST") {
        return json(await uploadMedia(request, env), 201);
      }

      if (path === "/api/maintenance" && method === "POST") {
        const body = await readJson(request);
        const on = body?.on === true || body?.on === "on" || body?.on === "true";
        await env.INCIDENTS.put(MAINTENANCE_KEY, on ? "on" : "off");
        const actor = await actorFingerprint(bearerToken(request));
        ctx.waitUntil(logAudit(env, {
          action: on ? "lock" : "unlock",
          kind: "maintenance",
          target: "site",
          label: on ? "Site locked" : "Site live",
          actor
        }));
        return json({ ok: true, on });
      }

      // ---- Activity / audit log (admin-only read) ----
      if (path === "/api/audit" && method === "GET") {
        const limit = Number(url.searchParams.get("limit") || 200);
        return json({ entries: await listAudit(env, limit) });
      }

      // ---- Incidents: add / edit ----
      if (path === "/api/incidents" && method === "POST") {
        const payload = await readJson(request);
        const incoming = Array.isArray(payload) ? payload : Array.isArray(payload?.incidents) ? payload.incidents : [payload];
        const valid = incoming.filter((i) => i && i.id && i.date);
        if (!valid.length) return json({ error: "Each incident needs at least id and date" }, 400);
        const today = pakistanDateFromSeconds();
        const feed = await loadFeed(env);
        const knownIds = new Set((feed.incidents || []).map((it) => it.id));
        feed.incidents = mergeIncidents(feed.incidents, valid, today);
        stampFeed(feed, today);
        await saveFeed(env, feed);
        ctx.waitUntil(caches.default.delete(incidentCacheKey(url)));
        const actor = await actorFingerprint(bearerToken(request));
        for (const it of valid) {
          ctx.waitUntil(logAudit(env, {
            action: knownIds.has(it.id) ? "update" : "create",
            kind: "incident",
            target: it.id,
            label: it.title || it.id,
            actor
          }));
        }
        return json({ ok: true, added: valid.length, total: feed.incidents.length });
      }

      // ---- Incidents: delete ----
      if (path.startsWith("/api/incidents/") && method === "DELETE") {
        const id = decodeURIComponent(path.slice("/api/incidents/".length));
        const today = pakistanDateFromSeconds();
        const feed = await loadFeed(env);
        const existing = (feed.incidents || []).find((it) => it.id === id);
        const removed = deleteIncidentById(feed, id);
        if (removed) {
          stampFeed(feed, today);
          await saveFeed(env, feed);
          ctx.waitUntil(caches.default.delete(incidentCacheKey(url)));
          const actor = await actorFingerprint(bearerToken(request));
          ctx.waitUntil(logAudit(env, {
            action: "delete",
            kind: "incident",
            target: id,
            label: existing?.title || id,
            actor
          }));
        }
        return json({ ok: removed, removed, total: feed.incidents.length });
      }

      // ---- Content writes (D1) — trigger Pages rebuild after a successful change ----
      if (path === "/api/content/file" && method === "PUT") {
        const body = await readJson(request);
        if (!body?.path || typeof body.content !== "string") return json({ error: "path and content are required" }, 400);
        const before = await getFile(env, body.path).catch(() => null);
        const beforeStatus = before ? parseStatus(before.content) : null;
        const result = await putFile(env, body.path, body.content);
        // Skip rebuild for autosave (still drafts) — no point burning a Pages
        // build for an in-flight save.
        const status = parseStatus(body.content);
        const isAutosave = body.autosave === true;
        if (!isAutosave && (status === "published" || beforeStatus === "published")) {
          ctx.waitUntil(triggerRebuild(env));
        }
        const actor = await actorFingerprint(bearerToken(request));
        ctx.waitUntil(logAudit(env, {
          action: isAutosave ? "autosave" : (before ? (status === "published" && beforeStatus !== "published" ? "publish" : "update") : "create"),
          kind: "content",
          target: body.path,
          label: parseTitle(body.content) || body.path,
          sha: result.sha,
          actor
        }));
        return json(result);
      }
      if (path === "/api/content/file" && method === "DELETE") {
        const body = await readJson(request);
        if (!body?.path) return json({ error: "path is required" }, 400);
        const before = await getFile(env, body.path).catch(() => null);
        const beforeTitle = before ? parseTitle(before.content) : null;
        const result = await deleteFile(env, body.path);
        ctx.waitUntil(triggerRebuild(env));
        const actor = await actorFingerprint(bearerToken(request));
        ctx.waitUntil(logAudit(env, {
          action: "delete",
          kind: "content",
          target: body.path,
          label: beforeTitle || body.path,
          actor
        }));
        return json(result);
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
