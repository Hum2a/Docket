-- Consent / warm-send lane + note direction for the consent audit trail.
BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS consent_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_note TEXT,
  ADD COLUMN IF NOT EXISTS consent_email TEXT,
  ADD COLUMN IF NOT EXISTS warm_send_at TIMESTAMPTZ;

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_consent_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_consent_status_check
  CHECK (consent_status IN ('none', 'verbal_call', 'written_reply'));

CREATE INDEX IF NOT EXISTS leads_warm_send_at_idx
  ON leads (warm_send_at)
  WHERE warm_send_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_consent_email_idx
  ON leads (lower(consent_email))
  WHERE consent_email IS NOT NULL AND consent_email <> '';

ALTER TABLE lead_messages DROP CONSTRAINT IF EXISTS lead_messages_direction_check;
ALTER TABLE lead_messages ADD CONSTRAINT lead_messages_direction_check
  CHECK (direction IN ('out', 'in', 'note'));

COMMIT;
