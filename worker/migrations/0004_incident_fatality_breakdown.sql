ALTER TABLE incidents ADD COLUMN killed_forces INTEGER;
ALTER TABLE incidents ADD COLUMN killed_terrorists INTEGER;
ALTER TABLE incidents ADD COLUMN killed_civilians INTEGER;

UPDATE incidents
SET killed_forces = 0,
    killed_terrorists = 3,
    killed_civilians = 0,
    updated_at = datetime('now')
WHERE source_tweet_id = '2073544702620762571'
  AND killed = 3;

INSERT INTO sync_state(key, value, updated_at)
VALUES ('feed_resync_required', 'true', datetime('now'))
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at;
