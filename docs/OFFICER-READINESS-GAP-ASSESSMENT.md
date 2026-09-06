# Officer Readiness Gap Assessment

Every item in the Officer Command Centre brief, judged against what is in this
repository, with the file or endpoint that satisfies it named so a reviewer can
check the claim rather than take it.

Four verdicts, and the difference between them matters:

| Verdict | Means |
| --- | --- |
| **Complete** | Built, reachable by the roles that need it, and covered by a test. |
| **Partial** | The data or the endpoint exists; an officer cannot get the whole of it from a screen, or it is narrower than the brief asks. |
| **Missing** | Not built. |
| **Not tested** | Built, but nothing asserts it stays built. |

A "Partial" is not a near-miss. Most of them below are a query that exists on
the API and stops short of a screen — which is the same thing as absent to the
officer holding the tablet.

Assessed 6 September 2026, against `claude/officer-command-centre-admin-r5j0s8`.

---

## 1. Common platform foundation

| Item | Verdict | Evidence / gap |
| --- | --- | --- |
| Secure login | Complete | `apps/api/src/routes/auth.ts`, argon2 hashes, lockout after failed attempts |
| MFA / OTP | Complete | `POST /auth/otp/request`, `otp_codes`, plus step-up grants for named actions (`STEP_UP_ACTIONS`, `packages/shared/src/rbac.ts`) |
| Role-based permissions | Complete | `packages/shared/src/rbac.ts`; every route names a permission, never a role |
| Officer profile | Partial | `users` holds name, phone, email, role, status, last login. No department, no job title, no photograph |
| Department | Missing | No `department` on `users` and no department table. Roles stand in for departments today, which is why a case cannot be routed to Finance as a body |
| LGA / territory assignment | Complete | `user_territories`, managed at `/users` in the portal, enforced by `services/report-scope.ts` |
| Supervisor | Missing | No `supervisor_id` on `users`. The `supervisor` **role** exists; the reporting line does not, so nothing can escalate upwards automatically |
| Last login | Complete | `users.last_login_at`, shown on `/users` |
| Active sessions | Partial | `sessions` rows exist and `POST /auth/logout-all` revokes them. No officer can *see* their sessions, and no administrator can see or end another officer's |
| Device / session management | Partial | Full lifecycle for **agent** handsets (`agent_devices`, `/field-app`). Nothing equivalent for officers |
| Notifications | Partial | `services/notifications.ts` is outbound SMS to citizens and agents. There is no officer inbox — see §29 |
| Tasks | Complete | Case tasks and assignment, `apps/api/src/services/cases.ts`, `/cases` and `/my-work` in the portal |
| Alerts | Partial | Fraud flags, reconciliation exceptions and job failures each have their own screen; §29 gathers them into one place now, but a system alert (integration down, job stalled) still has to be read off `/government/workers` |
| Internal messages | Complete | Case comments and internal notes, with mentions, `case_events` |
| Search | Complete | `GET /government/search`, portal shell search box — see §5 |
| Saved filters | Missing | Every screen's filters are lost on navigation |
| Reports | Complete | `services/reports.ts`, 20+ report queries across dashboards, geography, agents, remittance |
| Export controls | Partial | CSV export exists on audit, transactions and remittance (`reports.toCsv`). Exports are audited, but there is no per-role export limit and no PDF or Excel |
| Activity history | Complete | `audit_logs` with a verified hash chain (`GET /government/audit/verify`) |
| Help / support | Complete | `support_tickets`, `/support` |

---

## 2. Admin executive dashboard

### Revenue overview

| Item | Verdict | Evidence / gap |
| --- | --- | --- |
| Total revenue | Complete | `reports.executiveDashboard` → `collections.total_kobo` |
| Today's revenue | Complete | `collections.today_kobo` |
| Yesterday's revenue | Missing | The dashboard's 30-day trend contains yesterday, but no figure is stated |
| This week | Complete | `collections.week_kobo` |
| This month | Complete | `collections.month_kobo` |
| This year | Complete | `collections.ytd_kobo` |
| Previous-period comparison | Missing | Nothing computes the prior period |
| Revenue growth / decline | Missing | Follows from the above |
| Revenue target | Missing | No target model anywhere in the schema |
| Target achievement | Missing | Follows |
| Outstanding assessments | Complete | `/outstanding`, `reports.defaultersByCategory` |
| Outstanding invoices | Complete | Same screen, unpaid invoice ageing |
| Successful payments | Complete | `counts.successful_transactions` |
| Failed payments | Complete | `counts.failed_transactions` |
| Reversed payments | Partial | Counted per agent in `agentPerformance`; not on the executive dashboard |
| Refunded payments | Partial | `refunds` table and `/government/refunds/outstanding`; no headline figure |

