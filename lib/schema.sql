-- Schema for the vendor response tracker. Safe to run repeatedly.
--
-- Two tables on purpose:
--   vendor_responses -- one row per vendor, upserted. This is the tracker you
--                       read and export. A vendor's choice and timeframe merge
--                       onto the same row.
--   response_events  -- append-only record of every payload received. Nothing
--                       is ever updated or deleted here, so a mistaken or
--                       duplicated submission can always be reconstructed.

CREATE TABLE IF NOT EXISTS vendor_responses (
  vendor_id               TEXT PRIMARY KEY,
  vendor_name             TEXT,
  choice                  TEXT,
  choice_label            TEXT,
  choice_submitted_at     TIMESTAMPTZ,
  timeframe               TEXT,
  timeframe_label         TEXT,
  timeframe_submitted_at  TIMESTAMPTZ,
  is_test                 BOOLEAN NOT NULL DEFAULT false,
  first_seen_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS response_events (
  id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vendor_id    TEXT        NOT NULL,
  stage        TEXT        NOT NULL,
  payload      JSONB       NOT NULL,
  ip_hash      TEXT,
  user_agent   TEXT,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS response_events_vendor_idx
  ON response_events (vendor_id, received_at DESC);

-- Supports the per-IP rate limit lookup in /api/respond.
CREATE INDEX IF NOT EXISTS response_events_ip_recent_idx
  ON response_events (ip_hash, received_at DESC);

-- CREATE TABLE IF NOT EXISTS is a no-op when a table of that name already
-- exists with a different shape, which would let the migration report success
-- while leaving the API broken on a missing column. An earlier prototype of
-- this project created a vendor_responses table with created_at/updated_at
-- instead of first_seen_at/last_updated_at, so converge the columns explicitly.
-- Every statement below is a no-op on a table this schema already built.
ALTER TABLE vendor_responses
  ADD COLUMN IF NOT EXISTS vendor_name            TEXT,
  ADD COLUMN IF NOT EXISTS choice                 TEXT,
  ADD COLUMN IF NOT EXISTS choice_label           TEXT,
  ADD COLUMN IF NOT EXISTS choice_submitted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS timeframe              TEXT,
  ADD COLUMN IF NOT EXISTS timeframe_label        TEXT,
  ADD COLUMN IF NOT EXISTS timeframe_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_test                BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_updated_at        TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE response_events
  ADD COLUMN IF NOT EXISTS ip_hash     TEXT,
  ADD COLUMN IF NOT EXISTS user_agent  TEXT,
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ NOT NULL DEFAULT now();
