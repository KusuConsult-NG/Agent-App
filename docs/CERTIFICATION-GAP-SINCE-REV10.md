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

`fa8f454..HEAD` is **215 commits**.

| | At `fa8f454` (Revision 10) | Now (`ffe3242`) |
| --- | --- | --- |
| API service modules | 39 | 44 |
| Database migrations | 54 | 80 |
| API test files | 139 | 190 |
| Tables | 77 *(report's figure)* | 103 |
| Triggers | 233 *(report's figure)* | 156 *(see below)* |
| CHECK constraints | 194 *(report's figure)* | 301 *(see below)* |
| API tests passing | 1,523 *(report's figure)* | 2,171 |
| Officer portal tests | 140 *(report's figure)* | 656 |
| Agent PWA tests | 134 *(report's figure)* | 345 |
| Declared enum states | 537 *(report's figure)* | 752 |
| Enum states written by the suite | 462 *(report's figure)* | 671 |

Current figures are from a full local run at `ffe3242` plus the working tree:
API 2,171 passing across four shards with 0 failing and 0 cancelled; portal
656; agent 345; typecheck clean across all five projects. The 81 declared states the suite did
not write break down as 74 documented as deliberately unreachable, 1 as not
exercised by tests, and 6 that are a column's default — the database writes
those on any insert that omits the column, so no row taking one means the
column is always specified rather than the state being unreachable, and the
script skips them with that reasoning. 74 + 1 alone does not balance against
752 - 671, which is why the third category is named here.

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
`information_schema.triggers`. CHECK constraints are `pg_constraint` rows of
type `c` **on a relation in `public`** (301).

THIS ROW WAS WRONG UNTIL NOW, AND THE WAY IT WAS WRONG IS THE POINT. It read
332, measured against `psirs_test`. The suite's enum-coverage harness
(`apps/api/src/tests/enum-observation.ts`) attaches `observe_enum_ins` and
`observe_enum_upd` to every table it watches — 176 triggers across 88 tables —
so more than half of that 332 was instrumentation that exists in no deployed
database. A database built fresh from the 80 migrations carries 156. The
paragraph above this one is a careful note about *how* to count triggers, and
it was attached to a count taken from the wrong database; getting the method
right does not help if the subject is wrong.

The instrumentation already existed at `fa8f454`, so the report's 233 may be
inflated the same way. A revision should re-measure both against a database
built only from migrations rather than treat 233 and any later figure as
comparable.

AND THE PARAGRAPH THAT SAID SO GOT ITS OWN SUBJECT WRONG, TWICE. It read:
"CHECK constraints are `pg_constraint` rows with `contype = 'c'` across all
schemas (301) — `information_schema` models every NOT NULL as a check
constraint and answers 1,694, which is not what this row means."

Both figures in that sentence are measured against something wider than the
platform, and the sentence is about not doing that.

`across all schemas` admits two constraints PostgreSQL creates in the
`information_schema` of every database that has ever existed —
`cardinal_number_domain_check` and `yes_or_no_check`. They are no more part of
this platform than the observation triggers were, and by the standard the
trigger row above sets — instrumentation "that exists in no deployed database"
— they belong outside the count for the same reason. Narrowed to relations in
`public`, which is how tables are already counted, the figure was 299. This is
a change of rule rather than the correction of an error: 301 was consistent
with the method printed beside it, and a reader who re-derives it should know
why it moved.

It is 301 now. Two have been added since: migration 079's
`notifications_secret_cleared_when_terminal` and migration 080's
`notifications_provider_named_when_delivered`. A row the gateway has finished
with must not still be holding the credential it was carrying; the constraint
is what makes that a property of the schema rather than of the four `UPDATE`
statements in `dispatchQueued` that clear it.

`1,694` was measured against `psirs_test`. On `psirs_uat` the same query
answers 1,691, and the three between them are the NOT NULL columns of
`psirs_test_observations.enum_writes` — the enum-coverage harness again, in the
very sentence warning that the harness inflates a count. The illustration still
holds and the number is now the platform's.

WHAT EACH FIGURE IS MEASURED AGAINST. Two of the numbers in the table above
were wrong for the same reason — measured against a database that is not the
platform — so this says, for each one, what the subject is. The counting rules
are one thing and the subject is another, and getting the first right does not
save you from the second.

| figure | subject |
| --- | --- |
| tables, CHECK constraints, declared states | relations in `public` of any migrated database; verified identical in `psirs_uat` and `psirs_test`. Declared states are the CHECK sets of every column except the five named in `NOT_STATE_COLUMNS`, which hold a language tag rather than a state |
| triggers | a database built **only** from migrations (`psirs_uat`), because the suite adds 176 observation triggers to `psirs_test` |
| enum states written by the suite | the four shard databases after a full run, counted over the declared set only |
| API / portal / agent tests | one full local run at the commit named above |
| service modules, migrations, test files | files on disk at that commit |
| routes exercised | `route-coverage.mjs` at that commit |

A figure whose subject is not written down is a figure somebody will re-derive
against whatever database they happen to have open, which is how both errors
were made and how the 233 in the report may have been made too.

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

## Twenty-six migrations, by what they introduce

`055` work across departments · `056` revenue targets · `057` the organisation ·
`058` a month that can be closed · `059`–`060`, `067` permissions as data and
retired roles · `061` a flag naming an officer · `062` audit samples and signed
reports · `063` officers' own devices and files · `064` the officer inbox ·
`065` whether the outside world answered · `066` how much a role may export ·
`068` what a person is connected to · `069`–`070`, `075` PAYE and its schedule ·
`071`–`073` what the agent saw, a count with no signal, what the agent was told ·
`074` a citizen's own statement · `076` a report that did not say it stopped ·
`077` one per cent computed three ways · `078` what objecting costs a trader ·
`079` a credential kept after it was delivered · `080` a message that claims it
was delivered.

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
   671 of 752, still with none unaccounted.

   Both halves of that ratio have moved twice in this document, for two
   different errors in the same rule, and both are worth keeping because the
   rule looked reasonable each time.

   The numerator read 669 against 747 for one revision. The denominator
   counted upper-case values only, deliberately: `enum-observation.ts`
   recorded that "lower-case sets — `usage_events.language` is 'en' and 'ha' —
   are values of a different kind, not states anything transitions to", and
   the observer never watched those columns. The coverage script's separate
   read of standing reference data did not apply the same rule, so
   `notification_templates.language: en`, `: ha` and
   `users.preferred_language: en` were counted as written — three values the
   denominator excludes on purpose. A ratio whose numerator is drawn from a
   wider universe than its denominator is not a ratio, and it became 666 of
   747.

   The accounting was never affected: the loop that finds unwritten states
   iterates the declared set, so a value outside it was never compared to
   anything. Only the headline figure moved.

   The second error was in the exclusion itself, and it cost coverage rather
   than arithmetic. Fifteen values sat outside this report entirely: ten
   language codes across five columns, and the five role names on
   `cases.department`. A previous revision of this document raised the second
   group as a question rather than answering it. The answer is that they are
   states and always were — `POST /cases` and `POST /cases/:id/assign` both
   take one, `my-work` reads the department queue off it, and all five are
   reachable — so a rule that decided by letter case excluded a routing column
   along with the language tags it was aimed at.

   What that cost is the point. `supervisor` and `admin` were written by
   nothing anywhere in the repository, and the check built to find exactly
   that could not see the column in either direction. Run the old script
   against shard databases with every `cases.department` write removed and it
   prints 666 of 747 and exits 0: a column with no coverage at all, and
   silence. The exclusion is now a named list, `NOT_STATE_COLUMNS`, one entry
   per column with the reason it holds something other than a state, and both
   halves of the ratio read it. 671 of 752 — the same 81 unwritten as before,
   because the two states are now covered by a test that walks
   `CASE_DEPARTMENTS` rather than naming them.
5. **"140 tests across 18 files; 10 of 21 screens rendered under test"** for the
   officer portal. Now 656 tests, and the screen count has moved with the new
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

Thirty expressions across `reports.ts` (23), `periods.ts` (5) and `targets.ts`
(2) put a transaction in a day by casting the instant — `created_at::date`,
and in one case `initiated_at::date`. That resolves in the database session's
zone, which is `Etc/UTC`. They sit in ten SQL statements, not thirty: the five
in `periods.ts` are scalar subqueries of one `SELECT`, and `reports.ts` spreads
its twenty-three across seven. A previous revision of this document called them
thirty queries, which overstates the number of statements by three times while
getting the number of places right, and a reader re-deriving either figure gets
a different number from the one printed.

A SECOND SYNTAX, THE SAME ANSWER, AND TWO MODULES THIS SURVEY LEFT OUT. Casting
is not the only way the platform buckets an instant into a UTC day. Two further
modules bound a half-open range instead — `created_at >= $from::date AND
created_at < ($to::date + interval '1 day')` — which resolves the boundary in
the same session zone and therefore gives the same answer as the cast, as the
measurement below shows.

`audit-workbench.ts` writes that bound in three places — the sampling
population, a `window()` helper, and the drawn-sample listing — reaching
eleven query branches, which is every figure in a *signed* audit report.
`payment-history.ts` writes it in three queries, which is the date filter on
what a citizen is shown of their own payments.

So the surface is five modules, not three, and the two this survey previously
omitted are the signed report and the citizen's own statement. That matters for
scoping rather than for correctness: a revision that moved `reports.ts`,
`periods.ts` and `targets.ts` to `Africa/Lagos` on the strength of this
inventory would leave the audit report of those figures, and the citizen's
history of them, still answering in UTC — an internal disagreement where there
is currently none.

Two modules ask the same kind of question and name the zone outright —
`officer-inbox.ts` uses `date_trunc('day', created_at AT TIME ZONE
'Africa/Lagos')` and `fraud.ts` extracts the hour the same way, with a comment
saying why: "the question is what time it was for the person".

Plateau State is UTC+1, so the two answers do not agree about the first hour of
every day, and the two UTC syntaxes agree with each other. Measured directly:

```
 the_instant                  | 2026-08-31 23:30:00+00
 plateau_wall_clock           | 2026-09-01 00:30:00
 date_the_query_buckets_it_as | 2026-08-31
 date_it_happened_in_plateau  | 2026-09-01
 counted_in_august            | t
 counted_in_september         | f
 in_a_september_range_bound   | f      <- the half-open form, same verdict
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
day" in two different ways depending on which module is asked — UTC in five
modules, written in two syntaxes, and Plateau time in two — and that nothing
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
| checksum against a manifest | yes | yes, and now says so when there is none |
| the archive read before the database is dropped | n/a, does not drop | yes, since this commit |
| a failed `pg_restore` fails the script | yes | yes, since this commit |
| financial tables present, with counts | 8 tables | 8 tables, since this commit |
| named control trigger present and enabled | yes | yes |
| the control actually exercised | yes | no |
| run by CI | no | yes, via `verify-backup.sh` |

The last two rows were always the point. The pair that verifies more is the
pair no automation runs; the pair CI runs is the one that verifies less. An
operator following `DISASTER-RECOVERY.md` at two in the morning runs scripts
that have never been exercised by anything except by hand, and an operator
following `DISASTER-RECOVERY-PLAN.md` runs the tested ones and gets a weaker
assurance.

A PREVIOUS REVISION OF THIS DOCUMENT SAID "NEITHER IS BROKEN", AND ONE WAS.

That sentence rested on exercising both end to end — a real backup of the
seeded stack, restored into a fresh database, 23 transactions and 198 audit
entries back, triggers present, checksum verified. Every word of it is true and
it is the wrong test. A restore script's entire job is the run that goes wrong,
and neither script had ever been given one.

`deploy/backup/restore.sh` ran `pg_restore ... || true`, discarding the
verdict, and then "verified" by counting rows in `information_schema.tables`
and printing the number without comparing it to anything. Measured, against a
throwaway database:

```
truncated archive   pg_restore: could not read from input file: end of file
                    [restore] Restore complete. Public schema tables: 0
                    exit 0

valid archive, no   [restore] Restore complete. Public schema tables: 1
financial tables    exit 0
```

Both after step 3 had already dropped the target database, whose default is
`psirs`. The failure mode was: destroy the database, fail to replace it, report
success. The same shape appears twice more in the pair — a missing `.sha256`
skipped the integrity check without a word, and `backup.sh` skipped the
off-site upload in silence when `BACKUP_S3_BUCKET` was set on a host with no
`aws` CLI, which is the difference between having off-site backups and
believing you have them.

CI did not catch any of it, and the reason is worth keeping: `verify-backup.sh`
makes its own assertions *after* calling `restore.sh`, so the restore script's
own verification step was never the thing under test. A caller that checks the
callee's work conceals a callee that checks nothing.

All four are closed at the commit above. The same three archives now give exit
2 before the drop with the database untouched, exit 3 naming the missing table,
and exit 0 with all eight financial tables listed. What is still unsettled is
which procedure PSIRS is supposed to use, and nothing in either document
acknowledges that the other exists.

A revision should not need to guess. Consolidating to one pair, or stating
plainly which is authoritative and why the other is kept, is a decision for
PSIRS — it touches the runbook people are trained on and the scheduling that
has yet to be set up (`DISASTER-RECOVERY.md` records that `backup.sh` "is not
yet on a timer anywhere").

## Seven migrations the test databases hold and the repository does not

Closed at the commit this section was written for, and recorded because the
shape recurs: `migrate.ts` enforced half of what its header promised.

It holds an applied migration to its *contents* — change the file and the
checksum no longer matches and the run refuses, "applied migrations are
immutable". Nothing held one to *existing*. The loop walks the files on disk,
so a row in `schema_migrations` naming a file that has been deleted or renamed
was never visited and never mentioned. Measured on a scratch database: insert a
row for a filename nobody has, run again, and the answer is "schema is up to
date" and exit 0.

It was not hypothetical here.

```
psirs_uat         78 applied, 78 on disk
psirs_test        85 applied, 78 on disk
psirs_test_s1..4  85 applied, 78 on disk
```

Seven migrations were renumbered from 055-061 to 068-074, presumably when
another branch took those ordinals first. Both halves of that were silent: the
old rows name files nobody can produce, and the same SQL under its new name
looked unapplied and was applied a second time in every database that had the
old names.

Nothing was damaged, and the reason is worth naming because it is not a
control. Those seven files are `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX
IF NOT EXISTS` throughout, so the second application did nothing. Had any of
them been a bare `CREATE TABLE` or an `ALTER TABLE ... ADD COLUMN`, the second
run would have failed — loudly, which is better, or in the middle of a
deployment, which is worse. `psirs_uat` and `psirs_test` still agree at 103
tables and 301 CHECK constraints.

What it costs while it is silent is the ability to rebuild a database from the
repository and get the one that is deployed. A row nobody can produce is a
schema change nobody can review, reproduce or roll back — and that is the only
reason to keep the table at all.

The runner now compares the applied names against the files after loading
both, and refuses on any it cannot find. The seven real renames are recorded in
a `RENAMED` map in the same file, each verified to point at a file that is
still there, so an existing database keeps working and the history is written
down rather than made every holder's problem.

## A credential the queue kept, and what the backups still hold

Two tables in this schema hold only a SHA-256 of a credential, on purpose, and
both say so where they are written: `otp_codes.code_hash` and
`referee_invitations.invitation_token_hash`. The referee module's own header
put it as plainly as it can be put — "Invitation tokens are stored only as
hashes (§37): the plaintext exists once, in the message sent to the referee."

It existed twice. `queueNotification` rendered every template in full into
`notifications.message`, so the SMS carrying the one-time code and the SMS
carrying the invitation link sat in the same database as their own hashes — and
nothing has ever deleted a notification, so they sat there permanently. Neither
hash was doing any work. Run against `psirs_uat`, this join returned two
invitations, one of them still `SENT` and a fortnight from expiry:

```sql
SELECT i.status, i.expires_at
  FROM notifications n
  JOIN referee_invitations i
    ON i.invitation_token_hash =
       encode(digest(substring(n.message from 'referee/([A-Za-z0-9_-]+)'), 'sha256'), 'hex')
 WHERE n.event = 'REFEREE_INVITATION';
```

What that token opens is the whole of the referee portal's authorisation: every
route there is unauthenticated by design, because "the referee should not need
an agent account to respond". Holding one, a reader of the notifications table
can answer a nomination in the referee's name, or decline it — which marks the
referee `REJECTED` and pulls the agent's clearance back down.

No API route selects `message`, so this was never reachable over HTTP. The
reach is everyone with `SELECT` on the database: a reporting replica, an
analyst, a dump, and the backups — which is the part that outlives the fix.

**What changed.** Migration `079` masks the credential out of the rows already
queued and adds `notifications.secret_message`, which carries the deliverable
text from the queue to the gateway and no further: written only for a template
that actually renders a credential, read once by the dispatcher, and set to
`NULL` as the row becomes `SENT` or `FAILED` — with a CHECK constraint saying a
terminal row may not still be holding one. `message` keeps the same sentence
with the value masked, so a support officer working the queue still sees what
was sent, to whom, in which language and whether it arrived. A message that
carries no credential is stored in one column exactly as before.

**What did not change, and is PSIRS's to act on.** A backup taken before `079`
still contains every plaintext credential the platform ever sent. One-time
codes expire in minutes and are worthless in an old archive; referee
invitations last fourteen days, so **any snapshot or WAL segment from the last
fortnight can still hold a working one**. `DISASTER-RECOVERY-PLAN.md` §2.2 now
says so and says what to do about it. Deciding whether those archives are
re-encrypted, re-access-controlled or destroyed is a data-handling decision for
the authority, not one this repository can make.

`apps/api/src/tests/a-credential-the-queue-kept.test.ts` holds the property by
the mechanism rather than by the two events known to carry a credential: it
hashes every word-shaped substring of every stored body and looks for it in
both credential tables, so a third credential rendered into a third template is
caught on the day it is added. It also holds the other half — that the
unmasked text still reaches the handset, because a fix that stopped the leak by
sending a citizen six blocks where their code should be would be worse than the
leak.

## A guard whose own list was unguarded, and the bug that fell out of closing it

The last of the three workflows, `integration-verification.yml`, turned out to
be the most carefully reasoned file in the repository on exactly this subject:
its header records that the gate used to be a *step*, that "a job whose steps
are all skipped completes `success`", and that each night it therefore put a
green tick on a run which had contacted nobody. The gate is now the job's own
`if`, and one job means a skipped run is grey rather than green. Checked and
sound — including the three secrets it commits, all three already in
`PUBLISHED_SECRETS`.

Which raised the better question. `a-secret-this-repository-publishes.test.ts`
promises in its header that "the list cannot fall behind the files it is a list
*of*", and delivers that for `PUBLISHED_SECRETS` against `FILES`. **`FILES` is
seven paths somebody typed, and nothing held it to the repository.** A new
workflow, a second compose file or another example env could publish a
placeholder and neither list would notice — the same failure one level up.
Verified complete today (every tracked file assigning one of the three names
was already listed), so the gap was latent. It is now closed by walking the
tree and failing on any unlisted file that publishes one.

AND THE WALK IMMEDIATELY FOUND A BUG IN THE GUARD IT WAS EXTENDING. The scan's
pattern used `\s*` around the separator, which matches a newline, so an empty
assignment took the *next line* as its value:

```
PAYMENT_WEBHOOK_SECRET=          <- .env.example, line 21
ACCESS_TOKEN_TTL_SECONDS         <- reported as the published secret
```

No file in `FILES` leaves one of these empty, so nothing surfaced it until the
walk started reading files that do. It is `[ \t]*` now. A guard finding a bug
in the guard is the best argument for writing the second one.

The walk also had to repeat a rule the file already stated — `.env` and
`.env.local` are git-ignored and "whatever an operator keeps there is theirs
and is not published by us" — because walking the tree reaches them whether or
not the comment above `FILES` says they are out of scope.

    a new unlisted file publishing a secret   names the file and the value
    the newline-crossing pattern restored     names .env.example
    one real secret dropped from the list     the original test, naming the
                                              workflow it is published in

## The release path verified less than the branch path, and gated on nothing

Found by following the previous finding one file over. `deploy.yml` is what
actually ships, and its verification job ran **two of the six** checks the root
`verify` script names: `typecheck` and `npm test`. Absent were the four that
exist because something went wrong once:

| missing from the release path | why it exists |
| --- | --- |
| `test:concurrency` | the money path under contention — a whole CI job |
| `check:dead-predicates` | its own comment: "It has happened twice to money figures" |
| `check:action-matrix` | the who-may-do-what table a government reads, found stale above |
| `check:hausa-review` | what a native speaker reads before any of this reaches an agent |

**And "CI already ran it" is not a guarantee.** Nothing gates a tag on CI
having passed — no `workflow_run` trigger, no status check, nothing. A tag
pushed at a commit whose CI was red, cancelled, or never ran deploys exactly
the same way. So the release path needed those checks itself, and now has them.

A second, smaller thing in the same job: it ran `npm test` and then
`npm run test --workspace @psirs/agent`, which reads as extra assurance and is
the same suite again — `npm test` is the shared build plus all three. The
duplicate is gone and the remaining step says what it covers.

ONE SILENT BRANCH IN THE ROLLOUT, made loud. The rollback step is conditioned
on `steps.current.outputs.previous != ''`, and `previous` comes from
`DEPLOY_DESCRIBE_COMMAND || echo ''`. When that command fails there is nothing
to revert to and the rollback is skipped **in silence**: the job fails on the
health check, and nobody is told that the rollout which just failed is still
the one serving traffic. A step now runs on exactly that condition and says so.

The rest of the pipeline is sound and worth recording as such: it backs up
before migrating, runs migrations from the image being deployed so they are
byte-identical to the ones the new containers check against, gates on readiness
rather than liveness with a five-minute retry, and reverts automatically when
the rollout does not come up.

The guard from the previous finding now covers both workflows, so the two
cannot drift apart: dropping a check from either is a failing test that names
the file and the script.

A NOTE ON A TRANSIENT, recorded rather than smoothed over. The first full run
after this change reported 2,163 of 2,170 with **0 failed and 7 cancelled** —
one file whose `before` hook died, taking its seven tests with it. The cause
was not an assertion: `enum-observation.ts`'s `enumColumns()` hit
`statement_timeout` (57014) installing the observation triggers, on a database
that had been restarted cold minutes earlier with four shards warming it at
once. The re-run was 2,170 of 2,170. It is worth writing down because the
harness runs that catalogue query — `pg_get_constraintdef` across every CHECK
constraint in `public`, now 301 of them — once per test file, roughly 190 times
a run, against a fifteen-second timeout. Nothing is wrong with it today and it
is the kind of setup cost that gets slower as the schema grows.

## A check named in `verify`, absent from CI, and failing

The root `package.json` has a `verify` script, and it is the closest thing this
repository has to a statement of what "verified" means:

```
npm run typecheck && npm run check:hausa-review && npm run check:action-matrix
  && npm run check:dead-predicates && npm run test && npm run test:concurrency
```

`ci.yml` runs those steps individually rather than calling `verify`, and it ran
five of the six. **`check:action-matrix` was not there, and it was failing.**

`docs/ROLE-ACTION-MATRIX.md` is generated from the permissions the route files
actually name — the table a government reads to answer who may do what. Two
counts in it were wrong:

```
report:read:all     …and 22 more   ->   …and 21 more
system:configure    …and  1 more   ->   …and  2 more
```

**That drift is this document's own fault, and worth naming as such.** It is
exactly commit `54e9f5c` — the read-only-permission finding recorded above,
which moved `POST /usage/expire` off `report:read:all` and onto
`system:configure`. That commit reported CI green and cited it. CI *was* green,
and the document that tells a government an auditor cannot reach that route had
stopped being true, because the check that says so is the one CI does not run.

THE GAP HAD BEEN FOUND ONCE AND HALF CLOSED. The step immediately above the
hole says so, in a comment written when the Hausa sheet was added:

> This was in `npm run verify` and CI runs the steps individually, so nothing
> was running it.

Nobody asked whether a sibling had the same problem. One did.

So the fix is the property, not the instance:
`apps/api/src/tests/a-check-that-nothing-runs.test.ts` parses the `verify`
chain and the workflow and fails on any script named in the first and not
invoked by the second. Adding a check to `verify` and forgetting the workflow
is now a failing test. It reads `run:` lines only and has a second test proving
it — `ci.yml` explains several steps in comments that name their script, and a
checker that searched the whole file would have passed on the very gap it
exists for.

    the step removed again                   names check:action-matrix
    a new check added to `verify` only       names check:something-new

## The one error nobody anticipated, spoken with the most confidence

Every unhandled exception in this API is answered by `internal()`. It said:

> The request could not be completed because of a problem on our side. **No
> financial record has been changed.** Quote the reference below to support.
>
> `moneyStatus: NOT_DEBITED`

`MoneyStatus` defines NOT_DEBITED as "No payment was attempted; nothing has
been debited". An exception nobody anticipated can be thrown after a
transaction has committed, after a gateway has accepted a payment, after a
receipt has been issued — and the error handler that calls this says exactly
that, four lines above the call:

> on a revenue platform an unhandled exception is a taxpayer who paid and has
> no receipt

What the agent sees makes it concrete. `ui.tsx` renders NOT_DEBITED as **"No
money has been taken from the taxpayer"** — "Ba a karbi kudi daga mai biyan
haraji ba" — in plain error styling, not the warning styling it reserves for
UNCONFIRMED's "Do not collect again." So at the moment the platform knew least,
it spoke with the most confidence, to the person standing in front of somebody
who had just handed over cash. PRD §60 is the requirement this violates in
spirit while satisfying its letter: the error is specific, and specifically
wrong.

THE RULE IS THE CLIENT'S OWN, AND THE SERVER NOW MIRRORS IT.
`apps/agent/src/lib/api.ts` already decides this correctly for a request that
never got an answer at all:

> A read that never arrived moves no money whether it arrived or not. A write
> under `/payments` that never got an answer is a write whose effect is unknown
> — which is exactly what UNCONFIRMED means, and it is why the agent is told
> not to collect again rather than told nothing. Every other write says
> NOT_APPLICABLE, because telling an agent their taxpayer may have been debited
> by a failed support ticket is its own kind of wrong.

A 500 is that situation with a status line attached. The one thing no branch
does any more is claim that nothing happened.

**The control that matters most** is that a NOT_DEBITED the platform can prove
must survive. `paymentFailed` says it because the gateway said so, and it is
the one message that lets an agent collect again in good conscience; a fix that
swept every NOT_DEBITED out of the codebase would have cost them it. Restoring
the old assertion fails five of seven with both controls holding — more than
the three predicted, because the old text said NOT_DEBITED on every path
including reads — and making the payment branch never escalate fails exactly
the one test about a payment write.

## A control cached in each process, with nothing to tell the others

`roles.export_row_limit` is how many rows of the register may leave the
platform in one file. `services/export.ts` calls it "the only field on a role
that is a control" and says erring high "puts the register on somebody's
laptop". It was cached for thirty seconds in an in-process map, on reasoning
printed beside it:

> an export is not a hot path, but reading two rows per download to answer a
> question that changes about once a year is a query that exists to be
> forgotten about

Both halves of that argue against the cache. What it cost is that
`forgetLimits()` emptied one process's map and nothing told the others — there
is no LISTEN/NOTIFY and no version column anywhere in this codebase — and,
unlike `revoke()` next door, `setExportLimit` ends no sessions, so there was no
backstop either. Simulated by doing to one process exactly what happens to the
second, changing the row without telling it:

```
limit before                     = 100000
administrator lowers it to 1
limit still served               = 100000
```

For up to thirty seconds, on every instance but one, at the moment an officer
is most likely to be mid-export. The limit is now read per export — one row,
immediately before rendering a spreadsheet of up to tens of thousands — so
there is no second copy to go stale, and `forgetLimits` is gone rather than
left as a name that looks like a control.

The existing suite could not have caught this and still cannot: *"and the cache
does not hold it back"* changes the value through the service in the same
process, which is the one case where an in-process cache behaves correctly. The
new test does to the process what the network does to the others.

### The permission cache, which keeps its cache and has its guarantee narrowed

`rbac-store.ts` caches the role→permission map for the same thirty seconds, and
that one earns it: every authenticated request reads it. Its backstop is real —
`revoke` ends the sessions of everybody holding the role, and that is a database
write, so it takes effect on every instance at once.

Its header went one clause further than that: "and the next sign-in reads fresh
grants". Only here. `forget()` empties the map in the process that called it, so
an officer signed out by a revocation who signs straight back in and lands on
another instance is served that instance's snapshot, which can still hold the
withdrawn permission for the remainder of its thirty seconds.

Narrow — a single-instance deployment cannot reach it, and it needs a
re-sign-in inside the window — and **left as it is**. Closing it means a query
on the one read every authenticated request makes, and that is a trade PSIRS
should make knowingly rather than one to take while passing. The header now
states the guarantee it actually offers, which is the part that was wrong.

## A storage key that walks out of the storage directory

Recorded small, because it is small. `LocalStorageDriver.resolve` states its
own purpose — "Reject traversal outright rather than sanitising: a key that
tries to escape the root is a bug or an attack, never a legitimate document" —
and enforced it with `target.startsWith(this.root)`. A prefix match is not a
boundary. With a root of `/app/storage`:

```
../etc/passwd               -> /app/etc/passwd           rejected
../storage-evil/x.pdf       -> /app/storage-evil/x.pdf   ACCEPTED
../storage/../storage-x/z   -> /app/storage-x/z          ACCEPTED
```

Every sibling directory whose name merely begins with the root's is inside the
check. `put` creates the directories it writes into, so an escaping key would
land a document beside the mounted volume rather than in it — readable until
the container is replaced, then gone, with the document row still pointing at
it.

WHAT IT IS NOT. Nothing reachable produces such a key: every one is built by
`storageKey` from a document number or a uuid, no request body reaches it, and
`config.ts` refuses to boot in production while this driver is selected at all.
This is a latent defect in a development driver. It is fixed because the check
claims to reject traversal and rejected only some of it, and it is written up
here at its actual size rather than dressed as an exposure.

The boundary is now `target === root || target.startsWith(root + sep)`, and the
root has trailing separators stripped — because that check builds `root + sep`,
and a configured root of `/app/storage/` would make it `//`, which no
normalised path starts with, so every key would be refused and nothing could be
stored at all. Both halves are held: restoring the prefix match fails the two
sibling-directory tests, and removing the trailing-separator strip fails
exactly the test for it.

## A fraud rule that could not fire

`REPEATED_RECEIPT_REGENERATION` is one of the sweep's rules, and its own
comment says exactly what it is for:

> A receipt a hundred citizens verify is a receipt doing its job; the same
> officer fetching one document twelve times in a day is the signal.

It counts rows in `document_access_logs` `WHERE accessed_by IS NOT NULL`.

The only writer of that table is `GET /documents/:id/download`, which sits
outside `authenticate` deliberately — a taxpayer opens their receipt from an
SMS with no account, and the signed link is the authorisation. It records
`req.auth?.userId ?? null`, and nothing had ever put `req.auth` on that
request. So `accessed_by` was NULL on every row ever written, the rule's own
filter excluded all of them, and **it could not fire**. Not inferred; a
download carrying a valid officer bearer token recorded:

```json
[ { "access_type": "DOWNLOAD", "accessed_by": null, "ip_address": "127.0.0.1" } ]
```

`identifyIfSignedIn` now reads the token when one is offered. It changes who is
*named*, never who is *admitted*: the signature still decides that, and a
citizen with no session downloads exactly as before and is recorded
anonymously — which is correct, because the rule is about staff pulling one
citizen's document repeatedly, not about citizens. It reuses `authenticate`
rather than decoding the token itself, so a revoked session or a suspended
officer is not credited with a retrieval.

Both halves are held, and the mutation run separates them: removing the
middleware fails the two tests about naming and firing while the three controls
hold; making an unusable token *refuse* the download instead of naming nobody
fails exactly the test that a stale token in a browser tab must not turn a
valid receipt link into a 401. A fix that made the rule fire by requiring a
session would have locked every taxpayer out of their own receipt, which is
worse than the dead rule.

TWO THINGS THIS LEAVES OPEN, for PSIRS rather than for this repository. The
`access_type` column admits DOWNLOAD, VIEW, VERIFY and SHARE; only DOWNLOAD is
ever written, so the rule's `IN ('DOWNLOAD','SHARE')` is half a filter over a
vocabulary three quarters unused. And an officer who downloads through a link
they forwarded to themselves outside the portal still arrives without a token,
so the rule sees volume by person only where the person's client sends its
session — which is the portal and the agent application, and is where the
behaviour it describes would happen.

## What the traceability table cites, and what it said about the audit chain

`PRD-TRACEABILITY.md` maps every acceptance criterion from PRD §84 and
Addendum §47 to "the code that implements it and the test that proves it", and
nothing had ever checked that the tests it names exist. Seventy-nine citations;
this is what a check found.

**One was false, and it is the reason the rest of this section exists.** Against
**View audit logs** the table cited *verifies the audit hash chain end to end*.
No test of that name has ever existed — and the claim is one this platform has
already established it cannot make. The real test is *replays the audit hash
chain and says how far it reached*, and its body records why:

> This asserted /No tampering detected/, which the replay cannot establish:
> entries cut from the end of the log leave a shorter chain that verifies
> perfectly.

`services/audit.ts` says the same of the function: it "has no way to know how
long the log used to be". This is the third open question already recorded in
this document — the audit chain has no external anchor against truncation. The
code stopped claiming end-to-end verification and the test was renamed to stop
claiming it; the document a government reads went on claiming it. A second row
cited *verifies the audit hash chain*, which also names no test, though its
wording is not itself false.

**The rest were the check being wrong, and that is worth recording too**, because
each wrong answer would have been an accusation against a document that was
telling the truth:

| first reported | what it actually was |
| --- | --- |
| 5 tests "missing" | a curly apostrophe against a straight one |
| *drills down State → LGA → Ward* | the test writes the arrows as `->` |
| 2 tests "missing" | generated names — ``it(`refuses ${label}`)`` over a table of routes |
| 5 tests "not in the API suite" | they are in the agent suite, where that behaviour lives; the table's header named only `apps/api/src/tests/` |
| 3 tests "missing" | the table quotes the distinctive fragment of a long name |

So of 79 citations, **two named nothing** and the remaining seventy-seven were
sound. The header sentence was too narrow, one row's arrows were the wrong
glyph, and the two audit rows now name the test that exists.

`apps/api/src/tests/what-this-table-cites.test.ts` holds the table to this from
now on, and says in its own header what it cannot do: it checks that a cited
test exists, not that the test proves the criterion beside it. Those are
different questions and only the first is mechanical.

ONE THING THE GUARD GOT WRONG ABOUT ITSELF, recorded because it is the same
shape as everything above. The first version searched the raw text of every
test file — and passed on *verifies the audit hash chain end to end*, because
this new file's own header quotes that citation while explaining it. A guard
that reads its own prose as evidence cannot fail for the one input it was
written for, and reports success. It now parses names out of `it`, `test` and
`describe` declarations instead, which is both stricter and immune to being
talked about.

## A promise of a constraint, and a nullable column

`PRD-TRACEABILITY.md` is the table a government reads to answer "how is this
enforced". One row answered with a database guarantee:

> A message is never recorded as sent unless a provider took it —
> `notifications.provider` NOT NULL for SENT

No migration ever wrote that constraint. The column was added by migration
`011`, whose own header states the remedy in the strongest word available:

> `provider` is what makes that **unrepresentable** going forward: a row can
> only claim SENT alongside the name of the service that accepted it.

It adds `provider TEXT`. Nullable, no CHECK, no trigger. Nothing was
unrepresentable — demonstrated against `psirs_uat` with no service involved:

```sql
INSERT INTO notifications (recipient, event, channel, message, status,
                           sent_at, provider_reference)
VALUES ('+2348000000000','RECEIPT_GENERATED','SMS','PSIRS: your receipt…',
        'SENT', now(), 'looks-real-000999');
-- INSERT 0 1, provider NULL
```

A row claiming delivery, with a timestamp and a plausible gateway reference,
and no gateway.

WHY 011 EXISTS IS WHY THIS MATTERS. `dispatchQueued` used to mark every
notification SENT with a fabricated `mock-<id>` reference whether or not a
provider had been configured, let alone contacted. Nothing reached anybody and
the table said otherwise. For a citizen who holds no account, that SMS is the
only copy of their receipt they ever get, so the table saying otherwise is the
whole of the harm. The service has been correct since 011 and sets `provider`
on every path; what was missing is the thing this repository says in its own
tests — *a rule the service enforces and the database does not is one UPDATE
away from being undone*.

Every other database control that traceability table names is real:
`receipts_require_verified_payment`, `renewals_require_payment`, `UNIQUE
(gateway, event_id)`, `idx_payments_one_active`, and the agent clearance CHECK
were each checked against the catalogue and each exists. This was the one that
did not, which is what made it worth finding rather than a symptom of a
careless document.

Migration `080` is the constraint. It deliberately still admits the four shapes
the delivery sweep actually produces — QUEUED with no provider (nothing asked
yet), QUEUED *with* one (tried, unreachable, still owed), FAILED with none
(nobody owns that channel) and FAILED with one (asked and refused) — and
covers DELIVERED and READ alongside SENT, because a message cannot have been
read without having been delivered. CHECK constraints: 300 → 301.

The guard attempts the forbidden write with the service bypassed, and also
holds the traceability table to its own claims. The mutation run separates the
two: dropping the constraint fails three of six including the document check,
narrowing it to SENT alone fails exactly the DELIVERED/READ test, and the four
legitimate shapes hold throughout. Against the document *as it read before this
commit*, the check reported the defect in the words it needed —
"notifications.provider is nullable and no CHECK mentions it together with
SENT" — which is the evidence that it would have caught this on the day the
claim was written.

## What a forwarded link was worth

The platform has three doors that take a token instead of a login, because the
person behind each has no account and no reason to hold one: a referee, a
cooperative's leader, and a citizen asking what they owe. `citizen.ts` states
the standard all three are held to and pays for it —

> every field here is read as though a stranger asked for it, because one can

— having given up the TIN, the compliance score, the obligation names, the date
of the last payment and the officer's closure note, on the reasoning that the
caller supplied a phone number and a phone number is not a secret.

`GET /group-attestation/:token` did not meet it. Measured, not reasoned about:

```json
{ "full_name": "Nanribet Choji",   "phone": "+2348120000100" },
{ "full_name": "Nanribet Dachung", "phone": "+2348120000110" },
{ "full_name": "Nanribet Gyang",   "phone": "+2348120000120" }
```

A village cooperative's phone book, to anyone holding the link, for the
fourteen days it stays live — and the invitation is deliberately reusable, so
unlike the referee's it never becomes spent.

What makes this one worth recording is that the reasoning already existed, one
file away and unapplied. `attestation-replay.test.ts` narrowed the *write* side
on exactly this threat — "these arrive by SMS to a village chairman's handset;
a forwarded message is a forwarded capability" — and in the same paragraph
points straight at the read it never revisited: "`openAttestation` hands out
every member's id". It hands out their telephone number too.

Numbers on that surface are now masked to the last three digits, which is the
rule the agent application already applies to the number a one-time code was
sent to: "enough to recognise, not to publish". Masked and not dropped, because
the screen's whole question is whether the leader recognises this person and
two members can share a name — three digits settle that for somebody who knows
their own members and settle nothing for anyone else.

The guard holds both directions, and the mutation run shows it: returning the
raw roster fails three of four, neutering the mask itself fails the same three,
and masking the number *completely* fails exactly one — the test that the
screen can still do its job. The fourth test is the class rather than the
instance: one fixture, every public door it can reach, and the assertion that
no telephone number the database holds comes back from any of them.

## A step-up code that named a role change, for a laptop

`SECURITY.md` says step-up authentication is "consumed on use — one code
authorises exactly one action". The consumption half holds: `consumeStepUpGrant`
spends the grant row under `FOR UPDATE SKIP LOCKED`, so one code buys one action
and two codes buy two, including when both are spent at once. The other word was
where the problem was. An action is a *name*, and the name is what gets written
down.

`POST /government/devices/:id/block` and `/unblock` asked for
`user.role.change`. The comment above them gave the reasoning: taking a machine
off whoever is holding it is "the same size of decision as changing an officer's
role, and gets the same extra verification". The size was right. Three things
followed from the name being wrong.

`grantStepUp` audits the grant it writes. An officer who blocked a stolen laptop
left an `auth.step_up_granted` row recording that they had authenticated a role
change — an authentication event naming an action that did not happen, in the
table whose whole worth is that it does not do that. An auditor reconciling
which step-ups authorised which actions would find role-change grants with no
role change beside them, and device blocks with no step-up of their own.

`requireStepUp` builds its refusal from the action, so an officer blocking a
handset was told, in `nextStep`, to step up for a role change.

And for the window's ten minutes the two doors took each other's keys. Blocking
and unblocking a handset is routine — a laptop is lost, a laptop comes back.
Changing a role is the rare one, and it is the action that turns one compromised
administrator session into any level of access at all. Minting a role-change
grant several times a week for handset admin is how an officer learns to approve
that prompt without reading it, and every routine unblock left a live
role-change authorisation open behind it.

The two routes now ask for `device.block` and `device.unblock`, split for the
same reason `financial.period.close` and `.reopen` are split: the risk runs one
way. Blocking is the defensive move; unblocking restores access to a machine
that was taken away for a reason, and a code obtained for the first should not
spend on the second.

The class is now checked rather than the instance. Every `requireStepUp` call in
the route files must share a word with the route it guards — twenty-one sites, a
floor so a scan that stops matching fails rather than passes, and no exception
list. It is a check on the *subject*, not the verb, and deliberately so:
`audit.report.sign` also gates `/audit/reports/:id/withdraw`, and the note beside
it says why. Grouping two operations on one subject under one name is a
judgement this repository makes on purpose. Gating a device route on a user
action shared no word at all, which is the line the check draws.

## What the portal asked for, and what the server would issue

Checking the list in the other direction — every action `STEP_UP_ACTIONS` offers
must be consumed by some route, and every action a route demands must be one the
list offers — turned up nothing on the server. Extending the same question to
the client did.

`RoleHome.tsx` asked for `commission.payout.approve`. There is no such action.
The list has `commission.payout.request`, and `POST /auth/step-up` validates with
`z.enum(STEP_UP_ACTIONS)` and answers 422. `stepUp` in the portal takes a plain
`string`, not `StepUpAction`, so nothing refused it at compile time.

What made it worse than a dead button is the order. `stepUp` calls
`/auth/otp/request` *first*, and that route does not care which action the code
is for — it sends the officer a text. Only then is the code presented to
`/auth/step-up` and refused. So approving a commission payout from the officer's
home screen sent an SMS, took the officer's code, and refused it. Every time,
since the button was written.

Nothing in either workspace could see it. The API tests post their own valid
bodies; the portal tests mock the network away. The check that now holds it
reads both: every action literal the portal passes to `stepUp` must be one the
list offers, with a floor of fifteen so the scan cannot quietly stop matching.

The same button was broken a second, independent way: it posted `{}` to a route
requiring `{ reason: string().min(5) }`. It is a copy of the approve button on
the Finance screen, which prompts for a reason through `withJustification` and
sends it. It now uses the same helper.

Whether approving a payout *should* need a step-up code is left open, and it is
PSIRS's question rather than this document's. The route asks for none; the
screen this button was copied from asks for none; segregation of duties is the
control actually in place, and the API test spells it out — the requesting agent
cannot approve their own payout, finance does. If the answer is that it should,
the change is an entry in `STEP_UP_ACTIONS` and a `requireStepUp` on the route,
not a name invented on one screen.

## Six buttons on the officer's home screen, dead since 30 August

The worst of the three, and it was found by accident while reading the one
above.

`useAction` is the helper `RoleHome.tsx` runs all six of its action buttons
through — re-ask a failed TIN, approve a payout, and four more. Its callback
opened with

```ts
const { t } = usePortalI18n();
```

at the wrong indentation, dropped in by the i18n pass of 30 August 2026 and
never used: nothing below it reads `t`. `usePortalI18n` calls `useState` and
`useEffect`, so calling it from inside an async callback calls a React hook
outside render. React's dispatcher is null there, and it throws `Invalid hook
call`.

The throw lands *above* the `try` two lines down, so the helper's own `catch` —
the one that turns a failure into an `ErrorAlert` — never saw it, and `setBusy`
had not run either. The officer pressed the button, the label did not change, no
error appeared, and nothing was sent. It is the same "watched the button stop
spinning and was told nothing at all" failure this portal has been through
before, except that here the button never started spinning.

This is recorded at length because of how it survived. The portal suite was
green at 656 tests with all six buttons dead: no test had ever clicked one.
Typecheck passes — a hook called in the wrong place is a runtime rule, not a
type. Lint did not run a rules-of-hooks check over it. The screen renders
perfectly, which is what the existing screen tests assert. Nothing in the
repository's considerable apparatus was pointed at the question "does pressing
this do anything", and for a fortnight the answer on the officer's home screen
was no.

It is proven by a click, not by reading: a test renders the screen, presses the
button, and asserts the request reaches the server. Restoring the line fails
exactly those two tests and nothing else, which is the measure of how alone they
are.

### The class is not guarded, and this is what it would take

The other findings in this document each came with a mechanical check for the
class behind the instance. This one does not, and the reason should be on the
record rather than left as an omission.

The standard answer is ESLint's `react-hooks/rules-of-hooks`, which is exactly
this rule and is what every React codebase uses to hold it. **There is no ESLint
in this repository at all** — no config, no dependency, no script. Adding it is a
toolchain decision with a real footprint (a plugin set, a config, a CI step, and
a first run that will have opinions about eleven thousand lines of existing
code), and it is PSIRS's call rather than something to slip in beside a bug fix.

Writing the check by hand was attempted and abandoned, which is worth recording
because the reason is not obvious. The check needs to know, for each `useX()`
call, which function encloses it — that is a parser's question, not a regular
expression's. The repository is on TypeScript 7, whose package exports only
version metadata from its root; the compiler API has moved to `typescript/
unstable/*`, is project- and snapshot-oriented rather than parse-a-file-oriented,
and is named unstable because it is. A guard built on it would break on a
TypeScript bump, and a guard that breaks is worse than an absent one, because it
gets deleted in a hurry by somebody who is not thinking about what it was for.

So: two tests that press two of the six buttons, and this paragraph. The
recommendation is ESLint with the `react-hooks` plugin, run in CI beside
`typecheck`. Until then the gap is real — a hook moved into a callback anywhere
in either React workspace will pass `tsc`, pass both suites, render perfectly,
and throw when somebody presses the button.

## A reason that was a field name away, and a sentence that was its own key

The payout button's `{}` raised a general question worth asking once: how many
other client calls send a body the server's schema would reject? It is a
mechanical question, so it was measured rather than guessed. Every `api.post`,
`.put` and `.patch` with an inline object body in both React workspaces --
115 of them -- against the required keys of the 113 routes that declare a
`validateBody` schema.

**One mismatch.** The class is not widespread, and that is the useful finding:
the payout button was not the tip of anything.

The one is on the same screen. `RoleHome.tsx` approves an agent with

    api.post(`/agents/${row.id}/review`, {
      decision: 'APPROVE',
      note: 'ofcRhApprovedFromHome',
    })

and the route takes `reason`, not `note`. So approving an agent from the home
screen was a 422 -- underneath the hook that was already stopping the request
being made at all.

The second half is worse than the first. The value is the dictionary KEY, not
`t.ofcRhApprovedFromHome`. Had the field name been right, the audit trail would
record the string `ofcRhApprovedFromHome` as the State's reason for letting
somebody collect revenue on its behalf -- and it would have passed the route's
`min(10)` comfortably, because a key is longer than ten characters. The
English-literal guard cannot see this: a bare identifier is exactly what that
check skips, by a rule added deliberately when it was hiding real words.

Approving an agent is what lets them collect. It is the second money-path
button on this one screen found broken in a way no test could see.

### No guard for this one either, and why

The scan that found it needed four corrections before it was right -- a
shorthand `{ reason }` read as an empty body; a fixed lookahead window let a
route using `asyncHandler` borrow the schema of the route below it; the search
for the next declaration started inside the current one and rejected almost
every schema; a `//` comment above a key hid that key. Each error pointed the
wrong way at least once.

It also cannot see a body built from a variable, a body with a nested object, or
one assembled with a spread -- and those are the shapes the remaining calls
mostly use. A check with that hit rate and that blind spot would raise false
alarms, and a check that raises false alarms is deleted in a hurry by somebody
who is not thinking about what it was for.

The real answer is not a scanner. `api.post` takes an untyped body, so none of
this is checked at compile time by a compiler that could check all of it. It is
the same shape as `stepUp(action: string)` taking a plain string when
`StepUpAction` exists: a type that is known on one side of the wire and thrown
away on the other. Exporting the route schemas -- `packages/shared` is the
obvious home -- and typing `api.post` against them would close this class
entirely and at build time, including every shape the scanner cannot read. That
is a structural change across both workspaces and it is PSIRS's call, so it is
recorded here as the recommendation rather than started.

## What else was swept after the home screen, and found clean

Three defects on one screen justified asking whether the same shapes were
elsewhere. Three sweeps, all clean, recorded because a bounded problem is worth
more than an unbounded suspicion.

**Every client call reaches a real route.** 187 calls with a literal path in the
two React workspaces, against all 281 routes. All 187 resolve. This is the
forward direction of `officer-actions-reachable.test.ts`, which holds the
reverse — that every officer endpoint has a caller — and nothing held this way
round until it was measured. Three apparent misses were all artifacts of the
scan: a `?` inside a ternary in a template literal, a query string built from a
variable, and a test file living outside a `tests/` directory.

**Interaction coverage.** Every screen in the officer portal that makes a write
call is now imported by at least one test that fires an event; the three that
are render-only make no write calls at all. In the agent PWA, nine files carry
29 write calls between them and every one is covered by an event-firing test.
The measurement was validated against the known answer first: it correctly
reports that `role-home.test.tsx` rendered the home screen and fired nothing,
which is precisely how three defects lived there.

**Tests that assert nothing.** 2,930 test cases scanned for a body with no
assertion in it. Six flagged; all six are false positives, and they share one
cause worth naming because it is a trap: brace-matching a function body without
skipping strings and regexes ends the body early, and `\$\{[^}]*\}` inside a
`.replace()` closes the count before any assertion is reached. The scan was
abandoned rather than sharpened -- it was finding nothing, and a fifth
correction to a tool with no findings is not evidence, it is sunk cost.

None of the three produced a defect. That is the result, and it is the useful
one: the home screen was not the tip of anything either.

## A rate of 150%, published to a government

`kpis()` answers PRD §91 with three percentages. Two are formed so that they
cannot be wrong: the numerator is a `FILTER` over the same rows as the
denominator, so it is a subset by construction.

    count(*) FILTER (WHERE status = 'VERIFIED') / count(*)   FROM payments
    count(*) FILTER (WHERE status = 'MATCHED')  / count(*)   FROM reconciliation_records

The third was not.

    (SELECT count(*) FROM receipts) / count(*)
      FROM transactions WHERE status IN (revenue states)

Every receipt the platform has ever issued, over the transactions that are in a
revenue state *now*. Two quantities that move independently, and a reversal is
what separates them: the transaction leaves the revenue states and so leaves
the denominator, while the receipt row stays. It has to stay — `receipts`
carries a `prevent_delete` trigger, and reversing a collection sets the
receipt's status to REVERSED rather than removing it.

Measured, not reasoned about. On a database holding one settled collection and
its receipt, reversing that transaction leaves a numerator of 1 over a
denominator of 0, so the zero branch answers **0%** — no receipts are being
generated, about a platform that generated one for every collection it took.
Three settled and one reversed answers **133.33%**. The mutation test reports
the three-and-one case as *"a rate of 150% is not a rate"*.

It is wrong in both directions and which way depends on the mix of reversals,
which is the worst property a published indicator can have: it is plausible
either way, so nobody checks it.

This is the fourth instance this document records of one shape — a figure
measured against a wider subject than the one it names. The others were the
enum coverage ratio, the performance figures that did not say what they were a
total of, and the trigger count that included test instrumentation.

Three tests, and the third is a control rather than a discriminator, which is
worth saying out loud. Two collections settled and one confirmed-but-unsettled
answers 66.67 under both the old query and the new one. It earns its place
anyway: the other two cases both assert 100, and a "fix" that returned a
constant 100 would satisfy them. Producing that case needed a fixture the
repository did not have — every seeded collection was driven all the way to
settlement — so `seedOneCollection` now takes an option to stop before it.
RECONCILIATION_PENDING with no receipt is a real and common state, the money
confirmed and the receipt waiting on a bank statement, and until now nothing
could test a figure that distinguishes collected from receipted.

## The rest of the arithmetic, and the webhook, found clean

The 150% rate came out of a sweep, and the rest of that sweep found nothing,
which is worth recording with the same weight.

**Every SUM that can be taken over nothing.** 130 uses of `SUM(` in the
services; 24 with no `COALESCE` on the same line, which is the wrong test
because multi-line SQL puts the `COALESCE` on the line above. Eight survived a
proper reading. Six are grouped, so the group always has a row. Two are scalar
subqueries with `COALESCE(( ... ), 0)` wrapping them. The eighth,
`taxpayersEndedWithArrears`, is an INNER JOIN whose own comment explains that
the join *selects* the queue — "a record with no unpaid invoice has no row to
join to and never appears" — and goes on to record that a `HAVING` clause was
removed from it as unreachable, with the reasoning. Nothing to fix.

**Every division.** Six with `NULLIF`, five without. All five are guarded:
a `GREATEST($1 - 1, 1)` denominator, a `targetKobo > 0n` ternary, and three
`CASE WHEN count(*) = 0` branches. `targets.ts` deserves a mention: its
seasonal projection divides by a median share, and three separate documented
fallbacks stand between that division and a zero — fewer than two comparable
years, a share below 5% ("a small numerator over a tiny denominator is noise
multiplied"), and an early return for a period that has not started or has
finished, which is also what stops `daysElapsed` reaching either run-rate
division as a zero. BigInt division by zero throws rather than giving
infinity, so each of those would have been a 500.

**Every other ratio.** `contribution_bp` divides a row's month by
`SUM(...) OVER ()` across the same CTE under the same scope — a subset of its
own window. `growth_bp` is `NULLIF`-guarded. Both correct.

**The webhook.** `POST /webhooks/payments` is the one place where a wrong
status code loses money permanently: acknowledge a delivery you did not
process and the gateway never sends it again. Every branch is deliberate and
every one is recorded in the row: unparseable is REJECTED and answered 400,
unauthenticated is recorded and then refused with a 401, a duplicate is
acknowledged, a reference matching no platform payment is IGNORED and
acknowledged, and a `confirmPayment` that throws is marked FAILED and *still*
acknowledged — with the reason written beside it, so the gateway does not retry
forever.

That last decision is the one worth checking rather than accepting, because it
is the one that trades a retry away. The condition is surfaced three ways: the
`rejected_webhooks` gauge counts REJECTED and FAILED, the `unverified_payments`
gauge counts any payment left unverified for over an hour, and the overnight
statement sweep reaches the money independently. The money is not lost.

One precision, recorded rather than changed: the comment says the failed
delivery "sits in the reconciliation exception queue instead", and nothing
routes the webhook event there. The queue is over `reconciliation_records` and
is filled by the statement sweep, which reaches the same money by its own
route. The effect the sentence promises happens; the mechanism it names is not
the one that produces it.

**An observation for PSIRS, not a defect.** Nothing retries a FAILED webhook
delivery, and no officer screen lists them — the only reader outside the tests
is the Prometheus gauge. So an operator watching metrics sees a number rise
with no way to see which deliveries it counts or to ask for them again. A
transient gateway timeout during confirmation therefore costs a day's delay
rather than seconds. Whether that is worth a retry and a list is an operational
judgement about how often the gateway actually times out, which is PSIRS's to
make and not visible from here.

## The reference a government integrates against, checked against the code

`docs/API.md` is hand-written, and nothing held it to the API. The step-up
table — seven rows, the contract for the seven most consequential actions the
platform offers — had **three of them wrong**.

`POST /government/payments/:id/reverse` is not a route and never was. The
reversal flow is three steps under segregation of duties: raise a
`PAYMENT_REVERSAL` approval (which needs `payment:reverse:request` on top of
`approval:request`), have a second officer decide it, have a third execute it
at `/government/approvals/:id/execute-reversal`. The row collapsed all of that
into one endpoint that answers 404 — and the same document states the real
route correctly about thirty rows further down, so it contradicted itself
rather than merely being out of date.

`payment:reverse` is not a permission. The catalogue has
`payment:reverse:request` and `payment:reverse:approve`.

`catalogue:manage` is not a permission either. The rate-change route checks
`catalogue:configure`.

The fourth is the one that would have cost something. The suspend row named
`agent:manage`, which **administrators alone** hold. The route checks
`agent:suspend`, which **supervisors and revenue officers hold too**. So the
reference told a supervisor to go and find an administrator before an agent
could be stopped from collecting — on the one control whose entire value is how
quickly it can be used. Wrong in the direction that adds delay to an
emergency.

A fifth, smaller: `` `GET`/`POST` | `/agents/me/training[/:moduleCode]` ``
claimed both methods work with and without the module code. `POST` without it
does not exist.

### The check, and what it deliberately does not check

Two properties, neither needing a list anybody maintains.

Every path the document writes out **in full** must be a route. Not every path
it mentions: the reference uses two abbreviations a scan reads as broken links
— a `·` joining a full path to a sibling named only by its last segment, and
`[/:id]` for an optional one — and requiring a known router mount prefix drops
those without guessing what they expand to. A trailing `*` is honoured as a
family and satisfied by any route under the prefix. The fully-written paths are
what an integrator copies anyway.

Every permission-shaped token must be a permission.

It does **not** check that every route is documented. 144 of 281 are not, and
that is not a defect: the reference is prose about the surfaces that matter, it
claims completeness nowhere, and a check demanding it would invent a standard
this repository never set.

The scan that found all this reported thirty-four broken links on its first
run and five on its second; every one of the twenty-nine that disappeared was
the scan's own fault, and four of the last five were too — a table cell carries
its own method labels as often as it inherits the row's first cell, and
applying the row's method to every path in it condemns four good rows. Each was
checked against the code rather than believed. That is the whole reason the
count came down to one: the tool was wrong far more often than the document
was.

## A procedure for a live chargeback, naming an endpoint that does not exist

Having found the API reference wrong, the same two questions were put to every
markdown file in the repository: does each permission it names exist, and does
each fully-written route. 28 files, 221 permission mentions, 282 route
mentions.

Most of what came back was correct prose about things that were **removed on
purpose** — `PRD-TRACEABILITY.md` has a "Was / Now" table whose left column is
a list of deleted surfaces, and `SECURITY.md` §8 is titled "Attack surface that
exists for a workflow the product does not have" and describes the
self-registration endpoint that was taken out. A naive repo-wide check flags
both, which is why the guard added with the previous finding is scoped to
`API.md` and stays there. This document would fail it too, for quoting the
names it exists to report.

Two were real, and one of them matters.

`docs/SOP-FINANCE-RECONCILIATION.md` is a **standing operating procedure**,
audience "Finance Officers, Auditors, Revenue Directors". Its Case 2 is a
fraudulent chargeback — money leaving the State, under time pressure. It said:

> 1. Finance Officer initiates reversal request in portal
>    (`POST /payments/:id/refund`).
> 2. Maker-Checker approval required: An Administrator or Director of Finance
>    must approve.
> 3. Upon approval: Transaction marked `REVERSED`. Receipt marked `VOID`.

Four things wrong in three lines.

`POST /payments/:id/refund` is not a route. The reversal flow is three steps:
raise a `PAYMENT_REVERSAL` approval, have a second officer decide it, have a
third execute it — each refusing the officer who did the step before.

"Maker-Checker" and "must approve" describe **two** signatures. There are
three, and the separation is enforced, not advisory.

There is no **Director of Finance** role. The roles are `admin`, `supervisor`,
`revenue_officer`, `finance_officer`, `auditor`, and who may do each step is
decided by permission rather than title.

The receipt is marked **`REVERSED`**, not `VOID`. Both are statuses a receipt
can hold and they are not interchangeable: `VOID` is a receipt cancelled on its
own, `REVERSED` is one whose money went back. An auditor searching for voided
receipts after a chargeback would find none.

Two smaller ones in the same file. It sends officers to
`http://localhost:5174`, a development server no PSIRS workstation can reach.
And it states a flat "72-hour holding period" for agent commission, which is
`commission_policies.hold_period_hours` — per policy, defaulting to 72, and an
administrator can change it. An officer quoting 72 hours to an agent under a
policy set otherwise is quoting the default, not the rule.

Three of its claims were checked and are **correct**, and were left alone: the
reconciliation sweep does run every six hours, a manual run does exist
(`POST /government/reconciliation/run`), and the three-way principle it draws
is the one the platform implements.

The second real one is small: `OFFICER-READINESS-GAP-ASSESSMENT.md` marked
officer suspension **Complete** against `PATCH /government/users/:id/status`.
The route is a `POST`.

### What was deliberately not done

The SOP was corrected where the code settles the answer and **not** rewritten
where it does not. It quotes portal button labels — "Click **Start
Reconciliation Run**" — and those were left, with the note that the underlying
action is real, because the portal is bilingual: an officer working in Hausa
sees different text, so quoting English labels in a procedure is fragile
whoever writes it. Replacing them with labels invented from a reading of the
code would have been worse than leaving a known-imperfect reference to a
control that does exist.

## Four money paths read end to end, and all four hold

After the documentation findings, four paths were read against the code rather
than scanned. None of them yielded anything, and the pattern in that is the
point of recording it.

**A reversed receipt, verified publicly.** `verifyPublicly` checks
`receipts.status` before anything else and answers REVERSED with a reason
rather than VALID, verifies the stored document's checksum, and discloses
receipt number, revenue type, amount, date and LGA — never the taxpayer's name.
The reversal writes the receipt and the transaction inside one transaction, so
the two cannot drift. The obvious hole was already found and closed by somebody
else: the code's own comment records that `documents.status` had never been
written by any path, so a reversed receipt looked up *by document number* went
on reporting "a genuine government document" — "§95 in reverse: a reversed
transaction must not still be able to appear successful".

**The reference data the platform ships with.** All seventeen Plateau LGAs are
present, correctly named, correctly placed in the three senatorial zones — six
North, five Central, six South — with accurate headquarters, including the ones
that are easy to get wrong: Jos East at Angware, Jos South at Bukuru, Kanam at
Dengi, Kanke at Kwal, Langtang South at Mabudi, Mikang at Tunkus, Qua'an Pan at
Baap.

**A sync retried on a flaky connection**, which is the normal case in the field
rather than an edge one. `/drafts/sync` carries no idempotency middleware and
does not need it: each draft carries a `clientReference`, the table is unique on
`(agent_id, client_reference)`, and the handler looks the draft up before
storing and answers DUPLICATE — or REJECTED, with the stored reason — instead
of inserting again. Each draft is handled inside its own try/catch, so one
corrupt capture cannot hold an agent's whole queue shut, and the permission is
re-checked per draft against `rbacStore` rather than the compiled map. The
select-then-insert is not atomic, but the unique constraint holds the invariant
and a genuine race costs one spurious per-draft refusal that the next sync
clears.

**Commission on a collection that is later charged back.** The commission is
reversed, and where it had already been *paid* the amount is recorded as a
clawback. That figure is not merely reported: the next payout nets it off, marks
those rows `recovered_at` so it cannot be deducted twice — with a partial index
making that structural rather than hopeful — and refuses outright, naming both
figures in naira, when the clawback exceeds what is eligible. Two other paths
set `recovered_at` back to NULL, so a payout that fails puts the debt back on
the books instead of forgiving it. The code's comment records that it used to
be otherwise: "the wallet showed it, the reversal reported a clawback figure,
and the next payout handed over the full amount anyway".

### What the clean sweeps are saying

Counting this stretch, a dozen sweeps have now come back clean — every SUM that
can be taken over nothing, every division, every ratio, the webhook's status
codes, every client call resolving to a route, interaction coverage across both
React workspaces, tests that assert nothing, and the four above.

Against that, the defects found in the same period fall into two piles and only
two. Three were on a single officer screen that no test had ever *clicked*. The
rest were in prose — an API reference, a finance SOP, a readiness assessment.

### How wide the untested-button seam actually is: one screen

The sentence that first stood here said the risk was "in buttons no test
presses", and generalised from RoleHome to a seam worth working through screen
by screen. That was measured afterwards and is **wrong**, so it is corrected
rather than quietly dropped.

Of every screen in the officer portal that makes a write call, **RoleHome was
the only one whose importing tests fired no events at all.** Every other screen
is clicked. `Periods` looked like the worst case on a first count — four write
sites, none of them asserted — and its test presses the close button and
asserts the sentence that appears afterwards; a throw of the kind that killed
RoleHome's six buttons would fail it. The same holds for `UserAccess`,
`Roles` and `Allocations`.

The metric that produced the alarming list counted whether a test **asserts the
request path**, and that is not the same question as whether a button is
pressed. Conflating the two overstated the exposure across a dozen screens on
the strength of one real instance.

What the unasserted paths do leave open is narrower: a test that clicks and
then checks a message catches a throw, but not a request sent to the wrong path
or with the wrong body. That class was swept across both workspaces — 115
inline-object write calls against 113 route schemas — and yielded exactly one
instance, already fixed.

So the honest statement is the narrow one. RoleHome was a singleton, and three
defects accumulated there precisely because it was. The seam is not open
elsewhere; it was open in one place, and that place is now closed.

A separate sweep looked for the *mechanism* rather than the consequence: 198
complete-statement hook calls across 81 client files, checked for the
misindentation that made RoleHome's visible. None. That is weak evidence rather
than proof — a hook moved into a callback with correct indentation would not
show up — but it is the only mechanical check available without a parser, and
it agrees with the click evidence.

The remaining concentration is the other pile, and that one stands: sentences
no check reads.

## A figure in the acceptance walkthrough that this branch made wrong

`docs/UAT-WALKTHROUGH.md` is what somebody follows to accept this platform. Its
second step says the harness "applies all N migrations and seeds the reference
data: 17 LGAs, 187 wards, 9 revenue categories, 42 revenue items, 12 training
modules, 73 notification templates". Seven figures, every one a count of what a
fresh install produces, and nothing held any of them to it.

They were checked against a database created for the purpose — dropped,
created, migrated from nothing and seeded. **Six were right.** LGAs, wards,
categories, items, training modules and templates all match exactly.

The migration count did not. It said 78; the repository ships 80 — and the two
that made the difference, 079 and 080, were added **by this branch**, for the
notification work earlier today. The document was accurate until this session
made it wrong and did not look back at it. It is the second time that figure
has drifted.

### A guard scoped to what can honestly be checked

The first version of the check read all seven figures out of the prose and
counted the matching tables. It failed, and it was right to: asked of a suite
database it answered **87 migrations and 74 notification templates**. Neither
is a fact about the platform. Both are facts about a database that has been
used — the suite's databases live across runs, `resetDatabase` truncates the
transactional tables and leaves reference data behind, and `schema_migrations`
keeps every row it has ever had.

A guard reporting those would fail for reasons that are not defects, and a
guard that cries wolf is deleted by the third person it interrupts. So the six
seeded counts are verified by hand, once, against a database built for it, and
recorded here as verified. The one that actually drifts is held mechanically
against the migration files, which needs no database and cannot fail for a
reason that is not real.

It also found a fault in itself on the way: the walkthrough's sentence wraps,
so the source reads `73 notification\n   templates`, and a literal space
between the two words matched nothing. A guard discovering that about itself
before a person discovers it about the guard is the whole argument for running
one before trusting it.

## A gap assessment that understated what had been delivered

`OFFICER-READINESS-GAP-ASSESSMENT.md` closes with a section headed "What this
assessment says to do next" — nine items, ordered by what an officer loses
without each. Four were struck through as done. Five were left standing as
outstanding work.

**Four of those five were built.** Checked against the routes, one at a time:

- *Configurable roles and permissions* — "changing who may approve a refund is
  a code change and a deployment". It is not: `rbac-store.ts` reads
  `role_permissions` at the enforcement point, and
  `POST /government/roles/:name/grant` and `/revoke` move a permission between
  roles while `/roles` creates, retires and restores them.
- *Audit sampling and audit reports as objects* — `POST /government/audit/samples`
  draws a sample, `/audit/samples/:id/complete` refuses while an item is still
  unexamined, `/audit/samples/items/:id/finding` records a finding, and a report
  is signed, withdrawn and exported as an object.
- *PDF and Excel export* — `export.ts` offers `'csv' | 'xlsx' | 'pdf'` and
  implements all three, `pdfkit` for the PDF and `toXlsx` for the workbook.
- *Officer sessions and evidence upload* — `GET /government/users/:id/sessions`
  answers with the sessions and their devices, and
  `POST /government/cases/:id/evidence/upload` takes a document that did not
  come from this platform, checking the declared type against the bytes.

The fifth is two-thirds built: the inbox and system alerts both exist. **Saved
filters are the one thing on that list still genuinely outstanding**, and
nothing in either workspace saves one.

The document also disagreed with itself twice over. Its own Roles row says an
administrator creates and retires roles from `/roles`; its own System alerts row
says alerts are complete. Both sit a few hundred lines above the list calling
them outstanding. And the list's own preamble said "the first three are done"
above four struck-through items.

### Why this direction of error is worth as much attention as the other

Every other documentation finding in this branch was an overstatement — a route
that did not exist, a permission that did not exist, a procedure naming the
wrong endpoint. This one runs the other way, and costs more rather than less.
A gap assessment is what a government reads to decide what still needs scoping,
funding and procuring. Told that configurable permissions, audit sampling, PDF
export and evidence upload remain to be built, PSIRS would plan and pay for four
things it already owns.

Overstatement is caught by the first person who tries to use the thing.
Understatement is never caught at all: nobody goes looking for a capability
they have been told is absent.

## A fourth thing, read but not run: four security headers on three locations

Recorded separately from everything above because it is the one finding in
this document that was not measured. No nginx is available in the environment
these notes were written in, so this is a reading of the configuration against
the documented behaviour of the directive, and it should be confirmed with
`curl -I` against a running stack before anybody acts on it.

`Dockerfile.agent` and `Dockerfile.portal` each embed an nginx server that
sets four headers at server level:

```
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "geolocation=(self), camera=(self), microphone=()" always;
```

and then three `location` blocks that set `Cache-Control` with `add_header` of
their own: `= /sw.js`, the `\.(manifest|webmanifest|svg|png|ico)$` regex, and
`/assets/`. nginx's headers module inherits `add_header` from the enclosing
level *only when the current level defines none of its own*, and `always`
governs whether a header is added to error responses rather than whether it is
inherited. On that reading those three locations serve their responses without
any of the four.

What that costs is smaller than it first looks, which is why it is recorded
rather than changed. `location /` defines no `add_header`, so it inherits all
four, and `location /` is what serves `index.html` — the document, and the only
thing framing a page can attack. The clickjacking case is covered. What is lost
is `nosniff` on `/assets/*.js`, `/sw.js` and the icons, which is defence in
depth behind a `script-src 'self'` CSP and correct MIME types from nginx's own
`mime.types`.

Two things a revision should do with this. Confirm it, with a running
container. Then, if confirmed, repeat the four lines in each of the three
blocks — the remedy is mechanical, and the reason it is worth doing is not the
exposure but that the file states a site-wide policy it does not have.

## The first line of the recovery runbook, and a cadence nobody keeps

Two defects in `docs/DISASTER-RECOVERY-PLAN.md`, found while re-reading the
procedure that is followed when the platform is down. Neither touches the
question of which of the two disaster-recovery procedures is authoritative,
recorded above and still PSIRS's to settle — both are ways in which this
document was wrong on its own terms.

### `cd /Users/mac/Agent-App`

That was the first line of Scenario A, the standalone restoration. It is a
directory on one person's laptop, and it is load-bearing: the restore two lines
below it is invoked by the relative path `deploy/backup/restore.sh`, which
resolves only from the repository checkout.

Run verbatim from a shell that is not on that laptop, the three commands in
order gave — and these are set out in prose rather than in a block because the
guard described below refuses a personal path inside a fenced one, including
this one:

1. `cd /Users/mac/Agent-App` → `bash: cd: /Users/mac/Agent-App: No such file or
   directory`, exit 1.
2. `sha256sum -c /var/backups/psirs/psirs_backup_20260913_201919Z.sha256` →
   `…psirs_backup_20260913_201919Z.dump: OK`, exit 0.
3. `bash deploy/backup/restore.sh …dump psirs` → `bash:
   deploy/backup/restore.sh: No such file or directory`, **exit 127**.

The checksum step survives because `backup.sh` records an absolute path in the
`.sha256` file, so it is the one line that does not care where the shell is.
That is what makes this worse rather than better: the operator's first command
fails, the second succeeds, and the reassurance arrives between the two errors.

The restore script is not the problem. Given the same archive from the
checkout it exits 0 and reports all eight financial tables — 23 transactions,
20 payments, 13 receipts, 14 commissions, 198 audit rows, 17 taxpayers, 2
agents, 23 invoices. The entire distance between an operator and a recovered
database was a directory name that belonged to somebody else's machine.

Step 0 now reads `cd "${PSIRS_REPO:?…}"`, which refuses to be empty and says
what to set. The failure stays at step 0, where it is a typo, instead of
arriving at step 2, where it is an outage.

### A daily snapshot at 02:00 UTC, run by nothing

§2.1 stated four things as established practice. Measured against the
repository:

| §2.1 said | Actually |
| --- | --- |
| Base snapshot daily at `02:00 UTC` via `deploy/backup/backup.sh` | **Nothing schedules it.** No crontab, no `.timer`, no `OnCalendar`, no scheduled workflow. The only `cron:` entries are Dependabot and the nightly integration check, and neither takes a backup |
| Continuous WAL archiving to isolated storage | **Nothing.** No `archive_command` is configured anywhere in the repository |
| A companion `.sha256` per backup | True, and `restore.sh` checks it |
| 30 days primary, 365 days immutable Glacier | 30 days is real — `RETENTION_DAYS` prunes it. The Glacier vault is a bucket lifecycle policy that does not exist |

The sibling document has always been straight about exactly these gaps:
"`backup.sh` is not yet on a timer anywhere… Until those three are done the RPO
is 'whenever someone last ran the script', which is not a number anyone should
accept." One document said the schedule was in place and the other said it was
not, and the one that said it was is the one carrying a document ID and a
target SLA in its header — the one that reads like a signed deliverable.

A fifth thing was wrong on its own terms rather than against the repository:
§2.1 gave the WAL archive timeout as fifteen minutes, which is the RPO itself.
A timeout equal to the budget spends all of it before the segment has started
moving. `DISASTER-RECOVERY.md` configures `archive_timeout = 300` and says why;
§2.1 now says the same.

§2.1 is now a table of what the repository does against what the deployment
must still supply, and it ends by saying plainly that until the timer and the
`archive_command` exist the RPO is not fifteen minutes. The 15-minute figure
stays where it belongs: as the target in the header and the requirement §1
reads out of PRD §88, neither of which describes the deployment today.

### What now holds it

`what-the-recovery-runbook-tells-an-operator-to-type.test.ts`, three cases. No
Markdown file in the repository may put a path inside a personal home directory
into a fenced code block — the sweep is over every `.md`, because pasting a
command out of a working shell is not a disaster-recovery habit. No runbook may
cite a `.sh` that is not in the repository. And the schedule claim is bound to
the repository in both directions: the test fails if anything starts scheduling
a backup *and* fails if §2.1 stops saying that nothing does. Whichever way the
two drift apart, the failure names the paragraph to fix.

Mutation-checked, one failing case each: the laptop path restored to the code
block, the sentence about nothing scheduling it replaced with a claim that
something does, a cited script renamed by one letter, and a scheduled workflow
added that runs `backup.sh`.

What the guard cannot do is check that the commands, run in order, recover
anything. That is what the restoration test in `DISASTER-RECOVERY.md` and
`deploy/backup/verify-backup.sh` are for, and saying so here is the point — a
guard that implied otherwise would be the same defect one level up.

## The step-up table an integrator reads, listing seven of twelve

`docs/API.md` carries "Step-up actions, and the routes that enforce them" — the
section a government's integrator reads to learn which calls need a fresh
one-time code as well as a permission. It listed seven rows and said "All seven
are now enforced by a route".

`STEP_UP_ACTIONS` holds twelve. Five had no row at all:

| Action | Route nothing documented |
| --- | --- |
| `financial.period.close` | `POST /government/periods/:id/close` |
| `financial.period.reopen` | `POST /government/periods/:id/reopen` |
| `audit.report.sign` | `POST /government/audit/reports/:id/sign` · `/withdraw` |
| `device.block` | `POST /government/devices/:id/block` |
| `device.unblock` | `POST /government/devices/:id/unblock` |

The last two arrived on this branch and are mine. The other three did not; they
have been enforced and undocumented for as long as they have existed.

The `user.role.change` row was wrong the other way round. It named one route.
Eight demand that code: `POST /government/users/:id/role`, the same for
`/status`, and the whole custom-role surface — `POST /government/roles` with
`grant`, `revoke`, `retire`, `restore` and `export-limit` under `/roles/:name`.
All eight are `user:manage`. Someone building a role-administration screen from
the reference would have learned about the step-up from a `403
STEP_UP_REQUIRED` in production, on the screen where an administrator is
already halfway through disabling an account.

The table now carries all twelve actions and every route that enforces each,
with the two splits explained where they are easy to read as duplication:
closing and reopening a month are separate actions, and so are blocking and
unblocking a handset, because a code is consumed on use and authorises exactly
one action — a shared name would let a code minted to take a stolen machine out
of service be spent handing it back.

### What now holds it

A fifth case in `a-code-that-names-the-wrong-door.test.ts`, which already holds
this constant against the routes and against the officer portal. The reference
table is now bound to both: its row set must equal `STEP_UP_ACTIONS` exactly,
every `requireStepUp` site's declared path must appear in its action's route
cell, and the sentence above the table must spell the current count. Whichever
of the three drifts, the failure names it.

Mutation-checked. One failing case each for a dropped row, a route removed from
the `user.role.change` cell, the count changed to eleven, and an invented row.

A fifth mutation — adding an action to `STEP_UP_ACTIONS` — reported **no
failures**, which was a miss worth recording rather than quietly fixing. The
tests import the constant from `@psirs/shared`, meaning the *built* package:
editing `packages/shared/src/rbac.ts` alone changes nothing a test can see.
Rebuilt with `tsc -b packages/shared`, the same mutation failed the two cases
predicted — "is consumed somewhere, for every action the list offers" and the
new one. The guard binds; what did not was my hand. Anyone running a single
test file after editing `packages/shared` is running it against the previous
build, and `verify` hides this because `typecheck` builds before `test` runs.

## A step-up action name that was a `string` on both clients

No live defect. This closes the class that produced one.

The two applications send an action name to `POST /auth/step-up`, which
validates it with `z.enum(STEP_UP_ACTIONS)` and answers 422. The refusal
arrives *after* `/auth/otp/request` has already sent the person a text, so a
name that is merely wrong costs an officer or an agent an SMS, the wait, and
the code — and reads as the platform refusing them. That is not hypothetical:
the officer home screen asked for `commission.payout.approve` and did exactly
this every time, which is why
`a-code-that-names-the-wrong-door.test.ts` has a case scanning the portal.

That scan covers one application and one spelling. Three seams carry the name,
and all three took a plain `string`:

| Seam | Reached by |
| --- | --- |
| `stepUp(action, phone)` in `apps/portal/src/lib/api.ts` | the officer portal's 14 call sites across nine screens — scanned by the existing case |
| `grantStepUp(action, code)` in `apps/agent/src/lib/step-up.ts` | the agent application |
| the `action` prop of `<StepUpPrompt>` in `apps/agent/src/components/StepUp.tsx` | the agent's two uses — `commission.payout.request` and `agent.bank_account.change`, scanned by nothing |

The agent half is the half nothing watched, and one of its two actions is the
one an agent uses to ask for their own money.

`StepUpAction` — `(typeof STEP_UP_ACTIONS)[number]` — has been exported from
`@psirs/shared` all along, and both applications already depend on the package.
All three seams now take it, so a name off the list stops compiling rather than
reaching an SMS gateway. Verified by typing a plausible typo into two real call
sites: `action="commission.payout.requests"` on the agent's payout prompt and
`stepUp('financial.period.closed', …)` on the officer's month-close, each one
compile error naming the twelve permitted values.

The type found exactly one thing already in the tree, and it was harmless: a
portal test passed `'x'` as the action while asserting something else entirely
— that an abandoned step-up renders in Hausa. It now passes
`'audit.report.sign'`, which is what it was always testing around.

Both scans stay. The type binds the literal written at a call site; the scan is
the floor under it, and it has a floor of its own — at least fifteen action
literals must be found across those 14 calls, the fifteenth being the second
arm of `MyAccess`'s block/unblock ternary, so the rule cannot quietly match
nothing.

## Evidence for an auditor in month four, deleted in month three

Found while checking two Dependabot major bumps, and not caused by either.

`integration-verification.yml` uploads `verification.log` as the evidence that
closes blocker **B-4**, and asked to keep it for 180 days. The comment above
the number said why: evidence that vanishes in ninety days "is not much use to
an auditor asking in month four". `docs/INTEGRATION-VERIFICATION.md` repeated
the same figure.

It was never 180. **This repository is public**, and GitHub caps artifact
retention at ninety days for a public repository — `actions/upload-artifact`
documents the input in its own `action.yml` as "Max: 90 days". The request is
reduced on arrival, so two files said four months and the artifact expired in
three.

That is worse than having asked for ninety. A figure nobody can act on reads as
a problem already solved, and the one person it misleads is the auditor the
sentence was written for.

Both files now say ninety and say why, and both name what would actually
deliver month four: copying the log to object storage with its own lifecycle
policy — the same place the disaster-recovery archives are meant to go, and
equally not yet in existence. That is a deployment decision, recorded as one
rather than implied by a number in a workflow.

### What now holds it

`how-long-the-evidence-lasts.test.ts`, two cases. No workflow may ask for more
retention than a public repository can give, and the document's figure must
equal the workflow's — the second is the binding that was missing, since the
two files agreed with each other while neither agreed with GitHub.

Mutation-checked: the workflow put back to 180 fails **both** cases, being over
the cap and disagreeing with the document; the document alone changed to 180
fails one; a new workflow asking for 120 days fails one.

What the guard cannot do is ask GitHub what the cap is. The ninety is written
into the test from the action's documented maximum, so a repository made
private — where the ceiling rises to 400 — makes this test the thing to change
deliberately, rather than a number drifting again.

## A person turned away by binary floating point

`GET /allocations/rounds/:id` tells an officer standing at a distribution point
how much of the round is left and how many more people it can serve. It
computed both like this:

    const remaining = Number(total_quantity) - Number(awarded_quantity);
    beneficiariesRemaining: Math.floor(remaining / Number(quantity_per_beneficiary))

All three columns are `NUMERIC(14,2)`. Two exact decimals stop being exact the
moment they become doubles: `1.00 - 0.90` is `0.09999999999999998`, and
`Math.floor(0.09999999999999998 / 0.1)` is **0**. The round holds enough for one
more person and the screen says nobody.

Measured across every two-decimal combination a round plausibly holds — nine
per-beneficiary sizes against totals from 1 to 200, each with up to forty awards
against it — the float arithmetic disagreed with the same sums done in integers
**12,231 times**. Every single disagreement was in the same direction:

| | |
| --- | --- |
| float version reports fewer beneficiaries than the goods can serve | 12,231 |
| float version reports more | **0** |

It never over-promises. It only turns people away, and that is the direction
nobody reports: somebody sent home from a queue sees a queue that ended, not a
defect. The same shape as the compliance score that rounded a citizen's debt
down — arithmetic that fails quietly towards the citizen's loss.

The summary is now counted in whole hundredths, which is what the column
actually stores.

### The class, swept — and it has exactly one home

A defect like this is only worth fixing once if the same arithmetic is not
happening elsewhere, so the schema was swept rather than the instance patched
and forgotten.

| | |
| --- | --- |
| Money columns stored as `BIGINT` (integer kobo) | **50** |
| Money columns in any fractional type (`NUMERIC`, `DECIMAL`, `REAL`, `FLOAT`) | **0** |
| Fractional columns in the entire schema | **7** |

Of those seven: three are the allocation quantities fixed above
(`total_quantity`, `quantity_per_beneficiary`, `quantity`); two are `latitude`
and `longitude`, where a float is the correct type and no one is counted by
dividing them; and two — `round_total` and `already` — are not columns at all
but local variables inside the `enforce_round_quantity` trigger, where the
arithmetic is Postgres `NUMERIC` and therefore exact by construction.

So every naira this platform handles is an integer number of kobo. Receipts,
commissions, settlements, reconciliation and every published total are immune
to what bit the allocation summary, because none of them ever becomes a
double. The goods quantities were the single exception, and they were the one
place a person was counted by dividing one fractional value by another.

Worth recording because the finding reads more alarming than it is. This was
not a systemic arithmetic fault; it was one endpoint, and the design decision
that contained it — money as integer minor units — was made correctly
everywhere else and is the reason the blast radius was a distribution queue
rather than the revenue ledger.

### Why the existing test could not see it

`groups-and-allocations.test.ts` already covered this endpoint, and asserted
`remainingQuantity: '96.00'` and `beneficiariesRemaining: 48` — a round of 100
at 2.00 each. Every intermediate value there is exactly representable as a
double, so that assertion holds whether the arithmetic is done in floats or
integers. Most real rounds look like that, which is why this survived.

The new case uses 0.30 total at 0.10 each with one award taken: exact in
`NUMERIC(14,2)`, exact in neither as a double. It needs a single award to
expose the fault, and it goes through the HTTP route rather than the formula.

Mutation-checked: with the float arithmetic restored, the new case fails and
**the old one still passes** — which is the point worth keeping. The coverage
was real, the endpoint was exercised, and the values chosen were the ones that
could never fail.

## Two different audit records could share one fingerprint

The audit chain is the platform's tamper-evidence control, and the traceability
material tells a government that editing a recorded row is detectable by replay
"even by someone with database access". That claim rested on every covered
field having exactly one digest. For two of them it did not.

Until hash version 3, every field went through one encoder that coerced
anything matching `/^-?\d*\.?\d+$/` to a JavaScript number. It was written for
`latitude` and `longitude` — the only two `NUMERIC` columns, which postgres
returns as the string `"9.896500"` for a value written as `9.8965` — but it was
applied to the five `TEXT` columns as well. Those come back byte-for-byte as
they went in, so they never needed normalising, and normalising them threw away
real differences. Observed, by digest comparison rather than by reading:

| recorded | rewritten as | same digest |
|---|---|---|
| `request_id` `"0007"` | `"7"` | yes |
| `request_id` `"12.00"` | `"0012"` | yes |
| `request_id` `"9007199254740993"` | `"9007199254740992"` | yes |
| `reason` `"1500"` | `"1500.00"` | yes |
| `reason` `"0042"` | `"42"` | yes |
| `request_id` `"a7"` | `"a007"` | no (control) |
| `ip_address` `"10.0.0.1"` | `"10.0.0.2"` | no (control) |

`request_id` is the sharp end. `middleware/context.ts` takes it from the
caller's `X-Request-Id` header, so the value that later needs to collide is
chosen by whoever made the request. Somebody with database access could then
rewrite that field, or a numeric `reason`, and `verifyAuditChain` would report
the log intact.

### The sibling defect, which is latent rather than live

The same encoder did not finish the job it was written for. `recordAudit`
hashed the number it was handed while the column stored that number rounded to
`NUMERIC(9,6)`, so an entry carrying a coordinate at a handset's precision
would fail its own verification the first time anybody checked it.

This is stated as latent deliberately. There are 138 `recordAudit` call sites
and not one passes a coordinate, so no row on disk carries one. It becomes live
the moment somebody wires up the `geoSchema` that already exists in
`middleware/validate.ts`, which is why it is fixed now rather than noted.

### What changed

Hash version 3. Text is hashed as exactly the characters stored. Coordinates
are quantised to the column's scale once, in `recordAudit`, before both the
digest and the `INSERT`, so the stored value and the hashed value agree by
construction rather than by both sides happening to round the same way.

Versions 1 and 2 are untouched and `verifyAuditChain` still dispatches on the
row's own `hash_version`, so every entry already written still verifies. That
is pinned by frozen-vector tests carrying two digests captured from the code as
it stood before version 3 existed: if those move, every historical row stops
verifying and the chain would report tampering across the whole log.

The two versions diverge only where version 2 lost a difference. A prose
`reason` hashes identically under both; a `reason` of `"0007"` does not.

### Why the existing tests could not see it

`audit-chain-covers-the-row.test.ts` already tampers with `request_id`, and
asserts the chain catches it. It rewrites `"req-original-0001"` to
`"req-rewritten-9999"` — two values that sit outside the broken class. The
assertion held while the property did not.

### What the mutation check found, including where it was wrong

Restoring the coercion for text fields fails 6 of the 13 new cases, as
predicted. Removing the coordinate quantisation failed **none**, which was not
predicted as a problem but was one: it meant the quantisation was uncovered.

The reason it looked redundant is that the test coordinate's seventh decimal
was 4, not a tie. node-postgres sends a number as its decimal text, so postgres
parses `"9.0010005"` as an exact decimal, sees a tie and rounds half away from
zero to `9.001001`, while JavaScript reaches for the nearest double first and
`toFixed(6)` gives `9.001000`. Measured against this database: **of 400
coordinates whose seventh decimal is 5, 198 round differently in postgres than
in JavaScript.** A tie case is now covered, and removing the quantisation fails
exactly that one.

## A queue that outlived the agent who filled it

Agents share handsets. The application is built on that premise — it has device
registration, clearance, and a session that refuses a blocked device precisely
because a phone passes between people — and signing out already gives the push
subscription back for the same reason.

The offline draft queue was the other half of that handover and was not given
back. Drafts live in IndexedDB, which outlives a session. `logout()` clears the
session and releases the push endpoint and never touches the store; nothing
anywhere in the application clears it, the only deletion being the removal of a
draft that has synced. And a draft carried no record of who captured it.

So the next agent to sign in on that phone held the last one's queue. Observed,
by running it rather than by reading it:

```
A queued:              1
B sees after handover: 1
payload B can sync:    {"businessName":"A's observation","lgaId":"lga-1"}
```

### Where that ends up

Sync attributes a draft to the session that sends it. `POST /taxpayers/drafts/sync`
takes `req.agent?.agentId ?? req.auth!.agentId` and hands that to
`recordObservation`; there was nothing in the draft to say otherwise. The route
asks `requireActiveAgent()` without options, and `requireDevice` defaults off,
so the handset is not checked either.

A BUSINESS_OBSERVATION becomes the office's record of what a stall looks like
and the basis of a presumptive assessment. The State therefore held that agent B
observed premises B never visited — the provenance an objection turns on, and
the same provenance the offline-dating fix was about. The next agent also read
the trader's details as captured by the last one.

**No money can ride this.** The queue refuses financial payloads outright
(`FINANCIAL_KEYS`, Addendum §23) and has no payment draft type, so what leaked
is provenance and personal data, not a payment. An early reading of this as a
money path was wrong and is recorded as wrong here.

### What changed, and what was deliberately not done

A draft is stamped with the id of whoever captured it, and `listDrafts` returns
only the current user's. That one function feeds all three readers — the pending
badge, the drafts screen and the sync — so a fourth reader added later is scoped
without having to know about it.

Clearing the queue on sign-out would have been simpler and would have been
wrong. It destroys work an agent captured and has not yet been able to send, and
"never lose a capture" is the older promise and the stronger one. Another
agent's drafts are hidden, not deleted: they are waiting for that agent to sign
in again, which the tests pin.

Drafts written before this field existed carry no owner and are shown to
whoever is signed in, rather than being stranded — a queue nobody can see is a
lost capture. New drafts are always stamped, so that untagged set only shrinks.

### The same shape as the push subscription

This is the defect that was fixed for `push_subscriptions` when sign-out was
made to release the endpoint. That fix covered one of the two things a handset
keeps across a handover. The draft store was the other, and a fix to one
persistence layer did not reach the second.

## A receipt numbered under the year that had just ended

Nigeria keeps West Africa Time all year: UTC+1, no daylight saving. Every
container in this repository runs UTC. So between midnight and 01:00 on any
Plateau day, the platform's clock and the State's clock name different days —
and for that hour on 1 January, different years.

Thirteen government reference numbers took their year from
`new Date().getUTCFullYear()`. Observed with the clock frozen at 00:30 on 1
January 2027, Plateau time, against the real database:

```
receipt number minted:   PSIRS/2026/002548
date printed beside it:  1 January 2027
```

One receipt, two financial years. The number is not decoration: it is what the
receipt is filed under, what a taxpayer quotes in an objection, and what is read
back down a telephone to a support officer.

`getUTC*` ignores `TZ`, so deploying the containers as `Africa/Lagos` would not
have corrected a single one of these sites. The zone has to be named. That is
the conclusion `reminders.ts` had already reached for the date a taxpayer is
*told* — "the date they are given has to be theirs" — and `calendar-day.ts` had
already reached for the last day a certificate names. Neither reached the date
the State *writes down*.

### What carried it

`lib/references.ts` mints receipts, invoices, assessments, transactions,
payments, refunds, settlements, payouts, documents, cases, groups, tickets,
applications and referee codes — every one with the same `currentYear()`. Four
other sites asked the same question in the same way:

| site | what it stamps | consequence in that hour |
|---|---|---|
| `lib/references.ts` | 13 reference-number families | the year on a government number |
| `services/audit-workbench.ts` | `PSIRS-AR/…`, `PSIRS-SMP/…` | the year on a signed audit report |
| `services/enumeration.ts` | an assessment's `periodLabel` | the tax year a trader is assessed for |
| `services/targets.ts` | the default target window, and `resolvePeriod` | the period an officer is shown, or sets |
| `routes/citizen.ts` | the end of a payment-history window | a payment made at 00:15 missing from the payer's own history until 01:00 |

`services/documents.ts` stamped the same year into the stored object's path.
That one is cosmetic — the key is internal, nothing reads the year back out of
it — and was changed for consistency, not because anything was wrong for a
user.

### What was checked and found clean

Three things that looked like part of this and are not, recorded so the next
reader does not re-open them:

- **The sequences are never reset.** Nothing in the migrations or the scripts
  issues `ALTER SEQUENCE … RESTART` or `setval`, so numbers stay globally unique
  whatever year is printed on them. The defect is the label, never a collision —
  which is why it had gone unnoticed.
- **Nothing parses the year back out of a reference.** `investigation.ts` and
  `routes/taxpayers.ts` match the *shape* of a reference to decide what kind of
  thing it is; neither reads the year as data. So no query silently misses the
  first hour's records.
- **`periods.ts monthLabel` is the same shape and not the same bug.** It reads
  `getUTCFullYear()` off a period start that arrived as a validated `YYYY-MM-DD`
  and was parsed at UTC midnight — reading a date back, not asking what day it
  is now. The two are distinguished by which direction the question runs.

One latent hazard was found and left alone: `audit-workbench.ts` interpolates a
sequence name straight into SQL (`nextval('${sequence}')`). Both call sites pass
string literals, so nothing user-supplied reaches it and there is no live
defect. It is written down here rather than fixed because changing it is a
decision about that file's shape, not about this one.

### The clients ask the same question, and get it wrong differently

Seven more sites live in the two browser applications, and they fail for a
related but distinct reason: `new Date()` there is the *device's* clock, which
in Jos is already the right clock — and then `.toISOString()` throws that away
and converts to UTC. So the correction is not "name the zone" but "stop
converting".

| site | what it decides | in that hour |
|---|---|---|
| `portal/Finance.tsx` | the settlement date a form is prefilled with | a settlement recorded at 00:15 is dated the day before |
| `portal/Finance.tsx` | the end of the default collections range | this morning's collections are outside the window |
| `portal/TaxpayerRecords.tsx` | "date of birth is in the future" | ×2 — the validation and the picker's `max` |
| `portal/Configuration.tsx` | the earliest date a schedule may start | permissive by a day |
| `agent/Auth.tsx` | the applicant date-of-birth picker's `max` | permissive by a day |
| `portal/Transactions.tsx`, `portal/Oversight.tsx` | export filenames | cosmetic |

`todayIsoLocal` and `daysAgoIsoLocal` in `@psirs/shared` read the local parts
instead. Deliberately the device's clock rather than a named zone: these are
defaults a person is shown and can change, so they should match the clock on the
wall behind them, and the server never trusts them — which is the division
`targets.ts` already draws when it says a client computing "this month" from its
own clock is a client that can be wrong about it.

### The fix, and the guard

`lib/calendar-day.ts` — already the file that holds this platform's reasoning
about whose clock a date is on — gains `plateauParts`, `currentYearInPlateau`
and `todayInPlateau`. The parts come back as numbers rather than a `Date`, for
the reason that file already gives: a calendar date is not an instant, and
handing back a `Date` invites the re-interpretation the whole file exists to
warn about.

The substitution is one line repeated across fourteen files in three
applications, which is exactly the kind of fix the fifteenth file does not get.
So the change also adds a guard: nothing under the API, the shared package or
either client may ask `new Date()` what year, month or day it is, or take
`toISOString().slice(0, 10)` of it, unless the file is written down in an
`ALLOWED` map with the reason. One entry stands today —
`routes/vehicles.ts`, an upper bound on year of manufacture that is evaluated
once at module load and already carries a `+1` of slack, so the hour is absorbed
and nothing is stamped with the value.

The guard skips lines that are wholly comment. A guard that counts a pattern
quoted in its own explanation is a guard that fires on itself, and that lesson
is already on the record here: the reachability guard once counted a path
mentioned in a comment as a caller.

### Two things the guard caught in its own author

Recorded because they are the substance of why the guard exists, not incidental.

**The first pattern could not see half of what it was guarding.** It was written
`(?:getUTC)?(?:FullYear|Month|Date|Day)\(\)`, which matches
`.getUTCFullYear()` and silently misses `.getFullYear()` — the plain local
getter. The one site then sitting in `ALLOWED` used exactly that form, so the
exception was excusing something the guard was never going to find, and a sweep
run through it would have reported the tree clean while `new Date().getMonth()`
sat anywhere it liked. Caught by testing the regex against both forms before
trusting it. The pattern is now `get(?:UTC)?(…)`.

**An exception that excuses nothing reads exactly like an exception that
works.** A second `ALLOWED` entry was written for `packages/shared/src/dates.ts`
— unnecessary, because the replacement's getters run on a parameter rather than
on `new Date()`, so the pattern never matched there at all. It was caught by a
third case added after the first flaw: every written-down exception must be
load-bearing, and the test removes each in turn and requires the guard to notice.
That case exists so the first flaw cannot recur silently.

### One false positive, fixed where it belonged

The portal's English-literal guard reported `todayIsoLocal())` as untranslated
English: `form.dateOfBirth > todayIsoLocal()` puts that run between the `>` and
the block's `{`, and `looksLikeCode` recognised a *method* call
(`something.method(`) but not a bare one. The first fix was to contort the call
site into a `localeCompare`, which is the wrong move — it bends readable code
around a lint. Reverted, and the rule was added to `looksLikeCode` instead: no
sentence contains an empty pair of parentheses closed immediately after a word.
Mutation-checked like the rest.

### Verification

Eight cases in `the-first-hour-of-a-plateau-year.test.ts`, including the
end-to-end mint against the real database under a frozen clock, and — the case
that keeps the fix honest — an assertion that 31 minutes earlier the *old* year
is still the answer, so the skew has been removed rather than moved.

Mutation-checked, all six predictions correct:

| mutation | predicted | actual |
|---|---|---|
| revert `references.ts` to `getUTCFullYear()` | 2 failures | 2 |
| revert `resolvePeriod` to the UTC anchor parts | 1 failure | 1 |
| make `todayInPlateau` return the UTC day | 1 failure | 1 |
| empty the guard's `ALLOWED` | 1 failure | 1 |
| revert one client site (`Finance.tsx`) | 1 failure | 1 |
| drop the new `looksLikeCode` rule | 1 failure (portal) | 1 |

The second is 1 rather than 2 deliberately: the guard matches `new Date()` asked
directly, not a getter on a variable that already holds an instant, so it cannot
see that mutation. The behavioural case is what carries it, and the prediction
said so before the mutation was run.

API suite **2220/2220** (was 2212), agent **350/350**, portal **662/662**,
`npm run typecheck` clean.

## A search box that was read as a pattern

`GET /citizen-status?name=` is the public door. It deliberately answers a name
search with a COUNT and the sentence *"use your TIN or phone number to see your
specific record"*, and the whole surface is rate limited to ten requests a
minute per address, because the register of who pays tax in Plateau State is
not a list a stranger may page through.

The count came from `... LIKE $1`, with the pattern built as `` `%${name}%` ``.
`%` and `_` are LIKE wildcards, so the term was never a term. Observed against
the database on a register of five people:

```
a stranger searching name=Am:           1
a stranger searching name=%%:           5    <- the whole active register
a stranger searching name=_____ ____:   4    <- a length probe
```

The second is the register's size — the one number the route exists not to
give. The third is different in kind: `_` counts characters, so a caller can
ask how many people have a forename of exactly five letters and narrow from
there. That is a positional oracle a substring search cannot offer at all.
Neither needs an account, a TIN, or anything but a browser.

The minimum length is no defence. `name` requires two characters, and `%%` is
two characters.

### The escaper that did not escape its own escape character

`investigation.ts` — the officers' search — was the one site that had thought
about this, and escaped `%` and `_`:

```ts
const like = `%${term.replace(/[%_]/g, (match) => `\\${match}`)}%`;
```

The backslash is missing from that character class, and backslash is what
Postgres uses as the LIKE escape character. So a term containing one re-opened
the wildcard it was meant to close: `a\%b` became the pattern `%a\\%b%`, where
`\\` is a literal backslash and the `%` after it is live again. Confirmed
directly:

```
'xxa\ZZZbxx' LIKE '%a\\%b%'   ->  true
```

A search for the literal text `a\%b` matched `a`, a backslash, anything, `b`.
This is **not** an enumeration hole: the surface is authenticated, and the
pattern still requires a backslash in the data, so it cannot be widened to
match everything. It is simply an escaper that did not escape its own escape
character, and it is recorded here because a partial escaper is more dangerous
than none — it reads, to the next person, as a solved problem.

### The other three, and why they were not the defect

`taxpayers.ts` (the officer search), `revenue.ts` (the catalogue) and
`vehicles.ts` (registration numbers) all build a LIKE pattern from a caller's
term without escaping. None of them is a disclosure: each is authenticated and
territory-scoped, and in every one the term is an *optional narrowing* of a
list the caller may already read in full. A `%` there means "no filter", which
is what omitting the parameter already does. They were changed anyway, because
a search box should match what somebody typed — an officer looking for
`A_Z Motors` should not also get `AXZ Motors` — and because one helper means
the next search box is right without anybody remembering.

### The fix, and the guard

`lib/like.ts` holds `escapeLike` and `likeContains`. Five sites use them, in
the two shapes the codebase already had: three wrap the term in JavaScript, two
concatenate it in SQL and so escape the term before binding it.

The guard is about the file rather than the expression: a file whose SQL uses
LIKE must import the escaper. It cannot tell whether a particular pattern is
built from a caller's term or from a constant, which is why an exception is a
written-down reason and not a silent exclusion.

It found a sixth file the manual sweep had missed — `db/load-test.ts`, the load
harness. That one is a genuine exception and is recorded as one: it serves no
request, every pattern in it is built by the harness from its own fixture names
and loop counter, and the trailing wildcard is the point, because the thing
being measured is what a prefix scan costs.

### Verification

Eight cases in `a-search-box-is-not-a-pattern.test.ts`, written against the
HTTP door rather than the query, because the query is not what a stranger has.
The escaping is asked of Postgres rather than asserted about it — the escape
character is a property of LIKE, not of this function.

Mutation-checked, all four predictions correct:

| mutation | predicted | actual |
|---|---|---|
| revert the public lookup to the raw pattern | 3 failures | 3 |
| drop the backslash from `escapeLike` | 1 failure | 1 |
| revert the officer search | 1 failure | 1 |
| empty the guard's `ALLOWED` | 1 failure | 1 |

API suite **2228/2228** (was 2220), `npm run typecheck` clean.

Two process errors are recorded here because both produced results that looked
like findings and were not.

**A mutation that did not apply.** One mutation was first attempted with `sed`,
whose pattern did not match, so the file was unchanged and the suite passed — a
green run that meant nothing. It was re-applied with a script that asserts the
edit landed, and confirmed. A mutation that does not apply looks exactly like a
mutation the tests survive, which is the failure mode the whole technique exists
to avoid.

**Two suites at once.** The first full run was started with
`npm run typecheck | tail -3 && node scripts/run-tests.mjs`. The pipe makes the
exit status `tail`'s, which is always zero, so the `&&` proceeded even though
typecheck had failed. Reading the typecheck error, and not the process list, the
conclusion drawn was that the suite had never started — and a second full run
was launched while the first was still going. The harness gives each shard its
own database, but not each RUN, so eight shard processes shared four databases.
The result was forty-odd failures spread across areas the change never touches:
`deadlock detected`, foreign keys violated on `users`, subtests cancelled
mid-flight. Both runs were void. Re-run alone, the suite is green.

The lesson is the one this document keeps recording in other forms: a red result
is evidence about the whole system under test, including the harness and the
person running it, and the first question is what produced it rather than which
line of the diff to blame.

## A font chosen for the currency, carrying the names by luck

Every receipt, invoice and certificate the platform issues prints a taxpayer's
name, and a name is free text an agent typed in Plateau State. Written Hausa
uses four hooked consonants — **ɓ ɗ ƙ ƴ** and their capitals — and they are
ordinary in names here: Ɗanjuma, Ƙasimu, Ɓala. They sit in Latin Extended-B and
IPA Extensions, which plenty of otherwise respectable Latin faces omit.

The same bytes are a name to the database and a glyph lookup to the PDF.

**Nothing is broken.** Liberation Sans, which the platform bundles, carries all
eight in both the regular and the bold face. Checked by parsing the font, not
by reading the licence:

```
LiberationSans-Regular.ttf   all 8 hooked letters present
LiberationSans-Bold.ttf      all 8 hooked letters present
```

**A font that lacked them would not say so.** The same name rendered through
PDFKit with a base-14 face produces a valid PDF of 1,313 bytes rather than an
error. Nothing throws; the document is simply missing the letters.

### What was actually missing

The reason recorded beside the font choice is the naira sign, and only that:
WinAnsi has no ₦, so amounts printed as a broken character, and the fix was to
bundle a real TTF. `document-fonts.test.ts` was written to stop that
regression, and it is a good test — it parses the cmap rather than trusting the
font, checks the build carries the file, and checks a generated receipt really
embeds it.

It pinned exactly one codepoint: `const NAIRA = 0x20a6`.

So the property the documents actually depend on — that the bundled face can
spell the names of the people the State collects from — was held by nothing. A
future swap to another metrically-compatible face, justified by "it still has
₦", passes every check in that file and quietly stops being able to write half
the names in the state. That is precisely the failure the file was written for,
in its own words: a document that renders, and is wrong.

### What changed

No behaviour. The test's single codepoint became a `MUST_RENDER` list — the
naira sign plus all eight hooked letters, each with the reason it is there —
and the failure message names the character and what it is for. The receipt in
the render case is now issued to `Ɗanjuma Ƙasimu Ɓala`, so the path is
exercised with the characters in question rather than with ASCII.

Deliberately not an alphabet. ASCII needs no test: a face that cannot draw `A`
fails visibly on the first document. The characters worth pinning are the ones
whose absence is silent.

### Verification

Mutation-checked, and one prediction was wrong:

| mutation | predicted | actual |
|---|---|---|
| add a codepoint the bundled font genuinely lacks (U+4E00) | 1 failure | 1 |
| make the renderer fall back to a base-14 face | 1 failure | **0** |
| the same, applied to the font constants instead | 1 failure | 1 |

The second was an inert mutation, not a surviving test. `registerFonts` sets
the document's *initial* font, and every render helper immediately calls
`doc.font(...)` itself — so changing the initial one changes nothing that
reaches the page. Re-applied to `BODY_FONT` and `BOLD_FONT`, which every call
site uses, it failed as predicted.

That is the second inert mutation in this document's record, after the `sed`
pattern that did not match. Both looked exactly like a test surviving a
mutation, which is the one thing the technique must not be allowed to look
like. The lesson both times was the same: confirm the mutation changed what you
think it changed before reading anything into the result.

Font test 3/3, API suite **2228/2228** (unchanged — this adds no cases, it
widens what an existing one asserts), `npm run typecheck` clean.

## What this document deliberately does not do

It assigns no defect numbers, changes no matrix verdict, and does not say
whether the platform is ready for production. Appending findings to a report
whose matrix silently omits half the system would make the document look
current while leaving it less honest than its own `fa8f454` anchor makes it
today. That anchor is the reason the report can still be trusted for what it
covers, and it should stay until a revision covers the rest.
