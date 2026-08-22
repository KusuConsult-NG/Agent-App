# API reference

Base path `/api/v1`. All responses are JSON except document downloads (PDF) and
report exports (CSV).

## Conventions

**Money** is always a decimal string of kobo (`"500000"` = ₦5,000.00). Never a
JSON number — `JSON.parse` silently rounds large integers.

**Headers**

| Header | Purpose |
|---|---|
| `Authorization: Bearer <token>` | Access token |
| `Idempotency-Key` | Required on payment initiation, recommended on all creates |
| `X-Device-Id` | Agent device identifier; required for revenue endpoints |
| `X-App-Version` | PWA build; enforced against the minimum supported version |
| `X-Request-Id` | Optional correlation id; echoed on the response |

**Errors** carry an explicit money status:

```json
{ "error": {
    "code": "PAYMENT_UNCONFIRMED",
    "message": "…plain language the agent can act on…",
    "moneyStatus": "NOT_DEBITED | UNCONFIRMED | RECEIVED | NOT_APPLICABLE",
    "reference": "TXN-2026-000123",
    "nextStep": "…",
    "details": [{ "field": "phone", "issue": "…" }]
} }
```

---

## Public (no authentication)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/reference/lgas` | Plateau's 17 LGAs; needed before sign-in |
| `GET` | `/reference/wards?lgaId=` | Wards within an LGA |
| `GET` | `/verify/:code` | Receipt or document verification; minimal fields only |
| `GET` | `/citizen-status?tin=` · `?phone=` · `?name=` | A person's own status check; withholds what a stranger must not learn — see below |
| `GET` | `/group-attestation/:token` | Open a group membership check |
| `GET` | `/referee/:token` | Open a referee invitation |
| `POST` | `/referee/:token/respond` | Submit referee verification |
| `POST` | `/referee/:token/decline` | Decline the request |
| `POST` | `/webhooks/payments` | Gateway webhook; HMAC-SHA512 signed, idempotent |
| `GET` | `/documents/:id/download?expires=&signature=` | Signed, expiring document URL |
| `GET` | `/health` | Liveness and database connectivity |

### What `/citizen-status` withholds

The status check is deliberately open: a citizen with a feature phone and no
account has to be able to find out whether they owe anything. The price of
that openness is that the endpoint cannot tell the taxpayer apart from anyone
else who knows their phone number, and a phone number is not a secret.

So it answers `found`, `tinStatus`, `complianceStatus`, `hasOutstanding`, a
`message` and a `detail` telling the reader where to go — and nothing else.
It does **not** return the TIN, the numeric compliance score, the obligation
names, the last payment date, the outstanding amount, or the list of
programmes the taxpayer qualifies for.

Each of those was withheld for a reason. Returning the TIN would hand a
government identifier to a caller who supplied only a phone number, and this
platform's own duplicate detection treats a matching TIN as identity-grade
where a shared phone is merely suggestive. The score and the programme list
decide access to fertiliser, health insurance and farm inputs, so a person's
score is nobody else's business. Obligation names describe a livelihood.

A name-only search never returns a record at all: it answers with a count and
tells the reader to use their TIN or phone number.

The full record remains available through the agent and officer APIs, which
establish who they are speaking to first. Rate limited to 10 requests per
minute per IP.

### Changing the account commission is paid into

The destination of somebody else's money is what an attacker wants to move, so
no single control is trusted with it. A change passes through five:

1. **A step-up code with the request.** `agent.bank_account.change` proves
   possession of the phone rather than a live session, so a signed-in browser
   on a stolen laptop gets no further.
2. **The bank's own confirmation.** The proposed account is created as a
   `PROPOSED` row and verified against the bank immediately, before an officer
   sees it. The resolved account name is the evidence an officer weighs, and it
   is shown beside the name the agent gave. `UNAVAILABLE` is not a soft yes —
   the proposal waits, and `POST /agents/bank-changes/:approvalId/verify` asks
   again.
