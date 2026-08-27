# Running the whole platform on a laptop, and proving it works

This is the walkthrough that produced `docs/uat-screenshots/`. Anybody can run
it: it needs PostgreSQL, Node 22 and about ten minutes, and it leaves a
photograph of every screen behind so the result can be read by somebody who was
not there when it ran.

It is deliberately not a list of things to click. Two scripts do the ceremony
and one Playwright suite does the walking, because a test that needs setting up
by hand gets skipped rather than fixed.

---

## What you need

| | |
|---|---|
| PostgreSQL 16 | reachable at `localhost:5432` as `postgres`/`postgres` |
| Node | 22 or later |
| Chromium | already present at `/opt/pw-browsers/` in this environment; otherwise `npx playwright install chromium` |

```bash
npm install
```

---

## 1. Bring the stack up

```bash
scripts/uat/stack.sh up
```

That one command:

1. drops and recreates the `psirs_uat` database — **it owns that database**, so
   nothing you are working on is touched, and the demonstration accounts, which
   share one published password, cannot land anywhere real;
2. applies all 39 migrations and seeds the reference data: 17 LGAs, 187 wards,
   9 revenue categories, 42 revenue items, 12 training modules, 33 notification
   templates;
3. seeds five demonstration officers and one field agent — the agent walks the
   **real clearance pipeline** (KYC, referee, training, bank, device, government
   approval), because inserting an active agent directly is refused by the
   `agent_activation_requires_clearance` constraint and rightly so;
4. starts the API on `:4000`, the officer portal on `:5174` and the agent PWA on
   `:5173`;
5. runs `scripts/uat/seed-uat.mjs`, which creates the demonstration dataset **by
   calling the same HTTP endpoints the two applications call**.

That last point is the one that matters. A seed that writes rows directly can
produce states the platform itself cannot reach — a payment marked verified with
no gateway confirmation, an agent active without clearance — and a screenshot of
such a state is a picture of the seed, not of the software. Everything below was
created through the front door, so if any step stops working the seed fails
loudly instead of manufacturing a demonstration that could never happen in
production.

Logs are in `/tmp/psirs-uat/`. `scripts/uat/stack.sh down` stops everything.

### What the seed creates

```
  01. signed in as the field agent
  02. signed in as admin, revenue officer and finance officer
  03. the UAT handset is registered and approved
  04. reference data: 17 LGAs, 42 revenue items
  05. registered 12 taxpayers (11 received a TIN immediately)
  06. 8 collections confirmed and receipted, 4 left unconfirmed
  07. 4 vehicles captured, renewals raised and mostly paid
  08. recorded a settlement of 19,225 naira covering 8 collections
  09. reconciliation: 8 matched, 0 exception(s), 0 unchecked
  10. raised a support ticket from the field
```

Eight individuals and four businesses, assessed across a daily market levy, an
annual shop rate, a development levy and a consumption tax charged as a
percentage of a declared base. Four of the twelve payments are left unconfirmed
on purpose, so the officer screens show both an ordinary day's collection and
the queue of things nobody has confirmed yet.

---

## 2. Sign in

| Who | Phone | Password | Where |
|---|---|---|---|
| Field agent | `+2347010000001` | `FieldAgent2026` | http://localhost:5173 |
| Admin Officer | `+2348000000001` | `Password123` | http://localhost:5174 |
| Revenue Officer | `+2348000000002` | `Password123` | http://localhost:5174 |
| Finance Officer | `+2348000000003` | `Password123` | http://localhost:5174 |
| Agent Supervisor | `+2348000000004` | `Password123` | http://localhost:5174 |
| State Auditor | `+2348000000005` | `Password123` | http://localhost:5174 |

**Expect to be refused the first time you try to collect.** The agent app mints
a device identifier per browser, so a fresh browser is a handset PSIRS has never
seen, and an unapproved handset may look a taxpayer up and see what a levy costs
but may not take money. Clearing it is step 4 below and is part of the
walkthrough rather than something to work around.

---

## 3. Run the walkthrough

```bash
npx playwright test tests/browser/uat.spec.ts
```

Seventeen tests, about five minutes, 113 screenshots into `docs/uat-screenshots/`.
A console error fails the test it appears in: in a government application a
React error boundary swallowing an exception looks exactly like an empty table,
and an officer cannot tell "no fraud flags this week" from "the fraud screen
crashed".

---

## 4. What it walks, and what each part proves

### The agent, on a phone-sized screen

| Screenshot | What it shows |
|---|---|
| `agent-01-home` | The money bar: collected today, transactions, commission, taxpayers registered, and a standing warning about payments awaiting confirmation |
| `agent-02-taxpayers`, `agent-03-taxpayer-search` | Finding the people this agent onboarded, by name, phone or TIN |
| `agent-04-collect` | The collection flow |
| `agent-05-commission` | The agent's own commission record |
| `agent-06-vehicles` | Vehicle particulars |
| `agent-07-receipts` … `agent-11-profile` | Receipts, the day's collections, support, groups, profile |

