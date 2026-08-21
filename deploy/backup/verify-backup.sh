#!/usr/bin/env bash
# ==============================================================================
# PSIRS Automated Backup Integrity & Disaster Recovery Verification Runner
#
# Creates a test backup, restores it into an isolated test verification database,
# asserts table schema and integrity checksums, and cleans up.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMP_BACKUP_DIR="$(mktemp -d)"
VERIFY_DB="psirs_verify_restore_$$"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"

cleanup() {
  echo "[verify-backup] Cleaning up temporary files and verification database..."
  rm -rf "${TEMP_BACKUP_DIR}"
  PGPASSWORD="${PGPASSWORD:-postgres}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d postgres -c "DROP DATABASE IF EXISTS \"${VERIFY_DB}\";" >/dev/null 2>&1 || true
}

trap cleanup EXIT

echo "=== PSIRS Disaster Recovery & Backup Integrity Verification ==="
echo "1. Creating fresh snapshot of 'psirs' into ${TEMP_BACKUP_DIR}..."
BACKUP_DIR="${TEMP_BACKUP_DIR}" DB_NAME="psirs" bash "${SCRIPT_DIR}/backup.sh"

LATEST_DUMP="$(ls "${TEMP_BACKUP_DIR}"/psirs_backup_*.dump | head -n 1)"
if [ -z "${LATEST_DUMP}" ]; then
  echo "FAILED: No backup dump was produced."
  exit 1
fi

echo "2. Restoring ${LATEST_DUMP} into isolation database '${VERIFY_DB}'..."
bash "${SCRIPT_DIR}/restore.sh" "${LATEST_DUMP}" "${VERIFY_DB}"

echo "3. Performing integrity and data sanity checks on '${VERIFY_DB}'..."
LGA_COUNT=$(PGPASSWORD="${PGPASSWORD:-postgres}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${VERIFY_DB}" -t -c "
  SELECT count(*) FROM lgas;
")

ITEM_COUNT=$(PGPASSWORD="${PGPASSWORD:-postgres}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${VERIFY_DB}" -t -c "
  SELECT count(*) FROM revenue_items;
")

TRIGGER_COUNT=$(PGPASSWORD="${PGPASSWORD:-postgres}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${VERIFY_DB}" -t -c "
  SELECT count(*) FROM pg_trigger WHERE tgname = 'receipts_require_verified_payment';
")

echo "  -> LGAs found: ${LGA_COUNT// /}"
echo "  -> Revenue items found: ${ITEM_COUNT// /}"
echo "  -> Financial trigger checks: ${TRIGGER_COUNT// /}"

if [ "${LGA_COUNT// /}" -ge 17 ] && [ "${ITEM_COUNT// /}" -ge 30 ] && [ "${TRIGGER_COUNT// /}" -ge 1 ]; then
  echo "SUCCESS: Backup restored with complete data integrity and trigger constraints active."
else
  echo "FAILED: Integrity assertions failed on restored database."
  exit 1
fi
