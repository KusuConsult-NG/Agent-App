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

### The gazette itself was not read, and the bands were accepted anyway

The bands above are consistent across the published summaries of the Act and
across the PAYE tables issued under it. They were not read from the gazette,
which could not be reached from this environment.

**The platform owner accepted them on that basis on 24 August 2026**, and this
records the decision rather than pretending it was a verification. What is
known is that every source found agrees; what is not known is what the gazette
says, what transition guidance governs a state assessment raised in 2026, and
whether Plateau's domestication of the reform alters anything. Those are still
worth asking and are still in the query to PSIRS — but the bands are in force
in the platform, because the alternative was leaving the repealed PITA figures
in force instead, and those are certainly wrong.

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
Court in 2020.

**The platform owner confirmed ₦2,000 on 24 August 2026**, with that cap put to
them. The figure stands. What is recorded in
`catalogue-provenance.test.ts` is `OWNER_DIRECTED` — weaker than
`FEDERAL_STATUTE` and deliberately so: what is known is who decided, not which
section says so. The instrument setting ₦2,000 has still not been seen here and
the question to PSIRS stays open, so that a figure nobody can source remains
distinguishable from one that was merely never questioned.

---

## Checking the remaining thirty-one prices

Of the forty-two items in the catalogue, seven carry no rate, three now carry
the Fourth Schedule, and one — `DEV-LEVY` — is flagged above. The other
thirty-one were checked. **Not one of their naira figures could be
confirmed**, and the reason is the same for all of them: the amounts live in
the First and Second Schedules to the Consolidation Law, and those documents
are published at `plateaustate.gov.ng` and `piras.psirs.gov.ng`, both blocked
by this environment's network policy.

What the check did establish is that for eleven of the thirty-one, **the
figure is the wrong question**.

### Eleven items are local government revenue

The Taxes and Levies (Approved List for Collection) Act divides collection
three ways: Part I federal, Part II state, Part III local government. Part II
is short — personal income tax under PAYE and direct assessment, withholding
tax on individuals, capital gains tax on individuals, stamp duties on
instruments executed by individuals. Part III is where the following sit:

| Code | Part III |
|---|---|
| `SHOPS-KIOSKS` | item 1, shops and kiosks rates |
| `TENEMENT-RATES` | item 2, tenement rates |
| `SLAUGHTER-SLAB` | item 4, slaughter slab fees |
| `ABATTOIR-FEE` | overlaps item 4 |
| `MARRIAGE-REGISTRATION` | item 5, marriage, birth and death registration |
| `STREET-NAMING` | item 6, **excluding any street in the State Capital** |
| `RIGHT-OCCUPANCY` | item 7, **rural land only**, excluding what Federal and State collect |
| `MARKET-LEVY` | item 8, **excluding any market where State finance is involved** |
| `MOTOR-PARK-LEVY` | item 9, motor park levies |
| `DOMESTIC-ANIMAL-LICENCE` | item 10, domestic animal licence fees |
| `SIGNAGE-FEE` | signboard and advertisement permit fees |

The rate for any of them is set by a Local Government Council's bye-law, and
Plateau has seventeen Councils. All eleven carried a single statewide figure:
₦200 for a daily market stall in Jos North and in Wase alike, which cannot be
right whatever the number is, because those are not the same market and no one
bye-law governs both.

### What was done about it

**Each of the eleven now carries a rate per Council** — migration 025 adds
`revenue_item_rates.lga_id`, and resolution prefers a Council's own figure
over the statewide default. Every Council is seeded with the amount the
catalogue already held, so **nothing charged today changed**. What changed is
that the amount is now seventeen rows a Council can correct one at a time,
instead of one number that could only have been right for all of them by
coincidence.

The amounts are no better sourced than they were. The structure no longer
claims a single bye-law governs the state.

Two consequences worth naming:

- **"Not collectable here" is now expressible.** A Council with no rate row is
  refused — `NO_EFFECTIVE_RATE` — rather than charged its neighbour's figure.
  `STREET-NAMING` accordingly has no rate in Jos North or Jos South, because
  Part III excludes the State Capital and Jos is the capital. The same
  mechanism will express the rural-only restriction on `RIGHT-OCCUPANCY` once
  PSIRS says which Councils are rural.
- **A quote must now name the taxpayer.** The agent app quotes before it
  assesses, and those are two calls. If only one knew the LGA, the screen
  would show a trader one figure and the receipt would carry another. The
  quote endpoint takes the taxpayer's id and looks up the place *server-side*
  rather than accepting an LGA from the client, so an agent cannot quote at
  whichever Council's figure suits them. `per-lga-rates.test.ts` holds that
  the quote and the assessment agree.

`MARKET-LEVY`'s exclusion — markets where state finance is involved — is a
per-market fact, not a per-Council one, and the catalogue still has nowhere to
record it. That one remains open.

### One item's legal basis is under challenge

`CONSUMPTION-TAX` is seeded at 5% on hotels, restaurants and event centres.
The Court of Appeal has held that VAT, as an existing federal law, covered the
field on consumption and supersedes a state consumption tax law. VAT now sits
inside the Nigeria Tax Act, 2025. Whether Plateau may charge this at all, and
at what rate, is not a question this repository can settle.

### And a caution about the instrument the eleven rest on

