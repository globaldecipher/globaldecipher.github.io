# Cloudflare setup — runbook

One-time setup to run The Global Decipher on Cloudflare. Run every command on
**your own machine, logged into your own Cloudflare account.**

What you get:
- **Site** on Cloudflare Pages at `theglobaldecipher.com`.
- **Admin panel** at `theglobaldecipher.com/admin` — manage incidents, D1 editorial content, R2 media, monthly report drafts, and deployment status.
- **Maintenance mode** — a toggle in the admin panel that takes the whole public site offline behind a maintenance screen.
- **Incident feed** in Cloudflare KV, served by a Worker. Incidents update with no rebuild; articles/profiles trigger a ~1-minute rebuild.

```
                  ┌──────────────── Cloudflare (free) ─────────────────┐
 Admin panel ───► │  Worker /api/* ─┬─► KV (incidents, maintenance)       │
 (/admin)         │                  ├─► D1 (content, drafts, audit)         │
                  │                  └─► R2 (media, generated charts)        │
                  │       publish ─► GitHub workflow ─► build from D1       │
 Browser  ──────► │  Pages (_worker.js gate) ─► static site OR maint page │
   map widget ──► │  GET /api/incidents ──► Worker ──► KV                  │
                  └───────────────────────────────────────────────────────┘
```

## 0. Prerequisites
- `theglobaldecipher.com` is already in this Cloudflare account (bought from Cloudflare). ✅
- Node 18+, repo cloned, latest `main` pulled.
- `npx wrangler login` (opens browser → log into the right account).
- `npx wrangler whoami` → note the **Account ID**.

---

## 1. Site → Cloudflare Pages
```bash
# repo root
node build.mjs
npx wrangler pages project create theglobaldecipher --production-branch=main
npx wrangler pages deploy site --project-name=theglobaldecipher --branch=main
```
- **[Cloudflare site]** Workers & Pages → `theglobaldecipher` → Custom domains → add `theglobaldecipher.com` (+ `www` redirect if wanted).
- **[Cloudflare site]** My Profile → API Tokens → create token with **Cloudflare Pages: Edit**.
- **[GitHub site]** repo → Settings → Secrets and variables → Actions:
  - `CLOUDFLARE_API_TOKEN` = the token above
  - `CLOUDFLARE_ACCOUNT_ID` = from `wrangler whoami`

> Until these two secrets exist, the deploy Action fails. Set them now.

---

## 2. Worker + KV (incidents, admin API, maintenance flag)
```bash
cd worker
npx wrangler kv namespace create INCIDENTS      # paste the printed id into wrangler.toml
# seed KV with the existing incidents:
npx wrangler kv key put --binding=INCIDENTS feed --path=../static/data/incidents.json
```

**GitHub token** (lets the Worker dispatch and inspect website deployments). On GitHub: Settings →
Developer settings → **Fine-grained tokens** → new token, repository =
`globaldecipher/globaldecipher.github.io`, permissions:

- **Actions: Read and write** — dispatch `deploy.yml` and show deployment status.
- **Contents: Read** — sufficient for the current D1 publishing architecture.

**Set the Worker secrets:**
```bash
# still in worker/
npx wrangler secret put ADMIN_TOKEN     # invent a long random string = the admin-panel password
npx wrangler secret put GITHUB_TOKEN    # the fine-grained token above
npx wrangler secret put X_BEARER_TOKEN  # OPTIONAL — only if you want X auto-import; skip otherwise
npx wrangler deploy
```
`X_USERNAME`, `GITHUB_REPO`, `GITHUB_BRANCH` are already set in `wrangler.toml`.

**Explorer Gemini assistant (free tier):**
1. Create a new Gemini API key in Google AI Studio. Do not reuse a key that has
   appeared in browser code or Git history.
2. Keep the AI Studio project on the free tier while usage is small.
3. Store the key only in the Worker:
```bash
npx wrangler secret put GEMINI_API_KEY
```
The Worker defaults to `gemini-3.1-flash-lite` with low thinking, sends the
selected public TGD profile plus its direct relationships, and caps visitors at
8 questions per hour plus a site-wide daily ceiling. Each model call is limited
to 12 seconds and the primary-plus-fallback path is limited to 15 seconds.
Change those non-secret limits in `worker/wrangler.toml`.

**Monitoring Desk paywall (Safepay):**
1. In Safepay, create a monthly subscription plan named **TGD Monitoring Desk** at **$20/month**.
2. Copy the Plan ID into `worker/wrangler.toml` as `SAFEPAY_PLAN_ID`.
3. Set Worker secrets:
```bash
npx wrangler secret put SAFEPAY_SECRET_KEY
npx wrangler secret put SAFEPAY_WEBHOOK_SECRET
npx wrangler secret put CONTENT_DUMP_TOKEN
```
4. Add the same `CONTENT_DUMP_TOKEN` value to GitHub Actions secrets as `CONTENT_DUMP_TOKEN`.
5. In Safepay Developer > Endpoints, add:
   - URL: `https://theglobaldecipher.com/api/safepay/webhook`
   - Shared secret: same value used for `SAFEPAY_WEBHOOK_SECRET`
   - Events: all subscription events.

