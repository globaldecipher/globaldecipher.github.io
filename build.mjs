import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sanitizeHtml from "sanitize-html";
import { buildSync } from "esbuild";
import {
  DEFAULT_LOCALE,
  LOCALES,
  RTL_FONT_HREF,
  TRANSLATED_LOCALES,
  localeFor,
  localePath
} from "./build-i18n.mjs";

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, "content");
const STATIC_DIR = path.join(ROOT, "static");
const OUT_DIR = path.join(ROOT, "site");
const TRUSTED_INLINE_SCRIPT_HASH = "sha256-Kpwr9vcpJlFefP21kj5wxp1RRGuoz9dcBziMdZGoNmc=";

// styles.css and main.js keep stable filenames, so browsers hold the previous
// copy for the full max-age after a deploy. The digest goes in the filename
// rather than a ?v= query because the CDN caches these by path and serves the
// old body back for a new query string.
function fileStamp(file) {
  const full = path.join(STATIC_DIR, file);
  if (!fs.existsSync(full)) return "";
  return crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex").slice(0, 10);
}
function stampedName(file) {
  const stamp = fileStamp(file);
  if (!stamp) return file;
  const ext = path.extname(file);
  return `${file.slice(0, -ext.length)}.${stamp}${ext}`;
}
const STYLES_ASSET = stampedName("styles.css");
const MAIN_ASSET = stampedName("main.js");
const MARK_ASSET = stampedName("tgd-mark.svg");

// Write the digest-named copies alongside the originals so both URLs resolve.
function writeStampedAssets(outAssetsDir) {
  for (const [source, stamped] of [["styles.css", STYLES_ASSET], ["main.js", MAIN_ASSET], ["tgd-mark.svg", MARK_ASSET]]) {
    if (source === stamped) continue;
    const from = path.join(outAssetsDir, source);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(outAssetsDir, stamped));
  }
}

const SITE = {
  title: "The Global Decipher",
  shortTitle: "TGD",
  tagline: "Tracking terror threats in Pakistan and the wider region.",
  description:
    "Independent, research-first coverage of terrorism, militant networks, and security risk — focused on Pakistan, with regional and global context.",
  url: "https://theglobaldecipher.com",
  defaultImage: "/assets/brand/tgd-og-default-v2.png",
  email: "contact@theglobaldecipher.com",
  x: "https://x.com/Global_Decipher",
  whatsapp: "https://whatsapp.com/channel/0029Vb6AWm29WtC2xIe0Yo31",
  substack: "https://theglobaldecipher.substack.com/",
  googleVerificationFile: "googleda3d28215a677373.html"
};

// The Monitoring Desk is retired from the public site for now. Its content and
// paywall stay intact in D1 and the Worker — flip this to true to bring the
// whole category back.
const SHOW_MONITORING = false;

// ---------------------------------------------------------------------------
// Language editions
// ---------------------------------------------------------------------------
//
// The site is generated once per language. Everything below reads the language
// currently being written from LOCALE, so the page templates stayed as they
// were: `writePage("/news/")` lands in site/news/ for English and site/ur/news/
// for Urdu, and `linkFor` keeps every internal link inside its own tree.

let LOCALE = DEFAULT_LOCALE;

// Interface copy for the language being built. Falls back to English for any
// string a locale has not translated yet, so a missing key degrades to readable
// rather than to "undefined" on a live page.
function t(key) {
  const value = LOCALE.strings[key];
  return value === undefined ? (DEFAULT_LOCALE.strings[key] ?? key) : value;
}

function localized(urlPath) {
  return localePath(urlPath, LOCALE);
}

// Which unprefixed paths actually exist in each language, filled in before any
// page is written. An article with no Urdu translation is absent from the Urdu
// tree, and must therefore not be advertised in an hreflang tag pointing at a
// 404 — Search Console reports those as errors and can drop the whole cluster.
const LOCALE_PAGES = new Map(Object.keys(LOCALES).map((code) => [code, new Set()]));

function registerLocalePages(code, paths) {
  const set = LOCALE_PAGES.get(code);
  if (!set) return;
  for (const urlPath of paths) set.add(urlPath);
}

function alternatesFor(urlPath) {
  return Object.values(LOCALES)
    .filter((locale) => LOCALE_PAGES.get(locale.code)?.has(urlPath))
    .map((locale) => ({ locale, href: `${SITE.url}${localePath(urlPath, locale)}` }));
}

