-- Departments, revenue offices, and the line an officer reports along.
--
-- The platform models the revenue service's *work* in detail and its
-- *organisation* not at all. There is no department, no office, and no
-- reporting line — a `supervisor` role exists and nobody has a supervisor.
--
-- That absence is not cosmetic. Six items on the officer readiness assessment
-- read Missing or Partial because of it, and one of them is load-bearing: a
-- case cannot be routed to Finance as a body. `services/cases.ts` addresses a
-- case to a *role* instead, and says so in its header, because a role is the
-- only grouping the schema could enforce. Escalation has the same problem —
-- "send this up" needs somewhere up to send it to.
--
-- WHY A DEPARTMENT IS NOT A ROLE
--
-- A role says what somebody may do. A department says who they work with and
-- who answers for them. PSIRS has two Assessment departments in different
-- zones whose officers hold identical permissions, and a case belonging to one
-- of them should not land in the other's queue.
--
-- So both exist and neither replaces the other: permissions stay on the role,
-- and routing, escalation and answerability move to the department.
--
-- WHY TRANSFERS ARE THEIR OWN TABLE
--
-- Reassigning an officer's territories is a transfer in effect, and it was
-- recorded only as an audit entry — which answers "what changed" and not "who
-- has worked this LGA this year", a question that comes up in every revenue
-- dispute. A transfer is a dated fact about a person's posting, and audit
-- entries are a log of writes. Reconstructing the first from the second means
-- replaying every write in order and hoping none is missing.

BEGIN;

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------

CREATE TABLE departments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  name_ha     TEXT,
  description TEXT,

  /*
   * What kind of work this department does.
   *
   * Deliberately a small fixed list, and deliberately not the role list. Two
   * departments can both be ASSESSMENT and hold different officers; a
   * department is not a permission set. This exists so a case raised about a
   * settlement can be routed to "whichever department does finance" without
   * the raiser having to know the organisation chart.
   */
  function    TEXT NOT NULL CHECK (function IN (
                'ASSESSMENT', 'COLLECTION', 'FINANCE', 'AUDIT',
                'ENFORCEMENT', 'TAXPAYER_SERVICES', 'ADMINISTRATION', 'TECHNOLOGY')),

  -- The officer who answers for the department. Nullable: a department can
  -- exist before its head is appointed, and forcing one would mean inventing a
  -- head to create a department.
  head_user_id UUID REFERENCES users(id),

  parent_id   UUID REFERENCES departments(id),
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT department_is_not_its_own_parent CHECK (parent_id IS DISTINCT FROM id)
);

CREATE INDEX departments_function_idx ON departments (function) WHERE status = 'ACTIVE';
CREATE INDEX departments_parent_idx ON departments (parent_id) WHERE parent_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Revenue offices
-- ---------------------------------------------------------------------------
--
-- Where officers physically work, which is not the same as the territory they
-- cover: the Jos North office administers three LGAs. A taxpayer asking "where
-- do I go" needs the office; a report asking "whose revenue is this" needs the
-- territory. Conflating them is why the brief lists both.

CREATE TABLE revenue_offices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  name_ha       TEXT,
  lga_id        UUID NOT NULL REFERENCES lgas(id),
  address       TEXT,
  phone         TEXT,

  -- The LGAs this office administers, which usually includes its own and may
  -- include others. An array rather than a join table because it is read on
  -- every officer's profile and written when an office is created.
  covers_lga_ids UUID[] NOT NULL DEFAULT '{}',

  head_user_id  UUID REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX revenue_offices_lga_idx ON revenue_offices (lga_id) WHERE status = 'ACTIVE';

/*
 * A department is closed, an office is closed. Neither is deleted.
 *
 * `schema-audit.test.ts` requires every table to be either delete-protected or
 * listed as deliberately mutable with a reason, and these belong in the first
 * group: a case carries `department_id`, a posting record names the department
 * somebody moved into, and a deleted row turns both into a dangling identifier
 * that no report can resolve. CLOSED is a state an auditor can read; an absence
 * is not.
 */
CREATE OR REPLACE FUNCTION organisation_rows_are_closed_not_deleted() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is closed, never deleted (%)', TG_TABLE_NAME, OLD.code
    USING HINT = 'Set status to CLOSED.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS departments_no_delete ON departments;
CREATE TRIGGER departments_no_delete
  BEFORE DELETE ON departments
  FOR EACH ROW EXECUTE FUNCTION organisation_rows_are_closed_not_deleted();

DROP TRIGGER IF EXISTS revenue_offices_no_delete ON revenue_offices;
CREATE TRIGGER revenue_offices_no_delete
  BEFORE DELETE ON revenue_offices
  FOR EACH ROW EXECUTE FUNCTION organisation_rows_are_closed_not_deleted();

