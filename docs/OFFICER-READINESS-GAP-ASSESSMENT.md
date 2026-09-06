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

A "Partial" is not a near-miss. Most of them were a query that existed on the
API and stopped short of a screen — which is the same thing as absent to the
officer holding the tablet.

## Where it now stands

First assessed 6 September 2026 against `claude/officer-command-centre-admin-r5j0s8`,
with fifty-one items marked Partial or Missing. **Every one of them has since
been built, and every row below reads Complete.** The verdicts are not a
statement that nothing is left to do — they are a statement that the brief's
own checklist is answered, each row by a named file, endpoint or migration a
reviewer can open.

Two things that would still be worth doing and are outside what the brief asks
for, recorded here rather than left implied:

* **The row limits on exports are constants in `services/export.ts`,** not
  configuration. A role PSIRS creates gets the floor until an engineer changes
  the file, which is the same shape of problem the role-permission map had
  before migration 059.
* **There is no live probe of the outside services.** Job health raises alerts;
  a gateway or TIN service that has stopped answering does not, because
  `integrationStatus()` reports which adapter is configured rather than whether
  it responds. The `INTEGRATION_ALERT` notification kind was written for this
  and removed rather than faked — see migration 064.

The four items the brief said it "would not put in front of an officer
without" — Transaction 360, the audit trail with before and after, the shared
work queue, and role-based access enforced on the API rather than in the menu —
are all Complete and each is covered by a test that fails if it stops being.

---

## 1. Common platform foundation

| Item | Verdict | Evidence / gap |
| --- | --- | --- |
| Secure login | Complete | `apps/api/src/routes/auth.ts`, argon2 hashes, lockout after failed attempts |
| MFA / OTP | Complete | `POST /auth/otp/request`, `otp_codes`, plus step-up grants for named actions (`STEP_UP_ACTIONS`, `packages/shared/src/rbac.ts`) |
| Role-based permissions | Complete | `packages/shared/src/rbac.ts`; every route names a permission, never a role |
| Officer profile | Complete | Name, phone, email, role, status, last login, plus department, revenue office, supervisor, job title and staff number. No photograph, which nothing in the brief asks for |
| Department | Complete | `departments`, with a function, a head, a parent and officers posted to it. A case routes to one, and two departments of the same function stay apart |
| LGA / territory assignment | Complete | `user_territories`, managed at `/users` in the portal, enforced by `services/report-scope.ts` |
| Supervisor | Complete | `users.supervisor_id`, cycle-proof at the database, and escalation walks it — supervisor, then department head, then the department above |
| Last login | Complete | `users.last_login_at`, shown on `/users` |
| Active sessions | Complete | `/my-access` lists an officer's own sessions (needing no permission — the answer is about the person asking) and ends any one of them; `user:manage` sees and ends anybody's. Ended sessions stay listed and marked rather than disappearing |
| Device / session management | Complete | `officer_devices` — discovered on first sign-in rather than pre-approved, because a queue between an emergency and the officer handling it is the wrong control for a browser. What officers get is the half that matters: a record of the machines, and a block that ends every session it holds and refuses it another. Enforced by a trigger (migration 063), because the case a block is for is a laptop already in somebody else's hands |
| Notifications | Complete | `officer_notifications` is the officer's own inbox, at `/inbox`, with read state. Fed by case assignment, mentions, escalation, approvals waiting and the platform's own alarms. `/my-work` still answers "what is waiting"; the inbox answers "what was raised, and did anybody look" |
| Tasks | Complete | Case tasks and assignment, `apps/api/src/services/cases.ts`, `/cases` and `/my-work` in the portal |
| Alerts | Complete | The `system-alerts` job turns job health into notifications addressed to a role rather than a person, deduplicated so a job failing all day raises one alert and not ninety-six, and raised again once somebody acknowledges it without fixing it |
| Internal messages | Complete | Case comments and internal notes, with mentions, `case_events` |
| Search | Complete | `GET /government/search`, portal shell search box — see §5 |
| Saved filters | Complete | `lib/filters.ts` keeps them in the address and in the session: the URL first, so a filtered view is shareable and the back button behaves; then this session's storage, so returning to a screen restores what the officer had. An emptied filter in the URL beats the remembered one, because clearing a field is a decision |
| Reports | Complete | `services/reports.ts`, 20+ report queries across dashboards, geography, agents, remittance |
| Export controls | Complete | CSV, XLSX and PDF from one path (`services/export.ts`), gated on `data:export` — its own permission, so it can be taken from a role without taking their reports away — capped per role, and audited with the filters and the row count |
| Activity history | Complete | `audit_logs` with a verified hash chain (`GET /government/audit/verify`) |
| Help / support | Complete | `support_tickets`, `/support` |

