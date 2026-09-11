BEGIN;

/*
 * Whether the services this platform depends on are answering.
 *
 * `integrationStatus()` reports which adapter is *configured* -- the real TIN
 * service or the labelled mock -- which is a fact about deployment and says
 * nothing about whether the thing at the other end responded this morning. So
 * the officer-readiness assessment's "system alert (integration down)" had
 * nowhere to come from, and migration 064 removed an `INTEGRATION_ALERT`
 * notification kind rather than ship a state nothing could write.
 *
 * WHY THIS IS NOT A PROBE
 *
 * The obvious design is a job that calls each service every few minutes and
 * records what happened. It would be wrong here for two reasons. A synthetic
 * lookup against a government identity service is a real query about a real
 * person, on somebody's account, and running one every five minutes to see if
 * the line is up is not a thing a revenue authority should do. And a probe
 * measures the probe's path, which is not always the path the platform's own
 * calls take.
 *
 * Every adapter already distinguishes "we could not ask" from "the answer is
 * no" -- that distinction is the oldest design decision in
 * `integrations/index.ts`, and it exists precisely so an outage never becomes
 * a wrong fact in a register. This table is that signal, kept. Each outbound
 * call updates one row; the health of an integration is the shape of the real
 * traffic rather than an approximation of it.
 *
 * WHAT A ROW MEANS WHEN NOTHING HAS HAPPENED
 *
 * An integration nobody has called is not down. It is the same statement
 * `background_jobs` makes with NEVER_RUN, for the same reason: a fresh
 * deployment where every service reads as failing is a deployment whose alerts
 * everybody learns to ignore on the first morning.
 */

CREATE TABLE integration_health (
  name                TEXT PRIMARY KEY,
  /* Which adapter answered: the real service, or the labelled mock. A mock
   * answering perfectly is not the same news as the service answering. */
  provider            TEXT,
  last_called_at      TIMESTAMPTZ,
  last_succeeded_at   TIMESTAMPTZ,
  last_unavailable_at TIMESTAMPTZ,
  last_error          TEXT,
  /*
   * Reset by any answer at all, including an unwelcome one.
   *
   * "This taxpayer has no TIN" and "this account name does not match" are the
   * service working. Counting them as failures would put an integration into
   * alarm for doing its job, and would teach whoever reads the alerts that the
   * alerts are wrong.
   */
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  calls_total          BIGINT NOT NULL DEFAULT 0 CHECK (calls_total >= 0),
  unavailable_total    BIGINT NOT NULL DEFAULT 0 CHECK (unavailable_total >= 0),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT integration_unavailable_within_calls CHECK (unavailable_total <= calls_total)
);

/*
 * The counters only ever go up, and a row is never removed.
 *
 * An integration whose failure history can be edited is one whose history is
 * worth nothing in an incident review -- which is the only time anybody reads
 * it. Deleting the row would be the same thing more thoroughly: it would make
 * a service that has been failing all week look like one nobody has called.
 */
CREATE OR REPLACE FUNCTION integration_history_only_grows() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'the record of whether % answered cannot be deleted', OLD.name;
  END IF;

  IF NEW.name IS DISTINCT FROM OLD.name THEN
    RAISE EXCEPTION 'an integration health row cannot be renamed';
  END IF;
  IF NEW.calls_total < OLD.calls_total OR NEW.unavailable_total < OLD.unavailable_total THEN
    RAISE EXCEPTION 'integration call counts do not go backwards'
      USING HINT = 'A failure history that can be reduced is worth nothing in an incident review.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS integration_health_only_grows ON integration_health;
CREATE TRIGGER integration_health_only_grows
  BEFORE UPDATE OR DELETE ON integration_health
  FOR EACH ROW EXECUTE FUNCTION integration_history_only_grows();

/*
 * And the notification kind this makes reachable.
 *
 * Migration 064 wrote the kind list with `INTEGRATION_ALERT` in it, then took
 * it out before shipping because nothing could raise one -- a state the schema
 * accepts and nothing produces is a state no reader can rely on and no test
 * can reach. It comes back here, with the table above behind it.
 */
ALTER TABLE officer_notifications DROP CONSTRAINT IF EXISTS officer_notifications_kind_check;
ALTER TABLE officer_notifications ADD CONSTRAINT officer_notifications_kind_check
  CHECK (kind IN (
    'CASE_ASSIGNED', 'CASE_MENTION', 'CASE_ESCALATED',
    'APPROVAL_WAITING', 'SYSTEM_ALERT', 'INTEGRATION_ALERT'));

COMMIT;
