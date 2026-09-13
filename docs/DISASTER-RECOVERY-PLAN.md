# Plateau State Revenue Platform — Disaster Recovery & Business Continuity Plan

**Document ID:** PSIRS-DRP-2026-V1  
**Target SLA:** Recovery Point Objective (RPO) $\le$ 15 minutes | Recovery Time Objective (RTO) $\le$ 2 hours  
**Applies to:** PostgreSQL Database, Revenue Engine API, Object Storage, and Field Synchronization Queue  

---

## 1. Overview & Objectives

This Disaster Recovery Plan (DRP) defines the procedures, roles, and automated tools required to maintain continuous operation and restore the Plateau State Digital Grassroots Revenue Platform in the event of database failure, data center outage, ransomware/tamper event, or cloud provider degradation.

The platform processes statutory government revenue and issues immutable digital receipts. Under **PRD §88**, no data loss exceeding 15 minutes of transactional history is acceptable.

---

## 2. Backup Architecture & Retention Policies

```
+--------------------------+       Continuous WAL Stream       +------------------------------+
| Primary PostgreSQL 16 DB | --------------------------------> | WAL Archive Storage          |
| (Docker / Bare Metal)    |                                   | (Local & S3 Private Bucket)  |
+--------------------------+                                   +------------------------------+
            |                                                                 |
            | Daily Base Snapshot (pg_dump custom format)                     | Point-in-Time Recovery
            v                                                                 v
+--------------------------+       Automated Integrity Check   +------------------------------+
| Daily .dump + SHA256     | --------------------------------> | Standby Verification Node    |
| (30-Day Local + Remote)  |                                   | (verify-backup.sh test run)  |
+--------------------------+                                   +------------------------------+
```

### 2.1 Backup Cadence

The diagram above is the target architecture. This section says which parts of
it this repository actually delivers, because a cadence stated as fact is read
as a cadence someone is keeping.

| Mechanism | What this repository does | What the deployment must still supply |
| :--- | :--- | :--- |
| **Base snapshot** (`pg_dump` compressed custom format) | `deploy/backup/backup.sh` takes one on demand and verifies it. The deploy workflow takes one before every migration, using the `apps/api/scripts` pair. | **A timer: daily at `02:00 UTC`.** Nothing here schedules one — no cron entry, no systemd timer, no scheduled workflow anywhere in the repository. |
| **Continuous WAL archiving** (`archive_command`) | Nothing. | `archive_command` on the production instance, with `archive_timeout = 300`, so a completed 16MB segment or five idle minutes reaches isolated storage. Five minutes, not fifteen: an archive timeout equal to the RPO spends the whole budget before the segment has moved. |
| **Cryptographic hashing** | Every snapshot writes a companion `.sha256`; `restore.sh` refuses a mismatch and says so out loud when the file is absent. | — |
| **Retention** | 30 days rolling on primary storage, pruned by `RETENTION_DAYS` in `backup.sh`. | 365 days in an immutable Glacier / compliance vault, as a **bucket lifecycle policy** — a compromised application host must not be able to delete history. |

**Until the timer and the `archive_command` exist, the RPO is not 15 minutes.**
It is however long ago somebody last ran the script by hand. The figure in this
document's header is the target the platform is built to and §1's reading of
PRD §88 is the requirement it has to meet; neither describes the deployment as
it stands. `DISASTER-RECOVERY.md` records the same three gaps in the same
terms.

### 2.2 What an archive taken before migration 079 contains

Treat every snapshot and every WAL segment produced before `079_a_credential_kept_after_it_was_delivered.sql` was applied as **credential-bearing**, and hold it to the same handling as the database itself.

Until 079, `notifications.message` held the rendered text of every message the
platform ever sent, and two of those carry a credential: the SMS containing a
one-time login code, and the SMS containing a referee's invitation link. Both
tables that own those credentials — `otp_codes` and `referee_invitations` —
store only a SHA-256 of them, deliberately, so the plaintext in the queue was
the only copy and it sat beside its own hash indefinitely. A one-line join
recovers it:

```sql
SELECT i.status, i.expires_at
  FROM notifications n
  JOIN referee_invitations i
    ON i.invitation_token_hash =
       encode(digest(substring(n.message from 'referee/([A-Za-z0-9_-]+)'), 'sha256'), 'hex')
 WHERE n.event = 'REFEREE_INVITATION';
```

One-time codes expire in minutes, so an old archive yields nothing usable
there. **Referee invitations last fourteen days**, which means any archive from
the last fortnight can still hold a working one: whoever holds the file can
answer a nomination in a referee's name, or decline it and pull a working
agent's clearance down. That is the concrete reason this section exists rather
than a general caution about backups.