### Revenue breakdown

| Item | Verdict | Evidence / gap |
| --- | --- | --- |
| By category | Complete | `revenueByCategory` |
| By subcategory | Partial | `revenue_items` sit under categories and `GET /government/revenue/by-category` drills to the item; the dashboard stops at the category |
| By MDA | Complete | `revenueByMda`, `reports.revenueByMda` |
| By LGA | Complete | `revenueByLga` |
| By ward | Complete | `reports.geographicIntelligence` with `lgaId` |
| By agent | Complete | `revenueByAgent` |
| By channel | Missing | `transactions.channel` is recorded on every row and never aggregated |
| By taxpayer type | Missing | `taxpayers` carries the type; no report groups on it |
| By period | Complete | `dailyTrend`, 30 days |

---

## 3. Admin operational intelligence

### What is happening now

| Item | Verdict | Evidence / gap |
| --- | --- | --- |
| Agents currently online | Missing | Last-seen is not tracked for agents |
| Agents currently active | Complete | `counts.active_agents` (operational status, not presence) |
| Agents suspended | Partial | Visible on `/agents`; not counted on the dashboard |
| New agent applications | Complete | `adminWorkItems`, `/agents` |
| Pending KYC | Complete | `adminWorkItems`, `/agents` clearance queue |
| Pending referee verification | Complete | `/referees` |
| Agents awaiting approval | Complete | `counts.agents_awaiting_review` |
| Failed KYC | Complete | `agent_clearance_events` |
| Failed payments | Complete | `counts.failed_transactions` |
| Pending payments | Complete | `/transactions` status filter |
| Unreconciled transactions | Complete | `exceptions.reconciliation_exceptions` |
| Fraud alerts | Complete | `exceptions.open_fraud_flags`, `/fraud` |
| System alerts | Partial | `GET /government/workers` reports every background job's health; integration status at `/government/platform/integrations`. Neither raises an alert — an officer has to go and look |
| Pending officer tasks | Complete | `/my-work` |
| Pending approvals | Complete | `exceptions.pending_approvals` |

### Officer activity

| Item | Verdict | Evidence / gap |
| --- | --- | --- |
| Which officer logged in | Complete | `audit_logs`, action `auth.login` |
| What officer is working on | Partial | Every material action is in the audit log; nothing summarises "this officer, this session" |
| Approvals performed | Complete | `audit_logs`, `approvals` |
| Rejections | Complete | Same |
| Records modified | Complete | `audit_logs.old_value` / `new_value` |
| Revenue configuration changes | Complete | `GET /government/audit/queries/rate-changes` |
| Agent approvals | Complete | `agent_clearance_events` |
| Suspensions | Complete | `audit_logs` |
| Refund approvals | Complete | `approvals` |
| Reconciliation actions | Complete | `reconciliation_records.reconciled_by` |
| Reports generated | Partial | Exports are audited; report *views* are not |
| Sensitive data accessed | Complete | `document_access_logs`, `kyc_document_access_logs`, `GET /government/audit/queries/taxpayer-access` |

---

## 4. Admin organizational management

