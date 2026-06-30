# TGD publishing quick guide

Use the TGD Admin workspace for editorial publishing:

1. Open `https://theglobaldecipher.com/admin`.
2. Sign in with the current admin access key.
3. Choose **Articles & Profiles**.
4. Select News, Opinion, Monitoring, Reports, Profiles, or Pages.
5. Create a new item, import a Word document, or open an existing draft.
6. Use **Preview** before publication.
7. Select **Save draft** to keep it private or **Publish to website** to make it public.

## What happens after saving

- Drafts are saved privately in Cloudflare D1 and autosaved while an editor works.
- Publishing saves the final version in D1 and starts the GitHub deployment workflow.
- The deployment workflow fetches published D1 content, builds the static website, and uploads it to Cloudflare Pages.
- The **Website deployment** panel in TGD Admin shows whether the latest build is running, live, or failed.

Do not create or edit article Markdown files directly in GitHub. The `content/`
folder is a historical migration snapshot; Cloudflare D1 is the live editorial
source of truth.

## Incidents

Use **Incidents** in TGD Admin. Incident changes are written directly to
Cloudflare KV and appear on the public map after its short cache expires. They
do not require a website rebuild.

## Monthly reports

Choose **Incidents → Monthly reports** to inspect calculated totals and generate
a private monthly report draft. The system:

- calculates monthly and previous-month comparisons;
- creates trend, province, and casualty charts in R2;
- creates a private report draft in D1;
- never publishes the analytical draft automatically;
- never overwrites an existing monthly draft.

An editor must review sources, classifications, casualty totals, actor labels,
and analysis before publishing.

## Uploaded files

Images, embedded Word-document images, PDFs, and DOCX files are stored in
Cloudflare R2. Their public `/media/...` links are inserted into the D1 article.

## If something goes wrong

- A conflict warning means another editor changed the item after you opened it.
  Return to the list, reopen it, and merge your work.
- If content says it was saved but the build did not start, open the Website
  deployment panel and check the GitHub Actions permission on `GITHUB_TOKEN`.
- Use the Activity tab to inspect saves, publications, deletions, incident
  changes, and monthly automation.
