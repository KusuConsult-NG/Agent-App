-- Refresh token rotation: make the successor recorded, so reuse is detectable.
--
-- Rotation revoked the old session and minted a new one, but nothing linked the
-- two. That left two things impossible to tell apart when a refresh token was
-- presented and refused:
--
--   * the session simply expired, and
--   * a token that had ALREADY been rotated was presented a second time.
--
-- The second is the signal that matters. A refresh token is a bearer credential
-- with a fortnight's life; if one is presented after it was already exchanged,
-- either a client retried a request whose response it never received, or a copy
-- of the token is in someone else's hands. Both were reported as "your session
-- has expired", so a stolen token produced no signal at all.
--
-- The link also lets a reuse revoke the chain that descends from the token,
-- which is the only way to end a session the legitimate holder never saw.

ALTER TABLE sessions
  ADD COLUMN rotated_to_session_id UUID REFERENCES sessions(id);

COMMENT ON COLUMN sessions.rotated_to_session_id IS
  'The session minted when this one''s refresh token was exchanged. Set only by rotation.';

-- Reuse detection walks forward from a revoked session to the live descendant.
CREATE INDEX idx_sessions_rotated_to ON sessions(rotated_to_session_id)
  WHERE rotated_to_session_id IS NOT NULL;

-- Rotation looks a session up by token hash on every refresh, and reuse
-- detection looks up an already-revoked one the same way. The UNIQUE constraint
-- on refresh_token_hash already indexes it, so no index is added here.
