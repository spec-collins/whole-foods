-- Whole Foods vendor response tracker
-- Run this once against your Postgres database before the API is used.
-- e.g. psql "$DATABASE_URL" -f db/schema.sql

CREATE TABLE IF NOT EXISTS vendor_responses (
  vendor_id              TEXT PRIMARY KEY,
  vendor_name            TEXT,
  choice                 TEXT,
  choice_label           TEXT,
  choice_submitted_at    TIMESTAMPTZ,
  timeframe              TEXT,
  timeframe_label        TEXT,
  timeframe_submitted_at TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Speeds up the admin "most recently updated first" view.
CREATE INDEX IF NOT EXISTS vendor_responses_updated_at_idx
  ON vendor_responses (updated_at DESC);