| Item | Verdict | Evidence / gap |
| --- | --- | --- |
| Officers | Complete | `/users`, create, role change, status change |
| Departments | Missing | No such object |
| Roles | Partial | Six fixed roles in `packages/shared/src/rbac.ts`. An administrator can assign a role and cannot create one |
| Permissions | Partial | Granular and enforced, but the role→permission map is code, not data. Changing who may refund is a deployment |
| LGAs | Complete | `lgas`, seeded, 17 |
| Wards | Complete | `wards` |
| Territories | Complete | `territories`, `/users` territory assignment |
| Revenue offices | Missing | Not modelled |
| Supervisors | Missing | No reporting line — see §1 |
| Agent assignments | Complete | `agent:assign_territory` |
| Officer assignments | Complete | `user_territories` |
| Officer transfers | Partial | Reassigning territories is a transfer in effect and is audited; there is no transfer as a first-class, dated event |
| Officer suspension | Complete | `PATCH /government/users/:id/status` |
| Officer deactivation | Complete | Same, `CLOSED` |
| Granular view/create/edit/approve/reverse/refund/export/configure | Partial | All eight verbs exist as permissions and are enforced per route. They cannot be *configured* by an administrator |

---

## 5. Admin data management — global search

| Item | Verdict | Evidence / gap |
| --- | --- | --- |
| Taxpayer | Complete | `GET /government/search`, name / phone / TIN |
| TIN | Complete | Same |
| Agent | Complete | Agent code, name, phone |
| Officer | Complete | Name, phone, email |
| Transaction | Complete | Transaction reference |
| Invoice | Complete | Invoice number |
| Receipt | Complete | Receipt number and verification code |
| Vehicle | Complete | Plate number, chassis |
| Revenue category | Complete | Category and item name |
| Payment reference | Complete | Payment reference and gateway reference |
| LGA | Complete | LGA and ward name |
| Ward | Complete | Same |
| Application | Complete | Agent application by code or applicant name |
| Results respect permissions | Complete | Each result kind is gated on the permission its own screen requires, and `report-scope` narrows a supervisor to their territories |

---

## 6. Admin cross-department workspace

| Item | Verdict | Evidence / gap |
| --- | --- | --- |
| Internal cases | Complete | `cases`, `apps/api/src/services/cases.ts` |
| Tasks | Complete | A case assigned to an officer is that officer's task |
| Assignments | Complete | `cases.assignee_id`, reassignment recorded as a case event |
| Comments | Complete | `case_events`, kind `COMMENT` |
| Attachments | Partial | An officer attaches a document the platform already issued — a receipt, an invoice, vehicle papers — chosen from what the case is about, and the attachment gets its own audit entry. There is **no upload**: nothing on this platform lets an officer add a file of their own, so a bank advice a taxpayer hands over cannot be put on the case |
| Internal notes | Complete | `case_events`, kind `NOTE`, not visible to non-officers (no non-officer can reach a case at all) |
| Mentions | Complete | `case_events.mentions`, surfaced in `/my-work` |
| Status | Complete | Six states, §22 |
| Priority | Complete | `cases.priority` |
| Due date | Complete | `cases.due_at`, overdue surfaced in `/my-work` |
| Escalation | Complete | `ESCALATED` status plus an escalation event naming who it went to |
| Case history | Complete | `case_events` is append-only; there is no update or delete path |
| Routing between departments | Partial | A case is routed to an **officer** or to a **role**. It cannot be routed to a department, because departments do not exist (§4) |

---

## 7-13. Revenue officer

