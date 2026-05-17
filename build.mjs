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
  url: "https://globaldecipher.github.io",
  email: "globaldecipher@gmail.com",
  x: "https://x.com/Global_Decipher",
  whatsapp: "https://whatsapp.com/channel/0029Vb6AWm29WtC2xIe0Yo31",
  substack: "https://substack.com/@theglobaldecipher?utm_source=user-menu"
};

const NAV = [
  ["News", "/news/"],
  ["Opinion", "/opinion/"],
  ["Monitoring", "/monitoring/"],
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
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
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
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
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
      const slug = parsed.data.slug || slugify(file.replace(/\.md$/, ""));
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

function depthFor(urlPath) {
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

function accessLabel(item) {
  if (item.access === "premium-preview") return '<span class="badge badge-premium">Premium preview</span>';
  if (item.sensitivity === "research-sensitive") return '<span class="badge badge-research">Research sensitive</span>';
  return '<span class="badge badge-free">Free</span>';
}

function brandMark(prefix = "") {
  return `<img class="brand-logo" src="${prefix}assets/brand/tgd-logo-header.jpg" alt="The Global Decipher" width="1024" height="480">`;
}

function icon(name) {
  const icons = {
    whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.6 14.4c-.3-.2-1.8-.9-2.1-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-1 1.2-.2.2-.4.2-.7 0-.3-.2-1.3-.5-2.5-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.7.1-.1.3-.4.4-.5.1-.2.2-.3.3-.5.1-.2 0-.4 0-.6 0-.2-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4 0 1.4 1 2.8 1.2 3 .2.2 2.1 3.2 5.1 4.4.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.4 1.3 4.9L2 22l5.2-1.3C8.6 21.5 10.2 22 12 22c5.5 0 10-4.5 10-10S17.5 2 12 2z"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 6l9 7 9-7"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4h11a4 4 0 014 4v12H8a4 4 0 01-4-4V4z"/><path d="M4 16a4 4 0 014-4h11"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>'
  };
  return icons[name] || "";
}

function shell({ title, description, body, current = "", pagePath = "/", extraHead = "" }) {
  const pageTitle = title === SITE.title ? title : `${title} | ${SITE.title}`;
  const assetPrefix = prefixFor(pagePath);
  const nav = NAV.map(([label, href]) => {
    const active = current === href ? ' aria-current="page"' : "";
    return `<a${active} href="${linkFor(href, pagePath)}">${label}</a>`;
  }).join("");
  const year = new Date().getUTCFullYear();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(description || SITE.description)}">
  <meta name="theme-color" content="#fafaf7">
  <meta property="og:title" content="${escapeHtml(pageTitle)}">
  <meta property="og:description" content="${escapeHtml(description || SITE.description)}">
  <meta property="og:type" content="website">
  <link rel="icon" href="${assetPrefix}assets/tgd-mark.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;0,9..144,800;0,9..144,900;1,9..144,500;1,9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap">
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
        <button class="search-btn" type="button" aria-label="Search">${icon("search")}</button>
        <a class="pitch-cta" href="mailto:${SITE.email}?subject=TGD%20pitch">Pitch us</a>
      </div>
      <button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="site-nav" aria-label="Open menu"><span></span></button>
    </div>
  </header>
  <main id="main">${body}</main>
  <footer class="site-footer">
    <div class="container footer-grid">
      <div>
        <a class="footer-brand" href="${linkFor("/", pagePath)}">${brandMark(assetPrefix)}</a>
        <p>${SITE.description}</p>
      </div>
      <div>
        <h2>Channels</h2>
        <a href="${SITE.x}" rel="noopener">X / Twitter</a>
        <a href="${SITE.whatsapp}" rel="noopener">WhatsApp Channel</a>
        <a href="${SITE.substack}" rel="noopener">Substack</a>
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
  const tagMarkup = tags.slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
  return `<article class="content-card" data-search="${escapeHtml([item.title, item.summary, item.category, item.region, tags.join(" ")].join(" ").toLowerCase())}" data-type="${escapeHtml(item.type || "")}" data-region="${escapeHtml(item.region || "")}">
    <div class="card-kicker">
      <span>${escapeHtml(typeLabel(item.type))}</span>
      ${accessLabel(item)}
    </div>
    <h2><a href="${linkFor(item.url, currentPath)}">${escapeHtml(item.title)}</a></h2>
    <p>${escapeHtml(item.summary || "")}</p>
    <div class="card-meta">
      <span>${escapeHtml(formatDate(item.date))}</span>
      <span>${escapeHtml(item.region || item.category || "")}</span>
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
    { icon: "whatsapp", num: "1,770+", label: "WhatsApp subscribers", url: SITE.whatsapp },
    { icon: "x", num: "533", label: "Followers on X", url: SITE.x },
    { icon: "book", num: "Substack", label: "Long-form analysis", url: SITE.substack },
    { icon: "mail", num: "Pitch us", label: "globaldecipher@gmail.com", url: `mailto:${SITE.email}?subject=TGD%20pitch` }
  ];
  const cells = items.map(
    (s) => `<a class="pillar" href="${s.url}" rel="noopener">
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

function tickerStrip(items) {
  const lines = items.slice(0, 8).map((item) => {
    return `<a href="${linkFor(item.url, "/")}"><span class="region">${escapeHtml(item.region || item.category || "Global")}</span><strong>${escapeHtml(item.title)}</strong></a>`;
  });
  if (!lines.length) return "";
  const doubled = [...lines, ...lines].join("");
  return `<div class="ticker-bar">
    <div class="container ticker-row">
      <span class="ticker-label"><span class="live-dot"></span> Live wire</span>
      <div class="ticker-track">
        <div class="ticker-strip">${doubled}</div>
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
        <a class="button primary" href="mailto:${SITE.email}?subject=TGD%20pitch">Email the desk <span class="arrow">→</span></a>
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
  const latest = items.filter((item) => item.type === "news").slice(0, 3);
  const secondary = latest.slice(1);
  const monitoring = items.filter((item) => item.type === "monitoring").slice(0, 3);
  const reports = items.filter((item) => item.type === "reports").slice(0, 2);
  const profiles = items.filter((item) => item.type === "profiles").slice(0, 3);
  const lead = latest[0] || reports[0] || profiles[0] || items[0];
  const todayIso = new Date().toISOString().slice(0, 10);

  const railItems = [...secondary, ...monitoring, ...reports, ...profiles]
    .filter((item) => item && item.url !== lead?.url)
    .slice(0, 3);
  const leadType = lead?.type === "reports" ? "Lead report" : lead?.type === "profiles" ? "Profile" : "Lead briefing";
  const leadCta = lead?.type === "reports" ? "Read report" : lead?.type === "profiles" ? "Read profile" : "Read briefing";
  const leadListHref = lead?.type === "reports" ? "/reports/" : lead?.type === "profiles" ? "/profiles/" : "/news/";
  const leadListLabel = lead?.type === "reports" ? "All reports" : lead?.type === "profiles" ? "All profiles" : "All briefings";
  if (!lead) {
    return shell({
      title: SITE.title,
      description: SITE.description,
      body: `${tickerStrip(items)}
  <section class="hero">
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

  const body = `
  ${tickerStrip(items)}
  <section class="hero">
    <div class="container hero-grid">
      <div class="hero-lead-col">
        <p class="hero-eyebrow">${leadType} · ${escapeHtml(lead.region || "Pakistan")}</p>
        <h1><a href="${linkFor(lead.url, currentPath)}">${escapeHtml(lead.title)}</a></h1>
        <p class="hero-lead">${escapeHtml(lead.summary)}</p>
        <div class="hero-meta">
          <span class="byline">${escapeHtml(lead.author || "TGD Desk")}</span>
          <span>${escapeHtml(formatDate(lead.date))}</span>
          <span>${escapeHtml(lead.region || "Pakistan")}</span>
          ${accessLabel(lead)}
        </div>
        <div class="hero-actions">
          <a class="button primary" href="${linkFor(lead.url, currentPath)}">${leadCta} <span class="arrow">→</span></a>
          <a class="button secondary" href="${linkFor("/methodology/", currentPath)}">How we work</a>
        </div>
      </div>
      <aside class="hero-rail">
        <div class="hero-rail-head">
          <span class="title">Today on the desk</span>
          <span class="status"><span class="live-dot"></span> Updated</span>
        </div>
        ${railItems.length ? railItems.map((item, i) => `<a class="rail-item" href="${linkFor(item.url, currentPath)}">
          <span class="num">0${i + 2}</span>
          <span>
            <span class="meta">${escapeHtml(item.region || item.category || "Brief")}</span>
            <strong>${escapeHtml(item.title)}</strong>
          </span>
        </a>`).join("") : '<p class="empty-state">New uploads will appear here.</p>'}
        <a class="rail-cta" href="${linkFor(leadListHref, currentPath)}">${leadListLabel}</a>
      </aside>
    </div>
  </section>

  <section class="band">
    <div class="container split-heading">
      <div>
        <p class="band-eyebrow">From the desk</p>
        <h2>Latest analysis</h2>
      </div>
      <a href="${linkFor("/news/", currentPath)}">View all</a>
    </div>
    <div class="container card-grid">${latest.map((item) => card(item, currentPath)).join("")}</div>
    ${latest.length ? "" : '<div class="container"><p class="empty-state">News and analysis will appear here after upload.</p></div>'}
  </section>

  ${threatBoard()}

  <section class="desk-section">
    <div class="container desk-grid-pro">
      <div>
        <p class="band-eyebrow">Monitoring desk</p>
        <h2>Tracking militant media — <em>not amplifying it.</em></h2>
        <p>Source logs, confidence labels, and public-interest boundaries. We never reproduce recruitment content or tactical material.</p>
        <a class="button primary" href="${linkFor("/monitoring/", currentPath)}">Request access <span class="arrow">→</span></a>
      </div>
      <div class="desk-list">${monitoring.length ? monitoring.map((item, i) => `<a href="${linkFor(item.url, currentPath)}">
        <span class="num">0${i + 1}</span>
        <span class="body">
          <span>${escapeHtml(item.category || "Monitor")}</span>
          <strong>${escapeHtml(item.title)}</strong>
        </span>
        <span class="arrow">→</span>
      </a>`).join("") : '<p class="empty-state">Monitoring desk previews will appear here after upload.</p>'}</div>
    </div>
  </section>

  <section class="band muted">
    <div class="container split-heading">
      <div>
        <p class="band-eyebrow">Research library</p>
        <h2>Reports &amp; actor profiles</h2>
      </div>
      <a href="${linkFor("/profiles/", currentPath)}">View profiles</a>
    </div>
    <div class="container feature-grid">
      ${reports.map((item) => card(item, currentPath)).join("")}
      ${profiles.map((item) => card(item, currentPath)).join("")}
    </div>
    ${reports.length || profiles.length ? "" : '<div class="container"><p class="empty-state">Reports and profiles will appear here after upload.</p></div>'}
  </section>

  ${pitchBand()}`;

  return shell({ title: SITE.title, description: SITE.description, body, current: "/", pagePath: currentPath });
}

function listingPage({ title, eyebrow, summary, current, items, filters }) {
  const hasItems = items.length > 0;
  const body = `${sectionHero(title, eyebrow, summary)}
  <section class="band">
    <div class="container">
      ${hasItems ? filterToolbar(filters) : ""}
      <div class="listing-grid" data-content-list>
        ${items.map((item) => card(item, current)).join("")}
      </div>
      <p class="empty-state" data-empty-state${hasItems ? " hidden" : ""}>${hasItems ? "No matching briefings found." : "No published items yet. New uploads will appear here."}</p>
    </div>
  </section>`;
  return shell({ title, description: summary, body, current, pagePath: current });
}

function pageTemplate(page) {
  const body = `${sectionHero(page.title, page.eyebrow || "Editorial", page.summary || "")}
  <section class="article-band">
    <div class="container article-shell">
      <article class="article-body">${page.html}</article>
    </div>
  </section>`;
  return shell({ title: page.title, description: page.summary || SITE.description, body, current: page.url, pagePath: page.url });
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
          <a class="button primary" href="mailto:${SITE.email}?subject=TGD%20Premium%20Access%20Request">Contact TGD</a>
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
      ${premiumCta}
    </div>
  </section>
  <section class="band">
    <div class="container split-heading">
      <div>
        <p class="eyebrow">Related reading</p>
        <h2>Continue research</h2>
      </div>
    </div>
    <div class="container card-grid">${related.map((candidate) => card(candidate, item.url, { compact: true })).join("")}</div>
  </section>`;
  return shell({ title: item.title, description: item.summary || SITE.description, body, pagePath: item.url });
}

function writePage(urlPath, html) {
  const clean = urlPath === "/" ? "" : urlPath.replace(/^\/|\/$/g, "");
  const dir = path.join(OUT_DIR, clean);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, "index.html"), html);
}

function writeStaticFiles(items, pages) {
  const urls = [
    "/",
    "/news/",
    "/opinion/",
    "/monitoring/",
    "/reports/",
    "/profiles/",
    ...items.map((item) => item.url),
    ...pages.map((page) => page.url)
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
  fs.writeFileSync(
    path.join(OUT_DIR, "search-index.json"),
    JSON.stringify(
      items.map(({ title, summary, type, region, category, tags, url, date, access }) => ({
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
        ["Threat Assessment", "Threat Assessment"],
        ["Premium", "Premium"]
      ]
    })
  );
  writePage(
    "/profiles/",
    listingPage({
      title: "Terrorist Profiles",
      eyebrow: "Actor database",
      summary: "Research profiles on militant organizations, leadership structures, ideology, and operating areas.",
      current: "/profiles/",
      items: allContent.filter((item) => item.type === "profiles"),
      filters: [
        ["Group", "Group"],
        ["Individual", "Individual"],
        ["South Asia", "South Asia"]
      ]
    })
  );

  for (const item of allContent) writePage(item.url, articleTemplate(item, allContent));
  for (const page of pages) writePage(page.url, pageTemplate(page));
  writeStaticFiles(allContent, pages);

  console.log(`Built ${allContent.length + pages.length + 6} pages into ${path.relative(ROOT, OUT_DIR)}`);
}

main();
