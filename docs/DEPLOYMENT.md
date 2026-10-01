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
| `agent-pwa` | `Dockerfile.agent` | the agent PWA at `/` **and the officer portal at `/portal/`**, via nginx | 80 |
| `portal` | `Dockerfile.portal` | the officer and verification portal, via nginx | 80 |

Or **two**: `Dockerfile.agent` serves both front ends on one hostname — the
agent at `/` and the portal at `/portal/` — so the `portal` service is
optional. See *One URL for both apps* below. That is the arrangement to prefer
for a demo or a pilot, because it is one address to publish rather than two.

### Making a demonstration deployment work at all

A demonstration deployment is a **real** deployment: production image,
`NODE_ENV=production`, and every production control in force. Two of those
controls stop a field agent doing the thing a demonstration exists to show,
and each is lifted by a flag that names itself. Both go on the **API**
service.

| Flag | Without it | What it still enforces |
|---|---|---|
| `DEMO_RELAX_DEVICE_BINDING=true` | The seeded agent already has a handset, so a presenter opening the app in their own browser is that agent's *second* handset and cannot collect. Two people and a portal login to show one screen. | A REVOKED or SUSPENDED handset is still refused — the half worth demonstrating. |
| `DEMO_ALLOW_MOCK_GATEWAY=true` | `PAYMENT_GATEWAY=mock` is refused at boot, so the gateway is a real one nobody has credentials for, and `POST /payments/simulate` is refused. The agent starts a payment and watches it stay PENDING for ever. | Every other production refusal — a mock TIN service, local storage, a per-instance rate limiter — plus webhook signatures and every rule about which status codes close a transaction. |

Neither refuses to boot, because a flag nobody can start with answers nothing.
Each is logged at **warn** on every boot instead, by name, beside the port and
the gateway, so a deployment cannot run with them quietly.

> **Never set either on a deployment collecting real money.** A revoked
> handset that can be replaced without anybody looking is a revocation that
> meant nothing, and a receipt issued against a mock gateway is not evidence
> that anybody paid.

With `DEMO_ALLOW_MOCK_GATEWAY` on, the agent app's **Simulate success /
Simulate failure** controls appear again on the collection screen. The app no
longer decides that for itself — it used to key off its own build mode, which
hid the control on exactly the deployment that had just been given it — so the
server reports `simulation_available` on every transaction status and the app
follows it.

### A demonstration needs demonstration data

`npm run seed -- --demo --demo-agent` **refuses in production**, and that stays
refused: those are ACTIVE government accounts, an administrator among them,
sharing one published password. A production database gets reference data only.

So a demonstration deployment needs either its own real agent and taxpayers
created through the portal, or a database seeded before `NODE_ENV` was set to
production. Signing in works either way — it is having nothing to collect from
that makes the app look broken.

### `VITE_AGENT_APP_URL` — only on the standalone `portal` service

A field agent who signs into the officer portal is no longer turned away: they
land on **Your field work**, which says their collection tools are in the
agent PWA and links to it. The portal can only work that address out for
itself in the combined image, where it is mounted at `/portal/` and the agent
app is at the root of the same origin. On its own hostname it cannot, and
without being told it can only say to ask a supervisor.

So on the `portal` service, and nowhere else, pass the agent app's address as
a **build argument**:

```
VITE_AGENT_APP_URL=https://agent-pwa-production.up.railway.app/
```

**Build time, not run time.** Vite inlines `import.meta.env` into the bundle,
so a value set on the running container is read by nothing. On Railway this is
a build argument on the service, not a service variable; `Dockerfile.portal`
declares the matching `ARG`. Leaving it unset is safe — the screen names who
to ask rather than offering a dead link.

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
proxy that makes it work locally: the PWA and API share an origin in
production, and the proxy keeps the CSP and the absence of a CORS preflight
the same in development. Both of those rest on the shared origin.

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
neither did CORS or the CSP — which is the point of fixing it on this side
rather than the other.

