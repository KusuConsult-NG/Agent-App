# Queries to PSIRS on the revenue catalogue

**Answered by PSIRS, 24 August 2026.**

PSIRS confirmed that it is the source for every figure and mapping below: the
prices as configured, the local government items it collects on the Councils'
behalf, the personal income tax bands, the development levy, and the
attribution of revenue to Ministries. The catalogue is recorded in the
repository as PSIRS-confirmed accordingly, and
`catalogue-provenance.test.ts` now fails if any item carries a figure with no
source at all.

**What that does and does not settle.** PSIRS is the authority that
administers this revenue, so its confirmation is the strongest provenance
available short of the instruments themselves — and stronger than anything
this repository could establish alone. It is recorded as a *different* thing
from a figure read out of an Act, because the two are different claims and a
record that could not tell them apart would be worse than useless later. The
Schedules, the Compendium and the gazette have still not been read here.

The questions are kept below as they were asked, so the record shows what was
put and what came back.

---

## 1. The development levy amount

**What amount should the platform charge for Development Levy, and under what
authority?**

> **Answered:** ₦2,000, PSIRS confirming. Recorded as PSIRS-confirmed; the
> instrument itself has still not been seen here.

It is configured at **₦2,000 per annum per individual**, and it will stay
there: with the ₦100 federal provision put to them, the platform owner
confirmed ₦2,000 on 24 August 2026.

**We are still asking under what authority.** The figure is settled; its source
is not, and the two are different things. If there is a Plateau instrument
setting ₦2,000 we would like to record the section against the item, so that
what the platform charges rests on something better than a decision somebody
made once.

### Why we are asking

The Taxes and Levies (Approved List for Collection) Act, Part II of the
Schedule, provides for:

> Development levy (individuals only) **not more than ₦100 per annum** on all
> taxable individuals.

Three things we have been able to establish:

- The 2015 Amendment Order to that Act kept the same ₦100 figure.
- The Federal High Court declared that Amendment Order null and void in May
  2020, on the ground that amending the Schedule amends the Act and the power
  could not be delegated to the Minister — so the original provision stands
  rather than the amended one.
- The Nigeria Tax Act, 2025 came into force on 1 January 2026 and repealed a
  number of federal tax Acts. **We do not know whether it affects the Taxes
  and Levies Act or the state development levy**, and that is a large part of
  what we are asking.

We have not been able to read the Plateau State Revenue (Consolidation) Law,
2020 Schedules directly, so if that Law or the Compendium of Revenue sets a
different figure under a different authority, we have simply not seen it.

### What each answer means, so the shape of the reply is clear

| If the answer is | We will |
|---|---|
| ₦100 is the correct cap and ₦2,000 is wrong | Change the figure to the correct one and note the authority against it |
| ₦2,000 is correct under a Plateau instrument | Record that instrument and section against the item, and close the question |
| The levy has changed under the 2025 reform | Configure whatever now applies, or withdraw the item if it no longer exists |
| It is under review | Withdraw the item until it is settled — the platform refuses to assess a revenue item that has no rate in force, so nothing is collected in the meantime and no citizen is charged a disputed amount |

Any of those is a usable answer. The one outcome we want to avoid is agents
collecting ₦2,000 from traders on an authority nobody can name.

> **Answered for everything in this section:** PSIRS confirmed it is the
> source for the figures as configured.

## 2. Economic Development Levy

**Economic Development Levy** is configured at ₦5,000 per annum on businesses.
It is a different item from the one above and is not covered by the "individuals
only" provision, but we have not identified its authority either. If it comes
from the Consolidation Law or the Compendium, please point us at the section.

## 3. The Schedules, the Fourth Schedule and the Compendium

These will need answering before the platform collects real money:

1. **The Fourth Schedule to the Nigeria Tax Act, 2025.** The platform's
   personal income tax items were configured against the Personal Income Tax
   Act, the Capital Gains Tax Act and the Stamp Duties Act, which that Act
   repealed — so direct assessment taxed the first ₦800,000 of annual income
   that the new Act exempts, and applied a ₦5,000 floor on top of it.

   We have entered the Fourth Schedule bands (nil to ₦800,000; 15% to ₦3m;
   18% to ₦12m; 21% to ₦25m; 23% to ₦50m; 25% above), with no minimum,
   because these rates are federal and are the ones PSIRS applies rather than
   the ones PSIRS sets. They are in force in the platform as of 24 August
   2026 — the alternative was leaving the repealed PITA figures in force,
   which are certainly wrong.

   **Please still confirm them against the gazette**, which we were not able
   to read directly, and tell us whatever transition guidance governs a state
   assessment raised in 2026.

   Withholding tax and stamp duty remain withdrawn. Neither is a single rate —
   withholding differs by what is being paid for and stamp duty by the
   instrument — so we need the tables rather than a figure.

   **A question that follows from this.** A trader below ₦800,000 owes
   nothing, and the platform now says so plainly and raises no invoice. It
   stores no record of the assessment either, because there is no liability to
   record. Does PSIRS want a nil assessment kept — so the next agent who
   visits that trader can see they have been assessed and are exempt, rather
   than assessing them again? We have not built that, because what the Service
   issues is the Service's decision.

