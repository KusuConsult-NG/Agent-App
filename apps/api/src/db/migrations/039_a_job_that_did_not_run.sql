-- Whether the unattended work actually ran.
--
-- Nine background jobs run with nobody watching: reminders before an invoice
-- lapses, retirement of the ones that did, refunds a taxpayer is still owed,
-- commission becoming payable, TINs chased after an outage, renewals the
-- vehicle authority never acknowledged, notifications, the fraud sweep, and
-- reconciliation.
--
-- Exactly one of them left a durable trace. `reconciliation_runs` exists
-- because reconciliation needs it for its own audit position, and it was
-- taught in the same pass as this to record a run that crashed. The other
-- eight recorded nothing at all: a job that ran and found nothing to do and a
-- job that never ran are the same absence of rows, which is precisely the
-- distinction somebody asking "are we still sending reminders?" needs.
--
-- WHAT THE ABSENCE COSTS. The platform goes on asserting things that rest on
-- machinery nobody can confirm is running. It expires an invoice whose owner
-- was never warned, because the expiry sweep and the reminder sweep fail
-- independently. It tells an agent they have no commission eligible for payout
-- when the promotion sweep is the only thing that would have made it eligible.
-- It leaves a refund PENDING, which reads identically to one the bank refused
-- this morning. Each of those is the platform saying something untrue about
-- money without any part of it being wrong.
--
-- WHY IN-PROCESS METRICS WERE NOT ENOUGH. The scheduler already sets Prometheus
-- gauges for last-run time and outcome. They reset when the process restarts,
-- and — worse in the topology the advisory lock exists for — they are set on
-- whichever replica won the lock. The other replicas skip quietly and record
-- nothing, so their gauges go stale while the job is running perfectly well
-- somewhere else. An alert on staleness therefore fires on N-1 replicas every
-- interval, which is how a monitor for the money controls gets switched off.
-- A row in the shared database has neither problem.
--
-- WHY ONE ROW PER JOB RATHER THAN A LOG. Notification dispatch ticks every
-- thirty seconds; an append-only log of every tick is a million rows a year
-- and a pruning policy to get wrong. The questions an operator actually has
-- are "is it running" and "is it healthy", and both are answered by current
-- state: when it last ran, when it last *succeeded* — which is the one that
-- separates a job failing since Tuesday from a job that is fine — and how many
-- times in a row it has failed since.

CREATE TABLE background_jobs (
  name                  TEXT PRIMARY KEY,
  last_started_at       TIMESTAMPTZ NOT NULL,
  last_finished_at      TIMESTAMPTZ,
  last_outcome          TEXT NOT NULL CHECK (last_outcome IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  last_detail           TEXT,
  last_duration_ms      INTEGER,
  -- Kept apart from last_finished_at on purpose. A job that has been throwing
  -- since Tuesday still has a recent finish; what it does not have is a recent
  -- success, and that is the reading that tells them apart.
  last_succeeded_at     TIMESTAMPTZ,
  last_failed_at        TIMESTAMPTZ,
  last_error            TEXT,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  runs_total            BIGINT NOT NULL DEFAULT 0,
  failures_total        BIGINT NOT NULL DEFAULT 0
);

COMMENT ON TABLE background_jobs IS
  'One row per background job, holding the state of its most recent run on any replica. '
  'The row is written by whichever instance held the advisory lock, so it is a '
  'cluster-wide answer rather than a per-process one.';

COMMENT ON COLUMN background_jobs.last_outcome IS
  'RUNNING is written before the work starts and replaced when it ends. A row left at '
  'RUNNING is not a bug in the recording — it is a job that began and never came back, '
  'which is the failure the recording exists to make visible.';

-- A run that never returned is counted as a failure by the run after it.
--
-- The advisory lock means one instance runs a given job at a time, so finding
-- the row still at RUNNING when the next run takes the lock is not a race: it
-- is evidence that the previous holder died mid-job — a pod evicted, a
-- container killed, a process out of memory. Nothing else would ever notice.
-- The next start therefore closes that run out as a failure before recording
-- its own, so the crash survives in the failure counters rather than being
-- overwritten by the first success after it.

-- A background job is not deleted when it is renamed or retired; the row is
-- left so the history of a job that used to run is not silently lost. Nothing
-- deletes from this table, so no index beyond the primary key is needed at
-- nine rows.