3. **A second officer.** The change is carried by a `BANK_ACCOUNT_CHANGE`
   approval, decided through `POST /government/approvals/:id/decide`. The
   officer who raised it can never decide it. In practice the roles separate
   structurally too: `agent:manage` (who may raise one on an agent's behalf)
   and `approval:authorise` (who may authorise it) are held by different roles.
4. **No payout in flight.** A change is refused while the agent has a payout in
   `REQUESTED` or `APPROVED` state, at both the request and the execution step.
   Settle first, then move the account.
5. **The agent is told.** A message goes to the number already on their record
   — never one supplied with the request — the moment a change is *requested*,
   so a change somebody else asked for is noticed while it is still a proposal.

The decision and the change are one transaction. If execution refuses, the
approval rolls back with it: an approval is never recorded for a change that
did not happen.

The previous account becomes `SUPERSEDED` rather than being overwritten, and
the new row records `replaces_account_id`, so the chain of where money went is
walkable. Account numbers are masked (`····4321`) in every response, in the
approval payload and in the audit log.

## Authentication

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/login` | Phone + password; binds device when `X-Device-Id` present |
| `POST` | `/auth/refresh` | Rotates the refresh token |
| `POST` | `/auth/logout` · `/auth/logout-all` | Revoke this session / all sessions |
| `POST` | `/auth/otp/request` · `/auth/otp/verify` | One-time codes |
| `POST` | `/auth/step-up` | Grant for one high-risk action, consumed on use |
| `GET` | `/auth/me` | Current identity and permissions |

There is no self-registration endpoint. Citizens hold no account: an authorised
agent approaches them to onboard them or to help them remit. Agents enter through
`POST /agents/apply`, which begins the clearance pipeline rather than issuing a
usable login; government users are provisioned by an administrator.

## Agents

| Method | Path | Permission |
|---|---|---|
| `POST` | `/agents/apply` | public |
| `GET` | `/agents/me/application` | own |
| `POST` | `/agents/me/kyc` | own |
| `POST` | `/agents/me/referees` | own |
| `GET`/`POST` | `/agents/me/training[/:moduleCode]` | own |
| `GET` | `/agents/agreement` · `POST` `/agents/me/agreement` | own |
| `POST` | `/agents/me/bank/verify` | own |
| `GET` | `/agents/me/bank/change` | own — the proposal waiting, if any |
| `POST` | `/agents/me/bank/change` | own — **step-up** `agent.bank_account.change` |
| `POST` | `/agents/:agentId/bank/change` | `agent:manage` — **step-up**; raised on an agent's behalf |
| `GET` | `/agents/bank-changes` | `agent:read:all` or `approval:review` |
| `POST` | `/agents/bank-changes/:approvalId/verify` | `agent:manage` — ask the bank again |

### Step-up actions, and the routes that enforce them

`STEP_UP_ACTIONS` names every operation that needs a fresh one-time code as
well as the permission. All seven are now enforced by a route:

| Action | Route | Also requires |
|---|---|---|
| `commission.payout.request` | `POST /agents/me/commission/payout` | own agent record |
| `agent.bank_account.change` | `POST /agents/me/bank/change` · `/agents/:agentId/bank/change` | `agent:manage` for the officer-raised form |
| `agent.suspend` | `POST /agents/:id/suspend` | `agent:manage` |
| `catalogue.rate.change` | `POST /revenue/items/:id/rates` | `catalogue:manage` |
| `payment.reversal.approve` | `POST /government/payments/:id/reverse` | `payment:reverse` |
| `taxpayer.identity.change` | `POST /taxpayers/:id/identity` | `taxpayer:correct`; the identity *document* additionally needs `taxpayer:manage` |
| `user.role.change` | `POST /government/users/:id/role` | `user:manage`; never your own role |

#### Correcting a taxpayer record

`POST /taxpayers/:id/identity` alters only the fields supplied, and refuses a
request that would change nothing. Two tiers, because two different things are
being changed:

- **What the record says about a person** — names, date of birth, gender.
  `taxpayer:correct`, which revenue officers and administrators hold.
- **Which person the record is about** — `identityType` and `identityNumber`.
  Additionally `taxpayer:manage`, so administrators only. The identity hash is
  what duplicate detection blocks on, and a change is refused if the new number
  already belongs to another active taxpayer.

Agents hold `taxpayer:update` but not `taxpayer:correct`: an agent who notices
a misspelling raises it through support, so that somebody who did not capture
the record decides. The identity number is never written to the audit log —
the masked form is. The taxpayer is sent a message saying their record was
corrected.

#### Changing an officer's role

`POST /government/users/:id/role` sets the role and **ends every session the
user holds, in the same transaction**. The role travels in the access token, so
a demotion whose revocation happened separately would leave the old permissions
working until the token expired — precisely the window that matters when
somebody is demoted for cause. `GET /government/users` lists the officers whose
access can be changed.

Nobody may change their own role, and nobody may be moved in or out of `agent`:
agent access follows the clearance pipeline, and activation or suspension is
how it changes.
| `POST` | `/agents/me/devices` | own, requires government approval first |
| `GET` | `/agents/app-version` | version gate (Addendum §43) |
| `GET` | `/agents/me/home` · `/me/transactions` · `/me/commission` | own |
| `POST` | `/agents/me/commission/payout` | `commission:payout:request` + step-up |
| `GET` | `/agents` · `/agents/:id` | `agent:read:all` |
| `GET` | `/agents/kyc-dashboard` · `/referee-dashboard` · `/performance` | `agent:read:all` |
| `POST` | `/agents/:id/review` | `agent:approve` — reason required |
| `POST` | `/agents/:id/activate` | `agent:manage` — refused while items outstanding |
| `POST` | `/agents/:id/suspend` | `agent:suspend` + step-up |
| `POST` | `/agents/:id/territory` | `agent:assign_territory` |
| `POST` | `/agents/devices/:id/approve` · `/revoke` | `device:manage` |
| `POST` | `/agents/referees/:id/review` | `agent:approve` |

## Taxpayers

| Method | Path | Permission |
|---|---|---|
| `POST` | `/taxpayers/duplicate-check` | `taxpayer:create` |
| `POST` | `/taxpayers` | `taxpayer:create` + active agent |
| `POST` | `/taxpayers/:id/tin` | `taxpayer:create` |
| `GET` | `/taxpayers/search` | `taxpayer:read:*` |
| `GET` | `/taxpayers/:id` · `/:id/incentives` | `taxpayer:read:*` |
| `POST` | `/drafts/sync` · `GET` `/drafts` | offline draft queue — `TAXPAYER_REGISTRATION` and `VEHICLE_CAPTURE` only |

## Revenue

| Method | Path | Permission |
|---|---|---|
| `GET` | `/revenue/authorities` · `/categories` · `/items` | `catalogue:read` |
| `GET` | `/revenue/items/:id/rates` | `catalogue:read` |
| `POST` | `/revenue/items` | `catalogue:configure` |
| `POST` | `/revenue/items/:id/rates` | `catalogue:configure` + step-up |
| `POST` | `/revenue/quote` | price without creating anything |
| `POST` | `/revenue/assessments` | `assessment:create` + active agent |
| `GET` | `/revenue/assessments/:id` · `/invoices/:id` | read |
| `POST` | `/revenue/invoices/:id/document` | render invoice PDF |
| `GET` | `/revenue/taxpayers/:id/obligations` | outstanding invoices |

## Payments, receipts, vehicles

| Method | Path | Notes |
|---|---|---|
| `POST` | `/payments/initiate` | `Idempotency-Key` required |
| `POST` | `/payments/:id/confirm` | asks the gateway; returns whatever it says |
| `GET` | `/payments/transactions/:reference/status` | authoritative recovery (Addendum §44) |
| `GET` | `/payments` | `payment:read:all` |
| `POST` | `/payments/simulate` | development gateway only |
| `GET` | `/receipts` · `/receipts/lookup?number=` · `/receipts/:id` | receipt numbers contain `/`, so lookup by number uses a query parameter |
| `GET` | `/documents/:id` | metadata plus a signed download URL |
| `GET` | `/vehicles/lookup/:registrationNumber` | platform, then authority; `source` is `PLATFORM`, `AUTHORITY`, `NOT_FOUND` or `REGISTRY_UNAVAILABLE` |
| `POST` | `/vehicles` · `/vehicles/:id/renew` | `vehicle:renew`; capture returns `authorityOutcome` (`FOUND` / `NOT_FOUND` / `UNAVAILABLE`) |
| `POST` | `/vehicles/renewals/:id/document` | issue or re-fetch the renewal PDF |
| `GET` | `/vehicles/renewals/authority-outstanding` | `vehicle:authority_sync` — renewals the authority never acknowledged, and vehicles captured while it was unreachable |
| `POST` | `/vehicles/renewals/authority-retry` | `vehicle:authority_sync` — re-send those notifications; changes no financial record |

`REGISTRY_UNAVAILABLE` is not `NOT_FOUND`. The first says the vehicle authority
could not be asked; the second says it answered and holds no such vehicle. A
client that renders them the same way will tell an agent that a registered
vehicle is unregistered whenever the authority has an outage.

Identity verification carries the same distinction: `POST /agents/me/kyc`
returns **503 `KYC_PROVIDER_UNAVAILABLE`** when the provider could not be
reached. That is not a failed identity check — nothing is recorded against the
applicant and their application is unchanged. It is safe and correct to retry.

`POST /agents/me/bank/verify` returns `outcome` — `VERIFIED`, `MISMATCH`,
`NOT_FOUND` or `UNAVAILABLE`. Only the middle two are the agent's to correct;
`UNAVAILABLE` leaves the account `PENDING` rather than `FAILED` and should be
retried.

`POST /taxpayers` returns **503 `TIN_SERVICE_UNAVAILABLE`** when an
`existingTin` could not be confirmed, and registers nothing. Do **not** retry it
as a new TIN application — that mints a second TIN for someone who already has
one. Registration *without* an `existingTin` still succeeds during a TIN outage:
the taxpayer is recorded with `tinStatus: "REQUESTED"` and can be assessed and
pay while the number is chased.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/taxpayers/tin-outstanding` | `taxpayer:tin_sync` — who is still without a TIN, and why |
| `POST` | `/taxpayers/tin-retry` | `taxpayer:tin_sync` — re-ask the TIN service for all of them |

There is deliberately **no** endpoint that sets a payment status.

### Offline drafts

`POST /drafts/sync` accepts captures taken without a connection. `draftType` is
`TAXPAYER_REGISTRATION` or `VEHICLE_CAPTURE`; there is no payment member, so
Addendum §23's rule that offline mode must never authorise a government revenue
payment is enforced by the enum rather than by handling. Anything else is a 422.

`clientReference` is the idempotency key. Replaying a sync after a dropped
connection returns `DUPLICATE` with the original `entityId` rather than creating
a second record.

Each draft comes back as exactly one of:

| `status` | Meaning |
|---|---|
| `SYNCED` | created; `entityType` and `entityId` are the server-assigned identifiers |
| `DUPLICATE` | already synchronised; nothing was created |
| `REJECTED` | not accepted, with the reason in `message` — the draft is kept server-side with that reason |

There is no "stored for later" status. A draft the server accepts but cannot
process would be a lost capture wearing the costume of a successful one.

## Government

| Method | Path | Permission |
|---|---|---|
| `GET` | `/government/dashboard` · `/kpis` | `report:read:all` |
| `GET` | `/government/intelligence/geography` | drill State → LGA → Ward → Community |
| `GET` | `/government/transactions?format=json\|csv` | `payment:read:all` |
| `POST` | `/government/reconciliation/run` · `/recover` | `payment:reconcile` |
| `GET` | `/government/reconciliation/exceptions` | exception queue |
| `POST` | `/government/reconciliation/exceptions/:id/resolve` | resolution required |
| `GET`/`POST` | `/government/settlements` | `payment:reconcile` |
| `GET`/`POST` | `/government/approvals` | maker-checker |
| `POST` | `/government/approvals/:id/decide` | requester may never decide |
| `POST` | `/government/approvals/:id/execute-reversal` | `payment:reverse:approve` + step-up; approver may not execute |
| `POST` | `/government/commissions/promote` | `commission:manage` |
| `GET` | `/government/commissions/payouts` | `commission:read:all` |
| `POST` | `/government/commissions/payouts/:id/approve` · `/complete` | segregation of duties |
| `GET` | `/government/leakage` · `/fraud/flags` | `fraud:read` |
| `POST` | `/government/fraud/flags/:id/review` · `/fraud/sweep` | `fraud:manage` |
| `GET` | `/government/audit?format=json\|csv` | `audit:read` |
| `GET` | `/government/audit/verify` | replays the hash chain |
| `GET` | `/government/audit/queries/*` | the PRD §67 questions, as endpoints |
| `GET`/`POST` | `/government/programmes` | `incentive:*` |
| `GET` | `/government/reference/territories` | `agent:read:*` |
| `GET` | `/government/platform/integrations` | source-of-truth map |
| `POST`/`GET` | `/support/tickets` | support and complaints |

### PRD §67 audit queries

| Question | Endpoint |
|---|---|
| Every transaction by agent X between two dates | `/government/audit/queries/agent-transactions` |
| All transactions reversed after successful payment | `/government/audit/queries/reversed-after-success` |
| All changes made to revenue rates | `/government/audit/queries/rate-changes` |
| All users who accessed taxpayer record X | `/government/audit/queries/taxpayer-access` |
| All receipts generated for a revenue item | `/government/audit/queries/receipts-by-item` |
| All payments from LGA X | `/government/transactions?lgaId=` |
| All commission paid to agent X | `/government/commissions/payouts` |

## Worked example

```bash
# 1. Price the obligation — nothing is created
curl -X POST localhost:4000/api/v1/revenue/quote \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"revenueItemId":"'$ITEM'","inputs":{}}'
# → { "amountKobo": "500000", "trace": [ … how it was calculated … ] }

# 2. Create assessment + invoice + transaction atomically
curl -X POST localhost:4000/api/v1/revenue/assessments \
  -H "authorization: Bearer $TOKEN" -H "idempotency-key: $(uuidgen)" \
  -H "x-device-id: $DEVICE" -H 'content-type: application/json' \
  -d '{"taxpayerId":"'$TP'","revenueItemId":"'$ITEM'","inputs":{}}'

# 3. Start the payment — an intent, not a success
curl -X POST localhost:4000/api/v1/payments/initiate \
  -H "authorization: Bearer $TOKEN" -H "idempotency-key: $(uuidgen)" \
  -H "x-device-id: $DEVICE" -H 'content-type: application/json' \
  -d '{"transactionId":"'$TXN'","paymentMethod":"CARD"}'

# 4. Ask whether the money actually arrived
curl -X POST localhost:4000/api/v1/payments/$PAYMENT/confirm \
  -H "authorization: Bearer $TOKEN" -H "x-device-id: $DEVICE"
# → 200 with receiptNumber, or 202 PAYMENT_UNCONFIRMED with moneyStatus UNCONFIRMED

# 5. Anyone can verify the receipt, with no account
curl localhost:4000/api/v1/verify/$RECEIPT_CODE
```