2. **The Compendium of Revenue.** The Consolidation Law provides that a
   revenue is payable only if it is in the Compendium. The platform carries a
   catalogue of 42 items which has never been reconciled against it. A copy,
   or a pointer to the current version, would let us check both directions —
   items we carry that are not collectable, and collectable items we are
   missing.

3. **The First and Second Schedules themselves.** We have checked all 42
   items. Thirty-one carry a figure we cannot source, because the figures are
   in those Schedules and we have not been able to read them. A copy of each
   would close most of this document.

## 4. Eleven items that look like local government revenue

> **Answered:** PSIRS collects these and is the source for the rates. The
> per-Council structure stays regardless of the answer — it is what lets one
> Council's figure be corrected without touching the other sixteen, and what
> gives "not collectable here" a representation at all.

This is the largest thing the check turned up, and it is not about amounts.

Part III of the Taxes and Levies (Approved List for Collection) Act lists
shops and kiosks rates, tenement rates, slaughter slab fees, marriage, birth
and death registration, street naming, right of occupancy on rural land,
market taxes and levies, motor park levies, domestic animal licence fees, and
signboard and advertisement permits as **local government** revenue. The
platform carries all of them, at a single figure applied across all seventeen
LGAs.

**Does PSIRS collect these as agent for the Local Government Councils?** If
so, whose rate applies — one rate agreed statewide, or each Council's own
bye-law?

The platform now holds **a rate per Council** for all eleven. Each is set to
the figure we were already charging, so nothing a trader pays has changed —
but the seventeen are now separately settable, and we can correct them one
Council at a time as you tell us what each bye-law says. A Council whose rate
we empty is refused rather than charged its neighbour's figure.

Three carry an exclusion in the Act that we have no way to model:

- **Street naming** excludes any street in the State Capital. Jos is the
  capital, so we have removed the rate in Jos North and Jos South and the
  platform now refuses the item there. **Tell us if that is wrong** — it is
  the one exclusion we have acted on rather than only asked about.
- **Right of occupancy** on that list is rural land only, and ours was one
  flat ₦50,000 with no rural qualifier. It is now per-Council, so **please
  tell us which Councils are rural** and we will empty the rest.
- **Market levies** exclude any market where state finance is involved. That
  is a fact about a market rather than about a Council, and the catalogue
  still has nowhere to record it. Which markets in Plateau does it cover?

We are aware the Act's own constitutional standing is disputed, and we are not
asking you to litigate it. We are asking what PSIRS's position is, because the
platform has to charge somebody something and we would rather it matched
yours.

## 5. Consumption tax, and mining fees

- **Consumption tax** is seeded at 5% on hotels, restaurants and event
  centres. Given the Court of Appeal's holding that VAT covered the field, and
  that VAT now sits in the Nigeria Tax Act, is PSIRS still assessing this? At
  what rate?
- **Mining, milling and quarrying fees** are seeded at ₦150,000. Mines and
  minerals are on the Exclusive Legislative List. What is the state
  instrument?

## Still open, and not covered by the above

These were not questions about figures and are not settled by confirming them:

- **The Integrated Billing System at `plateauigr.com` lets the taxpayer enter
  the amount; this platform computes it and offers no field to type one in.**
  If the same trader can self-declare on the IBS and be assessed here, both
  receipts are genuine and the state has two answers for what is owed. Which
  is authoritative, and how the two reconcile, needs settling before this
  platform collects alongside it.
- **The MDA list on the IBS invoice page** should be the one this catalogue
  uses. Ours was built from the priority ministries; a copy of theirs would
  let us match it exactly.

- **Market levies** exclude any market where state finance is involved. That
  is a fact about a market rather than a Council, and the catalogue still has
  nowhere to record it. A list of the affected markets would let us build one.
- **Water Resources** has no revenue item in the catalogue and **Education**
  has one. Either their revenue is collected outside this platform or it was
  never catalogued. The Revenue summary shows the zero rather than hiding it,
  which is the useful behaviour either way — but somebody should say which it
  is.
- **Right of occupancy** is rural-land-only on the approved list. It is now
  per-Council, so the urban Councils can be emptied as soon as somebody says
  which they are.

## What we have done in the meantime

Seven items carry no rate at all and the platform refuses to assess them. The
unverified figures are left exactly as they were seeded and are recorded in
the repository as unverified, in a test that fails if anybody adds a
forty-third price without saying where it came from.

Three things have changed since the first version of this document, and all
three are recorded with who decided rather than dressed up as findings:

1. The personal income tax bands are the Fourth Schedule, because those rates
   are federal.
2. The development levy stays at ₦2,000 on the owner's instruction, marked in
   the repository as owner-directed rather than sourced.
3. The eleven local government items are priced per Council instead of
   statewide — same amounts, seventeen separately settable rows.

## Contact

Whatever is easiest. We are told PSIRS can be reached at `contactus@psirs.gov.ng`
and on +234 803 123 0301.

---

**Answered by:** ___________________________  **Position:** ____________

**Authority cited:** _________________________________________________

**Date:** ____________
