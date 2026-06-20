import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, "content");
const STATIC_DIR = path.join(ROOT, "static");
const OUT_DIR = path.join(ROOT, "site");

const SITE = {
  title: "The Global Decipher",
  shortTitle: "TGD",
  tagline: "Tracking terror threats in Pakistan and the wider region.",
  description:
    "Independent, research-first coverage of terrorism, militant networks, and security risk — focused on Pakistan, with regional and global context.",
  url: "https://theglobaldecipher.com",
  defaultImage: "/assets/brand/tgd-og-default.png",
  email: "globaldecipher@gmail.com",
  x: "https://x.com/Global_Decipher",
  whatsapp: "https://whatsapp.com/channel/0029Vb6AWm29WtC2xIe0Yo31",
  substack: "https://theglobaldecipher.substack.com/"
};

const NAV = [
  ["News", "/news/"],
  ["Opinion", "/opinion/"],
  ["Monitoring", "/monitoring/"],
  ["Incident Map", "/incident-map/"],
  ["Network Graph", "/network-graph/"],
  ["Reports", "/reports/"],
  ["Profiles", "/profiles/"],
  ["Contact", "/contact/"]
];

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

    const heading = trimmed.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      html.push(`<h${level} id="${headingId(heading[2])}">${inlineMarkdown(heading[2])}</h${level}>`);
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

    // HTML block passthrough — paste iframe / video / div embeds straight in.
    if (HTML_LINE_RE.test(trimmed) && !VOID_OR_INLINE_HTML_RE.test(trimmed)) {
      flushAll();
      const block = [trimmed];
      while (i + 1 < lines.length && lines[i + 1].trim() !== "") {
        i++;
        block.push(lines[i]);
      }
      html.push(`<div class="article-embed">${block.join("\n")}</div>`);
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

function readCollection(collection) {
  const dir = path.join(CONTENT_DIR, collection);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const filePath = path.join(dir, file);
      const parsed = parseFrontMatter(filePath);
      const slug = slugify(parsed.data.slug || file.replace(/\.md$/, ""));
      if (!slug) throw new Error(`Could not create a valid slug for ${filePath}`);
      return {
        ...parsed.data,
        collection,
        slug,
        sourcePath: filePath,
        body: parsed.body,
        html: markdownToHtml(parsed.body),
        url: collection === "pages" ? `/${slug}/` : `/${collection}/${slug}/`
      };
    })
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

function formatDate(date) {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(parsed);
}

