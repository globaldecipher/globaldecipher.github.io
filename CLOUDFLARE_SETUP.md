# Cloudflare setup — runbook

One-time setup to move The Global Decipher off GitHub Pages and onto Cloudflare.
Run every command on **your own machine, logged into your own Cloudflare account**.

After this:
- The **site** is served by Cloudflare Pages on `theglobaldecipher.com`.
- The **incident feed** is polled by a Cloudflare Worker (cron) and stored in KV — no more git commits or site rebuilds for incident updates.
- Publishing an **article** still rebuilds + deploys the site (a few times a week, well within free limits).

```
                 ┌─────────────── Cloudflare (free) ───────────────┐
 Telegram / X ──►│  Worker (cron every 5 min) ──► KV "feed"         │
                 │                                   ▲               │
 Browser ───────►│  theglobaldecipher.com (Pages, static)              │
   map widget ──►│  GET /api/incidents ──► Worker ──┘  (KV blob)     │
                 └──────────────────────────────────────────────────┘
 GitHub Actions: build + `wrangler pages deploy` on content change only.
```

## 0. Prerequisites

- The `theglobaldecipher.com` zone is already in this Cloudflare account. ✅ (you bought it)
- Node 18+ and the repo cloned. Pull the latest `main` first.
- Authenticate wrangler once: `npx wrangler login`.
- Find your **Account ID**: `npx wrangler whoami` (or Cloudflare dashboard → right sidebar).

---

## 1. Site → Cloudflare Pages

```bash
# from the repo root
node build.mjs                       # produces ./site

# create the Pages project (direct-upload type), production branch = main
npx wrangler pages project create theglobaldecipher --production-branch=main

# first manual deploy
npx wrangler pages deploy site --project-name=theglobaldecipher --branch=main
```

This prints a `*.pages.dev` URL — open it, confirm the site looks right (the map
will say "Feed unavailable" until the Worker is up in step 2; that's expected).

**Attach the domain** (Cloudflare dashboard → Workers & Pages → theglobaldecipher
→ Custom domains): add `theglobaldecipher.com`, and add `www.theglobaldecipher.com` as a
redirect to the apex if you want www to work.

**Create the GitHub secrets** so Actions can deploy on future content changes
(repo → Settings → Secrets and variables → Actions → New repository secret):

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API token with **Cloudflare Pages: Edit** (My Profile → API Tokens → Create Token) |
| `CLOUDFLARE_ACCOUNT_ID` | from `wrangler whoami` |

> ⚠️ Until these two secrets exist, the **Deploy site to Cloudflare Pages** Action
> (and the article-publish Action) will fail. Set them right after step 1.

---

## 2. Incident feed → Worker + KV

```bash
cd worker
npm install                          # installs wrangler locally (optional; npx works too)

# create the KV namespace
npx wrangler kv namespace create INCIDENTS
```

Copy the printed `id` into `worker/wrangler.toml`, replacing
`REPLACE_WITH_KV_NAMESPACE_ID`.

**Seed KV** with the existing incidents (so the map isn't empty on day one):

```bash
# from repo root — loads the committed feed into KV
npx wrangler kv key put --binding=INCIDENTS feed --path=../static/data/incidents.json
# (run from the worker/ dir, hence ../). Or use an absolute path to static/data/incidents.json
```

**Set the Worker secrets:**

```bash
# still in worker/
npx wrangler secret put TELEGRAM_BOT_TOKEN      # same bot token used before
npx wrangler secret put X_BEARER_TOKEN          # X/Twitter API v2 bearer (optional)
npx wrangler secret put ADMIN_TOKEN             # invent a long random string; used by the issue-form workflow
```

`TELEGRAM_CHAT_ID` and `X_USERNAME` are non-secret and already in `wrangler.toml`.

**Deploy the Worker:**

```bash
npx wrangler deploy
```

**Route the feed under your domain** so the site can fetch it same-origin. In
`worker/wrangler.toml`, uncomment the `[[routes]]` block:

```toml
[[routes]]
pattern = "theglobaldecipher.com/api/*"
zone_name = "theglobaldecipher.com"
```

then `npx wrangler deploy` again. (A Workers route overrides Pages for matching
paths, so `/api/incidents` hits the Worker while everything else is Pages.)

**Verify:**

```bash
curl https://theglobaldecipher.com/api/incidents | head -c 200
npx wrangler tail        # live logs; watch a cron fire (every 5 min)
```

Reload the live site's incident map — it should load from `/api/incidents`.

> If you'd rather not use a route, the Worker also answers on its
> `*.workers.dev` URL. In that case set `window.TGD_INCIDENTS_URL` to that URL
> (the map already honours it) — but the route option is cleaner.

---

## 3. Manual incident form (optional)

The "Incident update" issue form now POSTs to the Worker instead of committing.
Add two more GitHub secrets:

| Secret | Value |
|---|---|
| `WORKER_INGEST_URL` | `https://theglobaldecipher.com/api/incidents` |
| `TGD_ADMIN_TOKEN` | the same string you set as the Worker's `ADMIN_TOKEN` |

The "Content upload" (article) form needs nothing extra — it reuses the
`CLOUDFLARE_*` secrets from step 1.

---

## 4. Cut over and clean up

1. Confirm `theglobaldecipher.com` serves from Pages and the map loads.
2. In GitHub repo Settings → Pages, set source to **None** to turn off the old
   GitHub Pages site (optional — it just goes stale otherwise).

---

## Ongoing operations

| Task | How |
|---|---|
| Publish an article | Edit/add markdown in `content/` (or use the issue form). Push → Action builds + deploys. |
| Add an incident by hand | Open an "Incident update" issue → Worker ingests it → map updates within ~1 min, no deploy. |
| Watch the poller | `cd worker && npx wrangler tail` |
| Change Worker code | Edit `worker/src/*`, then `npx wrangler deploy` |
| Re-seed / fix the feed | `wrangler kv key put --binding=INCIDENTS feed --path=<json>` |
| Rotate the admin token | `wrangler secret put ADMIN_TOKEN` + update `TGD_ADMIN_TOKEN` in GitHub |

## Not migrated (by design)

- **Weekly CSV import** (`static/data/imports/*.csv`): the old Telegram workflow
  re-imported these into the feed on every run. That step was **not** ported to
  the Worker. The incidents from the existing CSV are already in the seeded feed
  and age out naturally after the 31-day window. To bulk-load a new dataset
  later, either `POST` the rows to `/api/incidents` (Bearer `ADMIN_TOKEN`) or
  re-seed the `feed` KV key. Say the word and this can be wired as a small
  Action that parses the CSV and POSTs it.

## Free-tier headroom

- **Pages:** 500 builds/month — we only build on content changes (a handful/week). Bot-driven incident updates cause **zero** builds.
- **Workers:** 100k requests/day + cron included. ~288 cron runs/day + map reads.
- **KV:** 100k reads/day, 1k writes/day. The `/api/incidents` response is edge-cached 60s, so reads stay low. Writes happen only when there's new incident data.
