# Architecture

## Shape

```
┌──────────────┐   ┌──────────────┐   ┌───────────────────┐
│  Agent PWA   │   │   Portal     │   │ Public surfaces   │
│  (mobile)    │   │  (desktop)   │   │ verify · referee  │
└──────┬───────┘   └──────┬───────┘   └─────────┬─────────┘
       │                  │                     │
       └──────────────────┴─────────────────────┘
                          │  HTTPS, JWT, device binding, version gate
                 ┌────────▼─────────┐
                 │  API (Express)   │
                 │  routes →        │
                 │  services →      │
                 │  PostgreSQL      │
                 └────────┬─────────┘
                          │
   ┌──────────────────────┼──────────────────────┐
   │                      │                      │
┌──▼────────┐   ┌─────────▼────────┐   ┌─────────▼─────────┐
│ PSIRS TIN │   │ Payment gateway  │   │ Vehicle registry  │
│ service   │   │ + webhooks       │   │ · KYC · bank      │
└───────────┘   └──────────────────┘   └───────────────────┘
```

Three layers, strictly ordered. Routes validate and authorise; services hold the
domain rules and own transactions; the database holds the invariants that must
survive a bug in either layer above it.

## Why the database carries the controls

The controls that matter here are the ones that hold when application code is
wrong. A receipt for an unverified payment is not a bug to be caught in review —
it is the exact fraud the platform exists to prevent. So the rule lives in a
trigger:

```sql
CREATE TRIGGER receipts_require_verified_payment BEFORE INSERT ON receipts
  FOR EACH ROW EXECUTE FUNCTION enforce_receipt_requires_verified_payment();
```

That holds for the API, a migration, a maintenance script, and a person with a
psql prompt. The same reasoning produces:

| Control | Mechanism |
|---|---|
| No financial record is deleted | `prevent_delete()` on every money-bearing table |
| Amounts and references are frozen | `prevent_column_mutation('amount_kobo', …)` |
| Audit log is append-only | `prevent_any_update()` + `prevent_delete()` |
| One commission per transaction | `UNIQUE (transaction_id)` on `commissions` |
| One payment in flight per transaction | partial unique index on `payments` |
| No duplicate webhook processing | `UNIQUE (gateway, event_id)` |
| Commission needs verified revenue | `enforce_commission_requires_verified_revenue()` |
| Commission paid needs a payout reference | `enforce_commission_payment_evidence()` |
| Active agent needs full clearance | `CHECK agent_activation_requires_clearance` |
| Maker ≠ checker ≠ approver | `CHECK` constraints on `approvals` |

## Modules

| Module | Location | Responsibility |
|---|---|---|
| Money & state | `packages/shared` | Kobo arithmetic, state machines, RBAC matrix, agent lifecycle derivation |
| Rate engine | `services/rate-engine.ts` | Fixed / percentage / tiered / formula evaluation, with a stored trace |
| Revenue | `services/revenue.ts` | Catalogue, assessment, invoice, transaction state transitions |
| Payments | `services/payments.ts` | Intent, independent verification, idempotent webhooks |
| Receipts | `services/receipts.ts` | Issue (gated), public verification |
| Documents | `services/documents.ts` | PDF rendering, QR, checksum registration |
| Storage | `services/storage/` | Driver selection, S3-compatible object store with SigV4, signed URLs |
| Messaging | `services/messaging/` | SMS and email delivery — the citizen's only channel |
| Commission | `services/commission.ts` | Accrual, lifecycle, wallet, payouts, reversal cascade |
| Reconciliation | `services/reconciliation.ts` | Three-way matching, exception queue, settlement, reversal execution |
| Agents | `services/agents.ts` | Clearance pipeline, review, activation, devices |
| Referees | `services/referees.ts` | Nomination, tokenised invitation, response, clearance |
| Taxpayers | `services/taxpayers.ts` | Registration, duplicate control, TIN, TIN catch-up, search |
| Vehicles | `services/vehicles.ts` | Registry lookup, renewal, document issue, authority catch-up |
| Fraud | `services/fraud.ts` | Signal detection, leakage dashboard |
| Incentives | `services/incentives.ts` | Compliance scoring, programme eligibility |
| Reports | `services/reports.ts` | Dashboards, intelligence, §67 audit queries |
| Audit | `services/audit.ts` | Hash-chained journal and verification |

## Data model

Migrations are applied in order with checksums; an already-applied migration
that changes is a hard failure, because a schema drift between environments is
a financial risk on this platform.

