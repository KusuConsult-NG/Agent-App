# Hausa review: everything still waiting on a decision

`HAUSA-REVIEW.md` carries all 2,986 dictionary strings, and most of its length
is those tables. The open questions are scattered through seven sections of the
prose above those tables, and somebody reading it for the first time has no way
to tell which paragraphs want an answer from them and which are explaining what
was already done.

This is that list and nothing else. Eighteen questions, grouped by who can
answer them and what it costs to leave them open. Every one links back to the
section of `HAUSA-REVIEW.md` that sets it out properly — this page is an index,
not a replacement, and none of it repeats the reasoning.

Nothing here has been answered. The sheet has been through several rounds of
new strings and none of review.

---

## 1. Not a translation question — PSIRS decides

**216 strings address the reader as `ka`: masculine singular.** A woman
collecting revenue in Bokkos is addressed as a man by the application she uses
all day.

The options are `ki`, the impersonal subjunctive (`A duba…`), or the polite
plural `ku`, which is gender-neutral. This is a decision about who PSIRS
believes it is talking to, and no translator can make it.

**It is not only about agents.** The review sheet framed this as a question
about field staff. Counting the dictionary says otherwise:

| Who reads it | Strings |
|---|---|
| The agent app | 122 |
| The officer portal | 62 |
| Citizens, referees and group leaders | 32 |
| **Total** | **216** of 2,986 |

So a female revenue officer in Jos is addressed as a man by her own portal, and
so is a woman looking up her own tax status with no account at all. `ku`, the
polite plural, is the only one of the three options that is both
gender-neutral and unremarkable to address a stranger with — which may matter
more for the 32 than for the 122.

The forms in play are `ka` (148 strings), the possessive `-nka` / `-rka` (89),
`kada ka` for a negative imperative (13) and `naka` / `taka` (5); some strings
carry more than one. Nothing currently uses `ku`.

It should be settled before Phase 0 rather than discovered during it: answering
it late means re-reading whatever was reviewed before it.

> `HAUSA-REVIEW.md` § *Group 3 — wording, register, and one question for PSIRS*

---

## 2. Safety-critical: three strings where a wrong reading costs money

These sit at the top because the failure mode is not "reads awkwardly" — it is
an agent or a citizen acting on a false statement about money.

**2.1 — `kwamishan` may not mean commission.** The reading is that in Nigerian
Hausa *kwamishan / kwamishina* is the **Commissioner**, the office holder, not
a percentage earned on a collection. If so, `Wannan asusu na kwamishan ka ne
kawai` can be parsed as *the Commissioner's account* — on the one screen whose
entire job is to say *this account is yours, and government revenue never
enters it*.

Proposed, pending you: `lada` throughout (`Lada`, `asusun ladanka`, `a biya
lada`). `kaso` if "share" or "percentage" is wanted specifically. Two readers
arrived at `lada` independently, which is corroboration and not proof.

**What saying yes would cost:** `kwamishan` appears in **49 strings**, 48 of
them on screens about money. `lada` appears in none, so the word is free to
take and nothing else has to move out of its way. It is a large change but a
mechanical one, and it is the sort that gets harder the longer the other
answers arrive first.

**2.2 — `paymentUnconfirmedBody` wraps a negation around an affirmative.**
`ba a … ba` encloses `an karbi wannan kudin` — *this money HAS been received*.
The sentence is technically correct, because the closing `ba` can only attach
to `nuna`. The question is whether a reader's eye lands on the affirmative
before reaching the negation that cancels it. On this string of all strings,
please read it slowly and say whether that is a real hazard or an imagined one.
The reader who raised it was explicitly unsure.

**2.3 — `offlineNotice` may state a different fact from the English.** The
English says no money has been **marked as received**. The Hausa was read as
saying money **was not received**. Those are different claims, and an agent who
watched a payment happen offline and then reads the second has been handed a
reason to collect the same money twice.

> `HAUSA-REVIEW.md` § *Group 2 — the one it called dangerous*

---

## 3. Content errors — true whichever Hausa you prefer

Checkable by comparing the two columns. They do not depend on anyone's dialect
or register, and they need fixing whatever is decided about wording.

