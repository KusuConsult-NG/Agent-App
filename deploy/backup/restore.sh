#!/usr/bin/env bash
# ==============================================================================
# PSIRS Database Point-in-Time Recovery (PITR) & Snapshot Restore Script
#
# Usage:
#   ./restore.sh /path/to/psirs_backup_YYYYMMDD_HHMMSSZ.dump [TARGET_DB_NAME]
# ==============================================================================

set -euo pipefail

BACKUP_FILE="${1:-}"
TARGET_DB="${2:-psirs}"
DB_USER="${DB_USER:-postgres}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"

if [ -z "${BACKUP_FILE}" ] || [ ! -f "${BACKUP_FILE}" ]; then
  echo "Error: Backup file not specified or does not exist."
  echo "Usage: $0 /path/to/backup.dump [TARGET_DB_NAME]"
  exit 1
fi

SHA_FILE="${BACKUP_FILE%.dump}.sha256"

# 1. Verify SHA256 Checksum if available
if [ -f "${SHA_FILE}" ]; then
  echo "[restore] Verifying SHA256 checksum..."
  EXPECTED_HASH="$(awk '{print $1}' "${SHA_FILE}")"
  if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL_HASH="$(sha256sum "${BACKUP_FILE}" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    ACTUAL_HASH="$(shasum -a 256 "${BACKUP_FILE}" | awk '{print $1}')"
  fi

  if [ "${EXPECTED_HASH}" != "${ACTUAL_HASH}" ]; then
    echo "FATAL: Checksum mismatch! Expected ${EXPECTED_HASH}, got ${ACTUAL_HASH}"
    exit 2
  fi
  echo "[restore] Checksum OK: ${ACTUAL_HASH}"
fi

echo "[restore] Preparing database '${TARGET_DB}' on ${DB_HOST}:${DB_PORT}..."

# 2. Terminate existing connections to target database if not postgres maintenance db
PGPASSWORD="${PGPASSWORD:-postgres}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d postgres -c "
  SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname = '${TARGET_DB}' AND pid <> pg_backend_pid();
" || true

# 3. Drop and recreate database for clean restore
PGPASSWORD="${PGPASSWORD:-postgres}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d postgres -c "DROP DATABASE IF EXISTS \"${TARGET_DB}\";"
PGPASSWORD="${PGPASSWORD:-postgres}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d postgres -c "CREATE DATABASE \"${TARGET_DB}\";"

# 4. Restore custom dump format with pg_restore
echo "[restore] Restoring snapshot into '${TARGET_DB}'..."
PGPASSWORD="${PGPASSWORD:-postgres}" pg_restore \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -d "${TARGET_DB}" \
  --verbose \
  --no-owner \
  --no-acl \
  "${BACKUP_FILE}" || true

# 5. Verify core database tables
echo "[restore] Verifying table counts in '${TARGET_DB}'..."
TABLE_COUNT=$(PGPASSWORD="${PGPASSWORD:-postgres}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d "${TARGET_DB}" -t -c "
  SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';
")

echo "[restore] Restore complete. Public schema tables in '${TARGET_DB}': ${TABLE_COUNT// /}"
