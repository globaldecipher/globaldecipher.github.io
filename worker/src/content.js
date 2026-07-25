// D1-backed content store. Replaces the old GitHub-based store.
// The admin panel still talks in "path" terms (content/<collection>/<slug>.md)
// for backward compatibility — we parse the path into (collection, slug).
//
// The "sha" field returned to clients is the D1 row's updated_at timestamp.
// Clients pass it back on PUT for create-vs-update detection; we use the row's
// existence in the unique (collection, slug) index for the real check.

const VALID_COLLECTIONS = new Set(["news", "opinion", "monitoring", "reports", "profiles", "pages"]);

// content/news/foo.md → { collection: "news", slug: "foo" }
function parsePath(filePath) {
  const m = String(filePath || "").match(/^content\/([a-z]+)\/([^/]+)\.md$/);
  if (!m) throw new Error("Path must look like content/<collection>/<slug>.md");
  const [, collection, slug] = m;
  if (!VALID_COLLECTIONS.has(collection)) throw new Error(`Unknown collection: ${collection}`);
  return { collection, slug };
}

// ---- YAML front-matter (mirrors admin.js / build.mjs) ----
const yStr = (v) => JSON.stringify(String(v ?? ""));
const yArr = (a) => "[" + a.map(yStr).join(", ") + "]";

function buildMarkdown(fm, body) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    if (v == null || v === "") continue;
    if (Array.isArray(v)) lines.push(`${k}: ${yArr(v)}`);
    else if (typeof v === "boolean") lines.push(`${k}: ${v}`);
    else lines.push(`${k}: ${yStr(v)}`);
  }
  lines.push("---", "", String(body || "").trim(), "");
  return lines.join("\n");
}

function parseMarkdown(text) {
  const m = String(text || "").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: text || "" };
  const fm = {};
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!mm) continue;
    let v = mm[2].trim();
    if (v === "true" || v === "false") fm[mm[1]] = v === "true";
    else if (/^\[.*\]$/.test(v)) { try { fm[mm[1]] = JSON.parse(v); } catch { fm[mm[1]] = []; } }
    else { try { fm[mm[1]] = JSON.parse(v); } catch { fm[mm[1]] = v.replace(/^"|"$/g, ""); } }
  }
  return { fm, body: m[2].replace(/^\n+/, "") };
}

function rowToFrontMatter(row, collection) {
  const fm = {};
  if (row.title) fm.title = row.title;
  if (row.status) fm.status = row.status;
  if (collection === "pages") {
    if (row.slug) fm.slug = row.slug;
    if (row.type) fm.type = row.type;
    if (row.eyebrow) fm.eyebrow = row.eyebrow;
    if (row.summary) fm.summary = row.summary;
  } else {
    if (row.date) fm.date = row.date;
    if (row.author) fm.author = row.author;
    if (row.author_bio) fm.author_bio = row.author_bio;
    if (row.type) fm.type = row.type;
    if (row.category) fm.category = row.category;
    if (row.region) fm.region = row.region;
    if (row.summary) fm.summary = row.summary;
    let tags = [];
    try { tags = JSON.parse(row.tags || "[]"); } catch {}
    fm.tags = tags;
    fm.access = row.access || "free";
    fm.sensitivity = row.sensitivity || "standard";
    fm.featured = Boolean(row.featured);
  }
  return fm;
}

// ---- public store API ----

export async function listContent(env, folder) {
  const collection = String(folder || "").toLowerCase();
  if (!VALID_COLLECTIONS.has(collection)) throw new Error(`Unknown collection: ${collection}`);
  const { results } = await env.CONTENT_DB
    .prepare("SELECT slug, title, date, status, updated_at FROM content WHERE collection = ? ORDER BY COALESCE(date, '') DESC, slug DESC")
    .bind(collection)
    .all();
  return (results || []).map((row) => ({
    name: `${row.slug}.md`,
    path: `content/${collection}/${row.slug}.md`,
    slug: row.slug,
    title: row.title,
    date: row.date,
    status: row.status || (collection === "pages" ? "published" : "draft"),
    updated_at: row.updated_at
  }));
}

export async function getFile(env, filePath) {
  const { collection, slug } = parsePath(filePath);
  const row = await env.CONTENT_DB
    .prepare("SELECT * FROM content WHERE collection = ? AND slug = ?")
    .bind(collection, slug)
    .first();
  if (!row) {
    const err = new Error("Not found");
    err.status = 404;
    throw err;
  }
  const fm = rowToFrontMatter(row, collection);
  const content = buildMarkdown(fm, row.body || "");
  return { path: filePath, content, sha: row.updated_at };
}

