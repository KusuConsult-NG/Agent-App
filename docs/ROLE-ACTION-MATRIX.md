# Role-based action matrix

**For PSIRS sign-off.** This document states which role on the platform may do
what. It is the answer to §32 of the Officer Command Centre brief, and it is
generated from the code that enforces it rather than written alongside it.

## How to read it, and what it is worth

A hand-written matrix describes the system on the day somebody wrote it. This
one is derived from `ROLE_PERMISSIONS` in `packages/shared/src/rbac.ts` and
from the `requirePermission(...)` guards on every route, so it cannot describe
a delegation of authority the platform does not have. `npm run verify` rebuilds
it and fails if the committed version has drifted, which is the whole reason it
is worth signing: a matrix PSIRS has approved that no longer describes the
platform is worse than no matrix, because somebody is relying on it.

Three things it deliberately does not claim.

**It describes what PSIRS was given, not what PSIRS has since decided.** Since
migration 059 the role-to-permission map lives in the database, and an
administrator can grant or revoke from `/roles` under step-up. This document
reads the shipped map from source. The live one is `GET /government/roles`, and
every change to it is in the audit log.

**It cannot express authority that belongs to a row rather than to a role.** An
officer may work a case they opened or that is assigned to them without holding
`case:manage`; that is decided in `services/cases.ts`, because "mine" is a fact
about the case and not about the person. The same is true of an agent's own
records and an officer's own sessions.

**A permission is not a screen.** Reaching an endpoint is necessary and not
sufficient: territory scope narrows what a supervisor sees to their own
territories through `resolveReportScope`, a closed financial period refuses
writes at the database whoever is asking, and a blocked device holds no session
at all.

## What "verb" means here

The brief asks about eight verbs — view, create, edit, approve, reverse,
refund, export, configure. Each permission is filed under the verb in its own
name rather than under the one its subject suggests: `payment:reverse` is a
reversal whatever it is about, and `report:financial` is a view however
financial it sounds. A permission matching none of the eight is listed as
**Other** rather than forced into the nearest, because a matrix that files an
authority under the wrong verb is worse than one that admits the verb does not
fit.

<!-- BEGIN:GENERATED -->

## A. What each role may do, by verb

Counted from the shipped map. A role holding no permission of a verb is shown as `—`, which is a statement rather than an absence of data.

| Verb | agent | supervisor | revenue_officer | finance_officer | auditor | admin |
| --- | --- | --- | --- | --- | --- | --- |
| View | 13 | 16 | 21 | 18 | 19 | 21 |
| Create | 6 | 1 | 1 | 1 | 1 | 1 |
| Edit | 1 | 3 | 10 | 2 | 2 | 16 |
| Approve | — | 2 | 1 | 4 | 1 | 1 |
| Reverse | — | — | 1 | 1 | — | — |
| Refund | — | — | — | — | — | — |
| Export | — | 1 | 1 | 1 | 1 | 1 |
| Configure | — | 1 | 2 | 2 | 2 | 5 |
| Other | 3 | — | 4 | 1 | — | 4 |

## B. Every permission, who holds it, and what it opens

One row per permission in the catalogue. A permission no role holds is still listed: an authority nobody has is a decision, and one worth seeing.

**A dash in the last column means no route guard and no service check names this permission.** That is not the same as it doing nothing — an agent reading their own records is scoped by which agent is asking rather than by a permission — but it is the column to read first, because authority that looks real and confers nothing is the thing this table exists to expose. Generating it found one: `payment:reverse:request` was granted to two roles and checked nowhere, so any officer who could request an agent activation could request a payment reversal. It is enforced now.