| Item | Verdict | Evidence / gap |
| --- | --- | --- |
| Revenue collected today / month / year | Complete | `executiveDashboard`, scoped to the officer's territories |
| Revenue target, achievement %, gap | Missing | No target model |
| Growth rate | Missing | No period comparison |
| Collection trend | Complete | 30-day daily trend |
| Forecast | Missing | Nothing forecasts |
| Outstanding revenue | Complete | `/outstanding` |
| Expected revenue | Partial | Unpaid invoices are a floor for it; nothing states it as a figure |
| Revenue by category / subcategory | Complete | `GET /government/revenue/by-category` |
| Top-performing categories | Complete | Same, ordered |
| Declining categories | Missing | Needs the period comparison |
| Revenue contribution % | Missing | Computable from what is returned; not computed |
| Category growth / targets | Missing | Follows |
| State → LGA → Ward → Community drill-down | Complete | `reports.geographicIntelligence` |
| Collection, taxpayer count, transaction count per level | Complete | Same query |
| Average transaction per level | Partial | Returned per agent, not per geography |
| Growth per level | Missing | Period comparison again |
| Compliance per level | Partial | `taxpayer_compliance` exists per taxpayer; not aggregated by geography |
| Outstanding obligations per level | Complete | `taxpayer_tax_obligations`, `/outstanding` by LGA |
| Agent performance per level | Complete | `reports.agentCollectionMap` |
| Agent collections, transactions, average, taxpayers onboarded | Complete | `reports.agentPerformance` |
| Categories processed per agent | Partial | Derivable; not returned |
| Commission generated, failed, reversals, refunds per agent | Complete | `agentPerformance` |
| Collection growth per agent | Missing | Period comparison |
| Activity frequency | Complete | `active_days` |
| Territory performance | Complete | `agentCollectionMap`, `collectionMappingCoverage` |
| Agent ranking table | Complete | `/performance` |
| Total / new / active / inactive taxpayers | Partial | Total and new-this-month on the dashboard; active vs inactive is not distinguished |
| Taxpayers by LGA / ward / category | Complete | `geographicIntelligence`, `defaultersByCategory` |
| Taxpayer growth | Partial | New-this-month only |
| Compliance, payment frequency, average payment | Partial | `taxpayer_compliance` scores each taxpayer; no cohort view |
| Revenue target management (state → LGA → category → period) | Missing | The single largest gap on the revenue side |
| Target vs actual, daily/weekly/monthly/quarterly/annual | Missing | Follows |
| Revenue forecasting | Missing | Follows |

---

## 14-17. Finance

| Item | Verdict | Evidence / gap |
| --- | --- | --- |
| Total / today's collections | Complete | `executiveDashboard` |
| Pending / successful / failed payments | Complete | Same |
| Reversals | Complete | `payment:reverse:request` / `:approve`, `approvals` |
| Refunds | Complete | `refunds`, `/government/refunds/outstanding`, retry path |
| Settlement received / pending | Complete | `settlements`, `/government/settlements` |
| Unreconciled / reconciled amount | Complete | `reconciliation_records`, `/reconciliation` |
| Commission liability / paid / outstanding | Complete | `counts.commission_liability_kobo`, `commission_paid_kobo` |
| Platform vs gateway vs settlement, side by side | Complete | `services/reconciliation.ts`, `/reconciliation` exceptions table |
| Investigate every exception | Complete | `POST /government/reconciliation/exceptions/:id/resolve`, and now a case can be opened from one |
| Reconciliation | Complete | Automated run plus manual recovery |
| Settlement management | Complete | Record, reconcile |
| Payment monitoring | Complete | `/transactions` |
| Refund / reversal management | Complete | Approval-gated |
| Commission management | Complete | `/commissions`, payout batches, approve / complete / fail |
| Settlement, revenue, financial reports | Complete | `services/reports.ts`, CSV |
| Financial exports | Partial | CSV only |
| Exception management | Complete | Above |
| Financial period closing | Missing | No period lock. A settled month can still be written to |
| Transaction adjustments with controlled approval | Complete | `approvals` with `approval:authorise` |
| Commission accrued / pending / eligible / paid / reversed | Complete | `commissions.status` covers all five |
| Agent commission, by LGA, by period | Partial | Per agent and per payout batch; not grouped by LGA or period |
| Payout batches, failed payouts | Complete | `commission_payouts` |
| Transaction → commission → payout traceable | Complete | `commissions.transaction_id` unique, `commissions.payout_id`; shown whole in Transaction 360 |

---

## 18-26. Auditor