function navItems() {
  return [
    [t("navNews"), "/news/"],
    [t("navOpinion"), "/opinion/"],
    ...(SHOW_MONITORING ? [[t("navMonitoring"), "/monitoring/"]] : []),
    // The incident map and the network graph are interactive apps whose own
    // labels are English-only, so the language trees link back to the English
    // build of both rather than shipping a half-translated tool.
    ...(LOCALE.code === "en"
      ? [[t("navIncidentMap"), "/incident-map/"], [t("navNetworkGraph"), "/network-graph/"]]
      : []),
    [t("navReports"), "/reports/"],
    [t("navContact"), "/contact/"]
  ];
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function rmDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  ensureDir(to);
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

function copyVendorAssets() {
  const vendorDir = path.join(OUT_DIR, "assets", "vendor");
  ensureDir(vendorDir);
  const files = [
    ["node_modules/@toast-ui/editor/dist/toastui-editor.css", "toastui-editor.css"],
    ["node_modules/@toast-ui/editor/dist/theme/toastui-editor-dark.css", "toastui-editor-dark.css"],
    ["node_modules/mammoth/mammoth.browser.min.js", "mammoth.browser.min.js"],
    ["node_modules/turndown/dist/turndown.js", "turndown.js"],
    ["node_modules/turndown-plugin-gfm/dist/turndown-plugin-gfm.js", "turndown-plugin-gfm.js"],
    ["node_modules/jszip/dist/jszip.min.js", "jszip.min.js"]
  ];
  for (const [source, destination] of files) {
    fs.copyFileSync(path.join(ROOT, source), path.join(vendorDir, destination));
  }
  // The package's prebuilt `toastui-editor.js` deliberately leaves its
  // ProseMirror dependencies external. It works in a module-aware build but
  // not when loaded directly in the admin browser. Bundle the ESM entry and
  // all of its dependencies into one same-origin, CSP-compatible browser file.
  buildSync({
    entryPoints: [path.join(ROOT, "scripts", "vendor-toastui-editor.js")],
    outfile: path.join(vendorDir, "toastui-editor.js"),
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    legalComments: "inline",
    define: {
      "process.env.NODE_ENV": '"production"'
    }
  });
}

function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripMarkdown(value = "") {
  return String(value)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function plainTextFromHtml(value = "") {
  return String(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseValue(raw) {
  const value = raw.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((part) => part.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function parseFrontMatter(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.startsWith("---")) {
    return { data: {}, body: raw };
  }
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: raw };
  const block = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).trim();
  const data = {};
  for (const line of block.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) data[match[1]] = parseValue(match[2]);
  }
  return { data, body };
}

// Detect a line that's an HTML block (starts with < and a tag name).
// Lets you paste raw <iframe>, <div>, <video>, <img> etc. for chart embeds.
const HTML_LINE_RE = /^<\s*(\/?[a-zA-Z][a-zA-Z0-9-]*)/;
const VOID_OR_INLINE_HTML_RE = /^<\s*(br|hr|img|input|meta|link|source)\b/i;

function sanitizeRawHtmlBlock(raw) {
  if (/^<script\b/i.test(raw)) {
    const scriptPattern = /<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi;
    const scripts = [...raw.matchAll(scriptPattern)].map((match) => match[0]);
    if (!scripts.length || raw.replace(scriptPattern, "").trim()) return "";
    const safeScripts = scripts.map((script) => {
      const inlineScript = script.match(/^<script>([\s\S]*)<\/script>$/i);
      if (inlineScript) {
        const hash = `sha256-${crypto.createHash("sha256").update(inlineScript[1]).digest("base64")}`;
        return hash === TRUSTED_INLINE_SCRIPT_HASH ? script : "";
      }
      const externalScript = script.match(/^<script\s+src="([^"]+)"(?:\s+defer)?><\/script>$/i);
      if (!externalScript) return "";
      return /^\/assets\/(?:incident-map|network-graph)\.js(?:\?[-\w=.]+)?$/.test(externalScript[1])
        ? script
        : "";
    });
    return safeScripts.every(Boolean) ? safeScripts.join("\n") : "";
  }
  return sanitizeHtml(raw, {
    allowedTags: [
      "section", "div", "p", "h2", "h3", "h4", "span", "strong", "em", "small",
      "a", "button", "label", "input", "select", "option", "aside", "article",
      "figure", "figcaption", "img", "video", "source", "iframe", "object", "canvas",
      "ul", "ol", "li", "dl", "dt", "dd", "table", "thead", "tbody", "tr", "th",
      "td", "br", "hr"
    ],
    allowedAttributes: {
      "*": ["class", "id", "role", "aria-*", "data-*", "hidden", "tabindex", "title"],
      a: ["href", "target", "rel"],
      input: ["type", "placeholder", "value", "name", "checked", "disabled"],
      select: ["name", "disabled"],
      option: ["value", "selected"],
      img: ["src", "alt", "title", "loading", "decoding", "width", "height"],
      iframe: ["src", "title", "allow", "allowfullscreen", "loading", "referrerpolicy"],
      object: ["data", "type"],
      video: ["controls", "src", "poster", "preload"],
      source: ["src", "type"],
      canvas: ["width", "height"]
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    allowedIframeHostnames: ["www.youtube-nocookie.com", "player.vimeo.com"],
    allowProtocolRelative: false,
    exclusiveFilter(frame) {
      return frame.tag === "object" && !String(frame.attribs?.data || "").startsWith("/assets/");
    }
  });
}

function inlineMarkdown(text) {
  let out = escapeHtml(text);
  // Image: ![alt](url) — runs BEFORE links to avoid ![]() being read as ! + []().
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_m, alt, src, title) => {
    const titleAttr = title ? ` title="${title}"` : "";
    return `<img alt="${alt}" src="${src}"${titleAttr} loading="lazy" decoding="async">`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  out = out.replace(/\[([^\]]+)\]\((mailto:[^)]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(/\[([^\]]+)\]\((\/[^)]+)\)/g, '<a href="$2">$1</a>');
  // Re-allow stored image tags to keep raw src/alt (escapeHtml only ran on text input).
  return out;
}

function parseTableRow(line) {
  // Split a markdown table row like "| a | b | c |" into cells.
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isTableSeparator(line) {
  // Header separator row: | --- | :---: | ---: |
  const cells = parseTableRow(line);
  if (!cells.length) return false;
  return cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let list = [];
  let quote = [];
  const headingIds = new Map();

  function headingId(text) {
    const base = slugify(stripMarkdown(text)) || "section";
    const count = headingIds.get(base) || 0;
    headingIds.set(base, count + 1);
    return count ? `${base}-${count + 1}` : base;
  }

  function flushParagraph() {
    if (paragraph.length) {
      // Standalone image line → wrap in <figure> for nice presentation.
      const joined = paragraph.join(" ");
      const onlyImage = joined.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);
      if (onlyImage) {
        const alt = onlyImage[1];
        const src = onlyImage[2];
        const title = onlyImage[3];
        const caption = title || alt;
        const titleAttr = title ? ` title="${title}"` : "";
        html.push(`<figure class="article-figure"><img alt="${alt}" src="${src}"${titleAttr} loading="lazy" decoding="async">${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`);
      } else {
        html.push(`<p>${inlineMarkdown(joined)}</p>`);
      }
      paragraph = [];
    }
  }

  function flushList() {
    if (list.length) {
      html.push(`<ul>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
      list = [];
    }
  }

  function flushQuote() {
    if (quote.length) {
      html.push(`<blockquote>${quote.map((item) => `<p>${inlineMarkdown(item)}</p>`).join("")}</blockquote>`);
      quote = [];
    }
  }

  function flushAll() {
    flushParagraph();
    flushList();
    flushQuote();
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      flushAll();
      continue;
    }

    // All six heading levels are matched. Anything outside h2–h4 is clamped
    // into that range rather than left to render its hashes as body text: the
    // page already owns the h1, so a `#` in the body becomes an h2. A "heading"
    // holding no words — a lone image, as Word imports tend to produce — is not
    // one, so its content is emitted without the hashes leaking into the copy.
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushAll();
      const content = heading[2];
      // Images are dropped rather than reduced to alt text, so a generic
      // "image" alt cannot pass as heading copy.
      const textual = stripMarkdown(content.replace(/!\[[^\]]*\]\([^)]+\)/g, ""));
      if (textual) {
        const level = Math.min(Math.max(heading[1].length, 2), 4);
        html.push(`<h${level} id="${headingId(content)}">${inlineMarkdown(content)}</h${level}>`);
      } else {
        html.push(`<p>${inlineMarkdown(content)}</p>`);
      }
      continue;
    }

    // Markdown table — look ahead for a separator row on the next non-blank line.
    if (trimmed.includes("|") && trimmed.startsWith("|")) {
      const next = (lines[i + 1] || "").trim();
      if (next && isTableSeparator(next)) {
        flushAll();
        const headers = parseTableRow(trimmed);
        const aligns = parseTableRow(next).map((c) => {
          if (c.startsWith(":") && c.endsWith(":")) return "center";
          if (c.endsWith(":")) return "right";
          return "left";
        });
        const bodyRows = [];
        let j = i + 2;
        while (j < lines.length) {
          const row = (lines[j] || "").trim();
          if (!row || !row.startsWith("|")) break;
          bodyRows.push(parseTableRow(row));
          j++;
        }
        const thead = `<thead><tr>${headers
          .map((h, idx) => `<th${aligns[idx] !== "left" ? ` style="text-align:${aligns[idx]}"` : ""}>${inlineMarkdown(h)}</th>`)
          .join("")}</tr></thead>`;
        const tbody = `<tbody>${bodyRows
          .map(
            (r) =>
              `<tr>${r
                .map((c, idx) => `<td${aligns[idx] !== "left" ? ` style="text-align:${aligns[idx]}"` : ""}>${inlineMarkdown(c)}</td>`)
                .join("")}</tr>`
          )
          .join("")}</tbody>`;
        html.push(`<div class="article-table-wrap"><table class="article-table">${thead}${tbody}</table></div>`);
        i = j - 1;
        continue;
      }
    }

    // Rich embeds are allowlisted and sanitized before entering a generated page.
    if (HTML_LINE_RE.test(trimmed) && !VOID_OR_INLINE_HTML_RE.test(trimmed)) {
      flushAll();
      const block = [trimmed];
      while (i + 1 < lines.length && lines[i + 1].trim() !== "") {
        i++;
        block.push(lines[i]);
      }
      const sanitized = sanitizeRawHtmlBlock(block.join("\n"));
      if (sanitized) html.push(`<div class="article-embed">${sanitized}</div>`);
      continue;
    }

    if (trimmed.startsWith("> ")) {
      flushParagraph();
      flushList();
      quote.push(trimmed.slice(2));
      continue;
    }

    if (/^- /.test(trimmed)) {
      flushParagraph();
      flushQuote();
      list.push(trimmed.slice(2));
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(trimmed);
  }

  flushAll();
  return html.join("\n");
}

// Content is fetched at build time from the Worker (D1-backed).
// Override with CONTENT_API env var for local development.
const CONTENT_API = process.env.CONTENT_API || "https://theglobaldecipher.com/api";
const CONTENT_DUMP_TOKEN = process.env.CONTENT_DUMP_TOKEN || "";

function refreshManagedAssetUrls(value = "") {
  return String(value)
    .replace(/\/assets\/incident-map\.css(?:\?[^\s"'>]*)?/g, "/assets/incident-map.css?v=20260705-daily-first")
    .replace(/\/assets\/incident-map\.js(?:\?[^\s"'>]*)?/g, "/assets/incident-map.js?v=20260705-casualty-fix")
    .replace(
      '<p class="tracker-kicker">TGD PUBLIC-SOURCE MONITORING</p>',
      '<p class="tracker-kicker">Daily security record</p>'
    )
    .replace(
      '<label class="tracker-date-control">Selected date<input data-filter="date" type="date" aria-label="Select archive date"></label>',
      '<label class="tracker-date-control">Choose a date<input data-filter="date" type="date" aria-label="Choose a date to view"></label>'
    )
    .replace(/\s*<div class="tracker-timeline" data-timeline aria-label="Timeline shortcuts"><\/div>/g, "")
    .replace(/\s*<button(?: class="[^"]*")? type="button" data-view-tab="weekly">Weekly analysis<\/button>/g, "")
    .replace(/\s*<section class="tracker-analytics" data-weekly-analytics data-view-panel="weekly" aria-label="Weekly incident graphs"><\/section>/g, "")
    .replace(
      /<object class="tracker-pakistan-map" data="\/assets\/pakistan-map\.svg(?:\?[^"]*)?" type="image\/svg\+xml" aria-hidden="true" tabindex="-1"><\/object>/g,
      '<img class="tracker-pakistan-map tracker-pakistan-map-fallback" src="/assets/pakistan-map.svg?v=20260704-agent-refresh" alt="" aria-hidden="true">' +
        '<div class="tracker-pakistan-map tracker-pakistan-map-inline" data-interactive-map role="img" aria-label="Interactive provincial map of Pakistan"></div>'
    );
}

// A deploy must not fail because the content API blinked. Transient network
// errors and 5xx responses are retried with a widening delay; a 4xx is a real
// answer and is returned immediately.
async function fetchCollection(collection, headers, attempts = 4, lang = "en") {
  const url = lang === "en"
    ? `${CONTENT_API}/content/dump?folder=${encodeURIComponent(collection)}`
    : `${CONTENT_API}/content/dump?folder=${encodeURIComponent(collection)}&lang=${encodeURIComponent(lang)}`;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
      if (res.ok || (res.status >= 400 && res.status < 500)) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      const delay = 1000 * 2 ** (attempt - 1);
      console.warn(`Retrying ${collection} in ${delay}ms (${lastError?.message || "no response"}).`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error(`Failed to fetch ${collection} from ${CONTENT_API} after ${attempts} attempts: ${lastError?.message || "unknown error"}`);
}

// `lang` other than "en" asks the API for that language's edition. Anything not
// translated yet comes back flagged and is dropped here, so a language tree only
// ever contains pages that are genuinely in that language.
async function readCollection(collection, lang = "en") {
  const headers = {
    accept: "application/json",
    "user-agent": "TGD-Site-Builder/1.0"
  };
  if (collection === "monitoring" && CONTENT_DUMP_TOKEN) {
    headers.authorization = `Bearer ${CONTENT_DUMP_TOKEN}`;
  }
  const res = await fetchCollection(collection, headers, 4, lang);
  const allowPartialBuild = process.env.ALLOW_PARTIAL_CONTENT_BUILD === "1" || process.env.CI !== "true";
  if ([401, 403].includes(res.status) && !CONTENT_DUMP_TOKEN && allowPartialBuild) {
    console.warn(`Skipping protected ${collection} content in partial build (CONTENT_DUMP_TOKEN is not set).`);
    return [];
  }
  if (!res.ok) throw new Error(`Failed to fetch ${collection} from ${CONTENT_API}: HTTP ${res.status}`);
  const { items } = await res.json();
  return (items || [])
    .filter((row) => collection === "pages" || row.status === "published")
    .filter((row) => lang === "en" || row.translated === true)
    .map((row) => {
      const slug = slugify(row.slug);
      if (!slug) throw new Error(`Invalid slug for ${collection} row: ${row.slug}`);
      const data = {
        title: row.title,
        date: row.date,
        author: row.author,
        author_bio: row.author_bio,
        image: row.image,
        image_alt: row.image_alt,
        type: row.type,
        category: row.category,
        region: row.region,
        summary: row.summary,
        tags: row.tags || [],
        access: collection === "monitoring" ? "paid" : row.access,
        sensitivity: row.sensitivity,
        status: row.status || (collection === "pages" ? "published" : "draft"),
        featured: row.featured,
        eyebrow: row.eyebrow
      };
      const body = refreshManagedAssetUrls(row.body || "");
      return {
        ...data,
        collection,
        slug,
        body,
        html: markdownToHtml(body),
        url: collection === "pages" ? `/${slug}/` : `/${collection}/${slug}/`
      };
    })
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

function formatDate(date) {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  // Urdu and Pashto readers get their own month names and digits; the ISO date
  // in the JSON-LD and the sitemap stays machine-readable either way. The
  // calendar is pinned to Gregorian because Pashto otherwise defaults to the
  // Afghan solar calendar, which would date a Pakistani security brief in a
  // different year from the English and Urdu versions of the same article.
  return new Intl.DateTimeFormat(`${LOCALE.code}-u-ca-gregory`, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(parsed);
}

// Monthly reports get uploaded in batches with the same upload date, so the
// `date` field can't order them. The report title always names its month/year
// (e.g. "…January 2026"); this pulls that out as a sortable YYYYMM number and
// falls back to the item date when the title is atypical.
const REPORT_MONTH_INDEX = new Map([
  ["january", 1], ["february", 2], ["march", 3], ["april", 4],
  ["may", 5], ["june", 6], ["july", 7], ["august", 8],
  ["september", 9], ["october", 10], ["november", 11], ["december", 12]
]);
function reportPeriodKey(item) {
  const title = String(item?.title || "").toLowerCase();
  const match = title.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/);
  if (match) return Number(match[2]) * 100 + REPORT_MONTH_INDEX.get(match[1]);
  const fromDate = String(item?.date || "").match(/^(\d{4})-(\d{2})/);
  if (fromDate) return Number(fromDate[1]) * 100 + Number(fromDate[2]);
  return 0;
}

function typeLabel(type = "") {
  const labels = {
    news: t("typeNews"),
    opinion: t("typeOpinion"),
    monitoring: t("typeMonitoring"),
    reports: t("typeReports"),
    profiles: t("typeProfiles"),
    page: t("typePage")
  };
  return labels[type] || type;
}

function routeForType(type = "") {
  const routes = {
    news: "/news/",
    opinion: "/opinion/",
    monitoring: "/monitoring/",
    reports: "/reports/",
    profiles: "/profiles/"
  };
  return routes[type] || "/";
}

function collectHeadings(markdown = "") {
  const counts = new Map();
  return markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      const match = line.trim().match(/^(#{2,3})\s+(.+)$/);
      if (!match) return null;
      const title = stripMarkdown(match[2]);
      const base = slugify(title) || "section";
      const count = counts.get(base) || 0;
      counts.set(base, count + 1);
      return {
        level: match[1].length,
        title,
        id: count ? `${base}-${count + 1}` : base
      };
    })
    .filter(Boolean);
}

function extractSection(markdown = "", heading = "") {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const wanted = heading.toLowerCase();
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].trim().match(/^##\s+(.+)$/);
    if (match && stripMarkdown(match[1]).toLowerCase() === wanted) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return "";
  const block = [];
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i].trim())) break;
    block.push(lines[i]);
  }
  return block.join("\n").trim();
}

function firstParagraph(markdown = "") {
  return stripMarkdown(
    markdown
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .find(Boolean) || ""
  );
}

function extractListValue(markdown = "", label = "") {
  const re = new RegExp(`^-\\s+\\*\\*${label}:\\*\\*\\s*(.+)$`, "im");
  const match = markdown.match(re);
  return match ? stripMarkdown(match[1]) : "";
}

function profileStatus(item) {
  const status = firstParagraph(extractSection(item.body, "Status"));
  if (/deceased|killed|executed/i.test(status)) return "Deceased";
  if (/^active\b/i.test(status)) return "Active";
  if (/custody|convicted|imprisoned|detained|prison/i.test(status)) return "In custody";
  if (/wanted|fugitive|reward/i.test(status)) return "Wanted";
  if (/uncertain|unknown|whereabouts/i.test(status)) return "Uncertain";
  return status ? "Documented" : "Profile";
}

function profileFacts(item) {
  const identification = extractSection(item.body, "Identification");
  const tags = Array.isArray(item.tags) ? item.tags : [];
  return [
    ["Status", profileStatus(item)],
    ["Organisation", extractListValue(identification, "Organisation") || tags[0] || ""],
    ["Role", extractListValue(identification, "Role") || item.category || ""],
    ["Region", item.region || ""],
    ["Updated", formatDate(item.date)]
  ].filter(([, value]) => value);
}

function extractReportMetrics(markdown = "") {
  const metrics = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/^##\s+Report at a glance/i.test(lines[i].trim())) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const row = lines[j].trim();
      if (/^##\s+/.test(row)) break;
      if (!row.startsWith("|") || isTableSeparator(row)) continue;
      const cells = parseTableRow(row);
      if (cells.length >= 2 && !/^metric$/i.test(cells[0])) {
        metrics.push([stripMarkdown(cells[0]), stripMarkdown(cells[1])]);
      }
    }
    break;
  }
  return metrics;
}

function extractPdfLinks(markdown = "") {
  return [...markdown.matchAll(/\[([^\]]+)\]\(([^)]+\.pdf)\)/gi)].map((match) => ({
    label: stripMarkdown(match[1]),
    href: match[2]
  }));
}

function depthFor(urlPath) {
  if (/^\/[^/]+\.html$/.test(urlPath)) return 0;
  if (urlPath === "/") return 0;
  return urlPath.replace(/^\/|\/$/g, "").split("/").filter(Boolean).length;
}

function prefixFor(urlPath) {
  return "../".repeat(depthFor(urlPath));
}

// Links stay inside the language tree they were written in, except where that
// page does not exist there — an untranslated article, the two interactive
// apps, the tag hubs, the admin panel. Those cross back to English rather than
// point at a directory the build never wrote, so no language tree can contain a
// dead internal link.
function linkFor(url, currentPath = "/") {
  if (/^https?:\/\//.test(url) || url.startsWith("mailto:")) return url;
  const inLocale = LOCALE.code === "en" || LOCALE_PAGES.get(LOCALE.code)?.has(url);
  const to = localePath(url, inLocale ? LOCALE : DEFAULT_LOCALE);
  const prefix = prefixFor(localized(currentPath));
  if (to === "/") return `${prefix}index.html`;
  return `${prefix}${to.replace(/^\/|\/$/g, "")}/index.html`;
}

function absoluteUrl(url = "/") {
  if (/^https?:\/\//.test(url)) return url;
  const clean = url.startsWith("/") ? url : `/${url}`;
  return `${SITE.url}${clean}`;
}

function canonicalFor(pagePath = "/") {
  return `${SITE.url}${localized(pagePath === "/" ? "/" : pagePath)}`;
}

function escapeXml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function accessLabel(item) {
  if (item.access === "paid") return `<span class="badge badge-premium">${escapeHtml(t("badgePaid"))}</span>`;
  if (item.access === "premium-preview") return `<span class="badge badge-premium">${escapeHtml(t("badgePremium"))}</span>`;
  if (item.sensitivity === "research-sensitive") return `<span class="badge badge-research">${escapeHtml(t("badgeResearch"))}</span>`;
  return `<span class="badge badge-free">${escapeHtml(t("badgeFree"))}</span>`;
}

function brandMark(prefix = "", variant = "header") {
  const file = variant === "footer" ? "tgd-logo-footer-v2.png" : "tgd-logo-header-v2.png";
  const small = variant === "footer" ? "tgd-logo-footer-420-v2.png" : "tgd-logo-header-420-v2.png";
  const large = variant === "footer" ? "tgd-logo-footer-840-v2.png" : "tgd-logo-header-840-v2.png";
  if (variant === "footer") {
    return `<img class="brand-logo" src="${prefix}assets/brand/${small}" srcset="${prefix}assets/brand/${small} 420w, ${prefix}assets/brand/${large} 840w, ${prefix}assets/brand/${file} 1254w" sizes="(max-width: 560px) 210px, 280px" alt="The Global Decipher" width="420" height="420">`;
  }
  return `<span class="brand-picture">
    <img class="brand-logo brand-logo-light" src="${prefix}assets/brand/tgd-logo-header-420-v2.png" srcset="${prefix}assets/brand/tgd-logo-header-420-v2.png 420w, ${prefix}assets/brand/tgd-logo-header-840-v2.png 840w, ${prefix}assets/brand/tgd-logo-header-v2.png 1254w" sizes="(max-width: 560px) 210px, 280px" alt="The Global Decipher" width="420" height="420">
    <img class="brand-logo brand-logo-dark" src="${prefix}assets/brand/tgd-logo-footer-420-v2.png" srcset="${prefix}assets/brand/tgd-logo-footer-420-v2.png 420w, ${prefix}assets/brand/tgd-logo-footer-840-v2.png 840w, ${prefix}assets/brand/tgd-logo-footer-v2.png 1254w" sizes="(max-width: 560px) 210px, 280px" alt="The Global Decipher" width="420" height="420">
  </span>`;
}

function icon(name) {
  const icons = {
    whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.6 14.4c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-1 1.2-.2.2-.4.2-.7 0-.3-.2-1.3-.5-2.5-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.7.1-.1.3-.4.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.6 0-.2-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4 0 1.4 1 2.8 1.2 3 .2.2 2.1 3.2 5.1 4.4.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.4 1.3 4.9L2 22l5.2-1.3C8.6 21.5 10.2 22 12 22c5.5 0 10-4.5 10-10S17.5 2 12 2z"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 6l9 7 9-7"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4h11a4 4 0 014 4v12H8a4 4 0 01-4-4V4z"/><path d="M4 16a4 4 0 014-4h11"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12.8A8.7 8.7 0 1111.2 3a6.8 6.8 0 009.8 9.8z"/></svg>'
  };
  return icons[name] || "";
}

function isoDateForItem(item) {
  const raw = (item && item.date) || "";
  if (!raw) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function publisherJsonLd() {
  return {
    "@type": "Organization",
    name: SITE.title,
    url: SITE.url,
    logo: {
      "@type": "ImageObject",
      url: absoluteUrl(SITE.defaultImage)
    }
  };
}

function articleJsonLd(item) {
  const type = item.type === "news" ? "NewsArticle" : item.type === "reports" ? "Report" : "Article";
  const published = isoDateForItem(item);
  const image = absoluteUrl(item.og_image || item.image || SITE.defaultImage);
  const payload = {
    "@context": "https://schema.org",
    "@type": type,
    headline: item.title,
    description: item.summary || SITE.description,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonicalFor(item.url)
    },
    inLanguage: LOCALE.htmlLang,
    image: [image],
    author: {
      "@type": "Person",
      name: item.author || "TGD Desk"
    },
    publisher: publisherJsonLd()
  };
  if (published) {
    payload.datePublished = published;
    payload.dateModified = published;
  }
  if (Array.isArray(item.tags) && item.tags.length) {
    payload.keywords = item.tags.join(", ");
  }
  if (item.region) {
    payload.contentLocation = { "@type": "Place", name: item.region };
  }
  return payload;
}

// SEO: BreadcrumbList schema for article and content subpages
function breadcrumbJsonLd(item) {
  const sectionLabel = typeLabel(item.type);
  const sectionRoute = routeForType(item.type);
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: SITE.title,
        item: SITE.url + "/"
      },
      ...(sectionRoute !== "/" ? [{
        "@type": "ListItem",
        position: 2,
        name: sectionLabel,
        item: SITE.url + sectionRoute
      }] : []),
      {
        "@type": "ListItem",
        position: sectionRoute !== "/" ? 3 : 2,
        name: item.title
      }
    ]
  };
}