| Permission | Verb | Held by | Endpoints |
| --- | --- | --- | --- |
| `taxpayer:read:assigned` | View | agent, supervisor | `GET /revenue/taxpayers/:id/obligations`<br>`GET /taxpayers/search`<br>`GET /taxpayers/:id`<br>`GET /taxpayers/:id/obligations` |
| `taxpayer:read:all` | View | revenue_officer, finance_officer, auditor, admin | `GET /government/revenue/defaulters`<br>`GET /government/taxpayers/analytics`<br>`GET /taxpayers/ended-with-arrears`<br>`GET /taxpayers/search`<br>…and 3 more |
| `taxpayer:create` | Create | agent | `POST /taxpayers/duplicate-check`<br>`POST /taxpayers/`<br>`POST /taxpayers/:id/tin`<br>`POST /drafts/sync` |
| `taxpayer:update` | Edit | agent, revenue_officer | `POST /taxpayers/:id/tin`<br>`PUT /taxpayers/:id/obligations` |
| `taxpayer:manage` | Edit | admin | `PUT /taxpayers/:id/obligations` |
| `taxpayer:correct` | Edit | revenue_officer, admin | `POST /government/intelligence/connections/:id/decision`<br>`POST /taxpayers/:id/identity`<br>`POST /taxpayers/:id/status` |
| `taxpayer:obligation:waive` | Other | revenue_officer, admin | `POST /taxpayers/`<br>`PUT /taxpayers/:id/obligations` |
| `group:register` | Create | agent | `POST /groups/`<br>`POST /groups/:id/members`<br>`POST /groups/:id/attestation-request` |
| `group:read:all` | View | revenue_officer, admin | `GET /groups/`<br>`GET /groups/:id`<br>`GET /groups/:id/members` |
| `group:read:own` | View | agent | `GET /groups/`<br>`GET /groups/:id`<br>`GET /groups/:id/members` |
| `group:manage` | Edit | revenue_officer, admin | `POST /government/enumeration/observations/:id/attest`<br>`POST /groups/`<br>`POST /groups/:id/review`<br>`POST /groups/:id/tax-role`<br>…and 3 more |
| `allocation:read:all` | View | revenue_officer, admin | `GET /rounds`<br>`GET /rounds/:id`<br>`GET /rounds/:id/awards` |
| `allocation:manage` | Edit | revenue_officer, admin | `POST /rounds`<br>`POST /rounds/:id/status`<br>`POST /rounds/:id/awards`<br>`POST /awards/:id/forfeit`<br>…and 1 more |
| `allocation:collect` | Other | agent | `GET /rounds`<br>`GET /rounds/:id`<br>`POST /collections` |
| `taxpayer:tin_sync` | Edit | revenue_officer, admin | `GET /taxpayers/tin-outstanding`<br>`POST /taxpayers/tin-retry` |
| `catalogue:read` | View | agent, supervisor, revenue_officer, finance_officer, auditor, admin | `GET /government/presumptive/schedule`<br>`POST /government/presumptive/preview`<br>`POST /government/presumptive/band`<br>`GET /government/search`<br>…and 4 more |
| `catalogue:configure` | Configure | revenue_officer, admin | `POST /government/presumptive/lga-classes`<br>`POST /government/presumptive/schedule`<br>`GET /government/audit/queries/rate-changes`<br>`GET /revenue/items`<br>…and 3 more |
| `assessment:create` | Create | agent | `POST /government/enumeration/observations`<br>`POST /government/enumeration/assessments/:id/object`<br>`POST /revenue/quote`<br>`POST /revenue/assessments` |
| `assessment:read:own` | View | agent | `GET /revenue/assessments/:id` |
| `assessment:read:all` | View | supervisor, revenue_officer, finance_officer, auditor, admin | `GET /revenue/assessments/:id` |
| `paye:file` | Other | revenue_officer, admin | `POST /government/paye/returns`<br>`POST /government/paye/returns/:id/cancel`<br>`POST /government/enumeration/observations`<br>`POST /government/enumeration/observations/:id/assess`<br>…and 1 more |
| `invoice:create` | Create | agent | — |
| `invoice:read:own` | View | agent | `GET /revenue/invoices/:id`<br>`POST /revenue/invoices/:id/document`<br>`GET /revenue/taxpayers/:id/obligations` |
| `invoice:read:all` | View | supervisor, revenue_officer, finance_officer, auditor, admin | `GET /revenue/invoices/:id`<br>`POST /revenue/invoices/:id/document`<br>`GET /revenue/taxpayers/:id/obligations` |
| `payment:initiate` | Create | agent | `POST /payments/initiate`<br>`POST /payments/:paymentId/confirm` |
| `payment:read:own` | View | agent | `GET /agents/me/transactions`<br>`GET /payments/transactions/:reference/status` |
| `payment:read:all` | View | supervisor, revenue_officer, finance_officer, auditor, admin | `GET /government/transactions`<br>`GET /government/refunds/outstanding`<br>`GET /government/transactions/:key/full`<br>`POST /payments/:paymentId/confirm`<br>…and 3 more |
| `payment:reconcile` | Configure | finance_officer | `POST /government/reconciliation/run`<br>`POST /government/reconciliation/recover`<br>`GET /government/reconciliation/awaiting-settlement`<br>`GET /government/reconciliation/exceptions`<br>…and 6 more |
| `payment:reverse:request` | Reverse | revenue_officer, finance_officer | `POST /government/approvals` |
| `payment:reverse:approve` | Approve | finance_officer | `POST /government/approvals/:id/execute-reversal` |
| `receipt:read:own` | View | agent | `GET /`<br>`GET /lookup`<br>`GET /:id` |
| `receipt:read:all` | View | supervisor, revenue_officer, finance_officer, auditor, admin | `GET /`<br>`GET /lookup`<br>`GET /:id`<br>decided in `services/investigation.ts` |
| `document:read:own` | View | agent | `GET /:id` |
| `document:read:all` | View | supervisor, revenue_officer, finance_officer, auditor, admin | `GET /:id`<br>decided in `services/cases.ts` |
| `vehicle:read:all` | View | agent, supervisor, revenue_officer, finance_officer, auditor, admin | `GET /vehicles/lookup/:registrationNumber`<br>`GET /vehicles/`<br>`POST /vehicles/renewals/:renewalId/document`<br>`GET /vehicles/renewals/:renewalId` |
| `vehicle:renew` | Create | agent | `POST /vehicles/`<br>`POST /vehicles/:id/renew`<br>`POST /vehicles/renewals/:renewalId/document` |
| `vehicle:authority_sync` | Other | revenue_officer, finance_officer, admin | `GET /vehicles/renewals/authority-outstanding`<br>`POST /vehicles/renewals/authority-retry` |
| `vehicle:manage` | Edit | revenue_officer, admin | `POST /vehicles/:vehicleId/status` |
| `agent:read:own` | View | agent | — |
| `agent:read:assigned` | View | supervisor | `GET /agents/`<br>`GET /agents/:id`<br>`GET /government/reference/territories` |
| `agent:read:all` | View | revenue_officer, finance_officer, auditor, admin | `GET /agents/:id/kyc/documents`<br>`GET /agents/kyc/documents/:id/file`<br>`GET /agents/bank-changes`<br>`GET /agents/`<br>…and 4 more |
| `agent:manage` | Edit | admin | `POST /agents/:agentId/bank/change`<br>`POST /agents/bank-changes/:approvalId/verify`<br>`POST /agents/:id/review`<br>`POST /agents/:id/activate`<br>…and 5 more |
| `agent:approve` | Approve | admin | `POST /agents/kyc/documents/:id/review`<br>`POST /agents/:id/review`<br>`POST /agents/:id/activate`<br>`POST /agents/referees/:refereeId/review` |
| `agent:suspend` | Configure | supervisor, revenue_officer, admin | `POST /agents/:id/suspend` |
| `agent:assign_territory` | Edit | supervisor, admin | `POST /agents/:id/territory` |
| `device:manage` | Edit | admin | `POST /agents/devices/:deviceId/revoke`<br>`POST /agents/devices/:deviceId/suspend`<br>`POST /agents/devices/:deviceId/restore`<br>`POST /agents/devices/:deviceId/approve` |
| `commission:read:own` | View | agent | `GET /agents/me/commission` |
| `commission:read:all` | View | supervisor, revenue_officer, finance_officer, auditor, admin | `GET /government/commissions/payouts`<br>`GET /government/commissions/by-place`<br>decided in `services/investigation.ts` |
| `commission:manage` | Edit | finance_officer, admin | `POST /government/commissions/promote`<br>`POST /government/commissions/payouts/:id/complete`<br>`POST /government/commissions/payouts/:id/fail` |
| `commission:payout:request` | Other | agent | `POST /agents/me/commission/payout` |
| `commission:payout:approve` | Approve | finance_officer | `POST /government/commissions/payouts/:id/approve` |
| `report:read:own` | View | agent | — |
| `report:read:territory` | View | supervisor | `GET /agents/performance`<br>`GET /government/dashboard`<br>`GET /government/arrears`<br>`GET /government/intelligence/leads`<br>…and 15 more |
| `report:read:all` | View | revenue_officer, finance_officer, auditor, admin | `GET /agents/performance`<br>`GET /government/dashboard`<br>`GET /government/arrears`<br>`GET /government/intelligence/leads`<br>…and 22 more |
| `report:financial` | View | finance_officer, auditor | `GET /government/reconciliation/awaiting-settlement`<br>`GET /government/settlements`<br>decided in `services/cases.ts`<br>decided in `services/investigation.ts` |
| `dashboard:executive` | View | revenue_officer, finance_officer, admin | `GET /government/dashboard`<br>`GET /government/revenue/by-category` |
| `fraud:read` | View | supervisor, revenue_officer, finance_officer, auditor, admin | `GET /government/leakage`<br>`GET /government/fraud/flags`<br>decided in `services/cases.ts`<br>decided in `services/investigation.ts` |
| `fraud:manage` | Edit | revenue_officer, admin | `POST /agents/referees/flags/:id/review`<br>`POST /government/fraud/flags/:id/review`<br>`POST /government/fraud/sweep` |
| `audit:read` | View | revenue_officer, finance_officer, auditor, admin | `GET /agents/kyc/documents/:id/access`<br>`GET /government/workers`<br>`GET /government/intelligence/taxpayers/:id/access-log`<br>`GET /government/reconciliation/awaiting-settlement`<br>…and 14 more |
| `audit:sample` | Configure | auditor | `POST /government/audit/samples`<br>`GET /government/audit/samples`<br>`GET /government/audit/samples/:id`<br>`POST /government/audit/samples/items/:id/finding`<br>…and 1 more |
| `audit:report` | Configure | auditor | `POST /government/audit/reports`<br>`GET /government/audit/reports`<br>`GET /government/audit/reports/:id`<br>`GET /government/audit/reports/:id/export`<br>…and 1 more |
| `audit:sign` | Approve | auditor | `POST /government/audit/reports/:id/sign` |
| `data:export` | Export | supervisor, revenue_officer, finance_officer, auditor, admin | `GET /government/audit/reports/:id/export` |
| `support:read:own` | View | agent | — |
| `support:read:all` | View | supervisor, revenue_officer, auditor, admin | decided in `services/support.ts` |
| `support:manage` | Edit | supervisor, revenue_officer, admin | `POST /government/reminders/send-due`<br>`POST /support/tickets/:id/update`<br>decided in `services/support.ts` |
| `incentive:read:all` | View | revenue_officer, auditor, admin | `GET /government/programmes`<br>`POST /government/programmes/:id/evaluate`<br>`GET /government/programmes/:id/beneficiaries`<br>`GET /taxpayers/:id/incentives` |
| `incentive:configure` | Configure | admin | `GET /government/programmes`<br>`POST /government/programmes`<br>`POST /government/programmes/:id/evaluate`<br>`POST /government/programmes/:id/status`<br>…and 1 more |
| `case:read:all` | View | supervisor, revenue_officer, finance_officer, auditor, admin | `GET /government/departments`<br>`GET /government/offices`<br>`GET /government/my-work`<br>`GET /government/cases`<br>…and 3 more |
| `case:create` | Create | supervisor, revenue_officer, finance_officer, auditor, admin | `POST /government/cases` |
| `case:contribute` | Edit | supervisor, revenue_officer, finance_officer, auditor, admin | `POST /government/cases/:id/comments`<br>`POST /government/cases/:id/evidence`<br>`POST /government/cases/:id/assign`<br>`POST /government/cases/:id/status`<br>…and 3 more |
| `case:manage` | Edit | auditor, admin | decided in `services/cases.ts` |
| `target:read:all` | View | supervisor, revenue_officer, finance_officer, auditor, admin | `GET /government/targets`<br>`GET /government/targets/rollup`<br>`GET /government/targets/period`<br>`GET /government/forecast` |
| `target:manage` | Edit | revenue_officer, admin | `POST /government/targets`<br>`POST /government/targets/:id/withdraw` |
| `period:read` | View | supervisor, revenue_officer, finance_officer, auditor, admin | `GET /government/periods`<br>`GET /government/periods/figures` |
| `period:close` | Configure | finance_officer | `POST /government/periods`<br>`POST /government/periods/:id/begin-closing`<br>`POST /government/periods/:id/close` |
| `period:reopen` | Configure | admin | `POST /government/periods/:id/reopen` |
| `approval:request` | Other | agent, revenue_officer, admin | `POST /government/approvals` |
| `approval:review` | Approve | supervisor, revenue_officer, finance_officer | `GET /agents/bank-changes`<br>`GET /government/enumeration/objections`<br>`POST /government/enumeration/objections/:id/decide`<br>`GET /government/approvals`<br>…and 2 more |
| `approval:authorise` | Approve | supervisor, finance_officer | `GET /government/approvals`<br>`POST /government/approvals/:id/decide`<br>decided in `services/cases.ts` |
| `system:configure` | Configure | admin | `POST /agents/app-version`<br>`GET /agents/app-version/history`<br>`POST /government/intelligence/rebuild`<br>`POST /government/presumptive/nano-policy`<br>…and 1 more |
| `user:manage` | Edit | admin | `GET /government/users`<br>`POST /government/users/:id/role`<br>`POST /government/users/:id/status`<br>`GET /government/users/:id/territories`<br>…and 18 more |

## C. Actions that need a second factor

Holding the permission is not enough for these: the officer confirms a one-time code first, and the grant is spent on one request.

- `commission.payout.request`
- `agent.bank_account.change`
- `taxpayer.identity.change`
- `catalogue.rate.change`
- `payment.reversal.approve`
- `agent.suspend`
- `user.role.change`
- `financial.period.close`
- `financial.period.reopen`
- `audit.report.sign`

<!-- END:GENERATED -->

## Signing off

The tables above are regenerated by `node scripts/build-action-matrix.mjs`.
Changes to who may do what are made in `packages/shared/src/rbac.ts` (for the
shipped map) or from `/roles` (for PSIRS's own decisions, which this document
does not show). Both are audited; neither is a document edit.
