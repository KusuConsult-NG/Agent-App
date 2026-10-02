-- ---------------------------------------------------------------------------
-- Who has been searching the register.
--
-- Migration 083 gave the platform a record of who opened one taxpayer's
-- record, and the commit that added it said what it was leaving out:
--
--   `GET /taxpayers/search` is not logged. A search discloses several people
--   at once and is keyed to a query rather than a taxpayer, so recording it
--   there would mean a row per result — putting one officer's typo on twenty
--   citizens' access logs, which is worse evidence than none. It belongs in a
--   log of its own, keyed to the query.
--
-- That reasoning holds and the conclusion was half of one. Looking at what the
-- search actually returns makes the omission worse than it read at the time:
-- per match it answers TIN, first and last name, business name, phone, email,
-- address, community, LGA and ward. A name typed into that box returns the
-- full contact details of everybody who matches it. So the platform was
-- logging the targeted disclosure of one person's record and not the bulk
-- disclosure of twenty.
--
-- This is the log of its own. One row per search rather than per result, which
-- is the shape that was missing.
--
-- WHY THE FILTERS ARE STORED, AND NOT JUST THE FACT OF A SEARCH
--
-- A log recording that a search happened cannot answer whose data was shown,
-- which is the only question worth asking of it. So what was typed is kept.
-- That makes this table itself hold personal data — a name, a phone number, a
-- TIN somebody searched for — and it is treated accordingly: append-only at
-- the database like every other record of who saw what, and readable only
-- behind `audit:read`, which is the permission the officers who run the
-- searches do not hold.
--
-- `matched` is the count and not the ids. Twenty ids would be the row-per-
-- result shape through the back door, and the count is what distinguishes a
-- lookup of one known trader from a trawl.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS taxpayer_search_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  searched_by  UUID REFERENCES users(id),
  -- The role held at the time, as `taxpayer_record_access_logs` keeps it: an
  -- officer who searched as a revenue officer searched as one, whatever they
  -- are by the time somebody asks.
  actor_role   TEXT,
  -- Which fields were used and what was typed into them. A JSON object rather
  -- than a text blob so a reviewer can ask "who searched by phone number"
  -- without parsing prose.
  filters      JSONB NOT NULL,
  matched      INTEGER NOT NULL,
  ip_address   INET,
  device_id    UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_taxpayer_search_officer
  ON taxpayer_search_logs (searched_by, created_at DESC);

-- "Who has been trawling the register this week" reads by time alone.
CREATE INDEX IF NOT EXISTS idx_taxpayer_search_when
  ON taxpayer_search_logs (created_at DESC);

DROP TRIGGER IF EXISTS trg_taxpayer_search_logs_no_update ON taxpayer_search_logs;
CREATE TRIGGER trg_taxpayer_search_logs_no_update
  BEFORE UPDATE ON taxpayer_search_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_any_update();

DROP TRIGGER IF EXISTS trg_taxpayer_search_logs_no_delete ON taxpayer_search_logs;
CREATE TRIGGER trg_taxpayer_search_logs_no_delete
  BEFORE DELETE ON taxpayer_search_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();
