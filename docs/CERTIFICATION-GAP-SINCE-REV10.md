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

| | At `fa8f454` (Revision 10) | Now (`f249435`) |
| --- | --- | --- |
| API service modules | 39 | 44 |
| Database migrations | 54 | 80 |
| API test files | 139 | 187 |
| Tables | 77 *(report's figure)* | 103 |
| Triggers | 233 *(report's figure)* | 156 *(see below)* |
| CHECK constraints | 194 *(report's figure)* | 301 *(see below)* |
| API tests passing | 1,523 *(report's figure)* | 2,156 |
| Officer portal tests | 140 *(report's figure)* | 656 |
| Agent PWA tests | 134 *(report's figure)* | 345 |
| Declared enum states | 537 *(report's figure)* | 752 |
| Enum states written by the suite | 462 *(report's figure)* | 671 |

Current figures are from a full local run at `f249435` plus the working tree:
API 2,156 passing across four shards with 0 failing and 0 cancelled; portal
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

## What this document deliberately does not do

It assigns no defect numbers, changes no matrix verdict, and does not say
whether the platform is ready for production. Appending findings to a report
whose matrix silently omits half the system would make the document look
current while leaving it less honest than its own `fa8f454` anchor makes it
today. That anchor is the reason the report can still be trusted for what it
covers, and it should stay until a revision covers the rest.
