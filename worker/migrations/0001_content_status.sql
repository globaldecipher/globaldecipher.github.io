-- Existing imported material is treated as a draft until an editor explicitly
-- publishes it. Core site pages stay public.
ALTER TABLE content ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE content ADD COLUMN published_at TEXT;
UPDATE content
SET status = 'published',
    published_at = COALESCE(updated_at, datetime('now'))
WHERE collection = 'pages';
CREATE INDEX IF NOT EXISTS idx_content_status ON content(status);