// SEO: BreadcrumbList schema for static pages (about, contact, etc.)
function pageBreadcrumbJsonLd(page) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: SITE.title,
        item: SITE.url + "/"
      },
      {
        "@type": "ListItem",
        position: 2,
        name: page.title
      }
    ]
  };
}

// SEO: AboutPage JSON-LD schema
function aboutPageJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: "About TGD",
    url: SITE.url + "/about/",
    description: SITE.description,
    mainEntity: publisherJsonLd()
  };
}

// SEO: ContactPage JSON-LD schema
function contactPageJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "ContactPage",
    name: "Contact",
    url: SITE.url + "/contact/",
    description: `Get in touch with ${SITE.title}`,
    mainEntity: {
      ...publisherJsonLd(),
      contactPoint: {
        "@type": "ContactPoint",
        email: SITE.email || `contact@theglobaldecipher.com`,
        contactType: "editorial"
      }
    }
  };
}

function homepageJsonLd() {
  return [
    {
      "@context": "https://schema.org",
      ...publisherJsonLd(),
      description: SITE.description,
      sameAs: [SITE.x, SITE.substack, SITE.whatsapp].filter(Boolean)
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE.title,
      url: SITE.url,
      potentialAction: {
        "@type": "SearchAction",
        target: `${SITE.url}/?q={search_term_string}`,
        "query-input": "required name=search_term_string"
      }
    }
  ];
}

// A link that deliberately crosses out of the language tree being built — used
// only by the switcher, where the whole point is to leave it.
function localeHref(targetLocale, urlPath, currentPath) {
  const prefix = prefixFor(localized(currentPath));
  const to = localePath(urlPath, targetLocale);
  if (to === "/") return `${prefix}index.html`;
  return `${prefix}${to.replace(/^\/|\/$/g, "")}/index.html`;
}

// Every language is offered on every page. Where this exact article exists in
// the other language the switch keeps the reader on it; where it does not, the
// switch drops them on that language's front page rather than a dead link.
function languageSwitcher(pagePath, alternates) {
  const available = new Set(alternates.map((entry) => entry.locale.code));
  const options = Object.values(LOCALES).map((locale) => {
    const href = localeHref(locale, available.has(locale.code) ? pagePath : "/", pagePath);
    const isCurrent = locale.code === LOCALE.code;
    return `<a class="lang-option${isCurrent ? " is-current" : ""}" lang="${locale.htmlLang}" hreflang="${locale.htmlLang}" href="${href}"${isCurrent ? ' aria-current="true"' : ""}>${escapeHtml(locale.label)}</a>`;
  }).join("");
  return `<nav class="lang-switch" aria-label="${escapeHtml(t("languageLabel"))}">${options}</nav>`;
}

function shell({ title, description, body, current = "", pagePath = "/", extraHead = "", image = SITE.defaultImage, ogType = "website", noindex = false, jsonLd = null }) {
  const pageTitle = title === SITE.title ? `${SITE.title} — Terrorism & Security Risk Analysis` : `${title} | ${SITE.title}`;
  // Assets are written once at the site root and shared by every language, so
  // the "../" depth is counted from the localized path, not the bare one.
  const assetPrefix = prefixFor(localized(pagePath));
  const pageDescription = description || t("siteDescription");
  const canonicalUrl = canonicalFor(pagePath);
  const ogImage = absoluteUrl(image || SITE.defaultImage);
  const jsonLdBlocks = (Array.isArray(jsonLd) ? jsonLd : jsonLd ? [jsonLd] : [])
    .filter(Boolean)
    .map((payload) => `<script type="application/ld+json">${JSON.stringify(payload).replace(/</g, "\\u003c")}</script>`)
    .join("");
  const nav = navItems().map(([label, href]) => {
    const active = current === href || (href !== "/" && pagePath.startsWith(href)) ? ' aria-current="page"' : "";
    return `<a${active} href="${linkFor(href, pagePath)}">${escapeHtml(label)}</a>`;
  }).join("");
  const year = new Date().getUTCFullYear();

  // hreflang is what actually earns the Urdu and Pashto editions their own
  // search listings: it tells Google these are the same article in another
  // language rather than duplicate pages competing with one another.
  const alternates = noindex ? [] : alternatesFor(pagePath);
  const alternateTags = alternates.length > 1
    ? alternates
      .map(({ locale, href }) => `<link rel="alternate" hreflang="${locale.htmlLang}" href="${escapeHtml(href)}">`)
      .join("\n  ")
      + `\n  <link rel="alternate" hreflang="x-default" href="${escapeHtml(alternates.find((entry) => entry.locale.code === "en")?.href || canonicalUrl)}">`
    : "";
  const switcher = languageSwitcher(pagePath, alternates);
  const rtlFont = LOCALE.dir === "rtl" ? `<link rel="stylesheet" href="${RTL_FONT_HREF}">` : "";

  return `<!doctype html>
<html lang="${LOCALE.htmlLang}" dir="${LOCALE.dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(pageDescription)}">
  ${noindex ? '<meta name="robots" content="noindex, follow">' : ""}
  <meta name="theme-color" content="#fafaf7" id="theme-color-meta">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  ${alternateTags}
  <meta property="og:locale" content="${LOCALE.htmlLang}">
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(pageDescription)}">
  <meta property="og:type" content="${escapeHtml(ogType)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${escapeHtml(ogImage)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="${escapeHtml(SITE.title)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(pageTitle)}">
  <meta name="twitter:description" content="${escapeHtml(pageDescription)}">
  <meta name="twitter:image" content="${escapeHtml(ogImage)}">
  <link rel="icon" href="${assetPrefix}assets/${MARK_ASSET}" type="image/svg+xml">
  <link rel="apple-touch-icon" href="${assetPrefix}assets/brand/tgd-logo-header-420-v2.png">
  <link rel="alternate" type="application/rss+xml" title="${escapeHtml(SITE.title)} RSS" href="${SITE.url}/rss.xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..900;1,8..60,400..900&display=swap">
  ${rtlFont}
  <script src="${assetPrefix}assets/theme-init.js"></script>
  <link rel="stylesheet" href="${assetPrefix}assets/${STYLES_ASSET}">
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-ZBZ5Y32RNG"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-ZBZ5Y32RNG');
  </script>
  ${extraHead}
  ${jsonLdBlocks}
</head>
<body>
  <a class="skip-link" href="#main">${escapeHtml(t("skipToContent"))}</a>
  <header class="site-header site-header-centered">
    <div class="container header-stack">
      <div class="header-utility">
        ${switcher}
        <button class="theme-toggle" type="button" aria-label="${escapeHtml(t("themeToggleLabel"))}" data-theme-toggle>
          <span class="theme-icon theme-sun" aria-hidden="true">${icon("sun")}</span>
          <span class="theme-icon theme-moon" aria-hidden="true">${icon("moon")}</span>
        </button>
        <button class="search-btn" type="button" aria-label="${escapeHtml(t("searchLabel"))}" aria-expanded="false" aria-controls="site-search" data-search-toggle>${icon("search")}</button>
        <button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="site-nav" aria-label="${escapeHtml(t("menuLabel"))}"><span></span></button>
      </div>
      <a class="brand brand-center" href="${linkFor("/", pagePath)}" aria-label="${SITE.title} ${escapeHtml(t("homeAria"))}">
        ${brandMark(assetPrefix)}
      </a>
      <div class="header-date" aria-hidden="true"></div>
      <nav class="site-nav site-nav-centered" id="site-nav" aria-label="${escapeHtml(t("navPrimaryLabel"))}">${nav}</nav>
    </div>
    <section class="site-search-panel" id="site-search" data-site-search data-search-index="${assetPrefix}${LOCALE.code === "en" ? "" : `${LOCALE.code}/`}search-index.json" hidden>
      <div class="container site-search-inner">
        <label>
          <span>${escapeHtml(t("headerSearchLabel"))}</span>
          <input type="search" data-site-search-input placeholder="${escapeHtml(t("headerSearchPlaceholder"))}" autocomplete="off">
        </label>
        <div class="site-search-results" data-site-search-results aria-live="polite"></div>
      </div>
    </section>
  </header>
  <main id="main">${body}</main>
  <footer class="site-footer">
    <div class="container footer-grid">
      <div>
        <a class="footer-brand" href="${linkFor("/", pagePath)}">${brandMark(assetPrefix, "footer")}</a>
        <p>${escapeHtml(t("siteDescription"))}</p>
      </div>
      <div>
        <h2>${escapeHtml(t("footerChannels"))}</h2>
        <a href="${SITE.x}" target="_blank" rel="noopener">${escapeHtml(t("footerX"))}</a>
        <a href="${SITE.whatsapp}" target="_blank" rel="noopener">${escapeHtml(t("footerWhatsapp"))}</a>
        <a href="${SITE.substack}" target="_blank" rel="noopener">${escapeHtml(t("footerSubstack"))}</a>
      </div>
      <div>
        <h2>${escapeHtml(t("footerEditorial"))}</h2>
        <a href="${linkFor("/methodology/", pagePath)}">${escapeHtml(t("footerMethodology"))}</a>
        <a href="${linkFor("/corrections-policy/", pagePath)}">${escapeHtml(t("footerCorrections"))}</a>
        <a href="${linkFor("/privacy-policy/", pagePath)}">${escapeHtml(t("footerPrivacy"))}</a>
      </div>
      <div>
        <h2>${escapeHtml(t("footerPitch"))}</h2>
        <a href="mailto:${SITE.email}">${SITE.email}</a>
        <a href="${linkFor("/contact/", pagePath)}">${escapeHtml(t("footerContact"))}</a>
        <a href="${linkFor("/about/", pagePath)}">${escapeHtml(t("footerAbout"))}</a>
      </div>
    </div>
    <div class="container footer-bottom">
      <span>© ${year} ${escapeHtml(t("footerRights"))}</span>
      <span>${escapeHtml(t("footerNote"))}</span>
    </div>
  </footer>
  <script src="${assetPrefix}assets/${MAIN_ASSET}" defer></script>
</body>
</html>`;
}

// The first picture in an article body is, in practice, its lead image — Word
// imports upload every embedded image to R2 already, so this gives existing
// articles a card picture with no extra step for the desk. An explicit
// `image` in the front matter always wins.
// Word import names its uploads "image", "word-image-3" and so on. Carrying
// that through as alt text tells a screen-reader user nothing, so anything that
// is obviously a filename rather than a description falls back to the headline.
function usefulAlt(candidate, fallback) {
  const text = String(candidate || "").trim();
  const junk = !text
    || /^(image|picture|photo|img|graphic)$/i.test(text)
    || /^(word-)?image[-_\s]?\d*$/i.test(text)
    || /\.(png|jpe?g|gif|webp|svg)$/i.test(text);
  return junk ? String(fallback || "").trim() : text;
}

// Every monthly report gets the same TGD cover unless the desk explicitly
// overrides it in front matter — the desk stopped uploading per-month covers
// and asked for one branded fallback so the archive reads as a series.
const REPORT_DEFAULT_COVER = "/assets/reports/tgd-report-cover.jpg";

function leadImage(item) {
  const explicit = String(item.image || "").trim();
  if (explicit) return { src: explicit, alt: usefulAlt(item.image_alt, item.title) };
  const body = String(item.body || "");
  // Markdown: ![alt](src "title")
  const md = body.match(/!\[([^\]]*)\]\(\s*([^)\s]+)/);
  if (md) return { src: md[2], alt: usefulAlt(md[1], item.title) };
  // Raw HTML: <img src="…" alt="…">
  const html = body.match(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
  if (html) {
    const alt = html[0].match(/\balt=["']([^"']*)["']/i);
    return { src: html[1], alt: usefulAlt(alt && alt[1], item.title) };
  }
  if (item?.type === "reports") return { src: REPORT_DEFAULT_COVER, alt: usefulAlt(null, item.title) };
  return null;
}

// Cards render at roughly a third of the container, so a full-size upload is
// wasted bytes. Cloudflare Images resizing is not enabled on this zone, so the
// browser is told the display size instead and decoding is deferred.
function cardImageMarkup(item, { wide = false, placeholder = false } = {}) {
  const image = leadImage(item);
  if (!image) {
    if (!placeholder) return "";
    const label = typeLabel(item.type || "").split(" ")[0] || "TGD";
    const region = String(item?.region || "").toUpperCase();
    return `<div class="card-media card-media-placeholder${wide ? " card-media-wide" : ""}" aria-hidden="true">
      <svg class="placeholder-motif" viewBox="0 0 320 220" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <radialGradient id="placeholder-glow" cx="30%" cy="30%" r="70%">
            <stop offset="0%" stop-color="currentColor" stop-opacity="0.35"/>
            <stop offset="55%" stop-color="currentColor" stop-opacity="0.08"/>
            <stop offset="100%" stop-color="currentColor" stop-opacity="0"/>
          </radialGradient>
          <pattern id="placeholder-grid" width="18" height="18" patternUnits="userSpaceOnUse">
            <circle cx="1.4" cy="1.4" r="1.1" fill="currentColor" opacity="0.22"/>
          </pattern>
        </defs>
        <rect width="320" height="220" fill="url(#placeholder-grid)"/>
        <rect width="320" height="220" fill="url(#placeholder-glow)"/>
        <g transform="translate(240 60)" opacity="0.85" fill="none" stroke="currentColor" stroke-width="1.2">
          <circle r="14" opacity="0.35"/>
          <circle r="28" opacity="0.22"/>
          <circle r="46" opacity="0.14"/>
          <circle r="68" opacity="0.08"/>
        </g>
        <g transform="translate(240 60)">
          <circle r="5" fill="currentColor"/>
        </g>
        <path d="M0 176 L120 132 L200 158 L320 108" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.35"/>
        <g fill="currentColor">
          <circle cx="120" cy="132" r="2.4"/>
          <circle cx="200" cy="158" r="2.4"/>
        </g>
      </svg>
      <div class="placeholder-content">
        <span class="placeholder-chip">${escapeHtml(label)}</span>
        ${region ? `<span class="placeholder-region">${escapeHtml(region)}</span>` : ""}
      </div>
      <span class="placeholder-mark" aria-hidden="true">TGD</span>
    </div>`;
  }
  return `<div class="card-media${wide ? " card-media-wide" : ""}">
      <img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}" loading="lazy" decoding="async">
    </div>`;
}

