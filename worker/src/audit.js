// Append-only audit log. Writes one row per admin mutation. Failures are
// swallowed by the caller via ctx.waitUntil — losing an audit entry is bad,
// but it should never block or fail the actual save.

export async function logAudit(env, entry) {
  if (!env.CONTENT_DB) return;
  const now = new Date().toISOString();
  try {
    await env.CONTENT_DB
      .prepare(`INSERT INTO audit_log (timestamp, action, kind, target, label, sha, actor)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        now,
        String(entry.action || "unknown"),
        String(entry.kind || "unknown"),
        String(entry.target || ""),
        entry.label ? String(entry.label) : null,
        entry.sha ? String(entry.sha) : null,
        entry.actor ? String(entry.actor) : null
      )
      .run();
  } catch (err) {
    console.error("audit log write failed:", err.message);
  }
}

export async function listAudit(env, limit = 200) {
  if (!env.CONTENT_DB) return [];
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  const { results } = await env.CONTENT_DB
    .prepare("SELECT timestamp, action, kind, target, label, sha, actor FROM audit_log ORDER BY id DESC LIMIT ?")
    .bind(safeLimit)
    .all();
  return results || [];
}

// Short fingerprint of the bearer token so the activity log can flag a foreign
// key without storing or echoing the secret. Returns the last 4 hex chars of a
// SHA-256 digest — non-reversible and stable across requests.
export async function actorFingerprint(token) {
  if (!token) return null;
  try {
    const bytes = new TextEncoder().encode(String(token));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return hex.slice(-4);
  } catch {
    return null;
  }
}
