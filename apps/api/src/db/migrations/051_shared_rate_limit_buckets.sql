-- A rate limit that holds across instances.
--
-- The limiter kept its buckets in a process-local Map, which is a correct
-- limiter for one process and N times the configured maximum for N of them.
-- Account lockout — the control that actually stops credential stuffing — is
-- already database-backed, so the leak was bounded; but a cap advertised in
-- `x-ratelimit-limit` that the platform does not actually enforce is a lie
-- told to every caller, and the public surfaces this guards (TIN enumeration,
-- receipt-code guessing, application farming) are exactly where the second
-- instance doubles the attacker's budget.
--
-- One row per key per window. `reset_at` carries the window's end rather than
-- its start so expiry is a comparison against now() and needs no interval
-- arithmetic at read time.

BEGIN;

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key       text        PRIMARY KEY,
  count     integer     NOT NULL DEFAULT 0 CHECK (count >= 0),
  reset_at  timestamptz NOT NULL
);

-- The sweep deletes by expiry, and it is the only query that does not go
-- through the primary key.
CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_reset_at
  ON rate_limit_buckets (reset_at);

COMMIT;