function card(item, currentPath = "/") {
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const status = item.type === "profiles" ? profileStatus(item) : "";
  const statusSlug = status ? slugify(status) : "";
  const categoryAccent = item.type !== "profiles"
    ? slugify(item.region || item.category || item.type || "")
    : "";
  const accentClass = item.type === "profiles"
    ? (statusSlug ? `status-${statusSlug}` : "")
    : (categoryAccent ? `accent-${categoryAccent}` : "");
  const searchText = [item.title, item.summary, item.category, item.region, status, tags.join(" ")].join(" ").toLowerCase();
  const media = cardImageMarkup(item, { placeholder: true });
  return `<article class="content-card${accentClass ? ` ${accentClass}` : ""}${media ? " has-media" : ""}" data-search="${escapeHtml(searchText)}" data-type="${escapeHtml(item.type || "")}" data-region="${escapeHtml(item.region || "")}" data-category="${escapeHtml(item.category || "")}" data-status="${escapeHtml(status)}">
    ${media}
    <div class="card-kicker">
      <span>${escapeHtml(typeLabel(item.type))}</span>
      ${accessLabel(item)}
    </div>
    <h2><a href="${linkFor(item.url, currentPath)}">${escapeHtml(item.title)}</a></h2>
    <p>${escapeHtml(item.summary || "")}</p>
    <div class="card-meta">
      <span>${escapeHtml(formatDate(item.date))}</span>
      ${item.type === "profiles" && status
        ? `<span class="status-chip status-${statusSlug}">${escapeHtml(status)}</span>`
        : `<span>${escapeHtml(item.region || item.category || "")}</span>`}
    </div>
  </article>`;
}

function sectionHero(title, eyebrow, summary) {
  return `<section class="section-hero">
    <div class="container">
      <p class="eyebrow">${escapeHtml(eyebrow)}</p>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(summary)}</p>
    </div>
  </section>`;
}

function filterToolbar(types = []) {
  const buttons = types
    .map(([label, value]) => `<button type="button" data-filter="${escapeHtml(value)}">${escapeHtml(label)}</button>`)
    .join("");
  return `<div class="content-toolbar" data-content-tools>
    <label>
      <span>${escapeHtml(t("searchLabel"))}</span>
      <input type="search" data-search-input placeholder="${escapeHtml(t("searchPlaceholder"))}">
    </label>
    <div class="filter-buttons" data-filter-buttons>
      <button type="button" data-filter="all" class="active">${escapeHtml(t("searchAll"))}</button>
      ${buttons}
    </div>
  </div>`;
}

function pillarStrip() {
  const items = [
    { icon: "whatsapp", num: "WhatsApp", label: "Briefing channel", url: SITE.whatsapp },
    { icon: "x", num: "X", label: "Public updates", url: SITE.x },
    { icon: "book", num: "Substack", label: "Long-form analysis", url: SITE.substack },
    { icon: "mail", num: "Pitch us", label: "Contact the desk", url: linkFor("/contact/", "/") }
  ];
  const cells = items.map(
    (s) => `<a class="pillar" href="${s.url}"${/^https?:\/\//.test(s.url) ? ' target="_blank" rel="noopener"' : ""}>
      <span class="icon">${icon(s.icon)}</span>
      <span>
        <span class="num">${escapeHtml(s.num)}</span>
        <span class="label">${escapeHtml(s.label)}</span>
      </span>
      <span class="go">→</span>
    </a>`
  ).join("");
  return `<section class="pillar-strip">
    <div class="container"><div class="pillar-grid">${cells}</div></div>
  </section>`;
}

function heroMapSvg() {
  // Procedural dot-grid suggesting a world map, with hotspots
  const cols = 60, rows = 28;
  const gw = 1200, gh = 560;
  const dots = [];
  // Hand-drawn continent mask: dots are denser within these elliptical zones
  const masks = [
    { cx: 200, cy: 200, rx: 130, ry: 90 },   // N America
    { cx: 360, cy: 360, rx: 60, ry: 100 },   // S America
    { cx: 560, cy: 200, rx: 100, ry: 100 },  // Europe
    { cx: 600, cy: 320, rx: 130, ry: 120 },  // Africa
    { cx: 780, cy: 230, rx: 170, ry: 110 },  // Asia
    { cx: 920, cy: 410, rx: 80, ry: 50 }     // Oceania
  ];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const x = (c + 0.5) * (gw / cols);
      const y = (r + 0.5) * (gh / rows);
      let inside = false;
      for (const m of masks) {
        const dx = (x - m.cx) / m.rx;
        const dy = (y - m.cy) / m.ry;
        if (dx * dx + dy * dy <= 1) { inside = true; break; }
      }
      if (inside) {
        const jitterX = (Math.sin(c * 12.9898 + r * 78.233) * 43758.5453) % 1;
        const jx = ((jitterX + 1) % 1) * 4 - 2;
        dots.push(`<circle class="map-dot" cx="${(x + jx).toFixed(1)}" cy="${y.toFixed(1)}" r="1.6"/>`);
      }
    }
  }
  const hotspots = [
    { x: 770, y: 260, cls: "" },        // South Asia
    { x: 640, y: 250, cls: "amber" },   // Middle East
    { x: 580, y: 330, cls: "" },        // Sahel
    { x: 820, y: 290, cls: "cyan" },    // SE Asia
    { x: 250, y: 230, cls: "amber" }    // N America
  ];
  const markers = hotspots.map(
    (h) => `<g class="map-pulse ${h.cls}" transform="translate(${h.x} ${h.y})">
      <circle class="ring" r="4"/>
      <circle class="ring" r="4" style="animation-delay:1.3s"/>
      <circle class="dot" r="3.2"/>
    </g>`
  ).join("");
  return `<svg viewBox="0 0 ${gw} ${gh}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    ${dots.join("")}
    ${markers}
  </svg>`;
}

function toolsBand(currentPath = "/") {
  const mapPreview = `<span class="tool-map-preview" aria-hidden="true">
    <img src="${prefixFor(currentPath)}assets/pakistan-map.svg" alt="">
    <span class="tool-map-marker marker-kp"><i></i><b>KP</b></span>
    <span class="tool-map-marker marker-balochistan"><i></i><b>Balochistan</b></span>
    <span class="tool-map-marker marker-sindh"><i></i><b>Sindh</b></span>
    <span class="tool-map-window"><strong>31D</strong><small>rolling window</small></span>
  </span>`;
  // A node-and-link constellation: the square element cells this replaced read
  // as a periodic table rather than a relationship map.
  const netPreview = `<svg class="tool-network" viewBox="0 0 220 150" aria-hidden="true">
    <g class="net-links">
      <path d="M110 74 C 88 60, 72 50, 54 40"/>
      <path d="M110 74 C 134 62, 150 46, 166 36"/>
      <path d="M110 74 C 92 92, 76 104, 58 116"/>
      <path d="M110 74 C 136 90, 152 102, 170 112"/>
      <path d="M110 74 C 108 46, 104 30, 100 16"/>
      <path class="net-link-weak" d="M54 40 C 90 22, 132 22, 166 36"/>
      <path class="net-link-weak" d="M58 116 C 96 132, 136 128, 170 112"/>
    </g>
    <g class="net-nodes">
      <circle class="net-node net-node-core" cx="110" cy="74" r="17"/>
      <circle class="net-node net-node-major" cx="54" cy="40" r="11"/>
      <circle class="net-node net-node-major" cx="166" cy="36" r="11"/>
      <circle class="net-node" cx="58" cy="116" r="9"/>
      <circle class="net-node" cx="170" cy="112" r="9"/>
      <circle class="net-node net-node-minor" cx="100" cy="16" r="6"/>
    </g>
    <g class="net-labels">
      <text x="110" y="78">TTP</text>
      <text x="54" y="43">AQ</text>
      <text x="166" y="39">IS</text>
      <text x="58" y="119">LeT</text>
      <text x="170" y="115">BLA</text>
    </g>
  </svg>`;
  return `<section class="band tools-band">
    <div class="container split-heading">
      <div>
        <p class="band-eyebrow">Explore the data</p>
        <h2>Two ways into the evidence.</h2>
      </div>
      <a href="${linkFor("/incident-map/", currentPath)}">Open the incident map</a>
    </div>
    <div class="container tool-grid">
      <a class="tool-card" href="${linkFor("/incident-map/", currentPath)}">
        <span class="tool-visual">${mapPreview}</span>
        <span class="tool-body">
          <span class="gateway-kicker">Public-source tracker</span>
          <strong>Pakistan incident map</strong>
          <p>District-level incidents, casualties, and severity on a rolling 31-day archive — updated from monitored feeds.</p>
          <span class="tool-cta">Open the map →</span>
        </span>
      </a>
      <a class="tool-card" href="${linkFor("/network-graph/", currentPath)}">
        <span class="tool-visual">${netPreview}</span>
        <span class="tool-body">
          <span class="gateway-kicker">Actor relationships</span>
          <strong>Militant network graph</strong>
          <p>Interactive map of leaders, organisations, and the command, allegiance, and rivalry links between them.</p>
          <span class="tool-cta">Explore the network →</span>
        </span>
      </a>
    </div>
  </section>`;
}

function tickerStrip(items) {
  const latest = items.filter((item) => !["profiles", "pages"].includes(item.type));
  const lines = latest.slice(0, 8).map((item) => {
    const region = escapeHtml(item.region || item.category || "Global");
    const title = escapeHtml(item.title);
    return {
      link: `<a href="${linkFor(item.url, "/")}"><span class="region">${region}</span><strong>${title}</strong></a>`,
      copy: `<span class="ticker-copy-item"><span class="region">${region}</span><strong>${title}</strong></span>`
    };
  });
  if (!lines.length) return "";
  return `<div class="ticker-bar">
    <div class="container ticker-row">
      <span class="ticker-label"><span class="live-dot"></span> Latest briefings</span>
      <div class="ticker-track">
        <div class="ticker-strip">${lines.map((line) => line.link).join("")}<span class="ticker-copy" aria-hidden="true">${lines.map((line) => line.copy).join("")}</span></div>
      </div>
    </div>
  </div>`;
}

function threatBoard() {
  return `<section class="threat-board">
    <div class="container">
      <div class="split-heading">
        <div>
          <p class="band-eyebrow">Threat posture</p>
          <h2>Regional desk</h2>
        </div>
        <a href="${linkFor("/news/", "/")}">All regional analysis</a>
      </div>
      <p class="empty-state">Regional desk updates will appear here after upload.</p>
    </div>
  </section>`;
}

function pitchBand() {
  return `<section class="pitch-band">
    <div class="container pitch-grid">
      <div>
        <p class="band-eyebrow">Pitch the desk</p>
        <h2>Got a <em>tip</em>, document, or story?</h2>
        <p>We work with researchers, journalists, and on-the-ground sources. Source identities are protected. We verify before we publish.</p>
        <a class="button primary" href="${linkFor("/contact/", "/")}">Contact the desk <span class="arrow">→</span></a>
      </div>
      <aside class="pitch-card">
        <p class="label">Pitch &amp; contact</p>
        <a class="email" href="mailto:${SITE.email}">${SITE.email}</a>
        <ul>
          <li>Tips, leaks, and documents</li>
          <li>Researcher &amp; journalist pitches</li>
          <li>Institutional access requests</li>
          <li>Press &amp; speaking inquiries</li>
        </ul>
        <p style="margin:0;color:var(--muted);font-family:var(--mono);font-size:0.74rem;letter-spacing:0.08em;text-transform:uppercase;">Response within 48 hours</p>
      </aside>
    </div>
  </section>`;
}

