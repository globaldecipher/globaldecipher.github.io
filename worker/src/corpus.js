// Primary-source corpus for the Explorer Ask assistant.
//
// Admin uploads a PDF/DOCX through the site's admin panel. The browser extracts
// the plaintext (pdfjs-dist / mammoth) and POSTs multipart:
//   entity_id  the TGD entity this source belongs to (e.g. "iskp")
//   title      human-readable title shown in citations (optional)
//   text       extracted plaintext of the whole document
//   file       original binary, stored in R2 for durability
//
// The worker:
//   1. saves the original under corpus/<entity_id>/<source_id>-<safe-name>
//   2. chunks the plaintext (~500 words, 60 overlap)
//   3. embeds each chunk with Workers AI (@cf/baai/bge-base-en-v1.5)
//   4. upserts to Vectorize with metadata { entity_id, source_id, chunk_index,
//      title, snippet } so /api/ask can filter by entity and cite chunks.
//
// Uses the same ADMIN_TOKEN guard as other /api/admin endpoints. Callers
// upstream must have already checked auth before dispatching here.

import { baseSecurityHeaders } from "./security.js";

const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
const CHUNK_WORDS = 500;
const CHUNK_OVERLAP = 60;
const EMBED_BATCH = 32;
const UPSERT_BATCH = 500;
const SNIPPET_CHARS = 180;
const MAX_FILE_BYTES = 40 * 1024 * 1024; // 40 MB
const MAX_TEXT_BYTES = 8 * 1024 * 1024; // 8 MB of plaintext per document
const ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "text/markdown"
]);

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: baseSecurityHeaders({ "content-type": "application/json; charset=utf-8", ...extra })
  });
}

function safeName(name) {
  return String(name || "document").replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "document";
}

async function sha256Hex(input) {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Word-based chunking with overlap. Language-agnostic and cheap. Returns
// [{ text, chunk_index, snippet }].
function chunkText(text) {
  const words = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) return [];
  const chunks = [];
  const step = Math.max(CHUNK_WORDS - CHUNK_OVERLAP, 1);
  for (let start = 0, i = 0; start < words.length; start += step, i++) {
    const slice = words.slice(start, start + CHUNK_WORDS);
    if (slice.length === 0) break;
    const chunkText = slice.join(" ");
    chunks.push({
      chunk_index: i,
      text: chunkText,
      snippet: chunkText.slice(0, SNIPPET_CHARS)
    });
    if (start + CHUNK_WORDS >= words.length) break;
  }
  return chunks;
}

async function embedBatch(env, texts) {
  const result = await env.AI.run(EMBED_MODEL, { text: texts });
  const vectors = result?.data;
  if (!Array.isArray(vectors) || vectors.length !== texts.length) {
    throw new Error("Embedding response shape unexpected");
  }
  return vectors;
}

async function embedAll(env, chunks) {
  const out = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH).map((c) => c.text);
    const vecs = await embedBatch(env, batch);
    out.push(...vecs);
  }
  return out;
}

async function upsertChunks(env, entity_id, source_id, title, chunks, vectors) {
  const now = new Date().toISOString();
  const records = chunks.map((chunk, i) => ({
    id: `${entity_id}::${source_id}::${chunk.chunk_index}`,
    values: vectors[i],
    metadata: {
      entity_id,
      source_id,
      title,
      chunk_index: chunk.chunk_index,
      snippet: chunk.snippet,
      ingested_at: now
    }
  }));
  for (let i = 0; i < records.length; i += UPSERT_BATCH) {
    await env.CORPUS_INDEX.upsert(records.slice(i, i + UPSERT_BATCH));
  }
  return records.length;
}

async function readCorpusIndex(env) {
  const raw = await env.INCIDENTS.get("corpus:index");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_e) {
    return {};
  }
}

async function writeCorpusIndex(env, index) {
  await env.INCIDENTS.put("corpus:index", JSON.stringify(index));
}

// KV-backed catalogue of ingested sources so admin can list/delete without
// scanning R2 or Vectorize. Structure: { [entity_id]: { [source_id]: {...} } }.
async function recordSource(env, entity_id, source_id, entry) {
  const index = await readCorpusIndex(env);
  const forEntity = index[entity_id] || {};
  forEntity[source_id] = entry;
  index[entity_id] = forEntity;
  await writeCorpusIndex(env, index);
}

async function forgetSource(env, entity_id, source_id) {
  const index = await readCorpusIndex(env);
  const forEntity = index[entity_id];
  if (!forEntity) return null;
  const entry = forEntity[source_id];
  if (!entry) return null;
  delete forEntity[source_id];
  if (Object.keys(forEntity).length === 0) delete index[entity_id];
  else index[entity_id] = forEntity;
  await writeCorpusIndex(env, index);
  return entry;
}

