# Deployment

How this platform is built, shipped, migrated and rolled back.

## The artefact

One image, built by the root `Dockerfile`, containing the API and nothing else.
The agent PWA and the government portal are static builds served from a CDN or
any static host; they are excluded from the image by `.dockerignore`.

The image is multi-stage: the shipped layer carries no compiler, no test suite
and no dev dependencies. It runs as the `node` user, never root, and writes
nothing to its own filesystem — documents go to object storage, and the only
state is PostgreSQL.

Two things are in the image that are easy to leave out and fatal to omit:

- **The migrations.** `migrate.ts` reads them from disk and verifies each
  applied file against a stored checksum, so the deployed copy must be
  byte-identical to source control. `scripts/copy-assets.mjs` copies them into
  `dist` during the build and aborts the build if the count does not match.
- **The PDF fonts.** Every receipt states an amount in naira and PDFKit's
  built-in faces have no glyph for `₦`. The same script copies them and the
  document service refuses to issue anything if they are missing.

`src/tests/**` is excluded from the compiled output. It used to be included,
which put `helpers.js` — and its `resetDatabase()`, which `TRUNCATE`s every
financial table — into the production image. Nothing reachable from the
entrypoint imported it, so it was dead weight rather than a live hazard, but
dead weight that truncates the receipts table does not belong here.

### Verifying the artefact locally

```bash
npm run build:api
node apps/api/dist/server.js       # with the environment below
```

This matters more than it sounds. The test suite runs the TypeScript *source*
through `tsx`, so nothing in it checks that the thing you actually deploy can
start. The `build` job in `.github/workflows/deploy.yml` runs a load smoke-test
against the pushed image for the same reason.

## Environment

Every setting is documented in `.env.example`. `config.ts` refuses to start in
production when any of these is wrong, so a misconfigured deployment fails at
boot rather than at the first taxpayer:

| Must be set | Refused if |
|---|---|
| `PAYMENT_GATEWAY`, `TIN_SERVICE`, `KYC_PROVIDER`, `VEHICLE_REGISTRY`, `BANK_VERIFICATION` | still `mock` |
| `SMS_PROVIDER`, `EMAIL_PROVIDER` | still `mock` |
| `STORAGE_DRIVER` + S3 endpoint, bucket, credentials | still `local`, or incomplete |
| `JWT_SECRET`, `IDENTITY_HASH_SECRET`, `PAYMENT_WEBHOOK_SECRET` | missing or under 32 characters |
| `VERIFICATION_BASE_URL`, `PAYMENT_CALLBACK_URL`, `CORS_ORIGINS` | localhost, plain HTTP, or malformed |
| `ERROR_REPORTING` + URL | still `mock`, or named without a URL |
| `METRICS_TOKEN` | missing — `/metrics` would be unauthenticated |
| `REMITA_*` | `PAYMENT_GATEWAY=remita` with credentials missing or the demo base URL |

Set `RUN_MIGRATIONS_ON_BOOT=false` in production. The pipeline owns migrations.

Secrets come from a secret manager, injected as environment variables. Never a
`.env` file in the image: `.dockerignore` excludes it, and `env.ts` lets a real
environment variable win over a file so a stray `.env` cannot override an
injected secret.

## The pipeline

`.github/workflows/deploy.yml`, triggered by a `v*` tag. The ordering is the
substance:

1. **Verify** — the full suite against a real PostgreSQL. The financial
   guarantees are database triggers; a suite against mocks would prove nothing
   about them.
2. **Build and push** — tagged with the commit SHA, always, because a rollback
   has to name an exact artefact and `latest` cannot. Then a smoke-test that
   the image loads.
3. **Back up** — *before* migrations. A migration is the most likely change to
   need reverting, and a backup taken afterwards is no use for that.
4. **Migrate** — once, as its own job, run from the image being deployed so the
   applied files are byte-identical to the ones the new containers will
   checksum.
5. **Roll out**, then confirm `/health/ready` answers.
6. **Roll back automatically** if it does not.