function homepage(items) {
  const currentPath = "/";
  const reports = items.filter((item) => item.type === "reports");
  const profiles = items.filter((item) => item.type === "profiles");
  const lead = reports.find((item) => item.featured) || reports[0] || profiles[0] || items[0];
  const metrics = lead?.type === "reports" ? extractReportMetrics(lead.body) : [];
  const metricMap = new Map(metrics);
  const profileRegions = new Set(profiles.map((item) => item.region).filter(Boolean));
  const briefings = items.filter((item) => ["news", "opinion", "monitoring"].includes(item.type));
  const leadType = lead?.type === "reports" ? "Lead report" : lead?.type === "profiles" ? "Profile" : "Lead briefing";
  const leadCta = lead?.type === "reports" ? "Read report" : lead?.type === "profiles" ? "Read profile" : "Read briefing";
  const heroTitle = lead?.hero_title || (lead?.type === "reports"
    ? lead.title
    : "Militant actor profiles and security research in one place");
  const reportPeriod = lead?.date
    ? new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${lead.date}T00:00:00Z`))
    : "Latest monthly";
  if (!lead) {
    return shell({
      title: SITE.title,
      description: SITE.description,
      body: `${tickerStrip(items)}
  <section class="hero">
    <div class="hero-map" aria-hidden="true">${heroMapSvg()}</div>
    <div class="container hero-grid">
      <div class="hero-lead-col">
        <p class="hero-eyebrow">The Global Decipher</p>
        <h1>New reporting will appear here after upload.</h1>
        <p class="hero-lead">${escapeHtml(SITE.description)}</p>
      </div>
    </div>
  </section>
  ${pitchBand()}`,
      current: "/",
      pagePath: currentPath
    });
  }

  // A counter reading "0" undersells the desk, so a stat only earns its place
  // once it has something to report. With none of them filled the whole strip
  // is dropped rather than rendered empty.
  const stats = [
    ["Profiles", profiles.length, "Research profiles live"],
    ["Regions", profileRegions.size, "Actor database coverage"],
    ["Reports", reports.length, "Published assessments"],
    metricMap.get("Militant attacks reported") ? ["Attacks", metricMap.get("Militant attacks reported"), `${reportPeriod} report`] : null,
    metricMap.get("Fatalities") ? ["Fatalities", metricMap.get("Fatalities"), `${reportPeriod} report`] : null,
    metricMap.get("Injuries") ? ["Injuries", metricMap.get("Injuries"), `${reportPeriod} report`] : null
  ].filter(Boolean).filter(([, value]) => Number(value) > 0).slice(0, 6);

  const body = `
  ${tickerStrip(items)}
  <section class="hero${leadImage(lead) ? " hero-has-media" : ""}">
    <div class="hero-map" aria-hidden="true">${heroMapSvg()}</div>
    <div class="container hero-grid">
      ${leadImage(lead) ? `<a class="hero-media" href="${linkFor(lead.url, currentPath)}" aria-hidden="true" tabindex="-1">${cardImageMarkup(lead, { wide: true }).replace('<div class="card-media card-media-wide">', '').replace(/<\/div>\s*$/, '')}</a>` : ""}
      <div class="hero-lead-col">
        <p class="hero-eyebrow">${leadType} · ${escapeHtml(lead.region || "Pakistan")}</p>
        <h1><a href="${linkFor(lead.url, currentPath)}">${escapeHtml(heroTitle)}</a></h1>
        <p class="hero-lead">${escapeHtml(lead.summary || SITE.description)}</p>
        <div class="hero-meta">
          <span class="byline">${escapeHtml(lead.author || "TGD Desk")}</span>
          <span>${escapeHtml(formatDate(lead.date))}</span>
          <span>${escapeHtml(lead.region || "Pakistan")}</span>
          ${accessLabel(lead)}
        </div>
        <div class="hero-actions">
          <a class="button primary" href="${linkFor(lead.url, currentPath)}">${leadCta} <span class="arrow">→</span></a>
          <a class="button secondary" href="${linkFor("/network-graph/", currentPath)}">Explore the network</a>
        </div>
      </div>
    </div>
  </section>

  ${briefings.filter((item) => item.url !== lead.url).length ? `<section class="band" data-reveal>
    <div class="container split-heading">
      <div>
        <p class="band-eyebrow">From the desk</p>
        <h2>Latest briefings</h2>
      </div>
      <a href="${linkFor("/news/", currentPath)}">All briefings</a>
    </div>
    <div class="container card-grid">${briefings
      .filter((item) => item.url !== lead.url)
      .slice(0, 6)
      .map((item) => card(item, currentPath))
      .join("")}</div>
  </section>` : ""}

  ${toolsBand(currentPath)}

  ${stats.length ? `<section class="snapshot-strip" data-reveal>
    <div class="container snapshot-grid">
      ${stats.map(([label, value, note]) => `<article class="snapshot-card">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <small>${escapeHtml(note)}</small>
      </article>`).join("")}
    </div>
  </section>` : ""}

  ${profiles.length ? `<section class="band" data-reveal>
    <div class="container split-heading">
      <div>
        <p class="band-eyebrow">Actor database</p>
        <h2>Latest profiles</h2>
      </div>
      <a href="${linkFor("/profiles/", currentPath)}">View all profiles</a>
    </div>
    <div class="container card-grid">${profiles.slice(0, 6).map((item) => card(item, currentPath)).join("")}</div>
  </section>` : ""}

  ${reports.length ? `<section class="band muted" data-reveal>
    <div class="container split-heading">
      <div>
        <p class="band-eyebrow">Research product</p>
        <h2>Latest monthly report</h2>
      </div>
      <a href="${linkFor("/reports/", currentPath)}">Report archive</a>
    </div>
    <div class="container feature-grid">${reports.slice(0, 2).map((item) => card(item, currentPath)).join("")}</div>
  </section>` : ""}

  ${pitchBand()}`;

  return shell({ title: SITE.title, description: SITE.description, body, current: "/", pagePath: currentPath, jsonLd: homepageJsonLd() });
}

function sparseListingCta({ title, current, count }) {
  if (count >= 2 || current === "/profiles/") return "";
  return `<aside class="listing-cta">
    <div>
      <span>${escapeHtml(t("ctaEyebrow"))}</span>
      <strong>${escapeHtml(t("ctaHeadline").replace("{title}", title))}</strong>
      <p>${escapeHtml(t("ctaBody"))}</p>
    </div>
    <div class="listing-cta-actions">
      <a class="button primary" href="${SITE.whatsapp}" target="_blank" rel="noopener">${escapeHtml(t("ctaWhatsapp"))}</a>
      <a class="button secondary" href="${linkFor("/contact/", current)}">${escapeHtml(t("ctaPitch"))}</a>
    </div>
  </aside>`;
}

// A single card stretched across a three-column grid reads as a broken row, so
// the lone piece is set as a lead story instead: picture beside the text, the
// way a front page carries its main item. Text keeps a readable measure either
// way.
function leadStory(item, currentPath) {
  const media = cardImageMarkup(item, { wide: true });
  const tags = Array.isArray(item.tags) ? item.tags : [];
  return `<article class="lead-story${media ? " has-media" : ""}" data-search="${escapeHtml([item.title, item.summary, item.category, item.region, tags.join(" ")].join(" ").toLowerCase())}" data-type="${escapeHtml(item.type || "")}" data-region="${escapeHtml(item.region || "")}" data-category="${escapeHtml(item.category || "")}">
    ${media}
    <div class="lead-story-body">
      <div class="card-kicker">
        <span>${escapeHtml(typeLabel(item.type))}</span>
        ${accessLabel(item)}
      </div>
      <h2><a href="${linkFor(item.url, currentPath)}">${escapeHtml(item.title)}</a></h2>
      <p class="lead-story-summary">${escapeHtml(item.summary || "")}</p>
      <div class="card-meta">
        <span>${escapeHtml(formatDate(item.date))}</span>
        <span>${escapeHtml(item.region || item.category || "")}</span>
      </div>
    </div>
  </article>`;
}

function listingPage({ title, eyebrow, summary, current, items, filters }) {
  const hasItems = items.length > 0;
  // Every briefing gets the same card. Promoting the first item to a feature
  // block made two same-day articles look like different kinds of content —
  // except when it is the only item, where a full-width card looks stretched.
  const renderList = () => {
    if (items.length === 1 && current !== "/profiles/") {
      return `<div class="listing-grid layout-solo" data-content-list>${leadStory(items[0], current)}</div>`;
    }
    return `<div class="listing-grid layout-grid" data-content-list>${items
      .map((item) => card(item, current))
      .join("")}</div>`;
  };
  const body = `${sectionHero(title, eyebrow, summary)}
  <section class="band" data-reveal>
    <div class="container">
      ${hasItems && items.length > 3 ? filterToolbar(filters) : ""}
      ${hasItems ? renderList() : `<div class="listing-grid layout-grid" data-content-list></div>`}
      <p class="empty-state" data-empty-state${hasItems ? " hidden" : ""}>${escapeHtml(hasItems ? t("emptyFiltered") : t("emptyNone"))}</p>
      ${sparseListingCta({ title, current, count: items.length })}
    </div>
  </section>`;
  return shell({ title, description: summary, body, current, pagePath: current });
}

function wrapNetworkGraphPage(originalHtml) {
  const globeShell = `<section class="world-globe-shell is-loading" data-world-globe>
  <div class="globe-head">
    <div>
      <p class="globe-kicker">TGD WORLD NETWORK ATLAS</p>
      <h2>Every militant network. One map.</h2>
      <p class="globe-lede">A live atlas of where TTP, Al-Qaeda, Islamic State, JNIM, Al-Shabaab and the rest of the militant ecosystem operate. Animated arcs trace cross-border branches, affiliates, and rivalries. Click any country or organisation to drill in.</p>
    </div>
    <div class="globe-status" role="status" aria-live="polite">
      <span class="globe-pulse" aria-hidden="true"></span>
      <span data-globe-status>Initialising globe…</span>
    </div>
  </div>
  <div class="globe-stats-strip" data-globe-stats></div>
  <div class="globe-toolbar" role="toolbar" aria-label="Globe filters">
    <label>Region<select data-globe-filter="region"><option value="">All</option></select></label>
    <label>Status<select data-globe-filter="status"><option value="">All</option></select></label>
    <label>Tier<select data-globe-filter="tier"><option value="">All</option></select></label>
    <label>Search<input data-globe-search type="search" placeholder="TTP, IS, AQAP…"></label>
    <div class="globe-toolbar-spacer"></div>
    <button type="button" data-globe-tour>World tour</button>
    <button type="button" class="is-active" data-globe-rotate aria-pressed="true">Pause spin</button>
    <button type="button" data-globe-reset>Reset view</button>
  </div>
  <div class="globe-legend" data-globe-legend></div>
  <div class="globe-stage">
    <div class="globe-canvas-wrap">
      <div class="globe-canvas" data-globe-canvas role="img" aria-label="Interactive 3D globe of militant organisations and cross-border connections"></div>
      <div class="globe-tooltip" data-globe-tooltip hidden></div>
    </div>
    <aside class="globe-side">
      <section class="globe-org-panel">
        <h3>Organisations</h3>
        <p>Click a chip to isolate that organisation's countries and arcs.</p>
        <div class="globe-org-list" data-globe-org-list></div>
      </section>
      <section class="globe-detail-panel" data-globe-detail></section>
    </aside>
  </div>
  <p class="globe-research-note"><strong>Research note:</strong> Country presence reflects known areas of operation — branches, fronts, cells, and active support networks — curated by the TGD Research Desk. Legal designation and operational status are tracked as separate fields on each profile.</p>
</section>`;

  return `<div class="world-globe-mode" data-globe-mode-host>
  <div class="globe-mode-tabs" role="tablist" aria-label="Visualisation mode">
    <button type="button" class="is-active" data-globe-mode="globe" role="tab" aria-selected="true">Globe view</button>
    <button type="button" data-globe-mode="network" role="tab" aria-selected="false">Network view</button>
  </div>
  <div data-globe-pane="globe">
    ${globeShell}
  </div>
  <div data-globe-pane="network" hidden>
    ${originalHtml}
  </div>
</div>
<script src="/assets/world-globe.js?v=20260626-cold1" defer></script>
<script>
(function(){
  var host = document.querySelector("[data-globe-mode-host]");
  if (!host) return;
  var tabs = host.querySelectorAll("[data-globe-mode]");
  var panes = host.querySelectorAll("[data-globe-pane]");
  tabs.forEach(function(tab){
    tab.addEventListener("click", function(){
      var mode = tab.dataset.globeMode;
      tabs.forEach(function(t){
        var on = t.dataset.globeMode === mode;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      panes.forEach(function(p){
        p.hidden = p.dataset.globePane !== mode;
      });
      window.dispatchEvent(new Event("resize"));
    });
  });
})();
</script>`;
}

const TEAM_PROFILES = {
  "aamir-hayat": {
    name: "Aamir Hayat",
    jobTitle: "Co-Founder & Editor",
    sameAs: []
  },
  "mudassir-khattak": {
    name: "Mudassir Khattak",
    jobTitle: "Co-Founder & Director of News & Reporting",
    sameAs: []
  }
};

function personJsonLdFor(page) {
  const info = TEAM_PROFILES[page.slug];
  if (!info) return null;
  const canonical = absoluteUrl(page.url);
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": canonical,
    name: info.name,
    jobTitle: info.jobTitle,
    url: canonical,
    worksFor: {
      "@type": "Organization",
      name: SITE.title,
      url: SITE.url
    },
    ...(info.sameAs.length ? { sameAs: info.sameAs } : {})
  };
}

function pageTemplate(page) {
  const isWide = page.wide === true
    || /incident-tracker-shell|network-graph-shell|world-globe-shell/.test(page.html);
  const shellClass = isWide ? "" : " static-page-shell";
  const bodyClass = isWide ? "" : " static-page-body";
  const pageHero = page.slug === "incident-map"
    ? sectionHero(page.title, "", "")
    : sectionHero(page.title, page.eyebrow || "Editorial", page.summary || "");
  const body = `${pageHero}
  <section class="article-band">
    <div class="container">
      <div class="page-shell${shellClass}">
        <article class="article-body${bodyClass}">${page.html}</article>
      </div>
    </div>
  </section>`;
  const managedPageHead = page.slug === "incident-map"
    ? '<link rel="stylesheet" href="/assets/incident-map.css?v=20260705-daily-first">'
    : page.slug === "network-graph"
      ? '<link rel="stylesheet" href="/assets/network-graph.css?v=20260622-publishing"><link rel="stylesheet" href="/assets/world-globe.css?v=20260626-cold2">'
      : page.extra_head || "";
  return shell({
    title: page.title,
    description: page.summary || SITE.description,
    body,
    current: page.url,
    pagePath: page.url,
    extraHead: managedPageHead,
    image: page.og_image || page.image || SITE.defaultImage,
    jsonLd: page.slug === "about" ? [aboutPageJsonLd(), pageBreadcrumbJsonLd(page)]
         : page.slug === "contact" ? [contactPageJsonLd(), pageBreadcrumbJsonLd(page)]
         : [personJsonLdFor(page), pageBreadcrumbJsonLd(page)].filter(Boolean)
  });
}

// A single italic line in the press tradition, not a card. The byline already
// names the author at the top, so the note carries only the bio itself, and
// only when one was written.
function authorNote(item) {
  const bio = (item.author_bio || "").trim();
  if (!bio) return "";
  return `<p class="author-note">${escapeHtml(bio)}</p>`;
}

function articleSidebar(item) {
  const headings = collectHeadings(item.body).filter((heading) => heading.level === 2).slice(0, 10);
  const pdfs = extractPdfLinks(item.body);
  const metrics = item.type === "reports" ? extractReportMetrics(item.body).slice(0, 4) : [];
  const facts = item.type === "profiles" ? profileFacts(item) : [];
  const tags = Array.isArray(item.tags) ? item.tags : [];

  const metricBlock = metrics.length
    ? `<div class="article-side-panel">
        <h2>${escapeHtml(t("sidebarGlance"))}</h2>
        <dl class="side-stats">${metrics.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
      </div>`
    : "";

  const factBlock = facts.length
    ? `<div class="article-side-panel">
        <h2>${escapeHtml(t("sidebarFacts"))}</h2>
        <dl class="side-facts">${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
      </div>`
    : "";

  const tocBlock = headings.length
    ? `<div class="article-side-panel">
        <h2>${escapeHtml(t("sidebarToc"))}</h2>
        <nav class="article-toc" aria-label="${escapeHtml(t("sidebarTocLabel"))}">${headings.map((heading) => `<a href="#${heading.id}">${escapeHtml(heading.title)}</a>`).join("")}</nav>
      </div>`
    : "";

  const pdfBlock = pdfs.length
    ? `<div class="article-side-panel">
        <h2>${escapeHtml(t("sidebarFiles"))}</h2>
        ${pdfs.map((pdf) => `<a class="file-link" href="${escapeHtml(pdf.href)}">${escapeHtml(pdf.label || t("downloadPdf"))}</a>`).join("")}
      </div>`
    : "";

  const tagBlock = tags.length
    ? `<div class="article-side-panel">
        <h2>${escapeHtml(t("sidebarTags"))}</h2>
        <div class="side-tags">${tags.map((tag) => tagChip(tag, item.url)).join("")}</div>
      </div>`
    : "";

  const researchBlock = item.type === "profiles"
    ? `<div class="article-side-panel">
        <h2>${escapeHtml(t("sidebarResearchNote"))}</h2>
        <p>${escapeHtml(t("sidebarResearchBody"))}</p>
      </div>`
    : "";

  const shareBlock = `<div class="article-side-panel share-panel">
        <h2>${escapeHtml(t("sidebarShare"))}</h2>
        <button type="button" class="copy-link" data-copy-link="${escapeHtml(canonicalFor(item.url))}">${escapeHtml(t("sidebarCopyLink"))}</button>
      </div>`;

  const blocks = [shareBlock, metricBlock, factBlock, tocBlock, pdfBlock, tagBlock, researchBlock].filter(Boolean).join("");
  return blocks ? `<aside class="article-sidebar">${blocks}</aside>` : "";
}

function articleTemplate(item, allItems) {
  const related = allItems
    .filter((candidate) => candidate.url !== item.url && (candidate.type === item.type || candidate.region === item.region))
    .slice(0, 3);
  const premiumCta =
    item.access === "premium-preview"
      ? `<aside class="premium-cta">
          <h2>${escapeHtml(t("premiumTitle"))}</h2>
          <p>${escapeHtml(t("premiumBody"))}</p>
          <a class="button primary" href="${linkFor("/contact/", item.url)}">${escapeHtml(t("premiumCta"))}</a>
        </aside>`
      : "";
  // Readers are told plainly that they are reading a machine translation, and
  // are given a one-click route to the English original that carries the
  // desk's actual wording. Leaving that unsaid on security reporting would be
  // the wrong call editorially, whatever it costs in polish.
  const translationNotice = LOCALE.code === "en"
    ? ""
    : `<aside class="translation-notice">
        <strong>${escapeHtml(t("translationNoticeTitle"))}</strong>
        <p>${escapeHtml(t("translationNotice"))}</p>
        <a href="${localeHref(DEFAULT_LOCALE, item.url, item.url)}" hreflang="en" lang="en">${escapeHtml(t("readInEnglish"))}</a>
      </aside>`;
  const body = `<section class="article-hero">
    <div class="container article-head">
      <p class="eyebrow">${escapeHtml(typeLabel(item.type))} · ${escapeHtml(item.region || t("regionGlobal"))}</p>
      <h1>${escapeHtml(item.title)}</h1>
      <p>${escapeHtml(item.summary || "")}</p>
      <div class="article-meta">
        <span class="byline">${escapeHtml(t("byline"))} ${escapeHtml(item.author || t("deskName"))}</span>
        <span>${escapeHtml(formatDate(item.date))}</span>
        <span>${escapeHtml(item.region || t("regionGlobal"))}</span>
        ${accessLabel(item)}
      </div>
    </div>
  </section>
  <section class="article-band">
    <div class="container article-shell">
      <article class="article-body">${translationNotice}${item.html}${authorNote(item)}</article>
      ${articleSidebar(item)}
      ${premiumCta}
    </div>
  </section>
  ${related.length ? `<section class="band" data-reveal>
    <div class="container split-heading">
      <div>
        <p class="eyebrow">${escapeHtml(t("relatedEyebrow"))}</p>
        <h2>${escapeHtml(t("relatedTitle"))}</h2>
      </div>
    </div>
    <div class="container card-grid">${related.map((candidate) => card(candidate, item.url, { compact: true })).join("")}</div>
  </section>` : ""}`;
  return shell({
    title: item.title,
    description: item.summary || SITE.description,
    body,
    current: routeForType(item.type),
    pagePath: item.url,
    image: item.og_image || item.image || SITE.defaultImage,
    ogType: "article",
    jsonLd: [articleJsonLd(item), breadcrumbJsonLd(item)]
  });
}

function writePage(urlPath, html) {
  const target = localized(urlPath);
  const clean = target === "/" ? "" : target.replace(/^\/|\/$/g, "");
  const dir = path.join(OUT_DIR, clean);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, "index.html"), html);
}

function writeRootFile(fileName, html) {
  fs.writeFileSync(path.join(OUT_DIR, fileName), html);
}

function notFoundPage() {
  const body = `<section class="section-hero not-found-hero">
    <div class="container">
      <p class="eyebrow">404</p>
      <h1>${escapeHtml(t("notFoundHeadline"))}</h1>
      <p>${escapeHtml(t("notFoundBody"))}</p>
      <div class="not-found-actions">
        <a class="button primary" href="index.html">${escapeHtml(t("notFoundHome"))}</a>
        <a class="button secondary" href="contact/index.html">${escapeHtml(t("notFoundContact"))}</a>
      </div>
    </div>
  </section>`;
  return shell({ title: t("notFoundTitle"), description: t("notFoundBody"), body, pagePath: "/404.html", noindex: true });
}

function writeRssFeed(items) {
  const feedItems = items
    .filter((item) => !["profiles"].includes(item.type))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 30);
  const updated = feedItems[0]?.date ? new Date(`${feedItems[0].date}T00:00:00Z`).toUTCString() : new Date().toUTCString();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE.title)}</title>
    <link>${SITE.url}/</link>
    <atom:link href="${SITE.url}/rss.xml" rel="self" type="application/rss+xml"/>
    <description>${escapeXml(SITE.description)}</description>
    <language>en</language>
    <lastBuildDate>${escapeXml(updated)}</lastBuildDate>
${feedItems.map((item) => `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(absoluteUrl(item.url))}</link>
      <guid isPermaLink="true">${escapeXml(absoluteUrl(item.url))}</guid>
      <pubDate>${escapeXml(new Date(`${item.date || "1970-01-01"}T00:00:00Z`).toUTCString())}</pubDate>
      <category>${escapeXml(typeLabel(item.type))}</category>
      <description>${escapeXml(item.summary || firstParagraph(item.body) || SITE.description)}</description>
    </item>`).join("\n")}
  </channel>
</rss>
`;
  fs.writeFileSync(path.join(OUT_DIR, "rss.xml"), xml);
  fs.writeFileSync(path.join(OUT_DIR, "feed.xml"), xml.replace(`${SITE.url}/rss.xml`, `${SITE.url}/feed.xml`));
}

function writeStaticFiles(items, pages, hubs = { organisations: [], regions: [] }, localeTrees = new Map()) {
  const buildStamp = new Date().toISOString();
  const latestItemStamp = items.reduce((latest, item) => {
    const stamp = isoDateForItem(item);
    return stamp && stamp > latest ? stamp : latest;
  }, buildStamp.slice(0, 10) + "T00:00:00Z");
  const entries = [
    { url: "/", lastmod: latestItemStamp },
    { url: "/news/", lastmod: latestItemStamp },
    { url: "/opinion/", lastmod: latestItemStamp },
    ...(SHOW_MONITORING ? [{ url: "/monitoring/", lastmod: latestItemStamp }] : []),
    { url: "/reports/", lastmod: latestItemStamp },
    { url: "/profiles/", lastmod: latestItemStamp },
    ...items.map((item) => ({ url: item.url, lastmod: isoDateForItem(item) || buildStamp })),
    ...pages.map((page) => ({ url: page.url, lastmod: isoDateForItem(page) || buildStamp })),
    ...hubs.organisations.map((hub) => ({ url: `/organisations/${hub.slug}/`, lastmod: buildStamp })),
    ...hubs.regions.map((hub) => ({ url: `/regions/${hub.slug}/`, lastmod: buildStamp }))
  ];

  // Each language's URLs are listed in the one sitemap, and every entry carries
  // the full alternate set — including a self-reference, which the protocol
  // requires and which Google treats as a validity check on the whole group.
  for (const [code, tree] of localeTrees) {
    const locale = localeFor(code);
    for (const { url, lastmod } of tree.entries) {
      entries.push({ url: localePath(url, locale), lastmod, alternates: alternatesFor(url) });
    }
  }
  for (const entry of entries) {
    if (entry.alternates) continue;
    const alternates = alternatesFor(entry.url);
    if (alternates.length > 1) entry.alternates = alternates;
  }

  const alternateMarkup = (alternates = []) => alternates
    .map(({ locale, href }) => `\n    <xhtml:link rel="alternate" hreflang="${locale.htmlLang}" href="${escapeXml(href)}"/>`)
    .join("");

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries
  .map(({ url, lastmod, alternates }) => `  <url><loc>${SITE.url}${url}</loc><lastmod>${lastmod}</lastmod><changefreq>${url === "/" ? "daily" : "weekly"}</changefreq><priority>${url === "/" ? "1.0" : url.split("/").filter(Boolean).length <= 1 ? "0.8" : "0.6"}</priority>${alternateMarkup(alternates)}</url>`)
  .join("\n")}
</urlset>`;

  fs.writeFileSync(path.join(OUT_DIR, "sitemap.xml"), sitemap);
  fs.writeFileSync(
    path.join(OUT_DIR, "robots.txt"),
    `User-agent: *\nAllow: /\nSitemap: ${SITE.url}/sitemap.xml\n`
  );
  fs.writeFileSync(path.join(OUT_DIR, ".nojekyll"), "");
  if (SITE.googleVerificationFile) {
    fs.writeFileSync(
      path.join(OUT_DIR, SITE.googleVerificationFile),
      `google-site-verification: ${SITE.googleVerificationFile}\n`
    );
  }
  writeRssFeed(items);
  writeSearchIndex(OUT_DIR, items, pages);
  // Searching the Urdu site returns Urdu headlines. The URLs stay unprefixed
  // because main.js derives the tree from the index file's own location.
  for (const [code, tree] of localeTrees) {
    const dir = path.join(OUT_DIR, code);
    ensureDir(dir);
    writeSearchIndex(dir, tree.items, tree.pages);
  }
}

function writeSearchIndex(dir, items, pages) {
  fs.writeFileSync(
    path.join(dir, "search-index.json"),
    JSON.stringify(
      [...items, ...pages].map(({ title, summary, type, region, category, tags, url, date, access }) => ({
        title,
        summary,
        type,
        region,
        category,
        tags,
        url,
        date,
        access
      })),
      null,
      2
    )
  );
}

const HUB_ORG_SLUGS = new Set();
const HUB_REGION_SLUGS = new Set();

function tagChip(tag, currentPath = "/") {
  const label = clean(tag);
  if (!label) return "";
  const slug = slugify(label);
  if (HUB_ORG_SLUGS.has(slug)) {
    return `<a href="${linkFor(`/organisations/${slug}/`, currentPath)}">${escapeHtml(label)}</a>`;
  }
  if (HUB_REGION_SLUGS.has(slug)) {
    return `<a href="${linkFor(`/regions/${slug}/`, currentPath)}">${escapeHtml(label)}</a>`;
  }
  return `<span>${escapeHtml(label)}</span>`;
}

const GENERIC_TAG_DENYLIST = new Set([
  // status / descriptor tags
  "Deceased", "Founder", "Planner", "Lone actor", "Federation-builder",
  "Anti-government", "Far-right terrorism", "Domestic terrorism",
  "Cult terrorism", "Hostage attacks", "Counterterrorism", "Security Policy",
  "Daily Monitor", "Public Sources", "UN sanctions", "Rewards for Justice",
  "ICC", "ISIS predecessor", "Kurdish movement", "Egyptian Islamic Jihad",
  "Mehsud", "Tamil Tigers", "Monthly Report", "April 2026", "Organisation",
  // event / place markers — not orgs
  "9/11", "Kandahar hijacking", "Abbey Gate", "Oklahoma City",
  // geographic terms — countries, provinces, sub-regions
  "Pakistan", "India", "Afghanistan", "Iraq", "Syria", "Somalia", "Japan",
  "Nigeria", "Mali", "Uganda", "Sri Lanka", "Norway", "Turkey",
  "Khyber Pakhtunkhwa", "Balochistan", "Sindh", "Punjab",
  "Lake Chad", "North Caucasus", "Sahel", "Chechnya", "South Asia",
  "Middle East", "Horn of Africa", "West Africa", "Central Africa",
  "East Asia", "Europe", "United States"
]);

function buildHubIndex(items) {
  const regions = new Map();
  for (const item of items) {
    const region = clean(item.region);
    if (!region) continue;
    if (!regions.has(region)) regions.set(region, []);
    regions.get(region).push(item);
  }
  const regionSlugs = new Set([...regions.keys()].map(slugify));

  const organisations = new Map();
  for (const item of items) {
    if (!Array.isArray(item.tags)) continue;
    for (const tag of item.tags) {
      const t = clean(tag);
      if (!t || GENERIC_TAG_DENYLIST.has(t)) continue;
      const slug = slugify(t);
      if (!slug || regionSlugs.has(slug)) continue;
      if (!organisations.has(t)) organisations.set(t, []);
      organisations.get(t).push(item);
    }
  }

  const profileTags = new Set();
  for (const item of items) {
    if (item.type !== "profiles" || !Array.isArray(item.tags)) continue;
    for (const tag of item.tags) profileTags.add(clean(tag));
  }
  for (const tag of [...organisations.keys()]) {
    if (!profileTags.has(tag)) organisations.delete(tag);
  }

  return {
    organisations: [...organisations.entries()].map(([label, list]) => ({
      label,
      slug: slugify(label),
      items: dedupeByUrl(list)
    })).sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label)),
    regions: [...regions.entries()].map(([label, list]) => ({
      label,
      slug: slugify(label),
      items: dedupeByUrl(list)
    })).sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label))
  };
}

function dedupeByUrl(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function hubStatRow(items) {
  const counts = {
    profiles: items.filter((i) => i.type === "profiles").length,
    news: items.filter((i) => i.type === "news").length,
    opinion: items.filter((i) => i.type === "opinion").length,
    monitoring: items.filter((i) => i.type === "monitoring").length,
    reports: items.filter((i) => i.type === "reports").length
  };
  const total = items.length;
  const stats = [
    ["Total", total, "Linked items"],
    ["Profiles", counts.profiles, "Actor research"],
    ["News", counts.news + counts.opinion, "Briefings &amp; opinion"],
    ["Reports", counts.reports, "Published assessments"],
    ["Monitoring", counts.monitoring, "Premium previews"]
  ].filter(([, value]) => value);
  return `<section class="snapshot-strip hub-snapshot">
    <div class="container snapshot-grid">
      ${stats.map(([label, value, note]) => `<article class="snapshot-card">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <small>${note}</small>
      </article>`).join("")}
    </div>
  </section>`;
}

function hubSection({ title, eyebrow, items, currentPath, emptyNote }) {
  if (!items.length) {
    if (!emptyNote) return "";
    return `<section class="band" data-reveal>
      <div class="container split-heading">
        <div>
          <p class="band-eyebrow">${escapeHtml(eyebrow)}</p>
          <h2>${escapeHtml(title)}</h2>
        </div>
      </div>
      <div class="container"><p class="empty-state">${escapeHtml(emptyNote)}</p></div>
    </section>`;
  }
  const sorted = items.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return `<section class="band" data-reveal>
    <div class="container split-heading">
      <div>
        <p class="band-eyebrow">${escapeHtml(eyebrow)}</p>
        <h2>${escapeHtml(title)}</h2>
      </div>
    </div>
    <div class="container card-grid">${sorted.map((item) => card(item, currentPath)).join("")}</div>
  </section>`;
}

function organisationHubPage(hub, allContent) {
  const currentPath = `/organisations/${hub.slug}/`;
  const profiles = hub.items.filter((item) => item.type === "profiles");
  const news = hub.items.filter((item) => ["news", "opinion", "monitoring"].includes(item.type));
  const reports = hub.items.filter((item) => item.type === "reports");
  const regions = new Set(hub.items.map((item) => item.region).filter(Boolean));
  const leadProfile = profiles[0];
  const summary = leadProfile?.summary
    || `Every profile, briefing, and report in the TGD archive tagged ${hub.label}.`;
  const body = `${sectionHero(hub.label, "Organisation hub", summary)}
  ${hubStatRow(hub.items)}
  ${regions.size ? `<section class="band hub-region-band">
    <div class="container hub-region-row">
      <span class="band-eyebrow">Regions covered</span>
      <div class="hub-region-chips">
        ${[...regions].map((region) => `<a class="hub-region-chip" href="${linkFor(`/regions/${slugify(region)}/`, currentPath)}">${escapeHtml(region)}</a>`).join("")}
      </div>
    </div>
  </section>` : ""}
  ${hubSection({ title: "Profiles", eyebrow: "Actor database", items: profiles, currentPath, emptyNote: "No profiles tagged yet." })}
  ${hubSection({ title: "Briefings &amp; analysis", eyebrow: "Reporting", items: news, currentPath })}
  ${hubSection({ title: "Reports", eyebrow: "Research products", items: reports, currentPath })}`;
  return shell({
    title: `${hub.label} · Organisation hub`,
    description: summary,
    body,
    current: currentPath,
    pagePath: currentPath
  });
}

function regionHubPage(hub, allContent) {
  const currentPath = `/regions/${hub.slug}/`;
  const profiles = hub.items.filter((item) => item.type === "profiles");
  const news = hub.items.filter((item) => ["news", "opinion", "monitoring"].includes(item.type));
  const reports = hub.items.filter((item) => item.type === "reports");
  const orgTagSet = new Set();
  hub.items.forEach((item) => {
    if (!Array.isArray(item.tags)) return;
    item.tags.forEach((tag) => {
      const t = clean(tag);
      if (t && !GENERIC_TAG_DENYLIST.has(t)) orgTagSet.add(t);
    });
  });
  const summary = `TGD coverage of terrorism, militant actors, and security developments across ${hub.label}.`;
  const body = `${sectionHero(hub.label, "Region hub", summary)}
  ${hubStatRow(hub.items)}
  ${orgTagSet.size ? `<section class="band hub-region-band">
    <div class="container hub-region-row">
      <span class="band-eyebrow">Linked actors</span>
      <div class="hub-region-chips">
        ${[...orgTagSet].slice(0, 16).map((tag) => `<a class="hub-region-chip" href="${linkFor(`/organisations/${slugify(tag)}/`, currentPath)}">${escapeHtml(tag)}</a>`).join("")}
      </div>
    </div>
  </section>` : ""}
  ${hubSection({ title: "Actors based or operating here", eyebrow: "Actor database", items: profiles, currentPath, emptyNote: "No profiles tagged to this region yet." })}
  ${hubSection({ title: "Briefings &amp; analysis", eyebrow: "Reporting", items: news, currentPath })}
  ${hubSection({ title: "Reports", eyebrow: "Research products", items: reports, currentPath })}`;
  return shell({
    title: `${hub.label} · Region hub`,
    description: summary,
    body,
    current: currentPath,
    pagePath: currentPath
  });
}

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function adminPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>TGD Admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/assets/admin.css?v=20260727-corpus">
</head>
<body>
<div id="admin-root"></div>
<script src="/assets/admin-infographic.js?v=20260706-map-polish" defer></script>
<script src="/assets/admin-corpus.js?v=20260727-corpus" defer></script>
<script src="/assets/admin.js?v=20260801-report-cover-pin" defer></script>
</body>
</html>
`;
}

// Self-contained (no external assets from this origin) so it renders even while
// maintenance mode gates /assets/*. Brand mark and fonts are inlined or loaded
// from Google Fonts (third-party, unaffected by the gate).
function maintenancePage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(SITE.title)} — Maintenance</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;500&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600;8..60,700&display=swap">
<style>
  :root {
    --paper: #fafaf7;
    --paper-2: #f3efe6;
    --ink: #0d1b2a;
    --muted: #6b6b66;
    --gold: #a17328;
    --red: #b91c2c;
    --line: #d8d3c5;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    background: var(--paper);
    color: var(--ink);
    font: 16px/1.65 "IBM Plex Sans", system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    display: grid;
    place-items: center;
    padding: 32px 20px;
    background-image:
      radial-gradient(1100px 600px at 50% -10%, rgba(185, 28, 44, 0.06), transparent 60%),
      radial-gradient(900px 500px at 50% 110%, rgba(161, 115, 40, 0.06), transparent 60%);
    -webkit-font-smoothing: antialiased;
  }
  main { width: 100%; max-width: 560px; text-align: center; }
  .mark { width: 84px; height: 84px; margin: 0 auto 28px; display: block; filter: drop-shadow(0 6px 18px rgba(13, 27, 42, 0.18)); }
  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    font-family: "IBM Plex Mono", ui-monospace, monospace;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--gold);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    margin-bottom: 18px;
  }
  .pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--red);
    box-shadow: 0 0 0 0 rgba(185, 28, 44, 0.55);
    animation: pulse 1.8s ease-in-out infinite;
  }
  @keyframes pulse {
    0%   { box-shadow: 0 0 0 0   rgba(185, 28, 44, 0.55); }
    70%  { box-shadow: 0 0 0 11px rgba(185, 28, 44, 0); }
    100% { box-shadow: 0 0 0 0   rgba(185, 28, 44, 0); }
  }
  h1 {
    font-family: "Source Serif 4", Georgia, "Times New Roman", serif;
    font-weight: 600;
    font-size: clamp(28px, 4.4vw, 38px);
    line-height: 1.18;
    letter-spacing: -0.015em;
    margin: 0 0 14px;
    color: var(--ink);
  }
  .lede { color: var(--muted); margin: 0 0 30px; font-size: 16px; line-height: 1.6; }
  .divider { width: 56px; height: 1px; background: var(--line); margin: 30px auto; border: 0; }
  .channels { display: flex; flex-wrap: wrap; gap: 14px 20px; justify-content: center; font-size: 13.5px; }
  .channels a {
    color: var(--ink);
    text-decoration: none;
    border-bottom: 1px solid var(--line);
    padding-bottom: 2px;
    transition: color .15s, border-color .15s;
  }
  .channels a:hover { color: var(--red); border-color: var(--red); }
  footer {
    margin-top: 44px;
    font-family: "IBM Plex Mono", ui-monospace, monospace;
    font-size: 10.5px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--muted);
  }
