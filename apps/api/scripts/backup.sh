#!/usr/bin/env bash
#
# Take a backup of the revenue database, verify it, and put it somewhere the
# loss of this machine cannot reach.
#
# A backup nobody has restored is a rumour. This script therefore does three
# things rather than one: it dumps, it verifies the dump can be read back, and
# it records what it did in a manifest that restore.sh checks. The verification
# is the point — pg_dump exits 0 on a dump that pg_restore cannot list, and a
# corrupt archive discovered during an incident is worse than no archive,
# because the incident plan assumed it existed.
#
# Usage:
#   backup.sh                      # dump to $BACKUP_DIR
#   BACKUP_UPLOAD=s3 backup.sh     # dump, then upload with the configured CLI
#
# Environment:
#   DATABASE_URL        required; the database to dump
#   BACKUP_DIR          where dumps are written (default ./backups)
#   BACKUP_RETAIN_DAYS  local dumps older than this are removed (default 7)
#   BACKUP_UPLOAD       "s3" to push offsite; anything else keeps it local
#   BACKUP_S3_URI       e.g. s3://psirs-backups/postgres — required when uploading
#
# Exit codes: 0 success, 1 configuration error, 2 dump failed, 3 verify failed.

set -Eeuo pipefail

fail() { echo "backup: $1" >&2; exit "${2:-1}"; }

[[ -n "${DATABASE_URL:-}" ]] || fail "DATABASE_URL is not set"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-7}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="${BACKUP_DIR}/psirs-${STAMP}.dump"
MANIFEST="${ARCHIVE}.manifest.json"

mkdir -p "$BACKUP_DIR"

# --- dump ---------------------------------------------------------------
#
# Custom format (-Fc): compressed, and restorable selectively, which matters
# when recovering one table rather than the whole database. --no-owner and
# --no-privileges so the dump restores into a differently-named role, which is
# what a recovery into a fresh environment always needs.
echo "backup: dumping to ${ARCHIVE}"
pg_dump \
  --dbname="$DATABASE_URL" \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-privileges \
  --file="$ARCHIVE" \
  || fail "pg_dump failed" 2

BYTES="$(stat -c%s "$ARCHIVE" 2>/dev/null || stat -f%z "$ARCHIVE")"
[[ "$BYTES" -gt 0 ]] || fail "dump is empty" 2

# --- verify -------------------------------------------------------------
#
# Read the archive's table of contents back. This is what catches a truncated
# or corrupt dump now, rather than during an incident.
echo "backup: verifying archive is readable"
TOC="$(pg_restore --list "$ARCHIVE" 2>/dev/null)" || fail "archive is not readable by pg_restore" 3

# The financial tables are the reason this platform exists. An archive that
# restores but is missing them is not a backup of anything that matters.
for table in transactions payments receipts commissions audit_logs taxpayers; do
  grep -qE "TABLE DATA public ${table}\b" <<<"$TOC" \
    || fail "archive does not contain table data for '${table}'" 3
done

CHECKSUM="$(sha256sum "$ARCHIVE" | cut -d' ' -f1)"

cat >"$MANIFEST" <<JSON
{
  "archive": "$(basename "$ARCHIVE")",
  "takenAt": "${STAMP}",
  "bytes": ${BYTES},
  "sha256": "${CHECKSUM}",
  "pgDumpVersion": "$(pg_dump --version | head -1)",
  "verified": true
}
JSON

echo "backup: ${ARCHIVE} (${BYTES} bytes, sha256 ${CHECKSUM:0:12})"

# --- offsite ------------------------------------------------------------
#
# A backup on the same host as the database is not a backup. This step is
# opt-in only so the script is testable without cloud credentials; production
# must set BACKUP_UPLOAD.
if [[ "${BACKUP_UPLOAD:-}" == "s3" ]]; then
  [[ -n "${BACKUP_S3_URI:-}" ]] || fail "BACKUP_UPLOAD=s3 but BACKUP_S3_URI is not set"
  command -v aws >/dev/null || fail "BACKUP_UPLOAD=s3 but the aws CLI is not installed"
  echo "backup: uploading to ${BACKUP_S3_URI}/"
  aws s3 cp "$ARCHIVE" "${BACKUP_S3_URI}/" --only-show-errors
  aws s3 cp "$MANIFEST" "${BACKUP_S3_URI}/" --only-show-errors
  echo "backup: uploaded"
else
  echo "backup: BACKUP_UPLOAD is not set — this dump is local only, which is not a backup"
fi

# --- retention ----------------------------------------------------------
#
# Only local copies are pruned here. Offsite retention belongs to a bucket
# lifecycle policy, where a compromised application host cannot delete history.
find "$BACKUP_DIR" -name 'psirs-*.dump*' -type f -mtime "+${BACKUP_RETAIN_DAYS}" -delete 2>/dev/null || true

echo "backup: done"