function typeLabel(type = "") {
  const labels = {
    news: "News & Analysis",
    opinion: "Opinion",
    monitoring: "Monitoring Desk",
    reports: "Report",
    profiles: "Profile",
    page: "Page"
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

function linkFor(url, currentPath = "/") {
  if (/^https?:\/\//.test(url) || url.startsWith("mailto:")) return url;
  const prefix = prefixFor(currentPath);
  if (url === "/") return `${prefix}index.html`;
  return `${prefix}${url.replace(/^\/|\/$/g, "")}/index.html`;
}

function absoluteUrl(url = "/") {
  if (/^https?:\/\//.test(url)) return url;
  const clean = url.startsWith("/") ? url : `/${url}`;
  return `${SITE.url}${clean}`;
}

function canonicalFor(pagePath = "/") {
  if (pagePath === "/") return `${SITE.url}/`;
  return absoluteUrl(pagePath);
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
  if (item.access === "premium-preview") return '<span class="badge badge-premium">Premium preview</span>';
  if (item.sensitivity === "research-sensitive") return '<span class="badge badge-research">Public source</span>';
  return '<span class="badge badge-free">Free</span>';
}

function brandMark(prefix = "", variant = "header") {
  const file = variant === "footer" ? "tgd-logo-footer.png" : "tgd-logo-header.png";
  const small = variant === "footer" ? "tgd-logo-footer-420.png" : "tgd-logo-header-420.png";
  const large = variant === "footer" ? "tgd-logo-footer-840.png" : "tgd-logo-header-840.png";
  if (variant === "footer") {
    return `<img class="brand-logo" src="${prefix}assets/brand/${small}" srcset="${prefix}assets/brand/${small} 420w, ${prefix}assets/brand/${large} 840w, ${prefix}assets/brand/${file} 1800w" sizes="(max-width: 560px) 210px, 280px" alt="The Global Decipher" width="420" height="140">`;
  }
  return `<span class="brand-picture">
    <img class="brand-logo brand-logo-light" src="${prefix}assets/brand/tgd-logo-header-420.png" srcset="${prefix}assets/brand/tgd-logo-header-420.png 420w, ${prefix}assets/brand/tgd-logo-header-840.png 840w, ${prefix}assets/brand/tgd-logo-header.png 1800w" sizes="(max-width: 560px) 210px, 280px" alt="The Global Decipher" width="420" height="140">
    <img class="brand-logo brand-logo-dark" src="${prefix}assets/brand/tgd-logo-footer-420.png" srcset="${prefix}assets/brand/tgd-logo-footer-420.png 420w, ${prefix}assets/brand/tgd-logo-footer-840.png 840w, ${prefix}assets/brand/tgd-logo-footer.png 1800w" sizes="(max-width: 560px) 210px, 280px" alt="The Global Decipher" width="420" height="140">
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

function shell({ title, description, body, current = "", pagePath = "/", extraHead = "", image = SITE.defaultImage, ogType = "website", noindex = false }) {
  const pageTitle = title === SITE.title ? title : `${title} | ${SITE.title}`;
  const assetPrefix = prefixFor(pagePath);
  const pageDescription = description || SITE.description;
  const canonicalUrl = canonicalFor(pagePath);
  const ogImage = absoluteUrl(image || SITE.defaultImage);
  const nav = NAV.map(([label, href]) => {
    const active = current === href || (href !== "/" && pagePath.startsWith(href)) ? ' aria-current="page"' : "";
    return `<a${active} href="${linkFor(href, pagePath)}">${label}</a>`;
  }).join("");
  const year = new Date().getUTCFullYear();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(pageDescription)}">
  ${noindex ? '<meta name="robots" content="noindex, follow">' : ""}
  <meta name="theme-color" content="#fafaf7" id="theme-color-meta">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
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
  <link rel="icon" href="${assetPrefix}assets/tgd-mark.svg" type="image/svg+xml">
  <link rel="alternate" type="application/rss+xml" title="${escapeHtml(SITE.title)} RSS" href="${SITE.url}/rss.xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..900;1,8..60,400..900&display=swap">
  <script>(function(){try{var theme=localStorage.getItem("tgd-theme");if(theme==="light"||theme==="dark"){document.documentElement.dataset.theme=theme;}}catch(_error){}})();</script>
  <link rel="stylesheet" href="${assetPrefix}assets/styles.css">
  ${extraHead}
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="container header-grid">
      <a class="brand" href="${linkFor("/", pagePath)}" aria-label="${SITE.title} home">
        ${brandMark(assetPrefix)}
      </a>
      <nav class="site-nav" id="site-nav" aria-label="Primary navigation">${nav}</nav>
      <div class="header-cta">
        <button class="theme-toggle" type="button" aria-label="Switch color theme" data-theme-toggle>
          <span class="theme-icon theme-sun" aria-hidden="true">${icon("sun")}</span>
          <span class="theme-icon theme-moon" aria-hidden="true">${icon("moon")}</span>
        </button>
        <button class="search-btn" type="button" aria-label="Search" aria-expanded="false" aria-controls="site-search" data-search-toggle>${icon("search")}</button>
        <a class="pitch-cta" href="${linkFor("/contact/", pagePath)}">Pitch us</a>
      </div>
      <button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="site-nav" aria-label="Open menu"><span></span></button>
    </div>
    <section class="site-search-panel" id="site-search" data-site-search data-search-index="${assetPrefix}search-index.json" hidden>
      <div class="container site-search-inner">
        <label>
          <span>Search TGD</span>
          <input type="search" data-site-search-input placeholder="Search reports, profiles, regions, groups, or themes" autocomplete="off">
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
        <p>${SITE.description}</p>
      </div>
      <div>
        <h2>Channels</h2>
        <a href="${SITE.x}" target="_blank" rel="noopener">X / Twitter</a>
        <a href="${SITE.whatsapp}" target="_blank" rel="noopener">WhatsApp Channel</a>
        <a href="${SITE.substack}" target="_blank" rel="noopener">Substack</a>
      </div>
      <div>
        <h2>Editorial</h2>
        <a href="${linkFor("/methodology/", pagePath)}">Methodology</a>
        <a href="${linkFor("/corrections-policy/", pagePath)}">Corrections</a>
        <a href="${linkFor("/privacy-policy/", pagePath)}">Privacy</a>
      </div>
      <div>
        <h2>Pitch &amp; Contact</h2>
        <a href="mailto:${SITE.email}">${SITE.email}</a>
        <a href="${linkFor("/contact/", pagePath)}">Contact desk</a>
        <a href="${linkFor("/about/", pagePath)}">About TGD</a>
      </div>
    </div>
    <div class="container footer-bottom">
      <span>© ${year} The Global Decipher · Independent research</span>
      <span>Public-interest reporting · No propaganda amplification</span>
    </div>
  </footer>
  <script src="${assetPrefix}assets/main.js" defer></script>
</body>
</html>`;
}

function card(item, currentPath = "/", { compact = false } = {}) {
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const tagMarkup = tags.slice(0, 3).map((tag) => tagChip(tag, currentPath)).join("");
  const status = item.type === "profiles" ? profileStatus(item) : "";
  const statusSlug = status ? slugify(status) : "";
  const categoryAccent = item.type !== "profiles"
    ? slugify(item.region || item.category || item.type || "")
    : "";
  const accentClass = item.type === "profiles"
    ? (statusSlug ? `status-${statusSlug}` : "")
    : (categoryAccent ? `accent-${categoryAccent}` : "");
  const searchText = [item.title, item.summary, item.category, item.region, status, tags.join(" ")].join(" ").toLowerCase();
  return `<article class="content-card${accentClass ? ` ${accentClass}` : ""}" data-search="${escapeHtml(searchText)}" data-type="${escapeHtml(item.type || "")}" data-region="${escapeHtml(item.region || "")}" data-category="${escapeHtml(item.category || "")}" data-status="${escapeHtml(status)}">
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
    ${compact ? "" : `<div class="tag-row">${tagMarkup}</div>`}
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
      <span>Search</span>
      <input type="search" data-search-input placeholder="Search by region, actor, theme, or report">
    </label>
    <div class="filter-buttons" data-filter-buttons>
      <button type="button" data-filter="all" class="active">All</button>
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
  const netPreview = `<svg class="tool-element-network" viewBox="0 0 220 150" aria-hidden="true">
    <g class="tool-bonds">
      <line x1="55" y1="42" x2="111" y2="72"/>
      <line x1="166" y1="35" x2="111" y2="72"/>
      <line x1="111" y1="72" x2="58" y2="116"/>
      <line x1="111" y1="72" x2="169" y2="111"/>
      <line class="dashed" x1="55" y1="42" x2="166" y2="35"/>
    </g>
    <g class="tool-element cell-gold" transform="translate(28 15)">
      <rect width="54" height="54"/><text class="number" x="6" y="11">01</text><text class="symbol" x="27" y="35">AQ</text><text class="name" x="27" y="47">AL-QAEDA</text>
    </g>
    <g class="tool-element cell-ink" transform="translate(139 8)">
      <rect width="54" height="54"/><text class="number" x="6" y="11">02</text><text class="symbol" x="27" y="35">IS</text><text class="name" x="27" y="47">ISLAMIC STATE</text>
    </g>
    <g class="tool-element cell-red" transform="translate(84 45)">
      <rect width="54" height="54"/><text class="number" x="6" y="11">03</text><text class="symbol" x="27" y="35">TTP</text><text class="name" x="27" y="47">PAKISTAN</text>
    </g>
    <g class="tool-element cell-paper" transform="translate(31 89)">
      <rect width="54" height="54"/><text class="number" x="6" y="11">04</text><text class="symbol" x="27" y="35">LeT</text><text class="name" x="27" y="47">LASHKAR</text>
    </g>
    <g class="tool-element cell-paper" transform="translate(142 84)">
      <rect width="54" height="54"/><text class="number" x="6" y="11">05</text><text class="symbol" x="27" y="35">BLA</text><text class="name" x="27" y="47">BALOCHISTAN</text>
    </g>
  </svg>`;
  return `<section class="band tools-band">
    <div class="container split-heading">
      <div>
        <p class="band-eyebrow">Intelligence tools</p>
        <h2>Live research tools, built in-house.</h2>
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
  const lead = reports[0] || profiles[0] || items[0];
  const metrics = lead?.type === "reports" ? extractReportMetrics(lead.body) : [];
  const metricMap = new Map(metrics);
  const profileRegions = new Set(profiles.map((item) => item.region).filter(Boolean));
  const briefings = items.filter((item) => ["news", "opinion", "monitoring"].includes(item.type));
  const railItems = [
    ...briefings,
    ...reports.slice(1),
    ...profiles
  ]
    .filter((item, idx, arr) => item && item.url !== lead?.url && arr.findIndex((other) => other.url === item.url) === idx)
    .slice(0, 5);
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

  const stats = [
    ["Profiles", profiles.length, "Research profiles live"],
    ["Regions", profileRegions.size, "Actor database coverage"],
    ["Reports", reports.length, "Published assessments"],
    metricMap.get("Militant attacks reported") ? ["Attacks", metricMap.get("Militant attacks reported"), `${reportPeriod} report`] : null,
    metricMap.get("Fatalities") ? ["Fatalities", metricMap.get("Fatalities"), `${reportPeriod} report`] : null,
    metricMap.get("Injuries") ? ["Injuries", metricMap.get("Injuries"), `${reportPeriod} report`] : null
  ].filter(Boolean).slice(0, 6);

  const body = `
  ${tickerStrip(items)}
  <section class="hero">
    <div class="hero-map" aria-hidden="true">${heroMapSvg()}</div>
    <div class="container hero-grid">
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
          <a class="button secondary" href="${linkFor("/profiles/", currentPath)}">Explore profiles</a>
        </div>
      </div>
      <aside class="hero-rail">
        <div class="hero-rail-head">
          <span class="title">Latest research</span>
          <span class="status"><span class="live-dot"></span> Recently updated</span>
        </div>
        ${railItems.length ? railItems.map((item, i) => {
          const status = item.type === "profiles" ? profileStatus(item) : "";
          const statusSlug = status ? slugify(status) : "";
          const metaParts = [typeLabel(item.type), item.region || item.category]
            .filter(Boolean)
            .map(escapeHtml)
            .join(" · ");
          return `<a class="rail-item${statusSlug ? ` rail-status-${statusSlug}` : ""}" href="${linkFor(item.url, currentPath)}">
          <span class="num">0${i + 2}</span>
          <span>
            <span class="meta">${metaParts}${status ? ` · <span class="rail-status">${escapeHtml(status)}</span>` : ""}</span>
            <strong>${escapeHtml(item.title)}</strong>
          </span>
        </a>`;
        }).join("") : '<p class="empty-state">New uploads will appear here.</p>'}
        <a class="rail-cta" href="${linkFor("/profiles/", currentPath)}">Explore profiles</a>
      </aside>
    </div>
  </section>

  <section class="snapshot-strip">
    <div class="container snapshot-grid">
      ${stats.map(([label, value, note]) => `<article class="snapshot-card">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <small>${escapeHtml(note)}</small>
      </article>`).join("")}
    </div>
  </section>

  ${toolsBand(currentPath)}

  <section class="band muted">
    <div class="container split-heading">
      <div>
        <p class="band-eyebrow">Start here</p>
        <h2>Reports and actor profiles, built for scanning.</h2>
      </div>
      <a href="${linkFor("/reports/", currentPath)}">View reports</a>
    </div>
    <div class="container gateway-grid">
      <a class="gateway-card" href="${linkFor("/reports/", currentPath)}">
        <span class="gateway-kicker">Monthly assessments</span>
        <strong>Read structured Pakistan security reports</strong>
        <p>Casualties, tactics, provincial trends, threat actors, and downloadable source PDFs.</p>
      </a>
      <a class="gateway-card" href="${linkFor("/profiles/", currentPath)}">
        <span class="gateway-kicker">Actor database</span>
        <strong>Explore terrorist and militant leader profiles</strong>
        <p>Search by region, organisation, status, and movement ecosystem.</p>
      </a>
    </div>
  </section>

  <section class="band">
    <div class="container split-heading">
      <div>
        <p class="band-eyebrow">Actor database</p>
        <h2>Latest profiles</h2>
      </div>
      <a href="${linkFor("/profiles/", currentPath)}">View all profiles</a>
    </div>
    <div class="container card-grid">${profiles.slice(0, 6).map((item) => card(item, currentPath)).join("")}</div>
  </section>

  ${reports.length ? `<section class="band muted">
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

  return shell({ title: SITE.title, description: SITE.description, body, current: "/", pagePath: currentPath });
}

function sparseListingCta({ title, current, count }) {
  if (count >= 2 || current === "/profiles/") return "";
  return `<aside class="listing-cta">
    <div>
      <span>Editorial desk</span>
      <strong>${escapeHtml(title)} is being built out.</strong>
      <p>New briefings will appear here as the desk publishes. Follow the WhatsApp channel or pitch the desk with relevant public-source material.</p>
    </div>
    <div class="listing-cta-actions">
      <a class="button primary" href="${SITE.whatsapp}" target="_blank" rel="noopener">WhatsApp channel</a>
      <a class="button secondary" href="${linkFor("/contact/", current)}">Pitch the desk</a>
    </div>
  </aside>`;
}

function featuredArticleBlock(item, current) {
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const tagMarkup = tags.slice(0, 4).map((tag) => tagChip(tag, current)).join("");
  return `<article class="featured-article">
    <div class="featured-meta">
      <span class="featured-kicker">${escapeHtml(typeLabel(item.type))}${item.region ? ` · ${escapeHtml(item.region)}` : ""}</span>
      ${accessLabel(item)}
    </div>
    <h2><a href="${linkFor(item.url, current)}">${escapeHtml(item.title)}</a></h2>
    <p class="featured-summary">${escapeHtml(item.summary || "")}</p>
    <div class="featured-byline">
      <span class="byline">By ${escapeHtml(item.author || "TGD Desk")}</span>
      <span>${escapeHtml(formatDate(item.date))}</span>
      ${item.region ? `<span>${escapeHtml(item.region)}</span>` : ""}
    </div>
    ${tagMarkup ? `<div class="tag-row">${tagMarkup}</div>` : ""}
    <a class="button primary featured-cta" href="${linkFor(item.url, current)}">Read briefing <span class="arrow">→</span></a>
  </article>`;
}

function listingPage({ title, eyebrow, summary, current, items, filters }) {
  const hasItems = items.length > 0;
  const layoutClass = items.length === 1
    ? "listing-grid layout-feature"
    : items.length <= 3
      ? "listing-grid layout-duo"
      : "listing-grid layout-grid";
  const renderList = () => {
    if (items.length === 1) {
      return `<div class="${layoutClass}" data-content-list>${featuredArticleBlock(items[0], current)}</div>`;
    }
    if (items.length <= 3) {
      const [lead, ...rest] = items;
      return `<div class="${layoutClass}" data-content-list>
        ${featuredArticleBlock(lead, current)}
        <div class="duo-rail">${rest.map((item) => card(item, current, { compact: true })).join("")}</div>
      </div>`;
    }
    return `<div class="${layoutClass}" data-content-list>${items.map((item) => card(item, current)).join("")}</div>`;
  };
  const body = `${sectionHero(title, eyebrow, summary)}
  <section class="band">
    <div class="container">
      ${hasItems && items.length > 3 ? filterToolbar(filters) : ""}
      ${hasItems ? renderList() : `<div class="listing-grid layout-grid" data-content-list></div>`}
      <p class="empty-state" data-empty-state${hasItems ? " hidden" : ""}>${hasItems ? "No matching briefings found." : "No published items yet. New uploads will appear here."}</p>
      ${sparseListingCta({ title, current, count: items.length })}
    </div>
  </section>`;
  return shell({ title, description: summary, body, current, pagePath: current });
}

function pageTemplate(page) {
  const isWide = page.wide === true
    || /incident-tracker-shell|network-graph-shell/.test(page.html);
  const shellClass = isWide ? "" : " static-page-shell";
  const bodyClass = isWide ? "" : " static-page-body";
  const body = `${sectionHero(page.title, page.eyebrow || "Editorial", page.summary || "")}
  <section class="article-band">
    <div class="container">
      <div class="page-shell${shellClass}">
        <article class="article-body${bodyClass}">${page.html}</article>
      </div>
    </div>
  </section>`;
  return shell({
    title: page.title,
    description: page.summary || SITE.description,
    body,
    current: page.url,
    pagePath: page.url,
    extraHead: page.extra_head || "",
    image: page.og_image || page.image || SITE.defaultImage
  });
}

function articleSidebar(item) {
  const headings = collectHeadings(item.body).filter((heading) => heading.level === 2).slice(0, 10);
  const pdfs = extractPdfLinks(item.body);
  const metrics = item.type === "reports" ? extractReportMetrics(item.body).slice(0, 4) : [];
  const facts = item.type === "profiles" ? profileFacts(item) : [];
  const tags = Array.isArray(item.tags) ? item.tags : [];

  const metricBlock = metrics.length
    ? `<div class="article-side-panel">
        <h2>At a glance</h2>
        <dl class="side-stats">${metrics.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
      </div>`
    : "";

  const factBlock = facts.length
    ? `<div class="article-side-panel">
        <h2>Profile facts</h2>
        <dl class="side-facts">${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
      </div>`
    : "";

  const tocBlock = headings.length
    ? `<div class="article-side-panel">
        <h2>On this page</h2>
        <nav class="article-toc" aria-label="Article sections">${headings.map((heading) => `<a href="#${heading.id}">${escapeHtml(heading.title)}</a>`).join("")}</nav>
      </div>`
    : "";

  const pdfBlock = pdfs.length
    ? `<div class="article-side-panel">
        <h2>Files</h2>
        ${pdfs.map((pdf) => `<a class="file-link" href="${escapeHtml(pdf.href)}">${escapeHtml(pdf.label || "Download PDF")}</a>`).join("")}
      </div>`
    : "";

  const tagBlock = tags.length
    ? `<div class="article-side-panel">
        <h2>Tags</h2>
        <div class="side-tags">${tags.map((tag) => tagChip(tag, item.url)).join("")}</div>
      </div>`
    : "";

  const researchBlock = item.type === "profiles"
    ? `<div class="article-side-panel">
        <h2>Research note</h2>
        <p>Public-source profile. TGD excludes operational guidance and treats uncertain current-status claims separately.</p>
      </div>`
    : "";

  const shareBlock = `<div class="article-side-panel share-panel">
        <h2>Share</h2>
        <button type="button" class="copy-link" data-copy-link="${escapeHtml(absoluteUrl(item.url))}">Copy link</button>
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
          <h2>Request full access</h2>
          <p>This is a public preview. Full Monitoring Desk notes and premium reports are handled manually for subscribers and institutional clients.</p>
          <a class="button primary" href="${linkFor("/contact/", item.url)}">Contact TGD</a>
        </aside>`
      : "";
  const body = `<section class="article-hero">
    <div class="container article-head">
      <p class="eyebrow">${escapeHtml(typeLabel(item.type))} · ${escapeHtml(item.region || "Global")}</p>
      <h1>${escapeHtml(item.title)}</h1>
      <p>${escapeHtml(item.summary || "")}</p>
      <div class="article-meta">
        <span class="byline">By ${escapeHtml(item.author || "TGD Desk")}</span>
        <span>${escapeHtml(formatDate(item.date))}</span>
        <span>${escapeHtml(item.region || "Global")}</span>
        ${accessLabel(item)}
      </div>
    </div>
  </section>
  <section class="article-band">
    <div class="container article-shell">
      <article class="article-body">${item.html}</article>
      ${articleSidebar(item)}
      ${premiumCta}
    </div>
  </section>
  ${related.length ? `<section class="band">
    <div class="container split-heading">
      <div>
        <p class="eyebrow">Related reading</p>
        <h2>Continue research</h2>
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
    ogType: "article"
  });
}

function writePage(urlPath, html) {
  const clean = urlPath === "/" ? "" : urlPath.replace(/^\/|\/$/g, "");
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
      <h1>This page is not in the archive.</h1>
      <p>The link may have moved, or the briefing may not have been published yet.</p>
      <div class="not-found-actions">
        <a class="button primary" href="index.html">Return home</a>
        <a class="button secondary" href="contact/index.html">Contact the desk</a>
      </div>
    </div>
  </section>`;
  return shell({ title: "Page not found", description: "The requested TGD page could not be found.", body, pagePath: "/404.html", noindex: true });
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
  fs.writeFileSync(path.join(OUT_DIR, "feed.xml"), xml);
}

function writeStaticFiles(items, pages, hubs = { organisations: [], regions: [] }) {
  const urls = [
    "/",
    "/news/",
    "/opinion/",
    "/monitoring/",
    "/reports/",
    "/profiles/",
    ...items.map((item) => item.url),
    ...pages.map((page) => page.url),
    ...hubs.organisations.map((hub) => `/organisations/${hub.slug}/`),
    ...hubs.regions.map((hub) => `/regions/${hub.slug}/`)
  ];

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((url) => `  <url><loc>${SITE.url}${url}</loc></url>`)
  .join("\n")}
</urlset>`;

  fs.writeFileSync(path.join(OUT_DIR, "sitemap.xml"), sitemap);
  fs.writeFileSync(
    path.join(OUT_DIR, "robots.txt"),
    `User-agent: *\nAllow: /\nSitemap: ${SITE.url}/sitemap.xml\n`
  );
  fs.writeFileSync(path.join(OUT_DIR, ".nojekyll"), "");
  writeRssFeed(items);
  fs.writeFileSync(
    path.join(OUT_DIR, "search-index.json"),
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
    return `<section class="band">
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
  return `<section class="band">
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

function main() {
  rmDir(OUT_DIR);
  ensureDir(OUT_DIR);
  copyDir(STATIC_DIR, path.join(OUT_DIR, "assets"));

  const allContent = [
    ...readCollection("news"),
    ...readCollection("opinion"),
    ...readCollection("monitoring"),
    ...readCollection("reports"),
    ...readCollection("profiles")
  ];
  const pages = readCollection("pages");

  const hubs = buildHubIndex(allContent);
  HUB_ORG_SLUGS.clear();
  HUB_REGION_SLUGS.clear();
  for (const hub of hubs.organisations) HUB_ORG_SLUGS.add(hub.slug);
  for (const hub of hubs.regions) HUB_REGION_SLUGS.add(hub.slug);

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
  writePage(
    "/reports/",
    listingPage({
      title: "Reports",
      eyebrow: "Research products",
      summary: "Monthly summaries, trend reviews, and premium research previews for institutional readers.",
      current: "/reports/",
      items: allContent.filter((item) => item.type === "reports"),
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
  for (const page of pages) writePage(page.url, pageTemplate(page));

  for (const hub of hubs.organisations) writePage(`/organisations/${hub.slug}/`, organisationHubPage(hub, allContent));
  for (const hub of hubs.regions) writePage(`/regions/${hub.slug}/`, regionHubPage(hub, allContent));
  const hubsManifest = {
    organisations: hubs.organisations.map(({ label, slug, items }) => ({ label, slug, count: items.length })),
    regions: hubs.regions.map(({ label, slug, items }) => ({ label, slug, count: items.length }))
  };
  ensureDir(path.join(OUT_DIR, "assets", "data"));
  fs.writeFileSync(path.join(OUT_DIR, "assets", "data", "hubs.json"), JSON.stringify(hubsManifest, null, 2));

  writeRootFile("404.html", notFoundPage());
  writeStaticFiles(allContent, pages, hubs);

  const hubCount = hubs.organisations.length + hubs.regions.length;
  console.log(`Built ${allContent.length + pages.length + hubCount + 6} pages into ${path.relative(ROOT, OUT_DIR)} (${hubCount} hub pages)`);
}

main();
