-- A case, so work can leave the officer who found it.
--
-- Everything an officer notices today ends where they noticed it. A revenue
-- officer who spots a collection pattern that looks wrong has a fraud flag if
-- it fits one of the sweep's rules and otherwise has nothing: no way to hand
-- it to an auditor, no way for the auditor to hand the settlement question to
-- finance, and no record afterwards that any of it happened. The work moves by
-- WhatsApp and the platform keeps none of it.
--
-- What the platform already has is close to a case and is not one. An approval
-- is a single decision by a single person and closes. A support ticket belongs
-- to an agent or a citizen who raised it. A fraud flag is raised by a rule, not
-- by a person, and carries no assignment, no due date and no discussion.
--
-- WHY THE HISTORY IS A SEPARATE TABLE AND APPEND-ONLY
--
-- A case is evidence. If a comment can be edited or a status change overwritten
-- then the record of an investigation is worth exactly as much as the good
-- faith of whoever last touched it, which is the thing an investigation exists
-- to establish. So `cases` holds the current state and `case_events` holds
-- every step that produced it, with no UPDATE or DELETE path in the service and
-- a trigger below that refuses one issued directly.
--
-- The mutable columns on `cases` are a cache of the newest event. They can be
-- rebuilt from `case_events` and the events cannot be rebuilt from them.
--
-- WHY A CASE IS ROUTED TO A ROLE
--
-- The brief asks for departments. There is no department in this schema — the
-- reporting line does not exist either — so a case is addressed to a role, which
-- is what the platform can actually enforce, plus optionally one named officer.
-- `department` on the case is the *destination*, and it is a role name so that
-- "everyone in Finance who can see this" is a permission question with an
-- answer. When departments arrive this column is what they replace.

BEGIN;

CREATE TABLE cases (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_number    TEXT NOT NULL UNIQUE,
  subject        TEXT NOT NULL CHECK (length(btrim(subject)) > 0),
  description    TEXT NOT NULL DEFAULT '',

  -- What kind of work this is. Drives nothing in the code and everything in
  -- the queue an officer filters: an auditor wants the investigations, a
  -- finance officer wants the settlement discrepancies.
  category       TEXT NOT NULL DEFAULT 'GENERAL' CHECK (category IN (
                   'GENERAL', 'REVENUE_ANOMALY', 'RECONCILIATION_EXCEPTION',
                   'FRAUD_INVESTIGATION', 'AGENT_CONDUCT', 'TAXPAYER_DISPUTE',
                   'COMMISSION_QUERY', 'DATA_CORRECTION', 'SYSTEM_ISSUE')),

  risk_level     TEXT NOT NULL DEFAULT 'MEDIUM'
                   CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  priority       TEXT NOT NULL DEFAULT 'NORMAL'
                   CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),

  -- The six states from the brief. RESOLVED means the work is done and the
  -- finding stands; CLOSED means the case is finished with, including the ones
  -- that turned out to be nothing. Keeping them apart is what lets an auditor
  -- count how many investigations found something.
  status         TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN (
                   'OPEN', 'INVESTIGATING', 'AWAITING_INFORMATION',
                   'ESCALATED', 'RESOLVED', 'CLOSED')),

  -- Where it is addressed. A role, because that is what permissions are made
  -- of; see the header.
  department     TEXT CHECK (department IN (
                   'supervisor', 'revenue_officer', 'finance_officer', 'auditor', 'admin')),
  assignee_id    UUID REFERENCES users(id),

  -- What it is about. All optional and all indexed: a case may be about a
  -- transaction, an agent, a taxpayer, an officer, several of those, or none of
  -- them at all.
  transaction_id UUID REFERENCES transactions(id),
  agent_id       UUID REFERENCES agents(id),
  taxpayer_id    UUID REFERENCES taxpayers(id),
  subject_user_id UUID REFERENCES users(id),
  lga_id         UUID REFERENCES lgas(id),

  -- Where it came from, when it came from something. A case opened off a
  -- reconciliation exception or a fraud flag should say so, and the exception
  -- should be reachable from the case rather than remembered.
  source_type    TEXT CHECK (source_type IN (
                   'MANUAL', 'FRAUD_FLAG', 'RECONCILIATION_EXCEPTION', 'SUPPORT_TICKET',
                   'APPROVAL')),
  source_id      UUID,

  due_at         TIMESTAMPTZ,
  opened_by      UUID NOT NULL REFERENCES users(id),
  resolved_at    TIMESTAMPTZ,
  resolved_by    UUID REFERENCES users(id),
  resolution     TEXT,
  closed_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A resolution is a finding, and a case that says it is resolved without one
  -- is the shape of an investigation that was closed rather than concluded.
  CONSTRAINT case_resolution_stated CHECK (
    status <> 'RESOLVED' OR (resolved_at IS NOT NULL AND resolution IS NOT NULL
                             AND length(btrim(resolution)) > 0))
);

-- The queue is read by assignee, by department, and by what it is about. All
-- three are the first thing every screen does.
CREATE INDEX cases_assignee_open_idx ON cases (assignee_id, status)
  WHERE status NOT IN ('RESOLVED', 'CLOSED');