export async function putFile(env, filePath, content, expectedSha = null) {
  const { collection, slug } = parsePath(filePath);
  const { fm, body } = parseMarkdown(content);
  const tagsJson = JSON.stringify(Array.isArray(fm.tags) ? fm.tags : []);
  const now = new Date().toISOString();
  const status = collection === "pages" ? "published" : (fm.status === "published" ? "published" : "draft");
  // upsert by (collection, slug)
  const existing = await env.CONTENT_DB
    .prepare("SELECT id, updated_at, published_at FROM content WHERE collection = ? AND slug = ?")
    .bind(collection, slug)
    .first();
  if (existing && expectedSha && existing.updated_at !== expectedSha) {
    const error = new Error("This item changed after you opened it. Reload it before saving so another editor's work is not overwritten.");
    error.status = 409;
    throw error;
  }
  const publishedAt = status === "published" ? (existing?.published_at || now) : null;
  if (existing) {
    const statement = expectedSha
      ? env.CONTENT_DB
        .prepare(`UPDATE content SET
          type = ?, title = ?, date = ?, author = ?, author_bio = ?, category = ?, region = ?,
          summary = ?, tags = ?, access = ?, sensitivity = ?, status = ?, published_at = ?, featured = ?,
          eyebrow = ?, body = ?, updated_at = ?
          WHERE id = ? AND updated_at = ?`)
        .bind(
          fm.type || collection,
          fm.title || slug,
          fm.date || null,
          fm.author || null,
          fm.author_bio || null,
          fm.category || null,
          fm.region || null,
          fm.summary || null,
          tagsJson,
          fm.access || "free",
          fm.sensitivity || "standard",
          status,
          publishedAt,
          fm.featured ? 1 : 0,
          fm.eyebrow || null,
          body,
          now,
          existing.id,
          expectedSha
        )
      : env.CONTENT_DB
      .prepare(`UPDATE content SET
        type = ?, title = ?, date = ?, author = ?, author_bio = ?, category = ?, region = ?,
        summary = ?, tags = ?, access = ?, sensitivity = ?, status = ?, published_at = ?, featured = ?,
        eyebrow = ?, body = ?, updated_at = ?
        WHERE id = ?`)
      .bind(
        fm.type || collection,
        fm.title || slug,
        fm.date || null,
        fm.author || null,
        fm.author_bio || null,
        fm.category || null,
        fm.region || null,
        fm.summary || null,
        tagsJson,
        fm.access || "free",
        fm.sensitivity || "standard",
        status,
        publishedAt,
        fm.featured ? 1 : 0,
        fm.eyebrow || null,
        body,
        now,
        existing.id
      );
    const result = await statement.run();
    if (expectedSha && !result.meta.changes) {
      const error = new Error("This item changed while you were saving. Reload it before trying again.");
      error.status = 409;
      throw error;
    }
  } else {
    if (expectedSha) {
      const error = new Error("This item no longer exists. Return to the list before saving.");
      error.status = 409;
      throw error;
    }
    await env.CONTENT_DB
      .prepare(`INSERT INTO content
        (collection, slug, type, title, date, author, author_bio, category, region, summary, tags, access, sensitivity, status, published_at, featured, eyebrow, body, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        collection,
        slug,
        fm.type || collection,
        fm.title || slug,
        fm.date || null,
        fm.author || null,
        fm.author_bio || null,
        fm.category || null,
        fm.region || null,
        fm.summary || null,
        tagsJson,
        fm.access || "free",
        fm.sensitivity || "standard",
        status,
        publishedAt,
        fm.featured ? 1 : 0,
        fm.eyebrow || null,
        body,
        now,
        now
      )
      .run();
  }
  return { path: filePath, sha: now };
}

export async function deleteFile(env, filePath, expectedSha = null) {
  const { collection, slug } = parsePath(filePath);
  const existing = await env.CONTENT_DB
    .prepare("SELECT updated_at FROM content WHERE collection = ? AND slug = ?")
    .bind(collection, slug)
    .first();
  if (!existing) {
    const err = new Error("Not found");
    err.status = 404;
    throw err;
  }
  if (expectedSha && existing.updated_at !== expectedSha) {
    const error = new Error("This item changed after you opened it. Reload it before deleting.");
    error.status = 409;
    throw error;
  }
  const res = expectedSha
    ? await env.CONTENT_DB
      .prepare("DELETE FROM content WHERE collection = ? AND slug = ? AND updated_at = ?")
      .bind(collection, slug, expectedSha)
      .run()
    : await env.CONTENT_DB
      .prepare("DELETE FROM content WHERE collection = ? AND slug = ?")
      .bind(collection, slug)
      .run();
  if (!res.meta.changes) {
    const err = new Error(expectedSha
      ? "This item changed while you were deleting it. Reload before trying again."
      : "Not found");
    err.status = expectedSha ? 409 : 404;
    throw err;
  }
  return { path: filePath };
}

// Dump every row in a collection — used by build.mjs to render the site.
// Public read (no auth) since the content is destined for the public site anyway.
export async function dumpCollection(env, folder) {
  const collection = String(folder || "").toLowerCase();
  if (!VALID_COLLECTIONS.has(collection)) throw new Error(`Unknown collection: ${collection}`);
  const { results } = await env.CONTENT_DB
    .prepare(collection === "pages"
      ? "SELECT * FROM content WHERE collection = ? ORDER BY COALESCE(date, '') DESC, slug DESC"
      : "SELECT * FROM content WHERE collection = ? AND status = 'published' ORDER BY COALESCE(date, '') DESC, slug DESC")
    .bind(collection)
    .all();
  return (results || []).map((row) => {
    let tags = [];
    try { tags = JSON.parse(row.tags || "[]"); } catch {}
    return {
      collection,
      slug: row.slug,
      type: row.type,
      title: row.title,
      date: row.date,
      author: row.author,
      author_bio: row.author_bio,
      category: row.category,
      region: row.region,
      summary: row.summary,
      tags,
      access: row.access,
      sensitivity: row.sensitivity,
      status: row.status || (collection === "pages" ? "published" : "draft"),
      featured: Boolean(row.featured),
      eyebrow: row.eyebrow,
      body: row.body || "",
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  });
}

// Ask Cloudflare Pages to rebuild, retrying transient failures so a brief
// outage cannot silently leave a published article unbuilt.
export async function triggerRebuild(env) {
  if (!env.DEPLOY_HOOK_URL) {
    return { triggered: false, reason: "DEPLOY_HOOK_URL not configured" };
  }
  let lastReason = "";
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(env.DEPLOY_HOOK_URL, { method: "POST" });
      if (res.ok) return { triggered: true, status: res.status, attempts: attempt };
      lastStatus = res.status;
      lastReason = await res.text();
      // 4xx means the hook itself is wrong — retrying will not help.
      if (res.status < 500) break;
    } catch (err) {
      lastReason = err.message;
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
  }
  return { triggered: false, status: lastStatus, reason: lastReason, attempts: 3 };
}

// Read the newest Cloudflare Pages deployment so the admin can show whether the
// last publish actually reached the live site.
// Only the subject line is shown. A commit body carries trailers and internal
// notes that have no business rendering in the admin panel.
function commitSubject(message) {
  if (typeof message !== "string") return "";
  return message.split("\n", 1)[0].trim();
}

export async function latestDeployment(env) {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
    return { configured: false, error: "Cloudflare deployment access is not configured." };
  }
  const project = env.CF_PAGES_PROJECT || "theglobaldecipher";
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/pages/projects/${encodeURIComponent(project)}/deployments?per_page=1`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${env.CF_API_TOKEN}`,
      "content-type": "application/json"
    }
  });
  if (!res.ok) {
    return {
      configured: true,
      available: false,
      status: res.status,
      error: "Cloudflare could not return deployment status. Check the API token's Pages permission."
    };
  }
  const payload = await res.json();
  const deployment = Array.isArray(payload.result) ? payload.result[0] : null;
  if (!deployment) return { configured: true, available: true, run: null };
  // Cloudflare reports stage-level progress; the latest stage carries the
  // outcome we surface as a single status.
  const stage = deployment.latest_stage || {};
  const stageStatus = stage.status || "";
  const done = ["success", "failure", "canceled", "skipped"].includes(stageStatus);
  return {
    configured: true,
    available: true,
    run: {
      id: deployment.id,
      status: done ? "completed" : "in_progress",
      conclusion: done ? (stageStatus === "success" ? "success" : stageStatus) : null,
      event: stage.name || "deploy",
      title: commitSubject(deployment.deployment_trigger?.metadata?.commit_message) || "Website deployment",
      url: deployment.url,
      startedAt: deployment.created_on,
      updatedAt: stage.ended_on || stage.started_on || deployment.modified_on,
      headSha: deployment.deployment_trigger?.metadata?.commit_hash || null
    }
  };
}