### A collection, driven end to end

This is the sequence worth reading in order.

| Screenshot | What it shows |
|---|---|
| `journey-01a-priced-before-approval` | An unapproved handset may still look a taxpayer up and be told what a levy costs — neither takes anything from anybody |
| `journey-01b-refused-unregistered-device` | …and is refused the moment money would be committed: *"This device is not registered to your agent account."* |
| `journey-02-device-registered-pending` | The agent registers the handset from the app |
| `journey-03` … `journey-05` | An officer finds the agent in the portal and approves the handset |
| `journey-06-find-taxpayer` | Searching for the taxpayer by name |
| `journey-07-priced-by-government` | ₦3,000, from the catalogue, with the calculation shown — *the agent never types an amount* |
| `journey-08-payment-initiated` | **"Payment not yet confirmed. This payment has NOT been marked as received. Do not ask the taxpayer to pay again."** Invoice and transaction references are issued; no receipt exists |
| `journey-09-receipted` | After the gateway confirms: INITIATED → ASSESSMENT CREATED → INVOICE GENERATED → PAYMENT INITIATED → PAYMENT PENDING → PAYMENT SUCCESSFUL → PAYMENT VERIFIED (*verified independently via webhook*) → RECEIPT GENERATED |

`journey-08` and `journey-09` together are PRD §95 on screen: nothing is called
collected until something outside the platform has confirmed it.

| Screenshot | What it shows |
|---|---|
| `journey-13`, `journey-14`, `journey-15` | Finding a vehicle by registration number and putting a renewal through — priced by formula from the vehicle's class, not by a number anybody typed |
| `journey-10` … `journey-12` | Registering a taxpayer through the wizard, including the consent and declaration boxes, neither of which is ticked in advance |

### The officer portal, role by role

The suite reads the sidebar and opens **everything that role is offered**, rather
than a hardcoded list. That means it tracks the permission model — a role that
gains or loses a screen is covered without anyone remembering to edit the test —
and it proves the menu never offers a screen the API refuses.

| Role | Screens | Prefix |
|---|---|---|
| Admin Officer | 18 | `portal-admin-*` |
| Revenue Officer | 19 | `portal-revenue-*` |
| Finance Officer | 16 | `portal-finance-*` |
| State Auditor | 17 | `portal-auditor-*` |
| Agent Supervisor | 11 | `portal-supervisor-*` |

Eighty-one screens, no console errors, nothing refused.

Worth opening specifically:

* `portal-finance-01-home` — owed to the councils, commission liability,
  settlement variance, exceptions
* `portal-finance-03-reconciliation` — three-way reconciliation, the exception
  queue and the settlement recorded against it
* `portal-auditor-03-audit-log` — the hash-chained trail and its verification
* `portal-admin-04-agents-clearance` — the six clearance axes per agent
* `portal-admin-10-field-application` — the version gate and the fleet it governs

### Without an account

`public-01-verify-unknown` and `public-02-citizen`: a citizen checking a receipt
or their own status, with no sign-in.

---

## 5. What this run found

Two things, both fixed in the same change as this document.

**The reconciliation exception queue listed the same job several times.**
`TXN-2026-000027` appeared twice, then `000029` twice, then `000025` twice — six
rows for three transactions, each with its own Resolve button. Reconciliation
records one row per transaction *per run*, which is correct as history, but the
queue read every unresolved row from every run. With a sweep every six hours over
a trailing forty-eight hours, an unsettled transaction appeared up to eight
times and resolving one left the rest. The queue now takes the newest finding per
transaction and shows it only while it is unresolved; the history is untouched.
Held by `apps/api/src/tests/a-worklist-that-multiplied.test.ts`.

**A guard that could not have been wrong, removed.** The same query filtered on
`reconciled_at IS NULL` beside a status filter that already excluded resolved
records — the two can never disagree, because resolving writes both in one
statement. Mutation-testing confirmed it could not change any result, so it went,
and the invariant it depended on is now held by a test rather than by a reading
of the code.

Everything else the walkthrough touched behaved correctly, including three
refusals that look like failures and are not: an unapproved handset refused at
the point of collection, seven revenue items refused for having no approved rate
in force, and the auth rate limiter refusing a burst of sign-ins.

---

## 6. Repeating it

```bash
scripts/uat/stack.sh up          # recreate everything and reseed
scripts/uat/stack.sh reseed      # more data on the stack already running
scripts/uat/stack.sh down        # stop
npx playwright test tests/browser/uat.spec.ts --headed   # watch it
npx playwright test tests/browser/uat.spec.ts --grep "Finance Officer"
```

The screenshots are regenerated on every run, so a change that breaks a screen
shows up as a failed test and a photograph of the failure.
