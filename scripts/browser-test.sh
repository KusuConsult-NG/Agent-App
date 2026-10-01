#!/usr/bin/env bash
# =============================================================================
# Browser tests: start the stack, run Playwright, stop the stack.
#
# These need three processes and a seeded database, which is why they are not
# part of `npm test`. That is also why this script exists: a suite requiring
# manual setup gets skipped rather than fixed.
#
# Everything runs against psirs_browser, a database this script owns, so a
# developer's working data is never touched — and the demo seed, which creates
# active government accounts sharing one published password, cannot land
# anywhere real.
# =============================================================================

set -euo pipefail

DB_NAME="${BROWSER_TEST_DB:-psirs_browser}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_USER="${DB_USER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export DATABASE_URL="postgres://${DB_USER}:${PGPASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
# `citizen-statement.spec.ts` reads a queued SMS straight from the database —
# there is no endpoint that hands a one-time code back and there must not be.
# It looks for UAT_DATABASE_URL and falls back to psirs_uat, the stack script's
# database, which this harness does not create: two tests failed with
# `database "psirs_uat" does not exist`. The harness knows where its own
# database is, so it says so rather than leaving the spec to guess.
export UAT_DATABASE_URL="${DATABASE_URL}"
export NODE_ENV=development
export JWT_SECRET="browser-test-jwt-secret-value-long-enough-32"
export IDENTITY_HASH_SECRET="browser-test-identity-secret-long-enough-32"
export PAYMENT_WEBHOOK_SECRET="browser-test-webhook-secret-long-enough-32"
export STORAGE_PATH="/tmp/psirs-browser-storage"
export RUN_MIGRATIONS_ON_BOOT=false
export PORT=4000

pids=()

# ---------------------------------------------------------------------------
# The trap must not decide this script's exit status, and it was deciding it.
#
# `trap cleanup EXIT` runs cleanup as the script exits, and a trap's own last
# command becomes the exit status unless something restores it. The last two
# commands here are `|| true` and `wait ... || true`, both of which succeed
# always — so a Playwright run with twenty failures exited 0 and
# `npm run test:browser` reported success. Measured: that is exactly what it
# did, and it is how a third of this suite stayed red without anybody
# noticing.
#
# `status=$?` captures the real status on entry and `exit "$status"` puts it
# back, so a red suite is red to CI and to anybody reading $?.
# ---------------------------------------------------------------------------
cleanup() {
  local status=$?
  echo "[browser-test] stopping…"
  for pid in "${pids[@]:-}"; do
    # Kill the process group: vite spawns children that outlive the parent, and
    # a leftover dev server holds the port against the next run.
    kill -- "-${pid}" 2>/dev/null || kill "${pid}" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT

wait_for() {
  local url="$1" name="$2" tries=60
  until curl -sf -o /dev/null "${url}"; do
    tries=$((tries - 1))
    if [ "${tries}" -le 0 ]; then
      echo "[browser-test] ${name} never became ready at ${url}" >&2
      exit 1
    fi
    sleep 1
  done
  echo "[browser-test] ${name} ready"
}

echo "[browser-test] preparing ${DB_NAME}"
psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d postgres \
  -c "DROP DATABASE IF EXISTS \"${DB_NAME}\";" >/dev/null
psql -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -d postgres \
  -c "CREATE DATABASE \"${DB_NAME}\";" >/dev/null

npm run build --workspace @psirs/shared >/dev/null
npm run migrate --workspace @psirs/api >/dev/null
# --demo is safe here and refuses in production regardless; this database is
# created and dropped by this script.
npm run seed --workspace @psirs/api -- --demo --demo-agent >/dev/null

echo "[browser-test] starting API"
setsid npx tsx apps/api/src/server.ts >/tmp/psirs-browser-api.log 2>&1 &
pids+=($!)
wait_for "http://localhost:4000/health" "API"

echo "[browser-test] starting the portal and the agent app"
setsid npm run dev --workspace @psirs/portal >/tmp/psirs-browser-portal.log 2>&1 &
pids+=($!)
setsid npm run dev --workspace @psirs/agent >/tmp/psirs-browser-agent.log 2>&1 &
pids+=($!)
wait_for "http://localhost:5174/" "portal"
wait_for "http://localhost:5173/" "agent app"

# ---------------------------------------------------------------------------
# The data the specs actually search for.
#
# `npm run seed -- --demo --demo-agent` above gives reference data, the demo
# officers and a cleared agent. It does NOT create a single taxpayer, vehicle
# or transaction — those are built through the real API by seed-uat.mjs, which
# is why `scripts/uat/stack.sh up` runs it as a second stage after the services
# are up. This script only ever ran the first stage.
#
# The cost was twenty failing tests that all said the same thing in different
# words: "No taxpayer matching Amina", "the seed registers a taxpayer with a
# TIN" received undefined, a vehicle not findable by its plate. Every one of
# them was the harness, not the app — and because the EXIT trap below masks
# Playwright's status (fixed in the same commit), `npm run test:browser`
# reported success while a third of the suite was red.
#
# After the services, not before: it drives the API, which has to be up.
# ---------------------------------------------------------------------------
echo "[browser-test] seeding demonstration data through the API"
node scripts/uat/seed-uat.mjs >/dev/null

echo "[browser-test] running Playwright"
npx playwright test "$@"
