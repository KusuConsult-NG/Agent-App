BEGIN;

/*
 * Three gaps the officer-readiness assessment found, and they share a shape:
 * the platform kept the fact and gave nobody a way to act on it.
 *
 * SESSIONS AN OFFICER CAN SEE
 *
 * `sessions` has held every sign-in since migration 001 -- device, address,
 * user agent, when it was last used. No officer could look at their own, and
 * no administrator could look at anybody's. `POST /auth/logout-all` was the
 * only control, which is all-or-nothing and belongs to the person who still
 * has the password. An officer who leaves a laptop at a counter had no way to
 * end that one session, and their supervisor had no way to see it existed.
 *
 * Nothing about the table needs to change for that; what it needs is a label a
 * person recognises, which is what `officer_devices` below is for.
 *
 * DEVICES
 *
 * Agents have a full handset lifecycle: registered, approved, bound,
 * revocable, and a revoked handset cannot collect. Officers have nothing --
 * and they should not have the same thing, because an officer's device is a
 * browser on a machine PSIRS often owns, and pre-approving one before an
 * officer can work would put a queue between an emergency and the person
 * handling it.
 *
 * What they do need is the half that matters when something goes wrong: a
 * record of the machines each officer has signed in from, and a way to cut one
 * off. So a device here is discovered rather than registered -- first sign-in
 * creates it -- and it can be blocked. A blocked device holds no session,
 * enforced below rather than in the sign-in service, because a laptop somebody
 * has walked off with is exactly the case where "the service checks" is not
 * good enough.
 *
 * EVIDENCE THAT DID NOT COME FROM HERE
 *
 * A case could only attach a document this platform issued: a receipt, an
 * invoice, vehicle papers. Most of what an investigation collects is not that
 * -- a bank advice a taxpayer hands over, a letter, a photograph of a stall --
 * and none of it could go on the file. It went into somebody's email instead,
 * which is to say it left the audit trail.
 *
 * These files are deliberately not `documents`. Every row in that table is
 * something PSIRS issued, with a verification code a citizen can check against
 * the register; a scan of a third party's letter is not, and filing it there
 * would make the verification endpoint able to affirm a document the State
 * never wrote.
 */

-- ---------------------------------------------------------------------------
-- Officer devices
-- ---------------------------------------------------------------------------

CREATE TABLE officer_devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  /*
   * A stable-enough handle for "the same browser on the same machine".
   *
   * Derived from the user agent and the client's own persisted identifier
   * rather than from an address, because an officer on a state network shares
   * an address with the whole building and an officer on a phone changes
   * theirs every few minutes. It is not an identity and is not treated as one:
   * it labels a session so a person can recognise which one to end.
   */
  fingerprint   TEXT NOT NULL,
  label         TEXT,
  user_agent    TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'BLOCKED')),
  blocked_at    TIMESTAMPTZ,
  blocked_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  block_reason  TEXT,
  UNIQUE (user_id, fingerprint),
  CONSTRAINT officer_device_block_is_explained CHECK (
    status <> 'BLOCKED' OR (blocked_at IS NOT NULL AND block_reason IS NOT NULL))
);

CREATE INDEX officer_devices_user_idx ON officer_devices (user_id, last_seen_at DESC);

CREATE TRIGGER officer_devices_no_delete BEFORE DELETE ON officer_devices
  FOR EACH ROW EXECUTE FUNCTION prevent_delete();

ALTER TABLE sessions ADD COLUMN officer_device_id UUID REFERENCES officer_devices(id);
CREATE INDEX sessions_device_idx ON sessions (officer_device_id) WHERE revoked_at IS NULL;

/*
 * A blocked device holds no session.
 *
 * On the row rather than in the sign-in service, for the reason the block
 * exists at all: the case it is for is a machine somebody else has, and a
 * control that only holds when the request goes through the service layer is
 * not a control against a laptop in a stranger's hands.
 *
 * Only the creation of a session is refused. Sessions already open on the
 * device are revoked by the same call that blocks it -- an UPDATE, which this
 * does not touch, so blocking never has to fight the trigger that enforces it.
 */