---

## 2. Admin executive dashboard

### Revenue overview

| Item | Verdict | Evidence / gap |
| --- | --- | --- |
| Total revenue | Complete | `reports.executiveDashboard` → `collections.total_kobo` |
| Today's revenue | Complete | `collections.today_kobo` |
| Yesterday's revenue | Complete | `collections.yesterday_kobo`, with the day-on-day change beside it |
| This week | Complete | `collections.week_kobo` |
| This month | Complete | `collections.month_kobo` |
| This year | Complete | `collections.ytd_kobo` |
| Previous-period comparison | Complete | Every period carries the one before it, cut at the same point through itself |
| Revenue growth / decline | Complete | Basis points per period, null rather than zero where there is nothing to compare against |
| Revenue target | Complete | `revenue_targets` — state, LGA, category, item or agent, for any period |
| Target achievement | Complete | Computed against the target's own period, with the elapsed share of the period beside it |
| Outstanding assessments | Complete | `/outstanding`, `reports.defaultersByCategory` |
| Outstanding invoices | Complete | Same screen, unpaid invoice ageing |
| Successful payments | Complete | `counts.successful_transactions` |
| Failed payments | Complete | `counts.failed_transactions` |
| Reversed payments | Complete | `counts.reversed_kobo` and `reversed_transactions` on the dashboard |
| Refunded payments | Complete | `counts.refunded_kobo` and `refunded_transactions` |

### Revenue breakdown

| Item | Verdict | Evidence / gap |
| --- | --- | --- |
| By category | Complete | `revenueByCategory` |
| By subcategory | Complete | `revenueByItem` on the dashboard, the levy rather than the heading above it |
| By MDA | Complete | `revenueByMda`, `reports.revenueByMda` |
| By LGA | Complete | `revenueByLga` |
| By ward | Complete | `reports.geographicIntelligence` with `lgaId` |
| By agent | Complete | `revenueByAgent` |
| By channel | Complete | `revenueByChannel` |
| By taxpayer type | Complete | `revenueByTaxpayerType`, with an average transaction each |
| By period | Complete | `dailyTrend`, 30 days |

---

## 3. Admin operational intelligence

### What is happening now

| Item | Verdict | Evidence / gap |
| --- | --- | --- |
| Agents currently online | Complete | `counts.agents_online`, read from `sessions.last_used_at` over fifteen minutes |
| Agents currently active | Complete | `counts.active_agents` (operational status, not presence) |
| Agents suspended | Complete | `counts.agents_suspended` |
| New agent applications | Complete | `adminWorkItems`, `/agents` |
| Pending KYC | Complete | `adminWorkItems`, `/agents` clearance queue |
| Pending referee verification | Complete | `/referees` |
| Agents awaiting approval | Complete | `counts.agents_awaiting_review` |
| Failed KYC | Complete | `agent_clearance_events` |
| Failed payments | Complete | `counts.failed_transactions` |
| Pending payments | Complete | `/transactions` status filter |
| Unreconciled transactions | Complete | `exceptions.reconciliation_exceptions` |
| Fraud alerts | Complete | `exceptions.open_fraud_flags`, `/fraud` |
| System alerts | Complete | Overdue, failing and stalled jobs raise an alert into the administrator role's inbox. `NEVER_RUN` deliberately does not: on a fresh database every job has never run, and an alert storm on the first morning is how an organisation learns to ignore alerts |
| Pending officer tasks | Complete | `/my-work` |
| Pending approvals | Complete | `exceptions.pending_approvals` |

