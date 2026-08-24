-- ---------------------------------------------------------------------------
-- 024: product usage analytics
-- ---------------------------------------------------------------------------
-- The platform knew what money had moved and who had touched which record, and
-- nothing at all about the interface. Which screens agents reach, where a
-- registration is abandoned, how long a collection takes on a handset in a
-- market, whether anybody switches to Hausa — none of it was recorded
-- anywhere. A team building for the grassroots had no way to tell whether the
-- grassroots could use the software.
--
-- THIS IS NOT audit_logs, AND MUST NOT BECOME IT. That table is evidence:
-- hash-chained, append-only, tied to a person and a record. This one is
-- operational telemetry: aggregate, disposable, expired on a schedule, about
-- the software rather than about a transaction. It is listed as deliberately
-- mutable in schema-audit.test.ts for exactly that reason — and the same
-- reasoning says identity must not be in it.
--
-- NO IDENTITY, BY CONSTRUCTION. There is no user_id column, no agent_id, no
-- taxpayer_id, no phone and no TIN, and this is a deliberate absence rather
-- than an oversight. Agents here are paid on commission and screened for
-- fraud; per-person interface surveillance layered on top of that is a
-- different thing from finding out whether a form is too long, and only the
-- second is being built. `role` is stored because a supervisor and an agent
-- use different software, and it is a category with hundreds of members.
--
-- WHY lga_id AND NOT ward_id. The most actionable question this table can
-- answer is whether the platform works worse in rural areas than in Jos, which
-- needs geography — and the LGA is the coarsest unit that can answer it. Ward
-- would be fine-grained enough that one agent's afternoon becomes
-- identifiable. Even at LGA level, aggregate queries suppress groups smaller
-- than USAGE_MIN_GROUP_SIZE rather than publishing them.
--
-- WHY flow_id IS NOT A FOREIGN KEY TO ANYTHING. It groups the steps of one
-- attempt so a funnel can be drawn. It is generated on the device, per
-- attempt, and points at nothing: it says "these three rows are one
-- registration", not "these rows are this person". Making it reference a
-- taxpayer or a transaction would quietly turn this table into a record of
-- who did what, which is the thing it must not be.
--
-- RETENTION. Raw rows are a means to an aggregate, not a record to keep. The
-- expiry job deletes anything past the window; the aggregates a screen reads
-- are computed from what is left. Nothing downstream depends on a row from
-- last year still existing.

CREATE TABLE usage_events (
  id           BIGSERIAL PRIMARY KEY,
  -- When it happened on the device, which for an offline queue is not when it
  -- arrived. Both are kept: the gap between them is itself a measurement of
  -- how long agents spend disconnected.
  occurred_at  TIMESTAMPTZ NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  surface      TEXT NOT NULL CHECK (surface IN ('AGENT_PWA', 'PORTAL')),
  event        TEXT NOT NULL,
  role         TEXT,
  flow_id      UUID,
  step         TEXT CHECK (step IS NULL OR length(step) <= 64),
  outcome      TEXT CHECK (outcome IS NULL OR outcome IN
                 ('STARTED', 'COMPLETED', 'ABANDONED', 'FAILED')),
  duration_ms  INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  app_version  TEXT,
  language     TEXT CHECK (language IS NULL OR language IN ('en', 'ha')),
  connection   TEXT CHECK (connection IS NULL OR connection IN ('ONLINE', 'LIMITED', 'OFFLINE')),
  lga_id       UUID REFERENCES lgas(id)
);

-- The three shapes every aggregate uses: a window of time, one event's funnel,
-- and one attempt's steps.
CREATE INDEX idx_usage_events_occurred ON usage_events(occurred_at DESC);
CREATE INDEX idx_usage_events_event ON usage_events(event, outcome, occurred_at DESC);
CREATE INDEX idx_usage_events_flow ON usage_events(flow_id) WHERE flow_id IS NOT NULL;

COMMENT ON TABLE usage_events IS
  'Product usage telemetry. Carries no identity by design and is not evidence: '
  'see audit_logs for who did what. Expired on a schedule.';

COMMENT ON COLUMN usage_events.flow_id IS
  'Groups the steps of one attempt. Device-generated, references nothing.';