```
001_foundation   integrity primitives, geography, users, sessions, audit chain,
                 idempotency, approvals, app versions, settings
002_identity     taxpayers, bank accounts, territories, agents (six status axes),
                 agent KYC, KYC documents, referees, referee KYC, invitations,
                 clearance + events, agreements, training, devices, referee risk
003_revenue      authorities, MDAs, categories, items, versioned rates,
                 assessments, invoices, number sequences
004_financial    transactions + events, payments, webhook events, receipts,
                 documents + access logs, vehicles, vehicle renewals
005_operations   commission policies, settlements, commissions, payouts,
                 reconciliation, refunds, fraud flags, compliance, programmes,
                 notifications, support, offline drafts, verification attempts
006_mock_gateway development-only gateway ledger (see below)
007_agent_mediated_only
                 narrows users.role, transactions.channel and taxpayers.source —
                 a citizen account becomes unrepresentable, not merely unused
008_authority_notification
                 whether the vehicle authority was told about a renewal, and
                 whether a captured vehicle was ever actually checked
009_unanswered_questions
                 why a taxpayer has no TIN yet and why a bank account is not
                 verified — an outage recorded as an outage, not as a refusal
010_session_absolute_expiry
                 a session chain that ends on a fixed date, however often it is
                 refreshed
011_notification_delivery
                 which service accepted a message; a row can no longer claim
                 SENT without naming one
```

### Gateway adapters

One gateway is active per deployment, selected by `PAYMENT_GATEWAY`:

| Adapter | Signs callbacks | Settlement statement | Use |
|---|---|---|---|
| `gateways/remita.ts` | no — notifies with an RRR, expects a status query | not yet wired (see below) | PSIRS collections |
| `gateways/mock.ts` | yes (HMAC-SHA512) | from the development ledger | development, tests |

The revenue code imports `gateway` and never names a provider. Webhook
authentication is part of the adapter rather than the handler, because gateways
genuinely differ: the mock refuses an unsigned delivery, while Remita accepts
one — safely, because in this architecture a callback only ever prompts the
platform to go and ask the gateway what happened.

Remita's settlement reporting depends on how PSIRS's merchant account is
configured, so `fetchStatement` returns nothing rather than guessing. The
consequence is explicit and is the correct failure mode for money: verified
payments appear as `MISSING_PAYMENT` exceptions in the finance queue, so finance
is told to look, instead of transactions being silently marked reconciled.

### The other four adapters

`integrations/tin/`, `kyc/`, `vehicles/` and `banks/` follow the same shape as
the gateway — a contract, a configurable HTTP adapter, a labelled development
mock — with one addition that shapes every caller.

Every contract carries an outcome that is about the *provider*, not the subject:

```
TIN       lookup    FOUND | NOT_FOUND | UNAVAILABLE
          register  ASSIGNED | PENDING | REJECTED | UNAVAILABLE
KYC       CLEARED | FAILED | UNDER_REVIEW | VERIFICATION_REQUIRED | UNAVAILABLE
registry  FOUND | NOT_FOUND | UNAVAILABLE
bank      VERIFIED | MISMATCH | NOT_FOUND | UNAVAILABLE

                              UNAVAILABLE is never a verdict
```

Adapters never throw on an upstream failure; they return the unavailable
outcome, so a caller cannot accidentally turn an outage into a 500 or, worse,
into a verdict. Throwing is reserved for programming errors.

| Boundary | Fails towards | Because |
|---|---|---|
| KYC status not in any configured list | `UNDER_REVIEW` | An unread vocabulary must put a human in the loop, never admit someone to collecting government revenue |
| KYC cleared but liveness failed | `UNDER_REVIEW` | A clearance resting on a check the provider says failed is not a clearance |
| Registry 200 whose shape we cannot read | `UNAVAILABLE` | A misconfigured record path stops vehicle capture loudly; the alternative silently records every vehicle in the state as unregistered |
| Registry 404, or a mapped not-found status | `NOT_FOUND` | These are the only two things that are actually the authority saying "no such vehicle" |
| TIN "success" carrying a blank, null or malformed number | `PENDING` | `taxpayers.tin` is UNIQUE on an undeletable row: a junk value is permanent *and* blocks the real number from ever landing |
| TIN status unmapped | `PENDING` | An unread vocabulary leaves the registration in flight to be chased, never declares an applicant refused |
| Bank resolved no account name | `UNAVAILABLE` | With no name there is nothing to compare, and an unverified account must not pass as verified |

