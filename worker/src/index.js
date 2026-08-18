// The Global Decipher — incident-feed + admin API Worker.
//
//   scheduled(): poll the official TGD X account and build monthly data exports.
//   fetch():
//     GET    /api/incidents          public — serve published map incidents
//     GET    /api/incidents/updates  public — recently published/updated incidents
//     POST   /api/ingest/incidents   machine token — issue-form incident ingest
//     GET    /api/agent/x/callback   state-protected X OAuth callback
//     GET    /api/maintenance        public — { on: bool }
//     GET    /api/content/dump?folder=[&lang=ur|ps] public — bulk fetch all rows in a
//                                    collection, optionally in its Urdu or Pashto edition (used by build)
//     POST   /api/monitoring/checkout public — create Safepay checkout
//     GET    /api/monitoring/return   public — activate paid Monitoring access
//     GET    /api/monitoring/me       public — read Monitoring session state
//     POST   /api/monitoring/logout   public — revoke the current Monitoring session
//     POST   /api/safepay/webhook     public — Safepay subscription events
//     *      /api/admin/*             admin token — all editor and management operations
//     GET    /media/<key>            public — serve uploaded research media
//     GET    /                       health check
//
// KV binding: INCIDENTS   D1 binding: CONTENT_DB
// Agent secrets: X_CLIENT_ID, X_CLIENT_SECRET, X_TOKEN_ENCRYPTION_KEY,
//                GEMINI_API_KEY

import {
  loadFeed,
  saveFeed,
  mergeIncidents,
  deleteIncidentById,
  pakistanDateFromSeconds,
  archiveStartDate,
  ARCHIVE_DAYS,
  PAKISTAN_TIME_ZONE,
  MAINTENANCE_KEY,
  validateIncident
} from "./feed.js";
import {
  listContent,
  getFile,
  putFile,
  deleteFile,
  discardDraft,
  dumpCollection,
  triggerRebuild,
  latestDeployment
} from "./content.js";
import { uploadMedia, readMedia, safeMediaHeaders } from "./media.js";
import { logAudit, listAudit, actorFingerprint } from "./audit.js";
import { askDatabase } from "./ask.js";
import { handleCorpusUpload, handleCorpusList, handleCorpusDelete } from "./corpus.js";
import {
  baseSecurityHeaders,
  clientIdentifier,
  rateLimit,
  readJsonLimited,
  timingSafeSecretEqual
} from "./security.js";
import {
  generateMonthlyReportDraft,
  getMonthlyAnalytics
} from "./analytics.js";
import {
  handleSafepayWebhook,
  handleMonitoringCheckout,
  handleMonitoringLogout,
  handleMonitoringMe,
  handleMonitoringReturn
} from "./paywall.js";
import {
  applyTranslations,
  isTranslatedLang,
  translateItem,
  translateMissing,
  translationStatus,
  TRANSLATED_LANGS
} from "./translate.js";
import {
  handleAgentAdmin,
  handleAgentPublicRequest,
  publicIncidentFeed,
  publicIncidentUpdates,
  removePublishedAgentIncident,
  runAgentMonthlyAutomation,
  runXToMapAgent,
  updatePublishedAgentIncidents
} from "./x-to-map-agent.js";

const INCIDENT_CACHE_VERSION = "archive-v4";

function incidentCacheKey(url) {
  return new Request(`${url.origin}/api/incidents?cache=${INCIDENT_CACHE_VERSION}`, { method: "GET" });
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: baseSecurityHeaders({ "content-type": "application/json; charset=utf-8", ...extraHeaders })
  });
}

async function authed(request, env, secretName = "ADMIN_TOKEN") {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return timingSafeSecretEqual(token, env[secretName]);
}

