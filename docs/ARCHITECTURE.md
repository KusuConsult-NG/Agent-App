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
| Commission | `services/commission.ts` | Accrual, lifecycle, wallet, payouts, reversal cascade |
| Reconciliation | `services/reconciliation.ts` | Three-way matching, exception queue, settlement, reversal execution |
| Agents | `services/agents.ts` | Clearance pipeline, review, activation, devices |
| Referees | `services/referees.ts` | Nomination, tokenised invitation, response, clearance |
| Taxpayers | `services/taxpayers.ts` | Registration, duplicate control, TIN, search |
| Vehicles | `services/vehicles.ts` | Registry lookup, renewal, document issue |
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
```

### The mock gateway is deliberately a separate table

`mock_gateway_transactions` stands in for the payment processor's own books.
The revenue code never reads it directly — verification goes through
`integrations/gateway.ts` exactly as it would call a real gateway's API.

If verification consulted the platform's own `payments` table, the platform
would be marking its own homework, and PRD §95's "independently confirmed" would
be untrue by construction. Keeping the development gateway behind the same
adapter boundary means the production swap changes one file and nothing else.

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
