-- Allow opting into cold outreach from the primary portfolio domain.
-- Default false preserves the previous fail-closed behaviour.
BEGIN;

ALTER TABLE outreach_settings
  ADD COLUMN IF NOT EXISTS allow_primary_sending_domain BOOLEAN NOT NULL DEFAULT false;

COMMIT;
