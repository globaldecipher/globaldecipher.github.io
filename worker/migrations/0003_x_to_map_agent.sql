-- TGD X-to-Map Agent
-- Official X OAuth, durable sync state, incident review, rules, and exports.
-- X IDs are TEXT because they are larger than JavaScript's safe integer range.

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_run_lock (
  name TEXT PRIMARY KEY,
  owner_id TEXT,
  locked_until INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS x_oauth_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  token_type TEXT NOT NULL DEFAULT 'bearer',
  scope TEXT,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS x_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  x_post_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT,
  parent_post_id TEXT,
  raw_text TEXT NOT NULL,
  raw_json TEXT NOT NULL DEFAULT '{}',
  referenced_tweets_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  post_url TEXT NOT NULL,
  classification TEXT,
  classification_confidence TEXT,
  processing_status TEXT NOT NULL DEFAULT 'stored',
  error_message TEXT,
  gemini_output TEXT,
  created_at_system TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at_system TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_x_posts_status ON x_posts(processing_status, created_at);
CREATE INDEX IF NOT EXISTS idx_x_posts_conversation ON x_posts(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS incident_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_name TEXT NOT NULL UNIQUE,
  category_group TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  source_tweet_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_text TEXT NOT NULL,
  tweet_created_at TEXT NOT NULL,
  incident_date TEXT,
  incident_date_source TEXT NOT NULL DEFAULT 'unknown',
  country TEXT,
  province TEXT,
  district TEXT,
  locality TEXT,
  location_label TEXT,
  latitude REAL,
  longitude REAL,
  location_precision TEXT,
  incident_type TEXT,
  category_id INTEGER,
  category_name TEXT,
  summary TEXT,
  killed INTEGER,
  injured INTEGER,
  actor_or_group TEXT,
  confidence TEXT,
  status TEXT NOT NULL DEFAULT 'needs_review',
  review_reason TEXT,
  duplicate_of TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(category_id) REFERENCES incident_categories(id),
  FOREIGN KEY(duplicate_of) REFERENCES incidents(id)
);
CREATE INDEX IF NOT EXISTS idx_incidents_public ON incidents(status, incident_date DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_review ON incidents(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_recent_location ON incidents(country, province, district, incident_date DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_fingerprint ON incidents(fingerprint);

CREATE TABLE IF NOT EXISTS incident_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id TEXT NOT NULL,
  x_post_id TEXT NOT NULL,
  source_role TEXT NOT NULL DEFAULT 'primary',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(incident_id, x_post_id),
  FOREIGN KEY(incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  FOREIGN KEY(x_post_id) REFERENCES x_posts(x_post_id)
);
CREATE INDEX IF NOT EXISTS idx_incident_sources_post ON incident_sources(x_post_id);

CREATE TABLE IF NOT EXISTS agent_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  rule_text TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  province TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_rules_active ON agent_rules(active, rule_type);

CREATE TABLE IF NOT EXISTS correction_examples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_x_post_id TEXT NOT NULL,
  original_agent_output TEXT NOT NULL,
  owner_correction TEXT NOT NULL,
  owner_reason TEXT,
  approved_for_future_prompt INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posting_style_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  posts_analysed INTEGER NOT NULL DEFAULT 0,
  detected_patterns_json TEXT NOT NULL DEFAULT '{}',
  approved_by_owner INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS monthly_exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_month TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Karachi',
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  xlsx_object_key TEXT,
  csv_object_key TEXT,
  charts_metadata TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'ready',
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(report_month, version)
);

CREATE TABLE IF NOT EXISTS agent_metrics (
  metric_month TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  metric_value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(metric_month, metric_key)
);

CREATE TABLE IF NOT EXISTS agent_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL DEFAULT 'info',
  event TEXT NOT NULL,
  message TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_logs_created ON agent_logs(created_at DESC);

INSERT OR IGNORE INTO sync_state(key, value) VALUES
  ('agent_enabled', 'false'),
  ('target_country', 'Pakistan'),
  ('x_owned_read_unit_cost_usd', '0.001');

INSERT OR IGNORE INTO agent_run_lock(name, owner_id, locked_until)
VALUES ('x_to_map', NULL, 0);

INSERT OR IGNORE INTO incident_categories(category_name, category_group, sort_order) VALUES
  ('Armed attack', 'Attack', 10),
  ('Targeted killing', 'Attack', 20),
  ('IED / Explosion', 'Attack', 30),
  ('Suicide attack / VBIED', 'Attack', 40),
  ('Drone / Quadcopter', 'Attack', 50),
  ('Kidnapping', 'Attack', 60),
  ('Counterterrorism operation', 'Security operation', 70),
  ('Border incident', 'Security incident', 80),
  ('Civil unrest', 'Security incident', 90),
  ('Security incident', 'Other', 100);
