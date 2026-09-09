-- The asset and liability graph, built as claims with provenance.
--
-- The ask was a view of what is registered under a taxpayer's ID or otherwise
-- connected to them. Built naively that is a surveillance system with a revenue
-- justification, and under the Nigeria Data Protection Act 2023 and its 2025
-- implementation directive that is a legal exposure as well as an ethical one:
-- a revenue authority may target collection to specific, tax-relevant activity,
-- and may not keep a dossier because a dossier is useful.
--
-- So this is deliberately not a dossier. It is a table of edges, each of which
-- is a *claim* that carries where it came from, how strongly it is believed,
-- what power was relied on to hold it, and whether the person it describes has
-- agreed with it. Four properties are enforced here rather than in the service,
-- on this project's standing rule that a guarantee which only holds through the
-- service layer is not an invariant — each is one UPDATE at a psql prompt away
-- from being undone otherwise.
--
--   1. Every edge names its origin. Either an officer or a named job put it
--      there. An edge that cannot say where it came from cannot be defended to
--      the person it is about, and is therefore not allowed to exist.
--
--   2. The claim is immutable; only its state moves. This is the "match, never
--      merge" rule made structural. A phone-number match believed at 85 cannot
--      be quietly promoted to a registry match believed at 100 — the old edge
--      is withdrawn and a new one asserted, and the history of what was
--      believed, when, on what basis, survives. Without this the confidence
--      score is decoration: anything can be made certain after the fact.
--
--   3. A disputed or withdrawn edge records who moved it and why. The dispute
--      button the citizen is offered is worth nothing if the resulting state
--      change is anonymous.
--
--   4. Every read of a person's graph is logged with a purpose, and the log
--      cannot be edited or deleted. This is the pattern the platform already
--      applies to KYC documents, pointed at a more sensitive object. The
--      purpose is a required column and not a nullable note, because
--      purpose-binding that can be skipped is not purpose-binding.

BEGIN;

-- ---------------------------------------------------------------------------
-- The edges
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS taxpayer_connections (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taxpayer_id        UUID NOT NULL REFERENCES taxpayers(id),

  -- What the taxpayer is claimed to be to the thing.
  --
  -- One value, because one is what this phase produces. The design this
  -- implements names OPERATES, GUARANTEES and SHARES_PREMISES as edges a later
  -- phase draws from premises and association data the platform does not yet
  -- hold, and a CHECK listing them now would advertise a capability that does
  -- not exist — which is what the platform's own unreachable-state check
  -- exists to catch. The vocabulary widens in the migration that ships the
  -- code writing it.
  kind               TEXT NOT NULL CHECK (kind IN ('OWNS')),

  -- The thing. `subject_id` is deliberately not a foreign key: the graph is
  -- meant to reach registers this database does not own (land, CAC, the
  -- vehicle authority), and a constraint that only permits things already in
  -- our tables would quietly restrict it to the half we already knew about.
  -- `subject_label` is carried so an officer's screen can name the thing
  -- without a join into a register that may not answer today.
  subject_type       TEXT NOT NULL CHECK (subject_type IN ('VEHICLE')),
  subject_id         UUID NOT NULL,
  subject_label      TEXT NOT NULL,

  -- Where the claim came from, and how strongly it is held. `match_basis`
  -- exists so the number is auditable: a confidence with no stated reason is
  -- a number somebody chose, and cannot be argued with by the person it is
  -- used against.
  source             TEXT NOT NULL CHECK (source IN ('VEHICLE_REGISTRY')),
  confidence         SMALLINT NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  match_basis        TEXT NOT NULL,

  -- The specific power relied on to hold this edge at all. Free text, because
  -- it cites an instrument rather than selecting from a menu, and required,
  -- because an edge nobody can justify is one nobody should have made.
  lawful_basis       TEXT NOT NULL,

  state              TEXT NOT NULL DEFAULT 'ASSERTED'
                     CHECK (state IN ('ASSERTED', 'CONFIRMED_BY_TAXPAYER',
                                      'DISPUTED', 'WITHDRAWN')),
  state_reason       TEXT,
  state_changed_at   TIMESTAMPTZ,
  state_changed_by   UUID REFERENCES users(id),

  obtained_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  obtained_by        UUID REFERENCES users(id),
  obtained_by_job    TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Invariant 1. An officer or a job, and it must be one of them.
  CONSTRAINT connection_has_an_origin
    CHECK (obtained_by IS NOT NULL OR obtained_by_job IS NOT NULL)
);

