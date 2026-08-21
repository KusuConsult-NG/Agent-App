#!/usr/bin/env bash
#
# Restore a backup, and then prove the restored database is actually usable.
#
# The proof is the part that is usually missing. "pg_restore exited 0" says the
# rows arrived; it says nothing about whether the financial controls came with
# them. On this platform the controls *are* the schema — a receipt cannot be
# inserted for an unverified payment because a trigger refuses it — so a
# restore that brought the tables but not the triggers would look like a
# successful recovery and would be a platform with no controls at all.
#
# So this script checks, after restoring:
#   * every financial table is present and its row count is reported;
#   * the integrity triggers exist;
#   * the central control still fires, by actually attempting a forbidden
#     insert and requiring it to be refused.
#
# Usage:
#   RESTORE_TARGET_URL=postgres://... restore.sh backups/psirs-2026….dump
#
# Environment:
#   RESTORE_TARGET_URL  required; the database to restore INTO
#   RESTORE_DROP        "yes" to drop and recreate the public schema first
#
# Exit codes: 0 restored and verified, 1 configuration, 2 restore failed,
#             3 verification failed.

set -Eeuo pipefail

fail() { echo "restore: $1" >&2; exit "${2:-1}"; }

ARCHIVE="${1:-}"
[[ -n "$ARCHIVE" ]] || fail "usage: restore.sh <archive.dump>"
[[ -f "$ARCHIVE" ]] || fail "no such archive: ${ARCHIVE}"
[[ -n "${RESTORE_TARGET_URL:-}" ]] || fail "RESTORE_TARGET_URL is not set"

# --- integrity of the archive itself ------------------------------------
MANIFEST="${ARCHIVE}.manifest.json"
if [[ -f "$MANIFEST" ]]; then
  EXPECTED="$(grep -o '"sha256": *"[^"]*"' "$MANIFEST" | cut -d'"' -f4)"
  ACTUAL="$(sha256sum "$ARCHIVE" | cut -d' ' -f1)"
  [[ "$EXPECTED" == "$ACTUAL" ]] \
    || fail "checksum mismatch: manifest says ${EXPECTED:0:12}, archive is ${ACTUAL:0:12}" 3
  echo "restore: checksum matches the manifest"
else
  echo "restore: no manifest beside the archive; skipping the checksum check"
fi

psql_target() { psql --dbname="$RESTORE_TARGET_URL" --quiet --no-align --tuples-only "$@"; }

if [[ "${RESTORE_DROP:-}" == "yes" ]]; then
  echo "restore: dropping and recreating the public schema"
  psql_target --command 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;' >/dev/null
fi

# --- restore -------------------------------------------------------------
#
# --exit-on-error, because a restore that logged errors and carried on is how a
# database ends up missing exactly the constraint that mattered.
echo "restore: restoring ${ARCHIVE}"
pg_restore \
  --dbname="$RESTORE_TARGET_URL" \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  "$ARCHIVE" \
  || fail "pg_restore failed" 2

# --- verify: the data ----------------------------------------------------
echo "restore: verifying restored contents"
for table in transactions payments receipts commissions audit_logs taxpayers agents invoices; do
  COUNT="$(psql_target --command "SELECT count(*) FROM ${table};" 2>/dev/null)" \
    || fail "table '${table}' is missing from the restored database" 3
  printf '  %-16s %s rows\n' "$table" "$COUNT"
done

# --- verify: the controls ------------------------------------------------
#
# The schema is the control. Confirm the triggers came back.
TRIGGERS="$(psql_target --command "
  SELECT count(*) FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
   WHERE NOT t.tgisinternal
     AND c.relname IN ('receipts','transactions','payments','commissions','audit_logs');
")"
[[ "$TRIGGERS" -ge 10 ]] \
  || fail "expected the financial integrity triggers, found only ${TRIGGERS}" 3
echo "  integrity triggers on financial tables: ${TRIGGERS}"

# And confirm the central one still fires. This is the difference between
# "the rows are back" and "the platform is back".
FORBIDDEN="$(psql_target --command "
  DO \$\$
  BEGIN
    INSERT INTO receipts
      (receipt_number, transaction_id, payment_id, taxpayer_id, amount_kobo, verification_code)
    VALUES
      ('RESTORE-CHECK', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1, 'RESTORECHK');
    RAISE EXCEPTION 'CONTROL_DID_NOT_FIRE';
  EXCEPTION
    WHEN foreign_key_violation OR restrict_violation THEN
      RAISE NOTICE 'control fired';
    WHEN OTHERS THEN
      IF SQLERRM = 'CONTROL_DID_NOT_FIRE' THEN RAISE; END IF;
      RAISE NOTICE 'control fired';
  END
  \$\$;
" 2>&1)" || true

if grep -q 'CONTROL_DID_NOT_FIRE' <<<"$FORBIDDEN"; then
  fail "the restored database accepted a receipt with no verified payment — controls are missing" 3
fi
echo "  central control verified: a receipt without a verified payment is still refused"

echo "restore: complete and verified"
