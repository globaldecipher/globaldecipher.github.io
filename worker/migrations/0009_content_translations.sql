-- Urdu and Pashto editions of the public site. The English row in `content`
-- stays the single source of truth; a translation is a derived copy keyed by
-- the hash of the English text it came from, so an edit to the article marks
-- its translations stale automatically instead of leaving readers on a version
-- that no longer matches the original.
CREATE TABLE IF NOT EXISTS content_translations (
  collection TEXT NOT NULL,
  slug TEXT NOT NULL,
  lang TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  eyebrow TEXT,
  body TEXT,
  model TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (collection, slug, lang)
);

-- The build fetches a whole language at once; the batch translator scans for
-- rows whose hash no longer matches their English original.
CREATE INDEX IF NOT EXISTS idx_content_translations_lang ON content_translations (lang, collection);
