-- Track send attempts so failed/queued messages can be retried in place.
BEGIN;

ALTER TABLE lead_messages
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

COMMIT;
