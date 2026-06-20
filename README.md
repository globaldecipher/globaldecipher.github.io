# The Global Decipher

Independent, research-first coverage of terrorism, militant networks, and security risk — focused on Pakistan, with regional and global context.

**Live site:** https://globaldecipher.github.io

The Global Decipher (TGD) is an OSINT publication. It puts out news briefs, opinion, monitoring updates, monthly reports, and threat-actor / organisation profiles, plus two interactive tools: a **Pakistan incident map** and a **militant network graph**. New incident reports are ingested automatically from a Telegram channel and an X account, and editors can publish articles and incidents through GitHub issue forms — no local tooling required.

---

## Tech stack

| Layer | Choice |
|---|---|
| Site generator | Custom static-site builder in a single file, [`build.mjs`](build.mjs) (~2,000 lines). **Zero npm dependencies** — pure Node.js stdlib (`node:fs`, `node:path`). Hand-rolled Markdown parser, HTML templating (template literals), RSS/Atom feed, sitemap, robots.txt, and JSON search index. |
| Content | Markdown + front-matter files under [`content/`](content) (`news`, `opinion`, `monitoring`, `reports`, `profiles`, `pages`). |
| Frontend | Vanilla JS, no framework. [`main.js`](static/main.js) (client-side search), [`incident-map.js`](static/incident-map.js) (interactive map), [`network-graph.js`](static/network-graph.js) (network graph) + CSS. The map and graph are hand-built from SVG/JSON — no Leaflet/D3/Mapbox. |
| Data | JSON under [`static/data/`](static/data) — `incidents.json`, `network-*.json`. |
| Build runtime | Node.js 22. |
| Hosting | Cloudflare Pages (static site) on `globaldecipher.com`. |
| Live incident feed | Cloudflare **Worker** (cron poller) + **KV** store — see [`worker/`](worker). |
| CI/CD & automation | GitHub Actions (build/deploy + content publishing). |

The rendered pages pull Google Fonts CSS; everything else (map UI, graph, search, district coords) is same-origin static. The **incident feed is dynamic** — fetched from the Worker at `/api/incidents`, not baked into the build.

---

## Repo structure

```
content/          ← Markdown source for every article (you edit these)
  news/  opinion/  monitoring/  reports/  profiles/
  pages/          ← static pages (About, Contact, Methodology, policies…)
static/           ← CSS, JS, brand images, and static JSON data
  data/           ← network graphs, district coords; incidents.json (seed only)
  data/imports/   ← CSV imports
build.mjs         ← the entire static-site builder
worker/           ← Cloudflare Worker: polls Telegram/X → KV, serves /api/incidents
  src/            ← index.js (entry), feed.js, telegram.js, x.js
  wrangler.toml   ← Worker config (KV binding, cron, route)
.github/
  workflows/      ← GitHub Actions (deploy + content/incident publishing)
  scripts/        ← issue-form parsers (article + incident)
  ISSUE_TEMPLATE/ ← issue forms for publishing content & incidents
site/             ← built output (gitignored — regenerated on every build)
```

---

## How it builds

`node build.mjs` reads `content/` + `static/`, renders every page, and writes a complete static site to `site/`:

- HTML pages for each article, profile, organisation, region, and listing
- `feed.xml` / `rss.xml`, `sitemap.xml`, `robots.txt`, `404.html`
- `search-index.json` for client-side search

Current output: ~106 files, ~3 MB.

The site `url`, title, contact, and social links live in the `SITE` object at the top of `build.mjs`. **This `url` is hard-coded into canonical tags, the sitemap, and the RSS feed** — change it there if the domain changes.

---

## Architecture: static site vs. dynamic feed

The site splits cleanly in two so that high-frequency incident updates never trigger a rebuild:

- **Static (Cloudflare Pages):** all articles, profiles, orgs, regions, the map UI, JS/CSS, network graph, district coords. Rebuilt + deployed by GitHub Actions **only when content changes** (a few times a week).
- **Dynamic (Cloudflare Worker + KV):** the live incident feed. A Worker polls Telegram/X on a cron, merges results into KV, and serves them at `GET /api/incidents`. The map fetches that at runtime. **No commits, no builds, no deploys for incident updates.**

See [`worker/`](worker) and the full provisioning runbook in [`CLOUDFLARE_SETUP.md`](CLOUDFLARE_SETUP.md).

### Worker (`worker/src/`)

| File | Role |
|---|---|
| `index.js` | `scheduled()` cron handler (poll → KV) + `fetch()` handler (`GET /api/incidents`, authed `POST /api/incidents`) |
| `telegram.js` | Telegram channel polling → incident objects |
| `x.js` | X (Twitter) account polling → incident objects |
| `feed.js` | district lookup, date/archive helpers, KV read/write, merge/dedupe/prune |

Config in `worker/wrangler.toml`: KV binding `INCIDENTS`, cron `*/5 * * * *`, route `globaldecipher.com/api/*`. Secrets (`wrangler secret put`): `TELEGRAM_BOT_TOKEN`, `X_BEARER_TOKEN`, `ADMIN_TOKEN`.

### GitHub Actions (`.github/workflows/`)

| Workflow | Trigger | What it does | Secrets |
|---|---|---|---|
| **deploy.yml** | push to `main`, manual | Build the site and deploy to Cloudflare Pages (direct upload via wrangler). | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| **content-upload.yml** | issue with `content-upload` label | Issue form → Markdown article in `content/` → commit → deploy. Write-gated. | `CLOUDFLARE_*` |
| **incident-update.yml** | issue with `incident-update` label | Issue form → parse incident → **POST to the Worker** (KV), no commit. Write-gated. | `WORKER_INGEST_URL`, `TGD_ADMIN_TOKEN` |

The repo is **public**, so Actions minutes are free and unmetered. The deploy uses Cloudflare **direct upload**, which doesn't count against Pages' 500-build/month free limit.

---

## Publishing

See [`HOW_TO_PUBLISH.md`](HOW_TO_PUBLISH.md) and [`CONTENT_UPLOAD_GUIDE.md`](CONTENT_UPLOAD_GUIDE.md).

- **Article:** edit/add a Markdown file in `content/` (or use the *Content upload* issue form). Push → Action builds + deploys.
- **Incident (by hand):** open an *Incident update* issue. The Worker ingests it; the map updates within ~1 minute with no deploy.
- **Incidents (automatic):** the Worker polls Telegram + X on its own — nothing to do.

---

## Build locally (optional)

Only needed for testing CSS or build changes — articles can be published entirely from the GitHub web UI.

```bash
node build.mjs
python3 -m http.server 4173 --directory site
# open http://localhost:4173
```

---

## Hosting / deployment

Served by **Cloudflare Pages** on `globaldecipher.com`, with the incident feed on a **Cloudflare Worker + KV**. Full one-time provisioning steps (Pages project, KV namespace, secrets, domain, seeding) are in **[`CLOUDFLARE_SETUP.md`](CLOUDFLARE_SETUP.md)**.

`GITHUB_PAGES_SETUP.md` describes the previous GitHub Pages hosting and is kept for reference only.

---

## Editorial posture

- Public-source first. Claim vs. confirmation discipline.
- No propaganda reproduction, no graphic media, no tactical detail.
- Open corrections policy.
- See `/methodology/` and `/corrections-policy/` on the live site.
