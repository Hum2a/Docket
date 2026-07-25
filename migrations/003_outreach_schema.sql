-- Outreach pipeline schema (additive; does not modify job-application tables).
BEGIN;

-- ── leads ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id                      SERIAL PRIMARY KEY,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  business_name           TEXT NOT NULL,
  slug                    TEXT NOT NULL,
  industry                TEXT,
  location                TEXT,
  postcode                TEXT,
  address                 TEXT,
  contact_name            TEXT,
  contact_email           TEXT,
  contact_phone           TEXT,
  contact_form_url        TEXT,
  email_source            TEXT,
  email_verified          BOOLEAN NOT NULL DEFAULT false,
  website_url             TEXT,
  has_website             BOOLEAN NOT NULL DEFAULT false,
  companies_house_number  TEXT,
  entity_type             TEXT NOT NULL DEFAULT 'unknown'
                          CHECK (entity_type IN (
                            'ltd','llp','scottish_partnership','public_body',
                            'sole_trader','partnership','unknown'
                          )),
  corporate_subscriber    BOOLEAN NOT NULL DEFAULT false,
  ch_status               TEXT,
  incorporated_on         DATE,
  audit                   JSONB NOT NULL DEFAULT '{}'::jsonb,
  need_score              NUMERIC(3,1),
  likelihood_score        NUMERIC(3,1),
  priority_score          NUMERIC(3,1),
  score_reason            TEXT,
  demo_url                TEXT,
  demo_built_at           TIMESTAMPTZ,
  demo_status             TEXT NOT NULL DEFAULT 'none'
                          CHECK (demo_status IN ('none','building','ready','failed','expired')),
  status                  TEXT NOT NULL DEFAULT 'sourced'
                          CHECK (status IN (
                            'sourced','qualified','audited','scored','queued','demo_ready',
                            'sent','followed_up','replied','interested','not_interested',
                            'unsubscribed','won','lost'
                          )),
  sent_at                 TIMESTAMPTZ,
  last_touch_at           TIMESTAMPTZ,
  next_followup_at        TIMESTAMPTZ,
  followup_step           INTEGER NOT NULL DEFAULT 0,
  replied_at              TIMESTAMPTZ,
  reply_sentiment         TEXT
                          CHECK (reply_sentiment IS NULL OR reply_sentiment IN (
                            'positive','neutral','negative','ooo','unsubscribe'
                          )),
  suppressed              BOOLEAN NOT NULL DEFAULT false,
  suppression_reason      TEXT,
  offer_amount            NUMERIC(10,2) NOT NULL DEFAULT 500,
  source                  TEXT,
  source_ref              TEXT,
  review_reasons          TEXT[] NOT NULL DEFAULT '{}',
  CONSTRAINT leads_slug_unique UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS leads_status_idx ON leads (status);
CREATE INDEX IF NOT EXISTS leads_priority_idx ON leads (priority_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS leads_next_followup_idx ON leads (next_followup_at)
  WHERE next_followup_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_corporate_priority_idx
  ON leads (corporate_subscriber, priority_score DESC NULLS LAST);
CREATE UNIQUE INDEX IF NOT EXISTS leads_source_ref_unique
  ON leads (source_ref) WHERE source_ref IS NOT NULL AND source_ref <> '';
CREATE UNIQUE INDEX IF NOT EXISTS leads_name_postcode_unique
  ON leads (lower(business_name), coalesce(lower(postcode), ''));

-- ── lead_notes (create/delete only) ───────────────────────────
CREATE TABLE IF NOT EXISTS lead_notes (
  id          SERIAL PRIMARY KEY,
  lead_id     INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_notes_lead_idx ON lead_notes (lead_id);

-- ── lead_reminders ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_reminders (
  id          SERIAL PRIMARY KEY,
  lead_id     INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  due_date    DATE NOT NULL,
  message     TEXT NOT NULL,
  completed   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_reminders_lead_idx ON lead_reminders (lead_id);
CREATE INDEX IF NOT EXISTS lead_reminders_due_idx ON lead_reminders (due_date) WHERE NOT completed;

-- ── lead_messages ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_messages (
  id                    SERIAL PRIMARY KEY,
  lead_id               INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  direction             TEXT NOT NULL CHECK (direction IN ('out','in')),
  channel               TEXT NOT NULL CHECK (channel IN ('email','form','phone')),
  subject               TEXT,
  body                  TEXT,
  template_id           TEXT,
  variant               TEXT,
  provider_message_id   TEXT,
  idempotency_key       TEXT,
  status                TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN (
                          'queued','sent','delivered','bounced','complained','failed'
                        )),
  sent_at               TIMESTAMPTZ,
  delivered_at          TIMESTAMPTZ,
  opened_at             TIMESTAMPTZ,
  error                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lead_messages_idempotency_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS lead_messages_lead_idx ON lead_messages (lead_id);
CREATE INDEX IF NOT EXISTS lead_messages_created_idx ON lead_messages (created_at DESC);

-- ── suppressions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppressions (
  id          SERIAL PRIMARY KEY,
  value       TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('email','domain')),
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT suppressions_kind_value_unique UNIQUE (kind, value)
);

-- ── outreach_settings (single row) ────────────────────────────
CREATE TABLE IF NOT EXISTS outreach_settings (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  auto_send_enabled     BOOLEAN NOT NULL DEFAULT false,
  auto_send_threshold   NUMERIC(3,1) NOT NULL DEFAULT 8.0,
  daily_send_cap        INTEGER NOT NULL DEFAULT 20,
  sending_domain        TEXT,
  from_address          TEXT,
  reply_to              TEXT,
  postal_address        TEXT,
  followup_offsets_days INTEGER[] NOT NULL DEFAULT '{3,7}',
  dry_run               BOOLEAN NOT NULL DEFAULT true,
  paused_until          TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO outreach_settings (id, auto_send_enabled, dry_run, auto_send_threshold, daily_send_cap, followup_offsets_days)
VALUES (1, false, true, 8.0, 20, '{3,7}')
ON CONFLICT (id) DO NOTHING;

COMMIT;