| Item | Verdict | Evidence / gap |
| --- | --- | --- |
| Investigate transactions, taxpayers, agents, officers, payments, receipts, invoices | Complete | Global search (§5) plus Transaction 360 |
| Vehicle renewals, refunds, reversals, commission, revenue configuration, KYC, referees | Complete | Each has a screen; search reaches them |
| Full transaction timeline | Complete | `GET /government/transactions/:id/full`, merging `transaction_events` and `audit_logs` |
| Timeline without querying multiple tables | Complete | Same endpoint, one call |
| Before / after on modifications | Partial | `audit_logs.old_value` and `new_value` are captured on every write and returned by `GET /government/audit`. The Transaction 360 timeline renders them; the general audit screen still does not |
| Who changed it, when, why, approval | Complete | `actor_id`, `created_at`, `reason`, and the approval row where one was required |
| Immutable financial records | Complete | Receipts are voided, never edited; the audit chain is hash-linked and verifiable |
| Audit cases | Complete | §22 — cases carry case number, subject, transactions, agent, taxpayer, officer, category, risk, description, evidence, assignee, due date, status |
| Six case statuses | Complete | Open, Investigating, Awaiting Information, Escalated, Resolved, Closed |
| Evidence management | Partial | Attaching, listing and auditing all work (§6). The gap is the same one: an auditor cannot upload a document that did not originate in the platform, which is most of what an investigation collects |
| Anomaly analytics | Partial | `services/fraud.ts` covers territory violations, velocity, duplicate contacts, reversal patterns and registration risk. Not covered: repeated receipt regeneration, unusual transaction timing, unusual **officer** activity, frequent manual interventions |
| Audit sampling | Missing | An auditor cannot draw a sample by period, category, LGA, agent or value |
| Audit reports (13 kinds) | Partial | Transaction, agent, revenue, LGA, payment, reconciliation, commission and user-activity questions are all answerable through existing queries and CSV. There is no report *object* — no saved, dated, signed audit report |
| Export PDF | Missing | CSV only |
| Export Excel | Missing | CSV only |
| Export CSV | Complete | `reports.toCsv` |

---

## 27-33. Shared platform

| Item | Verdict | Evidence / gap |
| --- | --- | --- |
| Government work queue | Complete | `/cases`, filterable by department, assignee, status, priority |
| Create task / case / alert / request and assign across departments | Complete | Cases route to a role or a named officer |
| Everything stays on one case | Complete | `case_events` is the case's whole history |
| Internal messages, comments, mentions | Complete | §6 |
| Notifications, tasks, assignments, escalations | Complete | `/my-work` |
| Attachments | Partial | §6 |
| Case discussions, status updates | Complete | `case_events` |
| Auditable, not an open chat | Complete | Every event is append-only and attributed; there is no direct message that is not attached to a case |
| Global notification centre | Complete | `GET /government/my-work` returns cases, mentions, approvals, exceptions and flags for the signed-in officer in one payload |
| Alert severity colouring | Complete | `statusSeverity` from `packages/shared/src/severity.ts`, so a case's priority and a fraud flag's severity are coloured by one rule |
| Global search | Complete | §5 |
| Search a transaction reference and see the whole story | Complete | Search resolves the reference, Transaction 360 tells the story |
| Search a TIN | Complete | Resolves to the taxpayer |
| Search a receipt number | Complete | Resolves to the receipt and its transaction |
| One authoritative transaction, four views | Complete | There is one `transactions` row; Transaction 360 reads it and shows each role what its permissions allow |
| Role-based action matrix | Partial | Enforced in `packages/shared/src/rbac.ts` and asserted by `apps/api/src/tests/portal-navigation.test.ts`. §32's matrix is not published as a document PSIRS can sign off |
| My Work | Complete | `/my-work` |

---

## 34. Officer-ready acceptance

### Admin

| Item | Verdict |
| --- | --- |
| Manage officers | Complete |
| Manage roles | Partial — assign, not define |
| Manage permissions | Partial — enforced, not configurable |
| Manage territories | Complete |
| Manage agents | Complete |
| See organization-wide activity | Complete |
| Investigate operational issues | Complete |
| Assign tasks | Complete |
| Monitor revenue | Complete |
| Monitor payments | Complete |
| Monitor reconciliation | Complete |
| See alerts | Complete |
| Generate reports | Complete |
| See audit trails | Complete |

### Revenue

| Item | Verdict |
| --- | --- |
| Revenue analytics | Complete |
| Revenue targets | **Missing** |
| Revenue forecasting | **Missing** |
| Category analytics | Complete |
| LGA analytics | Complete |
| Ward analytics | Complete |
| Agent analytics | Complete |
| Taxpayer analytics | Partial |
| Outstanding revenue | Complete |
| Collection trends | Complete |
| Performance comparisons | Partial — across places and agents, not across periods |
| Revenue reports | Complete |
| Case / task management | Complete |

### Finance

