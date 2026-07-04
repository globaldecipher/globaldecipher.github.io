# TGD X-to-Map Agent — owner review guide

Status: **deployed to Cloudflare on 4 July 2026 and intentionally paused**.

The D1 migration is applied, the Worker and one-minute schedule are live, and
the token-encryption secret is installed. The agent cannot read X until the X
client credentials are installed, `@Global_Decipher` completes OAuth, and the
owner explicitly resumes it.

This replaces the unused Apify prototype with the official X API.

## The simple flow

```text
TGD posts on X
→ Cloudflare checks once per minute
→ only new @Global_Decipher posts are returned
→ Gemini classifies and extracts facts
→ deterministic Pakistan location check
→ safe incidents go into D1 and the map
→ unclear cases stay in the private Review Queue
```

The agent never writes to X. Empty checks do not call Gemini and do not move or
reload old posts.

## 1. Official X connection and one-minute checking

### What was built

- OAuth 2.0 Authorization Code + PKCE.
- Required scopes only: `tweet.read users.read offline.access`.
- Mandatory `/2/users/me` check for `@Global_Decipher`.
- Encrypted access and refresh tokens in D1.
- One-minute Cron Trigger.
- Timeline reads use only:
  `GET /2/users/{X_USER_ID}/tweets?since_id=...`
- Replies are retained; retweets are excluded.
- Every X ID stays a string.
- The cursor moves only after returned posts are safely stored.

### Why it is needed

This qualifies the timeline request for X Owned Read pricing when the developer
app and the authenticated account are both owned by TGD. It also prevents the
agent from accidentally reading another account or repeatedly buying the same
timeline history.

### How to test

After local migration and local secrets:

1. Open `/admin/`.
2. Open **Agent Control**.
3. Click **Connect @Global_Decipher**.
4. Authorize only while signed in as `@Global_Decipher`.
5. Confirm the control centre shows the username and numeric user ID.
6. Click **Run one safe check now**.

The first connection seeds the cursor from at most five latest posts. Those
posts are not imported into the map.

### What changed

- `src/x-to-map-agent.js`
- `src/index.js`
- `wrangler.toml`
- `migrations/0003_x_to_map_agent.sql`

### What could go wrong

- Wrong X account: connection is rejected and its token is deleted.
- X failure/rate limit: cursor does not move; the next minute retries.
- Expired access token: the encrypted refresh token obtains a new one.
- Missing/incorrect encryption key: tokens cannot be read and the agent stays
  stopped with a clear error.

## 2. TGD-specific Gemini instructions and safety gates

### What was built

The permanent instructions use representative TGD patterns observed on the
public account:

- a clear BREAKING/NEWS ALERT incident;
- an ongoing initial report;
- a quote-post casualty/attribution update;
- a later motive correction that may disqualify a terrorism incident;
- a monthly assessment that must never create map markers.

The agent does **not** perform a 100-post Gemini analysis.

Automatic publication requires all of the following:

- class is `SINGLE_INCIDENT`, `INCIDENT_THREAD`, or `DAILY_ROUNDUP`;
- classification and extraction confidence are both high;
- country is Pakistan;
- location matches the vetted district gazetteer;
- date, type, and summary are usable;
- Gemini did not request review;
- no serious duplicate warning;
- the post is not an update or correction.

Missing casualty figures remain `null`. They become zero only when TGD
explicitly says no casualties were reported.

### How to test

Run:

```bash
cd "/Users/aamirhayat/Documents/New project/TGD CHANNEL/worker"
npm test
```

The tests cover valid incidents, daily roundups, unfinished threads, reports,
infographics, corrections, duplicates, missing/non-Pakistan/ambiguous
locations, encrypted tokens, CSV, XLSX, and charts.

### What could go wrong

- Gemini failure/invalid JSON: the raw X post remains in D1 as `pending_retry`.
- Place not in the vetted gazetteer: the post stays in Review Queue.
- Material correction: the existing public record is not silently changed.

## 3. D1 database and existing map

### What was built

D1 is authoritative for:

- sync state and the `agent_run_lock` execution lock;
- encrypted X tokens;
- raw X posts and full thread membership;
- incidents and many-to-many incident sources;
- review status and duplicates;
- rules, categories, and approved correction examples;
- metrics, logs, and monthly export history.

The existing `INCIDENTS` KV binding remains only as a compatibility copy for the
current map. Published D1 incidents are merged into it; private/rejected records
never enter the public feed.

The map refresh interval is now 60 seconds.

### Database migration

```text
migrations/0003_x_to_map_agent.sql
```

It is additive. It does not delete or alter existing content tables.

For an isolated brand-new local database, load `schema.sql` first and then
execute `migrations/0003_x_to_map_agent.sql` directly. The base schema already
contains the changes represented by migrations 0001 and 0002. Existing managed
databases should continue to use `wrangler d1 migrations apply`.