function bearerToken(request) {
  return (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
}

const readJson = (request) => readJsonLimited(request, 1024 * 1024);

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
// "content/news/2026-08-18-slug.md" -> { collection: "news", slug: "2026-08-18-slug" }
function contentTarget(filePath) {
  const match = /^content\/([^/]+)\/(.+)\.md$/.exec(String(filePath || ""));
  return match ? { collection: match[1], slug: match[2] } : null;
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

    if (path === "/api/ask" && (method === "POST" || method === "OPTIONS")) {
      return askDatabase(request, env, ctx);
    }
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: baseSecurityHeaders() });
    if (path === "/" || path === "/health") return json({ ok: true, service: "tgd-incidents" });

    try {
      const publicAgentResponse = await handleAgentPublicRequest(request, env);
      if (publicAgentResponse) return publicAgentResponse;

      // HEAD is answered too: link-preview crawlers (WhatsApp, Telegram,
      // Facebook) check an image with HEAD before fetching it, and a JSON 404
      // there costs the article its preview picture.
      if (path.startsWith("/media/") && (method === "GET" || method === "HEAD")) {
        const mediaKey = path.slice("/media/".length);
        const object = await readMedia(env, mediaKey);
        if (!object) return new Response("Not found", { status: 404, headers: baseSecurityHeaders() });
        const headers = new Headers(safeMediaHeaders(object, mediaKey));
        if (object.httpEtag) headers.set("etag", object.httpEtag);
        return new Response(method === "HEAD" ? null : object.body, { headers });
      }

      // ---- Incident feed (public read) ----
      if ((path === "/api/incidents" || path === "/incidents") && method === "GET") {
        return publicIncidentFeed(request, env);
      }
      if (path === "/api/incidents/updates" && method === "GET") {
        return publicIncidentUpdates(request, env);
      }

      // ---- Maintenance flag (public read) ----
      if (path === "/api/maintenance" && method === "GET") {
        const flag = await env.INCIDENTS.get(MAINTENANCE_KEY);
        return json({ on: flag === "on" });
      }

      // ---- Published content dump (public, used by the static-site build) ----
      if (path === "/api/content/dump" && method === "GET") {
        const folder = url.searchParams.get("folder") || "";
        if (folder === "monitoring") {
          if (!env.CONTENT_DUMP_TOKEN) return json({ error: "Protected content export is unavailable." }, 503);
          if (!(await timingSafeSecretEqual(bearerToken(request), env.CONTENT_DUMP_TOKEN))) {
            return json({ error: "Unauthorized" }, 401);
          }
        }
        const rows = await dumpCollection(env, folder);
        // The Urdu and Pashto editions are served from the same dump so the
        // build fetches one collection per language and never has to know that
        // translation exists. Anything not yet translated comes back in English
        // and is simply left out of that language's tree.
        const lang = url.searchParams.get("lang") || "";
        if (lang && lang !== "en") {
          if (!isTranslatedLang(lang)) return json({ error: `Unsupported language: ${lang}` }, 400);
          return json({ lang, items: await applyTranslations(env, folder, lang, rows) });
        }
        return json({ items: rows });
      }

      // ---- Monitoring Desk paywall (public payment/session endpoints) ----
      if (path === "/api/monitoring/checkout" && method === "POST") {
        if (!(await rateLimit(env, "PUBLIC_RATE_LIMITER", `checkout:${clientIdentifier(request)}`))) {
          return json({ error: "Too many checkout attempts. Please wait a minute." }, 429);
        }
        return handleMonitoringCheckout(request, env);
      }
      if (path === "/api/monitoring/return" && method === "GET") {
        return handleMonitoringReturn(request, env);
      }
      if (path === "/api/monitoring/me" && method === "GET") {
        return handleMonitoringMe(request, env);
      }
      if (path === "/api/monitoring/logout" && method === "POST") {
        return handleMonitoringLogout(request, env);
      }
      if (path === "/api/safepay/webhook" && method === "POST") {
        if (!(await rateLimit(env, "WEBHOOK_RATE_LIMITER", `safepay:${clientIdentifier(request)}`))) {
          return json({ error: "Too many webhook requests." }, 429);
        }
        return handleSafepayWebhook(request, env);
      }

      // ---- Machine-only incident ingest, isolated from the editor credential ----
      if (path === "/api/ingest/incidents" && method === "POST") {
        if (!(await authed(request, env, "INGEST_TOKEN"))) return json({ error: "Unauthorized" }, 401);
        return handleIncidentWrite(request, env, ctx, url);
      }

      // ---- Everything below is namespaced for Cloudflare Access + admin key ----
      const adminPath = path === "/api/admin"
        ? "/"
        : path.startsWith("/api/admin/")
          ? path.slice("/api/admin".length)
          : "";
      if (!adminPath) return json({ error: "Not found" }, 404);
      if (!(await authed(request, env))) {
        const allowed = await rateLimit(env, "ADMIN_RATE_LIMITER", `admin:${clientIdentifier(request)}`);
        return json({ error: allowed ? "Unauthorized" : "Too many authentication attempts." }, allowed ? 401 : 429);
      }

      if (adminPath === "/ping") return json({ ok: true });

      const agentAdminResponse = await handleAgentAdmin(request, env, ctx, adminPath);
      if (agentAdminResponse) return agentAdminResponse;

      if (adminPath === "/deployment" && method === "GET") {
        return json(await latestDeployment(env));
      }
      if (adminPath === "/rebuild" && method === "POST") {
        return json(await triggerRebuild(env));
      }

      // ---- Urdu / Pashto editions ----
      if (adminPath === "/translate" && method === "GET") {
        return json(await translationStatus(env));
      }
      // Deliberately batched rather than "translate everything": a caller loops
      // until `done`, so no single request runs long enough to be cut off
      // halfway through an article.
      if (adminPath === "/translate" && method === "POST") {
        const body = await readJson(request);
        const limit = Math.min(Math.max(Number.parseInt(body?.limit, 10) || 4, 1), 12);
        const langs = Array.isArray(body?.langs) && body.langs.length
          ? body.langs.filter((lang) => isTranslatedLang(lang))
          : TRANSLATED_LANGS;
        const result = await translateMissing(env, { limit, langs });
        // Only bother Pages once the backlog is clear, so a long backfill costs
        // one rebuild instead of one per batch.
        const deployment = result.translated > 0 && result.done ? await triggerRebuild(env) : null;
        return json({ ...result, deployment });
      }

      if (adminPath === "/analytics/monthly" && method === "GET") {
        const month = url.searchParams.get("month") || "";
        return json(await getMonthlyAnalytics(env, month));
      }
      if (adminPath === "/analytics/monthly/generate" && method === "POST") {
        const body = await readJson(request);
        const month = String(body?.month || "");
        return json(await generateMonthlyReportDraft(env, month), 201);
      }

      // ---- Admin content reads (drafts are never exposed publicly) ----
      if (adminPath === "/content" && method === "GET") {
        const folder = url.searchParams.get("folder") || "";
        return json({ files: await listContent(env, folder) });
      }
      if (adminPath === "/content/file" && method === "GET") {
        const filePath = url.searchParams.get("path") || "";
        return json(await getFile(env, filePath));
      }

      if (adminPath === "/media" && method === "POST") {
        return json(await uploadMedia(request, env), 201);
      }

      if (adminPath === "/corpus/upload" && method === "POST") {
        return handleCorpusUpload(request, env);
      }
      if (adminPath === "/corpus" && method === "GET") {
        return handleCorpusList(request, env);
      }
      if (adminPath.startsWith("/corpus/") && method === "DELETE") {
        const source_id = adminPath.slice("/corpus/".length);
        if (!source_id || source_id.includes("/")) return json({ error: "Bad source_id" }, 400);
        return handleCorpusDelete(request, env, source_id);
      }

      if (adminPath === "/maintenance" && method === "POST") {
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
      if (adminPath === "/maintenance" && method === "GET") {
        const flag = await env.INCIDENTS.get(MAINTENANCE_KEY);
        return json({ on: flag === "on" });
      }

      // ---- Activity / audit log (admin-only read) ----
      if (adminPath === "/audit" && method === "GET") {
        const limit = Number(url.searchParams.get("limit") || 200);
        return json({ entries: await listAudit(env, limit) });
      }

      // ---- Incidents: add / edit ----
      if (adminPath === "/incidents" && method === "GET") {
        return json(await loadFeed(env));
      }
      if (adminPath === "/incidents" && method === "POST") {
        return handleIncidentWrite(request, env, ctx, url);
      }

      // ---- Incidents: delete ----
      if (adminPath.startsWith("/incidents/") && method === "DELETE") {
        const id = decodeURIComponent(adminPath.slice("/incidents/".length));
        const today = pakistanDateFromSeconds();
        let feed = await loadFeed(env);
        const existing = (feed.incidents || []).find((it) => it.id === id);
        const removedFromD1 = await removePublishedAgentIncident(env, id);
        if (removedFromD1) feed = await loadFeed(env);
        const removedFromKv = removedFromD1 ? true : deleteIncidentById(feed, id);
        if (removedFromKv && !removedFromD1) {
          stampFeed(feed, today);
          await saveFeed(env, feed);
        }
        if (removedFromKv) {
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
        return json({ ok: removedFromKv, removed: removedFromKv, total: feed.incidents.length });
      }

      // ---- Content writes (D1) — trigger Pages rebuild after a successful change ----
      if (adminPath === "/content/file" && method === "PUT") {
        const body = await readJson(request);
        if (!body?.path || typeof body.content !== "string") return json({ error: "path and content are required" }, 400);
        const before = await getFile(env, body.path).catch(() => null);
        const beforeStatus = before ? parseStatus(before.content) : null;
        const isAutosave = body.autosave === true;
        const result = await putFile(env, body.path, body.content, body.sha || null, { autosave: isAutosave });
        // Skip rebuild for autosave — it never changes what the public sees, so
        // there is nothing to rebuild.
        const status = parseStatus(body.content);
        let deployment = null;
        if (!isAutosave && (status === "published" || beforeStatus === "published")) {
          deployment = await triggerRebuild(env);
          // English readers get the change on this build. Translating takes
          // long enough that holding the editor's save for it would feel
          // broken, so it runs after the response and asks for a second build
          // only if it actually produced something.
          const target = contentTarget(body.path);
          if (target && status === "published") {
            ctx.waitUntil((async () => {
              try {
                const result = await translateItem(env, target.collection, target.slug);
                if (result.translated > 0) await triggerRebuild(env);
              } catch (error) {
                console.error(JSON.stringify({
                  message: "post-publish translation failed",
                  path: body.path,
                  error: String(error?.message || error)
                }));
              }
            })());
          }
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
        return json({ ...result, deployment });
      }
      // Editor chose to throw away recovered work rather than restore it.
      if (adminPath === "/content/draft" && method === "DELETE") {
        const body = await readJson(request);
        if (!body?.path) return json({ error: "path is required" }, 400);
        return json(await discardDraft(env, body.path));
      }
      if (adminPath === "/content/file" && method === "DELETE") {
        const body = await readJson(request);
        if (!body?.path) return json({ error: "path is required" }, 400);
        const before = await getFile(env, body.path).catch(() => null);
        const beforeTitle = before ? parseTitle(before.content) : null;
        const result = await deleteFile(env, body.path, body.sha || null);
        const deployment = await triggerRebuild(env);
        const actor = await actorFingerprint(bearerToken(request));
        ctx.waitUntil(logAudit(env, {
          action: "delete",
          kind: "content",
          target: body.path,
          label: beforeTitle || body.path,
          actor
        }));
        return json({ ...result, deployment });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      const status = Number(error?.status) || 500;
      if (status >= 500) {
        console.error(JSON.stringify({
          message: "request failed",
          method,
          path,
          error: error?.message || String(error)
        }));
      }
      return json({ error: status >= 500 ? "Server error" : error.message }, status);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledTasks(env));
  }
};

async function handleIncidentWrite(request, env, ctx, url) {
  const payload = await readJson(request);
  const incoming = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.incidents)
      ? payload.incidents
      : [payload];
  const candidates = incoming.filter(Boolean);
  if (!candidates.length) return json({ error: "Submit at least one incident." }, 400);
  const invalid = candidates
    .map((incident) => ({ id: incident.id || null, errors: validateIncident(incident) }))
    .filter((entry) => entry.errors.length);
  if (invalid.length) {
    return json({
      error: "Some incident fields need attention before publishing.",
      incidents: invalid
    }, 400);
  }

  const today = pakistanDateFromSeconds();
  let feed = await loadFeed(env);
  const knownIds = new Set((feed.incidents || []).map((item) => item.id));
  const agentIds = await updatePublishedAgentIncidents(env, candidates);
  const curated = candidates.filter((incident) => !agentIds.has(incident.id));
  if (agentIds.size) feed = await loadFeed(env);
  if (curated.length) {
    feed.incidents = mergeIncidents(feed.incidents, curated, today);
    stampFeed(feed, today);
    await saveFeed(env, feed);
  }
  ctx.waitUntil(caches.default.delete(incidentCacheKey(url)));
  const actor = await actorFingerprint(bearerToken(request));
  for (const incident of candidates) {
    ctx.waitUntil(logAudit(env, {
      action: knownIds.has(incident.id) ? "update" : "create",
      kind: "incident",
      target: incident.id,
      label: incident.title || incident.id,
      actor
    }));
  }
  return json({
    ok: true,
    added: curated.filter((incident) => !knownIds.has(incident.id)).length,
    updated: curated.filter((incident) => knownIds.has(incident.id)).length + agentIds.size,
    total: feed.incidents.length
  });
}

function stampFeed(feed, today) {
  feed.time_zone = PAKISTAN_TIME_ZONE;
  feed.current_day = today;
  feed.archive_days = ARCHIVE_DAYS;
  feed.archive_start = archiveStartDate(today);
  feed.last_updated = new Date().toISOString();
}

async function runScheduledTasks(env) {
  try {
    const result = await runXToMapAgent(env);
    console.log(JSON.stringify({ message: "X-to-Map scheduled run", ...result }));
  } catch (error) {
    console.error(JSON.stringify({
      message: "X-to-Map scheduled run failed",
      error: error.message
    }));
  }
  try {
    await runAgentMonthlyAutomation(env);
  } catch (error) {
    console.error(JSON.stringify({
      message: "monthly data package automation failed",
      error: error.message
    }));
  }
  await sweepTranslations(env);
}

// The cron fires every minute for the X poller; translation only needs a slow
// backstop. This catches anything the post-publish hook missed — a Gemini
// outage, an article edited straight in D1 — without a human remembering to run
// a backfill.
async function sweepTranslations(env) {
  if (env.TRANSLATE_SWEEP_ENABLED === "false") return;
  if (!env.GEMINI_API_KEY) return;
  if (new Date().getUTCMinutes() % 15 !== 0) return;
  try {
    const result = await translateMissing(env, { limit: 2 });
    if (result.translated > 0) {
      console.log(JSON.stringify({ message: "translation sweep", ...result }));
      if (result.done) await triggerRebuild(env);
    }
  } catch (error) {
    console.error(JSON.stringify({ message: "translation sweep failed", error: String(error?.message || error) }));
  }
}
