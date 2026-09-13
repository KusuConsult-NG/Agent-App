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
#
# WHY THIS DOES NOT USE RANDOM IDS, HAVING ONCE DONE SO
#
# It read:
#
#   INSERT INTO receipts (... transaction_id, payment_id, taxpayer_id ...)
#   VALUES ('RESTORE-CHECK', gen_random_uuid(), gen_random_uuid(), ...)
#
# and treated foreign_key_violation as proof the control fired. Three random
# UUIDs reference nothing, so the foreign keys refused the row before any
# trigger ran. Verified by dropping every user trigger on `receipts` in a
# restored copy and running that statement: it still reported "control fired",
# and this script would still have printed "complete and verified" over a
# database with no receipt controls at all — the exact outcome it exists to
# rule out.
#
# So the row now names real rows for all three foreign keys and gets the
# *amount* wrong. Nothing but `enforce_receipt_requires_verified_payment` can
# refuse that, and a foreign_key_violation is now treated as a failure rather
# than as success, because reaching one means the row never got to the trigger.
#
# `restrict_violation` is the error code that function raises for every one of
# its rules. A caught exception rolls back to PL/pgSQL's implicit savepoint, so
# nothing here is left behind either way.

TRIGGER_PRESENT="$(psql_target --command "
  SELECT count(*) FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
   WHERE NOT t.tgisinternal
     AND c.relname = 'receipts'
     AND t.tgname = 'receipts_require_verified_payment'
     AND t.tgenabled <> 'D';
")"
[[ "$TRIGGER_PRESENT" == "1" ]] \
  || fail "the receipt control trigger is missing or disabled in the restored database" 3

FORBIDDEN="$(psql_target --command "
  DO \$\$
  DECLARE
    pay payments%ROWTYPE;
  BEGIN
    -- A real payment, so the foreign keys are satisfied and cannot be what
    -- refuses the row. It must also have no receipt yet: \`receipts\` carries a
    -- UNIQUE on payment_id, and on the first attempt at this the oldest payment
    -- already had one, so the row was refused by that constraint before the
    -- trigger ran — the same mistake as the random UUIDs, one layer further in.
    SELECT * INTO pay FROM payments p
      WHERE p.transaction_id IS NOT NULL AND p.amount_kobo IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.payment_id = p.id)
      ORDER BY p.created_at LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'NO_PAYMENT_TO_TEST_WITH';
    END IF;

    INSERT INTO receipts
      (receipt_number, transaction_id, payment_id, taxpayer_id, amount_kobo, verification_code)
    SELECT 'RESTORE-CHECK', t.id, pay.id, t.taxpayer_id, pay.amount_kobo + 1, 'RESTORECHK'
      FROM transactions t WHERE t.id = pay.transaction_id;

    RAISE EXCEPTION 'CONTROL_DID_NOT_FIRE';
  EXCEPTION
    WHEN restrict_violation THEN
      RAISE NOTICE 'control fired';
    WHEN foreign_key_violation THEN
      -- The row never reached the trigger, so this proves nothing.
      RAISE NOTICE 'CONTROL_NOT_REACHED';
    WHEN OTHERS THEN
      IF SQLERRM IN ('CONTROL_DID_NOT_FIRE', 'NO_PAYMENT_TO_TEST_WITH') THEN RAISE; END IF;
      RAISE NOTICE 'CONTROL_NOT_REACHED';
  END
  \$\$;
" 2>&1)" || true

if grep -q 'CONTROL_DID_NOT_FIRE' <<<"$FORBIDDEN"; then
  fail "the restored database accepted a receipt whose amount disagrees with its payment — controls are missing" 3
fi
if grep -q 'NO_PAYMENT_TO_TEST_WITH' <<<"$FORBIDDEN"; then
  # Not a pass, and not evidence of damage either. Say which it is: the trigger
  # is present and enabled (checked above) but there is no payment without a
  # receipt to attempt a forbidden insert against, so the control has not been
  # demonstrated. Reporting this as success is what the old check effectively
  # did; reporting it as breakage would send an operator hunting a fault that
  # is not there.
  fail "the receipt control trigger is present and enabled, but every payment in the restored database already has a receipt, so the control could not be demonstrated" 3
fi
if grep -q 'CONTROL_NOT_REACHED' <<<"$FORBIDDEN"; then
  fail "the forbidden insert was refused before reaching the receipt control, so nothing was proved" 3
fi
if ! grep -q 'control fired' <<<"$FORBIDDEN"; then
  fail "the receipt control check produced no verdict: ${FORBIDDEN}" 3
fi
echo "  central control verified: a receipt disagreeing with its payment is still refused"

echo "restore: complete and verified"