### Officer activity

| Item | Verdict | Evidence / gap |
| --- | --- | --- |
| Which officer logged in | Complete | `audit_logs`, action `auth.login` |
| What officer is working on | Complete | `GET /government/users/:id/activity` — counts by action and by day, live sessions with the machine each is on, and the last twenty-five things they did. Counts, never a score: a number with a formula behind it becomes the thing people manage to, and this platform suspends people |
| Approvals performed | Complete | `audit_logs`, `approvals` |
| Rejections | Complete | Same |
| Records modified | Complete | `audit_logs.old_value` / `new_value` |
| Revenue configuration changes | Complete | `GET /government/audit/queries/rate-changes` |
| Agent approvals | Complete | `agent_clearance_events` |
| Suspensions | Complete | `audit_logs` |
| Refund approvals | Complete | `approvals` |
| Reconciliation actions | Complete | `reconciliation_records.reconciled_by` |
| Reports generated | Complete | `report.export` records what left; `report.view` records that a stored audit report was read, which was the half that was missing |
| Sensitive data accessed | Complete | `document_access_logs`, `kyc_document_access_logs`, `GET /government/audit/queries/taxpayer-access` |

---

## 4. Admin organizational management

| Item | Verdict | Evidence / gap |
| --- | --- | --- |
| Officers | Complete | `/users`, create, role change, status change |
| Departments | Complete | `/organisation`, created and closed by an administrator |
| Roles | Complete | `roles` table (migration 059). Six ship as system roles that cannot be deleted or renamed; an administrator creates, retires and restores their own from `/roles`, optionally copying an existing role's grants |
| Permissions | Complete | The map is `role_permissions`, editable at `/roles` under step-up and audited. The *catalogue* stays in code — a grant naming a permission no route checks is refused — and `a-map-that-moved.test.ts` compares both directions so the move changed no role's authority |
| LGAs | Complete | `lgas`, seeded, 17 |
| Wards | Complete | `wards` |
| Territories | Complete | `territories`, `/users` territory assignment |
| Revenue offices | Complete | `revenue_offices`, which always administer their own LGA whether or not anybody said so |
| Supervisors | Complete | See §1 |
| Agent assignments | Complete | `agent:assign_territory` |
| Officer assignments | Complete | `user_territories` |
| Officer transfers | Complete | `officer_transfers`, append-only, one row per thing that moved — including the territory and role changes that were previously only audit entries |
| Officer suspension | Complete | `PATCH /government/users/:id/status` |
| Officer deactivation | Complete | Same, `CLOSED` |
| Granular view/create/edit/approve/reverse/refund/export/configure | Complete | All eight verbs exist as permissions, are enforced per route, and are now granted and revoked per role by an administrator. A revocation takes effect within 30s (`rbac-store.ts` cache) |

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
| Attachments | Complete | Two sources: a document the platform issued, pointed at; or a file uploaded onto the case (`case_evidence_files`), which is where a bank advice, a letter or a photograph goes. Uploads carry a checksum, must state what they are and where they came from, and cannot be altered or removed once on the file |
| Internal notes | Complete | `case_events`, kind `NOTE`, not visible to non-officers (no non-officer can reach a case at all) |
| Mentions | Complete | `case_events.mentions`, surfaced in `/my-work` |
| Status | Complete | Six states, §22 |
| Priority | Complete | `cases.priority` |
| Due date | Complete | `cases.due_at`, overdue surfaced in `/my-work` |
| Escalation | Complete | `ESCALATED` status plus an escalation event naming who it went to |
| Case history | Complete | `case_events` is append-only; there is no update or delete path |
| Routing between departments | Complete | A case routes to a department, and the role address still works for everything raised before departments existed |

