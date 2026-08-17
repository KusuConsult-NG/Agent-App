# Plateau State Digital Grassroots Revenue & Taxpayer Services Platform

[![CI](https://github.com/KusuConsult-NG/Agent-App/actions/workflows/ci.yml/badge.svg)](https://github.com/KusuConsult-NG/Agent-App/actions/workflows/ci.yml)

An implementation of the PSIRS grassroots revenue collection PRD and its Agent
KYC / Referee Clearance / PWA addendum.

The platform lets authorised agents deliver government revenue services in the
field — taxpayer registration, TIN onboarding, assessment, payment, receipts and
vehicle renewals — while giving government real-time visibility and control over
every naira.

---

## The rule everything else follows

> **No person, including an agent, can make a government revenue transaction
> appear successful unless the underlying payment has been independently
> confirmed by the payment infrastructure.** (PRD §95)

That is not a convention here. It is enforced in four independent places, so
defeating any one of them is not enough:

| Layer | Control |
|---|---|
| Database trigger | `receipts_require_verified_payment` refuses to insert a receipt unless the linked payment is `VERIFIED`, belongs to the same transaction and matches the amount — for *any* caller, including a DBA at a psql prompt |
| State machine | `RECEIPT_GENERATED` is reachable only from `PAYMENT_VERIFIED`; no edge exists from `FAILED` or `PAYMENT_PENDING` |
| Service layer | `confirmPayment()` is the only function that can mark a payment verified, and it takes no status argument from any caller — it asks the gateway |
| API surface | There is no endpoint that sets a payment status. "Confirm" asks the server to go and verify |

The same shape applies to the addendum's four rules:

```
No KYC + No Referee Clearance  →  No Agent Activation
No Agent Activation            →  No Access to Revenue Collection
No Verified Payment            →  No Government Receipt
No Government Receipt          →  No Commission
```

Each is enforced by a database constraint *and* a service check *and* a
middleware gate. The integration test suite proves each one by attempting the
violation directly against the database.

---

## What is in the repository

```
apps/
  api/          Node.js + TypeScript + Express + PostgreSQL — the revenue engine
  agent/        Agent PWA (React + Vite), mobile-first, installable, offline-aware
  portal/       Government administration portal (React + Vite)
                — also hosts the public receipt verification and referee portals
packages/
  shared/       Money, state machines, RBAC matrix, agent lifecycle — one source
                of truth for the API and both front-ends
docs/           Architecture, security model, API reference, PRD traceability
```

---

## Running it

Requires Node.js 22 and PostgreSQL 14+. (Node 22 is what the platform is
developed against and what CI verifies; earlier versions are untested.)

```bash
npm install
createdb psirs                       # or: psql -c 'CREATE DATABASE psirs;'

cp .env.example .env                 # then set DATABASE_URL and the three secrets
npm run migrate                      # applies migrations in order, with checksums
npm run seed -- --demo               # Plateau geography, PSIRS catalogue, demo officers
npm run seed -- --demo --demo-agent  # …and one cleared, active field agent

npm run dev:api                      # http://localhost:4000
npm run dev:agent                    # http://localhost:5173  (agent PWA)
npm run dev:portal                   # http://localhost:5174  (government portal)
```

The `.env` at the repository root is read by the API, the migration runner and
the seed alike. Anything already set in your shell wins over the file, so
exporting a variable for one command still works and a deployment that injects
its own secrets is never overridden by a file that happens to be present.

Each of those commands prints the database it is about to write to, without the
password. Worth a glance before seeding: `migrate` and `seed` are the two that
change a database, and the whole point of naming it is that migrating the wrong
one used to look exactly like migrating the right one.

The seed prints sign-in details. The five government roles go to the **portal**
on :5174; the agent goes to the **PWA** on :5173. Signing into the agent app
with a government account answers "An agent profile for this account could not
be found", because those users have no agent record — that is the two
applications being genuinely separate, not a bug.

`--demo-agent` does not insert an agent. It cannot: the
`agent_activation_requires_clearance` constraint refuses an active agent that
has not cleared, and that rule is the point of the platform. Instead it walks an
applicant through the real pipeline using the same service calls the HTTP routes
make — application, KYC, referee nomination and response, government approval,
training, bank verification, agreement, device, activation — so the agent it
produces is active because it earned it. If a clearance step ever breaks, the
seed fails rather than handing you an agent that could not exist in production.

### Tests

```bash
createdb psirs_test
npm test        # 353 tests: API (318) + agent PWA offline, session and refresh (35)
```

The integration suites run against a real PostgreSQL database and the real HTTP
surface. They do not mock the repository layer, because the guarantees under
test live in database triggers and constraints — a test with a mocked database
would verify nothing that matters. The suite ignores any `.env` for the same
reason it truncates between cases: it must never be pointed at a database
someone is working in.

### Continuous integration

`.github/workflows/ci.yml` runs on every pull request and every push to `main`,
against a real PostgreSQL 16 service container. In order:

| Step | What it protects |
|---|---|
| `npm ci` | The lockfile resolves and installs cleanly |
| Build shared package | `apps/api` can resolve `@psirs/shared` |
| `npm run typecheck` | Source *and tests* typecheck — `tsx` strips types without checking them, so test files are covered by `tsconfig.test.json` and nothing else |
| `npm run migrate` | Migrations apply to an empty database |
| `npm run migrate` again | Migrations are idempotent, and no applied migration was edited in place (the runner compares checksums and refuses) |
| `npm run seed -- --demo` | Reference data and the PSIRS catalogue load |
| `npm test` | All 340 tests — every database-level integrity control, and the PWA offline capture queue |
| `npm run build` | All four workspaces compile, including both front-ends, and the SQL migrations are copied into the API's output |
| Start the built artefact | `node dist/server.js` boots, applies migrations and answers `/health` — the suite runs the *source* through `tsx`, so nothing else checks that what gets deployed can start |
| Dirty-tree check | No build artefact is tracked |

Because the platform's guarantees are database triggers, CI without a database
would be theatre. The service container is the point of the pipeline.

### Dependency updates

`.github/dependabot.yml` raises weekly updates for npm and for the GitHub
Actions themselves. Minor and patch updates are grouped — a stream of individual
PRs for routine bumps gets rubber-stamped, and rubber-stamping is how a
compromised transitive dependency reaches production.

Major updates are deliberately *not* grouped. The runtime dependencies here are
the database driver, the HTTP layer, session signing, password hashing, request
validation and government document rendering; a breaking change in any of them
gets its own PR with the full suite attached, rather than a line in a batch.

Every such PR runs the CI workflow above. That works on Dependabot's restricted
token specifically because the workflow needs no repository secrets — its test
credentials are inline throwaway values.

---

## The end-to-end flow, as implemented

```
Agent applies
   ↓  identity KYC through the verification provider
   ↓  referee nominated → tokenised link → referee verifies (no account needed)
   ↓  government review (reason required)
   ↓  training · bank verification · agreement · device registration
   ↓  ACTIVATION — refused while any item is outstanding
Agent registers taxpayer  → duplicate detection → TIN from the PSIRS TIN service
   ↓
Assessment  → amount computed from the catalogue rate version, with a trace
   ↓
Invoice     → unique number, QR verification code, shown to the taxpayer first
   ↓
Payment     → gateway; the platform records an intent, never a success
   ↓
Gateway confirms  → signed webhook, or server-side verification poll
   ↓
Payment VERIFIED  → receipt issued automatically, PDF rendered, QR generated
   ↓
Commission accrued at 1.5% of government revenue (never deducted from it)
   ↓
Reconciliation: platform ↔ gateway ↔ government settlement
   ↓
Settlement confirmed → transaction SETTLED → commission becomes eligible
   ↓
Payout requested (step-up auth) → approved by a different officer → paid
```

Every step writes a hash-chained audit entry. Any step can be reversed under
maker-checker approval, and a reversal cascades to the receipt, the invoice and
the commission in one transaction.

---

## Financial integrity, concretely

**Money is never a floating-point number.** Every amount is an integer of kobo,
carried as `bigint` in the domain and `BIGINT` in PostgreSQL, and crossing the
wire as a decimal *string* — because `JSON.parse` silently rounds large numbers.
`packages/shared/src/money.ts` is the only place money arithmetic happens.

**Financial records are append-only.** `prevent_delete()` is attached to every
table carrying money or evidence of money. Corrections are made by reversal or
by a superseding row, never by erasing history. `prevent_column_mutation()`
freezes amounts, references and attribution at creation.

**Rates are versioned, never overwritten.** Changing a rate closes the current
version with an `effective_to` and inserts a new one. An assessment stores the
id of the exact rate version it used, so a ₦10,000 transaction stays a ₦10,000
transaction after the rate rises to ₦15,000 — and an auditor can re-run the
arithmetic years later from the stored inputs and trace.

**The audit log is a hash chain.** Each entry's digest covers its own content
plus the previous entry's digest. Editing or deleting any historical row breaks
every link after it, and `GET /government/audit/verify` replays the chain so
government can check this for itself rather than taking it on trust. (The
digest is computed over canonicalised JSON, because PostgreSQL's JSONB does not
preserve key order.)

**Idempotency is enforced at the backend.** A repeated `Idempotency-Key`
replays the original response verbatim; a duplicate webhook is detected by a
unique `(gateway, event_id)` and acknowledged without creating anything. Two
concurrent confirmations of one payment are serialised by an advisory lock
inside a `SERIALIZABLE` transaction.

**Government revenue and agent commission never touch.** They are separate
columns in separate tables. There is no code path that subtracts commission from
a taxpayer's payment, because commission is computed *from* the revenue figure
and written to its own ledger.

---

## Errors that a field agent can act on

PRD §60 forbids vague failures, and on a payment platform an ambiguous error is
a financial hazard: an agent who cannot tell whether money moved will collect
twice. Every error carries an explicit money status:

```json
{
  "error": {
    "code": "PAYMENT_UNCONFIRMED",
    "message": "Payment could not be confirmed yet. The money has NOT been marked as received. Do not ask the taxpayer to pay again — check this transaction again in a few minutes.",
    "moneyStatus": "UNCONFIRMED",
    "reference": "TXN-2026-000123",
    "nextStep": "Open the transaction from your history to see its current status."
  }
}
```

`moneyStatus` is one of `NOT_DEBITED`, `UNCONFIRMED`, `RECEIVED` or
`NOT_APPLICABLE`, and both front-ends render it as its own line.

---

## How a citizen reaches the service

Through an agent. There is no citizen portal, and that is the operating model
rather than a gap: an authorised agent approaches the citizen — to onboard them,
or to help them remit a tax or levy — and does the work on their behalf.

A citizen therefore holds **no account**. There is no self-registration
endpoint, no `taxpayer` role, and `users.role` will not accept one; migration
007 narrowed the constraint so a citizen login is unrepresentable rather than
merely unused. Nothing can be phished, hijacked or compromised into raising an
assessment, because there is nothing to sign in to.

What the citizen does get is evidence and a way to check it:

- their **receipt by SMS** the moment payment is confirmed, and
- **public verification** at `/verify/:code` — no account, no login — which
  confirms the receipt against government records and re-checks the stored
  PDF's checksum (PRD §43).

So the citizen can always prove what they paid and confirm a receipt is genuine.
They just never log in to do it.

## Who sees what

The agent application is a field tool, not a window into government. The two
audiences are separated by permission, and the separation is asserted endpoint
by endpoint in `apps/api/src/tests/agent-scope.test.ts`.

| | Agent | Government |
|---|---|---|
| Own collections, own commission, own taxpayers onboarded | ✓ | ✓ |
| Onboarding: KYC, referee, training, device, agreement | ✓ (own) | ✓ (all) |
| Find a taxpayer and see what they owe | ✓ | ✓ |
| Transactions and receipts **another agent** facilitated | ✗ | ✓ |
| LGA, ward or state-wide revenue | ✗ | ✓ |
| Other agents' figures, performance league table | ✗ | ✓ |
| Reconciliation, settlements, approvals, payouts | ✗ | ✓ |
| Audit log, rate-change history, fraud flags | ✗ | ✓ |
| Revenue rate configuration | ✗ | ✓ (with step-up) |
| Taxpayer compliance score and incentive programmes | ✗ | ✓ |

**Incentives are mapped to the taxpayer, not the agent.** The compliance score
and social programme eligibility belong to the taxpayer, and are visible to the
taxpayer, to revenue officers and to auditors. The agent role holds no
`incentive:*` permission at all. What an agent earns is *commission* — a
separate ledger, computed from verified revenue, in its own wallet.

A taxpayer profile fetched by an agent returns `scope: "AGENT_LIMITED"` and
carries only the work that agent facilitated; the same profile fetched by an
officer returns `scope: "FULL"`. The client is told which view it received, so a
partial history can never be mistaken for a complete one.

## The agent PWA

Installable, mobile-first, and honest about connectivity. It distinguishes
**Online**, **Poor connection** and **Offline** — the middle state matters
because on a weak rural link `navigator.onLine` still reports `true`, and an
agent who believes they are fully online will start a payment that hangs.

### Collecting without a connection

Plateau's grassroots revenue work happens where the network is worst, so the app
collects data with no signal at all. Two kinds of capture work offline —
**taxpayer registration** and **vehicle capture** — and both follow the same
rule: *the agent should never have to think about the network.*

Pressing **Register** offline does not fail. The capture is written to IndexedDB
under a client-generated reference that doubles as the server's idempotency key,
and the agent is told plainly what has and has not happened. It syncs by itself
when the connection returns, through Background Sync where the browser has it
and on reconnect where it does not, and the server assigns the real identifiers
(PRD §30).

What is *not* caught is a rejection. A duplicate, a missing field, a TIN that
could not be confirmed — those are PSIRS answering, and they are shown to the
agent immediately, because the moment to correct a capture is while the citizen
is still standing there. `isConnectivityFailure` draws that line, and it is
narrow on purpose: a 503 from an *upstream* service (`TIN_SERVICE_UNAVAILABLE`,
`KYC_PROVIDER_UNAVAILABLE`) is a real reply about a third party, not a lost
connection.

The forms work offline because the service worker caches what they need — LGAs,
wards, the revenue catalogue — while refusing to cache any financial endpoint.
Offline, those fail loudly with `moneyStatus: NOT_DEBITED`, because a cached
"PAYMENT SUCCESSFUL" screen is worse than no screen.

**Offline mode cannot authorise a payment.** There is no draft type for one, so
it is inexpressible; and because the queue is the single place where the agent's
own device writes data the server later replays, there is a runtime guard on top
of the type system: a payload carrying `amountKobo`, `paymentId`,
`gatewayReference`, `receiptNumber` or anything of that shape is refused before
it is either sent or stored. Both halves are tested.

Every stored draft reaches a real outcome. A draft the server cannot process is
rejected in the agent's face with its reason kept — never stored as "pending"
where nothing will look at it again, which is a lost capture wearing the costume
of a successful one.

**Losing signal never signs an agent out.** A refresh that cannot reach PSIRS
tells us nothing about whether the session is still valid, and throwing the
agent out on that guess would strand them — signing back in needs the very
connection that is missing. Only a refusal ends a session.

**Closing the app does not end the session.** The refresh token is persisted, so
an agent who shuts the app to save battery and reopens it in a village with no
signal is still signed in and can keep collecting. The access token — the thing
that actually authorises a request — stays in memory and is never written down,
and no taxpayer data is persisted: captures live in the draft queue and are
deleted the moment the server confirms them.

That persistence is a deliberate, bounded exception to Addendum §22, and it is
paid for on the server, where a control can actually be enforced:

| Bound | Effect |
|---|---|
| A refresh token only works on the device it was issued to | A token lifted off a lost handset is useless elsewhere — and presenting it from another device **revokes the session**, because an agent's own device identifier is stable, so a mismatch is evidence of copying rather than a mistake |
| A session chain has an absolute expiry | Refreshing rolls the 14-day token forward but never moves the 30-day bound set at password sign-in, so possession is never a permanent credential |
| Central revocation | Sign-out, device revocation and agent suspension all end it immediately |

The client keeps its own copy of the absolute bound and refuses to restore a
session past it, so a phone found months later has nothing usable on it even
before reaching a network. That is a convenience; the server is the control.

If the browser closes mid-payment, reopening the app and reading the transaction
recovers the authoritative state from the server, including the receipt.

---

## The payment gateway

PSIRS collects through **Remita**, the channel most Nigerian government revenue
runs on. `apps/api/src/integrations/gateways/remita.ts` implements the gateway
contract; the revenue code imports `gateway` and never names a provider, so the
choice is configuration plus one adapter.

Remita's model shapes the adapter in three ways:

- **The RRR is the artefact.** Initiating a payment generates a Remita Retrieval
  Reference, payable afterwards at any bank, ATM, POS, USSD or online channel —
  possibly days later, with no browser involved. "Initiate" means an obligation
  now has a payable reference, not that a payer is sitting at a checkout.
- **Amounts are Naira decimals**, and this platform is integer kobo throughout.
  Every crossing converts explicitly, in one place each way, with tests — a
  silent hundred-fold error here would be the most expensive bug in the codebase.
- **Callbacks are not signed.** Remita notifies with an RRR and expects a status
  query. That is already this platform's model: a webhook is a prompt to go and
  ask, never an instruction to believe. A forged notification can do no more than
  make the platform ask Remita about a reference and act on Remita's answer.

Two behaviours are deliberately conservative, because they concern money:

| Situation | Result | Why |
|---|---|---|
| Status code not in the configured success **or** failure list | `PENDING` | An unmapped code can then neither invent revenue nor close a transaction the taxpayer did pay. It surfaces in reconciliation instead of being guessed at. |
| Remita reports success with no usable amount | `UNKNOWN` | A receipt is issued against a verified amount; a zero would be a fabricated figure. |

Before go-live, `REMITA_SERVICE_TYPE_ID` and the full status-code list must be
confirmed against PSIRS's own Remita sandbox — both vary by merchant
configuration. `config.ts` refuses to start in production with Remita selected
but unconfigured, or still pointing at the demo host.

## The integrations, and the answer none of them may invent

Four integrations answer questions about the world outside the platform: is this
applicant who they say they are, does this taxpayer already hold a TIN, does the
state hold a record of this vehicle, and does this bank account belong to this
agent. Each is a contract, a configurable HTTP adapter and a labelled
development mock under `apps/api/src/integrations/`.

**"We could not ask" is not an answer.** Every contract carries an outcome that
describes the provider rather than the subject, because collapsing the two is
what turns an upstream outage into a permanent, wrong fact in a government
register:

| `UNAVAILABLE` from | Means | Must never mean |
|---|---|---|
| identity verification | the KYC service could not be reached | this applicant failed identity verification |
| the TIN service | PSIRS's TIN service could not be reached | this taxpayer has no TIN — the answer that mints a duplicate |
| the vehicle authority | the registry could not be reached | this vehicle is not registered |
| the bank | name enquiry could not be reached | this account belongs to someone else |

None of those is a cosmetic distinction. A KYC outage mapped to `FAILED` rejects
legitimate applicants and leaves rejections indistinguishable from genuine
identity mismatches. A TIN lookup that reports "not found" during an outage
leads the agent to register a *second* TIN for someone who already has one — in
a UNIQUE column, on a row that cannot be deleted, permanently. A registry outage
makes every vehicle in Plateau State look unregistered. A bank outage puts a
clearance blocker on an agent's record that reads like the account is somebody
else's.

So the platform acts on the distinction rather than merely recording it. Each
caller does something different, because what has already happened differs:

- **`submitKyc` writes nothing at all.** It raises `KYC_PROVIDER_UNAVAILABLE`
  (503) and the transaction rolls back *including the supersede*, so no attempt
  is consumed and the applicant's existing submission survives. They are told it
  was not about their details.
- **A referee's `UNAVAILABLE` is deliberately *not* rolled back** — they have
  already spent their single-use invitation. It goes to `UNDER_REVIEW`, and the
  recorded reason says the check never ran.
- **A TIN lookup stops the registration entirely**, with a next step that says,
  in those words, *do not* register this taxpayer as a new applicant.
- **A TIN registration still registers the taxpayer.** Blocking would halt field
  work during an outage, the taxpayer record is a fact this platform owns, and an
  assessment needs no TIN — so they are served today and the number is chased
  later. It lands in `REQUESTED`, never `FAILED`.
- **`UNAVAILABLE` can never set `authority_verified_at`.** The vehicle is
  captured with `authority_lookup_outcome = 'UNAVAILABLE'`, keeping "never
  checked" apart from "checked, not registered" — both are `MANUAL_ENTRY`, so
  `source` alone cannot tell them apart.
- **A bank account goes to `PENDING`, not `FAILED`**, with the reason recorded.
- **The agent sees the difference.** "The vehicle authority could not be reached,
  so we cannot say whether this vehicle is registered" is a different screen,
  with a retry button, from "no record of this vehicle".

Every adapter maps its vendor's vocabulary and field names through
configuration, because vendors disagree about both and a procurement decision
should not need a code change. What configuration cannot do is weaken the
guarantees:

- an unmapped KYC status becomes `UNDER_REVIEW` — a human decides, never an
  automatic clearance;
- a TIN reply of "success" carrying a blank, null or malformed number is
  `PENDING`, never `ASSIGNED`;
- any registry response that is not an explicit "no such vehicle" is
  `UNAVAILABLE` rather than being read as one;
- whether a bank's resolved name is the agent's is decided by one tested rule,
  `matchesAccountName`, not by each vendor.

That last one is worth reading. It has to tolerate how Nigerian banks actually
return names — "MUSA DANLADI" for Danladi Musa, middle names appearing and
disappearing, "Ngo'ale" stored as NGOALE — without ever accepting a different
person, because it decides where an agent's commission is paid. The rule is
order-independent containment with at least two matching name parts, so a single
shared surname is never enough.

### Catching up once the service is back

An unanswered question is only worth recording if something acts on it later:

| Queue | Retry | Permission |
|---|---|---|
| `GET /taxpayers/tin-outstanding` | `POST /taxpayers/tin-retry` | `taxpayer:tin_sync` |
| `GET /vehicles/renewals/authority-outstanding` | `POST /vehicles/renewals/authority-retry` | `vehicle:authority_sync` |

Neither permission is held by any agent. Renewals are told to the vehicle
authority after payment, and a renewal it never acknowledged stays `COMPLETED` —
the taxpayer paid and holds a valid document — while remaining outstanding for
the government to chase.

## Documents and the message a citizen actually receives

Two things stood between this and a deployment that boots, and both were
unwritten code rather than configuration.

**Receipts now go to object storage.** `services/storage/` selects on
`STORAGE_DRIVER`; there is an S3-compatible driver alongside the development
local one. SigV4 is signed here rather than pulled in — every other outbound
integration in this codebase speaks plain `fetch`, the AWS SDK would be by far
the largest dependency in the tree for one PUT, one GET and one HEAD, and
signing by hand keeps the driver genuinely provider-neutral: MinIO, Backblaze
and DigitalOcean Spaces all accept SigV4, and a state deployment may not be on
AWS.

The driver will not report an object as stored unless the store confirmed it —
status *and* the returned ETag against the MD5 of what was sent. A returned
reference is a promise: the caller writes it against a receipt and tells the
taxpayer they can download their proof of payment, so a reference for an object
that is not there turns a successful payment into a citizen who cannot show they
paid.

**SMS and email are now actually sent.** This is the more serious of the two.
`dispatchQueued` used to log the message when the provider was `mock`, then mark
every notification `SENT` with `provider_reference = mock-<id>` *regardless of
what was configured*. Nothing was ever delivered and the `notifications` table
said otherwise — the same failure this platform exists to prevent, applied to
the one artefact a citizen holds.

It matters because the citizen has no account here. An agent approaches them;
there is no portal to log into and no inbox to fall back on. The SMS carrying
their receipt number and verification code is their only proof of payment and
their only route to checking it against government records.

So the three outcomes are kept apart, and a notification is `SENT` only when a
provider accepted it:

| Outcome | Recorded as | Why |
|---|---|---|
| Provider accepted | `SENT` with its real reference — never a fabricated one | |
| Provider refused | `FAILED` immediately | A malformed number does not become deliverable by being tried four more times |
| Provider unreachable | stays `QUEUED`, **and does not consume an attempt** | Five sweeps during a gateway outage would permanently fail a message the provider never saw |

Migration 011 adds `notifications.provider`, so a row can only claim `SENT`
alongside the service that accepted it — and it marks the existing fabricated
rows `FAILED` with the reason, because an operator seeing which citizens were
never told beats one of them asking for a receipt nobody sent.
`undeliveredNotifications` is the queue that follows from that.

Both providers are configurable HTTP adapters, and both are named in the
production boot guard: `SMS_PROVIDER=mock` or `STORAGE_DRIVER=local` in
production stops the process rather than quietly running.

## Source of truth

PRD §82 requires the architecture to state which system owns which fact. The
platform integrates rather than duplicating, and refuses to boot in production
while any integration is still a development mock:

| Fact | Authoritative source |
|---|---|
| TIN | PSIRS TIN service |
| Revenue rates | Government configuration in this platform, under approval workflow |
| Payment status | Payment gateway, confirmed by reconciliation |
| Receipt | This platform |
| Vehicle record | Authorised vehicle registration authority |
| Identity | Government identity service |

`GET /government/platform/integrations` returns this map and the currently
configured adapters.

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — modules, data model, state machines, integration boundaries
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model, anti-leakage controls, data protection
- [`docs/API.md`](docs/API.md) — endpoint reference
- [`docs/PRD-TRACEABILITY.md`](docs/PRD-TRACEABILITY.md) — every PRD and addendum acceptance criterion, mapped to the code and test that satisfies it

---

## Status

Every acceptance criterion in PRD §84 and Addendum §47 is implemented and
covered by a test. What remains before a production deployment is integration
and operations work, not feature work:

- point all five adapters at PSIRS's approved providers. Each is configuration —
  `PAYMENT_GATEWAY`, `TIN_SERVICE`, `KYC_PROVIDER`, `VEHICLE_REGISTRY`,
  `BANK_VERIFICATION` plus the settings in `.env.example` — not a code change.
  **What must still come from PSIRS and the vendors is the mapping**: each
  service's field names, its status vocabulary, the Remita service type ID and
  status codes, and the PSIRS TIN format. Every one of those has a documented
  setting and a fail-closed default, but they need confirming against each
  sandbox before go-live, because a wrong mapping is the one thing configuration
  can still get wrong;
- provision secrets, object storage, backups and monitoring;
- complete security testing and user acceptance testing with PSIRS;
- agree final RPO/RTO targets with government IT.

`apps/api/src/config.ts` refuses to start in production while any adapter is
still `mock`, so a half-configured deployment fails loudly at boot rather than
quietly accepting payments nobody ever made.
