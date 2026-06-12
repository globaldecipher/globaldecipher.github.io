# The Global Decipher

Independent, research-first coverage of terrorism, militant networks, and security risk — focused on Pakistan, with regional and global context.

**Live site:** https://globaldecipher.github.io

## Publishing an article

See [`HOW_TO_PUBLISH.md`](HOW_TO_PUBLISH.md). Short version: edit a markdown file in `content/` on github.com, commit, and the site rebuilds itself in about a minute.

## Repo structure

```
content/      ← Markdown source for every article (you edit these)
  news/
  opinion/
  monitoring/
  reports/
  profiles/
  pages/      ← static pages (About, Contact, Methodology, etc.)
static/       ← CSS, JS, brand images
build.mjs     ← static-site builder
.github/      ← GitHub Actions workflow that auto-builds and deploys
site/         ← built output (gitignored — built by the Action on each push)
```

## Build locally (optional)

You don't need this unless you're testing CSS or build changes. Articles can be published entirely from the GitHub web UI.

```bash
node build.mjs
python3 -m http.server 4173 --directory site
# open http://localhost:4173
```

## Cloudflare Pages

The site is ready for Cloudflare Pages with these settings:

- Framework preset: `None`
- Build command: `npm run build`
- Build output directory: `site`
- Production branch: `main`
- Environment variable: `SITE_URL=https://your-domain.example`

`SITE_URL` controls canonical links, social metadata, RSS links, and the sitemap. The generated `_headers` file adds conservative security and caching headers when deployed on Cloudflare Pages.

## Editorial posture

- Public-source first. Claim vs. confirmation discipline.
- No propaganda reproduction, no graphic media, no tactical detail.
- Open corrections policy.
- See `/methodology/` and `/corrections-policy/` on the live site.
