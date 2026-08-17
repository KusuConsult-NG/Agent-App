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
| `GET` | `/referee/:token` | Open a referee invitation |
| `POST` | `/referee/:token/respond` | Submit referee verification |
| `POST` | `/referee/:token/decline` | Decline the request |
| `POST` | `/webhooks/payments` | Gateway webhook; HMAC-SHA512 signed, idempotent |
| `GET` | `/documents/:id/download?expires=&signature=` | Signed, expiring document URL |
| `GET` | `/health` | Liveness and database connectivity |

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
| `POST` | `/drafts/sync` · `GET` `/drafts` | offline draft queue |

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

There is deliberately **no** endpoint that sets a payment status.

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