### What could go wrong

- Migration not applied: Agent Control shows that its database is not ready.
- Worker runs twice: the D1 lock stores a unique owner ID and `locked_until`
  timestamp; only the owner can renew or release it. A failed run becomes
  eligible for automatic takeover after five minutes. Unique X post IDs and
  incident-source keys also stop duplicate processing.
- Likely same incident: the candidate becomes `possible_duplicate` and stays
  private.

## 4. One unified private admin page

The existing `/admin/` page now contains:

- **Agent Control** — status, pause/resume, X connection, cost, errors, exports,
  and logs.
- **Review Queue** — raw X text, Gemini decision, every editable field,
  publish/reject/duplicate/merge/retry, and correction notes.
- **Learning & Rules** — owner-controlled rules, approved correction examples,
  and categories.
- Existing Incidents, Content, and Activity remain available.

The agent never changes its own rules. Only an owner action through the
protected admin API can change them.

## 5. Monthly data package

On the first day of each month (Asia/Karachi), the agent creates the previous
month's package from `status = published` incidents only:

- UTF-8 CSV;
- a real six-sheet XLSX workbook;
- six accessible SVG charts when `MONTHLY_CHARTS_ENABLED` is enabled;
- versioned files under `agent-exports/YYYY-MM/vN/` in the existing `MEDIA` R2
  bucket.

Regeneration creates a new version and does not overwrite an older package.
No AI-written monthly narrative is generated.

A 300-row package was tested successfully on Cloudflare's remote Free runtime
with all six charts, and again in XLSX/CSV-only mode. Charts therefore remain
enabled. If Cloudflare limits change, setting `MONTHLY_CHARTS_ENABLED = "false"`
keeps the monthly XLSX and CSV while skipping chart generation.

## Required Cloudflare resources

Existing bindings used:

| Binding | Resource | Purpose |
|---|---|---|
| `CONTENT_DB` | D1 `tgd-content` | Agent state, posts, incidents, rules, logs |
| `INCIDENTS` | KV namespace | Existing map-feed compatibility |
| `MEDIA` | R2 `tgd-media` | Versioned CSV/XLSX/SVG packages |

No new paid Cloudflare service is required.

## Required Cloudflare secrets

Already required by the site:

- `ADMIN_TOKEN`
- `GEMINI_API_KEY`

Installed for the agent:

- `X_TOKEN_ENCRYPTION_KEY`

Still required before connecting X:

- `X_CLIENT_ID`
- `X_CLIENT_SECRET`

## X Developer App settings

- App owner: the same `@Global_Decipher` account.
- App type: confidential web application.
- Callback URL:
  `https://theglobaldecipher.com/api/agent/x/callback`
- Scopes:
  `tweet.read users.read offline.access`
- Do not add `tweet.write`.

## Deployment record

On 4 July 2026, the remote D1 database was backed up, migration
`0003_x_to_map_agent.sql` was applied, and Worker version
`093cf5ba-b392-45b6-8a93-07576485ee59` was deployed. The agent was verified as
paused and the execution lock as released.

Before resuming:

1. Open `/admin/`.
2. Install `X_CLIENT_ID` and `X_CLIENT_SECRET`.
3. Connect and authorize `@Global_Decipher`.
4. Confirm the numeric account ID and leave the agent paused.
5. Publish one controlled TGD incident post.
6. Run one safe check manually.
7. Inspect D1, Review Queue, and the public map.
8. Click **Resume agent** only after that check.

## Estimated monthly cost

Current official X Owned Read rate: **$0.001 per returned TGD post**.

- 200 posts returned: about **$0.20**
- 300 posts returned: about **$0.30**
- 500 posts returned: about **$0.50**
- Empty one-minute responses: **$0 in returned-resource charges**

The control centre warns at 350 and alerts at 500 returned posts. A $5 X credit
balance should cover roughly 5,000 owned-post resources at the current rate,
excluding other X endpoints and future pricing changes.

Expected Cloudflare D1/R2/KV/Worker traffic is far below current free
allowances at TGD volume. Gemini cost depends on the key's current plan, but
Gemini is called only when new TGD posts need analysis.

## Pause and rollback

Normal pause:

- `/admin/` → **Agent Control** → **Pause agent**.

Emergency database pause:

```bash
npx wrangler d1 execute tgd-content --remote \
  --command "UPDATE sync_state SET value='false' WHERE key='agent_enabled'"
```

Code rollback:

```bash
npx wrangler versions list
npx wrangler rollback
```

The migration is intentionally not rolled back because it is additive and may
contain preserved raw posts/review evidence. Pause the agent and roll back the
Worker version; do not drop agent tables unless an owner has separately backed
up and approved deletion.
