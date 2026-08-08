CREATE TABLE IF NOT EXISTS skill_suggestions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  job_code TEXT NOT NULL,
  job_name TEXT NOT NULL,
  submitter_name TEXT,
  message TEXT,
  config_json TEXT NOT NULL,
  catalog_json TEXT NOT NULL DEFAULT '{}',
  ip_hash TEXT,
  user_agent TEXT,
  reviewed_at TEXT,
  admin_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_skill_suggestions_status_created
  ON skill_suggestions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_suggestions_job
  ON skill_suggestions(job_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_suggestions_ip_hash
  ON skill_suggestions(ip_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS skill_defaults (
  job_code TEXT PRIMARY KEY,
  job_name TEXT NOT NULL,
  suggestion_id TEXT,
  config_json TEXT NOT NULL,
  catalog_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (suggestion_id) REFERENCES skill_suggestions(id)
);

CREATE INDEX IF NOT EXISTS idx_skill_defaults_updated_at
  ON skill_defaults(updated_at DESC);
