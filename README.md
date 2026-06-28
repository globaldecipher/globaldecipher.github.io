# The Global Decipher

Independent, research-first coverage of terrorism, militant networks, and security risk — focused on Pakistan, with regional and global context.

**Live site:** https://theglobaldecipher.com

The Global Decipher (TGD) is an OSINT publication. It puts out news briefs, opinion, monitoring updates, monthly reports, and threat-actor / organisation profiles, plus two interactive tools: a **Pakistan incident map** and a **militant network graph**. Editors and interns manage everything — incidents, articles, profiles — from a web **admin panel** at `/admin` (one shared password), which also has a **maintenance-mode** switch that takes the public site offline. An optional cron can still auto-import incidents from X.

---

## Tech stack

| Layer | Choice |
|---|---|
| Site generator | Custom static-site builder in a single file, [`build.mjs`](build.mjs) (~2,000 lines). **Zero npm dependencies** — pure Node.js stdlib (`node:fs`, `node:path`). Hand-rolled Markdown parser, HTML templating (template literals), RSS/Atom feed, sitemap, robots.txt, and JSON search index. |
| Content | Markdown + front-matter files under [`content/`](content) (`news`, `opinion`, `monitoring`, `reports`, `profiles`, `pages`). |
| Frontend | Vanilla JS for the publication shell and incident map; React/Vite, D3, and MapLibre for the research Explorer under [`apps/explorer/`](apps/explorer). |
| Data | JSON under [`static/data/`](static/data) — `incidents.json`, `network-*.json`. |
| Build runtime | Node.js 22. |
| Hosting | Cloudflare Pages (static site) on `theglobaldecipher.com`. |
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
  admin.js / admin.css ← the /admin panel SPA (self-contained)
  data/           ← network graphs, district coords; incidents.json (seed only)
build.mjs         ← static-site builder (also emits /admin, maintenance.html, _worker.js)
worker/           ← Cloudflare Worker: incident feed + admin API + maintenance flag
  src/            ← index.js (entry), ask.js, feed.js, content.js, media.js
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

- **Static (Cloudflare Pages):** all articles, profiles, orgs, regions, the map UI, JS/CSS, network graph, district coords, plus the admin panel (`/admin`) and the maintenance gate (`_worker.js`). Rebuilt + deployed **only when content changes**.
- **Dynamic (Cloudflare Worker + KV):** the live incident feed + the admin API. The Worker serves `GET /api/incidents` (the map reads this), handles authed writes from the admin panel, commits article/profile edits to GitHub, and stores the maintenance flag. An optional cron imports from X and prunes the archive window. **No commits, no builds, no deploys for incident updates.**

The admin panel writes incidents straight to KV (instant) and writes articles/profiles as Markdown files via the GitHub API (commit → rebuild). Maintenance mode is a KV flag the Pages `_worker.js` checks on every request.

See [`worker/`](worker) and the full provisioning runbook in [`CLOUDFLARE_SETUP.md`](CLOUDFLARE_SETUP.md).

### Worker (`worker/src/`)

| File | Role |
|---|---|
| `index.js` | `fetch()` API (incidents CRUD, content CRUD, Explorer AI, maintenance toggle, auth) + `scheduled()` cron (X import + prune) |
| `ask.js` | Source-bound Gemini proxy with private credentials and free-tier-friendly limits |
| `x.js` | X (Twitter) account polling → incident objects (optional) |
| `github.js` | GitHub Contents API wrapper — list/read/write/delete Markdown under `content/` |
| `feed.js` | district lookup, date/archive helpers, KV read/write, merge/dedupe/prune |

Config in `worker/wrangler.toml`: KV binding `INCIDENTS`, cron, route `theglobaldecipher.com/api/*`, and non-secret model/rate-limit settings. Secrets (`wrangler secret put`): `ADMIN_TOKEN`, `GITHUB_TOKEN`, `GEMINI_API_KEY`, plus optional integrations. The Pages project also needs a `MAINTENANCE_KV` binding to the same KV namespace.

### Admin panel (`static/admin.js`, `/admin`)

Vanilla-JS SPA. Login with `ADMIN_TOKEN`. Tabs: **Incidents** (KV CRUD, instant) and **Articles & Profiles** (Markdown CRUD via GitHub, ~1-min rebuild). Header toggle for **maintenance mode**. Self-contained styles (`static/admin.css`) so it loads even while the site is gated.

### GitHub Actions (`.github/workflows/`)

| Workflow | Trigger | What it does | Secrets |
|---|---|---|---|
| **deploy.yml** | push to `main`, manual | Build the site and deploy to Cloudflare Pages (direct upload via wrangler). | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| **content-upload.yml** | issue with `content-upload` label | Issue form → Markdown article in `content/` → commit → deploy. Write-gated. | `CLOUDFLARE_*` |
| **incident-update.yml** | issue with `incident-update` label | Issue form → parse incident → **POST to the Worker** (KV), no commit. Write-gated. | `WORKER_INGEST_URL`, `TGD_ADMIN_TOKEN` |

The repo is **public**, so Actions minutes are free and unmetered. The deploy uses Cloudflare **direct upload**, which doesn't count against Pages' 500-build/month free limit.

---

## Publishing

Primary path is the **admin panel** at `/admin` (log in with `ADMIN_TOKEN`):

- **Incident:** Incidents tab → add/edit/delete. Live map updates in ~1 min, no deploy.
- **Article / profile / page:** Articles & Profiles tab → pick folder → add/edit/delete. Commits to GitHub → site rebuilds in ~1 min.
- **Maintenance:** header toggle takes the public site offline behind a maintenance screen.

Still available as fallbacks: editing Markdown in `content/` directly, the GitHub *Content upload* / *Incident update* issue forms (see [`HOW_TO_PUBLISH.md`](HOW_TO_PUBLISH.md)), and optional X auto-import via the Worker cron.

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

Served by **Cloudflare Pages** on `theglobaldecipher.com`, with the incident feed on a **Cloudflare Worker + KV**. Full one-time provisioning steps (Pages project, KV namespace, secrets, domain, seeding) are in **[`CLOUDFLARE_SETUP.md`](CLOUDFLARE_SETUP.md)**.

`GITHUB_PAGES_SETUP.md` describes the previous GitHub Pages hosting and is kept for reference only.

---

## Editorial posture

- Public-source first. Claim vs. confirmation discipline.
- No propaganda reproduction, no graphic media, no tactical detail.
- Open corrections policy.
- See `/methodology/` and `/corrections-policy/` on the live site.
