# The API image.
#
# Multi-stage so the shipped layer carries no compiler, no test suite and no
# dev dependencies — a smaller attack surface on a host that processes
# government revenue, and a faster pull during an incident when a rollback is
# waiting on it.
#
# The migrations and the PDF assets are copied explicitly rather than relied on
# to come along with the build output, because they have been left behind
# before: `.sql` files sit beside their module in source and only the deployed
# artefact was broken.

# ---------------------------------------------------------------------------
# Stage 1 — build
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Manifests first, so a dependency install is cached until they change.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

# `npm ci` for the whole workspace: the build needs dev dependencies.
RUN npm ci --workspace @psirs/shared --workspace @psirs/api --include-workspace-root

COPY packages/shared packages/shared
COPY apps/api apps/api

RUN npm run build --workspace @psirs/shared \
 && npm run build --workspace @psirs/api

# Re-resolve to production dependencies only, into a clean tree the runtime
# stage copies wholesale.
RUN npm ci --omit=dev --workspace @psirs/shared --workspace @psirs/api --include-workspace-root

# ---------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# postgresql-client for the backup and restore scripts, which run as jobs from
# this same image so they can never drift from the schema they belong to.
# curl for the container healthcheck.
RUN apt-get update \
 && apt-get install --no-install-recommends -y postgresql-client curl \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=4000 \
    # The deploy pipeline runs migrations as its own step, before any new
    # container is admitted. See docs/DEPLOYMENT.md.
    RUN_MIGRATIONS_ON_BOOT=false

WORKDIR /app

COPY --from=build /app/node_modules              ./node_modules
COPY --from=build /app/package.json              ./package.json
COPY --from=build /app/packages/shared/dist      ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/apps/api/dist             ./apps/api/dist
COPY --from=build /app/apps/api/package.json     ./apps/api/package.json

# `dist` already carries the migrations and the PDF fonts: apps/api's build
# runs scripts/copy-assets.mjs, which copies both and aborts the build if
# either is incomplete. Nothing further is needed for them here.
COPY apps/api/scripts/backup.sh apps/api/scripts/restore.sh ./apps/api/scripts/
RUN chmod +x ./apps/api/scripts/*.sh

# The process runs as `node`, and `/app` belongs to root — so the local
# storage driver could not create its own directory and the image died at
# startup with EACCES on `mkdir storage`. The path is also made absolute here
# rather than left relative to the working directory: the two API images have
# different working directories, so `./storage` resolved to two different
# places, and only one of them was where docker-compose mounts its volume.
ENV STORAGE_PATH=/app/storage
RUN mkdir -p /app/storage && chown node:node /app/storage

# Never root. The process needs to read its own code and write nothing.
USER node

EXPOSE 4000

# Liveness only: this asks whether the process is wedged, not whether the
# database is reachable. Restarting every replica because Postgres blinked
# turns a database blip into a full outage; readiness is the orchestrator's
# job and points at /health/ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health/live" || exit 1

CMD ["node", "apps/api/dist/server.js"]