-- One live edge per claim. Withdrawn edges are excluded so that a withdrawal
-- followed by a fresh assertion — the only lawful way to change what is
-- believed — is possible, while the same job running twice cannot double the
-- graph.
CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_live
  ON taxpayer_connections (taxpayer_id, kind, subject_type, subject_id, source)
  WHERE state <> 'WITHDRAWN';

CREATE INDEX IF NOT EXISTS idx_connections_taxpayer
  ON taxpayer_connections (taxpayer_id, state);

CREATE INDEX IF NOT EXISTS idx_connections_subject
  ON taxpayer_connections (subject_type, subject_id);

-- Invariant 2. The claim cannot be edited, only re-stated.
DROP TRIGGER IF EXISTS trg_connections_immutable ON taxpayer_connections;
CREATE TRIGGER trg_connections_immutable
  BEFORE UPDATE ON taxpayer_connections
  FOR EACH ROW EXECUTE FUNCTION prevent_column_mutation(
    'taxpayer_id', 'kind', 'subject_type', 'subject_id', 'source',
    'confidence', 'match_basis', 'lawful_basis', 'obtained_at',
    'obtained_by', 'obtained_by_job');

DROP TRIGGER IF EXISTS trg_connections_touch ON taxpayer_connections;
CREATE TRIGGER trg_connections_touch
  BEFORE UPDATE ON taxpayer_connections
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- The graph is evidence about a person, so an edge is withdrawn rather than
-- deleted. A row that can vanish cannot be shown to the citizen it described.
DROP TRIGGER IF EXISTS trg_connections_no_delete ON taxpayer_connections;
CREATE TRIGGER trg_connections_no_delete
  BEFORE DELETE ON taxpayer_connections
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

-- Invariant 3. Moving an edge off ASSERTED is an act by somebody, for a reason.
CREATE OR REPLACE FUNCTION enforce_connection_state_is_accountable() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF NEW.state_changed_by IS NULL THEN
      RAISE EXCEPTION
        'A connection may not change state without recording who changed it (% -> %)',
        OLD.state, NEW.state
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.state_reason IS NULL OR btrim(NEW.state_reason) = '' THEN
      RAISE EXCEPTION
        'A connection may not change state without a reason (% -> %)',
        OLD.state, NEW.state
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.state_changed_at IS NULL THEN
      RAISE EXCEPTION 'A connection state change must record when it happened'
        USING ERRCODE = 'check_violation';
    END IF;
    -- A withdrawn edge is finished. Reviving one would let a claim the State
    -- retracted come back without the retraction being visible.
    IF OLD.state = 'WITHDRAWN' THEN
      RAISE EXCEPTION 'A withdrawn connection cannot be revived; assert a new one'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_connections_state_accountable ON taxpayer_connections;
CREATE TRIGGER trg_connections_state_accountable
  BEFORE UPDATE ON taxpayer_connections
  FOR EACH ROW EXECUTE FUNCTION enforce_connection_state_is_accountable();


-- ---------------------------------------------------------------------------
-- Invariant 4. Who looked, at whom, and why.
--
-- Modelled on kyc_document_access_logs, which already carries the officer, the
-- time and the address for every read of an identity document. The difference
-- is `purpose`: the design this implements permits exactly two uses of the
-- graph — finding people who should be assessed and are not, and reconciling
-- an assessment against observable assets — plus the reads a citizen's own
-- request or an objection makes necessary. Recording which one was claimed is
-- what makes the limit checkable after the fact instead of a paragraph in a
-- policy document.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS taxpayer_connection_access_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taxpayer_id  UUID NOT NULL REFERENCES taxpayers(id),
  accessed_by  UUID REFERENCES users(id),
  -- The two permitted uses, plus the reads a citizen's own request makes
  -- necessary. Objection review is not here: the objection workflow belongs to
  -- the phase that introduces presumptive assessment, and a purpose nothing
  -- can claim is a hole in the vocabulary rather than a feature of it.
  purpose      TEXT NOT NULL
               CHECK (purpose IN ('COVERAGE_LEAD', 'CONSISTENCY_CHECK',
                                  'TAXPAYER_REQUEST')),
  ip_address   INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_connection_access_taxpayer
  ON taxpayer_connection_access_logs (taxpayer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_connection_access_officer
  ON taxpayer_connection_access_logs (accessed_by, created_at DESC);

DROP TRIGGER IF EXISTS trg_connection_access_no_update ON taxpayer_connection_access_logs;
CREATE TRIGGER trg_connection_access_no_update
  BEFORE UPDATE ON taxpayer_connection_access_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_any_update();

DROP TRIGGER IF EXISTS trg_connection_access_no_delete ON taxpayer_connection_access_logs;
CREATE TRIGGER trg_connection_access_no_delete
  BEFORE DELETE ON taxpayer_connection_access_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

COMMIT;
