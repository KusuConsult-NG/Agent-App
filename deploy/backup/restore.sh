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
else
  # Said out loud, because the alternative is an operator believing the archive
  # was checked. A `.sha256` that failed to come down with the dump is exactly
  # the case where the dump is most likely to be the truncated one.
  echo "[restore] WARNING: no ${SHA_FILE##*/} beside the archive — restoring WITHOUT an integrity check."
fi

# 2. Read the archive's table of contents before destroying anything.
#
# Step 3 drops the target database. Until this check existed, an archive that
# was corrupt or truncated — an interrupted download from object storage is the
# ordinary way that happens — was discovered only after the drop, so the
# failure mode was "the database is gone and the replacement will not load".
# `pg_restore --list` reads the archive header and index and touches no
# database, so a bad archive is refused while the existing one is still there.
echo "[restore] Reading the archive's table of contents..."
if ! pg_restore --list "${BACKUP_FILE}" >/dev/null 2>"${BACKUP_FILE}.toc.err"; then
  echo "FATAL: ${BACKUP_FILE} is not a readable pg_dump archive. Nothing has been changed."
  sed 's/^/  /' "${BACKUP_FILE}.toc.err" >&2 || true
  rm -f "${BACKUP_FILE}.toc.err"
  exit 2
fi
rm -f "${BACKUP_FILE}.toc.err"

echo "[restore] Preparing database '${TARGET_DB}' on ${DB_HOST}:${DB_PORT}..."

# 3. Terminate existing connections to target database if not postgres maintenance db
PGPASSWORD="${PGPASSWORD:-postgres}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d postgres -c "
  SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname = '${TARGET_DB}' AND pid <> pg_backend_pid();
" || true

# 4. Drop and recreate database for clean restore
PGPASSWORD="${PGPASSWORD:-postgres}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d postgres -c "DROP DATABASE IF EXISTS \"${TARGET_DB}\";"
PGPASSWORD="${PGPASSWORD:-postgres}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d postgres -c "CREATE DATABASE \"${TARGET_DB}\";"

# 5. Restore custom dump format with pg_restore
#
# `--exit-on-error`, and the status is acted on.
#
# This read `|| true`, so pg_restore's verdict was discarded entirely and step
# 6 ran regardless. Demonstrated against a truncated archive: pg_restore
# reported "could not read from input file: end of file", and this script
# printed "Restore complete. Public schema tables: 0" and exited 0 — having
# already dropped the database it was supposed to be replacing. The sibling
# script `apps/api/scripts/restore.sh` states the rule this now follows: "a
# restore that logged errors and carried on is how a database ends up missing
# exactly the constraint that mattered."
echo "[restore] Restoring snapshot into '${TARGET_DB}'..."
if ! PGPASSWORD="${PGPASSWORD:-postgres}" pg_restore \
  -h "${DB_HOST}" \
  -p "${DB_PORT}" \
  -U "${DB_USER}" \
  -d "${TARGET_DB}" \
  --verbose \
  --no-owner \
  --no-acl \
  --exit-on-error \
  "${BACKUP_FILE}"; then
  echo "FATAL: pg_restore failed. '${TARGET_DB}' is NOT a usable restore — do not put it into service."
  exit 2
fi

# 6. Prove the restored database holds the platform, not merely some tables.
#
# This counted rows in `information_schema.tables` and printed the number,
# comparing it to nothing, so every possible outcome — including zero — was
# reported as "Restore complete". A count is not an assertion. The tables below
# are the ones a revenue authority cannot operate without, and a missing one
# fails the restore rather than being printed past.
echo "[restore] Verifying the restored database in '${TARGET_DB}'..."
for TABLE in transactions payments receipts commissions audit_logs taxpayers agents invoices; do
  if ! ROWS=$(PGPASSWORD="${PGPASSWORD:-postgres}" psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" \
      -d "${TARGET_DB}" -t -A -c "SELECT count(*) FROM ${TABLE};" 2>/dev/null); then
    echo "FATAL: table '${TABLE}' is missing from the restored database."
    exit 3
  fi
  printf '  %-14s %s rows\n' "${TABLE}" "${ROWS}"
done

echo "[restore] Restore complete and verified: '${TARGET_DB}' holds every financial table."