---

## 7-13. Revenue officer

| Item | Verdict | Evidence / gap |
| --- | --- | --- |
| Revenue collected today / month / year | Complete | `executiveDashboard`, scoped to the officer's territories |
| Revenue target, achievement %, gap | Complete | §12 |
| Growth rate | Complete | §2 |
| Collection trend | Complete | 30-day daily trend |
| Forecast | Complete | Run rate shaped by the collection curve, labelled with its basis and confidence |
| Outstanding revenue | Complete | `/outstanding` |
| Expected revenue | Complete | `counts.expected_revenue_kobo` — assessed and unpaid, stated as a fact rather than a projection |
| Revenue by category / subcategory | Complete | `GET /government/revenue/by-category` |
| Top-performing categories | Complete | Same, ordered |
| Declining categories | Complete | A dashboard panel ranking categories by direction rather than by size |
| Revenue contribution % | Complete | `contribution_bp` per category |
| Category growth / targets | Complete | `growth_bp` per category; targets may be set at category and item level |
| State → LGA → Ward → Community drill-down | Complete | `reports.geographicIntelligence` |
| Collection, taxpayer count, transaction count per level | Complete | Same query |
| Average transaction per level | Complete | `average_kobo` at LGA, ward and community |
| Growth per level | Complete | `growth_bp` against the window of equal length immediately before |
| Compliance per level | Complete | `compliance_bp` — the share of the register in that place that paid anything in the window |
| Outstanding obligations per level | Complete | `taxpayer_tax_obligations`, `/outstanding` by LGA |
| Agent performance per level | Complete | `reports.agentCollectionMap` |
| Agent collections, transactions, average, taxpayers onboarded | Complete | `reports.agentPerformance` |
| Categories processed per agent | Complete | `categories_processed` |
| Commission generated, failed, reversals, refunds per agent | Complete | `agentPerformance` |
| Collection growth per agent | Complete | `growth_bp` per agent, on the agent ranking |
| Activity frequency | Complete | `active_days` |
| Territory performance | Complete | `agentCollectionMap`, `collectionMappingCoverage` |
| Agent ranking table | Complete | `/performance` |
| Total / new / active / inactive taxpayers | Complete | `/taxpayer-base`. Active means *paid within ninety days*, not `status = 'ACTIVE'` |
| Taxpayers by LGA / ward / category | Complete | `geographicIntelligence`, `defaultersByCategory` |
| Taxpayer growth | Complete | New this month against new last month, per LGA as well as statewide |
| Compliance, payment frequency, average payment | Complete | Frequency banded rather than averaged; average payment per band and per taxpayer |
| Revenue target management (state → LGA → category → period) | Complete | `/targets`, with the state figure beside what was apportioned below it |
| Target vs actual, daily/weekly/monthly/quarterly/annual | Complete | All five periods, resolved on the server so a wrong browser clock cannot set a target against the wrong dates |
| Revenue forecasting | Complete | Seasonal where the history supports it, run rate where it does not, and it says which |

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
| Financial exports | Complete | CSV, XLSX and PDF |
| Exception management | Complete | Above |
| Financial period closing | Complete | `financial_periods` and a trigger on the four tables that decide what a month collected. Enforced at the database, not in the service |
| Transaction adjustments with controlled approval | Complete | `approvals` with `approval:authorise` |
| Commission accrued / pending / eligible / paid / reversed | Complete | `commissions.status` covers all five |
| Agent commission, by LGA, by period | Complete | `GET /government/commissions/by-place` |
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
| Before / after on modifications | Complete | One `BeforeAfter` renderer on both screens, showing the *difference* rather than both sides in full — a reader asked to spot which of fourteen fields moved does not spot it. An action with no change renders nothing at all |
| Who changed it, when, why, approval | Complete | `actor_id`, `created_at`, `reason`, and the approval row where one was required |
| Immutable financial records | Complete | Receipts are voided, never edited; the audit chain is hash-linked and verifiable |
| Audit cases | Complete | §22 — cases carry case number, subject, transactions, agent, taxpayer, officer, category, risk, description, evidence, assignee, due date, status |
| Six case statuses | Complete | Open, Investigating, Awaiting Information, Escalated, Resolved, Closed |
| Evidence management | Complete | Upload, read-back and both audited. Deliberately not a `documents` row: every row in that table is something the State issued and a citizen can verify, and a scan of a third party's letter is not |
| Anomaly analytics | Complete | `services/fraud.ts` covers territory violations, velocity, duplicate contacts, reversal patterns and registration risk, and now four rules that watch the office rather than the field: repeated receipt regeneration or retrieval, collections written in the small hours (read in Africa/Lagos), an officer's day against their own preceding four weeks, and frequent manual interventions. `watching-the-office.test.ts` asserts each fires on the shape it is for and stays quiet on the ordinary case beside it |
| Audit sampling | Complete | `POST /government/audit/samples` draws by period, category, LGA, agent, value band and status, at random from a stored seed, systematically, or by largest amount. Migration 062 fixes the criteria, the seed, the population size and the selected rows at the moment of drawing, so a reviewer can reproduce the draw and nobody can widen it after seeing the results |
| Audit reports (13 kinds) | Complete | `audit_reports` holds all thirteen as objects: the rows frozen at generation, a SHA-256 over the canonical payload and parameters, a generator, and a separate signature. `GET` recomputes the checksum and tells the reader when stored figures no longer match what was signed. A report is withdrawn with a reason, never deleted |
| Export PDF | Complete | `renderReportPdf` — paginated, landscape, header repeated per page, and always carrying what the figures cover; a signed audit report exports with its number and checksum on the page |
| Export Excel | Complete | `toXlsx` writes the workbook directly (the obvious library carries a transitive advisory). A phone number keeps its leading zero and a TIN stays a TIN; `an-export-that-survives-excel.test.ts` unpacks the archive through its central directory and checks every CRC |
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
| Attachments | Complete | §6 |
| Case discussions, status updates | Complete | `case_events` |
| Auditable, not an open chat | Complete | Every event is append-only and attributed; there is no direct message that is not attached to a case |
| Global notification centre | Complete | `GET /government/my-work` returns cases, mentions, approvals, exceptions and flags for the signed-in officer in one payload |
| Alert severity colouring | Complete | `statusSeverity` from `packages/shared/src/severity.ts`, so a case's priority and a fraud flag's severity are coloured by one rule |
| Global search | Complete | §5 |
| Search a transaction reference and see the whole story | Complete | Search resolves the reference, Transaction 360 tells the story |
| Search a TIN | Complete | Resolves to the taxpayer |
| Search a receipt number | Complete | Resolves to the receipt and its transaction |
| One authoritative transaction, four views | Complete | There is one `transactions` row; Transaction 360 reads it and shows each role what its permissions allow |
| Role-based action matrix | Complete | `docs/ROLE-ACTION-MATRIX.md`, generated from `ROLE_PERMISSIONS` and from the route and service guards, with `npm run verify` failing when the two drift. Generating it found `payment:reverse:request` granted to two roles and checked by nothing, which is now enforced |
| My Work | Complete | `/my-work` |