The callers then differ, deliberately, because what has already happened
differs. An agent's own KYC rolls the whole transaction back on `UNAVAILABLE`
and records nothing — no attempt, no status change. A referee's does not: they
have already spent their single-use invitation, so the response is kept and
routed to an officer with a reason saying the check never ran. A TIN *lookup*
refuses the whole registration, because the alternative advice — "register them
as a new applicant" — mints a duplicate; a TIN *registration* lets the taxpayer
through, because they are real, the platform owns that record, and an assessment
needs no TIN.

Where the bank is concerned, note what the adapter does *not* decide. It
resolves the account and returns the name the bank holds; whether that is the
same person is `matchesAccountName` in `integrations/banks/types.ts` — one
tested rule rather than one per vendor, because it decides where an agent's
commission is paid. It is order-independent containment over normalised name
parts, requiring at least two to match, so a shared surname alone never passes.

`taxpayers.tin_reason`, `bank_accounts.verification_reason` and
`vehicles.authority_lookup_outcome` exist for the same reason. A vehicle
captured during an outage and a vehicle the authority confirmed it has no record
of are both `source = 'MANUAL_ENTRY'`, and only the first should ever be
re-checked. `vehicle_renewals.authority_notification_status` is its counterpart
on the way out: a renewal the authority was never told about stays valid for the
taxpayer and outstanding for the government.

### The mock gateway is deliberately a separate table

`mock_gateway_transactions` stands in for the payment processor's own books.
The revenue code never reads it directly — verification goes through
`integrations/gateway.ts` exactly as it would call a real gateway's API.

If verification consulted the platform's own `payments` table, the platform
would be marking its own homework, and PRD §95's "independently confirmed" would
be untrue by construction. Keeping the development gateway behind the same
adapter boundary means the production swap changes one file and nothing else.

## Offline capture

The agent PWA collects data with no connection, because Plateau's grassroots
revenue work happens where the network is worst. The design is one decision
applied twice.

**Unreachable is not refused.** `isConnectivityFailure` in `lib/api.ts` splits
the two, and everything else follows from it:

| Failure | Meaning | Response |
|---|---|---|
| `fetch` throws `TypeError` | never left the device | queue the capture |
| 503 `OFFLINE` from the service worker | never left the device | queue the capture |
| 409, 422, 403, 500 | PSIRS answered | show the agent, do not queue |
| 503 `TIN_SERVICE_UNAVAILABLE` / `KYC_PROVIDER_UNAVAILABLE` | PSIRS answered, about a third party | show the agent, do not queue |

That last row is the subtle one: those codes are 503 but they are replies, not
lost connections. Queueing them would defer a correction the agent could make
while the citizen is still in front of them.

`submitOrQueue` in `lib/drafts.ts` is where the split is applied — try to send,
keep it on the phone only if it could not be sent. It replaced a "Save for
later" button that the agent had to press *instead of* Register, which meant
offline capture only worked for an agent who had correctly predicted the
network.

The same distinction governs the session. A refresh that cannot reach PSIRS
leaves the session alone; only a refusal ends it. Signing an agent out because
the network dropped would strand them, since signing back in needs the
connection that is missing.

### Sessions that survive the app closing

For offline capture to be usable at all, an agent must stay signed in across app
restarts, so the refresh token is persisted to `localStorage`. The access token
— the credential that actually authorises a request — stays in memory and is
never written anywhere.

Persisting a refresh token is a real exposure, so it is bounded on the server
rather than trusted to the client:

```
sessions.expires_at           rolling   reset by every refresh   keeps an agent working
sessions.absolute_expires_at  fixed     set once at sign-in      ends the chain regardless
```

Before this, rotation reissued a 14-day expiry every time, so a session held by
whoever possessed the token never expired. The absolute bound is carried through
`createSession` unchanged on every rotation — recomputing it is the one thing
that would defeat it — and the rolling expiry is clamped so it can never outlast
it.

Refresh is also bound to the device. `sessions.device_id` was recorded at login
but never checked, so a token lifted off a handset worked anywhere. It is now
compared against the presented `x-device-id`, and a mismatch **revokes the
session** rather than merely refusing the attempt: the agent's own device
identifier lives in the same storage as the token, so a mismatch is not
something a legitimate agent produces.

