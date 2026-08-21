# Backup and disaster recovery

A backup nobody has restored is a rumour. This document describes what is
backed up, how to get it back, and the restoration test that was actually
performed rather than merely planned.

## What is at stake

Losing this database loses every receipt the government has issued, every
transaction, every commission owed to an agent, and the audit trail that
answers a dispute. None of it is reconstructible from elsewhere: the receipt a
citizen holds is a claim, and `receipts` is the only record that can confirm it.

The documents in object storage matter almost as much. A receipt row without
its PDF is still provable — the row carries the amount, the taxpayer, the
verification code — but the citizen's copy is gone.

## Targets

| Objective | Target | How it is met |
|---|---|---|
| RPO — data loss window | ≤ 15 minutes | Continuous WAL archiving; see *Point-in-time recovery* |
| RTO — time to serve again | ≤ 2 hours | Restore from the most recent dump, then replay WAL |
| Backup retention | 35 days | Bucket lifecycle policy, not application logic |
| Restore rehearsal | Quarterly | `scripts/restore.sh` into a scratch database |

These are the values the platform is built to. **They must be confirmed with
Plateau State government IT before go-live** — an RPO is a business decision
about how much revenue data may be lost, not an engineering preference.

## What is backed up

| Asset | Mechanism | Frequency |
|---|---|---|
| PostgreSQL database | `scripts/backup.sh` (`pg_dump -Fc`) | Hourly |
| PostgreSQL WAL | `archive_command` to object storage | Continuous |
| Receipt / KYC / renewal documents | Object storage versioning + cross-region replication | Continuous |
| Configuration and secrets | Secret manager, versioned | On change |

Configuration is deliberately *not* in the database dump. Secrets belong in a
secret manager where they are versioned and access-audited separately, and a
database dump that carried them would turn every backup into a credential
store.

## Taking a backup

```bash
DATABASE_URL=postgres://…/psirs \
BACKUP_DIR=/var/backups/psirs \
BACKUP_UPLOAD=s3 \
BACKUP_S3_URI=s3://psirs-backups/postgres \
  apps/api/scripts/backup.sh
```

The script does three things, and the middle one is the point:

1. **Dump** in custom format, compressed, without owner or privilege
   statements so it restores into a differently-named role.
2. **Verify** by reading the archive's table of contents back with
   `pg_restore --list`, and confirming it contains table data for
   `transactions`, `payments`, `receipts`, `commissions`, `audit_logs` and
   `taxpayers`. `pg_dump` exits 0 on archives `pg_restore` cannot read; a
   corrupt archive discovered during an incident is worse than no archive,
   because the incident plan assumed it existed.
3. **Record** a manifest beside the archive with its SHA-256, which
   `restore.sh` checks before it restores anything.

Without `BACKUP_UPLOAD` the script says plainly that the dump is local only and
therefore not a backup. A copy on the same host as the database does not
survive the failure it exists for.

## Restoring

```bash
RESTORE_TARGET_URL=postgres://…/psirs_restored \
RESTORE_DROP=yes \
  apps/api/scripts/restore.sh /var/backups/psirs/psirs-20260821T073402Z.dump
```

The script refuses to proceed on a checksum mismatch, restores with
`--exit-on-error` — a restore that logged errors and carried on is how a
database ends up missing exactly the constraint that mattered — and then
verifies three things:

- every financial table is present, with its row count reported;
- the integrity triggers on the financial tables came back;
- **the central control still fires**, by attempting an insert of a receipt
  with no verified payment and requiring the database to refuse it.

That last check is the difference between "the rows are back" and "the platform
is back". On this platform the controls *are* the schema: a receipt cannot
exist for an unverified payment because a trigger refuses it. A restore that
brought the tables but not the triggers would look like a successful recovery
and would leave a revenue platform with no controls at all.

## Point-in-time recovery

Hourly dumps alone give an RPO of one hour, which is worse than the target. WAL
archiving closes the gap:

```
# postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'aws s3 cp %p s3://psirs-backups/wal/%f --only-show-errors'
archive_timeout = 300      # force a segment every 5 minutes even when idle
```

To recover to a moment just before an incident, restore the last base backup
and then replay WAL up to that point:

