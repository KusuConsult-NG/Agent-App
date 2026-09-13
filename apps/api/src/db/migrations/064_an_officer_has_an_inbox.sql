BEGIN;

/*
 * An inbox for officers, and alerts that come to them.
 *
 * WHAT WAS THERE, AND WHY IT WAS NOT ENOUGH
 *
 * `/my-work` gathers everything waiting for an officer -- assigned cases,
 * mentions, approvals, exceptions, flags -- and it does it by querying for
 * them each time. That is the right shape for a work queue: it is always
 * current, it cannot go stale, and nothing has to be cleaned up.
 *
 * It cannot do two things, and both were marked partial in the
 * officer-readiness assessment.
 *
 * It cannot record that somebody was *told*. A derived list has no read state,
 * so "I saw that on Tuesday and decided it was fine" is not expressible; the
 * item simply keeps appearing until the underlying thing changes, which trains
 * the officer to stop reading the list.
 *
 * And it cannot carry an alert that has no row behind it. A background job
 * that has stalled, an integration that stopped answering: these are facts
 * about the platform rather than about a case or an approval, and there was
 * nowhere to put one. `GET /government/workers` reported job health and an
 * officer had to go and look, which means somebody noticed the reminder sweep
 * had been dead for a day when a taxpayer asked why nobody had written.
 *
 * So this table is for things somebody was told, not things that are true. The
 * work queue keeps answering "what is waiting"; the inbox answers "what has
 * been raised, and did anybody look".
 */

CREATE TABLE officer_notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  /*
   * Addressed to a person, or to a role.
   *
   * A case assignment is for one officer. "The reminder sweep has not run for
   * six hours" is for whoever is on duty, and picking a name for it would mean
   * the alert goes unread whenever that person is on leave -- which is exactly
   * when nobody is watching. Exactly one of the two is set.
   */
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT REFERENCES roles(name) ON UPDATE CASCADE,

  /*
   * Every kind here is written by something. A first draft of this table also
   * had an INTEGRATION_ALERT, for an outside service that stopped answering --
   * which sounded useful and had nothing behind it, because
   * `integrationStatus()` reports which adapter is configured rather than
   * whether it is responding. A state the schema accepts and nothing produces
   * is a state no reader can rely on and no test can reach, and
   * `a-state-nothing-writes.test.ts` refuses one.
   */
  kind         TEXT NOT NULL CHECK (kind IN (
                 'CASE_ASSIGNED', 'CASE_MENTION', 'CASE_ESCALATED',
                 'APPROVAL_WAITING', 'SYSTEM_ALERT')),
  severity     TEXT NOT NULL DEFAULT 'INFO'
                 CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',

  /* What it is about, so the screen can offer a way in. */
  entity_type  TEXT,
  entity_id    TEXT,

  /*
   * The thing this notification is about, as a stable string.
   *
   * A job that has been failing for a day must produce one alert, not the
   * ninety-six the sweep would otherwise write. The partial unique index below
   * makes that a property of the table rather than a habit of the sweep: while
   * an alert about this subject is unread, a second cannot be created.
   */
  dedupe_key   TEXT NOT NULL,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at      TIMESTAMPTZ,
  read_by      UUID REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT officer_notification_has_one_addressee CHECK (
    (user_id IS NOT NULL) <> (role IS NOT NULL)),
  /* Who read it is recorded with when: a role-addressed alert marked read by
   * nobody in particular tells the next reader nothing. */
  CONSTRAINT officer_notification_read_is_attributed CHECK (
    (read_at IS NULL) = (read_by IS NULL))
);

CREATE INDEX officer_notifications_person_idx
  ON officer_notifications (user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX officer_notifications_role_idx
  ON officer_notifications (role, created_at DESC) WHERE role IS NOT NULL;

/*
 * One unread notification per subject, per addressee.
 *
 * Once it has been read, the same subject may raise a new one -- which is the
 * behaviour worth having: an officer who acknowledges "the settlement sweep is
 * failing" and does not fix it should be told again tomorrow, and an officer
 * who has not looked yet should not have ninety-six copies waiting.
 */
CREATE UNIQUE INDEX officer_notifications_one_unread_per_subject
  ON officer_notifications (COALESCE(user_id::text, role), dedupe_key)
  WHERE read_at IS NULL;

/*
 * Reading is the only thing that changes.
 *
 * A notification is a record that somebody was told something. Rewriting its
 * subject afterwards would make the record say they were told something else,
 * and deleting one would make an unwelcome alert disappear without trace --
 * which is precisely the alert worth keeping.
 */
CREATE OR REPLACE FUNCTION a_notification_is_only_read() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a notification cannot be deleted'
      USING HINT = 'Mark it read; the record that it was raised is the point.';
  END IF;

  IF NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.subject IS DISTINCT FROM OLD.subject
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.severity IS DISTINCT FROM OLD.severity
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'what a notification said, and to whom, cannot be changed';
  END IF;

  -- And read is not un-read. An officer who wants it back has the list.
  IF OLD.read_at IS NOT NULL AND NEW.read_at IS NULL THEN
    RAISE EXCEPTION 'a notification that has been read cannot be marked unread';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS officer_notifications_are_only_read ON officer_notifications;
CREATE TRIGGER officer_notifications_are_only_read
  BEFORE UPDATE OR DELETE ON officer_notifications
  FOR EACH ROW EXECUTE FUNCTION a_notification_is_only_read();

COMMIT;
