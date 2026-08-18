// Urdu and Pashto editions of the public site.
//
// The English row in D1 stays the only thing an editor writes. A translation is
// a derived copy stored in `content_translations` and keyed by the hash of the
// English text it came from, so editing an article marks its translations stale
// instead of leaving Urdu readers on a version the newsroom has already
// corrected. The static build never calls Gemini — it reads whatever is stored,
// which keeps a deploy from depending on a third-party API being up.
//
// Secret:
//   GEMINI_API_KEY — shared with /api/ask
//
// Optional non-secret vars:
//   TRANSLATE_GEMINI_MODEL     defaults to GEMINI_MODEL, then gemini-3.1-flash-lite
//   TRANSLATE_TIMEOUT_MS       per Gemini call, defaults to 25000ms
//   TRANSLATE_SWEEP_ENABLED    "false" turns off the cron backfill

export const LANGUAGES = {
  ur: { code: "ur", name: "Urdu", native: "اردو", dir: "rtl" },
  ps: { code: "ps", name: "Pashto", native: "پښتو", dir: "rtl" }
};

export const TRANSLATED_LANGS = Object.keys(LANGUAGES);

// `pages` carries the standing site furniture (About, Methodology, Contact) and
// is worth translating; `monitoring` sits behind the paywall and is not built
// into the public language trees.
const TRANSLATABLE_COLLECTIONS = ["news", "opinion", "reports", "profiles", "pages"];

// The incident map and the network graph are interactive apps whose labels live
// in their own JavaScript. The site build leaves both out of the language trees,
// so translating their page shells would burn Gemini calls on output nothing
// renders — and, because they are the largest bodies on the site, would leave a
// permanently failing item that the cron sweep retries forever.
const UNTRANSLATABLE_SLUGS = new Set(["incident-map", "network-graph"]);

const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_TIMEOUT_MS = 25_000;
const FALLBACK_STATUSES = new Set([0, 408, 429, 500, 502, 503, 504]);
// Blocks are batched up to this size before a call. Small enough that a dropped
// placeholder costs one short retry, large enough that a typical article is two
// or three calls rather than twenty.
const MAX_CHUNK_CHARS = 3_500;
const MAX_CHUNKS_PER_ITEM = 60;

function langMeta(lang) {
  const meta = LANGUAGES[String(lang || "").toLowerCase()];
  if (!meta) throw new Error(`Unsupported language: ${lang}`);
  return meta;
}

export function isTranslatedLang(lang) {
  return Boolean(LANGUAGES[String(lang || "").toLowerCase()]);
}

// ---------------------------------------------------------------------------
// Source hashing
// ---------------------------------------------------------------------------

// Bumped whenever the masking rules or the prompt change. It goes into the hash
// so a fix to the translator invalidates every stored translation the same way
// an edit to the English article does, instead of leaving old output in place.
const TRANSLATOR_VERSION = "2";

