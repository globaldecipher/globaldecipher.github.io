-- Append-only audit log of admin actions. Helps reconstruct who saved/deleted
-- what and when. "actor" is currently always the shared admin token holder, so
-- it just records the token's last 4 chars (good enough to spot a foreign key).
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
