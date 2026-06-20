// Thin wrapper over the GitHub Contents API.
// Lets the admin panel create/update/delete Markdown files in content/ — each
// write is a commit to `main`, which triggers the deploy Action and rebuilds
// the static site. The GITHUB_TOKEN never leaves the Worker.

const API = "https://api.github.com";

function authHeaders(env) {
  return {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept: "application/vnd.github+json",
    "user-agent": "tgd-admin-worker",
    "x-github-api-version": "2022-11-28"
  };
}

// UTF-8 safe base64 (btoa only handles Latin-1; content has em dashes etc.).
export function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(String(b64 || "").replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function repo(env) {
  const r = env.GITHUB_REPO;
  if (!r) throw new Error("GITHUB_REPO is not configured");
  return r;
}

function branch(env) {
  return env.GITHUB_BRANCH || "main";
}

async function ghFetch(env, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...authHeaders(env), ...(init.headers || {}) }
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const message = body?.message || `GitHub API ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return body;
}

// List Markdown files in a content folder. Returns [{name, path, slug}].
export async function listContent(env, folder) {
  const safe = String(folder || "").replace(/[^a-z0-9/_-]/gi, "");
  const items = await ghFetch(env, `/repos/${repo(env)}/contents/content/${safe}?ref=${branch(env)}`);
  if (!Array.isArray(items)) return [];
  return items
    .filter((it) => it.type === "file" && it.name.endsWith(".md"))
    .map((it) => ({ name: it.name, path: it.path, slug: it.name.replace(/\.md$/, "") }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

// Read one file. Returns {path, content, sha}.
export async function getFile(env, filePath) {
  const safe = sanitizePath(filePath);
  const data = await ghFetch(env, `/repos/${repo(env)}/contents/${safe}?ref=${branch(env)}`);
  return { path: safe, content: fromBase64(data.content), sha: data.sha };
}

// Create or update a file. Pass sha to update an existing file, omit to create.
export async function putFile(env, filePath, content, message, sha) {
  const safe = sanitizePath(filePath);
  const payload = {
    message: message || `Update ${safe}`,
    content: toBase64(content),
    branch: branch(env)
  };
  if (sha) payload.sha = sha;
  const data = await ghFetch(env, `/repos/${repo(env)}/contents/${safe}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  return { path: safe, sha: data.content?.sha, commit: data.commit?.sha };
}

// Delete a file (sha required).
export async function deleteFile(env, filePath, sha, message) {
  const safe = sanitizePath(filePath);
  if (!sha) throw new Error("sha is required to delete a file");
  const data = await ghFetch(env, `/repos/${repo(env)}/contents/${safe}`, {
    method: "DELETE",
    body: JSON.stringify({ message: message || `Delete ${safe}`, sha, branch: branch(env) })
  });
  return { path: safe, commit: data.commit?.sha };
}

// Only allow writes under content/ and only .md files. Prevents path traversal.
function sanitizePath(filePath) {
  const p = String(filePath || "").replace(/\\/g, "/").replace(/\.\.+/g, "").replace(/^\/+/, "");
  if (!p.startsWith("content/") || !p.endsWith(".md")) {
    throw new Error("Path must be a Markdown file under content/");
  }
  return p;
}
