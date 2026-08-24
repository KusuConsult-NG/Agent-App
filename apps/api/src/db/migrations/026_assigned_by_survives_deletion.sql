-- ---------------------------------------------------------------------------
-- 026: deleting an officer must not be blocked by an assignment they made
-- ---------------------------------------------------------------------------
-- Migration 023 gave `user_territories.assigned_by` a plain reference to
-- `users`, with no ON DELETE clause — so the default, RESTRICT, applied. The
-- comment there said the user side cascades, and that was true only of
-- `user_id`: an officer who had ever assigned a territory to somebody else
-- could not be removed at all, because their id was sitting in a column
-- nothing would release.
--
-- SET NULL rather than CASCADE, and the distinction matters. CASCADE would
-- delete the assignment — so removing a departed administrator would silently
-- revoke the coverage of every supervisor they had ever configured, and a
-- supervisor whose scope is empty sees nothing. The assignment is about the
-- supervisor, not about who typed it.
--
-- Losing the "who" costs nothing: `setOfficerTerritories` writes
-- `user.territories.change` to `audit_logs` with the actor on it, and that
-- record is hash-chained and append-only. `assigned_by` is a convenience for
-- a screen; the audit log is the evidence.
--
-- Found by the test suite, where `resetDatabase` deletes its fixture users
-- between files. The same constraint would have appeared in production the
-- first time anyone tried to remove an administrator who had done their job.

ALTER TABLE user_territories
  DROP CONSTRAINT user_territories_assigned_by_fkey;

ALTER TABLE user_territories
  ADD CONSTRAINT user_territories_assigned_by_fkey
    FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL;
