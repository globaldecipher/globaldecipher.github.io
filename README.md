# The Global Decipher

Independent, research-first coverage of terrorism, militant networks, and security risk — focused on Pakistan, with regional and global context.

**Live site:** https://theglobaldecipher.com

The Global Decipher (TGD) is an OSINT publication. It puts out news briefs, opinion, monitoring updates, monthly reports, and threat-actor / organisation profiles, plus two interactive tools: a **Pakistan incident map** and a **militant network graph**. Editors and interns manage incidents, D1-backed editorial content, R2 media, monthly report drafts, and maintenance from the web **admin panel** at `/admin`.

---

## Tech stack

| Layer | Choice |
|---|---|
| Site generator | Custom static-site builder in a single file, [`build.mjs`](build.mjs) (~2,000 lines). **Zero npm dependencies** — pure Node.js stdlib (`node:fs`, `node:path`). Hand-rolled Markdown parser, HTML templating (template literals), RSS/Atom feed, sitemap, robots.txt, and JSON search index. |
| Editorial content | Cloudflare D1 rows (`news`, `opinion`, `monitoring`, `reports`, `profiles`, `pages`), exchanged as Markdown with front matter through the Admin API. |
| Frontend | Vanilla JS for the publication shell and incident map; React/Vite, D3, and MapLibre for the research Explorer under [`apps/explorer/`](apps/explorer). |
| Data | Cloudflare KV for the live incident feed; JSON under [`static/data/`](static/data) for the historical incident baseline and Explorer/network datasets. |
| Build runtime | Node.js 22. |
| Hosting | Cloudflare Pages (static site) on `theglobaldecipher.com`. |
| Media | Cloudflare R2 for uploaded research media and generated monthly charts. |
| Live services | Cloudflare **Worker** + **KV**, **D1**, and **R2** bindings — see [`worker/`](worker). |
| CI/CD & automation | GitHub Actions for code/deployment; Worker cron for monthly report drafts and optional X imports. |

The rendered pages pull Google Fonts CSS; everything else (map UI, graph, search, district coords) is same-origin static. The **incident feed is dynamic** — fetched from the Worker at `/api/incidents`, not baked into the build.

---

## Repo structure

```
content/          ← historical migration snapshot; production editorial content lives in D1
  news/  opinion/  monitoring/  reports/  profiles/
  pages/          ← static pages (About, Contact, Methodology, policies…)
static/           ← CSS, JS, brand images, and static JSON data
  admin.js / admin.css ← the /admin panel SPA (self-contained)
  data/           ← network graphs, district coords; incidents.json (seed only)
build.mjs         ← static-site builder (also emits /admin, maintenance.html, _worker.js)
worker/           ← Cloudflare Worker: admin API, incidents, editorial content, analytics
  src/            ← index.js, analytics.js, ask.js, feed.js, content.js, media.js
  wrangler.toml   ← Worker config (KV, D1, R2, cron, routes)
.github/
  workflows/      ← GitHub Actions (deploy + optional incident issue ingestion)
  scripts/        ← incident issue-form parser
  ISSUE_TEMPLATE/ ← optional incident issue form
site/             ← built output (gitignored — regenerated on every build)
```

---

## How it builds

`node build.mjs` downloads published editorial rows from the Worker/D1 API, reads `static/`, renders every page, and writes a complete static site to `site/`:

- HTML pages for each article, profile, organisation, region, and listing
- `feed.xml` / `rss.xml`, `sitemap.xml`, `robots.txt`, `404.html`
- `search-index.json` for client-side search

Current output: ~106 files, ~3 MB.

The site `url`, title, contact, and social links live in the `SITE` object at the top of `build.mjs`. **This `url` is hard-coded into canonical tags, the sitemap, and the RSS feed** — change it there if the domain changes.

---

## Architecture: static site vs. dynamic feed

The site splits cleanly in two so that high-frequency incident updates never trigger a rebuild:

- **Static (Cloudflare Pages):** all articles, profiles, orgs, regions, the map UI, JS/CSS, network graph, district coords, plus the admin panel (`/admin`) and the maintenance gate (`_worker.js`). Rebuilt + deployed **only when content changes**.
- **Dynamic (Cloudflare Worker + bindings):** D1 stores articles/profiles/pages and the audit log; KV stores the live incident feed and maintenance state; R2 stores uploads and generated charts. The Worker serves the APIs, validates writes, and creates monthly report drafts. **No commits, builds, or deploys are required for incident updates.**

