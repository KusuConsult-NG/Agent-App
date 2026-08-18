# PRD traceability

Every acceptance criterion from PRD §84 and Addendum §47, mapped to the code
that implements it and the test that proves it. Test names are from
`apps/api/src/tests/`.

## PRD §84 — Taxpayer

| Criterion | Implementation | Test |
|---|---|---|
| New taxpayer can be registered without TIN | `services/taxpayers.ts` `registerTaxpayer` | *registers a taxpayer and obtains a TIN from the TIN service* |
| System obtains TIN through approved integration | `integrations/tin/` — contract, HTTP adapter, mock | same |
| An unreachable TIN service never yields a duplicate | lookup UNAVAILABLE refuses the registration outright | *An unreachable TIN service never invents or duplicates a TIN* |
| A TIN is never invented | `assignedTin` — "success" with no usable number is PENDING, never ASSIGNED | *a TIN is never invented* |
| Outstanding TINs are chased | `retryOutstandingTins`, `GET /taxpayers/tin-outstanding` | *lists everyone still waiting, and chases them* |
| Duplicate taxpayer detection works | `findPotentialDuplicates`, scored with reasons | *blocks a decisive duplicate outright*; *warns on a weaker match and records the agent's decision* |
| Existing taxpayer can be found | `searchTaxpayers` (TIN, phone, name, vehicle, receipt, transaction) | *registers…* / portal + PWA search screens |
| Taxpayer can view revenue obligations | `getObligations`, `GET /revenue/taxpayers/:id/obligations` — read by the agent serving them, who tells them what is owed | covered by profile endpoint |

## PRD §84 — Revenue

| Criterion | Implementation | Test |
|---|---|---|
| Revenue categories configurable | `revenue_categories`, seeded from the PSIRS catalogue | seed asserts 9 categories, 37 items |
| Revenue items configurable | `POST /revenue/items` | — |
| Rates changed with effective dates | `POST /revenue/items/:id/rates` — closes old version, inserts new | *keeps historical assessments at their original rate after a rate change* |
| Assessment can be generated | `createAssessment` | *creates assessment, invoice and transaction as one obligation* |
| Invoice can be generated | same transaction | same |
| Payment can be initiated | `initiatePayment` | *initiates a payment without asserting any success* |
| Payment can be confirmed | `confirmPayment` | *verifies through a signed webhook and issues the receipt automatically* |
| Receipt automatically generated | `issueReceipt`, called from the verified branch only | same |
| Receipt downloadable as PDF | `renderReceiptPdf`, signed URL | *produces a downloadable PDF receipt with a QR verification code* |
| Receipt independently verifiable | `verifyPublicly` + checksum recomputation | *verifies the receipt publicly without exposing taxpayer data* |

## PRD §84 — Payments

| Criterion | Implementation | Test |
|---|---|---|
| Successful payment creates one transaction | partial unique index on `payments`; idempotency middleware | *replays the same response for a repeated idempotency key* |
| Duplicate webhook cannot create duplicate payment | `UNIQUE (gateway, event_id)`; duplicate acknowledged with 200 | *treats a redelivered webhook as a duplicate and creates nothing new* |
| Failed payment does not generate a valid receipt | `receipts_require_verified_payment` trigger | *refuses at database level to issue a receipt for an unverified payment* |
| Reversed payment updates all relevant records | `executeReversal` — transaction, receipt, invoice, commission in one transaction | *reverses transaction, receipt and commission together under approval* |
| Reconciliation works | `runReconciliation` three-way; refuses to run without the gateway's statement | *reports verified-but-unsettled money as pending settlement*; *marks the payment fully matched once government settlement is recorded*; *refuses to run, rather than accusing every payment in the window* |
| Reconciliation happens without being asked | `runScheduledReconciliation`, six-hourly over a trailing window | *sweeps on its own, attributed to the platform rather than a borrowed officer*; *recovers a payment the gateway took and no webhook ever reported* |

## PRD §84 — Agents