### Where the refresh token actually lives

**Not in a cookie.** This platform sets none — `grep -r cookie apps/api/src`
finds a comment and the logger's redaction list, and nothing that writes one.
This paragraph used to say "the refresh-token cookie, the CSP and the absence
of any CORS preflight all rest on it", and `config.ts` said twice that taking
`NODE_ENV` off production would turn off "the cookie hardening". None of it
existed, and the claim is worth correcting rather than deleting because it
asserted the opposite of the truth about the one thing it named.

Both clients hold the refresh token in web storage, where script can read it:

| | key | default | with "remember me" |
|---|---|---|---|
| Agent | `psirs.refresh` | `localStorage` | `localStorage` |
| Officer portal | `psirs.portal.refresh` | `sessionStorage` | `localStorage` |

An httpOnly cookie is not readable by injected script; web storage is. So the
exposure a reader of the old sentence would have ruled out is the exposure
this platform actually has, which is why `script-src 'self'` in both
`index.html` files is load-bearing rather than belt-and-braces, and why
`connect-src` is kept to `'self'` alone — together they are what bounds what
a compromised bundle could read and where it could send it.

Nothing here argues for a change. Both clients need the token from JavaScript
to put it in an `Authorization` header, and a refresh cookie would need CSRF
protection this platform does not have. It is written down so the next
decision is made against what is true.

### If the front end stops reaching the API after an API redeploy

Symptom: the apps load, but every call fails at the network and sign-in says
"The request failed. Try again, or contact support." `/api/v1/reference/lgas`
in a browser does not load either. Nothing was deployed to the front end.

Cause: nginx used to resolve `API_ORIGIN` **once**, when it loaded its config,
and hold that address for the life of the process. On a private network the
API's address changes every time the API is redeployed, so the front end went
on dialling a container that no longer existed.

Both front-end images now put the upstream in a variable with a `resolver`, so
the name is resolved per request and an API redeploy is picked up within
seconds. If you are running an older image, restarting the front-end service
is the workaround — it re-resolves on start.

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

### The config is rendered as `default.conf`, and that is the point

Each image writes `/etc/nginx/templates/default.conf.template`, so the
image's own `20-envsubst-on-templates.sh` renders it to
`/etc/nginx/conf.d/default.conf` — **overwriting** the stock file nginx ships.

It used to render as `<app>.conf` beside that stock file, with a build-time
`rm -rf /etc/nginx/conf.d/default.conf` expected to have removed it. On the
deployed container it had not been: the image's own
`10-listen-on-ipv6-by-default.sh` found and edited that path at startup, which
it only does when the file exists. Why the `rm` did not take is unexplained;
rendering as `default.conf` makes it irrelevant, because envsubst overwrites
whatever is at that path.

What it cost while there were two files is worth stating plainly, because it
was silent. Both server blocks listened on the same port with
`server_name localhost`, so nginx logged

```
conflicting server name "localhost" on 0.0.0.0:80, ignored
```

kept the first — the stock one, which has no `/api/` proxy — and answered
every API call with a static file lookup:

```
open() "/usr/share/nginx/html/api/v1/health" failed (2: No such file or directory)
"HEAD /api/v1/health HTTP/1.1" 404
```

So the proxy the image exists to provide was not in effect, while the
container started cleanly, the deployment reported success, and the SPA shell
loaded. Reproduced against real nginx byte for byte, before the rename and
after: two blocks give `404 text/html`, one gives `200 application/json`.

`server_name _` rather than `localhost` for the same reason — the Host header
is the platform's public hostname, so `localhost` matched nothing and worked
only by being the sole block — and `listen ${PORT} default_server` says so
explicitly rather than leaving it to file ordering.

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

### The address a request appears to come from

`TRUST_PROXY` is the number of proxies in front of the API whose
`X-Forwarded-For` entries Express may believe. It is **off by default**, and
the front-end image serving `/api/` by proxy makes that the wrong default for
this deployment.

