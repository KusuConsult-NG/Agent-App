-- Push subscriptions, kept where every other record is kept.
--
-- They lived in a module-level Map. Three consequences, none of them visible
-- while web push delivery is unimplemented, and all of them waiting for the
-- person who implements it:
--
--   * every subscription was lost on restart, so a fleet of handsets would have
--     silently stopped receiving anything after a routine deploy, with nothing
--     to look at that would say so;
--   * in the multi-replica topology the advisory locks exist for, a handset
--     that subscribed through one replica was unknown to the others, so
--     delivery depended on which instance handled the send;
--   * nothing could be audited, revoked centrally, or counted.
--
-- A push subscription identifies a device with a person, which makes it the
-- same class of record as a session or a registered handset, and those live in
-- the database.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT,
  auth_secret  TEXT,
  user_id      UUID REFERENCES users(id),
  agent_id     UUID REFERENCES agents(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sent_at TIMESTAMPTZ,
  -- Set when the push service says the endpoint is gone. Kept rather than
  -- deleted so a device that unsubscribes and resubscribes is one row with a
  -- history, and so a sudden mass expiry is visible rather than silent.
  expired_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions(user_id) WHERE expired_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_agent
  ON push_subscriptions(agent_id) WHERE expired_at IS NULL;

COMMENT ON TABLE push_subscriptions IS
  'Browser push endpoints, one per device. Deliberately mutable: this is current '
  'state, not evidence. A row is expired rather than deleted when the push service '
  'reports the endpoint gone.';
