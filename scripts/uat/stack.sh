#!/usr/bin/env bash
# =============================================================================
# The UAT stack: a database, the API, the officer portal and the agent PWA.
#
# One script so the walkthrough in docs/UAT-WALKTHROUGH.md is reproducible
# rather than a list of things to remember. Everything runs against psirs_uat,
# a database this script owns and recreates, so nobody's working data is at
# risk and the demonstration accounts — which share one published password —
# cannot land anywhere real.
#
#   scripts/uat/stack.sh up      recreate, migrate, seed, start, seed via API
#   scripts/uat/stack.sh down    stop everything
#   scripts/uat/stack.sh reseed  re-run the API-driven seed only
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

DB_NAME="${UAT_DB:-psirs_uat}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
export DATABASE_URL="postgres://postgres:${PGPASSWORD}@localhost:5432/${DB_NAME}"
export NODE_ENV=development
export JWT_SECRET="uat-jwt-secret-value-long-enough-for-32ch"
export IDENTITY_HASH_SECRET="uat-identity-secret-long-enough-for-32ch"
export PAYMENT_WEBHOOK_SECRET="uat-webhook-secret-long-enough-for-32chars"
export STORAGE_PATH="/tmp/psirs-uat-storage"
# DEVICE_AUTO_APPROVE is deliberately NOT set here.
#
# It was, so that a presenter's own browser could collect without a second
# person approving the handset from the portal. But the seeded handset already
# does that job — the URL printed at the end of this script points a browser at
# a device an officer has approved — and the flag was quietly disabling the
# control on the way past. The browser journey registers a fresh handset,
# watches the platform refuse to take money on it, and has an officer approve
# it, which is how it is cleared in the field; with the flag set the handset
# was approved on registration and that journey proved nothing. A browser that
# arrives without the seeded device identifier is a second handset and waits
# for an officer, exactly as the closing message says.
export RUN_MIGRATIONS_ON_BOOT=false
export PORT=4000

RUN_DIR="/tmp/psirs-uat"
mkdir -p "$RUN_DIR"

# Ports rather than process names: `pkill -f server.ts` also matches the shell
# that is running this script, which kills the script.
stop_port() {
  local port="$1"
  fuser -k "${port}/tcp" >/dev/null 2>&1 || true
}

wait_for() {
  local url="$1" name="$2" tries=90
  until curl -sf -o /dev/null "$url"; do
    tries=$((tries - 1))
    [ "$tries" -le 0 ] && { echo "$name never became ready at $url" >&2; exit 1; }
    sleep 1
  done
  echo "  $name ready at $url"
}

down() {
  echo "Stopping the UAT stack"
  stop_port 4000; stop_port 5173; stop_port 5174
  sleep 1
}

case "${1:-up}" in
  down) down ;;

  reseed)
    node scripts/uat/seed-uat.mjs
    ;;

  up)
    down
    echo "Recreating ${DB_NAME}"
    psql -h localhost -U postgres -d postgres -qc "DROP DATABASE IF EXISTS \"${DB_NAME}\";" >/dev/null
    psql -h localhost -U postgres -d postgres -qc "CREATE DATABASE \"${DB_NAME}\";" >/dev/null

    npm run build --workspace @psirs/shared >/dev/null
    npm run migrate --workspace @psirs/api >/dev/null
    npm run seed --workspace @psirs/api -- --demo --demo-agent >/dev/null
    echo "  migrated and seeded with reference data, demo officers and a cleared agent"

    setsid npx tsx apps/api/src/server.ts > "$RUN_DIR/api.log" 2>&1 < /dev/null &
    wait_for "http://localhost:4000/health" "API"

    setsid npm run dev --workspace @psirs/portal > "$RUN_DIR/portal.log" 2>&1 < /dev/null &
    setsid npm run dev --workspace @psirs/agent > "$RUN_DIR/agent.log" 2>&1 < /dev/null &
    wait_for "http://localhost:5174/" "officer portal"
    wait_for "http://localhost:5173/" "agent PWA"

    node scripts/uat/seed-uat.mjs
    ;;

  *) echo "usage: $0 [up|down|reseed]" >&2; exit 2 ;;
esac