| Criterion | Implementation | Test |
|---|---|---|
| Agent can be approved | `reviewApplication` — reason mandatory | *approves the application and completes the remaining requirements* |
| Agent can be assigned territory | `POST /agents/:id/territory`; historical attribution preserved | *activates the agent only once every requirement is met* |
| Agent can onboard taxpayer | `requireActiveAgent` gate | *refuses revenue collection to an uncleared applicant* |
| Agent can facilitate payment | `POST /payments/initiate` | *initiates a payment…* |
| Agent can initiate vehicle renewal | `services/vehicles.ts` `initiateRenewal` | vehicle routes |
| Agent can view transaction history | `GET /agents/me/transactions` | PWA transactions screen |
| Commission automatically calculated | `accrueCommission` from the verified revenue figure | *computes 1.5% of government revenue without touching the taxpayer amount* |
| No commission on failed/reversed | `enforce_commission_requires_verified_revenue`; reversal cascade | *refuses to accrue commission before revenue is verified*; *reverses transaction, receipt and commission together* |

## PRD §84 — Vehicle

| Criterion | Implementation |
|---|---|
| Vehicle can be searched | `lookupVehicle` — platform, then authoritative registry |
| An unreachable registry is not read as "unregistered" | `VehicleLookupOutcome.UNAVAILABLE`; `authority_lookup_outcome` keeps it apart from a real NOT_FOUND |
| The authority is told about a renewal | `recordRenewal`; the outcome is recorded on `vehicle_renewals` and retried by `retryAuthorityNotifications` |
| Owner verified where integration permits | ownership check in `initiateRenewal`; `owner_verified` flag |
| Renewal fee calculated | catalogue formula item `VEH-RENEW-*` |
| Payment processed | same payment path as any other revenue |
| Renewal document generated | `completeRenewal` + `renewals_require_payment` trigger |
| Document downloadable as PDF | `renderVehicleDocumentPdf`, signed URL |
| Documents held in secure object storage | `services/storage/s3.ts`, private bucket, signed expiring URLs | *S3 storage: a document is stored, or it is not* |
| A document is never recorded as stored unless it was | status and ETag both checked before a reference is returned | *refuses to report a stored object when the store rejected it* |
| Document verifiable | shared `verifyPublicly` path |

## PRD §84 — Government

| Criterion | Implementation | Test |
|---|---|---|
| See all transactions | `GET /government/transactions` | *exports transactions as CSV* |
| Collections by agent | `agentPerformance`, dashboard | *reports collections by category, LGA, agent and MDA* |
| Collections by LGA | `revenueByLga`, `geographicIntelligence` | same; *drills down State → LGA → Ward* |
| Collections by revenue type | `revenueByCategory` | same |
| Reconcile payments | reconciliation module | reconciliation suite |
| Investigate exceptions | `exceptionQueue`, `resolveException` | — |
| View audit logs | `GET /government/audit` (+ CSV) | *verifies the audit hash chain end to end* |
| Suspend agents | `suspend` — sessions and devices cut immediately | *suspends an agent and stops them collecting immediately* |
| Configure revenue items | catalogue endpoints | *keeps historical assessments…* |
| Configure commission rates | `commission_policies`, versioned | *computes 1.5%…* |

## Addendum §47 — Clearance

