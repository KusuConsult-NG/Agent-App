# What a Revision 11 would have to assess

**This is not a certification and makes no readiness judgement.** It is the
input somebody needs in order to commission one: a factual account of what
`certification-report.html` covers, what has been built since it was written,
and which of its own claims a revision would have to re-establish.

It was produced because the report is honest about its scope and that honesty
is easy to miss. It says, in its own closing section, *"Revision 10, assessed
at commit `fa8f454`, 3 September 2026."* Everything in it — the executive
summary, the blockers, the certification matrix, the system inventory, the
verification run — describes the platform as it stood at that commit.

## The size of the gap

`fa8f454..HEAD` is **211 commits**.

| | At `fa8f454` (Revision 10) | Now (`e3f5345`) |
| --- | --- | --- |
| API service modules | 39 | 44 |
| Database migrations | 54 | 78 |
| API test files | 139 | 177 |
| Tables | 77 *(report's figure)* | 103 |
| Triggers | 233 *(report's figure)* | 156 *(see below)* |
| CHECK constraints | 194 *(report's figure)* | 301 |
| API tests passing | 1,523 *(report's figure)* | 2,111 |
| Officer portal tests | 140 *(report's figure)* | 655 |
| Agent PWA tests | 134 *(report's figure)* | 342 |
| Declared enum states | 537 *(report's figure)* | 747 |
| Enum states written by the suite | 462 *(report's figure)* | 669 |

Current figures are from a full local run at `e3f5345`: API 2,111 passing
across four shards with 0 failing and 0 cancelled; portal 655; agent 342;
typecheck clean across all five projects; 74 states documented as deliberately
unreachable and 1 as not exercised by tests.

This paragraph previously read 2,045 at `c6c880a` while the table two lines
above it read 2,096 — the same quantity, twice, differing. Both were true when
written and neither was wrong on its own; what was wrong is that nothing made
them move together. They are now taken from one run at one commit.

HOW THE SCHEMA FIGURES ARE COUNTED, so a later reader re-deriving them does
not "correct" a right number into a wrong one. Tables are base tables in
`public` (103) — not tables carrying triggers, which is 95 and a different
question. Triggers are `pg_trigger` rows that are not internal
**and not test instrumentation** (156); a trigger declared
`BEFORE INSERT OR UPDATE` is one trigger here and two rows in
`information_schema.triggers`.

THIS ROW WAS WRONG UNTIL NOW, AND THE WAY IT WAS WRONG IS THE POINT. It read
332, measured against `psirs_test`. The suite's enum-coverage harness
(`apps/api/src/tests/enum-observation.ts`) attaches `observe_enum_ins` and
`observe_enum_upd` to every table it watches — 176 triggers across 88 tables —
so more than half of that 332 was instrumentation that exists in no deployed
database. A database built fresh from the 78 migrations carries 156. The
paragraph above this one is a careful note about *how* to count triggers, and
it was attached to a count taken from the wrong database; getting the method
right does not help if the subject is wrong.

The instrumentation already existed at `fa8f454`, so the report's 233 may be
inflated the same way. A revision should re-measure both against a database
built only from migrations rather than treat 233 and any later figure as
comparable. CHECK constraints are `pg_constraint` rows with
`contype = 'c'` across all schemas (301) — `information_schema` models every
NOT NULL as a check constraint and answers 1,694, which is not what this row
means.

## Seventeen service modules the report has never seen

`arrears`, `audit-workbench`, `cases`, `connections`, `enumeration`, `export`,
`integration-health`, `investigation`, `officer-devices`, `officer-inbox`,
`organisation`, `paye`, `payment-history`, `periods`, `presumptive`,
`rbac-store`, `targets`.

Four of those decide or record money and are the ones a revision cannot skip:

* **`paye`** — an employer files a monthly PAYE return; the platform computes
  the tax per employee, raises an assessment and bills it. New money in, by a
  route no agent touches.
* **`periods`** — a financial month is closed and the database refuses to
  reopen it. This is the control the whole report's financial-integrity section
  is about, and it did not exist when that section was written.
* **`targets`** — every revenue figure acquires a target to be judged against.
* **`presumptive`** / **`enumeration`** — the informal sector: an officer
  observes a business and the platform estimates what it owes.

Two more change who may do what, which the report's access-control section
assesses as a property of code:

* **`rbac-store`** — the role-permission map moved out of code and into the
  database, cached and invalidated at runtime. The report's security section
  reasons about a map that is no longer where it says it is.
* **`organisation`** — departments, a reporting line and postings, which is a
  second axis of scope beside territory.

## Twenty-two migrations, by what they introduce

`055` work across departments · `056` revenue targets · `057` the organisation ·
`058` a month that can be closed · `059`–`060`, `067` permissions as data and
retired roles · `061` a flag naming an officer · `062` audit samples and signed
reports · `063` officers' own devices and files · `064` the officer inbox ·
`065` whether the outside world answered · `066` how much a role may export ·
`068` what a person is connected to · `069`–`070`, `075` PAYE and its schedule ·
`071`–`073` what the agent saw, a count with no signal, what the agent was told ·
`074` a citizen's own statement · `076` a report that did not say it stopped.

## Claims in the report a revision would have to re-establish

These are not assertions that the claims are now false. They are the specific
sentences whose evidence was gathered at `fa8f454` and which name a figure or a
mechanism that has since changed.

1. **The certification matrix** has no row for payroll, presumptive assessment,
   revenue targets or the officer command centre. Searching the document for
   "payroll", "presumptive", "command centre" and "revenue target" returns
   nothing at all.
2. **"189 of 189 declared routes exercised."** There are now 281 declared
   routes, and `route-coverage.mjs` reports **281 of 281 exercised, 0
   uncovered**. This gap is closed, and the claim in the report is true again
   at the new number.

   It was open at 267 of 281, and the fourteen it named were the most
   actionable item in this document. They are worth a paragraph now that the
   list is empty, because of what emptying it found.

   **Two defects came off that list, in subsystems that had already been read
   and passed as sound.**

   * `POST /paye/returns/:id/cancel` withdrew a PAYE return without
     withdrawing the bill it had raised. The filing path refuses a second
     return for a month and tells the officer to "cancel it first if it was
     wrong — a second filing would double what they appear to owe", so an
     officer who followed that instruction left the employer owing both
     figures: exactly the doubling the sentence promised cancelling would
     avoid.
   * `POST /presumptive/lga-classes` and `POST /presumptive/nano-policy` reach
     `EXCLUDE USING gist` overlap constraints, and Postgres raises `23P01` for
     those. The error handler had no branch for it, so a rule refusing
     correctly fell through to the 500 at the foot of the function — whose own
     comment reads "Nothing above recognised this, which means it is a bug
     rather than a rule firing" — and additionally fired `reportError`. An
     officer reclassifying an LGA without closing the current classification
     got `INTERNAL_ERROR`, a support reference, and a paged alert.

   Neither was found by reading. Both services had been read. They were found
   by calling the route.

   **A third defect was found while writing coverage for the list**, in the
   money column those worklists carry: `paid_last_year_kobo` filtered
   `transactions.status` on `PAYMENT_CONFIRMED` and `RECEIPTED`, neither of
   which that table's CHECK constraint allows, so the set collapsed to
   `SETTLED` and an employer who had paid within the last 72 hours showed zero
   on an enforcement list.

   **What the coverage now holds** is mostly promises the routes make in their
   own comments and that nothing previously checked: that a disputed connection
   stops appearing on the chase list ("Chasing somebody on a claim they have
   already told the State is wrong is how an enforcement list turns into a
   complaint file"); that evidence bytes are checked against the declared type
   rather than the header; that a caller's filename cannot choose a storage
   path; and that an agent standing at a stall can raise an objection there.

   **Three defaulted scopes** were found and pinned in the process.
   `openObjections`, `coverageLeads` and `premisesNotPayingConsumptionTax` each
   declare `scope: ReportScope = { kind: 'STATEWIDE' }`. Every route passes the
   caller's scope today, but a dropped argument in any of them would serve a
   territory-scoped officer the names, phone numbers and addresses of citizens
   across Plateau State, and no test would have failed. Each now has a test
   with a territory-scoped supervisor and a subject in another LGA.

   THE THREE ARE NOT THE EXTENT OF IT, and this paragraph read as though they
   were. `scope: ReportScope = { kind: 'STATEWIDE' }` appears **26 times**
   across eight service modules — `reports` (15), `enumeration` (3), `paye`
   (2), `targets` (2), and one each in `arrears`, `connections`,
   `investigation` and `taxpayers`. Three of the twenty-six carry the test
   described above; the other twenty-three are defended only by every current
   caller remembering to pass the argument.

   That is a design decision a revision has to weigh rather than a defect
   list: the default is convenient, most call sites are routes that do pass a
   scope, and `STATEWIDE` is a meaningful value for a scheduled job with no
   caller. What is not defensible is the number being unstated. A revision
   should decide deliberately whether a report function may default its own
   scope at all, and the count it is deciding over is twenty-six.

   The remaining lesson is the one the tool's own header already records about
   an earlier error in the opposite direction: a coverage number is only worth
   what the counting is worth. One route here was exercised and still counted
   uncovered, because the test built its URL from a template beginning with
   `${apiBaseUrl()}` and the tool reads string literals that begin with a
   slash.

3. **"233 triggers across 77 tables, 194 CHECK constraints."** Now 156, 103
   and 301 — but see the counting note above before comparing the trigger
   figures: 233 was taken while the same test instrumentation existed, and 156
   deliberately excludes it.
4. **"enum coverage 462 of 537 declared states with none unaccounted."** Now
   669 of 747, still with none unaccounted.
5. **"140 tests across 18 files; 10 of 21 screens rendered under test"** for the
   officer portal. Now 655 tests, and the screen count has moved with the new
   subsystems.
6. **The security and access-control section** reasons about a permission map
   held in code. Migration `059` made it data, editable at runtime and cached.

   This is not only a stale citation. The gap between the two has since
   produced two defects, both of the same shape: a check written against the
   role's *name*, or against the map the deployment compiled in, rather than
   against what `role_permissions` currently grants.

   * `POST /drafts/sync` gated three offline capture types on
     `taxpayer:create` where their online routes ask for `assessment:create`,
     `paye:file` and `vehicle:renew`. Closed at `26c1c5e`.
   * `GET /government/home` carried no permission guard at all and switched on
     `req.auth.role`. Four of its branches are statewide reads and two return
     taxpayer names and telephone numbers from anywhere in Plateau State, on
     the justification — written into the report functions themselves — that
     the role holds `report:read:all`. Withdrawing that grant over
     `POST /government/roles/:name/revoke` narrowed every other report and
     changed nothing here. Closed at `bd65954`.

   A revision should treat "is this check asking the store, or asking the
   shape of the deployment?" as a question to put to every access decision,
   not as two isolated findings.

   The adjacent family — a *defaulted* access parameter, recorded above
   against `openObjections`, `coverageLeads` and
   `premisesNotPayingConsumptionTax` — gained a fourth member and lost it
   again. `getTaxpayerProfile` defaulted `viewer` to
   `{ role: 'revenue_officer' }`, the unrestricted view, so a caller who
   omitted it received the taxpayer's whole financial history. It had one
   caller and that caller passed a viewer, so nothing was reachable; the
   default is now deleted rather than pinned, because with a single call site
   a missing argument can be made not to compile instead of merely to fail a
   test. Closed at `a227f5a`.
7. **The financial-integrity section** predates the closed-month control in
   `058`, which is now the mechanism by which a reported month is final.

## One open question a revision would have to settle: which day

Not a defect, and not something changed here. A measurement, recorded because
it is a decision nobody has written down.

Thirty money queries across `reports.ts` (23), `periods.ts` (5) and `targets.ts`
(2) put a transaction in a day with a bare `created_at::date`. That resolves in
the database session's zone, which is `Etc/UTC`. Two other modules ask the same
kind of question and name the zone outright — `officer-inbox.ts` uses
`date_trunc('day', created_at AT TIME ZONE 'Africa/Lagos')` and `fraud.ts`
extracts the hour the same way, with a comment saying why: "the question is what
time it was for the person".

Plateau State is UTC+1, so the two do not agree about the first hour of every
day. Measured directly:

```
 the_instant                  | 2026-08-31 23:30:00+00
 plateau_wall_clock           | 2026-09-01 00:30:00
 date_the_query_buckets_it_as | 2026-08-31
 date_it_happened_in_plateau  | 2026-09-01
 counted_in_august            | t
 counted_in_september         | f
```

Money taken at half past midnight on 1 September, Plateau time, is counted in
August. The partition is consistent — every transaction lands in exactly one
bucket and the buckets tile the timeline, so nothing is lost or double-counted,
and an annual total is unaffected. What is affected is which month a figure
belongs to, and for `financial_periods` that figure is written once and frozen
by a trigger that refuses to reopen the month.

`lib/calendar-day.ts` has already reasoned about this hour and accepted it, but
for a different consumer: certificates and amnesty windows, where "the only
instant it excludes is between midnight and 01:00 on the opening day, when
nobody is presenting papers to anybody". That argument is about a person
carrying a document to an office. It does not obviously carry over to a gateway
webhook, which arrives at whatever hour it arrives. The same file names the
honest fix and says it is "worth doing deliberately, not as a side effect".

Deliberately is the point. Changing it would move every reported figure at every
month boundary, so it is a decision for PSIRS rather than a change to make while
passing. What is recorded here is that the platform currently answers "which
day" in two different ways depending on which module is asked, and that nothing
says which one a financial month is supposed to use.

## A second open question: what the chain cannot see

Not a defect, and not something changed here beyond the sentence that
overstated it. A measurement, recorded for the same reason as the one above:
it is a decision nobody has written down.

`audit_logs` is hash-chained and the database refuses `UPDATE` and `DELETE` on
it outright. The chain exists for the case where those refusals are bypassed —
an operator with rights over the database, which is the adversary a
tamper-evident log is for. Measured against a copy of the seeded stack, with
the triggers disabled first:

```
rewrite the reason on entry 120     BROKEN at 120: the entry's content does
                                    not match its recorded hash
delete entry 120 from the middle    BROKEN at 121: an entry is missing or was
                                    inserted out of order
delete the five most recent (194+)  intact: 193 entries replayed, none altered
                                    or missing, up to sequence 193
```

The third is not a fault in the implementation. A chain proves that the entries
present are unaltered and consecutive; entries cut from the *end* leave a
shorter chain that is perfectly self-consistent, and nothing inside a log can
say how long the log was supposed to be. Detecting that needs an anchor kept
outside it.

**There is no such anchor.** `audit_reports.checksum` covers the report's own
payload, not the chain. No column in any other table records a chain head:
searching the schema for `chain`, `sequence` or `_head` outside `audit_logs`
returns `training_modules.sequence_no`, `transaction_events.sequence` and
`case_events.sequence_no`, none of which is one.

What has been changed is the claim. The verdict an auditor was shown read
"Verified over {{count}} entries. **No tampering detected**", which is a
stronger statement than the replay supports, on the one screen whose purpose is
that integrity is not taken on trust. It now reports how many entries were
replayed, that none was altered or missing among them, and the sequence it
reached — so an auditor who records that number can see a shortened log next
time. `audit-chain-covers-the-row.test.ts` pins both halves: the truncation
blindness as a deliberate property, and the number that exposes it.

What a revision has to settle is whether that is enough. Anchoring options —
periodic signed head receipts, shipping the head off the box, writing it into
the signed audit reports that already exist — differ in cost and in who has to
be trusted, and choosing among them is PSIRS's decision rather than one to make
while passing.

## A third open question: which disaster-recovery procedure is the procedure

There are two, and they are not the same one.

```
docs/DISASTER-RECOVERY.md        ->  apps/api/scripts/backup.sh
                                     apps/api/scripts/restore.sh
docs/DISASTER-RECOVERY-PLAN.md   ->  deploy/backup/backup.sh
                                     deploy/backup/restore.sh
```

They differ in more than location. The archives are named differently
(`psirs-<stamp>.dump` against `psirs_backup_<stamp>.dump`), the restore takes
its target differently (`RESTORE_TARGET_URL` in the environment against a
positional second argument), and they verify different things:

| | `apps/api/scripts` | `deploy/backup` |
| --- | --- | --- |
| checksum against a manifest | yes | yes |
| financial tables present, with counts | 8 tables | table count only, printed |
| named control trigger present and enabled | yes | yes, since this commit |
| the control actually exercised | yes | no |
| run by CI | no | yes, via `verify-backup.sh` |

The last two rows are the point. The pair that verifies more is the pair no
automation runs; the pair CI runs is the one that verifies less. An operator
following `DISASTER-RECOVERY.md` at two in the morning runs scripts that have
never been exercised by anything except by hand, and an operator following
`DISASTER-RECOVERY-PLAN.md` runs the tested ones and gets a weaker assurance.

Both were exercised end to end while writing this: a real backup of the seeded
stack, restored into a fresh database, 23 transactions and 198 audit entries
back, 21 triggers, checksum verified. Neither is broken. What is unsettled is
which one PSIRS is supposed to use, and nothing in either document
acknowledges that the other exists.

A revision should not need to guess. Consolidating to one pair, or stating
plainly which is authoritative and why the other is kept, is a decision for
PSIRS — it touches the runbook people are trained on and the scheduling that
has yet to be set up (`DISASTER-RECOVERY.md` records that `backup.sh` "is not
yet on a timer anywhere").

## What this document deliberately does not do

It assigns no defect numbers, changes no matrix verdict, and does not say
whether the platform is ready for production. Appending findings to a report
whose matrix silently omits half the system would make the document look
current while leaving it less honest than its own `fa8f454` anchor makes it
today. That anchor is the reason the report can still be trusted for what it
covers, and it should stay until a revision covers the rest.
