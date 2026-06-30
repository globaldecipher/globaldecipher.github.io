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
          type = ?, title = ?, date = ?, author = ?, category = ?, region = ?,
          summary = ?, tags = ?, access = ?, sensitivity = ?, status = ?, published_at = ?, featured = ?,
          eyebrow = ?, body = ?, updated_at = ?
          WHERE id = ? AND updated_at = ?`)
        .bind(
          fm.type || collection,
          fm.title || slug,
          fm.date || null,
          fm.author || null,
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
        type = ?, title = ?, date = ?, author = ?, category = ?, region = ?,
        summary = ?, tags = ?, access = ?, sensitivity = ?, status = ?, published_at = ?, featured = ?,
        eyebrow = ?, body = ?, updated_at = ?
        WHERE id = ?`)
      .bind(
        fm.type || collection,
        fm.title || slug,
        fm.date || null,
        fm.author || null,
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
        (collection, slug, type, title, date, author, category, region, summary, tags, access, sensitivity, status, published_at, featured, eyebrow, body, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        collection,
        slug,
        fm.type || collection,
        fm.title || slug,
        fm.date || null,
        fm.author || null,
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

// Trigger a Pages rebuild by dispatching the existing deploy.yml workflow.
// Uses GitHub's workflow_dispatch API + the existing GITHUB_TOKEN — no
// Cloudflare deploy hook needed. Best-effort: failure here is logged but
// doesn't bubble up to the admin (the D1 save already succeeded).
export async function triggerRebuild(env) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return { triggered: false, reason: "GITHUB_TOKEN/GITHUB_REPO not configured" };
  }
  const ref = env.GITHUB_BRANCH || "main";
  const workflow = env.DEPLOY_WORKFLOW || "deploy.yml";
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: "application/vnd.github+json",
        "user-agent": "tgd-admin-worker",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json"
      },
      body: JSON.stringify({ ref })
    });
    if (!res.ok) {
      const text = await res.text();
      return { triggered: false, status: res.status, reason: text };
    }
    return { triggered: true, status: res.status };
  } catch (err) {
    return { triggered: false, reason: err.message };
  }
}

export async function latestDeployment(env) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return { configured: false, error: "GitHub deployment access is not configured." };
  }
  const workflow = env.DEPLOY_WORKFLOW || "deploy.yml";
  const branch = env.GITHUB_BRANCH || "main";
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${encodeURIComponent(workflow)}/runs?branch=${encodeURIComponent(branch)}&per_page=1`;
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "user-agent": "tgd-admin-worker",
      "x-github-api-version": "2022-11-28"
    }
  });
  if (!res.ok) {
    return {
      configured: true,
      available: false,
      status: res.status,
      error: "GitHub could not return deployment status. Check the token's Actions permission."
    };
  }
  const payload = await res.json();
  const run = Array.isArray(payload.workflow_runs) ? payload.workflow_runs[0] : null;
  if (!run) return { configured: true, available: true, run: null };
  return {
    configured: true,
    available: true,
    run: {
      id: run.id,
      status: run.status,
      conclusion: run.conclusion,
      event: run.event,
      title: run.display_title,
      url: run.html_url,
      startedAt: run.run_started_at || run.created_at,
      updatedAt: run.updated_at,
      headSha: run.head_sha
    }
  };
}