-- ---------------------------------------------------------------------------
-- The officer profile the brief asks for
-- ---------------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN department_id     UUID REFERENCES departments(id),
  ADD COLUMN revenue_office_id UUID REFERENCES revenue_offices(id),
  ADD COLUMN supervisor_id     UUID REFERENCES users(id),
  ADD COLUMN job_title         TEXT,
  ADD COLUMN staff_number      TEXT;

CREATE UNIQUE INDEX users_staff_number_key ON users (staff_number)
  WHERE staff_number IS NOT NULL;
CREATE INDEX users_department_idx ON users (department_id) WHERE department_id IS NOT NULL;
CREATE INDEX users_supervisor_idx ON users (supervisor_id) WHERE supervisor_id IS NOT NULL;

/*
 * Nobody supervises themselves.
 *
 * The obvious constraint, and the one that stops the escalation walk below
 * looping forever on a single row. Longer cycles are prevented by the trigger
 * that follows, because a CHECK constraint cannot see other rows.
 */
ALTER TABLE users ADD CONSTRAINT user_is_not_their_own_supervisor
  CHECK (supervisor_id IS DISTINCT FROM id);

/*
 * And no cycle of any length.
 *
 * Escalation walks up `supervisor_id` until it runs out, so a cycle is not a
 * data-quality nuisance — it is a query that never returns, on the path that
 * fires when somebody escalates a case. Two officers each set as the other's
 * supervisor is an ordinary administrative mistake, so the database refuses it
 * rather than trusting every future caller to check.
 */
CREATE OR REPLACE FUNCTION reporting_line_has_no_cycle() RETURNS TRIGGER AS $$
DECLARE
  cursor_id UUID := NEW.supervisor_id;
  hops      INTEGER := 0;
BEGIN
  WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id = NEW.id THEN
      RAISE EXCEPTION 'that reporting line loops back to % ', NEW.full_name
        USING HINT = 'An officer cannot end up supervising themselves, however indirectly.';
    END IF;
    hops := hops + 1;
    -- A service with more than thirty levels of hierarchy has a different
    -- problem, and an unbounded walk here would be its own denial of service.
    IF hops > 30 THEN
      RAISE EXCEPTION 'that reporting line is more than 30 deep';
    END IF;
    SELECT supervisor_id INTO cursor_id FROM users WHERE id = cursor_id;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_reporting_line_acyclic ON users;
CREATE TRIGGER users_reporting_line_acyclic
  BEFORE INSERT OR UPDATE OF supervisor_id ON users
  FOR EACH ROW WHEN (NEW.supervisor_id IS NOT NULL)
  EXECUTE FUNCTION reporting_line_has_no_cycle();

-- ---------------------------------------------------------------------------
-- Transfers
-- ---------------------------------------------------------------------------

CREATE TABLE officer_transfers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),

  kind            TEXT NOT NULL CHECK (kind IN (
                    'POSTING', 'DEPARTMENT', 'OFFICE', 'SUPERVISOR', 'TERRITORY', 'ROLE')),

  -- What it was and what it became, in the same shape as `audit_logs` and for
  -- the same reason: a change nobody can state the before of is not a record.
  from_value      JSONB,
  to_value        JSONB,

  reason          TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  recorded_by     UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX officer_transfers_user_idx ON officer_transfers (user_id, effective_from DESC);
CREATE INDEX officer_transfers_date_idx ON officer_transfers (effective_from DESC);

/*
 * A posting history is not editable.
 *
 * "Who has worked this LGA this year" is asked in revenue disputes, and an
 * answer that can be adjusted afterwards is not evidence of anything. Same
 * standard as the case history and the audit chain.
 */
CREATE OR REPLACE FUNCTION officer_transfers_are_append_only() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'a posting record is append-only: % refused', TG_OP
    USING HINT = 'Record a further transfer instead of changing an earlier one.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS officer_transfers_no_change ON officer_transfers;
CREATE TRIGGER officer_transfers_no_change
  BEFORE UPDATE OR DELETE ON officer_transfers
  FOR EACH ROW EXECUTE FUNCTION officer_transfers_are_append_only();

-- ---------------------------------------------------------------------------
-- A case can now be addressed to a department
-- ---------------------------------------------------------------------------
--
-- `cases.department` stays: it is a role name, it is what five existing case
-- rows are addressed to, and dropping it would strand them. The new column
-- sits beside it, and `services/cases.ts` prefers it when set — so routing to
-- a body works from today and routing to a role keeps working for anything
-- already in flight.

ALTER TABLE cases ADD COLUMN department_id UUID REFERENCES departments(id);

CREATE INDEX cases_department_id_open_idx ON cases (department_id, status)
  WHERE department_id IS NOT NULL AND status NOT IN ('RESOLVED', 'CLOSED');

COMMIT;