```
# postgresql.conf on the recovery instance
restore_command = 'aws s3 cp s3://psirs-backups/wal/%f %p'
recovery_target_time = '2026-08-21 09:14:00+01'
recovery_target_action = 'promote'
```

`archive_timeout = 300` is what actually delivers the 15-minute RPO: without
it, a quiet period leaves the last partial segment unarchived for as long as it
takes to fill.

## Recovery runbook

1. **Declare.** Name an incident lead. Everything below is theirs to sequence.
2. **Stop writes.** Scale the API to zero replicas. A half-available platform
   taking payments it cannot record is worse than one that is plainly down.
3. **Assess.** Is this corruption, deletion, or hardware loss? Corruption and
   deletion need point-in-time recovery to just before the event; hardware loss
   needs the latest backup.
4. **Provision** a fresh PostgreSQL instance of the same major version.
5. **Restore** with `scripts/restore.sh`, which verifies as it goes. Do not skip
   its output: the trigger count and the control check are the acceptance
   criteria, not the exit code alone.
6. **Replay WAL** to the chosen target time, if this is a point-in-time
   recovery.
7. **Reconcile before reopening.** Point the API at the restored database with
   `RUN_MIGRATIONS_ON_BOOT=false`, then run a reconciliation sweep over the
   window from the recovery point to now:
   `POST /api/v1/government/reconciliation/run`. Any payment the gateway
   confirmed but the restored database never recorded appears as an exception
   and is recovered by `POST /api/v1/government/reconciliation/recover`.
   **This step is what makes an RPO gap survivable**: the gateway is a second
   record of every payment, so money taken during the lost window can be found
   and receipted rather than silently dropped.
8. **Verify** a known receipt end to end: fetch it through
   `GET /api/v1/verify/:code` and confirm it reports `VALID`.
9. **Reopen.** Scale the API back up. Watch `psirs_open_reconciliation_exceptions`
   and `psirs_unverified_payments_over_1h`.
10. **Write it up.** What was lost, what was recovered, and which taxpayers need
    contacting.

## Restoration test — performed 21 August 2026

Not a plan. This was run against PostgreSQL 16.13.

**Setup.** A database seeded with reference data and walked through the full
clearance pipeline, then one complete revenue collection driven to a verified
payment: taxpayer registered, assessment raised, invoice issued, payment
initiated, gateway confirmed, receipt `PSIRS/2026/000001` issued for 20,000
kobo with verification code `637UK-VG6HG`, commission accrued, 14 audit rows.

**Backup.** `backup.sh` produced a 326,389-byte archive, verified readable, with
table data present for all six financial tables.

**Destruction.** `DROP DATABASE psirs_dr`. Confirmed absent from `pg_database`.

**Restore.** `restore.sh` into a freshly created empty database.

**Result — verified independently of the script's own output:**

| Check | Outcome |
|---|---|
| Receipt number, amount, verification code | `PSIRS/2026/000001 \| 20000 \| 637UK-VG6HG` — identical |
| Row counts | transactions 1, payments 1, receipts 1, commissions 1, invoices 1, taxpayers 1, agents 1 |
| Audit trail | 14 rows, all 14 distinct actions present |
| Integrity triggers on financial tables | 16 |
| Central control after restore | A forged receipt was **refused**: *"Receipt amount (999999 kobo) does not match verified payment amount (20000 kobo)"* |

The last row is the one that matters. The restored database did not merely
contain the data — it still enforced the rule that makes the data trustworthy.

## What is still outstanding

The scripts and the procedure are proven. Three things remain, and all three
are deployment tasks that need infrastructure this repository does not own:

- **Scheduled execution.** `backup.sh` is not yet on a timer anywhere. It needs
  a cron entry or scheduled job in the deployment environment.
- **Offsite destination.** `BACKUP_UPLOAD=s3` and a bucket with a 35-day
  lifecycle policy and versioning, in a region separate from the database.
- **WAL archiving.** The `archive_command` above needs to be set on the
  production instance, which means the production instance needs to exist.

Until those three are done the RPO is "whenever someone last ran the script",
which is not a number anyone should accept.
