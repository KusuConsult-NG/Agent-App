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
export NODE_ENV=development
export JWT_SECRET="browser-test-jwt-secret-value-long-enough-32"
export IDENTITY_HASH_SECRET="browser-test-identity-secret-long-enough-32"
export PAYMENT_WEBHOOK_SECRET="browser-test-webhook-secret-long-enough-32"
export STORAGE_PATH="/tmp/psirs-browser-storage"
export RUN_MIGRATIONS_ON_BOOT=false
export PORT=4000

pids=()

cleanup() {
  echo "[browser-test] stopping…"
  for pid in "${pids[@]:-}"; do
    # Kill the process group: vite spawns children that outlive the parent, and
    # a leftover dev server holds the port against the next run.
    kill -- "-${pid}" 2>/dev/null || kill "${pid}" 2>/dev/null || true
  done
  wait 2>/dev/null || true
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

echo "[browser-test] running Playwright"
npx playwright test "$@"