| Criterion | Implementation | Test |
|---|---|---|
| Agent can submit an application | `POST /agents/apply` | *accepts an application and starts the applicant at stage 1* |
| Agent can complete KYC | `submitKyc` via provider | *clears identity KYC through the verification provider* |
| An unreachable provider is not read as a failed check | `KycOutcome.UNAVAILABLE`; `submitKyc` records nothing and raises 503 | *An unreachable identity provider is not a failed identity check* |
| KYC status tracked | `kyc_status` axis + `agent_kyc` history | same |
| Agent can nominate a referee | `nominateReferee` | *sends a tokenised referee invitation needing no account* |
| Referee receives secure invitation | token hashed at rest, expiring | same |
| Referee can verify identity | `submitRefereeResponse` | *lets the referee open and complete verification without signing in* |
| Referee can confirm relationship | four mandatory declarations | same (partial declarations rejected) |
| Referee clearance status tracked | `referee_status` axis + per-referee status | *moves to READY_FOR_REVIEW once identity and referee are both cleared* |
| Agent cannot become active while referee uncleared | CHECK constraint + `activationBlockers` | *will not let the database hold an active agent without clearance* |
| Cannot collect revenue while KYC uncleared | `requireActiveAgent` | *refuses revenue collection to an uncleared applicant* |
| Cannot collect while approval pending | same | same |
| Cannot collect before training completed | `activationBlockers` | *refuses activation while clearance items remain outstanding* |
| Bank account can be verified | `verifyBankAccount` via `integrations/banks/` | *approves the application and completes the remaining requirements* |
| An unreachable bank is not a wrong account | UNAVAILABLE leaves the account PENDING, never FAILED | *An unreachable bank is not an account belonging to someone else* |
| Commission cannot be paid to someone else | `matchesAccountName` — containment over name parts, ≥2 matching | *Bank account name matching* |
| Device can be registered | `registerDevice` | same |
| Government can approve/reject | `reviewApplication` | *requires a reason on every government decision* |
| Government can suspend | `suspend` | *suspends an agent…* |
| Government can revoke devices | `revokeDevice` | *revokes a device and ends its sessions immediately* |
| Every clearance decision audited | `agent_clearance_events` + audit chain | *verifies the audit hash chain* |
| Referee replacement supported | `replacesRefereeId`; original marked `REPLACED`, never overwritten | referee section of the PWA |
| KYC failure triggers corrective action | resubmission supersedes; notification queued | *clears identity KYC…* (failure path in `MockKycProvider`) |
| PWA works on mobile browsers | responsive, 48px targets, tested in Chromium | visual verification |
| PWA can be installed | manifest + service worker | — |
| PWA detects network status | `detectConnectionState` — ONLINE / LIMITED / OFFLINE | — |
| PWA supports offline workflows | IndexedDB draft queue; `submitOrQueue` keeps a capture when PSIRS cannot be reached | *accepts a draft registration and assigns server-generated ids on sync*; *a capture is never lost to a missing signal* |
| Vehicles can be captured offline | `VEHICLE_CAPTURE` draft; the authority is consulted at sync time | *creates the vehicle, and checks it with the authority, on sync* |
| A rejection is shown, not queued | `isConnectivityFailure` — only an unreachable server queues | *does not mistake a rejection for an outage* |
| Losing signal does not sign an agent out | `restoreSession` keeps the session on a connectivity failure | *telling "unreachable" apart from "refused"* |
| Agents stay signed in across app restarts | refresh token persisted to `localStorage`; access token stays in memory | *survives the app being closed and reopened* |
| A stolen token is useless on another device | refresh compares `x-device-id`; a mismatch revokes the session | *A persisted refresh token is bound to its device* |
| Possession is never permanent | `sessions.absolute_expires_at`, carried unchanged through rotation | *A session chain ends on a fixed date* |
| No draft is silently dropped | unprocessable types are REJECTED with a reason | *leaves no draft in a state nothing will ever process* |
| Citizen receives their receipt | `services/messaging/`, SMS as the citizen's only channel | *A notification is only recorded as sent if it was sent* |
| A message is never recorded as sent unless a provider took it | `notifications.provider` NOT NULL for SENT; migration 011 corrects the historical claims | *leaves no notification claiming delivery without a provider* |
| An outage does not exhaust the retry budget | UNAVAILABLE leaves the row QUEUED and does not increment attempts | *never marks a message sent when the provider could not be reached* |
| Offline cannot falsely mark payments successful | no payment draft type; `assertNotFinancial` runtime guard; SW never caches financial endpoints | *offers no offline path that can mark a payment as received*; *offline mode cannot authorise a payment* |
| Payment status recoverable after browser closure | `GET /payments/transactions/:reference/status` | *recovers the transaction status after the browser is closed* |
| PWA version enforcement | `requireSupportedAppVersion` | *blocks transactions from an unsupported app version* |

