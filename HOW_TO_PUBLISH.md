# How to publish on The Global Decipher

The live editorial source of truth is Cloudflare D1. GitHub stores the website
code and runs the deployment; it is not the article database.

## Publish an article, profile, report, or page

1. Go to `https://theglobaldecipher.com/admin`.
2. Sign in.
3. Open **Articles & Profiles** and choose the correct section.
4. Create a new item or edit an existing one.
5. Write in the editor or import a `.docx` file.
6. Complete the title, date, summary, region, category, tags, and sensitivity.
7. Preview the page.
8. Choose:
   - **Save draft** — private D1 record, no website rebuild.
   - **Publish to website** — published D1 record followed by a website rebuild.

When a publish starts, the Worker dispatches `deploy.yml`. GitHub Actions checks
out the code, `build.mjs` downloads all published D1 rows, the Explorer is
built, and the resulting `site/` directory is uploaded to Cloudflare Pages.

The Admin **Website deployment** panel shows the latest state.

## Publish an incident

1. Open **Incidents**.
2. Select **New incident**.
3. Enter the date, headline, summary, location, classification, actors,
   casualties, source, and verification state.
4. Select **Publish incident**.

The Worker validates the record and writes it directly to Cloudflare KV.
The public map and all interactive incident analytics update without a Pages
build.

## Generate a monthly report draft

1. Open **Incidents → Monthly reports**.
2. Choose the reporting month.
3. Review the calculated totals and rankings.
4. Select **Generate report draft**.
5. Open Reports under **Articles & Profiles**.
6. Review the generated draft and R2 charts.
7. Replace the Editor analysis placeholder with reviewed research.
8. Publish only after checking source links, duplicate events, casualty
   classifications, actor labels, and prose.

On the first day of each month, the Worker also attempts to generate the
previous month automatically. It creates a draft only and will not overwrite an
existing report.

## Editing safety

Every editor receives the version timestamp that was current when the item was
opened. If another editor saves first, the older editor receives a conflict
warning instead of overwriting the newer work.

## Content and file locations

| Material | Source of truth |
| --- | --- |
| Articles, reports, profiles, pages | Cloudflare D1 |
| Incidents and maintenance state | Cloudflare KV |
| Images, PDFs, imported document media, generated charts | Cloudflare R2 |
| Website code, CSS, JavaScript, templates, Explorer datasets | GitHub |
| Public generated website | Cloudflare Pages |

The repository `content/` files are retained as a migration snapshot and are
not read by the production build.

## Access and accountability

The existing shared access key remains available until Cloudflare Access is
configured with the owner's and interns' approved email addresses. Do not
enable an Access policy before those identities are confirmed, because doing so
could lock the owner out of `/admin`.
