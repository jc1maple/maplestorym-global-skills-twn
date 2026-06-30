CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ip TEXT,
  ip_hash TEXT,
  country TEXT,
  colo TEXT,
  path TEXT NOT NULL,
  title TEXT,
  referrer TEXT,
  user_agent TEXT,
  language TEXT,
  timezone TEXT,
  viewport TEXT,
  screen TEXT,
  session_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_visits_created_at ON visits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_path ON visits(path);
CREATE INDEX IF NOT EXISTS idx_visits_ip_hash ON visits(ip_hash);
