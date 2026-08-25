-- Serve the fraud guards after CONFIRMED became a blocking state.
--
-- `idx_fraud_open` is partial: WHERE status IN ('OPEN','UNDER_REVIEW'). Both
-- guards that consult a flag now also block on CONFIRMED, and both match on
-- `agent_id` rather than only on entity_type = 'AGENT', so neither can use it
-- any more.
--
-- That matters most in `promoteEligibleCommissions`, which evaluates a NOT
-- EXISTS against this table once per candidate commission on a scheduled sweep
-- over every settled transaction whose hold period has elapsed. Without an
-- index the sweep degrades with the number of flags ever raised, which only
-- ever grows.
--
-- The old index is kept: the dashboards still count open flags and it is the
-- narrower thing for that.
CREATE INDEX IF NOT EXISTS idx_fraud_flags_agent_blocking
    ON fraud_flags (agent_id, severity)
 WHERE status IN ('OPEN', 'UNDER_REVIEW', 'CONFIRMED');

CREATE INDEX IF NOT EXISTS idx_fraud_flags_transaction_blocking
    ON fraud_flags (transaction_id, severity)
 WHERE status IN ('OPEN', 'UNDER_REVIEW', 'CONFIRMED');
