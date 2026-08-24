# Where the revenue catalogue comes from

**For PSIRS revenue configuration to check before Phase 1.**

---

## Why this document exists

The catalogue decides what an agent can charge a trader in a market. Every code
in it is a sum somebody will be asked to hand over, so the question "who says
so, and where does the figure come from" has to have an answer that is not
"whoever seeded the database".

This records what was sourced, what was not, and what has been deliberately
left unpriced.

## The governing instrument

**Plateau State Revenue (Consolidation) Law, 2020.** It establishes PSIRS and
consolidates the state's levies, rates and fees. Two provisions bear directly
on how this platform must behave:

- **Revenue is payable only if it is in the Compendium of Revenue.** The law
  makes the Compendium the authority for what may be collected at all. The
  catalogue in this repository is therefore *downstream* of that document, and
  reconciling the two is a task for PSIRS, not for this codebase. An item here
  that is not in the Compendium is not collectable, whatever the software
  allows.
- **Every revenue-generating agency must publish a chart** of approved
  collectable revenue, the payment account, the procedure and channels for
  payment, and the expected time of payment. Worth noting that the platform's
  public verification page and revenue catalogue between them already carry
  most of that, and could be made to satisfy it explicitly.

Local Government Areas are categorised **Urban, Semi-Urban and Rural**, and
rates and fees are consolidated by that categorisation in the **Second
Schedule**.

Presumptive income tax is assessed by enterprise category — **micro, small or
medium** — for an individual whose trade or business keeps no accounting
records or whose profit cannot practicably be ascertained. The amount is set
per trade, business, vocation and profession by the **Administrative Table in
the First Schedule**. Reported bands run from **₦2,500 to ₦100,000**.

## What was added, and why it carries no price

Five items were added to the catalogue with **no rate**:

| Code | Authority |
|---|---|
| `PIT-PRESUMPTIVE-MICRO` | First Schedule, Administrative Table |
| `PIT-PRESUMPTIVE-SMALL` | First Schedule, Administrative Table |
| `PIT-PRESUMPTIVE-MEDIUM` | First Schedule, Administrative Table |
| `BP-REG-SEMI-URBAN` | Second Schedule, semi-urban categorisation |
| `BP-RENEW-SEMI-URBAN` | Second Schedule, semi-urban categorisation |

Presumptive income tax matters more than its five lines suggest: it is the
instrument by which the informal sector is taxed at all, and the informal
sector is who this platform was built to serve. It was absent entirely. The
semi-urban tier was absent because the catalogue carried only the two ends of a
three-way categorisation, so a business in a semi-urban LGA had to be charged
as though it were in Jos or as though it were in a village.

**They are unpriced deliberately.** The Schedules are the legal authority for
the figures and they were not reproduced from memory or inference. A wrong
presumptive band is an agent collecting the wrong sum from a trader under
colour of law, and it would be indistinguishable, on the receipt, from a right
one.

The platform already refuses to assess an item with no rate in force —
`NO_EFFECTIVE_RATE`, *"no approved rate in force. It cannot be assessed until
government sets one"* — so the items are visible to officers who need to
configure them and unusable by agents until somebody with the Schedule open
enters the figure. `catalogue-awaiting-schedule.test.ts` holds that property.

## The catalogue was priced against repealed law

Checking the thirty-seven existing prices turned up something larger than any
of them.

**The Nigeria Tax Act, 2025 has been in force since 1 January 2026.** It
repealed and consolidated the Personal Income Tax Act, the Capital Gains Tax
Act and the Stamp Duties Act, among others. Every `PIT-*` item in this
catalogue was priced against those Acts.

The seeded direct-assessment bands were the old PITA schedule — 7% from the
first naira, rising through 11 / 15 / 19 / 21 to 24%, with a ₦5,000 floor.
Under the Fourth Schedule to the NTA the first ₦800,000 of annual income is
taxed at nothing at all.

A trader on ₦300,000 a year owed 7% and a ₦5,000 minimum under the figures
that were in this repository, and owes nothing under the law. On a platform
built to collect from the grassroots, the people that error reaches first are
the ones the reform deliberately exempts.

### What has been entered

**The Fourth Schedule now governs `PIT-DIRECT`, `PIT-PAYE` and `PIT-CGT`:**

| Annual income | Rate |
|---|---|
| First ₦800,000 | Nil |
| Next ₦2,200,000 (to ₦3m) | 15% |
| Next ₦9,000,000 (to ₦12m) | 18% |
| Next ₦13,000,000 (to ₦25m) | 21% |
| Next ₦25,000,000 (to ₦50m) | 23% |
| Above ₦50,000,000 | 25% |

These three were entered rather than left unpriced because **personal income
tax rates are federal**. States administer the tax; they do not set its rates.
Unlike the Plateau fee Schedules, this is not a figure PSIRS chooses — it is
the one PSIRS applies. `personal-income-tax-schedule.test.ts` locks the
arithmetic at every band boundary.