</style>
</head>
<body>
<main>
  <svg class="mark" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="The Global Decipher">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#c4202f"/>
        <stop offset="1" stop-color="#8b1420"/>
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="11" fill="url(#bg)"/>
    <line x1="32" y1="6" x2="32" y2="58" stroke="#d4a852" stroke-width="0.8" opacity="0.42"/>
    <line x1="6" y1="32" x2="58" y2="32" stroke="#d4a852" stroke-width="0.8" opacity="0.42"/>
    <text x="32" y="41" text-anchor="middle"
          font-family="'Source Serif 4','Source Serif Pro',Georgia,'Times New Roman',serif"
          font-size="22" font-weight="900" fill="#fafaf7" letter-spacing="0.4">TGD</text>
    <circle cx="52" cy="14" r="2.6" fill="#0d1b2a"/>
    <circle cx="52" cy="14" r="1.2" fill="#d4a852"/>
  </svg>
  <div class="eyebrow"><span class="pulse" aria-hidden="true"></span><span>Status — Brief Maintenance</span></div>
  <h1>We'll be right back.</h1>
  <p class="lede">The Global Decipher is briefly offline while the desk pushes an update. Coverage will resume in a few minutes — thanks for your patience.</p>
  <hr class="divider">
  <p style="margin:0 0 14px;color:var(--muted);font-size:13px;letter-spacing:0.04em;text-transform:uppercase;font-family:'IBM Plex Mono',monospace;">Stay in the loop</p>
  <div class="channels">
    <a href="${escapeHtml(SITE.x)}" rel="noopener">X / Twitter</a>
    <a href="${escapeHtml(SITE.whatsapp)}" rel="noopener">WhatsApp channel</a>
    <a href="${escapeHtml(SITE.substack)}" rel="noopener">Substack</a>
    <a href="mailto:${escapeHtml(SITE.email)}">Email the desk</a>
  </div>
  <footer>THE GLOBAL DECIPHER · TRACKING TERROR THREATS</footer>