The running database is no longer such a copy — 079 masks the credential out of
the rows already queued, and from 079 onward the deliverable text is carried in
`notifications.secret_message` and cleared the moment the gateway accepts it.
Restoring an older archive puts the plaintext back; run 079 over any database
restored from one before returning it to service, which the migration runner
does automatically as part of `npm run migrate`.

---

## 3. Step-by-Step Restoration & Failover Runbook

### Scenario A: Standalone Snapshot Restoration (Clean Server)
To restore the latest daily snapshot onto a freshly provisioned database instance:

```bash
# 0. Work from the repository checkout on THIS host. Every script path below
#    is relative to it, so this step is not optional.
cd "${PSIRS_REPO:?set PSIRS_REPO to the repository checkout on this host}"

# 1. Transfer backup and verify checksum
sha256sum -c /var/backups/psirs/psirs_backup_YYYYMMDD_HHMMSSZ.sha256

# 2. Run automated restore script
bash deploy/backup/restore.sh /var/backups/psirs/psirs_backup_YYYYMMDD_HHMMSSZ.dump psirs

# 3. Apply any pending database migrations
npm run migrate --workspace @psirs/api

# 4. Start the backend API engine
npm run dev:api # or docker compose up -d api
```

Step 0 read `cd /Users/mac/Agent-App` — a path that exists on one laptop.
Pasted on a recovery host it fails, the operator reads one "No such file or
directory" and moves on, and step 2 then fails with another: `bash:
deploy/backup/restore.sh: No such file or directory`, exit 127. Measured. The
restore script itself is fine — run from the checkout it restored the seeded
database and reported all eight financial tables — so the entire distance
between an operator and a working database was a directory name. Naming the
checkout in a variable that refuses to be empty is what keeps the failure at
step 0, where it is a typo, rather than at step 2, where it is an outage.

### Scenario B: Point-in-Time Recovery (PITR) to a Specific Minute
When recovering from an accidental administrative table drop or point-in-time corruption:

1. Stop the PostgreSQL instance:
   ```bash
   pg_ctl -D /var/lib/postgresql/data stop
   ```
2. Restore the latest clean base backup into the data directory.
3. Create `recovery.signal` and configure `postgresql.conf`:
   ```ini
   restore_command = 'cp /var/backups/psirs/wal_archive/%f %p'
   recovery_target_time = '2026-08-18 14:30:00 UTC'
   recovery_target_action = 'promote'
   ```
4. Start PostgreSQL and monitor the log until recovery target is reached and the database promotes to read-write.

---

## 4. Automated Backup Verification Protocol

Under PRD §88, a backup is not considered valid until it has been proven restorable.

The platform provides an automated verification runner:
```bash
bash deploy/backup/verify-backup.sh
```

**Verification Checklist Executed by Script:**
1. Generates a fresh compressed dump with SHA256 checksum.
2. Creates an ephemeral isolated PostgreSQL database `psirs_verify_restore_<PID>`.
3. Restores schema, table definitions, foreign keys, and indexes, failing the
   run if `pg_restore` reports an error or if any of the eight financial tables
   is absent from the restored database.
4. Asserts **at least 17 LGAs** and **at least 30 revenue catalogue items**
   (the seeded catalogue currently holds 42), and that the receipt control
   `receipts_require_verified_payment` is present on `receipts` and not
   disabled.
5. Drops the verification database and reports exit code 0.

**What step 4 does not do**, because a runbook that overstates its own checks
is worse than one that claims less. It asserts *one* named trigger, not every
trigger: an earlier version of this list named `prevent_delete` alongside it,
which is the name of a trigger *function* rather than of any trigger, and
nothing looks for it. It confirms that control is present and enabled; it does
not fire it. The forbidden-insert check that actually exercises a control lives
in `apps/api/scripts/restore.sh`.

---

## 5. Roles & Incident Escalation Matrix

| Role | Primary Contact | Responsibilities |
| :--- | :--- | :--- |
| **Lead DevOps Engineer** | System Admin | Executes failover runbook and provisions standby compute. |
| **Database Administrator (DBA)** | Lead DBA | Performs checksum verification, WAL replaying, and database promotion. |
| **PSIRS Finance Officer** | Finance Lead | Validates post-restore revenue ledger totals against bank settlement statement. |
| **PSIRS Executive Director** | Executive Management | Authorizes public communication and signs off on incident closure. |
