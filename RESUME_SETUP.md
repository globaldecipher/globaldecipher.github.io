# Resume Cloudflare setup — for Claude Code on the cousin's machine

You (Claude Code) are continuing a half-finished Cloudflare deployment. Do the
terminal steps yourself; **pause** at the one dashboard step and ask the human to
do it. Full background is in `CLOUDFLARE_SETUP.md`; this file is just the
remaining checklist with a checkpoint.

## Architecture (1-paragraph context)
The Global Decipher = static site on **Cloudflare Pages** (`theglobaldecipher.com`)
+ a **Cloudflare Worker** (`worker/`, name `tgd-incidents`) that serves the live
incident feed from **KV** and powers a web **admin panel** at `/admin`. Admin auth
is one shared password = the Worker secret `ADMIN_TOKEN`. Maintenance mode is a KV
flag the Pages `_worker.js` reads. Telegram was removed.

## ✅ Already done (do NOT redo)
- `wrangler login` (cousin's Cloudflare account)
- Pages project `theglobaldecipher` created + first deploy
- Custom domain `theglobaldecipher.com` attached to the Pages project
- GitHub repo secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` set
- KV namespace `INCIDENTS` created + seeded (`feed` key)
- Worker secrets `ADMIN_TOKEN` and `GITHUB_TOKEN` set

## ⬜ Remaining

### 0. [Claude · terminal] Sync the repo
```bash
git pull origin main
```

### 1. [Claude · terminal] Confirm the KV id is wired
```bash
grep -n 'id =' worker/wrangler.toml
```
If it still shows `REPLACE_WITH_KV_NAMESPACE_ID`, STOP and tell the human to run
`cd worker && npx wrangler kv namespace create INCIDENTS` and paste the printed id
into `worker/wrangler.toml`. Otherwise continue.

### 2. [Claude · terminal] Deploy the Worker
```bash
cd worker
npx wrangler deploy
```
Note the deployed URL in the output.

### 3. [Claude · edit + terminal] Enable the /api route on the domain
Uncomment the `[[routes]]` block at the bottom of `worker/wrangler.toml` so it reads:
```toml
[[routes]]
pattern = "theglobaldecipher.com/api/*"
zone_name = "theglobaldecipher.com"
```
Then redeploy:
```bash
npx wrangler deploy
```

### 4. [HUMAN · Cloudflare dashboard] Bind KV to the Pages project
This cannot be done from the CLI for a direct-upload Pages project. Ask the human to:
> Cloudflare dashboard → Workers & Pages → **theglobaldecipher** → Settings →
> **Functions → KV namespace bindings** → Add binding:
> - Variable name: `MAINTENANCE_KV`
> - KV namespace: `INCIDENTS`
> Save.

Wait for the human to confirm before continuing. (Until this exists, maintenance
mode just can't turn on; the site still works.)

### 5. [Claude · terminal] Rebuild + redeploy Pages
So the binding takes effect and the latest build ships:
```bash
cd ..          # repo root
node build.mjs
npx wrangler pages deploy site --project-name=theglobaldecipher --branch=main
```

### 6. [Claude · terminal] Verify, then hand back to the human
```bash
curl -s https://theglobaldecipher.com/api/incidents | head -c 200   # JSON feed
curl -s https://theglobaldecipher.com/api/maintenance               # {"on":false}
```
Then tell the human:
> Open `https://theglobaldecipher.com/admin`, log in with the `ADMIN_TOKEN`
> password, add a test incident (should appear on the map within ~1 min), edit an
> article, and flip the maintenance toggle on/off to confirm the gate works.

## Optional (only if asked)
- Set `X_BEARER_TOKEN` Worker secret to re-enable X auto-import: `cd worker && npx wrangler secret put X_BEARER_TOKEN && npx wrangler deploy`.
- Delete the old (lost-token) Telegram Worker in the dashboard so it isn't lingering.
- The GitHub issue-form workflows (`content-upload.yml`, `incident-update.yml`) are now redundant with the admin panel. To keep the incident issue form working you'd set repo secrets `WORKER_INGEST_URL` (`https://theglobaldecipher.com/api/incidents`) and `TGD_ADMIN_TOKEN` (= `ADMIN_TOKEN`); otherwise they can be deleted.

## Done when
- `theglobaldecipher.com` serves the site, `/admin` logs in and can CRUD, the map
  loads from `/api/incidents`, and the maintenance toggle takes the public site
  on/off. The `Deploy site to Cloudflare Pages` GitHub Action should be green.
