# Monitoring Desk paywall setup

This paywall is only for `/monitoring/` and `/monitoring/*`.
Everything else on the site stays public.

## What you do in Lemon Squeezy

1. Create or log in to your Lemon Squeezy account.
2. Finish the business/payout setup there.
   - Enter bank, tax, identity, and payout details only on Lemon Squeezy's secure pages.
   - Do not paste bank details into Codex or the repo.
3. Create a subscription product:
   - Name: `TGD Monitoring Desk`
   - Price: `$20`
   - Billing: monthly
4. Copy these two non-secret values:
   - Store ID
   - Variant ID for the monthly subscription
5. Create an API key.
6. Create a webhook signing secret, then add this webhook URL:
   - `https://theglobaldecipher.com/api/lemonsqueezy/webhook`
7. Enable subscription events:
   - subscription created
   - subscription updated
   - subscription cancelled
   - subscription resumed
   - subscription expired
   - payment success events

## What the setup script does

Run:

```bash
npm run setup:paywall
```

It will ask for:

- Lemon Squeezy store ID
- Lemon Squeezy variant ID
- Lemon Squeezy API key
- Lemon Squeezy webhook signing secret
- a private `CONTENT_DUMP_TOKEN` value, or press Enter to generate one

The script:

- writes the non-secret IDs into `worker/wrangler.toml`
- saves private values as Cloudflare Worker secrets
- optionally saves `CONTENT_DUMP_TOKEN` as a GitHub Actions secret
- can deploy the Worker for you

## Final publish step

After setup, commit and push the code changes so the Cloudflare Pages site rebuilds.

Then verify:

- `/monitoring/` shows the paid access page when logged out
- `/incident-map/` opens normally
- `/network-graph/` opens normally
- payment receipt button returns to `/api/monitoring/return?...`
- after confirmation, `/monitoring/` opens for the subscriber
