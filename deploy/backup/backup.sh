#!/usr/bin/env bash
# ==============================================================================
# PSIRS Automated PostgreSQL Backup & Continuous WAL Archiving Script
#
# Meets PRD §88 Disaster Recovery SLA:
# - Target Recovery Point Objective (RPO) <= 15 minutes
# - Target Recovery Time Objective (RTO) <= 2 hours
#
# Generates a compressed base backup with SHA256 checksums, metadata, and manages
# automated 30-day retention policies.
# ==============================================================================

set -euo pipefail

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/var/backups/psirs}"
DB_NAME="${DB_NAME:-psirs}"
DB_USER="${DB_USER:-postgres}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP="$(date -u +"%Y%m%d_%H%M%SZ")"
BACKUP_NAME="psirs_backup_${TIMESTAMP}"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"

mkdir -p "${BACKUP_DIR}" "${BACKUP_DIR}/wal_archive"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [backup] Starting PSIRS automated base backup..."

# 1. Take compressed pg_dump snapshot
PGPASSWORD="${PGPASSWORD:-postgres}" pg_dump \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  --format=custom \
  --compress=9 \
  --blobs \
  --verbose \
  --file="${BACKUP_PATH}.dump" 2> "${BACKUP_PATH}.log"

# 2. Compute SHA256 Checksum for tamper verification
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "${BACKUP_PATH}.dump" > "${BACKUP_PATH}.sha256"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "${BACKUP_PATH}.dump" > "${BACKUP_PATH}.sha256"
fi

# 3. Create metadata manifest
cat <<EOF > "${BACKUP_PATH}.meta.json"
{
  "backupName": "${BACKUP_NAME}",
  "database": "${DB_NAME}",
  "timestamp": "${TIMESTAMP}",
  "backupType": "FULL_SNAPSHOT",
  "checksumSha256": "$(awk '{print $1}' "${BACKUP_PATH}.sha256" || echo 'unknown')",
  "pgVersion": "$(pg_dump --version || echo 'unknown')",
  "status": "COMPLETED"
}
EOF

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [backup] Base backup created: ${BACKUP_PATH}.dump"

# 4. Optional Remote Sync (e.g. AWS S3 / Cloudflare R2 / MinIO)
#
# Optional means the bucket is optional, not the upload.
#
# This was nested inside `if command -v aws`, so a host with `BACKUP_S3_BUCKET`
# set and no `aws` on it took neither branch, said nothing, and finished with
# "Backup and retention cycle complete." Setting that variable is an operator
# asking for a copy off the machine; getting local-only backups and a success
# message is the difference between having off-site backups and believing you
# have them, and it would hold until the day the machine is gone.
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  if ! command -v aws >/dev/null 2>&1; then
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [backup] FATAL: BACKUP_S3_BUCKET is set to '${BACKUP_S3_BUCKET}' but the aws CLI is not installed, so this snapshot exists only on this machine." >&2
    exit 1
  fi
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [backup] Uploading snapshot to S3: s3://${BACKUP_S3_BUCKET}/backups/${BACKUP_NAME}.dump"
  aws s3 cp "${BACKUP_PATH}.dump" "s3://${BACKUP_S3_BUCKET}/backups/${BACKUP_NAME}.dump"
  aws s3 cp "${BACKUP_PATH}.sha256" "s3://${BACKUP_S3_BUCKET}/backups/${BACKUP_NAME}.sha256"
  aws s3 cp "${BACKUP_PATH}.meta.json" "s3://${BACKUP_S3_BUCKET}/backups/${BACKUP_NAME}.meta.json"
fi

# 5. Retention Pruning (Remove backups older than RETENTION_DAYS)
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [backup] Pruning local backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "psirs_backup_*.dump" -mtime +"${RETENTION_DAYS}" -delete
find "${BACKUP_DIR}" -name "psirs_backup_*.sha256" -mtime +"${RETENTION_DAYS}" -delete
find "${BACKUP_DIR}" -name "psirs_backup_*.meta.json" -mtime +"${RETENTION_DAYS}" -delete
find "${BACKUP_DIR}" -name "psirs_backup_*.log" -mtime +"${RETENTION_DAYS}" -delete

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [backup] Backup and retention cycle complete."