Measured against the config rendered out of `Dockerfile.agent`, with that
nginx as the only hop in front of a stub that reports what it received:

| what the caller sent | socket address the API sees | `X-Forwarded-For` |
|---|---|---|
| nothing | the proxy | the caller |
| `X-Forwarded-For: 102.89.33.7` | the proxy | `102.89.33.7, <the proxy's client>` |

So our nginx contributes exactly one hop and appends the address it saw. The
caller's address is in the header and nowhere else, and with `TRUST_PROXY`
unset Express takes the socket address, so the caller's address is present in
every request and ignored.

**What that costs, in the order an operator notices it.** Every `keyBy: 'ip'`
rate limit becomes one bucket for all callers at once. The sharpest are on the
public citizen lookup — `citizen-status` at ten requests a minute and
`citizen-statement-request` at five — so on one origin the lookup starts
refusing ordinary citizens almost immediately, and a demonstration with
several people in the room hits it in the first minute. Less visibly, the
audit log and `verification_attempts` record the proxy's address on every row,
which is the column somebody reads when asking where a lookup came from.

The API warns once per process, on the first request that arrives carrying
`X-Forwarded-For` while `TRUST_PROXY` is unset, naming both costs. A boot
check cannot do this: whether anything forwards an address depends on what is
in front of the API, which it learns only when a request arrives.

**Set it to one if nginx faces the internet.** What cannot be settled from
here is whether the platform's own edge adds a hop of its own in front of
nginx, because that is a property of the deployment rather than of this
repository. Check it in one request after deploying — hit the public citizen
lookup, then read the row it writes:

```sql
SELECT lookup_type, result, ip_address, created_at
  FROM verification_attempts
 ORDER BY created_at DESC
 LIMIT 1;
```

If `ip_address` is an internal address rather than the caller's, the hop count
is short by however many hops the edge adds.

`.railwayignore` keeps the CLI upload to about 10 MB of the 43 MB tracked tree,
by leaving out `docs/` — several hundred UAT screenshots that no image copies.
Without it the upload can time out, and the retry reports the snapshot error
above. It has no effect on a deploy triggered from GitHub, which clones.

## One URL for both apps

`Dockerfile.agent` builds both front ends and serves them from one origin:

| Path | Serves |
|---|---|
| `/` | the agent PWA |
| `/portal/` | the officer portal, and with it `/verify`, `/referee`, `/group-attestation` and `/citizen` |
| `/api/` | proxied to the API service, exactly as the single-app images do |

**"Verify" is not a separate application.** It is a route the portal resolves
before authentication, along with the referee, group-attestation and citizen
screens — see the public routes at the top of `apps/portal/src/App.tsx`. All
four ship inside the portal bundle. There is no fourth thing to deploy.

### Switching to it

One service instead of two:

**There is nothing to change on the `agent-pwa` service.** It already points
at `Dockerfile.agent`, and that is the combined image — so the portal arrives
at `/portal/` on the existing hostname on the next deploy.

This config first lived in a separate `Dockerfile.web`, which is the honest
name for it. It was moved here because a service's **Dockerfile Path** is a
setting in the Railway dashboard, and a new filename means finding and editing
that field on the right service; a path that is already configured and already
working cannot be mistyped. The cost is that `Dockerfile.agent` no longer means
"the agent alone", which its own header states at the top.

So the switch is one step, and it is on the API service rather than the
front-end one:

1. **Set `VERIFICATION_BASE_URL` on the API service to the portal's new
   path.** This is the step with consequences, and the next section is about
   it. Nothing else is required.
2. `API_ORIGIN` on `agent-pwa` stays exactly as it is. The image still refuses
   to start without it.
3. Delete the `portal` service, or leave it running on its own hostname. Both
   work; nothing in the combined image depends on it being gone.
   `Dockerfile.portal` is **no longer a portal-only image** — it is derived
   from `Dockerfile.agent` and serves exactly the same thing, so a service
   pointed at either name gets a correct deployment. That change is the
   subject of the header comment in both files.