Government users have no device to bind to, so sessions with no `device_id` are
not device-checked — requiring one would lock browser users out without
protecting anything.

### What may be captured, and what may not

```
TAXPAYER_REGISTRATION   a record of who someone is
VEHICLE_CAPTURE         a record of what a vehicle is

                        — and nothing else —
```

Both are records of something observed; neither moves money. There is no
payment draft type, so Addendum §23's rule is enforced by the type system rather
than by care. On top of that, `assertNotFinancial` refuses any payload carrying
`amountKobo`, `paymentId`, `gatewayReference`, `receiptNumber` and similar,
before the payload is either sent or stored — the queue is the one place the
agent's device writes data that the server later replays, so it gets a runtime
backstop as well as a compile-time one.

### Every draft reaches an outcome

A draft type the server cannot process is `REJECTED` with its reason recorded.
It used to be stored and reported as "stored for processing", which was untrue:
nothing processed it, the phone deleted its copy on the next sync, and the
capture vanished while every message said it had worked. The integration suite
now asserts that no draft is ever left in a state nothing will process.

A vehicle captured offline is checked against the authority *at sync time*,
which is when there is a connection — so being recorded in the field does not
leave it permanently unverified.

## Agent lifecycle

The addendum warns (§31) against a single generic `status` field. There are six
independent axes:

```
account_status      PENDING | ACTIVE | SUSPENDED | CLOSED
kyc_status          NOT_STARTED | SUBMITTED | UNDER_REVIEW | VERIFICATION_REQUIRED
                    | FAILED | CLEARED | SUSPENDED
referee_status      PENDING | CLEARED | FAILED
training_status     PENDING | IN_PROGRESS | COMPLETED
clearance_status    PENDING | READY_FOR_REVIEW | APPROVED | REJECTED | ACTION_REQUIRED
operational_status  INACTIVE | ACTIVE | SUSPENDED
```

The §40 application state is *derived* from these by `deriveApplicationState()`
and never stored as an independent truth, so the progress an applicant sees can
never disagree with the gate that guards collection.

The clearance checklist is likewise recomputed from evidence
(`refreshClearance()`) rather than set by whichever handler last ran — so a
referee who later fails verification automatically withdraws
`referee_cleared`, and the agent stops being activatable.

## Payment state machine

```
INITIATED → ASSESSMENT_CREATED → INVOICE_GENERATED → PAYMENT_INITIATED
   → PAYMENT_PENDING → PAYMENT_SUCCESSFUL → PAYMENT_VERIFIED
   → RECEIPT_GENERATED → RECONCILIATION_PENDING → SETTLED

branches: FAILED · CANCELLED · EXPIRED · UNDER_REVIEW · REVERSED · REFUNDED
```

Transitions are data (`TRANSACTION_TRANSITIONS`), not scattered conditionals, so
every state change passes one guard and every illegal transition is a loud,
audited failure. Two properties are load-bearing:

1. nothing reaches `PAYMENT_SUCCESSFUL` except through the gateway verification
   path;
2. `RECEIPT_GENERATED` is reachable only from `PAYMENT_VERIFIED`.

## Reconciliation

Three-way, and deliberately compared in both directions — comparing only
platform→gateway would miss the worst case, money the gateway holds for a
transaction the platform never recorded.

The settlement leg reads the platform's own `payments.settlement_id`, not the
gateway's statement line: money is reconciled only when government can see it in
its own account. A verified-but-unsettled payment is `PENDING_SETTLEMENT`, which
is a normal state, not an exception.

Reconciliation also recovers missed webhooks: a gateway line marked successful
against a payment the platform never verified is flagged recoverable, and
`recoverUnverifiedPayments()` verifies it and issues the receipt the taxpayer is
owed.

## Front-end architecture

Both apps are React + Vite with a ~40-line hash router and no state-management,
data-fetching or charting dependencies. That is a deliberate response to PRD §55
("low-bandwidth performance"): the agent bundle is 64 KB gzipped, and everything
is self-hosted so the CSP can forbid third-party origins entirely.

`packages/shared` is built to both CommonJS (for the API) and ESM (for the
bundlers) from one source, so money formatting, the RBAC matrix and the lifecycle
derivation cannot drift between server and client.

## Background work

The API runs three in-process workers: commission promotion (5 min),
notification dispatch (30 s), fraud sweep (15 min). In a multi-instance
deployment these move to a scheduler; they are separated from request handling
already, so that is a configuration change rather than a rewrite.
