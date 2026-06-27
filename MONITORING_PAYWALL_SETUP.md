# Monitoring Desk paywall setup

This paywall is only for `/monitoring/` and `/monitoring/*`.
Everything else on the site stays public.

## What you do in Safepay

1. Create or log in to your Safepay merchant account.
2. Finish the business/payout setup there.
   - Enter bank, tax, identity, and payout details only on Safepay's secure pages.
   - Do not paste bank details into Codex or the repo.
3. Create a subscription product:
   - Name: `TGD Monitoring Desk`
   - Price: `$20`
   - Billing: monthly
4. Copy the non-secret Plan ID.
5. Open Developer and copy the private Safepay secret key.
6. In Developer > Endpoints, add this webhook URL:
   - `https://theglobaldecipher.com/api/safepay/webhook`
7. Copy the endpoint shared secret and enable these events:
   - subscription created
   - subscription payment succeeded
   - subscription payment failed
   - subscription canceled
   - subscription ended
   - subscription paused
   - subscription resumed

## What the setup script does

Run:

```bash
npm run setup:paywall
```

It will ask for:

- Safepay Plan ID
- Safepay environment (`sandbox` while testing)
- Safepay secret key
- Safepay endpoint shared secret
- a private `CONTENT_DUMP_TOKEN` value, or press Enter to generate one

The script:

- writes the non-secret Safepay settings into `worker/wrangler.toml`
- saves private values as Cloudflare Worker secrets
- optionally saves `CONTENT_DUMP_TOKEN` as a GitHub Actions secret
- can deploy the Worker for you

## Final publish step

After setup, commit and push the code changes so the Cloudflare Pages site rebuilds.

Then verify:

- `/monitoring/` shows the paid access page when logged out
- `/incident-map/` opens normally
- `/network-graph/` opens normally
- Safepay returns to `/api/monitoring/return?...`
- after confirmation, `/monitoring/` opens for the subscriber