</main>
</body>
</html>
`;
}

function monitoringAccessPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Monitoring Desk Access · ${escapeHtml(SITE.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600;8..60,700&display=swap">
<style>
  :root {
    --paper: #fafaf7;
    --paper-2: #f3efe6;
    --ink: #0d1b2a;
    --muted: #6b6b66;
    --gold: #a17328;
    --red: #b91c2c;
    --line: #d8d3c5;
    --white: #fffdf8;
  }
  * { box-sizing: border-box; }
  html, body { min-height: 100%; margin: 0; }
  body {
    background: var(--paper);
    color: var(--ink);
    font: 16px/1.65 "IBM Plex Sans", system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    display: grid;
    place-items: center;
    padding: 36px 18px;
    -webkit-font-smoothing: antialiased;
  }
  main { width: 100%; max-width: 840px; }
  .panel {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
    gap: 0;
    border: 1px solid var(--line);
    background: var(--white);
    box-shadow: 0 24px 70px rgba(13, 27, 42, 0.11);
  }
  .copy, .checkout { padding: clamp(26px, 5vw, 48px); }
  .copy { border-right: 1px solid var(--line); }
  .eyebrow {
    font-family: "IBM Plex Mono", ui-monospace, monospace;
    font-size: 11px;
    font-weight: 600;
    color: var(--gold);
    letter-spacing: 0.19em;
    text-transform: uppercase;
    margin: 0 0 18px;
  }
  h1 {
    font-family: "Source Serif 4", Georgia, "Times New Roman", serif;
    font-weight: 650;
    font-size: clamp(34px, 6vw, 56px);
    line-height: 1.04;
    margin: 0 0 18px;
    letter-spacing: -0.02em;
  }
  .lede { margin: 0 0 26px; color: var(--muted); font-size: 17px; max-width: 54ch; }
  .rule { width: 56px; height: 2px; background: var(--red); margin: 30px 0; }
  ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 12px; }
  li { display: flex; gap: 10px; color: #283747; }
  li::before { content: ""; flex: 0 0 8px; width: 8px; height: 8px; margin-top: 9px; border-radius: 50%; background: var(--red); }
  .checkout { background: #f8f5ee; }
  .price { margin: 0 0 4px; font-family: "Source Serif 4", Georgia, serif; font-size: 38px; line-height: 1; }
  .price span { font: 13px/1.3 "IBM Plex Mono", ui-monospace, monospace; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; }
  label { display: grid; gap: 8px; margin: 24px 0 14px; font-weight: 600; color: #27384a; }
  input {
    width: 100%;
    border: 1px solid var(--line);
    background: var(--white);
    color: var(--ink);
    padding: 13px 14px;
    font: inherit;
    border-radius: 0;
  }
  button, .secondary {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    border: 0;
    background: var(--red);
    color: #fff;
    padding: 14px 16px;
    font-weight: 700;
    text-decoration: none;
    cursor: pointer;
  }
  .secondary {
    margin-top: 12px;
    background: transparent;
    color: var(--ink);
    border: 1px solid var(--line);
  }
  .note { margin: 14px 0 0; color: var(--muted); font-size: 13px; }
  .included {
    margin: 0 0 12px;
    color: var(--ink);
    font-family: "IBM Plex Mono", ui-monospace, monospace;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  @media (max-width: 760px) {
    body { padding: 18px; place-items: start center; }
    .panel { grid-template-columns: 1fr; }
    .copy { border-right: 0; border-bottom: 1px solid var(--line); }
  }
</style>
</head>
<body>
<main>
  <section class="panel" aria-labelledby="monitoring-access-title">
    <div class="copy">
      <p class="eyebrow">TGD Intelligence</p>
      <h1 id="monitoring-access-title">Monitoring Desk</h1>
      <p class="lede">Continuous open-source security monitoring for Pakistan and the wider region, turned into clear, decision-ready briefings.</p>
      <div class="rule" aria-hidden="true"></div>
      <p class="included">Membership includes</p>
      <ul>
        <li>Incident briefs with key facts, source status, and initial impact.</li>
        <li>Desk assessments explaining what changed, why it matters, and what to watch next.</li>
        <li>Coverage of militant activity, security operations, propaganda, and emerging regional risks.</li>
        <li>Weekly patterns and trend lines drawn from the TGD monitoring archive.</li>
      </ul>
    </div>
    <form class="checkout" method="post" action="/api/monitoring/checkout">
      <p class="eyebrow">Monitoring Desk membership</p>
      <p class="price">$20 <span>/ month</span></p>
      <p class="note">Full access to the complete Monitoring Desk archive and every new briefing published during your membership.</p>
      <label>Subscriber email
        <input required type="email" name="email" autocomplete="email" placeholder="you@example.com">
      </label>
      <input type="hidden" name="return_to" value="/monitoring/">
      <button type="submit">Get Monitoring Desk access</button>
      <a class="secondary" href="/contact/">Subscriber support</a>
      <p class="note">Safepay handles secure checkout. Access opens automatically after subscription confirmation.</p>
    </form>
  </section>
</main>
</body>
</html>`;
}