### `VERIFICATION_BASE_URL`, which is the one that bites

```
VERIFICATION_BASE_URL=https://<your-host>/portal
```

Everything the platform ever hands to someone outside government is derived
from this one setting, through `apps/api/src/lib/public-urls.ts`: the QR code
and printed code on every receipt and certificate, a referee's invitation, a
cooperative chairman's attestation link, and the SMS telling a taxpayer what
they owe. Leave it pointing at the bare host and all four land on the agent
app's sign-in form — which renders perfectly, so nothing looks like an error.
A citizen scanning the QR on their receipt is simply shown a staff login.

Receipts already printed carry the old URL on them and cannot be corrected, so
this is worth getting right before anything is issued.

`portalOrigin()` strips a trailing slash and a trailing `/verify`, so
`.../portal`, `.../portal/` and `.../portal/verify` all resolve the same way.
`PUBLIC_PORTAL_URL`, if it is set at all, needs the same subpath.

### `VITE_VERIFICATION_BASE_URL`, which is the other one, and is not the same

```
VITE_VERIFICATION_BASE_URL=https://<your-host>/portal
```

**Two variables print the same address onto two different pieces of paper, and
setting one does not set the other.**

- `VERIFICATION_BASE_URL` is read by the API at **run time** and governs the
  PDF certificate, the referee invitation, the attestation link and the
  citizen SMS. A restart picks up a change.
- `VITE_VERIFICATION_BASE_URL` is read by the **agent bundle**, and governs
  only the QR code and link on a **thermal paper receipt** printed from a
  handset. Vite bakes it in, so a change needs a **rebuild**, not a restart.

The receipt one used to be unsettable. Both front-end images now declare
`ARG VITE_VERIFICATION_BASE_URL` immediately before they build the agent — a
name a Docker stage does not declare never reaches `RUN`, so until that line
existed a `--build-arg` was dropped with a warning and a platform service
variable never arrived. Set it as an ordinary variable on the front-end
service and redeploy; it is read during the build.

Left unset, the receipt prints with the verification code and **no QR code and
no link at all** — `packages/shared/src/escpos.ts` emits that block only when a
URL is supplied. That is deliberate rather than broken: the note at the top of
`apps/agent/src/lib/verification-url.ts` explains why a government receipt
carrying a dead address is worse than one carrying none, and a localhost value
is discarded for the same reason. But a demonstration where the QR on the paper
is part of the story needs this set.

### Why the portal is built differently in this image

Vite writes absolute asset URLs into `index.html`. Built normally the portal's
names `/assets/index-<hash>.js` and `/icon.svg`; served under `/portal/` every
one of those is a 404 at the root, answered by the agent's SPA fallback with
the agent's shell — 200, `text/html` — so the page is blank and the console
says only that a module had the wrong MIME type. The image therefore builds it
with `--base=/portal/`, on the command line rather than in `vite.config.ts`, so
the same source still builds for `/` in `Dockerfile.portal` and in
`npm run dev`.

Two things that cost nothing, and are worth knowing why:

