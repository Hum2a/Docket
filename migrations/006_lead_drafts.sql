-- Per-lead hand-written outreach draft override (initial send only).
BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS custom_subject TEXT,
  ADD COLUMN IF NOT EXISTS custom_body TEXT,
  ADD COLUMN IF NOT EXISTS draft_updated_at TIMESTAMPTZ;

COMMIT;
