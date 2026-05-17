# How to publish an article

You publish from a web browser. No terminal needed. Works from your laptop, phone, or any computer.

## Quick steps

1. Go to https://github.com/globaldecipher/globaldecipher.github.io
2. Open the `content/` folder, then pick the section your article belongs in:
   - `content/news/` — news briefings and analytical notes
   - `content/opinion/` — opinion / commentary essays
   - `content/monitoring/` — monitoring desk previews
   - `content/reports/` — research reports
   - `content/profiles/` — actor profiles (individuals or groups)
3. Click **"Add file → Create new file"** (top right of the file list)
4. Type a filename, dash-separated, ending in `.md`. Example:
   `2026-05-17-ttp-claim-cycle.md`
5. Paste a template (see below) and fill in your content
6. Scroll down. Leave "Commit directly to the main branch" selected. Click **Commit changes**.
7. Wait ~60–90 seconds. The site rebuilds itself and updates at https://globaldecipher.github.io

That's it.

## Template — news / opinion / monitoring

```markdown
---
title: "Your headline here"
date: "2026-05-17"
author: "TGD News Desk"
type: "news"
category: "Pakistan"
region: "Pakistan"
summary: "One or two lines that show on cards and search."
tags: ["Pakistan", "TTP", "Public Sources"]
access: "free"
sensitivity: "standard"
featured: false
---

## Executive signal

Your first paragraph here.

## What to watch

- Bullet one
- Bullet two
- Bullet three

## Why it matters

Closing paragraph.
```

## Template — actor profile

```markdown
---
title: "Full name"
date: "2026-05-17"
author: "TGD Research Desk"
type: "profiles"
category: "Individual"
region: "Pakistan"
summary: "One or two lines summarising who they are and why they matter."
tags: ["Group name", "Role", "Status"]
access: "free"
sensitivity: "research-sensitive"
featured: false
---

## Status

Living / deceased / in custody — with date and brief context.

## Identification

- **Full name:** ...
- **Born:** date, place
- **Nationality:** ...
- **Organisation:** ...

## Background

Two or three short paragraphs of biographical detail drawn from public sources.

## Significance

Why this person is a reference point for the desk's research.

## Public-source notes

A note about the public sources used (Wikipedia, Britannica, government documents, academic biographies, on-record reporting).
```

## Field reference (frontmatter)

| field | required | options / notes |
| --- | --- | --- |
| `title` | yes | The headline. |
| `date` | yes | `YYYY-MM-DD` |
| `author` | yes | e.g. `TGD News Desk`, `TGD Research Desk`. |
| `type` | yes | One of: `news`, `opinion`, `monitoring`, `reports`, `profiles`. |
| `category` | recommended | Short label shown on cards, e.g. `Pakistan`, `Digital Propaganda`. |
| `region` | recommended | e.g. `Pakistan`, `South Asia`, `Middle East`, `Global`. |
| `summary` | yes | Used in cards and search index. Keep under ~30 words. |
| `tags` | yes | Array of 2–4 short tags. |
| `access` | yes | `free` or `premium-preview` (shows a premium badge + sidebar CTA). |
| `sensitivity` | yes | `standard` or `research-sensitive` (red badge). |
| `featured` | optional | `true` to show in the "Featured" homepage band. |

## Tips

- The build runs automatically after every commit. If the site doesn't update within ~2 minutes, check the **Actions** tab on the repo for the latest run.
- You don't have to build locally. Just edit on github.com and commit.
- Want to fix a typo in a live article? Browse to the `.md` file on GitHub, click the pencil icon (top right), edit, commit. Site rebuilds.

## Adding charts, tables, PDFs, and embeds to a report

### 1. Charts and images (PNG, JPG, SVG)

Export your chart from Excel / Google Sheets / Canva / Datawrapper / Flourish as **PNG** (or SVG for sharper rendering). Then:

1. On github.com, browse to `static/charts/`
2. Click **Add file → Upload files**, drag the image in, **Commit changes**
3. In your article markdown, reference it on its own line:

   ```markdown
   ![Reported incidents by month, Pakistan Q1 2026](/assets/charts/may-2026-incidents.png)
   ```

   The text in `[ ]` is the alt text AND the caption. Put a quoted caption after the URL if you want a different caption:

   ```markdown
   ![](/assets/charts/may-2026-incidents.png "Source: TGD monitoring · public sources only")
   ```

When an image is on its own line, the site wraps it in a `<figure>` with a red-bar caption below. Inside a paragraph the image inlines normally.

### 2. Data tables

GitHub-flavoured markdown tables work. Pipe-separated rows, with a header separator. Use `---` for default, `---:` for right-align, `:---:` for center.

```markdown
| Region | Incidents | Claimed | Verified | Trend |
| --- | ---: | ---: | ---: | :---: |
| Pakistan | 51 | 38 | 22 | ↑ |
| Afghanistan | 34 | 26 | 14 | → |
```

Renders as a proper styled table with bold uppercase headers, hairline rows, and hover highlights.

### 3. PDF (or XLSX / CSV / ZIP) downloads

1. On github.com, browse to `static/reports/`
2. Upload your PDF (e.g. `2026-05-monthly-threat-review.pdf`)
3. In the article, link to it like any other link:

   ```markdown
   [Download the May 2026 Threat Review (PDF)](/assets/reports/2026-05-monthly-threat-review.pdf)
   ```

The site automatically styles PDF/XLSX/CSV/ZIP links as download buttons with a coloured file-type badge.

### 4. Interactive charts (Datawrapper, Flourish, Tableau, etc.)

Paste the `<iframe>` embed code from the chart tool on its own block (with blank lines above and below). Example from Datawrapper:

```html
<iframe src="https://datawrapper.dwcdn.net/abc123/1/" width="100%" height="500" frameborder="0" scrolling="no" allowfullscreen></iframe>
```

The site renders the iframe in a styled embed container with rounded corners.

### 5. Pull quotes

Quote-style emphasis with `>`:

```markdown
> Public-source monitoring is a leading indicator of attention, not of capability.
```

Renders with a red left border in italic serif.

### Putting it together (monthly report example)

A realistic report mixes them all — see [`content/reports/2026-05-monthly-threat-review.md`](content/reports/2026-05-monthly-threat-review.md) in the repo for a working template.

## What NOT to publish

- Verbatim propaganda statements, recruitment text, or operational/tactical detail.
- Unverified single-source claims framed as confirmed facts.
- Graphic media or hostage imagery.
- Anything that could identify a confidential source.

If unsure, save it as a draft (don't commit) and review with the desk first.