---

## 34. Officer-ready acceptance

### Admin

| Item | Verdict |
| --- | --- |
| Manage officers | Complete |
| Manage roles | Complete |
| Manage permissions | Complete |
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
| Revenue targets | Complete |
| Revenue forecasting | Complete |
| Category analytics | Complete |
| LGA analytics | Complete |
| Ward analytics | Complete |
| Agent analytics | Complete |
| Taxpayer analytics | Complete |
| Outstanding revenue | Complete |
| Collection trends | Complete |
| Performance comparisons | Complete — across places, agents and periods |
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
| Period controls | Complete |

### Auditor

| Item | Verdict |
| --- | --- |
| Global transaction investigation | Complete |
| Full transaction timeline | Complete |
| Audit logs | Complete |
| Before / after records | Complete |
| Audit cases | Complete |
| Evidence management | Complete |
| Risk alerts | Complete |
| Anomaly detection | Complete |
| Audit sampling | Complete |
| Agent audits | Complete |
| Revenue audits | Complete |
| Payment audits | Complete |
| Reconciliation audits | Complete |
| Commission audits | Complete |
| Audit reports | Complete |
| Investigation history | Complete |

---

## What was added to close the gaps above

### Second pass — targets, comparison, and the organisation

| Surface | Where | What it closed |
| --- | --- | --- |
| **Revenue targets** | `/targets` · `revenue_targets` · migration 056 | §2, §8, §12 — target, achievement, gap, category and item targets, target-versus-actual over five periods |
| **Forecasting** | `GET /government/forecast` | §13. Run rate shaped by the collection curve, always labelled with its basis and confidence |
| **Period comparison** | `reports.executiveDashboard`, `geographicIntelligence`, `agentPerformance` | §2, §8, §9, §10 — yesterday, previous period, growth, decline, contribution share, growth per place and per agent |
| **Taxpayer base** | `/taxpayer-base` · `reports.taxpayerAnalytics` | §11. Cohorts by payment behaviour, banded frequency, per-LGA register health |
| **The organisation** | `/organisation` · `departments`, `revenue_offices`, `officer_transfers` · migration 057 | §1, §4, §6 — departments, offices, the reporting line, dated transfers, and case routing to a body |
| **Financial periods** | `/periods` · `financial_periods` · migration 058 | §16. A closed month is refused by the database, on the four tables that decide what it collected |

