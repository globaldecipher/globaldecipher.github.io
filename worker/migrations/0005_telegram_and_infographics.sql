ALTER TABLE incidents ADD COLUMN arrested INTEGER;

CREATE TABLE IF NOT EXISTS telegram_deliveries (
  x_post_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  telegram_message_id TEXT,
  telegram_chat_id TEXT,
  last_error TEXT,
  last_attempt_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_telegram_deliveries_status
ON telegram_deliveries(status, updated_at DESC);

INSERT OR IGNORE INTO sync_state(key, value)
VALUES ('telegram_enabled', 'false');