export async function handleCorpusUpload(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch (_e) {
    return json({ error: "Expected multipart/form-data" }, 400);
  }
  const entity_id = String(form.get("entity_id") || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,80}$/.test(entity_id)) {
    return json({ error: "entity_id is required and must be a slug" }, 400);
  }
  const rawText = String(form.get("text") || "").trim();
  if (!rawText) return json({ error: "text is required (extract in the browser and post here)" }, 400);
  if (rawText.length > MAX_TEXT_BYTES) return json({ error: "Extracted text is too large" }, 413);

  const file = form.get("file");
  if (!(file instanceof File) && !(file && typeof file === "object" && "arrayBuffer" in file)) {
    return json({ error: "file is required" }, 400);
  }
  const size = file.size ?? 0;
  if (size > MAX_FILE_BYTES) return json({ error: `File exceeds ${MAX_FILE_BYTES} bytes` }, 413);
  const mime = String(file.type || "application/octet-stream");
  if (ALLOWED_MIMES.size > 0 && !ALLOWED_MIMES.has(mime)) {
    return json({ error: `Unsupported mime ${mime}` }, 415);
  }

  const filename = safeName(file.name || "document");
  const title = String(form.get("title") || "").trim() || filename;
  const buf = await file.arrayBuffer();
  const source_id = (await sha256Hex(new Uint8Array(buf))).slice(0, 16);
  const key = `corpus/${entity_id}/${source_id}-${filename}`;

  await env.MEDIA.put(key, buf, {
    httpMetadata: { contentType: mime },
    customMetadata: { entity_id, source_id, title }
  });

  const chunks = chunkText(rawText);
  if (chunks.length === 0) {
    return json({ error: "No usable text after chunking" }, 422);
  }
  const vectors = await embedAll(env, chunks);
  const chunk_count = await upsertChunks(env, entity_id, source_id, title, chunks, vectors);

  const entry = {
    source_id,
    entity_id,
    title,
    filename,
    mime,
    bytes: size,
    chunk_count,
    r2_key: key,
    ingested_at: new Date().toISOString()
  };
  await recordSource(env, entity_id, source_id, entry);
  return json({ ok: true, source: entry });
}

export async function handleCorpusList(request, env) {
  const url = new URL(request.url);
  const entity_id = String(url.searchParams.get("entity_id") || "").trim().toLowerCase();
  const index = await readCorpusIndex(env);
  if (entity_id) {
    const forEntity = index[entity_id] || {};
    return json({ entity_id, sources: Object.values(forEntity) });
  }
  const flat = [];
  for (const [eid, sources] of Object.entries(index)) {
    for (const src of Object.values(sources)) flat.push({ ...src, entity_id: eid });
  }
  return json({ sources: flat });
}

export async function handleCorpusDelete(request, env, source_id) {
  const url = new URL(request.url);
  const entity_id = String(url.searchParams.get("entity_id") || "").trim().toLowerCase();
  if (!entity_id) return json({ error: "entity_id query param is required" }, 400);
  const entry = await forgetSource(env, entity_id, source_id);
  if (!entry) return json({ error: "Source not found" }, 404);

  const vectorIds = Array.from({ length: entry.chunk_count || 0 }, (_v, i) => `${entity_id}::${source_id}::${i}`);
  if (vectorIds.length > 0) {
    for (let i = 0; i < vectorIds.length; i += UPSERT_BATCH) {
      try {
        await env.CORPUS_INDEX.deleteByIds(vectorIds.slice(i, i + UPSERT_BATCH));
      } catch (_e) { /* index may already be gone */ }
    }
  }
  try { await env.MEDIA.delete(entry.r2_key); } catch (_e) { /* ok */ }
  return json({ ok: true, source_id });
}

// Retrieval helper for /api/ask. Given a question and a list of entity ids in
// the active neighborhood, embed the question and pull top-k matching chunks.
export async function retrieveCorpusChunks(env, question, entityIds, topK = 6) {
  if (!env.CORPUS_INDEX || !env.AI) return [];
  const ids = (entityIds || []).filter(Boolean);
  if (ids.length === 0) return [];
  let queryVector;
  try {
    const [vec] = await embedBatch(env, [question]);
    queryVector = vec;
  } catch (_e) {
    return [];
  }
  const perEntity = Math.max(1, Math.ceil(topK / ids.length));
  const results = [];
  for (const entity_id of ids) {
    try {
      const res = await env.CORPUS_INDEX.query(queryVector, {
        topK: perEntity,
        filter: { entity_id: { $eq: entity_id } },
        returnMetadata: "all"
      });
      for (const match of res?.matches || []) {
        results.push({
          score: match.score,
          entity_id,
          source_id: match.metadata?.source_id,
          title: match.metadata?.title,
          chunk_index: match.metadata?.chunk_index ?? 0,
          snippet: match.metadata?.snippet || ""
        });
      }
    } catch (_e) {
      // A missing metadata index or transient failure should not break Ask.
      continue;
    }
  }
  results.sort((a, b) => (b.score || 0) - (a.score || 0));
  return results.slice(0, topK);
}
