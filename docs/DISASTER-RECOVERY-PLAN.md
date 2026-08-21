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
- **Base Snapshot (`pg_dump` compressed custom format):** Daily at `02:00 UTC` via `deploy/backup/backup.sh`.
- **Continuous WAL Archiving (`archive_command`):** Every completed WAL segment (~16MB) or 15-minute archive timeout is streamed to isolated storage.
- **Cryptographic Hashing:** Every backup produces a companion `.sha256` checksum file to guarantee that images cannot be altered at rest.
- **Retention:** 30 days rolling on primary storage; 365 days rolling in immutable S3 Glacier / Compliance vault.

---

## 3. Step-by-Step Restoration & Failover Runbook

### Scenario A: Standalone Snapshot Restoration (Clean Server)
To restore the latest daily snapshot onto a freshly provisioned database instance:

```bash
# 1. Transfer backup and verify checksum
cd /Users/mac/Agent-App
sha256sum -c /var/backups/psirs/psirs_backup_YYYYMMDD_HHMMSSZ.sha256

# 2. Run automated restore script
bash deploy/backup/restore.sh /var/backups/psirs/psirs_backup_YYYYMMDD_HHMMSSZ.dump psirs

# 3. Apply any pending database migrations
npm run migrate --workspace @psirs/api

# 4. Start the backend API engine
npm run dev:api # or docker compose up -d api
```

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
3. Restores schema, table definitions, foreign keys, and indexes.
4. Asserts that all **17 LGAs**, **37 revenue catalogue items**, and all database triggers (`receipts_require_verified_payment`, `prevent_delete`) are active and enforcing rules.
5. Drops the verification database and reports exit code 0.

---

## 5. Roles & Incident Escalation Matrix

| Role | Primary Contact | Responsibilities |
| :--- | :--- | :--- |
| **Lead DevOps Engineer** | System Admin | Executes failover runbook and provisions standby compute. |
| **Database Administrator (DBA)** | Lead DBA | Performs checksum verification, WAL replaying, and database promotion. |
| **PSIRS Finance Officer** | Finance Lead | Validates post-restore revenue ledger totals against bank settlement statement. |
| **PSIRS Executive Director** | Executive Management | Authorizes public communication and signs off on incident closure. |
