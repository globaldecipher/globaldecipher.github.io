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

## What NOT to publish

- Verbatim propaganda statements, recruitment text, or operational/tactical detail.
- Unverified single-source claims framed as confirmed facts.
- Graphic media or hostage imagery.
- Anything that could identify a confidential source.

If unsure, save it as a draft (don't commit) and review with the desk first.