| Item | Verdict |
| --- | --- |
| Payment monitoring | Complete |
| Settlement monitoring | Complete |
| Reconciliation | Complete |
| Exception management | Complete |
| Refund management | Complete |
| Reversal management | Complete |
| Commission management | Complete |
| Financial reports | Complete |
| Settlement reports | Complete |
| Financial audit trail | Complete |
| Period controls | **Missing** |

### Auditor

| Item | Verdict |
| --- | --- |
| Global transaction investigation | Complete |
| Full transaction timeline | Complete |
| Audit logs | Complete |
| Before / after records | Partial — on the transaction timeline, not on the audit screen |
| Audit cases | Complete |
| Evidence management | Partial |
| Risk alerts | Complete |
| Anomaly detection | Partial |
| Audit sampling | **Missing** |
| Agent audits | Complete |
| Revenue audits | Complete |
| Payment audits | Complete |
| Reconciliation audits | Complete |
| Commission audits | Complete |
| Audit reports | Partial |
| Investigation history | Complete |

---

## What was added to close the gaps above

Four surfaces, all reachable from every officer's menu.

| Surface | Where | What it closed |
| --- | --- | --- |
| **Global search** | The top bar of every screen, `GET /government/search` | §5 and §30. One box resolves a transaction reference, TIN, receipt number, invoice number, assessment number, payment or gateway reference, agent code, plate, officer name, LGA or case number. Each kind of result is gated on the permission its own screen requires, so the box grants nothing |
| **Transaction 360** | `/transaction/:key`, `GET /government/transactions/:key/full` | §20, §21, §31, and the brief's "one major thing I would insist". Taxpayer → agent → revenue item → assessment → invoice → payment → gateway → receipt → settlement → reconciliation → commission → payout, plus a timeline merging `transaction_events` and `audit_logs` on one clock with before/after on every change. Sections the reader may not see are **named** rather than left blank |
| **Cases** | `/cases`, `apps/api/src/services/cases.ts`, migration 055 | §6, §22, §23, §27, §28. A case carries work between departments with its whole history attached. The history is append-only and the database enforces it — an `UPDATE` or `DELETE` issued at a psql prompt is refused — and a case cannot be resolved without saying what it concluded |
| **My work** | `/my-work`, `GET /government/my-work` | §29 and §33. Cases assigned to this officer, cases they opened, where they were named, what is waiting for their department, and the approval, exception and flag queues they already had — in one answer, each block keeping its own screen's permission |

One decision in there is worth stating plainly, because it changes how a role is
described. **The auditor now writes.** They open cases, assign them, take
evidence and record findings, which §18–§26 require of the role and which
nothing in the platform previously allowed. Their read-only standing is intact
and is now stated more precisely than before: they hold no permission that
changes the record — what a taxpayer owes, what an agent earned, what a rate is,
what a receipt says — and the four permissions they gained write only their own
investigative file. `apps/portal/src/lib/permissions.ts` keeps those as separate
classes and a test asserts the auditor's entire write surface is casework and
nothing else.

---

## What this assessment says to do next

Ordered by what an officer loses without it.

1. **Revenue targets and forecasting** (§12, §13). Nine "Missing" rows collapse
   into this one. Without a target, every growth, gap, achievement and
   declining-category figure in the brief is unanswerable, and the revenue
   officer's dashboard can only ever report what happened.
2. **Period comparison** (§2, §8). Cheap next to targets — one more window
   function over queries that already exist — and it unlocks growth rate,
   previous-period comparison, declining categories and per-agent growth.
3. **Departments and the reporting line** (§1, §4). Cases route to a role
   today. Routing to a department, and escalating up a supervisor chain,
   both wait on two columns that do not exist.
4. **Financial period closing** (§16). A settled month is still writable.
   This is a control, not a feature.
5. **Audit sampling** (§25) and **audit reports as objects** (§26).
6. **Configurable roles and permissions** (§4). Today, changing who may
   approve a refund is a code change and a deployment.
7. **PDF and Excel export** (§26). CSV is enough for analysis and not enough
   for a report that goes in a file.

Items 1, 2 and 4 are the ones I would not put in front of a PSIRS revenue or
finance officer without.