Concurrency is `deploy-production` with `cancel-in-progress: false`. Two
deployments at once would migrate underneath each other, and a half-finished
deploy must be allowed to finish rather than be abandoned mid-rollout.

### What still needs wiring

The jobs from `backup` onwards are gated on the `production` environment and
call out to secrets this repository does not own:

| Secret | What it is |
|---|---|
| `DATABASE_URL` | production connection string |
| `DEPLOY_COMMAND` | one command that takes `$IMAGE_REF` and waits for the rollout |
| `DEPLOY_DESCRIBE_COMMAND` | prints the currently deployed tag, for rollback |
| `HEALTH_URL` | public `/health/ready` |
| `BACKUP_S3_URI`, `BACKUP_AWS_*` | offsite backup destination |

`DEPLOY_COMMAND` is deliberately one indirection: ECS, Kubernetes, Nomad and a
systemd unit over SSH all reduce to "take this image reference and wait", and
choosing between them is PSIRS's decision, not this repository's.

## Migrations and rollback

**A rollback reverts the application, not the schema.** There is no down
migration and there should not be: reversing a migration that has already
accepted writes loses those writes, and on this platform those writes are
receipts.

So every migration must be backward compatible with the release before it:

- add columns nullable, or with a default;
- never rename or drop a column in the same release that stops using it — stop
  using it, ship, then drop it in a later release;
- add a constraint only once the data already satisfies it;
- new tables are always safe.

That discipline is what makes step 6 of the pipeline safe. If a rollout fails
health checks, the previous image is redeployed against the already-migrated
schema, and it keeps working because the schema is still one it understands.

To roll back by hand, run the workflow with `rollback_to` set to a previous
commit tag.

## Topology

The API is stateless and horizontally scalable. Three things make that true,
and all three were fixed for it:

- **Background jobs** take a PostgreSQL advisory lock (`withJobLock`), so one
  instance runs each sweep however many are deployed. They were module-level
  booleans, which is a correct guard for one process and no guard for the
  second.
- **Migrations** take an advisory lock, so simultaneous boots queue rather than
  racing and crash-looping.
- **Sessions** are database-backed, so any instance can serve any request.

One thing is still per-instance: **rate limiting** keeps its buckets in process
memory, so the effective limit is N times the configured maximum. The impact is
bounded because account lockout — the control that actually stops credential
stuffing — is database-backed. A shared store is the remaining work; see
`docs/SECURITY.md`.

Recommended shape:

```
            TLS termination, WAF
                     │
              load balancer  ── /health/ready
                     │
          ┌──────────┴──────────┐
        api:N                 api:N          (stateless, 2+ replicas)
          └──────────┬──────────┘
                     │
        managed PostgreSQL 16 (primary + replica)
        WAL archiving → object storage
                     │
        object storage (documents, backups, versioned)
```

## Going live

- [ ] Secrets provisioned in the secret manager, none of them a development value
- [ ] Every integration pointed at a real provider **and its mapping confirmed against that provider's sandbox** — see `docs/INTEGRATION-VERIFICATION.md`
- [ ] `VERIFICATION_BASE_URL` set to the real portal, over HTTPS — this is printed onto every receipt and cannot be corrected afterwards
- [ ] DNS and TLS certificates for the API, the portal and the agent PWA
- [ ] `CORS_ORIGINS` set to the real portal and PWA origins
- [ ] Webhook URL registered with Remita, and its source addresses allowlisted
- [ ] Backups scheduled, WAL archiving on, and a restore rehearsed — `docs/DISASTER-RECOVERY.md`
- [ ] `ERROR_REPORTING` pointed at a real destination, and alerts configured on the queue-depth metrics
- [ ] `/metrics` scraped, with `METRICS_TOKEN` set
- [ ] Reference data seeded: `npm run seed` **without** `--demo` (the demonstration flags refuse in production, and creating a government administrator with a published password is what that guard exists to prevent)
- [ ] Real government users created through the platform, not the seed
- [ ] Independent penetration test completed
- [ ] Rollback rehearsed at least once against staging
