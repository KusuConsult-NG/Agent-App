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
Under the Fourth Schedule to the NTA **the first ₦800,000 of annual income is
taxed at nothing at all**, the band above it at 15%, and the top rate is 25%.

A trader on ₦300,000 a year owed 7% and a ₦5,000 minimum under the figures
that were in this repository, and owes nothing under the law. On a platform
built to collect from the grassroots, the people that error reaches first are
the ones the reform deliberately exempts.

Five items are now unpriced for that reason — `PIT-DIRECT`, `PIT-PAYE`,
`PIT-WHT`, `PIT-CGT`, `PIT-STAMP` — and the platform refuses to assess them.
`PIT-PAYE` was additionally wrong before the reform: it sat at a flat 7% when
PAYE runs on the same progressive schedule as direct assessment, so it
overcharged everyone in the lowest band and undercharged everyone above it.

The correct bands are not written in here from a summary. The Fourth Schedule
is the authority, the Federal Government has issued transition guidance whose
effect on a state's own assessments is not something to infer, and Plateau is
among the states domesticating the reforms. **Somebody has to read the
Schedule.**

### One other price to check first

`DEV-LEVY` is seeded at **₦2,000 per annum**. The Taxes and Levies (Approved
List for Collection) Act provides for a development levy on individuals only,
**"not more than ₦100 per annum"**. The 2015 Amendment Order kept the same
₦100 figure and was in any case declared null and void by the Federal High
Court in 2020. If that cap still governs, the seeded figure is twenty times
the statutory maximum. It has been left priced rather than changed, because
whether the state development levy survives the 2025 reform in its old form is
exactly the question this document says not to answer by inference — but it
should be the first one asked.

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

Point 2 deserves emphasis. Of the thirty-seven prices originally seeded, five
have since been withdrawn as resting on repealed Acts and one — `DEV-LEVY` —
is flagged above as probably exceeding a statutory cap. **The remaining
thirty-one have not been verified against anything.** Nothing in this
repository establishes where ₦10,000 for urban business premises registration,
or ₦200 for a daily market levy, or any of the others came from.

## Sources

- Plateau State Revenue (Consolidation) Law, 2020 — published at
  `plateaustate.gov.ng` and `piras.psirs.gov.ng`, and in the Plateau State Law
  Library at `demo.plateau.ng.open.law/ng/plateau/justice/laws/2020/revenue`
- PSIRS, *What we do* — `psirs.gov.ng/about/what-we-do`
- Taxes and Levies (Approved List for Collection) Act — the federal instrument
  the existing catalogue already tracks closely

**Checked by:** ___________________________  **Date:** ____________
