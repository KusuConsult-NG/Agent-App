BEGIN;

/*
 * Retirement had no teeth.
 *
 * Migration 059 gave `roles` a status and `retireRole` sets it, but nothing
 * stopped the next officer being created into a retired role: the foreign key
 * asks whether the name exists, not whether anybody should still be given it.
 * So an administrator could retire `zonal_coordinator`, move its holders away,
 * and have a colleague post a new account straight back into it — the role
 * would carry whatever grants it had when it was retired, and the retirement
 * would read as done in the audit log.
 *
 * A rule that only holds when you go through the service layer is not an
 * invariant, and this one did not even hold there. It goes on the row.
 *
 * Only the transition is refused, not the state: accounts that already hold a
 * role when it is retired stay valid and readable, which is what makes the
 * "move them first" workflow possible at all. What cannot happen is an account
 * arriving in, or moving into, a role the organisation has closed.
 */
CREATE OR REPLACE FUNCTION a_retired_role_is_not_assigned() RETURNS TRIGGER AS $$
DECLARE
  role_status TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  SELECT status INTO role_status FROM roles WHERE name = NEW.role;
  IF role_status = 'RETIRED' THEN
    RAISE EXCEPTION 'the % role has been retired and cannot be assigned', NEW.role
      USING HINT = 'Choose a role that is still in use, or restore this one first.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_not_given_a_retired_role ON users;
CREATE TRIGGER users_not_given_a_retired_role
  BEFORE INSERT OR UPDATE OF role ON users
  FOR EACH ROW EXECUTE FUNCTION a_retired_role_is_not_assigned();

COMMIT;
