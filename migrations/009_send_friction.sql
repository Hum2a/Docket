-- Observation override, opening hours, and acknowledged quality warnings on sends.
BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS observation_override TEXT,
  ADD COLUMN IF NOT EXISTS opening_hours TEXT;

ALTER TABLE lead_messages
  ADD COLUMN IF NOT EXISTS acknowledged_warnings TEXT[] NOT NULL DEFAULT '{}';

COMMIT;