CREATE INDEX cases_department_open_idx ON cases (department, status)
  WHERE status NOT IN ('RESOLVED', 'CLOSED');
CREATE INDEX cases_due_idx ON cases (due_at)
  WHERE due_at IS NOT NULL AND status NOT IN ('RESOLVED', 'CLOSED');
CREATE INDEX cases_transaction_idx ON cases (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX cases_agent_idx ON cases (agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX cases_taxpayer_idx ON cases (taxpayer_id) WHERE taxpayer_id IS NOT NULL;
CREATE INDEX cases_source_idx ON cases (source_type, source_id) WHERE source_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The history
-- ---------------------------------------------------------------------------

CREATE TABLE case_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     UUID NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  sequence_no BIGSERIAL NOT NULL,

  -- Every kind here is written by `services/cases.ts`. A state the schema
  -- accepts and nothing produces is a state no reader can rely on and no test
  -- can reach — `a-state-nothing-writes.test.ts` refuses one, and caught a
  -- 'LINK' kind in the first draft of this table that existed only because it
  -- sounded useful.
  kind        TEXT NOT NULL CHECK (kind IN (
                'OPENED', 'COMMENT', 'NOTE', 'STATUS_CHANGE', 'ASSIGNMENT',
                'ROUTED', 'ESCALATION', 'EVIDENCE', 'PRIORITY_CHANGE',
                'DUE_DATE_CHANGE', 'RESOLUTION')),

  -- A comment is written for the case; a note is the officer's own working
  -- reasoning. Both are visible to every officer who can open the case — there
  -- is no private text on a government record — and they are kept apart so an
  -- auditor reading the file can tell a finding from a thought.
  body        TEXT NOT NULL DEFAULT '',

  -- Officers named in the body. Stored rather than re-parsed so `/my-work`
  -- does not scan every comment on the platform to answer "who mentioned me".
  mentions    UUID[] NOT NULL DEFAULT '{}',

  -- For STATUS_CHANGE, ASSIGNMENT, PRIORITY_CHANGE, DUE_DATE_CHANGE and
  -- ROUTED: what it was, and what it became. Same shape as `audit_logs` for
  -- the same reason — a change nobody can state the before of is not evidence.
  old_value   JSONB,
  new_value   JSONB,

  -- EVIDENCE rows point at a document. The document service owns the file and
  -- its own access log; this is the link and the reason it was attached.
  document_id UUID REFERENCES documents(id),

  actor_id    UUID NOT NULL REFERENCES users(id),
  actor_role  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Every kind that exists to carry text must carry some.
  CONSTRAINT case_event_body_present CHECK (
    kind NOT IN ('COMMENT', 'NOTE', 'RESOLUTION') OR length(btrim(body)) > 0),
  CONSTRAINT case_event_evidence_has_document CHECK (
    kind <> 'EVIDENCE' OR document_id IS NOT NULL)
);

CREATE INDEX case_events_case_idx ON case_events (case_id, sequence_no);
CREATE INDEX case_events_actor_idx ON case_events (actor_id, created_at DESC);
-- `/my-work` asks "which cases mention me", which is a containment test.
CREATE INDEX case_events_mentions_idx ON case_events USING gin (mentions);

-- ---------------------------------------------------------------------------
-- The history is append-only, and not by convention
-- ---------------------------------------------------------------------------
--
-- The service never issues an UPDATE or DELETE against this table. That is a
-- property of the code as it stands today and the record has to outlive it:
-- an investigation whose comments could be rewritten by the next person to
-- edit the service is not evidence. This is the same standard migration 053
-- applied to the money — a rule that only holds when you go through the
-- service layer is not an invariant — so it is enforced where a psql prompt
-- also has to obey it.

CREATE OR REPLACE FUNCTION case_events_are_append_only() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'case_events is append-only: % refused on case event %',
    TG_OP, COALESCE(OLD.id::text, '(unknown)')
    USING HINT = 'Correct a case by appending an event that says what changed.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS case_events_no_update ON case_events;
CREATE TRIGGER case_events_no_update
  BEFORE UPDATE OR DELETE ON case_events
  FOR EACH ROW EXECUTE FUNCTION case_events_are_append_only();

-- A case is never deleted either. It is CLOSED, which is a state an auditor can
-- read, rather than an absence they cannot.
CREATE OR REPLACE FUNCTION cases_are_not_deleted() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'a case is closed, never deleted (case %)', OLD.case_number
    USING HINT = 'Set status to CLOSED.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cases_no_delete ON cases;
CREATE TRIGGER cases_no_delete
  BEFORE DELETE ON cases
  FOR EACH ROW EXECUTE FUNCTION cases_are_not_deleted();

-- ---------------------------------------------------------------------------
-- Case numbers
-- ---------------------------------------------------------------------------
--
-- CASE-2026-000001. A sequence rather than a count of existing rows, because
-- two officers opening a case in the same second would otherwise be handed the
-- same number and one of them would lose the insert.

CREATE SEQUENCE case_number_seq START 1;

COMMIT;