- The portal is a **hash router** by deliberate choice
  (`apps/portal/src/router.tsx`: "so a static host serves every route from one
  file with no rewrite rules to get wrong"). The part after `#` never reaches
  nginx, so `/portal/#/verify/ABC` is one request for `/portal/` and there are
  no per-route rewrite rules to write.
- The two apps' **storage keys do not collide**, which matters now that they
  share an origin. The agent owns `psirs.refresh`, `psirs.user`,
  `psirs.session.expires` and `psirs.device.id`; the portal namespaces its own
  as `psirs.portal.*` and `psirs.filters.*`. Signing into one does not disturb
  the other.

### The agent's service worker, which does not leave the portal alone by itself

The worker registers with scope `/` because the agent is the root app, so
every portal request passes through it, and every branch of it was written for
an origin with one application on it:

- the navigation branch caches whatever HTML came back under the literal key
  `/index.html`, so one officer opening the portal on a handset that also
  carries the agent app replaces the agent's offline shell with a government
  sign-in page — which the agent then opens, next time it loses signal, with
  no way out;
- the static branch falls back to that same key on any miss, so a portal asset
  fetched with no connection comes back 200 as HTML and the portal dies
  parsing it.

`sw.js` excludes `/portal/` for both reasons, and `VERSION` is bumped so a
handset carrying the old worker installs the new one and `activate` clears the
caches it no longer owns. `apps/agent/src/tests/an-application-that-could-not-update.test.ts`
runs the real file against a mocked worker global and holds it to this.

### One thing this does not solve

The agent's manifest declares `"scope": "/"`, and there is no exclusion in the
manifest format. Where the agent PWA is installed and the browser is
configured to capture links for it, a `/portal/` link can open inside the
agent's standalone window — chromeless, no address bar. Officers work in a
desktop browser and will not normally have the PWA installed, so the overlap
is narrow, but it is real and there is no fix short of moving the agent off
the root, which would orphan every handset that already installed it from `/`.

### Verified

Measured against real nginx with both apps' real build output in place, rather
than inferred from nginx's matching rules:

| Request | Answer |
|---|---|
| `/`, `/nonexistent-route` | the agent shell |
| `/portal/`, `/portal/nonexistent-route` | the portal shell |
| `/portal` | 301 to `/portal/` |
| `/portals-of-jos` | the agent shell — the prefix is precise |
| `/api/v1/health` | `200 application/json`, from the API |
| `/api/v1/documents/abc.png` | `200 application/json` — see below |

Both apps then booted in Chromium from that one origin with zero failed
requests and zero console errors, and the public verify screen rendered at
`/portal/#/verify/<code>`. Chromium reported no manifest errors and every
install criterion met, so the agent app is still installable from the shared
origin.

That `.png` row is a fault found while measuring this, and fixed in all three
images. `location /api/` was written without `^~`. nginx tries regex locations
before a prefix match unless the prefix carries `^~`, so any API path ending
in an image extension matched the icon block instead and was looked up on
disk: `GET /api/v1/documents/abc.png` returned `404 text/html`. No such route
exists today, which is why nothing had broken — it was a trap, not a fault,
and the first signed document URL or QR endpoint carrying an extension would
have fallen into it with the cause three locations away from the symptom.

## Running a demonstration

### Device binding

An agent's first handset is auto-approved; every one after that waits for an
officer, because revoking a stolen phone would be worth nothing if the thief
could register another. The seeded demonstration agent already has a handset —
the seed registered one to build its data through the real API — so anybody
opening the agent app in their own browser is that agent's **second** handset
and cannot collect. A demonstration then needs two people and a portal login
before anything can be shown.

Two ways out, in order of preference:

**Approve the one handset.** Sign in to `/portal/` as an administrator, open
**Agents → the demonstration agent → Devices**, and approve the pending entry.
Twenty seconds, once per browser or phone, and device binding stays intact.

**Or relax it for that deployment:**

```
DEMO_RELAX_DEVICE_BINDING=true
```

Set on the API service. An agent may then collect from a handset nobody
approved, on any browser or phone, with no officer involved.

What it does **not** turn off: a **REVOKED** or **SUSPENDED** handset is still
refused. That is deliberate — it is the half of device binding worth
demonstrating, and the half whose absence would be indistinguishable from the
platform not having the feature. An officer can still cut a handset off during
a demonstration and have it take effect immediately.

Three things worth knowing about it:

- It works **in production mode**, unlike `DEVICE_AUTO_APPROVE`, which is
  forced off when `NODE_ENV=production` and refuses to boot if set. That is
  the whole reason this flag exists: a demonstration deployment is a real
  deployment built from the production image, so the older flag is inert in
  exactly the place a demonstration runs.
- It is **narrower than the alternative.** Taking `NODE_ENV` off production on
  that service would have worked too, and would also have turned off the
  published-secret refusal, the cookie hardening and the replica warning.
  Weakening four controls to get one is a bad trade.
- Every boot **says so**, at warn level, beside the port and the payment
  gateway: `device binding is RELAXED on this deployment`. It is not in the
  readiness check's refusals, because a flag that refuses to boot is a flag
  nobody can use — so the log is what stops a deployment running this quietly.

**Never set it on a deployment collecting real money.** A revoked handset that
can be replaced without anybody looking is a revocation that meant nothing,
and the money is somebody's tax.

## Sign-in times out, and the proxy gets the blame

Symptom: the apps load, sign-in spins, and the front end's log shows

```
upstream timed out (110: Operation timed out) while reading response header
from upstream, request: "POST /api/v1/auth/login" ... 504
```

The proxy reached the API — the upstream address is right there in the line.
The API never answered. Its own log shows the cause, but only from the
background jobs:

```
(EMAXCONNSESSION) max clients reached in session mode
                 - max clients are limited to pool_size: 15
```

**The API has run out of database connections.** `DB_POOL_SIZE` defaults to 10
*per instance*, this service runs fifteen scheduled jobs that each take one,
and a hosted pooler in **session mode** allows a small fixed number of clients
— 15 on the tier this was found on. Two instances exhaust it.

Why it is hard to see: `pg` used to wait for ever for a connection, so web
requests did not fail, they stopped. Nothing was logged, because nothing had
gone wrong yet. Only the jobs, which have their own timeout, said anything —
and the visible artefact was a 504 from the proxy, two services away from the
cause. `DB_CONNECTION_TIMEOUT_MS` now bounds that wait at 10s, so the same
exhaustion answers in seconds and names the database.

### The fix, best first

| Change | Why |
|---|---|
| Point `DATABASE_URL` at port **6543** instead of 5432 | Supabase's **transaction-mode** pooler hands a server connection back between statements, so it serves far more clients. This is the right setting for anything running more than one instance. |
| `DB_POOL_SIZE=5` | Fits two instances inside a 15-client pooler. |
| Run a single instance | Fewest moving parts, fine for a demonstration. |

The API warns at boot when its `DATABASE_URL` is a session-mode pooler, naming
the pool size and the remedy — because without it the only clue is in another
service's log.

## Going live

- [ ] Secrets provisioned in the secret manager, none of them a development value
- [ ] Every integration pointed at a real provider **and its mapping confirmed against that provider's sandbox** — see `docs/INTEGRATION-VERIFICATION.md`
- [ ] `VERIFICATION_BASE_URL` set to the real portal, over HTTPS — this is printed onto every certificate and cannot be corrected afterwards
- [ ] `DEMO_RELAX_DEVICE_BINDING` is **not** set — see *Running a demonstration*; it is device binding off, and a revoked handset that can be replaced unseen is a revocation that meant nothing
- [ ] `DATABASE_URL` is a transaction-mode pooler (port 6543), or `DB_POOL_SIZE` × the instance count fits the pooler's client limit — see *Sign-in times out*
- [ ] `VERIFICATION_BASE_URL` carries the `/portal` subpath, since `Dockerfile.agent` serves both front ends on one origin — see *One URL for both apps*. Without it every certificate QR code points at the agent app's sign-in form, and a printed certificate cannot be recalled
- [ ] `VITE_VERIFICATION_BASE_URL` set on the front-end service, with the same `/portal` subpath — a **different** variable, read at build time, and the only one that puts a QR code on a thermal paper receipt. Unset, receipts print with the code and no link; it needs a redeploy, not a restart
- [ ] `TRUST_PROXY` set to the number of proxies in front of the API — unset, every `keyBy: 'ip'` rate limit shares one bucket for all callers (the public citizen lookup is ten a minute) and the audit log records the proxy's address instead of the caller's. See *The address a request appears to come from*
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
