# Deployment

How this platform is built, shipped, migrated and rolled back.

## The artefact

One image, built by the root `Dockerfile`, containing the API and nothing else.
The agent PWA and the government portal are static builds; they are excluded
from that image by `.dockerignore`, and each has its own image that serves its
`dist` from nginx — `Dockerfile.agent` and `Dockerfile.portal`. Any static host
or CDN will serve them equally well, and the nginx images exist so that a
platform which deploys containers has something to deploy. See **Railway**
below for the shape currently in use.

There is a fourth Dockerfile, `Dockerfile.api`, which builds the API too and is
**not** what is deployed. It is a different image from the root one — alpine
rather than bookworm-slim, a different `WORKDIR`, its own `ENV PORT` and
`STORAGE_PATH`, and no `backup.sh`/`restore.sh` — so the two are not
interchangeable, whatever the file names suggest. If you are pointing a service
at an API Dockerfile, the answer is `Dockerfile`.

The image is multi-stage: the shipped layer carries no compiler, no test suite
and no dev dependencies. It runs as the `node` user, never root, and writes
nothing to its own filesystem — documents go to object storage, and the only
state is PostgreSQL.

Two things are in the image that are easy to leave out and fatal to omit:

- **The migrations.** `migrate.ts` reads them from disk and verifies each
  applied file against a stored checksum, so the deployed copy must be
  byte-identical to source control. `apps/api/scripts/copy-assets.mjs` copies them into
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
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | one set without the other |

### Web push keys

Push is optional. With both keys blank the channel is off, the key endpoint
answers 503 saying so, and the citizen's receipt still goes by SMS — which is
the copy that matters, because a taxpayer holds no account here.

With one key set and not the other the server refuses to start, because that
deployment would serve no key, accept no subscription and send nothing, while
looking configured.

**Generate them once and keep them.** A browser binds its subscription to the
application server key permanently, so replacing these unsubscribes every
handset in the fleet — silently, because nothing on either side reports it.
Treat them like `JWT_SECRET`: in the secret manager, never regenerated on a
whim.

```
npx web-push generate-vapid-keys
```

`VAPID_PUBLIC_KEY` must be a P-256 public key; the raw point that browsers
accept is served to them whichever encoding is configured.
`VAPID_PRIVATE_KEY` may be the raw scalar, DER or PEM. `VAPID_SUBJECT` is the
contact the push services use to reach the operator. `PUSH_PROXY_URL` (falling
back to `HTTPS_PROXY`) routes outbound pushes where egress is not direct.

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

- **Rate limiting** shares its buckets through PostgreSQL, so N instances
  enforce one limit rather than N times the configured maximum. Set
  `RATE_LIMIT_STORE=postgres`; production refuses to start without it, because
  a per-process limiter advertises a cap in `x-ratelimit-limit` that the
  deployment does not hold. A caller already over their limit is refused from
  memory for the rest of their window, so a flood costs one round trip rather
  than one per request, and the store fails open — a bookkeeping table being
  unreachable must not stop collection statewide.

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

## Railway

Three services off one repository, which is the part that is not obvious from
the repository itself:

| Service | Dockerfile | Serves | Port |
|---|---|---|---|
| `agent-app` | `Dockerfile` | the API | as the image sets it |
| `agent-pwa` | `Dockerfile.agent` | the agent PWA, via nginx | 80 |
| `portal` | `Dockerfile.portal` | the officer and verification portal, via nginx | 80 |

**Each service's Dockerfile path has to be set explicitly, and a new service
will not work until it is.** Railway looks for a file named exactly
`Dockerfile`; finding none it falls back to Railpack, which tries to infer a
build from the root `package.json`, and on a workspace root with no build of
its own that fails at prepare:

```
using build driver railpack-v0.40.1
railpack prepare exited with an error
```

That error names the builder and not the cause, so it reads like a broken
monorepo. It means only that the service is still on the default builder. Per
service: **Settings → Build → Build Method `Dockerfile`**, then **Dockerfile
Path** set to the file from the table above. The API service works without this
step for one reason — its Dockerfile is the one already called `Dockerfile`.

A service also needs a repository connected before it can deploy at all
(**Settings → Source**); one created as an empty placeholder has no code to
snapshot, and says so as `Failed to create code snapshot`, which is the same
sentence Railway uses for a half-finished upload. The two causes are worth
telling apart: no source, or a failed `railway up` being retried. For the
second, deploy from the repository rather than re-running the failed upload.

### The front-ends assume they share an origin with the API

Both clients hardcode their API base and it is a **relative** path:

```ts
const API_BASE = '/api/v1';    // apps/agent/src/lib/api.ts, apps/portal/src/lib/api.ts
```

That is deliberate, and `apps/agent/vite.config.ts` says why beside the dev
proxy that makes it work locally: *"The PWA and API share an origin in
production; the dev proxy keeps cookies, CSP and CORS behaviour the same in
development."* The refresh-token cookie, the CSP and the absence of any CORS
preflight all rest on it.

**Deploying the three as separate services breaks that assumption, and neither
nginx config restores it.** `Dockerfile.agent` and `Dockerfile.portal` define
`location /assets/`, `location /` and (in the agent) `location = /sw.js` — and
no `location /api/` with a `proxy_pass`. A request for `/api/v1/auth/login`
therefore falls through to `try_files $uri $uri/ /index.html` and is answered
with `index.html`: HTTP 200, `Content-Type: text/html`. Every call fails at
`response.json()`, so both front-ends load their shell and nothing in them
works, sign-in included.

