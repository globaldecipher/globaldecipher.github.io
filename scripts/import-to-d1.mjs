// One-shot migration: read every content/*.md and emit an INSERT-per-row SQL
// file. Run with:
//   node scripts/import-to-d1.mjs
//   wrangler d1 execute tgd-content --remote --file=worker/migration.sql
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CONTENT_DIR = path.join(ROOT, "content");
const OUT_FILE = path.join(ROOT, "worker", "migration.sql");
const COLLECTIONS = ["news", "opinion", "monitoring", "reports", "profiles", "pages"];

function parseValue(raw) {
  const value = raw.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    return value.slice(1, -1).split(",").map((p) => p.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function parseFrontMatter(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: raw };
  const block = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\n+/, "");
  const data = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) data[m[1]] = parseValue(m[2]);
  }
  return { data, body };
}

const q = (v) => v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
const qBool = (v) => v ? 1 : 0;
const qJson = (v) => Array.isArray(v) ? q(JSON.stringify(v)) : q("[]");

const rows = [];
for (const collection of COLLECTIONS) {
  const dir = path.join(CONTENT_DIR, collection);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    const filePath = path.join(dir, file);
    const { data, body } = parseFrontMatter(filePath);
    const slug = (data.slug || file.replace(/\.md$/, "")).toString();
    rows.push({
      collection,
      slug,
      type: data.type || collection,
      title: data.title || slug,
      date: data.date || null,
      author: data.author || null,
      category: data.category || null,
      region: data.region || null,
      summary: data.summary || null,
      tags: data.tags || [],
      access: data.access || "free",
      sensitivity: data.sensitivity || "standard",
      featured: data.featured ? 1 : 0,
      eyebrow: data.eyebrow || null,
      body
    });
  }
}

const sql = [
  "-- Auto-generated content migration. Idempotent on slug + collection.",
  "DELETE FROM content;",
  ...rows.map((r) =>
    `INSERT INTO content (collection, slug, type, title, date, author, category, region, summary, tags, access, sensitivity, featured, eyebrow, body) VALUES (` +
    [q(r.collection), q(r.slug), q(r.type), q(r.title), q(r.date), q(r.author), q(r.category), q(r.region), q(r.summary), qJson(r.tags), q(r.access), q(r.sensitivity), qBool(r.featured), q(r.eyebrow), q(r.body)].join(", ") +
    ");"
  ),
  ""
].join("\n");

fs.writeFileSync(OUT_FILE, sql, "utf8");
console.log(`Wrote ${rows.length} rows to ${path.relative(ROOT, OUT_FILE)}`);
const byCollection = rows.reduce((acc, r) => { acc[r.collection] = (acc[r.collection] || 0) + 1; return acc; }, {});
console.log("By collection:", byCollection);