**There is no minimum, and that is the point rather than an omission.** A
floor of any size falls on someone whose tax is nil, which is the exemption
cancelled by the line beneath it. The test asserts its absence.

`PIT-PAYE` carries the same schedule because PAYE is this tax deducted at
source, not a different one; it sat at a flat 7%, which was wrong before the
reform as well, overcharging everyone in the lowest band and undercharging
everyone above it. `PIT-CGT` carries it because the NTA brought chargeable
gains for individuals inside the personal income tax framework, replacing the
flat 10% of the repealed Capital Gains Tax Act.

**Two remain unpriced, for a different reason than before.** `PIT-WHT` and
`PIT-STAMP` are not one rate each. Withholding differs by what is being paid
for — rent, dividends, professional fees, construction, ordinary contracts —
and stamp duty by which instrument is being stamped. A single figure would be
wrong for every transaction except whichever one it happened to match. They
need a rate table and an input naming the kind, which is a change to the item
rather than a number to fill in.

### The gazette itself was not read

The bands above are consistent across the published summaries of the Act and
across the PAYE tables issued under it. They were not read from the gazette,
which could not be reached from this environment. **That is what needs
checking**, along with whatever transition guidance governs a state assessment
raised in 2026, and whether Plateau's domestication of the reform alters
anything.

### What entering them exposed

Applying the Schedule to the running system found a defect that had nothing to
do with the numbers.

Assessing a trader on ₦300,000 produced:

> The calculated amount is zero. Check the values entered before raising an
> invoice.

The values were not wrong; the trader is exempt. But an agent reading that has
been told their input is the problem, and the only way past it is to enter an
income the trader does not have. **Agents are paid commission on what they
collect.** A refusal that blames the figures is, to that agent, an instruction
to raise them — and the agent app compounded it, announcing "You are about to
collect ₦0.00" with a payment button that then failed.

The platform now distinguishes a zero that came out of the schedule from a
zero that came out of an empty form. The first is reported as `NO_TAX_PAYABLE`
with the working shown and an explicit instruction not to increase the amount;
the second keeps the old message, which is correct for it. Nothing is stored
either way, because there is no liability to record. The strings exist in
Hausa as well as English: an exemption an agent cannot explain to the person
in front of them is not much use.

**One question for PSIRS follows from this and is not settled here.** A trader
found to owe nothing gets no assessment, no invoice and no record of the
visit. Whether PSIRS wants a nil assessment recorded — evidence, to the next
agent who comes round, that this trader has been assessed and is exempt — is a
decision about what the Service issues, not one for this repository. The
platform currently refuses cleanly and stores nothing.

### One other price to check first

`DEV-LEVY` is seeded at **₦2,000 per annum**. The Taxes and Levies (Approved
List for Collection) Act provides for a development levy on individuals only,
**"not more than ₦100 per annum"**. The 2015 Amendment Order kept the same
₦100 figure and was in any case declared null and void by the Federal High
Court in 2020. If that cap still governs, the seeded figure is twenty times
the statutory maximum. It has been left priced rather than changed, because
whether the state development levy survives the 2025 reform in its old form is
a question of state law rather than federal — the reason the Fourth Schedule
could be entered does not extend to it. `PSIRS-QUERY-DEVELOPMENT-LEVY.md` asks
it.

---

## What could not be checked, and should be

The primary sources are all published by Plateau State and were unreachable
from the environment this work was done in — `psirs.gov.ng`,
`plateaustate.gov.ng` and the state Law Library are blocked by its network
policy. Everything above comes from secondary summaries of those documents.
Before Phase 1:

1. **Read the First Schedule** and enter the presumptive bands per trade.
2. **Read the Second Schedule** and enter the semi-urban rates — and check the
   urban and rural figures already seeded, which are **unverified**. They were
   in the catalogue before this research and no source was found for them.
3. **Reconcile the whole catalogue against the Compendium of Revenue.** Items
   here that are absent from the Compendium are not collectable; items in the
   Compendium that are absent here cannot be collected through this platform.
   Neither direction has been checked.

Point 2 deserves emphasis. Of the thirty-seven prices originally seeded, three
have been replaced with the Fourth Schedule, two have been withdrawn pending a
rate table, and one — `DEV-LEVY` — is flagged above as probably exceeding a
statutory cap. **The remaining thirty-one have not been verified against
anything.** Nothing in this repository establishes where ₦10,000 for urban
business premises registration, or ₦200 for a daily market levy, or any of the
others came from.

## Sources

- Plateau State Revenue (Consolidation) Law, 2020 — published at
  `plateaustate.gov.ng` and `piras.psirs.gov.ng`, and in the Plateau State Law
  Library at `demo.plateau.ng.open.law/ng/plateau/justice/laws/2020/revenue`
- PSIRS, *What we do* — `psirs.gov.ng/about/what-we-do`
- Taxes and Levies (Approved List for Collection) Act — the federal instrument
  the existing catalogue already tracks closely

**Checked by:** ___________________________  **Date:** ____________
