-- Outreach fixes: store demo expiry as a real fact for final-email copy.
BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS demo_expires_at TIMESTAMPTZ;

COMMIT;
