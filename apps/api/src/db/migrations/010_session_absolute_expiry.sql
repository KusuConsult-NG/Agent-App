-- =============================================================================
-- 010_session_absolute_expiry.sql — a session chain that actually ends
--
-- Refresh rotates the token and issues a fresh 14-day expiry each time, which
-- means a session held by whoever possesses the token never expires: refresh
-- often enough and it lives forever. That was tolerable while the refresh token
-- lived in sessionStorage and died when the app closed. It is not tolerable now
-- that agents stay signed in across app restarts, which requires persisting the
-- token on the device — a lost phone would otherwise carry a credential with no
-- end date.
--
-- So a session gets two clocks:
--
--   expires_at           the rolling one. Reset by each refresh; this is what
--                        lets a working agent stay signed in.
--   absolute_expires_at  the fixed one. Set once when the agent signs in with
--                        their password and carried unchanged through every
--                        rotation. No amount of refreshing moves it.
--
-- The second is the one that matters for a stolen device: the token dies on a
-- known date whether or not anyone reports the phone missing.
-- =============================================================================

ALTER TABLE sessions
  ADD COLUMN absolute_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN sessions.absolute_expires_at IS
  'When this session chain ends regardless of refreshes. Set at password '
  'sign-in and preserved across rotation, so possession of a refresh token is '
  'never a permanent credential.';

-- Existing sessions predate the column. Give them the bound they would have had
-- rather than leaving them unbounded, and rather than revoking sessions that
-- have done nothing wrong.
UPDATE sessions
   SET absolute_expires_at = issued_at + INTERVAL '30 days'
 WHERE absolute_expires_at IS NULL;

-- Nullable on purpose: a NULL is read as "no absolute bound" and the service
-- treats it as such, so a session created by an older API instance mid-deploy
-- keeps working instead of being refused by a column constraint.

CREATE INDEX idx_sessions_absolute_expiry
  ON sessions(absolute_expires_at)
  WHERE revoked_at IS NULL;