## PRD §36 — Access matrix containment

The §36 matrix is expressed as code in `packages/shared/src/rbac.ts` and
asserted endpoint by endpoint in `agent-scope.test.ts`.

| Matrix row | Implementation | Test |
|---|---|---|
| Agent → Taxpayer: *Assigned*, not All | `getTaxpayerProfile` returns `scope: AGENT_LIMITED`, filtered to the agent's own facilitated work | *does not expose another agent's collection history on the taxpayer profile* |
| Agent → Reports: *Limited* | agent holds `report:read:own` only; no LGA, ward or state-wide revenue | *refuses state and LGA revenue intelligence*; *reports own collections on the home screen, not the territory's* |
| Agent → Configuration: *No* | `catalogue:configure` withheld; rate history needs `audit:read` or `catalogue:configure` | *refuses to configure a revenue rate*; *refuses rate change history* |
| Agent → Agent: *Own* | `agent:read:own` only | *refuses to read another agent's clearance record* |
| Agent → Commission: *Own* | `commission:read:own`; wallet scoped by agent id | *reports only its own commission* |
| Incentives → taxpayer, never agent | agent holds no `incentive:*` permission | *holds no incentive permission — incentives belong to the taxpayer*; *refuses the taxpayer incentive record entirely* |
| Admin/officer → full view retained | unchanged permissions | *shows administration every agent's collections and every LGA* |

## PRD §88 — Definition of done

Items 1–31 are covered by the tables above. The remainder are deployment and
organisational tasks outside this repository:

| # | Item | Status |
|---|---|---|
| 32 | Database backups and disaster recovery | Deployment task; RPO ≤15 min / RTO ≤2 h to be agreed with government IT |
| 33 | Production monitoring | Deployment task; health endpoint and structured logging in place |
| 34 | Payment reconciliation tested | Tested end to end against the development gateway. Against Remita the statement is built from per-RRR status queries unless `REMITA_STATEMENT_PATH` is configured; either way a statement that cannot be read aborts the run instead of producing exceptions |
| 35 | Security testing completed | Independent testing not performed |
| 36 | User acceptance testing | Requires PSIRS officers |
| 37 | Financial test transactions reconciled end to end | Done in the integration suite |
| 38 | Government officers trained | Organisational |
| 39 | Agents completed onboarding/training | Training module implemented; delivery is organisational |
| 40 | Production support procedures documented | Organisational |

## Explicitly out of scope (PRD §86)

AI chatbot, predictive analytics, ML fraud detection, gamification, citizen
super-app, cryptocurrency, blockchain, GIS heat maps, loyalty marketplace — all
correctly absent. The fraud engine is deterministic rules with stated
thresholds, which is auditable and explainable to a suspended agent in a way a
model is not.

## PRD §42 / §85 — taxpayer portal: superseded

The PRD asks for a taxpayer-facing portal (§42) and marks it SHOULD in the §85
matrix. The service does not work that way: citizens are approached by an
authorised agent who onboards them or helps them remit, so a citizen holds no
account.

That deliberate departure is implemented rather than merely documented:

| Was | Now |
|---|---|
| `POST /auth/register` — public, unauthenticated | removed |
| `taxpayer` role with 15 permissions incl. `payment:initiate` | removed from `ROLES` |
| `taxpayer:read:own`, `vehicle:read:own`, `incentive:read:own` | removed — no role held them |
| `channel = 'TAXPAYER_PORTAL'` | removed from the CHECK constraint |
| `source = 'SELF_SERVICE'` | removed from the CHECK constraint |
| `users.role` admitting `'taxpayer'` | removed from the CHECK constraint |

Migration `007_agent_mediated_only.sql` performs the narrowing and refuses to
run if any affected row exists, naming the count rather than failing opaquely.

What §43 asks for is unaffected and remains the citizen's channel: public
receipt verification, requiring no account.
