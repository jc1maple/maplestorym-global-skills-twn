ALTER TABLE skill_suggestions ADD COLUMN idempotency_key TEXT;
ALTER TABLE skill_suggestions ADD COLUMN payload_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_suggestions_idempotency_key
  ON skill_suggestions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_skill_suggestions_status_page
  ON skill_suggestions(status, created_at DESC, id DESC);