The paywall applies only to `/monitoring/` and `/monitoring/*`. The incident map,
network graph, reports, profiles, news, opinion, contact, and homepage remain public.

**Route the API under the domain** — uncomment `[[routes]]` in `worker/wrangler.toml`:
```toml
[[routes]]
pattern = "theglobaldecipher.com/api/*"
zone_name = "theglobaldecipher.com"
```
then `npx wrangler deploy` again.

---

## 3. Maintenance mode (bind KV to Pages)
The Pages site's `_worker.js` reads the maintenance flag from KV. Bind the same KV
namespace to the Pages project:

**[Cloudflare site]** Workers & Pages → `theglobaldecipher` → Settings → **Functions →
KV namespace bindings** → Add:
- Variable name: `MAINTENANCE_KV`
- KV namespace: `INCIDENTS` (the one created in step 2)

The Monitoring paywall also reads paid sessions from this KV namespace. You can
optionally add a second binding named `PAYWALL_KV` to the same namespace, but
`MAINTENANCE_KV` is enough.

Redeploy Pages once so the binding takes effect:
```bash
# repo root
npx wrangler pages deploy site --project-name=theglobaldecipher --branch=main
```
> Until this binding exists, the gate fails open (site always live) — maintenance
> just can't be turned on. After binding, toggling takes up to ~60s to propagate.

---

## 4. Admin panel
- Go to `https://theglobaldecipher.com/admin`.
- Log in with the `ADMIN_TOKEN` string from step 2 (this is the shared password — give it to internees).
- **Incidents** tab: add/edit/delete — updates the live map within ~1 min, no rebuild.
- **Articles & Profiles** tab: create and autosave private D1 drafts; publishing triggers the GitHub deployment workflow and the site rebuilds from D1 in ~1 min.
- **Monthly reports**: Incidents → Monthly reports calculates comparisons and creates a private D1 draft with three R2 charts. The scheduled Worker attempts the previous month automatically on the first day of each month.
- **Website deployment** panel: shows whether the latest GitHub/Cloudflare build is running, live, or failed.
- **Maintenance mode** toggle (top right): ON locks the public site behind the maintenance screen; `/admin` stays reachable so you can turn it back off.
- **Monitoring Desk** is paid at `/monitoring/`; subscribers enter through Safepay checkout and return to the desk after confirmation.

---

## 5. (Optional) remove the old Telegram Worker
The lost-token Telegram bot is no longer used. Delete its old Worker in
Workers & Pages so it isn't running for nothing.

---

## Verify
```bash
curl https://theglobaldecipher.com/api/incidents | head -c 200       # feed
curl https://theglobaldecipher.com/api/maintenance                   # {"on":false}
curl -I https://theglobaldecipher.com/monitoring/                    # should show the Monitoring access page until subscribed
# POST /api/ask from the Explorer after GEMINI_API_KEY is configured
# open /admin, log in, add a test incident, toggle maintenance on/off
cd worker && npx wrangler tail                                        # live worker logs
```

## Ongoing operations
| Task | How |
|---|---|
| Add/edit/delete an incident | Admin panel → Incidents (instant) |
| Add/edit/delete an article or profile | Admin panel → Articles & Profiles (D1; rebuild only for public changes) |
| Generate monthly charts/report draft | Admin panel → Incidents → Monthly reports |
| Change Monitoring subscription price | Safepay subscription plan, then update `SAFEPAY_PLAN_ID` if you create a new plan |
| Take the site offline | Admin panel → Maintenance mode toggle |
| Change Worker code | edit `worker/src/*` → `npx wrangler deploy` |
| Rotate the admin password | `wrangler secret put ADMIN_TOKEN` (also update `TGD_ADMIN_TOKEN` if you still use the issue form) |
| Re-seed the feed | `wrangler kv key put --binding=INCIDENTS feed --path=<json>` |

## Notes
- The admin password is sent from the browser to the Worker over HTTPS. Anyone with it can edit content — treat it like a real password. Upgrade path: Clerk (works on Workers/Pages) for per-user login later.
- `GITHUB_TOKEN` never reaches the browser; only the Worker uses it.
- Weekly CSV bulk import was not ported — `POST` rows to `/api/incidents` (Bearer `ADMIN_TOKEN`) or re-seed KV if you need it.

## Individual editor accounts

Do not place `/admin` behind Cloudflare Access until the owner's and interns'
approved email addresses (or an approved organisation email domain) are known.
Enabling a restrictive policy without that list can lock the owner out.

Once the identities are confirmed:

1. Create a Cloudflare Access self-hosted application for
   `theglobaldecipher.com/admin*`.
2. Add an Allow policy containing only the approved emails or domain.
3. Keep the existing Admin key temporarily as a second factor during rollout.
4. Verify owner login before removing or rotating the shared key.