| Key | What is wrong |
|---|---|
| `scanHelp` | English says "the receipt QR code **or vehicle license**"; the Hausa names only the receipt. An agent scanning a licence is told the screen does not do that. |
| `statusOffline` / `offlineMessage` | `BA HANYAR SADARWA` in one, `Babu hanyar sadarwa` in the other, for the same thing. |
| `statusFailed` / `paymentFailed` | `BA TA YI BA` treats the subject as feminine; `bai yi nasara ba` treats it as masculine. Same subject, two agreements. |
| `needDeclaration` / `enablePush` | `sanarwa` does duty for both the *declaration* a taxpayer accepts and a push *notification*. One word, two unrelated things. |
| ~~`receiptCodeShape`~~ | **Fixed.** It was five strings and English caused it — see below. One word left to confirm. |

One further item in this group, `Mungode` → `Mun gode`, was a word-separation
typo and has been corrected.

Two changes have now been made without you, and both are named here rather than
buried: that typo, and the receipt-code terminology below. Neither invents
Hausa — the typo split a word, and the other reuses `tantancewa`, which was
already in the dictionary for this exact object. Everything else on this page
still waits.

**The receipt-code one is done, and it was never really a Hausa error.**

`Verify.tsx` calls `verificationCodeFrom()`, the pattern it matches is
`VERIFICATION_CODE`, the field label said "Verification Code" and the public
portal said "verification code". The thing being typed was a **verification
code** everywhere in the platform except three user-facing English strings that
called it a "receipt code" — and `lambar rasit` is the receipt *number*, so the
Hausa had faithfully translated a name that was wrong in English first.

Two collisions, in opposite directions: three strings gave the code the receipt
number's word, and the same object had two Hausa names — `Tabbatarwa` on the
officer's transaction screen, `tantancewa` on the public one. Both are closed:

| Names `T7C72-QTUDN` | English now | Hausa now |
|---|---|---|
| `verifyTypeCode` | Or type the **verification code** | `lambar tantancewa` |
| `verifyNotAReceiptCode` | not a PSIRS **verification code** | `lambar tantancewa` |
| `receiptCodeShape` | A **verification code** looks like… | `lambar tantancewa` |
| `pubVerifyField` | Receipt number or verification code | `lambar tantancewa` |
| `verificationCode` | Verification Code | `Lambar Tantancewa` |

The eight strings that still say `lambar rasit` are right to: they are the
search boxes and the receipt number itself.

**What is left for you is one word.** `tantancewa` was chosen over `tabbatarwa`
because `tabbatar` already carries *confirm* across 139 strings — confirmed
payments, attestations, step-up — and reusing it here would repeat the mistake
this fixes. The corpus does not settle it, though: `verify` ("Verify Receipt")
uses `Tabbatar` while `ofcOvVerifyChain` ("Verify chain integrity") uses
`Tantance`, so both roots already translate *verify* somewhere. If `tabbatarwa`
is the better word for a code somebody checks a receipt with, say so — it is
now one decision in five places rather than a different word on each screen.

> `HAUSA-REVIEW.md` § *Group 1 — content errors*

---

## 4. New since the sheet was written, never read by anyone

**4.1 — 180 new officer-portal strings.** 237 strings across both applications
were found being written into screens in English rather than read from the
dictionary; 53 already had approved Hausa and were simply not being displayed,
and **180 are new drafts waiting on a first reading**. They are in table B,
grouped by screen. Start with the agent's groups: a refusal read by an agent in
a market is a different risk from a dashboard read by a finance officer in Jos.

**4.2 — 31 date strings, and `Sat` in particular.** Dates now take their month
from the dictionary rather than from the browser, so twelve short months,
twelve long months and seven weekdays are strings you have never been shown.
They were seeded from ICU.

`Sat` is Satumba shortened. It is also how English shortens Saturday. On a
screen carrying both a date and a day that is a real ambiguity, and the fix — if
you want one — is a different abbreviation, not a different mechanism.

`Jan`, `Mar` and `May` are deliberately identical in both languages and are
recorded as such, so nobody later mistakes them for untranslated strings.

**4.3 — `An bayar` for a citizen's own TIN.** `ASSIGNED` used to render through
the shared enum table as `An ba wa wani` — *given to someone* — which told a
citizen their own Tax Identification Number belonged to somebody else. It is
now scoped to that column alone:

| Where | English | Hausa |
|---|---|---|
| `ASSIGNED` anywhere else | Assigned | An ba wa wani |
| `taxpayers.tin_status` = `ASSIGNED` | Assigned | **An bayar** |

