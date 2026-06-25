-- D1 schema for The Global Decipher content (articles, profiles, pages).
-- One table, JSON for tags. Unique per (collection, slug). Timestamps in ISO8601.

CREATE TABLE IF NOT EXISTS content (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection TEXT NOT NULL,
  slug TEXT NOT NULL,
  type TEXT,
  title TEXT NOT NULL,
  date TEXT,
  author TEXT,
  category TEXT,
  region TEXT,
  summary TEXT,
  tags TEXT DEFAULT '[]',
  access TEXT DEFAULT 'free',
  sensitivity TEXT DEFAULT 'standard',
  status TEXT NOT NULL DEFAULT 'draft',
  published_at TEXT,
  featured INTEGER DEFAULT 0,
  eyebrow TEXT,
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(collection, slug)
);

CREATE INDEX IF NOT EXISTS idx_content_collection ON content(collection);
CREATE INDEX IF NOT EXISTS idx_content_type ON content(type);
CREATE INDEX IF NOT EXISTS idx_content_date ON content(date DESC);
CREATE INDEX IF NOT EXISTS idx_content_featured ON content(featured);
CREATE INDEX IF NOT EXISTS idx_content_status ON content(status);

-- Append-only audit log of admin actions. Helps reconstruct what was saved,
-- published, or deleted, and when. "actor" records the last 4 chars of the
-- token used, which is enough to flag a foreign key without storing the secret.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  action TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  label TEXT,
  sha TEXT,
  actor TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_kind ON audit_log(kind);