export async function sourceHashFor(row) {
  const material = [TRANSLATOR_VERSION, row?.title || "", row?.summary || "", row?.eyebrow || "", row?.body || ""].join("\u0000");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

// ---------------------------------------------------------------------------
// Masking — everything a translator must not touch
// ---------------------------------------------------------------------------

// One article carries 400KB of inline base64 images. Handing that to a language
// model would be slow, expensive and lossy, so anything that is markup, a URL or
// binary data is swapped for a short opaque token first and put back afterwards.
const MASK_PATTERNS = [
  /```[\s\S]*?```/g,                                   // fenced code
  /data:[a-zA-Z0-9/;+.-]+;base64,[A-Za-z0-9+/=]+/g,    // inline images
  /<\/?[a-zA-Z][^>]*>/g,                               // HTML tags, attributes and all
  /`[^`\n]+`/g,                                        // inline code
  /\]\([^)\s]+(?:\s+"[^"]*")?\)/g,                     // markdown link and image targets
  /\bhttps?:\/\/[^\s<>()"']+/g                         // bare URLs
];

// Markdown links need their two halves masked separately. Masking only the
// "](url)" tail leaves a bare "[" in front of the label, which a translator
// reads as stray punctuation and quietly deletes — turning the link into plain
// text with a dangling URL. Masking the whole link instead would hide the label
// from translation. So the brackets become tokens and the label stays exposed.
const MARKDOWN_LINK_RE = /(!?\[)([^\]\n]*)(\]\([^)\s]+(?:\s+"[^"]*")?\))/g;

function maskText(input) {
  let text = String(input || "");
  const tokens = [];
  const push = (value) => {
    const token = `@@T${tokens.length}@@`;
    tokens.push(value);
    return token;
  };

  // Fenced code and base64 payloads first: both can contain anything at all,
  // including sequences the later patterns would misread.
  text = text.replace(MASK_PATTERNS[0], push);
  text = text.replace(MASK_PATTERNS[1], push);
  text = text.replace(MARKDOWN_LINK_RE, (match, open, label, tail) => `${push(open)}${label}${push(tail)}`);
  for (const pattern of MASK_PATTERNS.slice(2)) text = text.replace(pattern, push);

  return { text, tokens };
}

// A later pattern can capture an earlier token — a markdown image target masks
// the base64 URI already inside it — so restoring runs until nothing is left to
// expand rather than once.
function unmaskText(input, tokens) {
  let text = String(input || "");
  for (let pass = 0; pass < MASK_PATTERNS.length + 1 && /@@T\d+@@/.test(text); pass += 1) {
    text = text.replace(/@@T(\d+)@@/g, (match, index) => {
      const token = tokens[Number(index)];
      return token === undefined ? match : token;
    });
  }
  return text;
}

function tokensIn(text) {
  return (String(text || "").match(/@@T\d+@@/g) || []).slice().sort();
}

// A model that quietly drops a placeholder would delete an image or a source
// link from the translated article, so a chunk whose tokens do not come back
// intact is rejected rather than published.
function tokensSurvived(source, output) {
  const before = tokensIn(source);
  const after = tokensIn(output);
  return before.length === after.length && before.every((token, i) => token === after[i]);
}

function chunkBlocks(text) {
  const blocks = String(text || "").split(/\n{2,}/);
  const chunks = [];
  let current = "";
  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (current && candidate.length > MAX_CHUNK_CHARS) {
      chunks.push(current);
      current = block;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

function endpointFor(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function modelsFor(env) {
  const primary = env.TRANSLATE_GEMINI_MODEL || env.GEMINI_MODEL || DEFAULT_MODEL;
  const fallback = env.GEMINI_FALLBACK_MODEL || "";
  return fallback && fallback !== primary ? [primary, fallback] : [primary];
}

async function callGemini(env, model, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const payload = /^gemini-3(?:\.|-)/.test(model)
      ? { ...body, generationConfig: { ...body.generationConfig, thinkingConfig: { thinkingLevel: "low" } } }
      : body;
    const res = await fetch(endpointFor(model), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data, message: String(data?.error?.message || "").slice(0, 240) };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      message: error?.name === "AbortError" ? `timed out after ${timeoutMs}ms` : String(error?.message || "network error")
    };
  } finally {
    clearTimeout(timer);
  }
}

function textFrom(result) {
  return (result?.data?.candidates?.[0]?.content?.parts || [])
    .map((part) => part?.text || "")
    .join("")
    .trim();
}

async function generate(env, body) {
  const timeout = positiveInt(env.TRANSLATE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  let last = null;
  for (const model of modelsFor(env)) {
    const result = await callGemini(env, model, body, timeout);
    if (result.ok) return textFrom(result);
    last = result;
    console.error(JSON.stringify({ message: "translation call failed", model, status: result.status, detail: result.message }));
    if (!FALLBACK_STATUSES.has(result.status)) break;
  }
  throw new Error(`Gemini translation failed (${last?.status ?? "no response"}): ${last?.message || "unknown error"}`);
}

function systemPrompt(meta) {
  return [
    `You are a professional news translator for The Global Decipher, a security and counter-terrorism research publication covering Pakistan and the wider region.`,
    `Translate the text the user sends from English into ${meta.name} (${meta.native}).`,
    ``,
    `Rules:`,
    `- Output only the translation. No preamble, no notes, no transliteration in brackets, no explanation of your choices.`,
    `- Preserve the Markdown structure exactly: heading levels, list markers, blockquotes, table pipes, bold and italic markers, and the blank lines between blocks.`,
    `- Placeholders look like @@T12@@. Reproduce every placeholder unchanged and in the same position. Never translate, renumber, reorder, merge or drop one.`,
    `- Keep organisation names, acronyms and unit abbreviations in Latin script exactly as written — TTP, ISKP, ISIS-K, BLA, TGD, CTD, IBO, KP, FC. Do not transliterate or expand them.`,
    `- Reproduce every number, date, casualty figure and rank exactly. Never round a figure, never add one that is not in the source, never omit one.`,
    `- Use the plain factual register of a wire report. Avoid literary, ornate or emotive phrasing.`,
    `- Use the established ${meta.name} spelling of a place or person where one exists; otherwise transliterate faithfully.`,
    `- This is security reporting: translate descriptions of violence plainly and completely. Do not soften, censor or summarise.`
  ].join("\n");
}

async function translateBody(env, meta, body) {
  const source = String(body || "");
  if (!source.trim()) return "";
  const { text, tokens } = maskText(source);
  const chunks = chunkBlocks(text);
  if (chunks.length > MAX_CHUNKS_PER_ITEM) {
    throw new Error(`Article splits into ${chunks.length} chunks, above the ${MAX_CHUNKS_PER_ITEM} limit`);
  }

  const translated = [];
  for (const chunk of chunks) {
    // A block that is nothing but placeholders (a bare image, an HTML embed)
    // has no prose to translate — passing it through saves a call.
    if (!chunk.replace(/@@T\d+@@/g, "").trim()) {
      translated.push(chunk);
      continue;
    }
    let output = "";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      output = await generate(env, {
        system_instruction: { parts: [{ text: systemPrompt(meta) }] },
        contents: [{ role: "user", parts: [{ text: chunk }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
      });
      if (output && tokensSurvived(chunk, output)) break;
      console.warn(JSON.stringify({ message: "translation chunk rejected", lang: meta.code, attempt }));
      output = "";
    }
    // Two bad attempts means the English block stays. A reader seeing one
    // paragraph in English is a far smaller failure than a missing image or a
    // silently deleted sentence.
    translated.push(output || chunk);
  }

  return unmaskText(translated.join("\n\n"), tokens);
}

async function translateFields(env, meta, fields) {
  const entries = Object.entries(fields).filter(([, value]) => String(value || "").trim());
  if (!entries.length) return {};
  const masked = entries.map(([key, value]) => [key, maskText(value)]);
  const payload = Object.fromEntries(masked.map(([key, m]) => [key, m.text]));

  const output = await generate(env, {
    system_instruction: { parts: [{ text: systemPrompt(meta) }] },
    contents: [{
      role: "user",
      parts: [{ text: `Translate each value of this JSON object. Keep the keys unchanged.\n\n${JSON.stringify(payload, null, 2)}` }]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: Object.fromEntries(entries.map(([key]) => [key, { type: "STRING" }])),
        required: entries.map(([key]) => key)
      }
    }
  });

  let parsed = null;
  try { parsed = JSON.parse(output); } catch { parsed = null; }
  const result = {};
  for (const [key, m] of masked) {
    const value = parsed && typeof parsed[key] === "string" ? parsed[key].trim() : "";
    result[key] = value && tokensSurvived(m.text, value) ? unmaskText(value, m.tokens) : fields[key];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

async function saveTranslation(env, { collection, slug, lang, sourceHash, title, summary, eyebrow, body, model }) {
  await env.CONTENT_DB
    .prepare(`INSERT INTO content_translations
        (collection, slug, lang, source_hash, title, summary, eyebrow, body, model, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT (collection, slug, lang) DO UPDATE SET
        source_hash = excluded.source_hash,
        title = excluded.title,
        summary = excluded.summary,
        eyebrow = excluded.eyebrow,
        body = excluded.body,
        model = excluded.model,
        updated_at = excluded.updated_at`)
    .bind(collection, slug, lang, sourceHash, title || "", summary || "", eyebrow || "", body || "", model || "")
    .run();
}

export async function readTranslations(env, collection, lang) {
  const { results } = await env.CONTENT_DB
    .prepare("SELECT slug, source_hash, title, summary, eyebrow, body FROM content_translations WHERE collection = ? AND lang = ?")
    .bind(collection, lang)
    .all();
  const map = new Map();
  for (const row of results || []) map.set(row.slug, row);
  return map;
}

// Rows the public dump hands the site build. A translation whose hash no longer
// matches the English original is treated as absent: the build falls back to
// English for that article rather than publishing a stale Urdu version.
export async function applyTranslations(env, collection, lang, rows) {
  const stored = await readTranslations(env, collection, lang);
  const out = [];
  for (const row of rows) {
    const hit = stored.get(row.slug);
    if (!hit) {
      out.push({ ...row, lang, translated: false });
      continue;
    }
    const hash = await sourceHashFor(row);
    if (hit.source_hash !== hash) {
      out.push({ ...row, lang, translated: false, translation_stale: true });
      continue;
    }
    out.push({
      ...row,
      lang,
      translated: true,
      title: hit.title || row.title,
      summary: hit.summary || row.summary,
      eyebrow: hit.eyebrow || row.eyebrow,
      body: hit.body || row.body
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Batch work
// ---------------------------------------------------------------------------

async function publishedRows(env, collections) {
  const list = collections.filter((name) => TRANSLATABLE_COLLECTIONS.includes(name));
  if (!list.length) return [];
  const placeholders = list.map(() => "?").join(", ");
  const { results } = await env.CONTENT_DB
    .prepare(`SELECT collection, slug, title, summary, eyebrow, body, date
        FROM content
       WHERE collection IN (${placeholders})
         AND (status = 'published' OR collection = 'pages')
       ORDER BY COALESCE(date, '') DESC, slug DESC`)
    .bind(...list)
    .all();
  return (results || []).filter((row) => !UNTRANSLATABLE_SLUGS.has(row.slug));
}

// Everything that has no translation yet, or whose English text moved on since
// the translation was made.
export async function pendingTranslations(env, { langs = TRANSLATED_LANGS, collections = TRANSLATABLE_COLLECTIONS } = {}) {
  const rows = await publishedRows(env, collections);
  const pending = [];
  for (const lang of langs) {
    const byCollection = new Map();
    for (const row of rows) {
      if (!byCollection.has(row.collection)) {
        byCollection.set(row.collection, await readTranslations(env, row.collection, lang));
      }
      const stored = byCollection.get(row.collection).get(row.slug);
      const hash = await sourceHashFor(row);
      if (!stored || stored.source_hash !== hash) {
        pending.push({ row, lang, hash, reason: stored ? "stale" : "missing" });
      }
    }
  }
  return pending;
}

async function translateRow(env, row, lang, hash) {
  const meta = langMeta(lang);
  const fields = await translateFields(env, meta, {
    title: row.title || "",
    summary: row.summary || "",
    eyebrow: row.eyebrow || ""
  });
  const body = await translateBody(env, meta, row.body || "");
  await saveTranslation(env, {
    collection: row.collection,
    slug: row.slug,
    lang,
    sourceHash: hash,
    title: fields.title || row.title,
    summary: fields.summary || row.summary,
    eyebrow: fields.eyebrow || row.eyebrow,
    body,
    model: modelsFor(env)[0]
  });
}

// Translates up to `limit` outstanding items and reports what is left, so a
// caller can loop without ever holding a request open long enough to be killed.
export async function translateMissing(env, { limit = 4, langs = TRANSLATED_LANGS, collections = TRANSLATABLE_COLLECTIONS } = {}) {
  if (!env.GEMINI_API_KEY) return { ok: false, error: "GEMINI_API_KEY is not set", translated: 0, remaining: null, done: false };
  const pending = await pendingTranslations(env, { langs, collections });
  const batch = pending.slice(0, Math.max(1, limit));
  const done = [];
  const failed = [];

  for (const item of batch) {
    try {
      await translateRow(env, item.row, item.lang, item.hash);
      done.push({ collection: item.row.collection, slug: item.row.slug, lang: item.lang, reason: item.reason });
    } catch (error) {
      console.error(JSON.stringify({
        message: "translation failed",
        collection: item.row.collection,
        slug: item.row.slug,
        lang: item.lang,
        error: String(error?.message || error)
      }));
      failed.push({ collection: item.row.collection, slug: item.row.slug, lang: item.lang, error: String(error?.message || error) });
    }
  }

  return {
    ok: true,
    translated: done.length,
    items: done,
    failed,
    remaining: Math.max(0, pending.length - done.length),
    done: pending.length - done.length <= 0
  };
}

// One article across every language — used right after a publish so the Urdu and
// Pashto editions are ready for the rebuild that follows.
export async function translateItem(env, collection, slug, langs = TRANSLATED_LANGS) {
  if (!env.GEMINI_API_KEY) return { ok: false, error: "GEMINI_API_KEY is not set", translated: 0 };
  if (!TRANSLATABLE_COLLECTIONS.includes(collection)) return { ok: true, translated: 0, skipped: "collection" };
  if (UNTRANSLATABLE_SLUGS.has(slug)) return { ok: true, translated: 0, skipped: "interactive page" };
  const { results } = await env.CONTENT_DB
    .prepare("SELECT collection, slug, title, summary, eyebrow, body FROM content WHERE collection = ? AND slug = ? LIMIT 1")
    .bind(collection, slug)
    .all();
  const row = (results || [])[0];
  if (!row) return { ok: false, error: "not found", translated: 0 };

  const hash = await sourceHashFor(row);
  let translated = 0;
  for (const lang of langs) {
    try {
      const stored = (await readTranslations(env, collection, lang)).get(slug);
      if (stored && stored.source_hash === hash) continue;
      await translateRow(env, row, lang, hash);
      translated += 1;
    } catch (error) {
      console.error(JSON.stringify({ message: "translation failed", collection, slug, lang, error: String(error?.message || error) }));
    }
  }
  return { ok: true, translated };
}

export async function translationStatus(env) {
  const rows = await publishedRows(env, TRANSLATABLE_COLLECTIONS);
  const pending = await pendingTranslations(env);
  const byLang = {};
  for (const lang of TRANSLATED_LANGS) {
    const outstanding = pending.filter((item) => item.lang === lang);
    byLang[lang] = {
      language: LANGUAGES[lang].name,
      published: rows.length,
      translated: rows.length - outstanding.length,
      missing: outstanding.filter((item) => item.reason === "missing").length,
      stale: outstanding.filter((item) => item.reason === "stale").length
    };
  }
  return { languages: byLang, pending: pending.length, configured: Boolean(env.GEMINI_API_KEY) };
}

// Exposed for the round-trip test in scripts/test-translate-mask.mjs: masking a
// body and restoring it must return the byte-identical original.
export const __maskingInternals = { maskText, unmaskText, chunkBlocks, tokensSurvived };