`VITE_API_URL` does not help, because nothing reads it. The only build-time
variable either client consults is `VITE_VERIFICATION_BASE_URL`
(`apps/agent/src/lib/verification-url.ts`), which is the host printed on a
receipt, not the host the app calls. Setting `VITE_API_URL` on a service is
inert.

### How it is closed: both nginx images proxy `/api`

Each front-end image now serves `/api/` by proxying to the API, so the origin
the client assumes is the origin it gets. Nothing in either client changed, and
neither did CORS, the CSP or the cookie — which is the point of fixing it on
this side rather than the other.

Set **`API_ORIGIN`** on each front-end service to the API's `host:port` on the
private network:

```
API_ORIGIN=agent-app.railway.internal:4000
```

It is read at **container start**, not at build time, so changing it needs a
restart rather than a rebuild — the opposite of `VITE_VERIFICATION_BASE_URL`,
which Vite bakes into the bundle. The config ships as
`/etc/nginx/templates/<app>.conf.template` and the nginx image's own
`20-envsubst-on-templates.sh` substitutes it. `NGINX_ENVSUBST_FILTER=API_ORIGIN`
limits that substitution to the one name, because every nginx variable in the
file — `$uri`, `$host`, `$proxy_add_x_forwarded_for` — is `$name`-shaped and
envsubst cannot otherwise tell them apart from its own.

**There is no default, and the container refuses to start without it.**
`/docker-entrypoint.d/05-require-api-origin.sh` exits 1 with a sentence saying
what to set. Left to nginx, an empty value becomes `proxy_pass http://;` and
the error is `no host in upstream ""` against a line number; any default value
would be a wrong host serving a shell where nothing works, which is the failure
this section exists to end.

Two details in the proxy that are load-bearing:

- **No trailing slash on `proxy_pass`.** The API mounts its own routes at
  `/api/v1` (`app.use('/api/v1', api)`), so the URI has to pass through
  unchanged rather than be rewritten.
- **`client_max_body_size 12m`.** A KYC document is a photograph of an ID card
  and the API accepts up to 8 MB of one (`MAX_DOCUMENT_BYTES`). nginx defaults
  to 1 MB and refuses a 2 MB upload with its own 413 before the API sees it —
  measured, and it would have been a new bug introduced by adding the proxy.
  The limit sits above the API's own so that an oversized document is refused
  by the API, in the sentence it wrote for the agent holding the phone.

Verified against real nginx rather than reasoned about, using the template text
extracted from the Dockerfiles and the image's own envsubst step:

| | `GET /api/v1/ping` | SPA deep route | 2 MB POST |
|---|---|---|---|
| without the proxy block | `200 text/html`, body is the shell | `200 text/html` | — |
| as shipped | `200 application/json` | `200 text/html` | not 413 |

### The port is the platform's to choose

Both nginx images take their listen port from **`PORT`**, defaulting to 80.

`listen 80` was hardcoded, which works only where the platform is told to
route to 80. Railway's convention is to inject `PORT` and expect the process
to honour it, and an image listening elsewhere is reached by nothing: the
deployment succeeds, the service is marked healthy, and the edge answers
**"Application failed to respond"** to every request. That failure looks like
a broken application and is a disagreement about a number.

The default lives in `/docker-entrypoint.d/10-default-port.envsh`, and the
extension matters: the nginx entrypoint **sources** files ending `.envsh` and
**executes** files ending `.sh` in a subshell, so an `export` from a `.sh`
would not survive to `20-envsubst-on-templates.sh`, which is what needs to
see it. `NGINX_ENVSUBST_FILTER` admits both `API_ORIGIN` and `PORT`.

Verified against real nginx using the image's own envsubst semantics: with
`PORT=8085` the config binds 8085, serves the SPA, still proxies `/api/v1`,
and leaves nothing on 80; with `PORT` unset it binds 80.

### One thing still to confirm on the deployed chain

`TRUST_PROXY` makes the API `app.set('trust proxy', 1)` — one trusted hop.
Routing API calls through the front-end nginx adds a hop, so `req.clientIp`
may now resolve to the proxy rather than the citizen. That matters more than it
sounds: it is the key for every `keyBy: 'ip'` rate limit, including the two
deliberate enumeration thresholds on the public citizen lookup, and it is what
the audit log records as the address a lookup came from.

This cannot be checked from a laptop, because it depends on how many hops the
platform's own edge adds. Check it in one request after deploying — hit the
public citizen lookup, then read the row it writes:

```sql
SELECT lookup_type, result, ip_address, created_at
  FROM verification_attempts
 ORDER BY created_at DESC
 LIMIT 1;
```

If `ip_address` is an internal address rather than the caller's, the hop count
is wrong and `TRUST_PROXY` needs to match the real chain.

`.railwayignore` keeps the CLI upload to about 10 MB of the 43 MB tracked tree,
by leaving out `docs/` — several hundred UAT screenshots that no image copies.
Without it the upload can time out, and the retry reports the snapshot error
above. It has no effect on a deploy triggered from GitHub, which clones.

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