CREATE OR REPLACE FUNCTION a_blocked_device_holds_no_session() RETURNS TRIGGER AS $$
DECLARE
  device_status TEXT;
BEGIN
  IF NEW.officer_device_id IS NULL THEN RETURN NEW; END IF;

  SELECT status INTO device_status FROM officer_devices WHERE id = NEW.officer_device_id;
  IF device_status = 'BLOCKED' THEN
    RAISE EXCEPTION 'this device has been blocked and cannot hold a session'
      USING HINT = 'An administrator must unblock it before this officer can sign in here.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sessions_not_on_a_blocked_device ON sessions;
CREATE TRIGGER sessions_not_on_a_blocked_device
  BEFORE INSERT OR UPDATE OF officer_device_id ON sessions
  FOR EACH ROW EXECUTE FUNCTION a_blocked_device_holds_no_session();

-- ---------------------------------------------------------------------------
-- Evidence an officer uploads
-- ---------------------------------------------------------------------------

CREATE TABLE case_evidence_files (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           UUID NOT NULL REFERENCES cases(id) ON DELETE RESTRICT,
  original_filename TEXT NOT NULL,
  content_type      TEXT NOT NULL,
  byte_size         INTEGER NOT NULL CHECK (byte_size > 0),
  storage_reference TEXT NOT NULL,
  /*
   * SHA-256 of the bytes as received.
   *
   * The same guarantee migration 004 gives an issued document, for the same
   * reason and with more force: this file is the only copy of something that
   * came from outside, so "the bytes have not changed since the officer
   * uploaded them" is the whole of what makes it evidence.
   */
  checksum          TEXT NOT NULL,
  /* What it is, in the officer's words. Required: an unlabelled scan on a case
   * file is a thing the next reader has to open to find out about. */
  description       TEXT NOT NULL,
  /* Where it came from, which is the question an auditor asks of any document
   * the platform did not issue. */
  provenance        TEXT NOT NULL,
  uploaded_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT case_evidence_description_present CHECK (length(btrim(description)) > 0),
  CONSTRAINT case_evidence_provenance_present CHECK (length(btrim(provenance)) > 0)
);

CREATE INDEX case_evidence_files_case_idx ON case_evidence_files (case_id, uploaded_at DESC);

/*
 * Evidence is never deleted or altered.
 *
 * A file that can be swapped after the fact is not evidence of anything, and
 * the whole reason an investigation was collecting this outside the platform
 * was that there was nowhere to put it where that guarantee held.
 */
CREATE OR REPLACE FUNCTION evidence_is_not_rewritten() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'evidence attached to a case cannot be removed'
      USING HINT = 'Add a note to the case explaining why it should be disregarded.';
  END IF;
  RAISE EXCEPTION 'evidence attached to a case cannot be changed after it was uploaded'
    USING HINT = 'Upload the corrected file as a further piece of evidence.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS case_evidence_files_are_fixed ON case_evidence_files;
CREATE TRIGGER case_evidence_files_are_fixed
  BEFORE UPDATE OR DELETE ON case_evidence_files
  FOR EACH ROW EXECUTE FUNCTION evidence_is_not_rewritten();

/*
 * An EVIDENCE event now points at one of two things.
 *
 * A document PSIRS issued, or a file an officer uploaded -- exactly one, never
 * both and never neither, which the constraint says rather than leaving it to
 * whichever service happens to write the row.
 */
ALTER TABLE case_events
  ADD COLUMN evidence_file_id UUID REFERENCES case_evidence_files(id);

ALTER TABLE case_events DROP CONSTRAINT IF EXISTS case_event_evidence_has_document;
ALTER TABLE case_events ADD CONSTRAINT case_event_evidence_has_one_source CHECK (
  kind <> 'EVIDENCE'
  OR (document_id IS NOT NULL) <> (evidence_file_id IS NOT NULL));

COMMIT;