The Taxes and Levies Act is itself a military decree whose constitutional
validity is disputed. A Court of Appeal decision has already invalidated part
of its operation, and commentary published in April 2026, following the
Supreme Court in *A.G. Abia State v. Imo Trans. Co. Ltd.*, argues the Act is
unconstitutional taken as a whole. So the Part III finding above is a
well-founded reason to ask, not a settled conclusion — which is why nothing
has been withdrawn on the strength of it.

### The remaining nineteen

`BP-REG-URBAN`, `BP-RENEW-URBAN`, `BP-REG-RURAL`, `BP-RENEW-RURAL`,
`ECON-DEV-LEVY`, `SOCIAL-SVC-LEVY`, `ECOLOGICAL-FEE`, `FIRE-SERVICE-CHARGE`,
`MINING-FEE`, `ENTERTAINMENT-TAX`, `GAMING-TAX`, `INFRA-LEVY`,
`LAND-USE-CHARGE`, `PROPERTY-TAX`, `ROAD-TAX`, `VEH-RENEW-PRIVATE`,
`VEH-RENEW-COMMERCIAL`, `ANIMAL-TRADE-TAX`, `PRODUCE-SALES-TAX`.

Nothing was found for any of them. Two are worth a second look beyond the
amount:

- **`MINING-FEE`**, ₦150,000. Mines and minerals are on the Exclusive
  Legislative List. What a state may charge in this area needs establishing
  before the figure does.
- **`PROPERTY-TAX`**, `LAND-USE-CHARGE` and `TENEMENT-RATES` may be three
  charges on one base. Land use charges in other states were created by
  consolidating tenement rates into a single charge precisely to stop that.

Vehicle figures could not be cross-checked either: the ₦30,000 number plate
fee is nationally uniform under the Joint Tax Board, but particulars renewal
is administered by each state's motor vehicle agency and is not harmonised, so
₦625 and ₦1,250 a month are Plateau's own and are in the Schedule with
everything else.

### How this is held

`catalogue-provenance.test.ts` records the classification of all forty-two
items and fails if the catalogue and the record disagree in either direction.
Adding a forty-third item with a figure beside it requires saying where the
figure came from, or the build fails. It does not make an unverified price
correct — it makes one impossible to add silently.

It also holds that **only an item whose rate was actually checked may be
self-assessable.** Self-assessment puts the figure in front of the taxpayer
with no officer in between; doing that with an amount nothing can source is
the weakest position of the lot. `PIT-DIRECT` is the only self-assessable item
and now rests on the Fourth Schedule, so the property holds today — the test
is there to keep it holding.

---

## What could not be checked, and should be

The primary sources are all published by Plateau State and were unreachable
from the environment this work was done in — `psirs.gov.ng`,
`plateaustate.gov.ng` and the state Law Library are blocked by its network
policy. Everything above comes from secondary summaries of those documents.
Before Phase 1:

1. **Read the First Schedule** and enter the presumptive bands per trade, and
   the consumption, entertainment and gaming rates.
2. **Read the Second Schedule** and enter the semi-urban business premises
   rates — and check the urban and rural figures already seeded, which are
   **unverified**.
3. **Settle the eleven Part III items**: whether PSIRS collects them as agent
   for the LGAs, and if so whose rate applies in which LGA.
4. **Reconcile the whole catalogue against the Compendium of Revenue.** Items
   here that are absent from the Compendium are not collectable; items in the
   Compendium that are absent here cannot be collected through this platform.
   Neither direction has been checked.

Of the thirty-seven prices originally seeded, three have been replaced with
the Fourth Schedule and two withdrawn pending a rate table. **Of the
thirty-one that remain, none has been verified against a primary source**, and
twelve have a question about them larger than their amount.

## Sources

**Primary, and unread — all blocked by this environment's network policy:**

- Plateau State Revenue (Consolidation) Law, 2020, First and Second Schedules
  — `plateaustate.gov.ng/uploads/plateau-state-revenue-consolidation-law-2020.pdf`
  and `piras.psirs.gov.ng/assets/Plateau State Law.pdf`
- Plateau State Law Library — `demo.plateau.ng.open.law/ng/plateau/justice/laws/2020/revenue`
- PSIRS — `psirs.gov.ng`
- The Compendium of Revenue — location unknown

**Secondary, and read:**

- Nigeria Tax Act, 2025, Fourth Schedule — via the published texts at
  `tat.gov.ng` and the Gombe State IRS mirror, and the KPMG, PwC, EY and
  Baker Tilly analyses of the reform
- Taxes and Levies (Approved List for Collection) Act, Parts II and III —
  via CommonLII, PLAC and LawCare Nigeria
- *Re-assessing the validity of the Taxes and Levies Act*, April 2026, on the
  constitutional standing of that Act after *A.G. Abia State v. Imo Trans.
  Co. Ltd.*
- *VAT affirmed as the principal tax on goods and services in hotels,
  restaurants and event centres* — KPMG Nigeria, on the consumption tax point
- Joint Tax Board / FRSC harmonised vehicle fees, June 2025

**Method.** Direct retrieval of any of these was blocked; they were reached
through search, which returns summaries rather than documents. That is
adequate for establishing that a question exists and inadequate for settling
one. Every figure entered on this basis says so where it is entered.

**Checked by:** ___________________________  **Date:** ____________