The admin panel writes incidents straight to KV. Draft editorial content is saved privately in D1. Publishing content updates D1 and asks GitHub Actions to rebuild; the build fetches published D1 rows and deploys the generated site to Cloudflare Pages. Maintenance mode is a KV flag the Pages `_worker.js` checks on every request.

See [`worker/`](worker) and the full provisioning runbook in [`CLOUDFLARE_SETUP.md`](CLOUDFLARE_SETUP.md).

### Worker (`worker/src/`)

| File | Role |
|---|---|
| `index.js` | `fetch()` API (incidents, content, analytics, deployment status, Explorer AI, maintenance, auth) + scheduled jobs |
| `analytics.js` | Monthly aggregates, SVG chart generation, R2 chart storage, and private D1 report drafts |
| `ask.js` | Source-bound Gemini proxy with private credentials and free-tier-friendly limits |
| `x.js` | X (Twitter) account polling → incident objects (optional) |
| `feed.js` | validation, district/date helpers, KV read/write, merge/dedupe/archive logic |

Config in `worker/wrangler.toml`: KV binding `INCIDENTS`, cron, route `theglobaldecipher.com/api/*`, and non-secret model/rate-limit settings. Secrets (`wrangler secret put`): `ADMIN_TOKEN`, `GITHUB_TOKEN`, `GEMINI_API_KEY`, plus optional integrations. The Pages project also needs a `MAINTENANCE_KV` binding to the same KV namespace.

### Admin panel (`static/admin.js`, `/admin`)

Vanilla-JS SPA. Login with `ADMIN_TOKEN`. Tabs: **Incidents** (KV CRUD and monthly analytics), **Articles & Profiles** (D1 drafts/publishing with conflict protection and deployment status), and **Activity**. Header toggle for **maintenance mode**. Self-contained styles (`static/admin.css`) so it loads even while the site is gated.

### GitHub Actions (`.github/workflows/`)

| Workflow | Trigger | What it does | Secrets |
|---|---|---|---|
| **deploy.yml** | push to `main`, manual | Build the site and deploy to Cloudflare Pages (direct upload via wrangler). | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| **incident-update.yml** | issue with `incident-update` label | Issue form → parse incident → **POST to the Worker** (KV), no commit. Write-gated. | `WORKER_INGEST_URL`, `TGD_ADMIN_TOKEN` |

The repo is **public**, so Actions minutes are free and unmetered. The deploy uses Cloudflare **direct upload**, which doesn't count against Pages' 500-build/month free limit.

---

## Publishing

Primary path is the **admin panel** at `/admin` (log in with `ADMIN_TOKEN`):

- **Incident:** Incidents tab → add/edit/delete. Live map updates in ~1 min, no deploy.
- **Article / profile / page:** Articles & Profiles tab → add/edit/save in D1 → publish → GitHub Actions rebuilds from D1 in ~1 min.
- **Monthly report:** Incidents → Monthly reports → review totals → generate a private D1 draft and R2 charts → edit → publish.
- **Maintenance:** header toggle takes the public site offline behind a maintenance screen.

The optional GitHub *Incident update* issue form and X auto-import remain available. Direct GitHub article publishing was removed because D1 is now the editorial source of truth.

---

## Build locally (optional)

Only needed for testing code or design changes. Editorial content should be managed through TGD Admin.

```bash
node build.mjs
python3 -m http.server 4173 --directory site
# open http://localhost:4173
```

---

## Hosting / deployment

Served by **Cloudflare Pages** on `theglobaldecipher.com`, with the incident feed on a **Cloudflare Worker + KV**. Full one-time provisioning steps (Pages project, KV namespace, secrets, domain, seeding) are in **[`CLOUDFLARE_SETUP.md`](CLOUDFLARE_SETUP.md)**.

`GITHUB_PAGES_SETUP.md` describes the previous GitHub Pages hosting and is kept for reference only.

---

## Editorial posture

- Public-source first. Claim vs. confirmation discipline.
- No propaganda reproduction, no graphic media, no tactical detail.
- Open corrections policy.
- See `/methodology/` and `/corrections-policy/` on the live site.