Two of those are worth a sentence each.

**A target is measured against its own period.** A March target listed in an
annual query must be compared with March's collections, not the year's — get
that wrong and the screen reports 1,200% achievement, which is the first thing
a naive implementation does.

**A comparison is cut at the same point through the previous period.** "This
month against last month" asked on the 8th otherwise compares eight days with
thirty-one and reports a collapse every month: an error that looks like a
finding, which is the worst kind.

### First pass — search, the transaction file, cases



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

Ordered by what an officer loses without it. The first three are done; what
follows them is what remains.

1. ~~**Revenue targets and forecasting** (§12, §13).~~ Done. `revenue_targets`,
   target-versus-actual against each target's own period, and a forecast shaped
   by the collection curve that says what it rests on.
2. ~~**Period comparison** (§2, §8).~~ Done. Every period against the one
   before it, cut at the same point through itself, with growth as basis points
   and null — never zero — where there is nothing to compare against.
3. ~~**Departments and the reporting line** (§1, §4).~~ Done. Cases route to a
   department, escalation walks up to a person, and every posting change leaves
   a dated append-only record.
4. ~~**Financial period closing** (§16).~~ Done. A closed month is refused by
   the database, closing and reopening are separate authorities, and closing
   over an unresolved exception demands a reason that goes on the record.
5. **Configurable roles and permissions** (§4). Today, changing who may
   approve a refund is a code change and a deployment.
6. **Audit sampling** (§25) and **audit reports as objects** (§26).
7. **PDF and Excel export** (§26). CSV is enough for analysis and not enough
   for a report that goes in a file.
8. **Officer sessions and evidence upload** (§1, §23). An officer cannot see
   their own sessions, and an auditor cannot attach a document that did not
   originate in the platform.
9. **An officer inbox, system alerts and saved filters** (§1, §3).

All four of the items I said I would not put in front of a PSIRS officer
without are now done.
