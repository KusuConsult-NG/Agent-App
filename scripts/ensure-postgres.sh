#!/usr/bin/env bash
# =============================================================================
# Make sure the database is actually there before anything asks it a question.
#
# This is not about PostgreSQL being unreliable. It is not: across this
# repository's whole history the log shows no crash, no OOM kill and no PANIC.
# What it shows is a different thing that fails the same way —
#
#   LOG:  database system was interrupted; last known up at 14:41:20 UTC
#   LOG:  database system was not properly shut down; automatic recovery
#
# — a container suspended with the server running and resumed hours later with
# nothing to start it again. The first command that touches the database then
# gets ECONNREFUSED, which reads exactly like a crash and is not one. It cost
# this session two misdiagnosed test runs before the log was read.
#
# There is a second shape with the same symptom: the server IS starting, and
# is replaying WAL. Recovery of this cluster has taken 38 seconds. A caller
# that connects during it is told "the database system is not yet accepting
# connections" and gives up, when waiting four more seconds would have worked.
#
# So: start it if it is down, wait for it if it is coming up, and say plainly
# which of those happened.
#
# WHAT THIS WILL NOT DO.
#
# Touch a server it does not own. If DATABASE_URL points anywhere but this
# machine, the host belongs to somebody else — a colleague's box, a CI service
# container, a staging server — and the only honest thing to do is wait and
# then report. Starting a stranger's database is not a convenience.
# =============================================================================
set -uo pipefail

URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/postgres}"

# Host and port out of the URL, without needing a URL parser in bash: strip the
# scheme and any credentials, then take what is left up to the first / or ?.
hostport="${URL#*://}"
hostport="${hostport##*@}"
hostport="${hostport%%/*}"
hostport="${hostport%%\?*}"
HOST="${hostport%%:*}"
PORT="${hostport##*:}"
[ "$PORT" = "$HOST" ] && PORT=5432
[ -z "$HOST" ] && HOST=localhost

WAIT_SECONDS="${PG_WAIT_SECONDS:-90}"

ready() { pg_isready -h "$HOST" -p "$PORT" -q >/dev/null 2>&1; }

wait_for_ready() {
  local waited=0
  until ready; do
    waited=$((waited + 1))
    if [ "$waited" -gt "$WAIT_SECONDS" ]; then return 1; fi
    sleep 1
  done
  [ "$waited" -gt 0 ] && echo "[postgres] ready after ${waited}s"
  return 0
}

if ready; then
  exit 0
fi

case "$HOST" in
  localhost|127.0.0.1|::1|"$(hostname 2>/dev/null)")
    ;;
  *)
    echo "[postgres] ${HOST}:${PORT} is not answering, and is not this machine — waiting only."
    if wait_for_ready; then exit 0; fi
    echo "[postgres] ${HOST}:${PORT} never came up. Nothing here can start it for you." >&2
    exit 1
    ;;
esac

# It may be mid-recovery rather than absent. Give it a moment before deciding
# to start something that is already starting.
if wait_for_ready; then exit 0; fi

echo "[postgres] not running on ${HOST}:${PORT} — starting the local cluster"
if command -v pg_ctlcluster >/dev/null 2>&1; then
  # `start` on a cluster that is already running exits non-zero; that is not a
  # failure worth reporting, and the readiness wait below is the real answer.
  pg_ctlcluster "$(pg_lsclusters -h 2>/dev/null | awk 'NR==1{print $1}')" \
    "$(pg_lsclusters -h 2>/dev/null | awk 'NR==1{print $2}')" start >/dev/null 2>&1 || true
elif [ -x /etc/init.d/postgresql ]; then
  /etc/init.d/postgresql start >/dev/null 2>&1 || true
else
  echo "[postgres] no local cluster found to start (no pg_ctlcluster, no init script)." >&2
  exit 1
fi

if wait_for_ready; then
  exit 0
fi

echo "[postgres] started the cluster but it never began accepting connections." >&2
echo "[postgres] last lines of its log:" >&2
tail -20 /var/log/postgresql/postgresql-*-main.log 2>/dev/null >&2
exit 1