// Cloudflare Pages advanced-mode worker. Runs on every request to the Pages
// project. Reads the maintenance flag from KV and serves the maintenance page
// for the public site. It also gates only /monitoring/ behind a paid subscriber
// session; other editorial sections and public tools stay open.
function pagesWorker() {
  return `const EXEMPT = [/^\\/admin(\\/|$)/, /^\\/assets\\/admin(?:[.-])/, /^\\/assets\\/vendor\\//, /^\\/assets\\/pakistan-map\\.svg$/, /^\\/assets\\/brand\\/tgd-logo-header(?:-v2)?\\.png$/, /^\\/maintenance\\.html$/, /^\\/monitoring-access(\\/|$)/, /^\\/api(\\/|$)/, /^\\/network-graph\\/data\\/.*\\.json$/, /^\\/favicon\\./];
const MONITORING_PATH = /^\\/monitoring(\\/|$)/;
const SESSION_COOKIE = "tgd_monitoring_session";
const CANONICAL_ORIGIN = "https://theglobaldecipher.com";
const CSP = "default-src 'self'; base-uri 'self'; object-src 'self'; script-src 'self' https://www.googletagmanager.com '${TRUSTED_INLINE_SCRIPT_HASH}' 'sha256-vsaHtlaAQX2eY7ExCku7Rugwp9XNVGCaeQssqNo9vKg='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https: www.google-analytics.com www.googletagmanager.com; connect-src 'self' https://tiles.openfreemap.org https://www.google-analytics.com https://analytics.google.com https://*.analytics.google.com https://region1.google-analytics.com https://stats.g.doubleclick.net; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; media-src 'self' https:; worker-src 'self' blob:; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests";

function secureResponse(response, pathname) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("x-permitted-cross-domain-policies", "none");
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  if ((headers.get("content-type") || "").includes("text/html")) {
    headers.set("x-frame-options", "DENY");
    headers.set("content-security-policy", CSP);
  } else {
    // X-Frame-Options is for document responses. Applying it to same-origin
    // SVG assets prevents the incident map's interactive <object> from loading.
    headers.delete("x-frame-options");
  }
  if (/^\\/(?:admin|monitoring-access)(?:\\/|$)/.test(pathname)) {
    headers.set("cache-control", "no-store");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function cookieValue(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf("=");
    const key = index === -1 ? trimmed : trimmed.slice(0, index);
    if (key === name) return decodeURIComponent(index === -1 ? "" : trimmed.slice(index + 1));
  }
  return "";
}

function isSubscriberActive(subscriber) {
  return subscriber?.active === true;
}

async function hasMonitoringAccess(request, env) {
  const store = env.PAYWALL_KV || env.MAINTENANCE_KV;
  const token = cookieValue(request, SESSION_COOKIE);
  if (!store || !token) return false;
  try {
    const session = await store.get("monitoring:session:" + token, "json");
    if (!session || !session.email_hash || Date.parse(session.expires_at || "") <= Date.now()) return false;
    const subscriber = await store.get("monitoring:subscriber:" + session.email_hash, "json");
    return isSubscriberActive(subscriber);
  } catch (err) {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname.endsWith(".pages.dev")) {
      const target = new URL(url.pathname + url.search, CANONICAL_ORIGIN);
      return secureResponse(Response.redirect(target, 308), url.pathname);
    }
    ${SITE.googleVerificationFile ? `if (url.pathname === "/${SITE.googleVerificationFile}") {
      return new Response("google-site-verification: ${SITE.googleVerificationFile}\\n", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" }
      });
    }` : ""}
    const exempt = EXEMPT.some((re) => re.test(url.pathname));
    if (!exempt && env.MAINTENANCE_KV) {
      try {
        const flag = await env.MAINTENANCE_KV.get("maintenance", { cacheTtl: 60 });
        if (flag === "on") {
          const page = await env.ASSETS.fetch(new URL("/maintenance.html", url.origin));
          return secureResponse(new Response(page.body, {
            status: 503,
            headers: { "content-type": "text/html; charset=utf-8", "retry-after": "3600", "cache-control": "no-store" }
          }), url.pathname);
        }
      } catch (err) {
        // fail open — serve the site
      }
    }
    ${SHOW_MONITORING ? `if (!exempt && MONITORING_PATH.test(url.pathname) && !(await hasMonitoringAccess(request, env))) {
      const page = await env.ASSETS.fetch(new URL("/monitoring-access/index.html", url.origin));
      return secureResponse(new Response(page.body, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
      }), url.pathname);
    }` : "// Monitoring Desk retired: /monitoring/ falls through to a real 404."}
    return secureResponse(await env.ASSETS.fetch(request), url.pathname);
  }
};
`;
}

// Everything one language edition needs, fetched from the API's translated
// dump. The two interactive apps are left out: their interface labels live in
// English inside their own JavaScript, so a translated shell around them would
// promise a language the tool does not actually speak.
const APP_PAGE_SLUGS = new Set(["network-graph", "incident-map"]);

async function readLocaleTree(code) {
  const [news, opinion, reports, profiles, allPages] = await Promise.all([
    readCollection("news", code),
    readCollection("opinion", code),
    readCollection("reports", code),
    readCollection("profiles", code),
    readCollection("pages", code)
  ]);
  const items = [...news, ...opinion, ...reports, ...profiles];
  const pages = allPages.filter((page) => !APP_PAGE_SLUGS.has(page.slug));

  const buildStamp = new Date().toISOString();
  const latestItemStamp = items.reduce(
    (latest, item) => {
      const stamp = isoDateForItem(item);
      return stamp && stamp > latest ? stamp : latest;
    },
    `${buildStamp.slice(0, 10)}T00:00:00Z`
  );
  const listingPaths = ["/", "/news/", "/opinion/", "/reports/", "/profiles/"];

  return {
    code,
    items,
    pages,
    news,
    opinion,
    reports,
    profiles,
    paths: [...listingPaths, ...items.map((item) => item.url), ...pages.map((page) => page.url)],
    entries: [
      ...listingPaths.map((url) => ({ url, lastmod: latestItemStamp })),
      ...items.map((item) => ({ url: item.url, lastmod: isoDateForItem(item) || buildStamp })),
      ...pages.map((page) => ({ url: page.url, lastmod: isoDateForItem(page) || buildStamp }))
    ]
  };
}

// The language front page is a straight reverse-chronological listing rather
// than the English homepage's promotional bands: those bands are built from
// English marketing copy and interactive widgets, and a reader arriving in Urdu
// is better served by the coverage itself.
function writeLocaleTree(tree) {
  writePage("/", listingPage({
    title: t("homeTitle"),
    eyebrow: t("homeEyebrow"),
    summary: t("homeSummary"),
    current: "/",
    items: tree.items,
    filters: []
  }));
  writePage("/news/", listingPage({
    title: t("newsTitle"),
    eyebrow: t("newsEyebrow"),
    summary: t("newsSummary"),
    current: "/news/",
    items: tree.news,
    filters: []
  }));
  writePage("/opinion/", listingPage({
    title: t("opinionTitle"),
    eyebrow: t("opinionEyebrow"),
    summary: t("opinionSummary"),
    current: "/opinion/",
    items: tree.opinion,
    filters: []
  }));
  writePage("/reports/", listingPage({
    title: t("reportsTitle"),
    eyebrow: t("reportsEyebrow"),
    summary: t("reportsSummary"),
    current: "/reports/",
    items: tree.reports
      .slice()
      .sort((a, b) => reportPeriodKey(a) - reportPeriodKey(b) || String(a.date || "").localeCompare(String(b.date || ""))),
    filters: []
  }));
  writePage("/profiles/", listingPage({
    title: t("profilesTitle"),
    eyebrow: t("profilesEyebrow"),
    summary: t("profilesSummary"),
    current: "/profiles/",
    items: tree.profiles,
    filters: []
  }));

  for (const item of tree.items) writePage(item.url, articleTemplate(item, tree.items));
  for (const page of tree.pages) writePage(page.url, pageTemplate(page));
}

async function main() {
  rmDir(OUT_DIR);
  ensureDir(OUT_DIR);
  copyDir(STATIC_DIR, path.join(OUT_DIR, "assets"));
  writeStampedAssets(path.join(OUT_DIR, "assets"));
  copyVendorAssets();

  const [news, opinion, monitoring, reports, profiles, pages] = await Promise.all([
    readCollection("news"),
    readCollection("opinion"),
    // Monitoring lives behind CONTENT_DUMP_TOKEN. While the desk is retired
    // there is nothing to render from it, so skip the protected fetch entirely
    // rather than make every build depend on that credential.
    SHOW_MONITORING ? readCollection("monitoring") : Promise.resolve([]),
    readCollection("reports"),
    readCollection("profiles"),
    readCollection("pages")
  ]);
  const allContent = [
    ...news,
    ...opinion,
    ...(SHOW_MONITORING ? monitoring : []),
    ...reports,
    ...profiles
  ];

  // A database or API fault that answers 200 with nothing would otherwise
  // deploy an empty site over the real one. An entirely empty result is never
  // legitimate here, so stop rather than publish it.
  if (!allContent.length && !pages.length && process.env.ALLOW_EMPTY_CONTENT_BUILD !== "1") {
    throw new Error(
      `The content API returned no articles and no pages, so the build stopped instead of deploying an empty site. ` +
      `Check ${CONTENT_API}/content/dump?folder=news. Set ALLOW_EMPTY_CONTENT_BUILD=1 if an empty site is genuinely intended.`
    );
  }

  const hubs = buildHubIndex(allContent);
  HUB_ORG_SLUGS.clear();
  HUB_REGION_SLUGS.clear();
  for (const hub of hubs.organisations) HUB_ORG_SLUGS.add(hub.slug);
  for (const hub of hubs.regions) HUB_REGION_SLUGS.add(hub.slug);

  // Every language is fetched and registered before a single page is written,
  // because the English pages carry hreflang tags pointing at the Urdu and
  // Pashto versions and cannot know about them otherwise.
  const localeTrees = new Map();
  for (const code of TRANSLATED_LOCALES) {
    const tree = await readLocaleTree(code);
    if (!tree.items.length && !tree.pages.length) {
      console.warn(`No ${code} translations available yet — skipping the /${code}/ tree.`);
      continue;
    }
    localeTrees.set(code, tree);
    registerLocalePages(code, tree.paths);
  }
  registerLocalePages("en", [
    "/", "/news/", "/opinion/", "/reports/", "/profiles/",
    ...allContent.map((item) => item.url),
    ...pages.map((page) => page.url)
  ]);

  writePage("/", homepage(allContent));
  writePage(
    "/news/",
    listingPage({
      title: "News & Analysis",
      eyebrow: "Public briefings",
      summary: "Timely coverage and analytical notes on terrorism, counterterrorism, and regional security developments.",
      current: "/news/",
      items: allContent.filter((item) => item.type === "news"),
      filters: [
        ["South Asia", "South Asia"],
        ["Middle East", "Middle East"],
        ["Digital Propaganda", "Digital Propaganda"]
      ]
    })
  );
  writePage(
    "/opinion/",
    listingPage({
      title: "Opinion",
      eyebrow: "Commentary",
      summary: "Perspective essays and expert commentary on security policy, propaganda, and conflict trends.",
      current: "/opinion/",
      items: allContent.filter((item) => item.type === "opinion"),
      filters: [
        ["Policy", "Policy"],
        ["Media", "Media"],
        ["Research", "Research"]
      ]
    })
  );
  if (SHOW_MONITORING) {
    writePage(
      "/monitoring/",
      listingPage({
        title: "Monitoring Desk",
        eyebrow: "Premium intelligence previews",
        summary: "Structured previews of militant media monitoring, propaganda ecosystems, and narrative shifts.",
        current: "/monitoring/",
        items: allContent.filter((item) => item.type === "monitoring"),
        filters: [
          ["Digital Propaganda", "Digital Propaganda"],
          ["Narratives", "Narratives"],
          ["South Asia", "South Asia"]
        ]
      })
    );
  }
  writePage(
    "/reports/",
    listingPage({
      title: "Reports",
      eyebrow: "Research products",
      summary: "Monthly summaries, trend reviews, and premium research previews for institutional readers.",
      current: "/reports/",
      // Reports read as a chronological series (Jan → Feb → Mar → …). Monthly
      // reports are all uploaded around the same date, so the upload date is
      // useless for ordering — the reporting period pulled from the title is.
      items: allContent
        .filter((item) => item.type === "reports")
        .slice()
        .sort((a, b) => reportPeriodKey(a) - reportPeriodKey(b) || String(a.date || "").localeCompare(String(b.date || ""))),
      filters: [
        ["Monthly", "Monthly"],
        ["Pakistan", "Pakistan"],
        ["Counterterrorism", "Counterterrorism"]
      ]
    })
  );
  writePage(
    "/profiles/",
    listingPage({
      title: "Terrorist Profiles",
      eyebrow: "Actor database",
      summary: "Searchable research profiles on militant leaders, organisations, status, ideology, and operating areas.",
      current: "/profiles/",
      items: allContent.filter((item) => item.type === "profiles"),
      filters: [
        ["South Asia", "South Asia"],
        ["Middle East", "Middle East"],
        ["Deceased", "Deceased"],
        ["In custody", "In custody"],
        ["Wanted", "Wanted"],
        ["Islamic State", "Islamic State"],
        ["al-Qaeda", "al-Qaeda"],
        ["al-Shabaab", "al-Shabaab"],
        ["TTP", "TTP"]
      ]
    })
  );

  for (const item of allContent) writePage(item.url, articleTemplate(item, allContent));
  for (const page of pages) {
    if (page.slug === "network-graph") {
      // The Vite-built React Explorer at apps/explorer/ writes site/network-graph/
      // directly. Skip the legacy static page so we don't clobber the SPA.
      continue;
    }
    writePage(page.url, pageTemplate(page));
  }

  for (const hub of hubs.organisations) writePage(`/organisations/${hub.slug}/`, organisationHubPage(hub, allContent));
  for (const hub of hubs.regions) writePage(`/regions/${hub.slug}/`, regionHubPage(hub, allContent));
  const hubsManifest = {
    organisations: hubs.organisations.map(({ label, slug, items }) => ({ label, slug, count: items.length })),
    regions: hubs.regions.map(({ label, slug, items }) => ({ label, slug, count: items.length }))
  };
  ensureDir(path.join(OUT_DIR, "assets", "data"));
  fs.writeFileSync(path.join(OUT_DIR, "assets", "data", "hubs.json"), JSON.stringify(hubsManifest, null, 2));

  // ---- Urdu and Pashto editions -------------------------------------------
  //
  // The language trees are written from the same templates as the English one.
  // Anything the desk has not had translated yet simply is not there: a
  // half-English Urdu page would be worse than no Urdu page, and the hreflang
  // tags stay honest either way.
  for (const [code, tree] of localeTrees) {
    LOCALE = localeFor(code);
    writeLocaleTree(tree);
  }
  LOCALE = DEFAULT_LOCALE;

  writeRootFile("404.html", notFoundPage());
  writeStaticFiles(allContent, pages, hubs, localeTrees);

  // Admin panel, maintenance page, and the Pages maintenance gate.
  writePage("/admin/", adminPage());
  if (SHOW_MONITORING) writePage("/monitoring-access/", monitoringAccessPage());
  writeRootFile("maintenance.html", maintenancePage());
  writeRootFile("_worker.js", pagesWorker());

  const hubCount = hubs.organisations.length + hubs.regions.length;
  const localeSummary = [...localeTrees.values()]
    .map((tree) => `${tree.code}: ${tree.items.length + tree.pages.length + 5}`)
    .join(", ");
  console.log(
    `Built ${allContent.length + pages.length + hubCount + 7} English pages into ${path.relative(ROOT, OUT_DIR)} `
    + `(${hubCount} hub pages)${localeSummary ? ` · translated editions — ${localeSummary}` : " · no translated editions yet"}`
  );
}

main().catch((err) => { console.error(err); process.exit(1); });