`An bayar` — *issued* — follows `An nema` (requested) the way the English does,
and says nothing about who holds the number, which matters because the same
label appears on an officer's screen about somebody else. If you would rather
it named the holder, say so.

**4.4 — `Sake saita` for a filter reset.** `Clear` beside a filter row was
sharing a key with *clear an agent for duty*, whose Hausa is `Ba da izini` —
grant permission. A Hausa-reading officer was being offered "Grant permission"
next to their filters. The filter control now has its own key with **`Sake
saita`**, which is a draft and wants your eye.

**4.5 — A vehicle period is left as digits.** The citizen statement prints
`2026-09-08 – 2027-09-08` rather than spelling the months, because a period is
a span, it sits beside a window line already written that way, and two spelt-out
months is more than the row can carry. Say if you would rather see them.

> `HAUSA-REVIEW.md` §§ *Strings that had Hausa and were not being shown*, *And
> every other date*, *`enumAssigned` was doing double duty*

---

## 5. Constrained by the screen, not by the language

**Six tab labels do not fit the agent's phone.** Each tab has about 52 logical
pixels — roughly 8 to 10 characters at the rendered size:

| Tab | Hausa now | Needs | Renders as |
|---|---|---|---|
| Taxpayers | Masu Biyan Haraji | 111px of 52px | `Masu ...` |
| Receipts | Takardun Rasit | 91px of 52px | `Takard...` |
| Collect | Karbi Haraji | 73px of 52px | `Karbi ...` |
| Commission | Kwamishan | 70px of 52px | `Kwamis...` |

`Gida` fits. It does not improve on a larger phone.

These are the existing prose terms reused as labels, and they have not been
shortened because shortening them is a translation decision. **What is wanted is
a short form for each — a word or two an agent would recognise on a tab, not a
description.** They have their own keys (`navTaxpayers` and the rest), so a
short label here will not disturb the longer term where it reads correctly in
prose.

`navProfile` is not an empty key — it holds the string `Profile` on **both**
sides, so a Hausa reader sees an English word rather than a blank. It is the
only string in the dictionary in that state: `hausa-dictionary-consistency`
carries an `AWAITING_REVIEW` list, `navProfile` is its single entry, and a test
fails if anything is added to it that has since been translated. So the debt is
one word, and it is being counted.

A Hausa word for it would close the list entirely.

> `HAUSA-REVIEW.md` § *One specific question: the tab bar*

---

## 6. Conventions, where a reader disagreed with this project

**6.1 — The apostrophe.** This dictionary writes every apostrophe as the
typographic `’`. A reader pointed out that if the argument for avoiding hooked
letters is that agents type on phone keyboards, then `Nau’in` and `A’a` should
use the ASCII `'` by the same logic. These are display strings rather than typed
input, so the argument is weaker than it looks.

**There is nothing inconsistent to repair, which changes what is being asked.**
Counting: **273** Hausa strings use `’` and **none** use the ASCII `'`. So this
is not "the dictionary is mixed, pick one" — it is already one, and the question
is only whether to convert all 273. That is a single scripted change if you want
it, and no change at all if you do not.

That reader agreed with the no-hooked-letters decision and would not overrule
it.

**6.2 — Register suggestions, offered as hypotheses.** To be tested on two or
three real agents rather than applied as corrections:

- `kudi a hannu` → `kudin hannu`
- `Takardun Rasit` → `Rasit`
- `Karbi Haraji` → `Karbar Haraji` (imperative where a label wants a noun)
- `Karin Bayani` → `Sauran` for "More"
- `tana gaba a lokaci` and `Cikin Nasara` read as calques
- `na'ura` and `waya` are used for the same object in different strings
- `Aiki` and `Hidima` likewise
- **`An Biyar da Kudi`** in `paymentSuccess` was flagged harder: `biyar` is the
  numeral **five**.

> `HAUSA-REVIEW.md` § *Group 3*

---

## What answering these actually involves

Corrections go into `packages/shared/src/i18n.ts` under `ha`. Two tests guard
them, and both fail if a correction drops an agreed word or a negation — which
is deliberate: change the test alongside the translation when the decision
itself changes. If you shorten a tab label, put it in the `nav*` key and not
the prose one.

Question 1 is the one that blocks the others. Every imperative in the
dictionary is written one way today, and settling `ka` after the rest have been
reviewed means reading them all again.

**Reviewed by:** ___________________________  **Date:** ____________
