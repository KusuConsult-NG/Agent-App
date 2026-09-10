# Hausa review sheet

**For a native Hausa speaker to check, before any of this reaches an agent.**

> **If you want only the questions, read
> [`HAUSA-REVIEW-QUESTIONS.md`](HAUSA-REVIEW-QUESTIONS.md) instead.** It is the
> eighteen decisions still waiting on somebody, gathered out of the prose
> below and ordered by what it costs to leave each one open. This sheet is long
> because it carries all 3,230 strings; that one is two pages and links back
> here for the reasoning.

---

## Why this needs your eyes

These strings were drafted without a native speaker. They are not decorative:
they are the sentences that stop a revenue agent from taking cash into their
own pocket, tell them a payment has not been confirmed, and explain why a form
will not go further.

A sentence that is merely awkward costs a moment's confusion. A sentence that
is *wrong* — that says money was received when it was not, or that reads as
permission to collect cash — costs somebody money and somebody else their job.
Please read them as instructions, not as prose.

## What to check, in order of how much it matters

1. **Does it say the same thing?** Not "is it good Hausa" — does a Hausa
   speaker take the same instruction from it that an English speaker takes
   from the left-hand column?
2. **Is a negative still negative?** Several of these turn on *not*: never
   collect cash, the payment has **not** been confirmed, do not ask them to
   pay again. A dropped negative here is the worst failure possible.
3. **Would an agent in a Jos market use these words?** The register should be
   plain and spoken, not official. `kudi`, not a formal synonym.
4. **Is the vocabulary consistent?** One word for one thing, throughout. If
   `mai biyan haraji` is the taxpayer in one line it must be in all of them.

## What has changed since this sheet was first written

It listed 78 strings. It now lists **3,230 dictionary strings and 30 message
templates**, because the app it describes went from six translated screens to
all of them, because the officer portal behind it was translated too, and
because the SMS, email and push messages PSIRS sends are now sent in the
language the recipient reads rather than always in English.

Two things follow, and both matter to how you spend your time.

**The tables are generated now.** `node scripts/build-hausa-review.mjs` rebuilds
them from `packages/shared/src/i18n.ts` and from the migration that inserts the
templates, and `npm run verify` runs it with `--check`. A sheet that lists 78 of
3,230 strings is worse than no sheet, because it looks complete; this one cannot
fall behind without CI saying so.

**Read table B by screen, and start with the agent's.** The officer-portal
groups are the long tail — a revenue-intelligence dashboard read by a finance
officer in Jos is a different risk from a refusal read by an agent in a market,
and if your time runs out it is the right place for it to run out. The agent
groups come first in the table for that reason.

**Table C is new, and it is the one to read if you read nothing else.** Those
thirty messages reach a citizen who holds no account, has no app, and has
nobody standing beside them to explain what arrived. The acknowledgement
wording is the sharpest case: it has to be unmistakably **not** a receipt,
because the money has not reached government yet, and a citizen who reads it
as a receipt has been told something untrue about their own payment.

Everything the first version of this sheet asked is still open. Nothing in it
has been answered, and the questions below — `kwamishan`, the `ka` address, the
tab-bar widths — now apply to a great deal more text than they did.

## What a machine has already checked, so you need not

A consistency pass runs in the test suite
(`hausa-dictionary-consistency.test.tsx`) and currently holds. None of it is a
judgement about the Hausa — it is bookkeeping, and it is listed here only so
you do not spend your attention repeating it:

- All 3,230 keys exist in both languages; nothing is missing and nothing is spare.
- No Hausa string is a copy of its English (one exception, `navProfile`, is
  named below and is waiting on you).
- **Every English string containing a negative has a Hausa negation** —
  `ba`, `kada`, `babu`, `bai` or `banda`. This is a crude proxy and it cannot
  tell you whether the negative is attached to the right verb. It only
  guarantees that none of them vanished entirely. Question 2 is still yours.
- The glossary below is applied consistently across all 3,230 strings: where the
  English says *taxpayer*, the Hausa says *mai biyan haraji*, and so on for
  receipt, confirm, device, account, commission and cash.
- No hooked letters; no `kuɗi`; apostrophes written one way throughout. That
  last one was asserted here before anything checked it, and it was false by
  one: `paymentAcknowledgedBody` had `Na\u02bburar` with a modifier letter
  where the other 331 use `’`. It is corrected, and a test now holds it.
- Example phone numbers and receipt codes survive translation intact.

What no machine can check is whether a Hausa speaker takes the same
instruction from these that an English speaker takes from the left-hand
column. That is questions 1, 2 and 3, and it is the whole reason this
document exists.

---

## A second reading, which is still not yours

A second language model read the first 78 pairs cold, without the drafting context
and without being told what to conclude. It was explicit that it is **not a
native speaker** and that its register judgements are the ones most likely to
be wrong. So this is corroboration, not clearance — it does not discharge the
review, and none of its proposed Hausa has been applied.

What it found is set out below in three groups, because they need different
things from you.

### Group 1 — content errors, true regardless of which Hausa you prefer

These are checkable by comparing the two columns, so they do not depend on
anyone's Hausa. They need fixing whatever you decide about wording.

| Key | What is wrong |
|---|---|
| ~~`scanHelp`~~ | **Fixed, by deletion.** The English was false — neither camera screen reads a vehicle licence — and no screen ever displayed the string. See `HAUSA-REVIEW-QUESTIONS.md` § 3. |
| `statusOffline` / `offlineMessage` | `BA HANYAR SADARWA` in one, `Babu hanyar sadarwa` in the other, for the same thing. |
| `statusFailed` / `paymentFailed` | `BA TA YI BA` treats the subject as feminine; `bai yi nasara ba` treats it as masculine. Same subject, two agreements. |
| `needDeclaration` / `enablePush` | `sanarwa` does duty for both the *declaration* a taxpayer accepts and a push *notification*. One word, two unrelated things. |
| ~~`receiptCodeShape`~~ | **Fixed.** It called `T7C72-QTUDN` a `lambar rasit`, which is the receipt **number**. The English was wrong first, in five strings; all five now say *verification code* / `lambar tantancewa`. One word left to confirm — see `HAUSA-REVIEW-QUESTIONS.md` § 3. |

`Mungode` → `Mun gode` in `civicDutyThanks` was a plain word-separation typo
and has been corrected already.

Five changes have now been made without you: that typo, the receipt-code
terminology, the deletion of `scanHelp`, the deletion of the dead camera
scanner along with ten strings only it used, and three new strings for the
three ways a camera can refuse to open. Only the last adds to your reading, and
even it invents no vocabulary — `burauza`, `izini` and `saiti` were all already
here. The rest of this sheet still waits on you.
`HAUSA-REVIEW-QUESTIONS.md` sets out all five in full.

### Group 2 — the one it called dangerous

**`kwamishan` may be the wrong word for commission.** The reading is that in
Nigerian Hausa *kwamishan / kwamishina* means **Commissioner** — the office
holder — and not a percentage earned on a collection. If so, `Wannan asusu na
kwamishan ka ne kawai` can be parsed as *the Commissioner's account*, on the
one screen whose entire job is to say **this account is yours, and government
revenue never enters it**.

This document already asked whether `lada` was better. A reader who had never
seen that question arrived at the same answer independently. That is not proof
— you are the proof — but it is why this sits at the top of the list.

Proposed, pending you: `lada` throughout (`Lada`, `asusun ladanka`, `a biya
lada`). `kaso` was offered as the alternative if "share/percentage" is wanted
specifically.

Also flagged, with less confidence: `paymentUnconfirmedBody` wraps `ba a … ba`
around an embedded affirmative clause (`an karbi wannan kudin` — "this money
HAS been received"). The reading is that the sentence is *technically* correct
because the closing `ba` can only attach to `nuna`, but that a reader's eye
lands on the affirmative before reaching the negation that cancels it. On this
string of all strings, please read it slowly and say whether that is a real
hazard or an imagined one. The reviewer was explicitly unsure.

And `offlineNotice`: the English says no money has been **marked as received**;
the Hausa was read as saying money **was not received**. Those are different
claims, and an agent who watched a payment happen offline and then reads the
second has been handed a reason to collect again.

### Group 3 — wording, register, and one question for PSIRS

Offered as suggestions only, and the reviewer asked that they be treated as
hypotheses to test on two or three real agents rather than as corrections:
`kudi a hannu` → `kudin hannu`; `Takardun Rasit` → `Rasit`; `Karbi Haraji` →
`Karbar Haraji` (imperative where a label wants a noun); `Karin Bayani` →
`Sauran` for "More"; `tana gaba a lokaci` and `Cikin Nasara` read as calques;
`na'ura` and `waya` are used for the same object in different strings; `Aiki`
and `Hidima` likewise. `An Biyar da Kudi` in `paymentSuccess` was flagged
harder — `biyar` is the numeral **five**.

It agreed with the no-hooked-letters decision and would not overrule it. It
disagreed with one thing this document does: if the argument is that agents
type on phone keyboards, then the **curly apostrophe** in `Nau’in` and `A’a`
should be the ASCII `'` by the same logic. These are display strings rather
than typed input, so the argument is weaker than it looks — but it is your
call.

**A question this document should have asked and did not:** every imperative
addresses the agent as `ka`, masculine singular. A woman collecting revenue in
Bokkos is addressed as a man by every instruction in the app. The options are
`ki`, the impersonal subjunctive (`A duba…`), or the polite plural `ku` which
is gender-neutral. This is a decision for PSIRS about who its agents are, not
a translation matter, and it should be settled before Phase 0 rather than
discovered in it.

---

## One specific question: the tab bar

Six labels sit along the bottom of the agent's phone, and each has about
**52 logical pixels** — roughly 8 to 10 characters at the rendered size. On a
360px handset the Hausa labels do not fit:

| Tab | Hausa now | Needs | Renders as |
|---|---|---|---|
| Taxpayers | Masu Biyan Haraji | 111px of 52px | `Masu ...` |
| Receipts | Takardun Rasit | 91px of 52px | `Takard...` |
| Collect | Karbi Haraji | 73px of 52px | `Karbi ...` |
| Commission | Kwamishan | 70px of 52px | `Kwamis...` |

It does not improve on a larger phone. `Gida` fits.

These are the existing prose terms, reused as labels. They have not been
shortened, because shortening them is a translation decision and not one to
make without you. **What is wanted is a short form for each — a word or two
an agent would recognise on a tab, not a full description.** They now have
their own dictionary keys (`navTaxpayers` and the rest), so a short label
here will not disturb the longer term where it reads correctly in prose.

`navProfile` is still the English word "Profile". It was hardcoded into the
tab bar where no dictionary could reach it; it is now a key with nothing in
it. A Hausa word for it would be welcome.

---

## Two things found while shooting the citizen page in Hausa

Screenshots found both. Neither was visible in the tables below, which is the
point worth taking from it: a table of key/value pairs proves a translation
exists, not that a screen uses it.

### Strings that had Hausa and were not being shown

Seven strings on the public pages were written into the screen in English
instead of being read from the dictionary — the search tabs, the search
button, its progress text, and the placeholders. Four of them already had
Hausa here, approved:

| Key | Hausa that existed | What the screen showed |
|---|---|---|
| `pubVerifyAmount` | Adadi | Amount |
| `pubVerifyFingerprint` | Hatimin takardar | Document fingerprint |
| `pubRefereeSubmit` | Tabbatar da aikawa | Confirm and submit |
| `pubRefereeSubmitting` | Ana aikawa… | Submitting… |

Somebody translated these, you approved them, and the screen went on showing
English. All seven are fixed, the new ones are in the tables below, and the
public pages now fail their own test if it happens again.

**The officer portal had about two hundred more, and they are done.** 237
strings in all across both applications — button labels, table headings, the
labels down the side of a record, progress text, `?? 'Unnamed'` fallbacks, and
four module-level lookup tables that were built before there was a reader to
build them for. 53 of the 237 already had Hausa here and were simply not being
read; 180 are new and are in the tables below, waiting on you.

Both applications now fail their own test if a capitalised literal appears in a
screen without going through the dictionary, so this particular rot cannot come
back quietly.

Two things worth knowing about how they were done:

- Where a value already had a key, that key is reused rather than duplicated —
  `Status` is `appStatus` on every screen that shows one, not a fresh key per
  screen. Where the same control appears in both applications, it moved to an
  app-wide key: `uiHidePassword`, `uiShowPassword`, `uiHide`, `uiShow`.
- Four labels on the outstanding-work screen were passed to a component typed
  `what: string`, which is how they stayed English while everything around
  them was keyed. That prop is now `keyof TranslationDictionary`, so the
  compiler holds the boundary the way it already does for `Stat` and `Alert`.

### The last English on that page is gone, and it was not a translation problem

A vehicle payment used to carry **`12 month vehicle renewal`** under it —
`assessments.period_label`, a sentence composed in English inside the renewal
service. The obvious fix was a `period_label_ha` twin like `revenue_items`
has. That would have been the wrong fix.

Only three places set a period label. Two write `2026` and `2026-07`: a year
and a month, which read the same in both languages and want no translation at
all. The third was the renewal, and a renewal's period is not a name — it is
two dates, which `assessments` already has columns for and which the renewal
row beside it was already recording. So the renewal records them too now, and
the screens print the period rather than a stored sentence.

It cost more than a language. The compliance score counts distinct period
labels, and every renewal wrote the same words, so a motorist's 2025 and 2026
renewals counted as **one** period against the minimum that gates programme
eligibility. Somebody two years into paying looked like somebody assessed once.

### And every other date, which was the same problem one layer down

`formatDate` was fixed to `en-NG`, written out eighty times across the two
applications, so every date on every screen said "08 Sept 2026" to a reader in
Hausa. The month is the only word in a date; the day and the year are digits.

The one-line fix would have been to pass `'ha'` to `toLocaleDateString`. ICU
does know Hausa. It was rejected for two reasons, and the second is the one
that matters to you: it would put twelve Hausa words on every screen that this
sheet never shows you. The doctrine here is that nothing visible reaches a
person without passing the dictionary first, and month names are not an
exception to it. (The other reason is that a browser built with a trimmed ICU
renders English silently, which looks fixed and is not.)

So the months are dictionary strings, and here they are. **They were seeded
from ICU and want your eye**, particularly `Sat`:

| | Hausa |
|---|---|
| Short months | Jan · Fab · Mar · Afi · May · Yun · Yul · Agu · **Sat** · Okt · Nuw · Dis |
| Long months | Janairu · Faburairu · Maris · Afirilu · Mayu · Yuni · Yuli · Agusta · Satumba · Oktoba · Nuwamba · Disamba |
| Weekdays | Lahadi · Litinin · Talata · Laraba · Alhamis · Jumma’a · Asabar |

`Sat` is Satumba shortened, and it is also how English shortens Saturday. On a
screen carrying both a date and a day that is a real ambiguity, and the fix if
you want one is a different abbreviation, not a different mechanism.

Three of the short months — `Jan`, `Mar`, `May` — are spelt the same in both
languages, because Janairu, Maris and Mayu shorten the same way English does.
They are recorded in the dictionary guard's `SAME_IN_BOTH` list so nobody later
mistakes them for strings that were never translated.

ICU writes `Jummaʼa` with a modifier letter apostrophe. This dictionary writes
every apostrophe as `’`, so it is `Jumma’a` here. That correction is the kind
of thing the dictionary route puts in front of you and
`toLocaleDateString('ha')` would have rendered silently for ever.

**One thing deliberately left as digits.** The vehicle period on the citizen
statement prints `2026-09-08 – 2027-09-08` rather than spelling the months. A
period is a span, it sits beside the statement's own window line which is
already written that way, and two spelt-out months in one line of a payment row
is more words than the row can carry. Say if you would rather see them.

### `enumAssigned` was doing double duty, and a TIN now has its own word

The citizen page shows the state of somebody's TIN, and `ASSIGNED` rendered
through the shared enum table as **`An ba wa wani`**. Read plainly that is
*given to someone* — right for a case handed to an officer, and on the citizen
page it told a person their own Tax Identification Number belonged to somebody
else. That is the `sanarwa` problem in Group 1 again: one Hausa word standing
for two unrelated things.

`ENUM_LABELS` is keyed by value on the stated principle that a word means the
same thing wherever it appears, and the module says an exception belongs
written down beside it. So there is now one, scoped to the column:

| Where | English | Hausa |
|---|---|---|
| `ASSIGNED` anywhere else | Assigned | An ba wa wani |
| `taxpayers.tin_status` = `ASSIGNED` | Assigned | **An bayar** |

**`An bayar` — *issued* — is the choice that needs your eye.** It follows
`An nema` (requested) the way the English does, and it says nothing about who
holds the number, which matters because the same label appears on an officer's
screen about somebody else. If you would rather it named the holder, say so;
the other four values in that column are `An nema`, `Ba a nema ba`, `Ya gaza`
and `Ana da shi`, and they are unchanged.

The English is deliberately identical in both rows. "Assigned" is right for a
TIN, and an exception that quietly rewrote the English too would hide what this
is: a Hausa fix, not a copy change.

Two tests hold it. One checks every exception names a real column, a value that
column can actually hold, and a key the dictionary has in both languages — a
stale entry there is worse than none, because it looks like a decision. The
other names the two Hausa strings, so a later tidy-up cannot collapse them back
into one.

---

## Conventions used

The existing dictionary avoids hooked letters (`ɗ`, `ƙ`) and writes `kudi`
rather than `kuɗi`, because agents type on phone keyboards without them. New
strings follow that. **If you disagree, say so — it is a decision, not an
accident, and it can be changed.**

Numbers, receipt codes and the example phone number are left as they are.
They are read off a screen and typed.

---

## The strings

Three tables, generated from the source rather than typed here — run
`node scripts/build-hausa-review.mjs` after adding strings and commit the
result, so this sheet cannot quietly fall behind the app.

**A** is the tier where being wrong costs somebody money. **B** is the rest of
the dictionary, grouped by the screen an agent meets it on. **C** is the
messages PSIRS sends by SMS, email and push — the ones that reach a citizen
who has no account, no app and nobody standing beside them.

<!-- BEGIN:GENERATED -->

### A · The safety tier

Being wrong here costs somebody money. Read these first, and if your time
runs out, stop after them. Membership of this tier is enforced by
`apps/agent/src/tests/hausa-safety-strings.test.tsx` — a string cannot
quietly leave it.

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `neverCollectCash` | Never collect cash | Kada ka karbi kudi a hannu | ☐ | |
| `neverCollectCashBody` | Government revenue must always be paid by the taxpayer through an approved payment channel. Never accept cash into your own account. | Dole mai biyan haraji ya biya kudin gwamnati ta hanyar biyan kudi da aka amince da ita. Kada ka taba karbar kudi a asusunka. | ☐ | |
| `cashChannelReminder` | The taxpayer must pay through the approved payment channel. Confirm the amount with them before you continue. | Dole mai biyan haraji ya biya ta hanyar da aka amince da ita. Ka tabbatar da adadin kudin tare da shi kafin ka ci gaba. | ☐ | |
| `commissionAccountOnly` | This account is for your commission only | Wannan asusu na kwamishan ka ne kawai | ☐ | |
| `commissionAccountNote` | Verified before any commission can be paid. Government revenue never enters this account. | Ana tabbatar da shi kafin a biya kowane kwamishan. Kudin gwamnati ba ya shiga wannan asusu ko kadan. | ☐ | |
| `paymentFailed` | Payment did not go through | Biyan kudin bai yi nasara ba | ☐ | |
| `paymentFailedBody` | No money has been taken from the taxpayer. You can start the payment again. | Ba a karbi kudi daga mai biyan haraji ba. Kana iya sake fara biyan. | ☐ | |
| `paymentUnconfirmed` | Payment not yet confirmed | Ba a tabbatar da biyan kudin ba tukuna | ☐ | |
| `paymentUnconfirmedBody` | This payment has NOT been marked as received. Do not ask the taxpayer to pay again — check again in a moment. | BA A nuna an karbi wannan kudin ba. Kada ka ce wa mai biyan haraji ya sake biya — ka sake dubawa nan da dan lokaci. | ☐ | |
| `findTaxpayerFirst` | Find the taxpayer first. Every payment must be attributed. | Ka nemo mai biyan haraji tukuna. Dole a danganta kowane biyan kudi ga wani. | ☐ | |
| `noTaxpayerMatch` | No taxpayer matches that search. Register them below before taking a payment — every payment must be attributed to a taxpayer. | Babu mai biyan haraji da ya dace da wannan bincike. Ka yi masa rajista a kasa kafin ka karbi kudi — dole a danganta kowane biyan kudi ga mai biyan haraji. | ☐ | |
| `genuineReceipt` | Genuine receipt | Rasit na gaskiya | ☐ | |
| `receiptNotValid` | Not a valid receipt | Rasit din ba na gaskiya ba ne | ☐ | |
| `receiptNotValidBody` | No government document matches that number or code. If you were given a receipt bearing this number, it was not issued by PSIRS. | Babu takardar gwamnati da ta dace da wannan lamba ko code. Idan an ba ka rasit mai wannan lamba, ba PSIRS ce ta fitar da shi ba. | ☐ | |
| `receiptCodeShape` | A verification code looks like T7C72-QTUDN. Check the code and try again. | Lambar tantancewa tana kama da T7C72-QTUDN. Ka duba lambar ka sake gwadawa. | ☐ | |
| `needFirstName` | Enter the taxpayer’s first name. | Ka rubuta sunan farko na mai biyan haraji. | ☐ | |
| `needLastName` | Enter the taxpayer’s last name. | Ka rubuta sunan karshe na mai biyan haraji. | ☐ | |
| `needPhone` | Enter the taxpayer’s phone number in full, for example 08012345678. | Ka rubuta cikakkiyar lambar wayar mai biyan haraji, misali 08012345678. | ☐ | |
| `needAddress` | Enter the taxpayer’s address. | Ka rubuta adireshin mai biyan haraji. | ☐ | |
| `needLga` | Choose the Local Government Area. | Ka zabi Karamar Hukuma. | ☐ | |
| `needConsent` | The taxpayer must agree before you can register them. | Dole mai biyan haraji ya yarda kafin ka yi masa rajista. | ☐ | |
| `needDeclaration` | Confirm the declaration before you register the taxpayer. | Ka tabbatar da sanarwar kafin ka yi wa mai biyan haraji rajista. | ☐ | |
| `needExistingTin` | Enter the taxpayer’s existing TIN, or choose “No” if they do not have one yet. | Ka rubuta TIN din mai biyan haraji, ko ka zabi “A’a” idan ba shi da shi tukuna. | ☐ | |
| `birthDateFuture` | That date of birth is in the future. Check the year. | Ranar haihuwar tana gaba a lokaci. Ka duba shekarar. | ☐ | |
| `birthDateTooOld` | That date of birth is before 1900. Check the year. | Ranar haihuwar kafin shekarar 1900 ce. Ka duba shekarar. | ☐ | |
| `birthDateMalformed` | Enter the date of birth as a day, month and year. | Ka rubuta ranar haihuwa da rana, wata da shekara. | ☐ | |
| `emailIncomplete` | That email address does not look complete. Correct it, or leave it blank. | Adireshin imel din bai cika ba. Ka gyara shi, ko ka bar shi babu komai. | ☐ | |
| `deviceNotRegistered` | This device is not registered to your agent account. Register it before collecting revenue. | Ba a yi rajistar wannan na’ura ga asusun wakilcin ka ba. Ka yi rajistar ta kafin ka karbi haraji. | ☐ | |
| `deviceAfterApproval` | You can register a device once PSIRS has approved your application. | Za ka iya yin rajistar na’ura bayan PSIRS ta amince da bukatarka. | ☐ | |
| `errPaymentUnconfirmed` | The payment could not be confirmed yet. The money has NOT been marked as received. Do not ask the taxpayer to pay again — check this transaction again in a few minutes. | Ba a iya tabbatar da biyan kudin ba tukuna. BA a rubuta cewa an karbi kudin ba. Kada ka ce wa mai biyan haraji ya sake biya — ka sake duba wannan ma’amala bayan wasu mintuna. | ☐ | |
| `errPaymentPendingReconciliation` | The payment has been received but is waiting for settlement. Do not collect again. The receipt is issued as soon as the government account has the money. | An karbi kudin amma ana jiran a sasanta shi. Kada ka sake karba. Za a bayar da rasit da zarar kudin ya isa asusun gwamnati. | ☐ | |
| `errPaymentFailed` | The payment did not go through. No money has been taken from the taxpayer. You can start it again. | Biyan kudin bai yi nasara ba. Ba a karbi kudi daga mai biyan haraji ba. Kana iya sake farawa. | ☐ | |
| `errAgentNotCleared` | You are not yet cleared to collect revenue. Your application must be completed and approved first. | Ba a ba ka izinin karbar haraji ba tukuna. Dole a kammala bukatarka a kuma amince da ita. | ☐ | |
| `errDeviceNotRegistered` | This device is not registered to your account. Register it before you collect anything. | Ba a yi rajistar wannan na’ura a asusunka ba. Ka yi rajistarta kafin ka karbi komai. | ☐ | |
| `errUpdateRequired` | This version of the app is too old to collect with. Update it first. | Wannan manhajar ta tsufa, ba za ka iya karba da ita ba. Ka sabunta ta tukuna. | ☐ | |
| `errNetwork` | Could not reach PSIRS. Try again. | Ba a iya samun PSIRS ba. Ka sake gwadawa. | ☐ | |
| `moneyNotDebited` | No money has been taken from the taxpayer. | Ba a karbi kudi daga mai biyan haraji ba. | ☐ | |
| `moneyUnconfirmed` | The payment has NOT been confirmed. Do not collect again. | BA a tabbatar da biyan kudin ba. Kada ka sake karba. | ☐ | |
| `moneyReceived` | The money has been received. | An karbi kudin. | ☐ | |
| `homePendingBody` | These are not yet confirmed. Do not ask the taxpayer to pay again — open the transaction to check its status. | Ba a tabbatar da wadannan ba tukuna. Kada ka sake ce wa mai biyan haraji ya biya — ka bude ma’amalar don duba matsayinta. | ☐ | |
| `appCannotCollectUntil` | You cannot collect revenue until every requirement below is complete. | Ba za ka iya karbar haraji ba sai an kammala dukkan sharudan da ke kasa. | ☐ | |
| `appDeviceOnlyRegistered` | Revenue can only be collected from a device that PSIRS has registered to you. | Ba za a iya karbar haraji ba sai daga na’urar da PSIRS ta yi wa rajista da sunanka. | ☐ | |
| `appBankHint` | Verified before any commission can be paid. Government revenue never enters this account. | An tabbatar kafin a biya kowane kwamishan. Kudin gwamnati ba ya shiga wannan asusun ko kadan. | ☐ | |
| `authRevenueNeverToAgent` | Government revenue is never paid into an agent’s account. This account is used only to pay the commission you earn. | Ba a taba biyan kudin gwamnati cikin asusun wakili ba. Ana amfani da wannan asusun ne kawai domin biyan kwamishan da ka samu. | ☐ | |
| `tpSavedOfflineBody` | This registration is stored on your phone and will be sent automatically when you are back online. No TIN has been issued yet, and no payment can be taken until it is sent. | An adana wannan rajistar a wayarka kuma za a tura ta ta atomatik idan ka dawo kan layi. Ba a bayar da TIN ba tukuna, kuma ba za a iya karbar kudi ba sai an tura ta. | ☐ | |
| `tpNotYetSent` | Not yet sent to PSIRS | Ba a tura zuwa PSIRS ba tukuna | ☐ | |
| `tpConsent` | The taxpayer consents to their information being used by PSIRS for revenue administration. | Mai biyan haraji ya yarda a yi amfani da bayanansa ta PSIRS domin gudanar da harkokin haraji. | ☐ | |
| `tpDeclaration` | The taxpayer declares that the information given is true and correct. | Mai biyan haraji ya bayyana cewa bayanan da aka bayar gaskiya ne kuma daidai. | ☐ | |
| `tpTinPending` | The TIN service has not returned a number yet. It will appear on the taxpayer’s profile once assigned. | Sashen TIN bai dawo da lamba ba tukuna. Za ta bayyana a bayanan mai biyan haraji da zarar an ba shi. | ☐ | |
| `allocOfflineBody` | PSIRS could not be reached, so this collection has not been recorded. Do not hand anything over until it has been. | Ba a iya samun PSIRS ba, don haka ba a rubuta wannan karban ba. Kada ka mika komai sai an rubuta shi. | ☐ | |
| `allocFailed` | The collection could not be recorded. Try again. | Ba a iya rubuta karban ba. Ka sake gwadawa. | ☐ | |
| `verifyCouldNotReach` | PSIRS could not be reached, so this receipt could not be checked. | Ba a iya samun PSIRS ba, don haka ba a iya duba wannan rasit ba. | ☐ | |
| `verifyNotAReceiptCode` | That QR code is not a PSIRS verification code. Keep the receipt in frame. | Wannan QR code ba lambar tantancewa ta PSIRS ba ce. Ka rike rasit a cikin firam. | ☐ | |
| `verifyOfflineBody` | A receipt can only be checked against PSIRS, so this needs a connection. You can still scan the code and check it when you are back online. | Ba za a iya duba rasit ba sai ta PSIRS, don haka wannan yana bukatar hanyar sadarwa. Za ka iya duba lambar sannan ka tantance ta idan ka dawo kan layi. | ☐ | |
| `grpNoAssessmentBody` | Registering a group records that it exists. Nobody is charged anything, and no member is added, until an officer has approved it. | Yin rajistar kungiya yana nuna cewa tana nan. Ba a caji kowa komai ba, kuma ba a kara wani mamba ba, sai jami’i ya amince da ita. | ☐ | |
| `grpAskLeaderHint` | You are paid commission on what these members pay, so your word that somebody belongs is not enough on its own. The group’s own leader confirms the list. | Ana biyan ka kwamishan a kan abin da wadannan mambobin suka biya, don haka maganarka kadai cewa wani na cikinsu ba ta isa ba. Shugaban kungiyar da kansa ne ke tabbatar da jerin. | ☐ | |
| `moreCommissionOnlyVerified` | Commission is paid only into an account PSIRS has confirmed with the bank, and only after an officer approves the change. Your existing account keeps being used until then. | Ana biyan kwamishan ne kawai cikin asusun da PSIRS ta tabbatar da banki, kuma bayan jami’i ya amince da canjin. Za a ci gaba da amfani da asusunka na yanzu har lokacin. | ☐ | |
| `moreVehicleSavedBody` | This vehicle is stored on your phone and will be sent to PSIRS automatically when you are back online. The vehicle authority has not been checked yet, and no renewal or payment can be started until it is sent. | An adana wannan motar a wayarka kuma za a tura ta zuwa PSIRS ta atomatik idan ka dawo kan layi. Ba a duba hukumar motoci ba tukuna, kuma ba za a iya fara sabuntawa ko biyan kudi ba sai an tura ta. | ☐ | |
| `moreVehicleCaptureBody` | Record what you can see on the vehicle. It will be sent — and checked against the authority — as soon as you are online. You cannot take a payment for a renewal until then. | Ka rubuta abin da ka gani a kan motar. Za a tura shi — a kuma duba shi da hukumar — da zarar ka dawo kan layi. Ba za ka iya karbar kudin sabuntawa ba sai lokacin. | ☐ | |
| `moreBankMustConfirm` | PSIRS cannot approve a change until the bank confirms the account belongs to you. If the details are wrong, ask your supervisor to refuse this request so you can send the right ones. | PSIRS ba za ta iya amincewa da canji ba sai banki ya tabbatar cewa asusun naka ne. Idan bayanan ba daidai ba ne, ka nemi shugabanka ya ki wannan bukatar domin ka tura wadanda suka dace. | ☐ | |
| `colInvoiceNoReference` | Start the payment first if they want to pay at a bank: the reference a bank asks for is issued then, and the invoice does not carry it. | Ka fara biyan kudin idan suna son biya a banki: lambar da banki ke nema ana bayar da ita a lokacin, kuma takardar biya ba ta dauke da ita ba. | ☐ | |
| `pubVerdictValid` | VALID | INGANTACCE | ☐ | |
| `pubVerdictAcknowledgement` | VALID — NOT A RECEIPT | INGANTACCE — BA RASIT BA NE | ☐ | |
| `pubVerdictReversed` | REVERSED | AN JUYAR DA SHI | ☐ | |
| `pubVerdictNotFound` | NOT FOUND | BA A SAMU BA | ☐ | |
| `pubVerdictInvalid` | INVALID | BA INGANTACCE BA | ☐ | |
| `verifyReceiptFingerprintMismatch` | A receipt with this number exists, but the stored document does not match its original fingerprint. Treat the document you were given as unverified and report it to PSIRS. | Akwai rasit mai wannan lamba, amma takardar da aka adana ba ta yi daidai da asalin sa ba. Ka dauki takardar da aka ba ka a matsayin wadda ba a tabbatar ba, kuma ka sanar da PSIRS. | ☐ | |
| `verifyReceiptReversed` | This receipt was issued but the payment has since been reversed or refunded. It is no longer valid evidence of payment. | An bayar da wannan rasit amma an juyar da biyan kudin ko an mayar da shi tun daga nan. Ba ya kara zama shaidar biya. | ☐ | |
| `verifyReceiptVoided` | This receipt has been voided and is not valid. | An soke wannan rasit kuma ba ya aiki. | ☐ | |
| `verifyReceiptGenuine` | This is a genuine government receipt issued by PSIRS. | Wannan rasit na gwamnati ne na gaskiya wanda PSIRS ta bayar. | ☐ | |
| `verifyReceiptGenuineUnchecked` | This is a genuine government receipt issued by PSIRS. The stored copy could not be checked just now, so its fingerprint has not been confirmed on this attempt. | Wannan rasit na gwamnati ne na gaskiya wanda PSIRS ta bayar. Ba a iya duba kwafin da aka adana a yanzu ba, don haka ba a tabbatar da asalin sa a wannan yunkurin ba. | ☐ | |
| `verifyNotFound` | No government document matches that number or code. If you were given a receipt bearing this number, it was not issued by PSIRS. | Babu takardar gwamnati da ta yi daidai da wannan lamba ko lambar tabbatarwa. Idan an ba ka rasit mai wannan lamba, ba PSIRS ce ta bayar da shi ba. | ☐ | |
| `verifyPaymentReversed` | This payment was reversed and the money is being returned to the payer, so no government receipt was issued for it. The document is no longer valid evidence of payment. If you have not received the money, contact PSIRS with this number. | An juyar da wannan biyan kudin kuma ana mayar da kudin ga wanda ya biya, don haka ba a bayar da rasitin gwamnati a kansa ba. Takardar ba ta kara zama shaidar biya. Idan ba ka karbi kudin ba, ka tuntubi PSIRS da wannan lamba. | ☐ | |
| `verifyDocumentRevoked` | This document has been revoked and is no longer valid. | An soke wannan takardar kuma ba ta kara aiki. | ☐ | |
| `verifyDocumentFingerprintMismatch` | The stored document does not match its original fingerprint. Report this to PSIRS. | Takardar da aka adana ba ta yi daidai da asalin sa ba. Ka sanar da PSIRS. | ☐ | |
| `verifyAcknowledgementNotReceipt` | This is a genuine PSIRS acknowledgement of payment, and it is NOT a government receipt. The payment system has confirmed the payment; the money has not yet reached the government account. A receipt is issued automatically once it does, and can be checked here in the same way. | Wannan tabbacin karbar kudi ne na gaskiya daga PSIRS, kuma BA rasitin gwamnati ba ne. Tsarin biyan kudi ya tabbatar da biyan; kudin bai kai asusun gwamnati ba tukuna. Ana bayar da rasit ta atomatik da zarar ya kai, kuma ana iya duba shi a nan haka nan. | ☐ | |
| `verifyDocumentExpired` | This document expired on {{date}}. | Wannan takardar ta kare a {{date}}. | ☐ | |
| `verifyDocumentGenuine` | This is a genuine government document issued by PSIRS. | Wannan takardar gwamnati ce ta gaskiya wadda PSIRS ta bayar. | ☐ | |
| `verifyDocumentGenuineUnchecked` | This is a genuine government document issued by PSIRS. The stored copy could not be checked just now, so its fingerprint has not been confirmed on this attempt. | Wannan takardar gwamnati ce ta gaskiya wadda PSIRS ta bayar. Ba a iya duba kwafin da aka adana a yanzu ba, don haka ba a tabbatar da asalin sa a wannan yunkurin ba. | ☐ | |

### B · The rest of the dictionary, by screen

3151 strings, grouped by where an agent meets them. Lower stakes
than table A — these are labels, headings and status words rather than
instructions — but they are what an agent reads all day.

#### The officer portal — navigation

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcNavArrears` | Arrears worklist | Jerin bashin da ake bin jiha | ☐ | |
| `ofcNavEnumeration` | Enumeration queues | Jerin aikin kidayar | ☐ | |
| `ofcNavPresumptive` | Presumptive schedule | Jadawalin haraji na kimantawa | ☐ | |
| `ofcNavPayroll` | Employers and premises | Masu daukar ma’aikata da wurare | ☐ | |
| `ofcNavConnections` | Assets and leads | Dukiya da alamu | ☐ | |
| `ofcNavInbox` | Inbox | Akwatin sako | ☐ | |
| `ofcNavMyAccess` | Where I am signed in | Inda na shiga | ☐ | |
| `ofcNavDashboard` | Collections dashboard | Allon karban haraji | ☐ | |
| `ofcNavIntelligence` | Revenue intelligence | Nazarin haraji | ☐ | |
| `ofcNavRevenue` | Revenue summary | Takaitaccen haraji | ☐ | |
| `ofcNavLevies` | Levies & categories | Haraji da rukunoni | ☐ | |
| `ofcNavTransactions` | Transactions | Ma’amaloli | ☐ | |
| `ofcNavAgents` | Agents & clearance | Wakilai da izini | ☐ | |
| `ofcNavReferees` | Referees | Masu shaida | ☐ | |
| `ofcNavPerformance` | Agent performance | Aikin wakilai | ☐ | |
| `ofcNavReconciliation` | Reconciliation | Daidaita lissafi | ☐ | |
| `ofcNavCommissions` | Commissions | Kwamishan | ☐ | |
| `ofcNavApprovals` | Approvals | Amincewa | ☐ | |
| `ofcNavFraud` | Fraud & leakage | Zamba da yoyon kudi | ☐ | |
| `ofcNavSupport` | Support desk | Sashen taimako | ☐ | |
| `ofcNavOutstanding` | Outstanding work | Aikin da ya rage | ☐ | |
| `ofcNavAudit` | Audit log | Rajistar bincike | ☐ | |
| `ofcNavUsage` | Product usage | Amfani da manhaja | ☐ | |
| `ofcNavCatalogue` | Revenue catalogue | Jerin harajin | ☐ | |
| `ofcNavProgrammes` | Social incentives | Tallafin jama’a | ☐ | |
| `ofcNavGroups` | Groups & cooperatives | Kungiyoyi da hadin kai | ☐ | |
| `ofcNavTaxpayerRecords` | Taxpayer corrections | Gyaran bayanan mai biyan haraji | ☐ | |
| `ofcNavUsers` | Officer access | Izinin jami’ai | ☐ | |
| `ofcNavFieldApp` | Field application | Manhajar filin aiki | ☐ | |
| `ofcNavAllocations` | Distribution rounds | Zagayen rabon kaya | ☐ | |
| `ofcNavMyWork` | My work | Aikina | ☐ | |
| `ofcNavCases` | Cases | Kararraki | ☐ | |
| `ofcNavRoles` | Roles & permissions | Matsayi da izini | ☐ | |
| `ofcNavPeriods` | Financial periods | Lokutan kudi | ☐ | |
| `ofcNavWorkbench` | Audit workbench | Teburin bincike | ☐ | |
| `ofcNavOrganisation` | Departments & offices | Sassa da ofisoshi | ☐ | |
| `ofcNavTaxpayerAnalytics` | Taxpayer base | Masu biyan haraji | ☐ | |
| `ofcNavTargets` | Targets & forecast | Manufura da hasashe | ☐ | |

#### The officer portal — menu headings

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcGroupYourDesk` | Your desk | Teburinka | ☐ | |
| `ofcGroupAdministration` | Administration | Gudanarwa | ☐ | |
| `ofcGroupAgentsProgrammes` | Agents and programmes | Wakilai da shirye-shirye | ☐ | |
| `ofcGroupAssessment` | Assessment | Kima | ☐ | |
| `ofcGroupConfiguration` | Configuration | Saituna | ☐ | |
| `ofcGroupEverything` | Everything you may open | Duk abin da za ka iya budewa | ☐ | |
| `ofcGroupExamination` | Examination | Bincike | ☐ | |
| `ofcGroupMyTerritory` | My territory | Yankina | ☐ | |
| `ofcGroupOversight` | Oversight | Sa ido | ☐ | |
| `ofcGroupRevenueHere` | Revenue here | Harajin nan | ☐ | |
| `ofcGroupRevenue` | Revenue | Haraji | ☐ | |
| `ofcGroupSettlement` | Settlement | Tura kudi | ☐ | |
| `ofcGroupTheMoney` | The money | Kudin | ☐ | |
| `ofcGroupTheRegister` | The register | Rajistar | ☐ | |
| `ofcGroupWhatCharged` | What was charged | Abin da aka caje | ☐ | |
| `ofcGroupWhoCollected` | Who collected it | Wanda ya karba | ☐ | |
| `ofcGroupWhoDidIt` | Who did it | Wanda ya yi | ☐ | |

#### The officer portal — signing in

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcLoginTitle` | PSIRS Revenue Portal | Shafin Harajin PSIRS | ☐ | |
| `ofcLoginPhone` | Phone number | Lambar waya | ☐ | |
| `ofcLoginPassword` | Password | Kalmar sirri | ☐ | |
| `ofcLoginMonitored` | Access is monitored. Every action you take is recorded in the audit log. | Ana sa ido kan shiga. Ana rubuta duk abin da ka yi a rajistar bincike. | ☐ | |
| `ofcLoginWrongPlace` | Your account belongs to the agent app | Asusunka na manhajar wakilai ne | ☐ | |
| `ofcLoginSignInWorked` | Your sign-in worked — you are simply in the wrong place. | Shigarka ta yi aiki — kawai ba wurin da ya dace ba ne. | ☐ | |
| `ofcLoginUseAgentApp` | Field agents collect revenue in the PSIRS agent app, which works offline and holds your taxpayers, assessments and commission. This portal is for revenue, finance and oversight officers. | Wakilan filin aiki suna karbar haraji a manhajar wakilai ta PSIRS, wadda ke aiki ba tare da layi ba kuma tana rike da masu biyan harajinka, kimarka da kwamishan dinka. Wannan shafin na jami’an haraji, kudi da sa ido ne. | ☐ | |

#### The officer portal — the home screen per role

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcRhAdministrationFor` | Administration — {{name}} | Gudanarwa — {{name}} | ☐ | |
| `ofcRhSignedIn` | signed in | wanda ya shiga | ☐ | |
| `ofcRhAgentApproved` | {{name}} approved. | An amince da {{name}}. | ☐ | |
| `ofcRhBlockedCount` | {{n}} thing(s) are stopping somebody working | Abubuwa {{n}} na hana wani yin aiki | ☐ | |
| `ofcRhInvoicesStillOpen` | {{n}} invoice(s) still open | Takardun biya {{n}} na nan a bude | ☐ | |
| `ofcRhNothingWaiting` | Nothing is waiting. | Babu abin da ke jira. | ☐ | |
| `ofcRhActiveRecords` | Active records | Rikodin da ke aiki | ☐ | |
| `ofcRhRegisteredByBoth` | Registered by agents and officers | Wakilai da jami’ai suka yi wa rajista | ☐ | |
| `ofcRhTinNoTracking` | A taxpayer without one cannot be tracked across years | Ba za a iya bin diddigin mai biyan haraji da babu shi ba tsawon shekaru | ☐ | |
| `ofcRhCollectedForCouncils` | Collected on their behalf, not the state’s own | An karba a madadinsu, ba na jihar kanta ba | ☐ | |
| `ofcRhAccruedNotPaid` | Accrued and not yet paid | An tara kuma ba a biya ba tukuna | ☐ | |
| `ofcRhExpectedLessReceived` | Expected less received, on unreconciled settlements | Abin da ake tsammani ban da abin da aka karba, kan turawar da ba a daidaita ba | ☐ | |
| `ofcRhBankPlatformDisagree` | The bank and the platform disagree | Banki da dandalin sun sabawa juna | ☐ | |
| `ofcRhHashChainedShort` | Hash-chained, append-only | An sarkafa, ba a share komai | ☐ | |
| `ofcRhEntriesSinceMidnight` | Entries since midnight | Shigarwa tun tsakar dare | ☐ | |
| `ofcRhRaisedNotReviewed` | Raised and not yet reviewed | An daga kuma ba a duba ba tukuna | ☐ | |
| `ofcRhAgentsAwaitingClearance` | Agents awaiting clearance | Wakilan da ke jiran izini | ☐ | |
| `ofcRhApplicationsComplete` | Applications complete and waiting on a decision | Bukatun sun cika kuma suna jiran shawara | ☐ | |
| `ofcRhAgentsAskedForMore` | Agents asked for more | An nemi wakilai karin bayani | ☐ | |
| `ofcRhWaitingOnApplicant` | Waiting on the applicant, not on you | Ana jiran mai nema, ba kai ba | ☐ | |
| `ofcRhDevicesAwaitingApproval` | Devices awaiting approval | Na’urorin da ke jiran amincewa | ☐ | |
| `ofcRhAgentNeedsHandset` | An agent cannot collect until their handset is approved | Wakili ba zai iya karba ba sai an amince da wayarsa | ☐ | |
| `ofcRhSupervisorsNoTerritory` | Supervisors with no territory | Masu kula da babu yanki | ☐ | |
| `ofcRhNoFiguresUntilTerritory` | They see no revenue figures at all until one is assigned | Ba sa ganin adadin haraji ko kadan sai an ba su yanki | ☐ | |
| `ofcRhItemsNoRate` | Revenue items with no rate | Nau’in harajin da babu kudinsu | ☐ | |
| `ofcRhNotCollectableYet` | Catalogued and not collectable until government sets the amount | An jera su kuma ba a iya karbarsu ba sai gwamnati ta sanya adadin | ☐ | |
| `ofcRhMdasCollectingNothing` | MDAs collecting nothing | Ma’aikatun da ba sa karban komai | ☐ | |
| `ofcRhNoItemForMda` | No revenue item exists for them in this platform | Babu wani nau’in haraji a gare su a wannan dandalin | ☐ | |
| `ofcRhOfficersWithAccess` | Officers with access | Jami’an da ke da izinin shiga | ☐ | |
| `ofcRhExcludingFieldAgents` | Excluding field agents | Ban da wakilan filin aiki | ☐ | |
| `ofcRhSupportTicketsOpen` | Support tickets open | Rahotannin taimako a bude | ☐ | |
| `ofcRhRaisedByAgents` | Raised by agents in the field | Wakilai a filin aiki suka kai su | ☐ | |
| `ofcRhTinApplicationsFailed` | TIN applications failed | Bukatun TIN da suka gaza | ☐ | |
| `ofcRhRegisterRefusedThese` | The register refused these — they need a person | Rajistar ta ki wadannan — suna bukatar mutum | ☐ | |
| `ofcRhAppliedNotIssued` | Applied for and not yet issued | An nema kuma ba a bayar ba tukuna | ☐ | |
| `ofcRhCorrectionsAwaiting` | Corrections awaiting review | Gyare-gyaren da ke jiran dubawa | ☐ | |
| `ofcRhSomeoneAskedChange` | Someone has asked to change who a record says they are | Wani ya nemi a canza wanda rikodin ya ce shi ne | ☐ | |
| `ofcRhInvoicesUnpaid` | Invoices unpaid | Takardun biya da ba a biya ba | ☐ | |
| `ofcRhRaisedStillOpen` | Raised and still open | An yi su kuma suna nan a bude | ☐ | |
| `ofcRhInvoicesExpired` | Invoices expired | Takardun biya da suka kare | ☐ | |
| `ofcRhNeverPaidOutOfTime` | Never paid and now out of time | Ba a taba biyan su ba kuma lokacinsu ya kare | ☐ | |
| `ofcRhRegisteredThisWeek` | Registered this week | An yi rajista wannan makon | ☐ | |
| `ofcRhNewTaxpayers` | New taxpayers on the register | Sabbin masu biyan haraji a rajistar | ☐ | |
| `ofcRhTaxpayersOnRegister` | Taxpayers on the register | Masu biyan haraji a rajistar | ☐ | |
| `ofcRhReconciliationExceptions` | Reconciliation exceptions | Kura-kuran daidaita lissafi | ☐ | |
| `ofcRhDisagreeAboutThese` | The bank and the platform disagree about these | Banki da dandalin sun sabawa juna kan wadannan | ☐ | |
| `ofcRhSettlementsUnreconciled` | Settlements unreconciled | Turawar da ba a daidaita ba | ☐ | |
| `ofcRhReceivedNotMatched` | Money received and not yet matched | An karbi kudi kuma ba a dace da shi ba tukuna | ☐ | |
| `ofcRhPayoutsToApprove` | Commission payouts to approve | Biyan kwamishan da za a amince da su | ☐ | |
| `ofcRhAgentsWaitingShort` | Agents are waiting on these | Wakilai na jiran wadannan | ☐ | |
| `ofcRhRefundsOwed` | Refunds a taxpayer is still owed | Mayarwar da ake bin mai biyan haraji | ☐ | |
| `ofcRhMoneyStateShouldNotHave` | Money the state has and should not | Kudin da jiha ke da shi kuma bai kamata ba | ☐ | |
| `ofcRhMoneyBackOutQuery` | Money that came back out — the query worth running first | Kudin da ya sake fita — tambayar da ta cancanci a fara yi | ☐ | |
| `ofcRhActionsRefusedWeek` | Actions refused this week | Ayyukan da aka ki wannan makon | ☐ | |
| `ofcRhSomeoneTriedNotPermitted` | Someone tried something their role does not permit | Wani ya gwada abin da matsayinsa bai ba shi izini ba | ☐ | |
| `ofcRhRateChangesMonth` | Rate changes this month | Canjin kudin haraji wannan watan | ☐ | |
| `ofcRhEveryChangeCharged` | Every change to what a citizen is charged | Kowane canji ga abin da ake caji dan kasa | ☐ | |
| `ofcRhReceiptsCheckedPublic` | Receipts checked by the public | Rasit din da jama’a suka duba | ☐ | |
| `ofcRhVerificationLookups` | Verification page lookups | Binciken shafin tantancewa | ☐ | |
| `ofcRhAuditEntriesToday` | Audit entries today | Shigarwar bincike na yau | ☐ | |
| `ofcRhHashChainedLong` | Hash-chained and append-only | An sarkafa kuma ba a share komai | ☐ | |
| `ofcRhAuditEntriesTotal` | Audit entries in total | Jimlar shigarwar bincike | ☐ | |
| `ofcRhSincePlatformStarted` | Since the platform started | Tun lokacin da dandalin ya fara | ☐ | |
| `ofcRhTaxpayersOnRecord` | Taxpayers on record | Masu biyan haraji a rikodi | ☐ | |
| `ofcRhWaiting` | Waiting | Ana jira | ☐ | |
| `ofcRhAgent` | Agent | Wakili | ☐ | |
| `ofcRhWaitingSince` | Waiting since | Yana jira tun | ☐ | |
| `ofcRhApprovedFromHome` | Approved from the administrator home screen. | An amince daga shafin farko na mai gudanarwa. | ☐ | |
| `ofcRhRegistered` | Registered | An yi rajista | ☐ | |
| `ofcRhOfficer` | Officer | Jami’i | ☐ | |
| `ofcRhWhyFailed` | Why it failed | Dalilin da ya sa ya gaza | ☐ | |
| `ofcRhExpires` | Expires | Zai kare | ☐ | |
| `ofcRhKind` | Kind | Nau’i | ☐ | |
| `ofcRhExpected` | Expected | Ana tsammani | ☐ | |
| `ofcRhReceived` | Received | An karba | ☐ | |
| `ofcRhRaisedHeading` | Raised | An daga | ☐ | |
| `ofcRhRequested` | Requested | An nema | ☐ | |
| `ofcRhWhen` | When | Yaushe | ☐ | |
| `ofcRhRole` | Role | Matsayi | ☐ | |
| `ofcRhAttempted` | Attempted | An yi kokari | ☐ | |
| `ofcRhAgainst` | Against | A kan | ☐ | |
| `ofcRhOutcome` | Outcome | Sakamako | ☐ | |
| `ofcRhToday` | Today | Yau | ☐ | |
| `ofcRhNewThisWeek` | New this week | Sabbin wannan makon | ☐ | |
| `ofcRhOpen` | Open | A bude | ☐ | |
| `ofcRhOpenFile` | Open file | Bude fayil | ☐ | |
| `ofcRhApprove` | Approve | Amince | ☐ | |
| `ofcRhTaxpayers` | Taxpayers | Masu biyan haraji | ☐ | |
| `ofcRhExceptions` | Exceptions | Kura-kurai | ☐ | |
| `ofcRhAuditEntries` | Audit entries | Shigarwar bincike | ☐ | |
| `ofcRhAgentsWaiting` | Agents waiting on a decision | Wakilan da ke jiran shawara | ☐ | |
| `ofcRhAgentsWaitingBody` | Agents are waiting on these. Approving needs a fresh code, because it is the action that moves money out. | Wakilai na jiran wadannan. Amincewa yana bukatar sabuwar lamba, domin shi ne aikin da ke fitar da kudi. | ☐ | |
| `ofcRhClearanceBody` | Approving here does what the clearance screen does — same endpoint, same audit entry. Asking for more information needs a reason, so that one opens the file. | Amincewa a nan yana yin abin da shafin izini ke yi — hanya daya, shigarwar bincike daya. Neman karin bayani yana bukatar dalili, don haka wannan yana bude fayil. | ☐ | |
| `ofcRhHandsetsWaiting` | Handsets waiting for approval | Na’urorin da ke jiran amincewa | ☐ | |
| `ofcRhHandsetsBody` | A cleared agent still cannot collect until the device in their hand is approved. | Wakilin da aka bai wa izini ba zai iya karba ba sai an amince da na’urar da ke hannunsa. | ☐ | |
| `ofcRhCommissionPayouts` | Commission payouts requested | Bukatun biyan kwamishan | ☐ | |
| `ofcRhCommissionLiability` | Commission liability | Bashin kwamishan | ☐ | |
| `ofcRhAssessedUnpaid` | Assessed and unpaid | An kima kuma ba a biya ba | ☐ | |
| `ofcRhTinsOutstanding` | TINs outstanding | TIN da suka rage | ☐ | |
| `ofcRhTinsBody` | These taxpayers exist and have no TIN, so nothing can follow them across years. Re-asking is safe: the platform sends the same application, and a TIN already issued comes back rather than a second one being made. | Wadannan masu biyan haraji suna nan kuma babu TIN, don haka ba abin da zai bi su tsawon shekaru. Sake nema ba shi da hadari: dandalin yana tura bukata iri daya, kuma TIN da aka riga aka bayar shi ke dawowa maimakon a yi na biyu. | ☐ | |
| `ofcRhTinRefused` | TIN applications the register refused | Bukatun TIN da rajistar ta ki | ☐ | |
| `ofcRhTheRegister` | The taxpayer register | Rajistar masu biyan haraji | ☐ | |
| `ofcRhRegisterBody` | Who is on it, who is missing a TIN, and what has been assessed and not paid. | Wanda ke cikinta, wanda babu TIN, da abin da aka kima kuma ba a biya ba. | ☐ | |
| `ofcRhMoneyInOut` | Money in, money out, money held | Kudin shiga, kudin fita, kudin da aka rike | ☐ | |
| `ofcRhMoneyBody` | Reconciliation, settlement and what the state owes — to its agents, to taxpayers owed a refund, and to the Councils it collects for. | Daidaita lissafi, tura kudi da abin da jiha ke bin bashi — ga wakilanta, ga masu biyan haraji da ake bin su mayarwa, da ga Kananan Hukumomin da take karbar haraji domin su. | ☐ | |
| `ofcRhOwedToCouncils` | Owed to the Councils | Ana bin Kananan Hukumomi | ☐ | |
| `ofcRhSettlementVariance` | Settlement variance | Bambancin tura kudi | ☐ | |
| `ofcRhBankDisagree` | Where the bank and the platform disagree | Inda banki da dandalin suka sabawa juna | ☐ | |
| `ofcRhReconciliationOpen` | Reconciliation exceptions are open | Akwai kura-kuran daidaita lissafi a bude | ☐ | |
| `ofcRhReconciliationBody` | Until these are resolved the platform’s figures and the bank’s do not agree, and commission on the affected collections stays held. | Har sai an warware wadannan, adadin dandalin da na banki ba za su yi daidai ba, kuma ana rike kwamishan kan karbar da abin ya shafa. | ☐ | |
| `ofcRhExceptionQueueBody` | Resolving an exception is a judgement with a note attached, so it happens on the reconciliation screen where there is room to write one. This is what is waiting. | Warware kuskure shawara ce mai dauke da bayani, don haka ana yin sa a shafin daidaita lissafi inda akwai wurin rubutu. Wannan shi ne abin da ke jira. | ☐ | |
| `ofcRhWorkExceptionQueue` | Work the exception queue | Yi aiki kan jerin kura-kurai | ☐ | |
| `ofcRhReversedRefunded` | Reversed or refunded | An juyar ko an mayar | ☐ | |
| `ofcRhMoneyBackOut` | Money that came back out | Kudin da ya sake fita | ☐ | |
| `ofcRhReversedBody` | Reversed or refunded after the fact. The first query worth running on any revenue platform. | An juyar ko an mayar bayan an gama. Tambaya ta farko da ta cancanci yi a kowane dandalin haraji. | ☐ | |
| `ofcRhFraudOpen` | Fraud flags open | Alamun zamba a bude | ☐ | |
| `ofcRhInvoicesExpiring` | Invoices about to expire | Takardun biya da za su kare | ☐ | |
| `ofcRhInvoicesBody` | Raised, unpaid, and out of time within the week. After that the assessment has to be raised again. | An yi su, ba a biya ba, kuma lokacinsu zai kare cikin makon. Bayan haka sai an sake yin kimar. | ☐ | |
| `ofcRhRefusedActions` | Actions the platform refused | Ayyukan da dandalin ya ki | ☐ | |
| `ofcRhRefusedBody` | Somebody attempted something their role does not permit. Each is an audit entry in its own right. | Wani ya yi kokarin abin da matsayinsa bai ba shi izini ba. Kowanne shigarwar bincike ce a kanta. | ☐ | |
| `ofcRhSupervisorsNothing` | Supervisors covering nothing | Masu kula da babu yankin da suke kula | ☐ | |
| `ofcRhSupervisorsBody` | They see no revenue figures at all until a territory is assigned. Choosing which needs the picker, so this one opens Officer access. | Ba sa ganin adadin haraji ko kadan sai an ba su yanki. Zabar wanne yana bukatar mai zabi, don haka wannan yana bude Izinin jami’ai. | ☐ | |
| `ofcRhAssignTerritories` | Assign territories | Ba da yankuna | ☐ | |
| `ofcRhWhatToExamine` | What there is to examine | Abin da ake da shi don bincike | ☐ | |
| `ofcRhReadOnlyBody` | Read-only, by role and by design. Nothing on this screen changes a record — every figure is a starting point for a query, and the audit log itself is hash-chained and append-only. | Karatu kawai, ta matsayi kuma da gangan. Babu abin da ke kan wannan shafin da ke canza rikodi — kowane adadi mafarin bincike ne, kuma rajistar bincike da kanta an sarkafa ta kuma ba a share komai a cikinta. | ☐ | |
| `ofcRhAdminBody` | An agent without clearance or an approved device cannot collect, and a supervisor with no territory sees no figures at all. | Wakilin da babu izini ko na’urar da aka amince da ita ba zai iya karba ba, kuma mai kula da babu yanki ba ya ganin komai. | ☐ | |
| `ofcRhAdminIntro` | What is waiting on an administrator. Collections and revenue analysis are on the dashboard and the revenue summary; this screen is the platform itself. | Abin da ke jiran mai gudanarwa. Karban kudi da nazarin haraji suna kan allon aiki da takaitaccen haraji; wannan shafin dandalin da kansa ne. | ☐ | |
| `ofcRhInvoiceDocumentReady` | Invoice document ready for {{number}}. | Takardar biyan kudi {{number}} tana shirye. | ☐ | |
| `ofcRhPayoutApproved` | Payout {{reference}} approved. | An amince da biyan {{reference}}. | ☐ | |
| `ofcRhAskTheRegisterAgain` | Ask the register again | Sake tambayar rijistar | ☐ | |
| `ofcRhAsking` | Asking… | Ana tambaya… | ☐ | |
| `ofcRhDeviceApproved` | Device approved. | An amince da na’urar. | ☐ | |
| `ofcRhInvoiceDocument` | Invoice document | Takardar biyan kudi | ☐ | |
| `ofcRhPreparing` | Preparing… | Ana shirya… | ☐ | |
| `ofcRhReAskedTheTin` | Re-asked the TIN register for everyone still waiting. | An sake tambayar rijistar TIN game da duk wanda ke jira. | ☐ | |
| `ofcRhRemindersSentToTaxpayers` | Reminders sent to taxpayers with something due. | An aika tunatarwa ga masu biyan haraji da ke da abin biya. | ☐ | |
| `ofcRhSendPaymentReminders` | Send payment reminders | Aika tunatarwar biya | ☐ | |

#### The officer portal — agent clearance

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcAgRecordWhatYouFound` | Record what you found: it is the only record of why this flag was left open, upheld or set aside. | Ka rubuta abin da ka gano: shi ne kadai bayanin dalilin da ya sa aka bar wannan alamar a bude, aka tabbatar da ita, ko aka yi watsi da ita. | ☐ | |
| `ofcAgRiskFlagFor` | Risk flag — {{name}} | Alamar hadari — {{name}} | ☐ | |
| `ofcAgAwaitingGovernmentReview` | Awaiting government review | Na jiran nazarin gwamnati | ☐ | |
| `ofcAgApplicantsCompleted` | These applicants have completed identity verification and referee clearance. | Wadannan masu nema sun kammala tabbatar da shaida da izinin mai shaida. | ☐ | |
| `ofcAgAllAgents` | All agents | Dukkan wakilai | ☐ | |
| `ofcAgSixAxes` | Six independent status axes: an agent is only operational when every one is satisfied. | Matakan matsayi shida masu zaman kansu: wakili yana aiki ne kawai idan an cika kowanne. | ☐ | |
| `ofcAgOperationalStatus` | Operational status | Matsayin aiki | ☐ | |
| `ofcAgAll` | All | Duka | ☐ | |
| `ofcAgActive` | Active | Yana aiki | ☐ | |
| `ofcAgInactive` | Inactive | Ba ya aiki | ☐ | |
| `ofcAgSuspendedStatus` | Suspended | An dakatar | ☐ | |
| `ofcAgBackToAgents` | ← Back to agents | ← Koma ga wakilai | ☐ | |
| `ofcAgClearanceChecklist` | Clearance checklist | Jerin sharudan izini | ☐ | |
| `ofcAgEveryItemSatisfied` | Every item must be satisfied before activation. | Dole a cika kowane sharadi kafin a kunna. | ☐ | |
| `ofcAgNoKycSubmitted` | The applicant has not submitted identity verification. | Mai nema bai tura tabbatar da shaida ba. | ☐ | |
| `ofcAgRefereeHistoryKept` | A replaced referee stays on the record — the history is never overwritten. | Mai shaida da aka maye gurbinsa yana nan a rikodi — ba a taba share tarihin ba. | ☐ | |
| `ofcAgClear` | Clear | Ba da izini | ☐ | |
| `ofcAgReject` | Reject | Ki | ☐ | |
| `ofcAgDevices` | Devices | Na’urori | ☐ | |
| `ofcAgDevicesBody` | A phone an agent has just registered waits here as PENDING and cannot be used to collect until it is approved. Revoking a device ends its sessions immediately. | Wayar da wakili ya yi wa rajista tana jira a nan a matsayin ANA JIRA kuma ba za a iya karba da ita ba sai an amince da ita. Janye na’ura yana kawo karshen zamanta nan take. | ☐ | |
| `ofcAgSuspend` | Suspend | Dakatar | ☐ | |
| `ofcAgRestore` | Restore | Mayar | ☐ | |
| `ofcAgRevoke` | Revoke | Janye | ☐ | |
| `ofcAgDecision` | Decision | Shawara | ☐ | |
| `ofcAgDecisionRecorded` | Every decision is recorded against your name in the audit log and requires a reason. | Ana rubuta kowace shawara da sunanka a rajistar bincike kuma tana bukatar dalili. | ☐ | |
| `ofcAgReasonMinimum` | Reason (minimum 10 characters) | Dalili (akalla haruffa 10) | ☐ | |
| `ofcAgApproveApplication` | Approve application | Amince da bukata | ☐ | |
| `ofcAgRequestMoreInformation` | Request more information | Nemi karin bayani | ☐ | |
| `ofcAgAssignTerritory` | Assign territory | Ba da yanki | ☐ | |
| `ofcAgSelectTerritory` | Select a territory | Zabi yanki | ☐ | |
| `ofcAgTerritoryRequired` | Every transaction is attributed to a territory, so one must be assigned before activation. | Ana danganta kowace ma’amala ga yanki, don haka dole a ba da daya kafin a kunna. | ☐ | |
| `ofcAgActivateAgent` | Activate agent | Kunna wakili | ☐ | |
| `ofcAgActivationBlocked` | Activation is blocked until every clearance item is satisfied. An exception requires an approved government override. | An hana kunnawa har sai an cika kowane sharadin izini. Kebancewa yana bukatar izinin gwamnati na musamman. | ☐ | |
| `ofcAgMoveTerritory` | Move to another territory | Matsar zuwa wani yanki | ☐ | |
| `ofcAgMoveTerritoryBody` | Collections already made keep the territory they were collected under. This decides where the next ones are attributed. | Karban da aka riga aka yi yana rike da yankin da aka karba a ciki. Wannan yana yanke inda za a danganta na gaba. | ☐ | |
| `ofcAgReassignTerritory` | Reassign territory | Sake ba da yanki | ☐ | |
| `ofcAgSuspendAgent` | Suspend agent | Dakatar da wakili | ☐ | |
| `ofcAgClearanceHistory` | Clearance history | Tarihin izini | ☐ | |
| `ofcAgRefereeRiskFlags` | Referee risk flags | Alamun hadarin mai shaida | ☐ | |
| `ofcAgRefereeRiskBody` | Patterns that suggest a referee relationship is not genuine. Nothing is blocked while a flag is merely open — but a flag you uphold stops that referee being cleared until somebody dismisses it with their findings. | Alamun da ke nuna dangantakar mai shaida ba ta gaskiya ba ce. Ba a hana komai yayin da alama take a bude kawai — amma alamar da ka tabbatar tana hana a ba wa mai shaidan izini har sai wani ya soke ta da abin da ya gano. | ☐ | |
| `ofcAgWhatYouFound` | What you found | Abin da ka gano | ☐ | |
| `ofcAgLookingIntoIt` | Looking into it | Ana bincike | ☐ | |
| `ofcAgUpheld` | Upheld — this referee cannot be relied on | An tabbatar — ba za a iya dogara da wannan mai shaida ba | ☐ | |
| `ofcAgDismissed` | Dismissed — the pattern is innocent | An soke — alamar ba ta da laifi | ☐ | |
| `ofcAgRefereesMultiple` | Referees supporting more than one applicant | Masu shaida da ke goyon bayan mai nema fiye da daya | ☐ | |
| `ofcAgBankAccountChanges` | Bank account changes | Canjin asusun banki | ☐ | |
| `ofcAgBankChangeBody` | Where an agent’s commission is paid. Nothing moves until the bank confirms the new account and an officer other than the one who asked approves it. The account in use keeps being used until then. | Inda ake biyan kwamishan wakili. Babu abin da zai motsa sai banki ya tabbatar da sabon asusun kuma wani jami’i ban da wanda ya nema ya amince da shi. Za a ci gaba da amfani da asusun da ake amfani da shi har lokacin. | ☐ | |
| `ofcAgNoBankChanges` | No bank account changes are waiting. | Babu canjin asusun banki da ke jira. | ☐ | |
| `ofcAgAskBankAgain` | Ask the bank again | Sake tambayar banki | ☐ | |
| `ofcAgRefuse` | Refuse | Ki | ☐ | |
| `ofcAgApplicationsReceived` | Applications received | Bukatun da aka karba | ☐ | |
| `ofcAgReadyForReview` | Ready for review | A shirye don dubawa | ☐ | |
| `ofcAgBothCleared` | KYC and referee both cleared | An ba da izinin shaida da mai shaida | ☐ | |
| `ofcAgActiveAgents` | Active agents | Wakilan da ke aiki | ☐ | |
| `ofcAgKycPending` | KYC pending | Ana jiran shaida | ☐ | |
| `ofcAgAwaitingApplicant` | Awaiting applicant | Ana jiran mai nema | ☐ | |
| `ofcAgKycCleared` | KYC cleared | An ba da izinin shaida | ☐ | |
| `ofcAgRefereePending` | Referee pending | Ana jiran mai shaida | ☐ | |
| `ofcAgRefereeFailed` | Referee failed | Mai shaida ya gaza | ☐ | |
| `ofcAgApplicationState` | Application state | Matsayin bukata | ☐ | |
| `ofcAgAccessStage` | Access stage | Matakin izini | ☐ | |
| `ofcAgMayCollectRevenue` | May collect revenue | Zai iya karbar haraji | ☐ | |
| `ofcAgOutstanding` | Outstanding | Da ya rage | ☐ | |
| `ofcAgTotalReferees` | Total referees | Jimlar masu shaida | ☐ | |
| `ofcAgPending` | Pending | Ana jira | ☐ | |
| `ofcAgCleared` | Cleared | An ba da izini | ☐ | |
| `ofcAgFailedRejected` | Failed or rejected | Ya gaza ko an ki | ☐ | |
| `ofcAgBankDifferentName` | The bank returned a different name | Banki ya dawo da wani suna daban | ☐ | |
| `ofcAgApplicantsSupported` | Applicants supported | Masu nema da aka goyi baya | ☐ | |
| `ofcAgApplication` | Application | Bukata | ☐ | |
| `ofcAgSubmitted` | Submitted | An tura | ☐ | |
| `ofcAgCode` | Code | Lamba | ☐ | |
| `ofcAgKyc` | KYC | Shaida | ☐ | |
| `ofcAgOperational` | Operational | Yana aiki | ☐ | |
| `ofcAgCategory` | Category | Rukuni | ☐ | |
| `ofcAgRelationship` | Relationship | Dangantaka | ☐ | |
| `ofcAgResponded` | Responded | Ya amsa | ☐ | |
| `ofcAgModule` | Module | Darasi | ☐ | |
| `ofcAgTitleHeading` | Title | Take | ☐ | |
| `ofcAgScore` | Score | Maki | ☐ | |
| `ofcAgVersion` | Version | Siga | ☐ | |
| `ofcAgEvent` | Event | Abin da ya faru | ☐ | |
| `ofcAgReason` | Reason | Dalili | ☐ | |
| `ofcAgSignal` | Signal | Alama | ☐ | |
| `ofcAgSeverity` | Severity | Girman hadari | ☐ | |
| `ofcAgDetail` | Detail | Bayani | ☐ | |
| `ofcAgSampleKycNote` | Identity verified against NIN; referee confirmed by district head; records in order. | An tabbatar da shaida da NIN; hakimin unguwa ya tabbatar da mai shaida; rikodin sun daidaita. | ☐ | |
| `ofcAgSampleRefereeNote` | Called all six applicants; four have never met him. | An kira dukkan masu nema shida; hudu ba su taba haduwa da shi ba. | ☐ | |
| `ofcAgConfirmHowPrompt` | Say how you confirmed this change with {{name}} (at least 10 characters): | Ka bayyana yadda ka tabbatar da wannan canji tare da {{name}} (akalla haruffa 10): | ☐ | |
| `ofcAgRefuseWhyPrompt` | Say why this change is being refused (at least 10 characters): | Ka bayyana dalilin da ya sa ake ki wannan canji (akalla haruffa 10): | ☐ | |
| `ofcAgAccountChanged` | {{name}}’s commission account has been changed. | An canza asusun kwamishan na {{name}}. | ☐ | |
| `ofcAgChangeRefused` | The change for {{name}} was refused. Their existing account is unchanged. | An ki canjin {{name}}. Asusunsu na yanzu bai canza ba. | ☐ | |
| `ofcAgNotConfirmed` | Not confirmed | Ba a tabbatar ba | ☐ | |
| `ofcAgNotConfirmedBecause` | Not confirmed: {{reason}} | Ba a tabbatar ba: {{reason}} | ☐ | |
| `ofcAgAnOfficer` | An officer ({{role}}) | Wani jami’i ({{role}}) | ☐ | |
| `ofcAgUnknownRole` | unknown role | matsayin da ba a sani ba | ☐ | |
| `ofcAgBankStillNotConfirmed` | The bank still did not confirm it ({{outcome}}). | Banki bai tabbatar da shi ba har yanzu ({{outcome}}). | ☐ | |
| `ofcAgAgentActivated` | Agent activated. | An kunna wakilin. | ☐ | |
| `ofcAgAgentAgreementAccepted` | Agent agreement accepted | An amince da yarjejeniyar wakili | ☐ | |
| `ofcAgAgentSuspendedTheirSessions` | Agent suspended. Their sessions and devices have been disabled. | An dakatar da wakilin. An kashe zamansa da na’urorinsa. | ☐ | |
| `ofcAgApplicationApproved` | Application approved. | An amince da bukatar. | ☐ | |
| `ofcAgApplicationRejected` | Application rejected. | An ki bukatar. | ☐ | |
| `ofcAgAskedForBy` | Asked for by | Wanda ya nema | ☐ | |
| `ofcAgCommissionBankAccountVerified` | Commission bank account verified | An tabbatar da asusun bankin kwamishan | ☐ | |
| `ofcAgConfirmedNoNameReturned` | Confirmed, no name returned | An tabbatar, amma ba a mayar da suna ba | ☐ | |
| `ofcAgDeviceApprovedTheAgent` | Device approved. The agent can now collect from it. | An amince da na’urar. Yanzu wakili zai iya karba da ita. | ☐ | |
| `ofcAgDeviceRestoredTheAgent` | Device restored. The agent can collect from it again. | An mayar da na’urar. Wakili zai iya sake karba da ita. | ☐ | |
| `ofcAgDeviceRevokedAndIts` | Device revoked and its sessions ended. | An janye na’urar kuma an kawo karshen zamanta. | ☐ | |
| `ofcAgDeviceSuspendedAndIts` | Device suspended and its sessions ended. It can be restored. | An dakatar da na’urar kuma an kawo karshen zamanta. Ana iya mayar da ita. | ☐ | |
| `ofcAgDocumentType` | Document type | Nau’in takarda | ☐ | |
| `ofcAgFailureReason` | Failure reason | Dalilin gazawa | ☐ | |
| `ofcAgFlagDismissedTheReferee` | Flag dismissed. The referee can be cleared as normal. | An soke gargadin. Ana iya tabbatar da mai shaida kamar yadda aka saba. | ☐ | |
| `ofcAgFlagMarkedAsUnder` | Flag marked as under review. | An sanya gargadin a matsayin ana bincike. | ☐ | |
| `ofcAgFlagUpheldThisReferee` | Flag upheld. This referee cannot be cleared until it is dismissed. | An tabbatar da gargadin. Ba za a iya tabbatar da wannan mai shaida ba sai an soke shi. | ☐ | |
| `ofcAgGiveAReasonOf` | Give a reason of at least 10 characters. It is the only record of why the account somebody is paid into was moved. | Ka bayar da dalili na akalla haruffa 10. Shi ne kadai rikodin dalilin da ya sa aka sauya asusun da ake biyan wani a ciki. | ☐ | |
| `ofcAgGovernmentApproved` | Government approved | Gwamnati ta amince | ☐ | |
| `ofcAgIdentityVerifiedKyc` | Identity verified (KYC) | An tabbatar da shaida (KYC) | ☐ | |
| `ofcAgLivenessCheck` | Liveness check | Tabbatar da mutum na gaske | ☐ | |
| `ofcAgMandatoryTrainingCompleted` | Mandatory training completed | An kammala horon wajibi | ☐ | |
| `ofcAgMoreInformationRequestedFrom` | More information requested from the applicant. | An nemi karin bayani daga mai nema. | ☐ | |
| `ofcAgNameTheAgentGave` | Name the agent gave | Sunan da wakili ya bayar | ☐ | |
| `ofcAgNameTheBankReturned` | Name the bank returned | Sunan da banki ya mayar | ☐ | |
| `ofcAgNumberOnFile` | Number on file | Lambar da ke rubuce | ☐ | |
| `ofcAgReasonGiven` | Reason given | Dalilin da aka bayar | ☐ | |
| `ofcAgRecordThis` | Record this | Rubuta wannan | ☐ | |
| `ofcAgRefereeCleared` | Referee cleared. | An tabbatar da mai shaida. | ☐ | |
| `ofcAgRefereeRejected` | Referee rejected. | An ki mai shaida. | ☐ | |
| `ofcAgTerritoryReassignedFutureCollections` | Territory reassigned. Future collections are attributed to it. | An sauya yankin. Za a danganta karbar kudi ta gaba da shi. | ☐ | |
| `ofcAgTheAgent` | The agent | Wakilin | ☐ | |
| `ofcAgTheBankConfirmedThe` | The bank confirmed the account. | Banki ya tabbatar da asusun. | ☐ | |
| `ofcAgTheBankCouldNot` | The bank could not be reached | Ba a samu banki ba | ☐ | |
| `ofcAgTheBankVerificationService` | The bank verification service could not be reached. Try again before deciding — an unconfirmed account cannot be approved. | Ba a samu sabis din tabbatar da banki ba. Ka sake gwadawa kafin ka yanke shawara — ba za a iya amincewa da asusun da ba a tabbatar ba. | ☐ | |
| `ofcAgThisAccountCannotBe` | This account cannot be approved while the bank does not confirm it. Refuse the request so the agent can send the right details. | Ba za a iya amincewa da wannan asusu ba matukar banki bai tabbatar da shi ba. Ka ki bukatar domin wakili ya aiko da bayanan da suka dace. | ☐ | |
| `ofcAgUnnamed` | Unnamed | Ba shi da suna | ☐ | |

#### The officer portal — identity documents

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcKycFileType` | This is a {{type}} file. | Wannan fayil na {{type}} ne. | ☐ | |
| `ofcKycNotReviewed` | {{n}} document(s) not yet reviewed | Takardu {{n}} ba a duba ba tukuna | ☐ | |
| `ofcKycAlready` | Already {{status}} | An riga an {{status}} | ☐ | |
| `ofcKycIdentityDocuments` | Identity documents | Takardun shaida | ☐ | |
| `ofcKycIntro` | What the applicant submitted. Opening one is recorded against your name. | Abin da mai nema ya tura. Ana rubuta budewa da sunanka. | ☐ | |
| `ofcKycNoDocuments` | This applicant has not submitted any documents. | Wannan mai nema bai tura wata takarda ba. | ☐ | |
| `ofcKycApprovingBlind` | Approving this applicant without opening them means the identity check rests on the provider’s automated answer alone. | Amincewa da wannan mai nema ba tare da bude su ba yana nufin duban shaidar ya dogara ne kawai a kan amsar na’urar mai bayarwa. | ☐ | |
| `ofcKycClose` | Close | Rufe | ☐ | |
| `ofcKycOpenNewTab` | Open it in a new tab | Bude shi a sabon shafi | ☐ | |
| `ofcKycChecksum` | Checksum | Lambar tantancewa | ☐ | |
| `ofcKycSuperseded` | A newer capture of this document has been submitted. Review that one instead. | An tura sabon hoton wannan takardar. Ka duba wancan maimakon haka. | ☐ | |
| `ofcKycWhyRequired` | Why? Required either way, and shown to the applicant on a rejection | Me ya sa? Ana bukatarsa ko ta yaya, kuma ana nuna wa mai nema idan an ki | ☐ | |
| `ofcKycAccept` | Accept | Amince | ☐ | |
| `ofcKycNeedsPermission` | Deciding on a document needs agent:approve. | Yanke shawara kan takarda yana bukatar agent:approve. | ☐ | |
| `ofcKycWhoLooked` | Who has looked at this? | Wa ya duba wannan? | ☐ | |
| `ofcKycSupersededLabel` | Superseded | An maye gurbinsa | ☐ | |
| `ofcKycDocument` | Document | Takarda | ☐ | |
| `ofcKycCaptured` | Captured | An dauka | ☐ | |
| `ofcKycSize` | Size | Girma | ☐ | |
| `ofcKycReviewed` | Reviewed | An duba | ☐ | |
| `ofcKycWho` | Who | Wa | ☐ | |
| `ofcKycWhat` | What | Me | ☐ | |
| `ofcKycAccepted` | {{document}} accepted. | An karbi {{document}}. | ☐ | |
| `ofcKycRejectedNotice` | {{document}} rejected. The applicant can see the reason and submit a replacement. | An ki {{document}}. Mai nema zai iya ganin dalili ya kuma sake tura wata. | ☐ | |
| `ofcKycSubmittedByApplicant` | {{document}} submitted by the applicant | {{document}} da mai nema ya tura | ☐ | |
| `ofcKycReasonGiven` | Reason given: {{reason}} | Dalilin da aka bayar: {{reason}} | ☐ | |

#### The officer portal — the minimum app version

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcFaMinimumNow` | Minimum version is now {{version}}. | Mafi karancin sigar yanzu {{version}} ce. | ☐ | |
| `ofcFaNoneBelowIt` | No active handset is below it. | Babu wata na’ura mai aiki da ke kasa da ita. | ☐ | |
| `ofcFaCannotCollect` | {{locked}} of {{total}} active handset(s) cannot collect until they update. | Na’urori {{locked}} cikin {{total}} masu aiki ba za su iya karbar kudi ba sai sun sabunta. | ☐ | |
| `ofcFaEveryHandsetCan` | Every handset can collect. | Kowace waya na iya karba. | ☐ | |
| `ofcFaSomeCannotCollect` | These agents cannot collect until they update. | Wadannan wakilai ba za su iya karba ba sai sun sabunta. | ☐ | |
| `ofcFaIntro` | A handset below the minimum version cannot start a payment or renew a vehicle. It is refused before any money moves, and the agent is told to update. Raise the minimum when a release is getting something wrong in the field; every agent still on that build stops collecting the moment it is published. | Wayar da ke kasa da mafi karancin siga ba za ta iya fara biyan kudi ko sabunta mota ba. Ana ki ta kafin kudi ya motsa, kuma ana gaya wa wakilin ya sabunta. Ka daga mafi karanci idan wani saki yana kuskure a filin aiki; duk wakilin da ke kan wannan sigar zai daina karba nan take idan aka buga shi. | ☐ | |
| `ofcFaHandsetsInField` | Handsets in the field | Wayoyi a filin aiki | ☐ | |
| `ofcFaPublishNewMinimum` | Publish a new minimum | Buga sabon mafi karanci | ☐ | |
| `ofcFaAppendsRecord` | This appends to the record rather than replacing it, so what was required when — and who decided — stays readable. It cannot be edited afterwards. | Wannan yana kara a rikodi maimakon maye gurbinsa, don haka abin da aka bukata a lokacin — da wanda ya yanke shawara — yana nan a karanta. Ba za a iya gyara shi daga baya ba. | ☐ | |
| `ofcFaMinimumVersion` | Minimum version | Mafi karancin siga | ☐ | |
| `ofcFaRecommendedVersion` | Recommended version | Sigar da aka ba da shawara | ☐ | |
| `ofcFaRecommendedHint` | What an agent is asked to update to. It cannot be below the minimum. | Abin da ake nema wakili ya sabunta zuwa gare shi. Ba zai iya zama kasa da mafi karanci ba. | ☐ | |
| `ofcFaWhyMoving` | Why the minimum is moving | Dalilin da ya sa mafi karanci ke motsi | ☐ | |
| `ofcFaTakesEffectOptional` | Takes effect (optional) | Zai fara aiki (ba dole ba) | ☐ | |
| `ofcFaTakesEffectHint` | Leave empty to take effect immediately. A date in the future announces the change without enforcing it yet; a date at or before the version currently in force is refused, because the gate would never read it. | Ka bar shi babu komai domin ya fara aiki nan take. Ranar da ke gaba tana sanar da canjin ba tare da tilasta shi ba tukuna; ranar da ta yi daidai ko ta gabaci sigar da ke aiki yanzu ana ki ta, saboda kofar ba za ta taba karanta ta ba. | ☐ | |
| `ofcFaHistory` | What has been required, and when | Abin da aka bukata, da yaushe | ☐ | |
| `ofcFaMinimumInForce` | Minimum version in force | Mafi karancin siga da ke aiki | ☐ | |
| `ofcFaRecommended` | Recommended | An ba da shawara | ☐ | |
| `ofcFaActiveHandsets` | Active handsets | Wayoyin da ke aiki | ☐ | |
| `ofcFaBelowMinimum` | Below the minimum now | Kasa da mafi karanci yanzu | ☐ | |
| `ofcFaSampleReason` | Build 1.3.2 rounds the service charge down; no collection from below 1.4.0. | Sigar 1.3.2 tana rage kudin hidima; babu karba daga kasa da 1.4.0. | ☐ | |
| `ofcFaBuild` | Build | Siga | ☐ | |
| `ofcFaHandsets` | Handsets | Wayoyi | ☐ | |
| `ofcFaAgainstMinimum` | Against the minimum | Idan aka kwatanta da mafi karanci | ☐ | |
| `ofcFaTakesEffect` | Takes effect | Zai fara aiki | ☐ | |
| `ofcFaMinimum` | Minimum | Mafi karanci | ☐ | |
| `ofcFaPublishedBy` | Published by | Wanda ya buga | ☐ | |
| `ofcFaWhy` | Why | Dalili | ☐ | |
| `ofcFaMinimumAboveRecommended` | A minimum of {{minimum}} is above the recommended {{recommended}}, so even a handset on the newest build would be refused. | Mafi karancin {{minimum}} ya wuce {{recommended}} da aka ba da shawara, don haka za a ki ko na’urar da ke da sabon salo. | ☐ | |
| `ofcFaNoHandsetBelow` | No active handset is below {{version}}. | Babu na’urar da ke aiki da ke kasa da {{version}}. | ☐ | |
| `ofcFaHandsetWouldStop` | {{count}} of {{total}} active handset would stop collecting until it is updated. | Na’ura {{count}} daga cikin {{total}} da ke aiki za ta daina karbar kudi har sai an sabunta ta. | ☐ | |
| `ofcFaHandsetsWouldStop` | {{count}} of {{total}} active handsets would stop collecting until they update. | Na’urori {{count}} daga cikin {{total}} da ke aiki za su daina karbar kudi har sai an sabunta su. | ☐ | |
| `ofcFaEnterTheMinimumVersion` | Enter the minimum version as digits and dots, like 1.4.0. | Ka shigar da mafi karancin salo da lambobi da digo, kamar 1.4.0. | ☐ | |
| `ofcFaEnterTheRecommendedVersion` | Enter the recommended version as digits and dots, like 1.4.0. | Ka shigar da salon da ake ba da shawara da lambobi da digo, kamar 1.4.0. | ☐ | |
| `ofcFaNeverReportedAVersion` | Never reported a version | Bai taba bayar da rahoton salo ba | ☐ | |
| `ofcFaPublishThisMinimum` | Publish this minimum | Buga wannan mafi karanci | ☐ | |
| `ofcFaPublishing` | Publishing… | Ana bugawa… | ☐ | |
| `ofcFaSayWhyTheMinimum` | Say why the minimum is moving, in at least 10 characters. It is what an agent who is locked out will be shown. | Ka fadi dalilin da ya sa ake motsa mafi karanci, a cikin akalla haruffa 10. Shi ne abin da wakilin da aka killace zai gani. | ☐ | |
| `ofcFaShippedWithThePlatform` | Shipped with the platform | An aiko shi tare da dandalin | ☐ | |

#### The officer portal — officer access

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcUaChooseRoleFirst` | Choose the role this officer should hold. | Ka zabi matsayin da wannan jami’in zai rike. | ☐ | |
| `ofcUaAlreadyHolds` | {{name}} already holds the {{role}} role. | {{name}} ya riga ya rike matsayin {{role}}. | ☐ | |
| `ofcUaSayWhy` | Say why this access is changing, in at least 10 characters. It is the only record of why. | Ka fada dalilin canja wannan izini, da akalla haruffa 10. Shi ne kadai bayanin dalilin. | ☐ | |
| `ofcUaNowRole` | {{name}} is now {{role}}. | {{name}} yanzu {{role}} ne. | ☐ | |
| `ofcUaSessionsEnded` | {{n}} open session(s) ended, so they must sign in again. | An kawo karshen zaman da aka bude {{n}}, don haka sai sun sake shiga. | ☐ | |
| `ofcUaNoOpenSessions` | They had no open sessions. | Ba su da wani zaman a bude. | ☐ | |
| `ofcUaCanSignInAgain` | {{name}} can sign in again. | {{name}} na iya sake shiga. | ☐ | |
| `ofcUaAccountIsNow` | {{name}}’s account is {{status}}. | Asusun {{name}} yanzu {{status}} ne. | ☐ | |
| `ofcUaSessionsEndedNow` | {{n}} open session(s) ended immediately. | An kawo karshen zaman da aka bude {{n}} nan take. | ☐ | |
| `ofcUaSuspendOrCloseBody` | Suspending or closing an account signs the officer out everywhere and stops them signing in again. Suspension is a pause pending an answer; closing is the end of the appointment and cannot be undone — create a new account if they return. | Dakatarwa ko rufe asusu yana fitar da jami’in daga ko’ina kuma yana hana shi sake shiga. Dakatarwa hutu ne har sai an sami amsa; rufewa shi ne karshen aikin kuma ba a iya warwarewa — sai an bude sabon asusu idan ya dawo. | ☐ | |
| `ofcUaCoverNothingBody` | {{name}} will see no revenue figures at all until a territory is assigned. | {{name}} ba zai ga wata lambar kudaden shiga ba ko kadan har sai an ba shi yanki. | ☐ | |
| `ofcUaChangeAccessFor` | Change access — {{name}} | Canja izini — {{name}} | ☐ | |
| `ofcUaCurrentlyRole` | Currently {{role}}. | A halin yanzu {{role}}. | ☐ | |
| `ofcUaAccountFor` | Account — {{name}} | Asusu — {{name}} | ☐ | |
| `ofcUaCannotReopenBody` | A closed account can never be reopened. If {{name}} returns to the service they will need a new account. | Ba a taba sake bude asusun da aka rufe ba. Idan {{name}} ya dawo aiki zai bukaci sabon asusu. | ☐ | |
| `ofcUaTerritoriesFor` | Territories — {{name}} | Yankuna — {{name}} | ☐ | |
| `ofcUaRoleAdmin` | Administers agents, users and the revenue catalogue. Cannot authorise payouts. | Yana gudanar da wakilai, masu amfani da kundin kudaden shiga. Ba zai iya ba da izinin fitar da kudi ba. | ☐ | |
| `ofcUaRoleSupervisor` | Authorises approvals and oversees agents in their territory. | Yana ba da izinin amincewa kuma yana kula da wakilai a yankinsa. | ☐ | |
| `ofcUaRoleRevenueOfficer` | Registers and corrects taxpayer records, and reviews approvals. | Yana yin rajista da gyara bayanan mai biyan haraji, kuma yana duba amincewa. | ☐ | |
| `ofcUaRoleFinanceOfficer` | Reconciles settlements and authorises commission payouts. | Yana daidaita biyan kudi kuma yana ba da izinin fitar da kwamishan. | ☐ | |
| `ofcUaRoleAuditor` | Reads everything and changes nothing. | Yana karanta komai kuma ba ya canja komai. | ☐ | |
| `ofcUaTheirAccess` | Where they are signed in | Inda ya shiga | ☐ | |
| `ofcUaAccessFor` | Where {{name}} is signed in | Inda {{name}} ya shiga | ☐ | |
| `ofcUaBackToMine` | Back to my own access | Koma ga nawa | ☐ | |
| `ofcUaCoversNothing` | {{name}} now covers no territory and will see no revenue figures. | {{name}} yanzu ba shi da wani yanki kuma ba zai ga lambobin kudaden shiga ba. | ☐ | |
| `ofcUaCoversTerritories` | {{name}} now covers {{n}} territory(ies). | {{name}} yanzu yana rufe yankuna {{n}}. | ☐ | |
| `ofcUaRoleChangeIntro` | Changing a role signs the officer out of every device immediately, because their current access travels in the session they are holding. They sign in again with the new role. Agents are not listed: their access follows the clearance pipeline, not a role. | Canza matsayi yana fitar da jami’i daga kowace na’ura nan take, saboda izininsa na yanzu yana tafiya cikin zaman da yake rike da shi. Zai sake shiga da sabon matsayin. Ba a jera wakilai: izininsu yana bin tsarin izini, ba matsayi ba. | ☐ | |
| `ofcUaNewRole` | New role | Sabon matsayi | ☐ | |
| `ofcUaSelectRole` | Select a role | Zabi matsayi | ☐ | |
| `ofcUaWhyChanging` | Why this is changing | Dalilin wannan canjin | ☐ | |
| `ofcUaNewAccountStatus` | New account status | Sabon matsayin asusu | ☐ | |
| `ofcUaSuspendedPending` | Suspended — pending an enquiry | An dakatar — ana jiran bincike | ☐ | |
| `ofcUaClosedLeft` | Closed — they have left the service | An rufe — ya bar aikin | ☐ | |
| `ofcUaActiveLift` | Active — lift a suspension | Yana aiki — a dage dakatarwa | ☐ | |
| `ofcUaTerritoryIntro` | A supervisor sees revenue for the territories assigned here and no others. With none assigned they see nothing at all — which is deliberate, so an account nobody has finished setting up is the least revealing one rather than the most. | Mai kula yana ganin harajin yankunan da aka ba shi a nan kuma babu wasu. Idan babu wanda aka ba shi, ba ya ganin komai — da gangan ne, don asusun da ba a gama saitin sa ba shi ne mafi karancin bayyanawa ba mafi yawa ba. | ☐ | |
| `ofcUaTerritoriesCovered` | Territories covered | Yankunan da ake kula da su | ☐ | |
| `ofcUaNoTerritory` | No active territory has been created yet. | Ba a kirkiri yankin da ke aiki ba tukuna. | ☐ | |
| `ofcUaYourOwnAccess` | Your own access | Izininka na kanka | ☐ | |
| `ofcUaChangeAccess` | Change access | Canza izini | ☐ | |
| `ofcUaTerritories` | Territories | Yankuna | ☐ | |
| `ofcUaAccount` | Account | Asusu | ☐ | |
| `ofcUaSampleTransferred` | Transferred to the audit office from 1 September. | An mayar da shi ofishin bincike daga 1 ga Satumba. | ☐ | |
| `ofcUaSampleLeft` | Left the service at the end of the quarter. | Ya bar aikin a karshen kwata. | ☐ | |
| `ofcUaCannotBeUndone` | This cannot be undone | Ba za a iya soke wannan ba | ☐ | |
| `ofcUaSampleTakingOver` | Taking over the Jos North market round from 1 September. | Zai karbi zagayen kasuwar Jos ta Arewa daga 1 ga Satumba. | ☐ | |
| `ofcUaWillCoverNothing` | This will leave them covering nothing | Wannan zai bar shi ba tare da yankin da zai kula ba | ☐ | |
| `ofcUaLastSignedIn` | Last signed in | Shiga na karshe | ☐ | |
| `ofcUaChangeAccessAndSign` | Change access and sign them out | Canza izini ka fitar da su | ☐ | |
| `ofcUaChanging` | Changing… | Ana canzawa… | ☐ | |
| `ofcUaLetThemSignIn` | Let them sign in again | Bar su su sake shiga | ☐ | |
| `ofcUaSaveTerritories` | Save territories | Ajiye yankunan | ☐ | |
| `ofcUaSignThemOutAnd` | Sign them out and stop the account | Fitar da su ka dakatar da asusun | ☐ | |

#### The officer portal — the collections dashboard

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcDbShowing` | Showing {{territories}} | Ana nuna {{territories}} | ☐ | |
| `ofcDbCoversYourTerritory` | Every figure on this page covers your territory only, not the whole state. | Kowane adadi a wannan shafin ya shafi yankinka kadai, ba dukkan jihar ba. | ☐ | |
| `ofcDbCoversYourTerritories` | Every figure on this page covers your territories only, not the whole state. | Kowane adadi a wannan shafin ya shafi yankunanka kadai, ba dukkan jihar ba. | ☐ | |
| `ofcDbNeedAttention` | {{n}} item(s) need attention | Abubuwa {{n}} na bukatar kulawa | ☐ | |
| `ofcDbExceptionsAnd` | {{exceptions}} reconciliation exception(s) and {{flags}} open fraud flag(s). | Kura-kuran daidaita lissafi {{exceptions}} da alamun zamba {{flags}} a bude. | ☐ | |
| `ofcDbNewThisMonth` | {{n}} new this month | Sabbi {{n}} wannan watan | ☐ | |
| `ofcDbAwaitingReview` | {{n}} awaiting review | {{n}} na jiran dubawa | ☐ | |
| `ofcDbFailedCount` | {{n}} failed | {{n}} sun gaza | ☐ | |
| `ofcDbNoTerritoryBody` | These figures are empty because your account covers no territory yet, not because nothing was collected. Ask an administrator to assign yours. | Wadannan adadi babu komai saboda asusunka bai rufe wani yanki ba tukuna, ba don ba a karbi komai ba. Ka nemi mai gudanarwa ya ba ka naka. | ☐ | |
| `ofcDbNoTerritoryTitle` | No territory has been assigned to you | Ba a ba ka wani yanki ba | ☐ | |
| `ofcDbReviewReconciliation` | Review reconciliation | Duba daidaita lissafi | ☐ | |
| `ofcDbReviewFlags` | review flags | duba alamu | ☐ | |
| `ofcDbCollectionsLast30` | Collections over the last 30 days | Karba a cikin kwanaki 30 na karshe | ☐ | |
| `ofcDbOnlyConfirmed` | Only payments confirmed by the payment gateway are counted. | Biyan kudin da tashar biyan kudi ta tabbatar kawai ake kirgawa. | ☐ | |
| `ofcDbRevenueByLga` | Revenue by Local Government Area | Haraji bisa ga Karamar Hukuma | ☐ | |
| `ofcDbBelowPotential` | Identifies areas where collection is below potential. | Yana nuna yankunan da karba ke kasa da abin da ake tsammani. | ☐ | |
| `ofcDbRevenueByCategory` | Revenue by category | Haraji bisa ga rukuni | ☐ | |
| `ofcDbWhichHeads` | Which heads of revenue are actually producing. | Wadanne nau’ikan haraji ne ke bayar da amfani a hakika. | ☐ | |
| `ofcDbTopAgents` | Top performing agents | Wakilai mafi kyawun aiki | ☐ | |
| `ofcDbTopAgentsBody` | Ranked by verified collections. Personal details beyond name and code are not shown here. | An jera bisa karban da aka tabbatar. Ba a nuna bayanan mutum banda suna da lamba a nan ba. | ☐ | |
| `ofcDbRevenueByMda` | Revenue by MDA | Haraji bisa ga ma’aikata | ☐ | |
| `ofcDbIntelligenceTitle` | Geographic revenue intelligence | Nazarin harajin yankuna | ☐ | |
| `ofcDbDrill` | Drill from State to LGA to Ward to Community to see where revenue is and is not being collected. | Ka sauka daga Jiha zuwa Karamar Hukuma zuwa Unguwa zuwa Al’umma domin ganin inda ake karbar haraji da inda ba a karba ba. | ☐ | |
| `ofcDbPlateauState` | Plateau State | Jihar Filato | ☐ | |
| `ofcDbPlatformKpis` | Platform KPIs | Ma’aunan aikin dandali | ☐ | |
| `ofcDbKpisUnreadable` | The platform's own numbers could not be read | Ba a iya karanta alkaluman dandalin kansa ba | ☐ | |
| `ofcDbKpisUnreadableBody` | Payments verified, the reconciliation rate and the count still awaiting it are missing from this page rather than zero. Reload, and raise it if it does not clear. | Biyan da aka tabbatar, adadin daidaitawa, da adadin da ke jiran daidaitawa ba sa nan a wannan shafi — ba sifili ba ne. Ka sake lodi, kuma ka daga kara idan bai warware ba. | ☐ | |
| `ofcDbSinceBegan` | Since the platform began collecting. | Tun lokacin da dandalin ya fara karba. | ☐ | |
| `ofcDbVerifiedOnly` | Verified revenue only | Harajin da aka tabbatar kawai | ☐ | |
| `ofcDbThisMonth` | This month | Wannan watan | ☐ | |
| `ofcDbYearToDate` | Year to date | Daga farkon shekara | ☐ | |
| `ofcDbAccruedNotPaid` | Accrued but not yet paid | An tara amma ba a biya ba tukuna | ☐ | |
| `ofcDbRegisteredTaxpayers` | Registered taxpayers | Masu biyan haraji da aka yi wa rajista | ☐ | |
| `ofcDbSuccessfulTransactions` | Successful transactions | Ma’amalolin da suka yi nasara | ☐ | |
| `ofcDbAwaitingReconciliation` | Awaiting reconciliation | Ana jiran daidaita lissafi | ☐ | |
| `ofcDbPaymentsVerified` | Payments verified | Biyan kudin da aka tabbatar | ☐ | |
| `ofcDbOfEveryAttempted` | Of every payment attempted | Cikin kowane biyan kudi da aka gwada | ☐ | |
| `ofcDbReconciled` | Reconciled | An daidaita | ☐ | |
| `ofcDbMatchedAcross` | Matched across platform, gateway and settlement | An dace a dandali, tashar biya da turawa | ☐ | |
| `ofcDbReceiptsIssued` | Receipts issued | Rasit din da aka bayar | ☐ | |
| `ofcDbOfTransactions` | Of transactions that counted as revenue | Cikin ma’amalolin da aka kirga a matsayin haraji | ☐ | |
| `ofcDbMda` | MDA | Ma’aikata | ☐ | |
| `ofcDbByChannel` | How the money arrived | Yadda kudin ya shigo | ☐ | |
| `ofcDbByChannelBody` | Recorded on every transaction since the platform started, and never grouped until now. It is the figure behind every decision about where to put agents. | An rubuta shi a kan kowace ma’amala tun farkon manhajar, kuma ba a taba tarawa ba har yanzu. Shi ne adadin da ke bayan kowane shawara kan inda za a sanya wakilai. | ☐ | |
| `ofcDbByTaxpayerType` | Individuals and businesses | Mutane da kasuwanci | ☐ | |
| `ofcDbByItem` | Revenue by levy | Haraji bisa kowane nau’i | ☐ | |
| `ofcDbByItemBody` | One level below the category, which is where somebody's responsibility sits. | Mataki daya kasa da nau’in, inda alhakin wani yake. | ☐ | |
| `ofcDbReversed` | Reversed | An soke | ☐ | |
| `ofcDbRefunded` | Refunded | An mayar | ☐ | |
| `ofcDbAgentsOnline` | Agents working now | Wakilan da ke aiki yanzu | ☐ | |
| `ofcDbAgentsOnlineHint` | Active in the last fifteen minutes | Sun yi aiki cikin mintuna goma sha biyar da suka wuce | ☐ | |
| `ofcDbAgentsSuspended` | Agents suspended | Wakilan da aka dakatar | ☐ | |
| `ofcDbExpectedRevenue` | Assessed and unpaid | An kima kuma ba a biya ba | ☐ | |
| `ofcDbExpectedRevenueHint` | Money already invoiced and owed. Not a projection. | Kudin da aka riga aka fitar da takardar biya kuma ana bin sa. Ba hasashe ba. | ☐ | |
| `ofcDbYesterday` | Yesterday | Jiya | ☐ | |
| `ofcDbThisWeek` | This week | Wannan makon | ☐ | |
| `ofcDbVsYesterday` | against yesterday | kan jiya | ☐ | |
| `ofcDbVsLastWeek` | against the same days last week | kan kwanakin makon jiya | ☐ | |
| `ofcDbVsLastMonth` | against the same days last month | kan kwanakin watan jiya | ☐ | |
| `ofcDbVsLastYear` | against the same period last year | kan wannan lokaci na bara | ☐ | |
| `ofcDbNoComparison` | nothing collected then, so no comparison | ba a tara komai a lokacin ba, don haka babu kwatanci | ☐ | |
| `ofcDbLastMonthWhole` | The whole of last month | Duk watan jiya | ☐ | |
| `ofcDbDeclining` | Categories collecting less than last month | Nau’ikan da suka tara kasa da watan jiya | ☐ | |
| `ofcDbDecliningBody` | Ranked by size, a category that halved still sits near the top and looks healthy. This is the same data ranked by direction. | Idan aka jera bisa girma, nau’in da ya ragu da rabi zai kasance a saman kuma zai yi kama da lafiya. Wannan bayanai iri daya ne aka jera bisa hanya. | ☐ | |
| `ofcDbNoneDeclining` | Nothing is collecting less than it did last month. | Babu abin da ke tarawa kasa da watan jiya. | ☐ | |
| `ofcDbChange` | Change | Canji | ☐ | |
| `ofcDbShareOfMonth` | Share of the month | Kason watan | ☐ | |
| `ofcDbAverageTimeToConfirm` | Average time to confirm a payment | Matsakaicin lokacin tabbatar da biya | ☐ | |
| `ofcDbDuplicateRegistrationsOverridden` | Duplicate registrations overridden | Rijistar da aka maimaita da aka wuce | ☐ | |
| `ofcDbNewTaxpayersThisMonth` | New taxpayers this month | Sabbin masu biyan haraji a wannan wata | ☐ | |
| `ofcDbReversalsAndRefunds` | Reversals and refunds | Mayarwa da dawo da kudi | ☐ | |
| `ofcDbTaxpayersWithATin` | Taxpayers with a TIN | Masu biyan haraji da ke da TIN | ☐ | |
| `ofcDbTotalCollected` | Total collected | Jimlar abin da aka karba | ☐ | |

#### The officer portal — revenue intelligence

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcRvArea` | Area | Yanki | ☐ | |
| `ofcRvGroupedByAssessment` | Every figure below is grouped by the LGA and ward on the assessment, which is reliable. The map coordinates are separate and are captured by the agent application at the moment of collection — none has arrived yet, which usually means no version carrying that has been deployed, or agents have not granted location permission on their handsets. | An hada kowane adadi a kasa bisa ga Karamar Hukuma da unguwar da ke kan kimar, wanda abin dogaro ne. Wurin taswira daban ne kuma manhajar wakilai ce ke daukar sa a lokacin karba — babu wanda ya iso tukuna, wanda yawanci yana nufin ba a tura sigar da ke dauke da shi ba, ko wakilai ba su ba da izinin wuri a wayoyinsu ba. | ☐ | |
| `ofcRvWhoseRevenue` | Whose revenue this is | Harajin wa ne wannan | ☐ | |
| `ofcRvWhoseRevenueBody` | PSIRS collects the state’s revenue; this is the arm of government each naira is collected | PSIRS na karbar harajin jiha; wannan shi ne bangaren gwamnatin da ake karbar kowace naira | ☐ | |
| `ofcRvMdaNoItem` | . An MDA with no revenue item is listed rather than hidden — it means nothing is being collected on its behalf through this platform, which is a finding rather than an absence. | . Ana jera ma’aikatar da babu nau’in haraji maimakon a boye ta — yana nufin ba a karbar komai a madadinta ta wannan dandalin, wanda binciken ne ba rashin komai ba. | ☐ | |
| `ofcRvOwedToCouncils` | Owed to the Local Government Councils | Ana bin Kananan Hukumomi | ☐ | |
| `ofcRvCouncilsBody` | PSIRS collects this on the Councils’ behalf, so it is theirs rather than the State’s. Only items whose rate a Council sets are counted — a State levy collected in a Council’s area is the State’s. Every Council is listed, including those that collected nothing, because a remittance run has to account for all seventeen. | PSIRS na karbar wannan a madadin Kananan Hukumomi, don haka nasu ne ba na Jiha ba. Nau’ikan da Karamar Hukuma ke sanya kudinsu kawai ake kirgawa — harajin Jiha da aka karba a yankin Karamar Hukuma na Jiha ne. Ana jera kowace Karamar Hukuma, hade da wadanda ba su karbi komai ba, saboda turawar kudi dole ta yi lissafin dukkan goma sha bakwai. | ☐ | |
| `ofcRvWhereGenerated` | Where the revenue is generated | Inda ake samar da harajin | ☐ | |
| `ofcRvWhereGeneratedBody` | By ward, with the agents working each one. "Mapped" counts the collections that recorded a point; a ward earning well with none mapped is unmapped, not suspicious. | Bisa ga unguwa, tare da wakilan da ke aiki a kowace. “An sanya a taswira” yana kirga karban da ya rubuta wuri; unguwar da ke samun kudi da kyau ba tare da an sanya ta a taswira ba, ba a taswira take ba, ba abin tuhuma ba. | ☐ | |
| `ofcRvEachAgentGround` | Each agent, and the ground they cover | Kowane wakili, da yankin da yake rufewa | ☐ | |
| `ofcRvGroundBody` | Agent performance reports how much. This reports where — an agent working one market and an agent covering forty kilometres of road are doing different jobs on the same commission. | Aikin wakilai yana bayar da rahoton nawa. Wannan yana bayar da rahoton ina — wakili da ke aiki a kasuwa daya da wakili da ke rufe kilomita arba’in na hanya suna aiki daban a kan kwamishan iri daya. | ☐ | |
| `ofcRvVerifiedLastYear` | Verified revenue in the last year | Harajin da aka tabbatar a shekarar da ta gabata | ☐ | |
| `ofcRvGeneratingAreas` | Generating areas | Yankunan da ke samarwa | ☐ | |
| `ofcRvWardsProduced` | Wards that produced revenue | Unguwannin da suka samar da haraji | ☐ | |
| `ofcRvArmsNoItem` | Arms of government with no catalogue item | Bangarorin gwamnati da babu nau’in haraji | ☐ | |
| `ofcRvOwedCouncils` | Owed to Councils | Ana bin Kananan Hukumomi | ☐ | |
| `ofcRvCollectedOnBehalf` | Collected on their behalf | An karba a madadinsu | ☐ | |
| `ofcRvPlacedOnMap` | Placed on a map | An sanya a taswira | ☐ | |
| `ofcRvWithRecordedPoint` | Collections with a recorded point | Karban da aka rubuta wurinsa | ☐ | |
| `ofcRvNoPointRecorded` | No collection has recorded where it happened | Babu karban da ya rubuta inda ya faru | ☐ | |
| `ofcRvMinistryDepartment` | Ministry, Department or Agency | Ma’aikata, Sashe ko Hukuma | ☐ | |
| `ofcRvRevenueItems` | Revenue items | Nau’ikan haraji | ☐ | |
| `ofcRvShare` | Share | Rabo | ☐ | |
| `ofcRvCouncil` | Council | Karamar Hukuma | ☐ | |
| `ofcRvAgents` | Agents | Wakilai | ☐ | |
| `ofcRvMapped` | Mapped | An sanya a taswira | ☐ | |
| `ofcRvTerritory` | Territory | Yanki | ☐ | |
| `ofcRvLgas` | LGAs | Kananan Hukumomi | ☐ | |
| `ofcRvWards` | Wards | Unguwanni | ☐ | |
| `ofcRvCentreOfCollection` | Centre of collection | Tsakiyar karba | ☐ | |
| `ofcRvAverageTransaction` | Average transaction | Matsakaicin ma’amala | ☐ | |
| `ofcRvCompliance` | Register paying | Rajistar da ke biya | ☐ | |
| `ofcRvComplianceHint` | The share of taxpayers registered here who paid anything in the period. | Kason masu biyan haraji da aka yi rajista a nan da suka biya wani abu a lokacin. | ☐ | |
| `ofcRvEveryFigureHereCovers` | Every figure here covers your territories only, not the whole state. | Kowace lamba a nan ta shafi yankunanka ne kadai, ba dukan jihar ba. | ☐ | |
| `ofcRvNotMapped` | Not mapped | Ba a danganta ba | ☐ | |
| `ofcRvTheseFiguresAreEmpty` | These figures are empty because your account covers no territory yet. | Wadannan lambobi babu komai a cikinsu domin asusunka bai kunshi wani yanki ba tukuna. | ☐ | |

#### The officer portal — settlement and commission

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcFnResolveTooShort` | Say how the exception was resolved, in at least 10 characters. It is the only record of why this discrepancy was closed. | Ka fada yadda aka warware matsalar, da akalla haruffa 10. Shi ne kadai bayanin dalilin rufe wannan bambancin. | ☐ | |
| `ofcFnExceptionResolved` | Exception recorded as resolved. | An rubuta cewa an warware matsalar. | ☐ | |
| `ofcFnApprovePayoutTooShort` | Give a reason for approving this payout, in at least 5 characters. | Ka ba da dalilin amincewa da wannan fitar da kudi, da akalla haruffa 5. | ☐ | |
| `ofcFnPayoutApproved` | Payout approved. | An amince da fitar da kudin. | ☐ | |
| `ofcFnTransferReferenceTooShort` | Enter the bank transfer reference. It is what ties this payout to the money that actually left the account. | Ka shigar da lambar turawar banki. Ita ce ke hada wannan biyan da kudin da suka fita daga asusun da gaske. | ☐ | |
| `ofcFnPayoutPaid` | Payout recorded as paid. | An rubuta cewa an biya kudin. | ☐ | |
| `ofcFnPayoutFailedTooShort` | Record what the bank said. The agent has to be told why they were not paid, and the next attempt depends on knowing. | Ka rubuta abin da banki ya ce. Dole a gaya wa wakili dalilin da ya sa ba a biya shi ba, kuma yunkuri na gaba ya dogara da sanin hakan. | ☐ | |
| `ofcFnPayoutFailedRecorded` | Recorded as failed. The commission in it is payable again, and any clawback it had netted off is owed again. | An rubuta cewa ya gaza. Kwamishan da ke cikinsa ya sake zama abin biya, kuma duk wani cirewa da aka yi a ciki ya sake zama bashi. | ☐ | |
| `ofcFnDecisionTooShort` | Give a reason for this decision, in at least 10 characters. | Ka ba da dalilin wannan shawarar, da akalla haruffa 10. | ☐ | |
| `ofcFnRequestDecided` | Request {{decision}}. | An {{decision}} bukatar. | ☐ | |
| `ofcFnRecordSettlementTitle` | Record a settlement | Rubuta biyan kudi | ☐ | |
| `ofcFnRecordSettlementAction` | Record settlement | Rubuta biya | ☐ | |
| `ofcFnRecordPayment` | Record payment | Rubuta biyan kudi | ☐ | |
| `ofcFnThreeWay` | Three-way reconciliation | Daidaita lissafi ta hanyoyi uku | ☐ | |
| `ofcFnThreeWayBody` | Platform transaction against gateway transaction against government settlement. Anything that does not match becomes an exception below. | Ma’amalar dandali a kan ma’amalar tashar biya a kan turawar gwamnati. Duk abin da bai dace ba yana zama kuskure a kasa. | ☐ | |
| `ofcFnRunReconciliation` | Run reconciliation | Gudanar da daidaita lissafi | ☐ | |
| `ofcFnRecoverMissed` | Recover missed confirmations | Dawo da tabbatarwar da aka rasa | ☐ | |
| `ofcFnRecoverMissedBody` | "Recover missed confirmations" re-checks payments the gateway completed but the platform never confirmed — normally a webhook that never arrived — and issues the receipts owed. | “Dawo da tabbatarwar da aka rasa” yana sake duba biyan kudin da tashar ta kammala amma dandalin bai taba tabbatarwa ba — yawanci sakon da bai iso ba — kuma yana bayar da rasit din da ake bin sa. | ☐ | |
| `ofcFnStatementBody` | What the gateway paid into the government account, and the collections it covers. The platform adds up those collections itself; if the credit does not match, the batch is recorded as disputed and none of it is settled. | Abin da tashar ta biya cikin asusun gwamnati, da karban da ya shafa. Dandalin da kansa yana hada wadannan karban; idan kudin bai dace ba, ana rubuta rukunin a matsayin mai takaddama kuma ba a tura komai daga cikinsa. | ☐ | |
| `ofcFnValueDate` | Value date | Ranar darajar kudi | ☐ | |
| `ofcFnBankReference` | Bank reference | Lambar banki | ☐ | |
| `ofcFnCredited` | Credited (₦) | An shigar (₦) | ☐ | |
| `ofcFnGatewayReferences` | Gateway references | Lambobin tashar biya | ☐ | |
| `ofcFnAwaitingSettlement` | Awaiting settlement from the gateway | Ana jiran turawa daga tashar biya | ☐ | |
| `ofcFnAwaitingSettlementBody` | Confirmed by the gateway and not yet paid into the government account. Normal for a day or two; nobody has to do anything with these. Anything older than three days has moved to the exception queue below, because by then the money should have arrived. | Tashar ta tabbatar kuma ba a biya cikin asusun gwamnati ba tukuna. Abu ne na yau da kullum na kwana daya ko biyu; babu wanda ya kamata ya yi wani abu da wadannan. Duk abin da ya wuce kwana uku ya koma jerin kura-kurai a kasa, saboda a lokacin kudin ya kamata ya iso. | ☐ | |
| `ofcFnExceptionQueue` | Exception queue | Jerin kura-kurai | ☐ | |
| `ofcFnExceptionQueueBody` | Every exception is a finance officer’s task. Nothing here is written off automatically. Money still inside the gateway’s settlement window is above, not here. | Kowane kuskure aikin jami’in kudi ne. Ba a share komai a nan ta atomatik ba. Kudin da har yanzu yake cikin lokacin turawa na tashar yana sama, ba nan ba. | ☐ | |
| `ofcFnResolve` | Resolve | Warware | ☐ | |
| `ofcFnSettlements` | Settlements to government accounts | Turawa zuwa asusun gwamnati | ☐ | |
| `ofcFnCloseDispute` | Close dispute | Rufe takaddama | ☐ | |
| `ofcFnDisputeBody` | A settlement whose credit does not match the collections it covers settles none of them: the money has not arrived, so the commission on it is not payable. Closing the dispute needs a second finance officer and a credit that accounts for the batch in full. | Turawar da kudinta bai dace da karban da ta shafa ba, ba ta tura ko daya daga cikinsu: kudin bai iso ba, don haka ba a biyan kwamishan a kansa. Rufe takaddamar yana bukatar jami’in kudi na biyu da kudin da ya yi lissafin rukunin gaba daya. | ☐ | |
| `ofcFnCommissionPayouts` | Commission payouts | Biyan kwamishan | ☐ | |
| `ofcFnCommissionBody` | Commission is calculated by the platform from verified government revenue. It is never deducted from what a taxpayer pays, and never payable on a reversed transaction. | Dandalin ne ke lissafa kwamishan daga harajin gwamnati da aka tabbatar. Ba a taba cire shi daga abin da mai biyan haraji ya biya ba, kuma ba a taba biyan sa a kan ma’amalar da aka juyar ba. | ☐ | |
| `ofcFnPromoteEligible` | Promote eligible commission | Daga kwamishan da ya cancanta | ☐ | |
| `ofcFnTransferFailed` | Transfer failed | Turawa ta gaza | ☐ | |
| `ofcFnMakerChecker` | Maker-checker approvals | Amincewar mai yi da mai duba | ☐ | |
| `ofcFnMakerCheckerBody` | The officer who raises a request can never review or authorise it. Reversals need a third officer to execute, with step-up authentication. | Jami’in da ya daga bukata ba zai taba duba ta ko ba ta izini ba. Juyarwa tana bukatar jami’i na uku ya aiwatar, tare da karin tantancewa. | ☐ | |
| `ofcFnApproved` | Approved | An amince | ☐ | |
| `ofcFnRejected` | Rejected | An ki | ☐ | |
| `ofcFnExecuted` | Executed | An aiwatar | ☐ | |
| `ofcFnYourRequest` | Your request | Bukatarka | ☐ | |
| `ofcFnExecuteReversal` | Execute reversal | Aiwatar da juyarwa | ☐ | |
| `ofcFnNotYourRole` | Settlement figures are not available to your role | Adadin turawa ba ya samuwa ga matsayinka | ☐ | |
| `ofcFnTotalExpected` | Total expected | Jimlar da ake tsammani | ☐ | |
| `ofcFnTotalReceived` | Total received | Jimlar da aka karba | ☐ | |
| `ofcFnVariance` | Variance | Bambanci | ☐ | |
| `ofcFnAsOnStatement` | As it appears on the statement | Kamar yadda yake a takardar banki | ☐ | |
| `ofcFnOnePerLine` | One per line, or separated by commas | Daya a kowane layi, ko a raba da wakafi | ☐ | |
| `ofcFnException` | Exception | Kuskure | ☐ | |
| `ofcFnDate` | Date | Rana | ☐ | |
| `ofcFnPayout` | Payout | Biya | ☐ | |
| `ofcFnEntries` | Entries | Shigarwa | ☐ | |
| `ofcFnBankAccount` | Bank account | Asusun banki | ☐ | |
| `ofcFnRequestedBy` | Requested by | Wanda ya nema | ☐ | |
| `ofcFnSettlementClosed` | {{reference}} closed. {{n}} collection(s) settled. | An rufe {{reference}}. An daidaita tarin kudi {{n}}. | ☐ | |
| `ofcFnPromotedForPayout` | {{n}} commission record(s) became eligible for payout. | Rikodin kwamishan {{n}} sun cancanci a biya su. | ☐ | |
| `ofcFnSettlementRecorded` | {{reference}} recorded. {{count}} collection(s) settled. | An yi rijistar {{reference}}. An daidaita tarin kudi {{count}}. | ☐ | |
| `ofcFnSettlementDisputed` | {{reference}} recorded and disputed: the credit does not match the collections it covers, so none of them have been settled. Close the dispute once the rest of the money is accounted for. | An yi rijistar {{reference}} kuma an yi takaddama: kudin da aka shigar bai yi daidai da tarin kudin da ya shafa ba, don haka ba a daidaita ko daya daga cikinsu ba. Ka rufe takaddamar idan an gano sauran kudin. | ☐ | |
| `ofcFnTotalCreditedPrompt` | Total now credited against {{reference}}, in naira.  | Jimlar kudin da aka shigar kan {{reference}}, a naira.  | ☐ | |
| `ofcFnReconciliationAborted` | Reconciliation did not run: {{reason}}  | Ba a gudanar da daidaitawa ba: {{reason}}  | ☐ | |
| `ofcFnStatementUnavailable` | the gateway statement could not be retrieved. | ba a iya samun bayanin kudi na kofar biyan kudi ba. | ☐ | |
| `ofcFnReconciliationComplete` | Reconciliation complete: {{matched}} matched, {{exceptions}} exception(s) | An kammala daidaitawa: {{matched}} sun yi daidai, {{exceptions}} ba su yi daidai ba | ☐ | |
| `ofcFnReconciliationUnchecked` | , {{count}} reference(s) the gateway could not be asked about | , lambobi {{count}} da ba a iya tambayar kofar biyan kudi a kansu ba | ☐ | |
| `ofcFnTotalsAgree` | . Platform total and gateway total agree. | . Jimlar dandali da jimlar kofar biyan kudi sun yi daidai. | ☐ | |
| `ofcFnTotalsDisagree` | . Platform total and gateway total DO NOT agree. | . Jimlar dandali da jimlar kofar biyan kudi BA SU YI daidai BA. | ☐ | |
| `ofcFnRecoverChecked` | Checked {{attempted}} unconfirmed payment(s) against the gateway; {{verified}} were confirmed and have now been receipted. | An duba biyan kudi {{attempted}} da ba a tabbatar ba a kofar biyan kudi; an tabbatar da {{verified}} kuma an ba su rasit yanzu. | ☐ | |
| `ofcFnReversalExecuted` | Reversal executed as {{reference}}. {{count}} commission record(s) reversed. | An zartar da juyawa a matsayin {{reference}}. An juyar da bayanan kwamishan {{count}}. | ☐ | |
| `ofcFnBankReferenceForThe` | Bank reference for the credit that settles it | Lambar banki na kudin da ya kammala shi | ☐ | |
| `ofcFnBankTransferReferenceAt` | Bank transfer reference (at least 3 characters): | Lambar tura kudi ta banki (akalla haruffa 3): | ☐ | |
| `ofcFnEnterTheCreditedAmount` | Enter the credited amount in naira, for example 1250000.00. | Ka shigar da adadin da aka shigar a naira, misali 1250000.00. | ☐ | |
| `ofcFnItHasToAccount` | It has to account for the collections in the batch in full. | Dole ne ya biya karbar da ke cikin rukunin gaba daya. | ☐ | |
| `ofcFnListTheGatewayReferences` | List the gateway references this credit covers. | Ka jera lambobin shigarwar da wannan kudi ya kunsa. | ☐ | |
| `ofcFnNothingWasComparedFor` | Nothing was compared for this period, so nothing about it has been confirmed. Try again once the gateway is reachable. | Ba a kwatanta komai a wannan lokaci ba, don haka ba a tabbatar da komai game da shi ba. Ka sake gwadawa idan an samu shigarwar. | ☐ | |
| `ofcFnReRunThisPeriod` | Re-run this period once the gateway is reachable. | Ka sake gudanar da wannan lokaci idan an samu shigarwar. | ☐ | |
| `ofcFnReasonForApprovingThis` | Reason for approving this payout (at least 5 characters): | Dalilin amincewa da wannan fitar da kudi (akalla haruffa 5): | ☐ | |
| `ofcFnReasonForThisDecision` | Reason for this decision (at least 10 characters): | Dalilin wannan shawara (akalla haruffa 10): | ☐ | |
| `ofcFnRecordHowThisException` | Record how this exception was resolved (at least 10 characters): | Ka rubuta yadda aka warware wannan matsala (akalla haruffa 10): | ☐ | |
| `ofcFnWhatDidTheBank` | What did the bank say? (at least 10 characters) | Me banki ya ce? (akalla haruffa 10) | ☐ | |
| `ofcFnWhatTheVarianceTurned` | What the variance turned out to be | Abin da bambancin ya zamo | ☐ | |

#### The officer portal — fraud and the audit trail

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcOvSignalCount` | How many | Nawa | ☐ | |
| `ofcOvSignalWindowSeconds` | Within, in seconds | A cikin, da dakiku | ☐ | |
| `ofcOvSignalThreshold` | Threshold | Iyaka | ☐ | |
| `ofcOvSignalReason` | Reason | Dalili | ☐ | |
| `ofcOvSignalAgentsSupported` | Agents supported | Wakilan da aka goyi baya | ☐ | |
| `ofcOvSignalAgentAssignedTo` | Agent assigned to | Wakilin da aka ba | ☐ | |
| `ofcOvSignalCollectedIn` | Collected in | An karba a | ☐ | |
| `ofcOvSignalAgentTerritory` | The agent’s area | Yankin wakili | ☐ | |
| `ofcOvSignalTransactionArea` | Where the collection happened | Inda aka karbi kudin | ☐ | |
| `ofcOvFlagNoteTooShort` | Record what you found, in at least 10 characters. It is the only record of why this flag was settled the way it was. | Ka rubuta abin da ka gano, da akalla haruffa 10. Shi ne kadai bayanin dalilin da ya sa aka warware wannan alamar haka. | ☐ | |
| `ofcOvFlagConfirmed` | Flag confirmed. The agent’s commission has been placed on hold pending resolution. | An tabbatar da alamar. An dakatar da kwamishan wakilin har sai an warware. | ☐ | |
| `ofcOvFlagMarked` | Flag marked {{decision}}. | An sanya wa alamar {{decision}}. | ☐ | |
| `ofcOvTransactionCount` | {{n}} transaction(s) | Ma’amaloli {{n}} | ☐ | |
| `ofcOvSettlementsOutstanding` | {{n}} settlement(s) outstanding | Turawar kudi {{n}} da ta rage | ☐ | |
| `ofcOvIntact` | Audit trail intact | Rajistar bincike ba ta lalace ba | ☐ | |
| `ofcOvChainIntact` | Verified over {{count}} entries. No tampering detected. | An tantance shigarwa {{count}}. Ba a sami wata alamar taba ba. | ☐ | |
| `ofcOvChainGenesisRemoved` | Broken at entry {{sequence}}: the oldest entry names a predecessor that is not there, so the beginning of the log has been removed. | An karye a shigarwa {{sequence}}: shigarwa mafi tsufa tana nuni da wanda ya gabace ta amma ba ya nan, don haka an cire farkon rajistar. | ☐ | |
| `ofcOvChainLinkMismatch` | Broken at entry {{sequence}}: an entry is missing, or was inserted out of order. | An karye a shigarwa {{sequence}}: akwai shigarwa da ta bata, ko kuma an sanya ta ba bisa tsari ba. | ☐ | |
| `ofcOvChainContentModified` | Broken at entry {{sequence}}: the entry's content does not match its recorded hash, so the row was changed after it was written. | An karye a shigarwa {{sequence}}: abin da ke cikin shigarwar bai yi daidai da hash da aka ajiye ba, don haka an canza layin bayan an rubuta shi. | ☐ | |
| `ofcOvSystem` | System | Tsarin | ☐ | |
| `ofcOvNoRows` | No rows | Babu layuka | ☐ | |
| `ofcOvLeakageTitle` | Revenue leakage monitoring | Sa ido kan yoyon haraji | ☐ | |
| `ofcOvSignalsBody` | Signals are raised for review, never acted on automatically. No transaction is deleted or blocked by a heuristic. | Ana daga alamu domin a duba su, ba a taba aiki da su ta atomatik ba. Babu ma’amalar da ake sharewa ko hanawa ta hanyar kiyasi. | ☐ | |
| `ofcOvSweepBody` | The sweep re-runs every heuristic over the current data and raises what it finds. It raises flags for a person to judge and changes no transaction, so running it is safe — but it is a deliberate act rather than something that happens quietly, which is why it is a button. | Sharewar tana sake gudanar da kowane kiyasi a kan bayanan yanzu kuma tana daga abin da ta gano. Tana daga alamu domin mutum ya yanke hukunci kuma ba ta canza wata ma’amala ba, don haka gudanar da ita ba shi da hadari — amma aiki ne na gangan maimakon abin da ke faruwa a shiru, shi ya sa maballi ne. | ☐ | |
| `ofcOvAgentsWithFlags` | Agents with open flags | Wakilan da ke da alamu a bude | ☐ | |
| `ofcOvFraudSignals` | Fraud signals | Alamun zamba | ☐ | |
| `ofcOvUnderReview` | Under review | Ana dubawa | ☐ | |
| `ofcOvDismissed` | Dismissed | An soke | ☐ | |
| `ofcOvConfirm` | Confirm | Tabbatar | ☐ | |
| `ofcOvDismiss` | Dismiss | Soke | ☐ | |
| `ofcOvUnattendedWork` | Unattended work | Aikin da babu mai kula | ☐ | |
| `ofcOvOpenFlags` | Open flags | Alamu a bude | ☐ | |
| `ofcOvHighestSeverity` | Highest severity | Mafi girman hadari | ☐ | |
| `ofcOvAuditTrail` | Audit trail | Rajistar bincike | ☐ | |
| `ofcOvChainBody` | Every entry is chained to the one before it. Editing or removing any historical entry breaks the chain and is detected by the check below. | An sarkafa kowace shigarwa da wadda ta gabace ta. Gyara ko cire wata shigarwar tarihi yana karya sarkar kuma duban da ke kasa yana gano hakan. | ☐ | |
| `ofcOvVerifyChain` | Verify chain integrity | Tantance ingancin sarkar | ☐ | |
| `ofcOvStandardQuestions` | Standard audit questions | Tambayoyin bincike na yau da kullum | ☐ | |
| `ofcOvStandardQuestionsBody` | Answerable without querying production tables directly. | Ana iya amsa su ba tare da bincika teburan aiki kai tsaye ba. | ☐ | |
| `ofcOvEntityType` | Entity type | Nau’in abu | ☐ | |
| `ofcOvAction` | Action | Aiki | ☐ | |
| `ofcOvFindTheTaxpayer` | Find the taxpayer | Nemo mai biyan haraji | ☐ | |
| `ofcOvUnreconciled48h` | Unreconciled over 48h | Ba a daidaita ba sama da awa 48 | ☐ | |
| `ofcOvSettlementShortfall` | Settlement shortfall | Karancin turawa | ☐ | |
| `ofcOvDuplicatePayments` | Duplicate payments | Biyan kudi sau biyu | ☐ | |
| `ofcOvFailedVerifications` | Failed receipt verifications | Tantance rasit da suka gaza | ☐ | |
| `ofcOvNoValidReceipt` | Public checks that found no valid receipt | Duban jama’a da bai samu rasit mai inganci ba | ☐ | |
| `ofcOvEntityPlaceholder` | payment, agent, taxpayer… | biyan kudi, wakili, mai biyan haraji… | ☐ | |
| `ofcOvActionPlaceholder` | payment.verified | payment.verified | ☐ | |
| `ofcOvReversedAfterPayment` | Transactions reversed after successful payment | Ma’amalolin da aka juyar bayan biyan kudi ya yi nasara | ☐ | |
| `ofcOvAllRateChanges` | All changes made to revenue rates | Dukkan canje-canjen kudin haraji | ☐ | |
| `ofcOvOneAgentCollected` | Everything one agent collected | Duk abin da wakili daya ya karba | ☐ | |
| `ofcOvReceiptsOneItem` | Receipts issued under one revenue item | Rasit din da aka bayar a karkashin nau’in haraji daya | ☐ | |
| `ofcOvWhoLookedAtRecord` | Who has looked at one taxpayer’s record | Wa ya duba rikodin mai biyan haraji daya | ☐ | |
| `ofcOvJob` | Job | Aiki | ☐ | |
| `ofcOvRuns` | Runs | Gudanarwa | ☐ | |
| `ofcOvLastSucceeded` | Last succeeded | Nasara ta karshe | ☐ | |
| `ofcOvWhatThatMeans` | What that means | Abin da hakan ke nufi | ☐ | |
| `ofcOvActor` | Actor | Mai aikatawa | ☐ | |
| `ofcOvEntity` | Entity | Abu | ☐ | |
| `ofcOvResult` | Result | Sakamako | ☐ | |
| `ofcOvHash` | Hash | Sa hannu | ☐ | |
| `ofcOvTampered` | Audit trail has been tampered with | An taba rajistar bincike | ☐ | |
| `ofcOvChange` | What changed | Abin da ya canza | ☐ | |
| `ofcOvSweepRaised` | Sweep complete. {{count}} flag(s) raised for review. | An kammala bincike. An daga tuta {{count}} domin dubawa. | ☐ | |
| `ofcOvJobsNeedAttention` | {{count}} of {{total}} scheduled jobs need attention. A job that is not running produces nothing to look at, so this is the only place it shows. | Ayyuka {{count}} daga cikin {{total}} da aka tsara suna bukatar kulawa. Aikin da ba ya gudana ba ya haifar da abin dubawa, don haka nan kadai yake bayyana. | ☐ | |
| `ofcOvJobHealthy` | Running on schedule. | Yana gudana bisa tsarin lokaci. | ☐ | |
| `ofcOvJobRunning` | Running now. | Yana gudana yanzu. | ☐ | |
| `ofcOvJobOverdue` | Has not started when it should have. The schedule itself may have stopped. | Bai fara a lokacin da ya kamata ba. Wataran tsarin lokacin kansa ya tsaya. | ☐ | |
| `ofcOvJobStalled` | Started and never finished. Whichever instance was running it did not come back. | Ya fara amma bai kammala ba. Wurin da yake gudana bai dawo ba. | ☐ | |
| `ofcOvJobFailing` | Failed {{count}} times in a row: {{error}} | Ya gaza sau {{count}} a jere: {{error}} | ☐ | |
| `ofcOvJobNeverRun` | Has not run once since this database was created. | Bai taba gudana ba tun lokacin da aka kirkiri wannan ma’ajiyar bayanai. | ☐ | |
| `ofcOvJobNoReason` | no reason recorded | ba a rubuta dalili ba | ☐ | |
| `ofcOvEverySeconds` | every {{n}}s | kowane dakika {{n}} | ☐ | |
| `ofcOvEveryMinutes` | every {{n}} min | kowane minti {{n}} | ☐ | |
| `ofcOvEveryHours` | every {{n}} h | kowane awa {{n}} | ☐ | |
| `ofcOvEveryScheduledJobHas` | Every scheduled job has run recently and succeeded. | Kowane aikin da aka tsara ya gudana kwanan nan kuma ya yi nasara. | ☐ | |
| `ofcOvId` | Id | Lamba | ☐ | |
| `ofcOvLoading` | Loading… | Ana lodi… | ☐ | |
| `ofcOvNoTaxpayerMatchedThat` | No taxpayer matched that search | Babu mai biyan haraji da ya dace da wannan bincike | ☐ | |
| `ofcOvNothingToChooseFrom` | Nothing to choose from | Babu abin da za a zaba | ☐ | |
| `ofcOvRecordWhatYouFound` | Record what you found (at least 10 characters): | Ka rubuta abin da ka gano (akalla haruffa 10): | ☐ | |
| `ofcOvRunAFraudSweep` | Run a fraud sweep now | Gudanar da sharewar zamba yanzu | ☐ | |
| `ofcOvRunThisQuery` | Run this query | Gudanar da wannan tambaya | ☐ | |
| `ofcOvRunning` | Running… | Ana gudanarwa… | ☐ | |
| `ofcOvSearchForATaxpayer` | Search for a taxpayer first | Ka fara neman mai biyan haraji | ☐ | |
| `ofcOvSelectOne` | Select one | Ka zabi daya | ☐ | |
| `ofcOvSweepCompleteNothingNew` | Sweep complete. Nothing new was flagged. | An kammala sharewar. Ba a sami sabon abin gargadi ba. | ☐ | |
| `ofcOvSweeping` | Sweeping… | Ana sharewa… | ☐ | |
| `ofcOvTheAuditTrailCould` | The audit trail could not be checked just now. This is not a finding about the trail — try again, and tell support if it persists. | Ba a iya duba tarihin binciken a yanzu ba. Wannan ba bincike ba ne a kan tarihin — ka sake gwadawa, ka kuma sanar da tallafi idan ya ci gaba. | ☐ | |
| `ofcOvWhichAgent` | Which agent? | Wane wakili? | ☐ | |
| `ofcOvWhichRevenueItem` | Which revenue item? | Wane nau’in haraji? | ☐ | |
| `ofcOvWhichTaxpayer` | Which taxpayer? | Wane mai biyan haraji? | ☐ | |

#### The officer portal — the revenue catalogue

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcCfRateHistoryFor` | Rate history — {{name}} | Tarihin kudin — {{name}} | ☐ | |
| `ofcCfChangeRateFor` | Change rate — {{name}} | Canja kudin — {{name}} | ☐ | |
| `ofcCfBeneficiariesFor` | Beneficiaries — {{name}} | Masu amfana — {{name}} | ☐ | |
| `ofcCfCatalogueIntro` | Revenue items and their rates are government configuration, not code. Changing a rate creates a new version with an effective date — it never rewrites what was already assessed. | Nau’ikan haraji da kudinsu saitin gwamnati ne, ba lambar kwamfuta ba. Canza kudi yana samar da sabuwar siga da ranar fara aiki — ba ya taba sake rubuta abin da aka riga aka kima. | ☐ | |
| `ofcCfAddRevenueItem` | Add a revenue item | Kara nau’in haraji | ☐ | |
| `ofcCfHistoricalAssessments` | Historical assessments remain attached to the version in force when they were raised. | Kimar tarihi tana nan a hade da sigar da ke aiki a lokacin da aka yi su. | ☐ | |
| `ofcCfChangeRate` | Change rate | Canza kudi | ☐ | |
| `ofcCfNewRevenueItem` | New revenue item | Sabon nau’in haraji | ☐ | |
| `ofcCfCreatedWithoutPrice` | The item is created without a price. Set its rate afterwards with “Change rate” — until you do, an agent cannot assess it in the field. | Ana samar da nau’in ba tare da kudi ba. Ka saita kudinsa daga baya da “Canza kudi” — har sai ka yi, wakili ba zai iya kima da shi a filin aiki ba. | ☐ | |
| `ofcCfChooseCategory` | Choose a category | Zabi rukuni | ☐ | |
| `ofcCfHowOften` | How often it is charged | Sau nawa ake caji | ☐ | |
| `ofcCfWhatItIsFor` | What it is for | Don me ne shi | ☐ | |
| `ofcCfWhoItApplies` | Who it applies to | Wa ya shafa | ☐ | |
| `ofcCfSelfAssessable` | A taxpayer may assess this themselves | Mai biyan haraji zai iya kima wannan da kansa | ☐ | |
| `ofcCfCommissionable` | An agent earns commission on it | Wakili yana samun kwamishan a kansa | ☐ | |
| `ofcCfWhatIsHappening` | What is happening to this item | Me ke faruwa da wannan nau’in | ☐ | |
| `ofcCfSuspendOption` | Suspend — pause collection while something is settled | Dakatar — a tsayar da karba yayin da ake sasanta wani abu | ☐ | |
| `ofcCfRetireOption` | Retire — the charge has ended, and cannot be brought back | Yi ritaya — cajin ya kare, kuma ba za a iya mayar da shi ba | ☐ | |
| `ofcCfRetireWarning` | Retiring cannot be undone. If the charge is reintroduced later it needs a new revenue item, with its own code and rate. | Ba za a iya soke ritaya ba. Idan aka sake kawo cajin daga baya yana bukatar sabon nau’in haraji, da lambarsa da kudinsa. | ☐ | |
| `ofcCfCurrentVersionStays` | The current version stays on record and keeps applying to assessments already raised. | Sigar yanzu tana nan a rikodi kuma tana ci gaba da shafar kimar da aka riga aka yi. | ☐ | |
| `ofcCfRateType` | Rate type | Nau’in kudi | ☐ | |
| `ofcCfFixedAmount` | Fixed amount | Adadi tsayayye | ☐ | |
| `ofcCfPercentage` | Percentage | Kaso cikin dari | ☐ | |
| `ofcCfNewAmount` | New amount (₦) | Sabon adadi (₦) | ☐ | |
| `ofcCfNewRate` | New rate (%) | Sabon kudi (%) | ☐ | |
| `ofcCfEffectiveFrom` | Effective from | Zai fara aiki daga | ☐ | |
| `ofcCfReasonForChange` | Reason for the change (minimum 10 characters) | Dalilin canjin (akalla haruffa 10) | ☐ | |
| `ofcCfRate` | Rate | Kudi | ☐ | |
| `ofcCfChangedBy` | Changed by | Wanda ya canza | ☐ | |
| `ofcCfFrequency` | Frequency | Yawan lokaci | ☐ | |
| `ofcCfCurrentRate` | Current rate | Kudin yanzu | ☐ | |
| `ofcCfOnSale` | On sale | A kan sayarwa | ☐ | |
| `ofcCfSampleReason` | Approved under the 2026 revenue review, Executive Council minute 14/2026. | An amince a karkashin nazarin harajin 2026, rubutun Majalisar Zartaswa 14/2026. | ☐ | |
| `ofcCfProgrammesTitle` | Social incentive programmes | Shirye-shiryen tallafin jama’a | ☐ | |
| `ofcCfProgrammesIntro` | Programmes record who qualifies for a government benefit and why. They add entitlement — they never withdraw a service. Each citizen with a TIN who meets the criteria automatically qualifies when evaluated. | Shirye-shirye suna rubuta wanda ya cancanci tallafin gwamnati da dalilin haka. Suna kara hakki — ba sa taba janye hidima. Kowane dan kasa mai TIN da ya cika sharuda yana cancanta ta atomatik idan aka duba. | ☐ | |
| `ofcCfEssentialServiceLink` | A programme that links an essential public service to tax compliance can only be created if the legal or policy authority for that linkage is recorded against it. | Ana iya samar da shirin da ke hada muhimmiyar hidimar jama’a da biyan haraji ne kawai idan an rubuta ikon doka ko manufa na wannan hadin a kansa. | ☐ | |
| `ofcCfBeneficiaries` | Beneficiaries | Masu amfana | ☐ | |
| `ofcCfNoEligibleYet` | No eligible taxpayers yet. Run "Evaluate all" to assess the active taxpayer population. | Babu masu biyan haraji da suka cancanta tukuna. Ka gudanar da “Duba duka” domin auna masu biyan harajin da ke aiki. | ☐ | |
| `ofcCfEssentialProtected` | Essential services are protected | An kare muhimman hidimomi | ☐ | |
| `ofcCfBenefit` | Benefit | Tallafi | ☐ | |
| `ofcCfMinScore` | Min. score | Mafi karancin maki | ☐ | |
| `ofcCfRequiresNoArrears` | Requires no arrears | Yana bukatar babu bashi | ☐ | |
| `ofcCfEligible` | Eligible | Ya cancanta | ☐ | |
| `ofcCfEvaluated` | Evaluated | An duba | ☐ | |
| `ofcCfEvaluatedCount` | {{n}} citizen(s) evaluated against this programme. | An auna ’yan kasa {{n}} bisa wannan shirin. | ☐ | |
| `ofcCfItemAdded` | {{name}} has been added to the catalogue. It has no rate yet, so it cannot be assessed until you set one. | An kara {{name}} a cikin jerin. Ba shi da adadin kudi tukuna, don haka ba za a iya yin kima ba sai ka saita daya. | ☐ | |
| `ofcCfNotAnAmount` | “{{amount}}” is not an amount in naira. Enter it as 15000 or 15000.00. | “{{amount}}” ba adadi ne a naira ba. Ka shigar da shi kamar 15000 ko 15000.00. | ☐ | |
| `ofcCfNotAPercentage` | “{{value}}” is not a percentage. Enter it as 5 or 5.00. | “{{value}}” ba kaso ne ba. Ka shigar da shi kamar 5 ko 5.00. | ☐ | |
| `ofcCfRateRecorded` | A new rate version for “{{name}}” has been recorded, effective {{date}}.  | An yi rijistar sabon adadin kudi na “{{name}}”, mai aiki daga {{date}}.  | ☐ | |
| `ofcCfProgrammeStatus` | Programme “{{name}}” is now {{status}}. | Shirin “{{name}}” yanzu {{status}}. | ☐ | |
| `ofcCfRateCannotBeNegative` | A rate cannot be negative. | Adadin kudi ba zai iya zama kasa da sifili ba. | ☐ | |
| `ofcCfPercentageCannotExceed100` | A percentage rate cannot be more than 100%. | Kaso ba zai iya wuce 100% ba. | ☐ | |
| `ofcCfActivate` | Activate | Kunna | ☐ | |
| `ofcCfAddToTheCatalogue` | Add to the catalogue | Kara a cikin kundin | ☐ | |
| `ofcCfAdding` | Adding… | Ana karawa… | ☐ | |
| `ofcCfBusinesses` | Businesses | Kasuwanci | ☐ | |
| `ofcCfCalculatedByFormula` | Calculated by formula | An kirga ta hanyar tsari | ☐ | |
| `ofcCfCurrent` | Current | Na yanzu | ☐ | |
| `ofcCfEnterTheNewAmount` | Enter the new amount. Leave nothing to chance \u2014 type 0 if the levy is being suspended. | Ka shigar da sabon adadin. Kada ka bar komai a zato — ka rubuta 0 idan ana dakatar da harajin. | ☐ | |
| `ofcCfEnterTheNewRate` | Enter the new rate as a percentage. Type 0 if the levy is being suspended. | Ka shigar da sabon farashin a matsayin kaso. Ka rubuta 0 idan ana dakatar da harajin. | ☐ | |
| `ofcCfEvaluateAll` | Evaluate all | Auna duka | ☐ | |
| `ofcCfEvaluating` | Evaluating… | Ana auna… | ☐ | |
| `ofcCfExistingAssessmentsAreUnaffected` | Existing assessments are unaffected. | Kimantawar da ake da ita ba za ta shafu ba. | ☐ | |
| `ofcCfForExampleRepealedBy` | For example: repealed by the Plateau State Finance Law amendment. | Misali: an soke shi ta gyaran Dokar Kudi ta Jihar Filato. | ☐ | |
| `ofcCfGiveAReasonFor` | Give a reason for the rate change, in at least 10 characters. | Ka bayar da dalilin canjin farashin, a cikin akalla haruffa 10. | ☐ | |
| `ofcCfIndividuals` | Individuals | Mutane | ☐ | |
| `ofcCfNoApprovedRateIn` | No approved rate in force | Babu farashin da aka amince da shi a aiki | ☐ | |
| `ofcCfNoNewAssessmentCan` | No new assessment can be raised against a withdrawn item. Invoices already issued stay payable — withdrawing an item is not a decision to write off arrears. | Ba za a iya yin sabon kimantawa a kan nau’in da aka janye ba. Takardun da aka riga aka bayar suna nan a biya — janye nau’i ba shawara ba ce ta yafe bashin da ake bin mutane. | ☐ | |
| `ofcCfNotEligible` | Not eligible | Bai cancanta ba | ☐ | |
| `ofcCfOfAssessableAmount` | % of assessable amount | % na adadin da ake kimantawa | ☐ | |
| `ofcCfProgressiveBands` | Progressive bands | Matakan haraji masu hawa | ☐ | |
| `ofcCfRecordNewRateVersion` | Record new rate version | Rubuta sabon salon farashi | ☐ | |
| `ofcCfRecording` | Recording… | Ana rubutawa… | ☐ | |
| `ofcCfRestoreItem` | Restore item | Mayar da nau’in | ☐ | |
| `ofcCfTheItemGoesBack` | The item goes back into the catalogue and can be assessed against again. | Nau’in yana komawa cikin kundin kuma ana iya sake kimanta shi. | ☐ | |
| `ofcCfWhatChangedForExample` | What changed — for example, the tariff was confirmed against the gazette. | Me ya canza — misali, an tabbatar da kudin a kan jaridar gwamnati. | ☐ | |
| `ofcCfWithdrawItem` | Withdraw item | Janye nau’in | ☐ | |

#### The officer portal — correcting a record

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcTrRegisterFor` | The register — {{name}} | Rajistar — {{name}} | ☐ | |
| `ofcTrTitle` | Correct a taxpayer record | Gyara rikodin mai biyan haraji | ☐ | |
| `ofcTrIntro` | Every correction is recorded against the officer who made it, with the reason given, and the taxpayer is sent a message telling them their record was changed. Only the fields you fill in are altered. | Ana rubuta kowane gyara da sunan jami’in da ya yi shi, tare da dalilin, kuma ana tura wa mai biyan haraji sako yana gaya masa an canza rikodinsa. Filayen da ka cika kawai ake canzawa. | ☐ | |
| `ofcTrNoMatch` | No taxpayer matches that search. | Babu mai biyan haraji da ya dace da wannan binciken. | ☐ | |
| `ofcTrCorrectedDetails` | Corrected details | Bayanan da aka gyara | ☐ | |
| `ofcTrLeaveBlank` | Leave anything that is already right blank. | Ka bar duk abin da ya riga ya yi daidai babu komai. | ☐ | |
| `ofcTrIdentificationDocument` | Identification document | Takardar shaida | ☐ | |
| `ofcTrDecidesWhichPerson` | This decides which person the record is about, so it is checked against every other active taxpayer before it is accepted. | Wannan yana yanke wanne mutum rikodin ya shafa, don haka ana duba shi da kowane mai biyan haraji mai aiki kafin a karba. | ☐ | |
| `ofcTrUnchanged` | Unchanged | Ba a canza ba | ☐ | |
| `ofcTrNumber` | Number | Lamba | ☐ | |
| `ofcTrNameOrDob` | A name or date of birth can be corrected here. The document the record is held under decides which person it is about, so an administrator has to make that change. | Ana iya gyara suna ko ranar haihuwa a nan. Takardar da aka rike rikodin a kanta ce ke yanke wanne mutum ya shafa, don haka mai gudanarwa ne ya kamata ya yi wannan canjin. | ☐ | |
| `ofcTrWhatAndWhy` | What is being corrected, and why | Abin da ake gyarawa, da dalilin | ☐ | |
| `ofcTrLiableFor` | What this taxpayer is liable for | Abin da wannan mai biyan haraji ke bin sa | ☐ | |
| `ofcTrWaiveBody` | Waiving an obligation stops future assessments against it. Invoices already raised stay payable — cancelling those is a separate decision, invoice by invoice. | Yafe wajibi yana tsayar da kima na gaba a kansa. Takardun biya da aka riga aka yi suna nan a biya — soke su shawara ce daban, takarda bayan takarda. | ☐ | |
| `ofcTrWaive` | Waive | Yafe | ☐ | |
| `ofcTrVehiclesOnRecord` | Vehicles on this record | Motoci a wannan rikodin | ☐ | |
| `ofcTrVehiclesBody` | Particulars cannot be renewed for a vehicle that is suspended or off the register. Renewals already issued stay valid for the period they were paid for. | Ba za a iya sabunta takardun mota da aka dakatar ko da aka cire daga rajistar ba. Sabuntawar da aka riga aka bayar tana nan da inganci na tsawon lokacin da aka biya. | ☐ | |
| `ofcTrTakeOffRegister` | Take off the register | Cire daga rajistar | ☐ | |
| `ofcTrPutBackInService` | Put back in service | Mayar da aiki | ☐ | |
| `ofcTrEndedBody` | A record that is suspended or closed stops accruing new charges and stops receiving reminders. Nothing already owed is written off: it stays payable, stays in the revenue figures, and appears under ended records that still owe until it is settled. | Rikodin da aka dakatar ko aka rufe yana daina tara sabbin caji kuma yana daina samun tunatarwa. Ba a share abin da ake bin sa ba: yana nan a biya, yana nan a adadin haraji, kuma yana bayyana a karkashin rikodin da aka rufe da ake bin su har sai an biya. | ☐ | |
| `ofcTrWhatHappened` | What has happened to this taxpayer | Me ya faru da wannan mai biyan haraji | ☐ | |
| `ofcTrClosedOption` | Closed — the business has shut or the person has died | An rufe — kasuwancin ya rufe ko mutumin ya rasu | ☐ | |
| `ofcTrSuspendedOption` | Suspended — paused pending an enquiry | An dakatar — an tsayar ana jiran bincike | ☐ | |
| `ofcTrActiveOption` | Active — put the record back on the register | Yana aiki — a mayar da rikodin cikin rajistar | ☐ | |
| `ofcTrHowEstablished` | How this was established | Yadda aka tabbatar da wannan | ☐ | |
| `ofcTrSearchPlaceholder` | Name, phone, TIN or receipt number | Suna, waya, TIN ko lambar rasit | ☐ | |
| `ofcTrNeedsAdministrator` | Changing the identification document needs an administrator | Canza takardar shaida yana bukatar mai gudanarwa | ☐ | |
| `ofcTrSampleCorrection` | Surname was misspelt at registration; corrected against the NIN slip presented at the office. | An rubuta sunan mahaifi ba daidai ba a lokacin rajista; an gyara shi da takardar NIN da aka gabatar a ofis. | ☐ | |
| `ofcTrSampleVehicle` | Sold out of state and re-registered in Kaduna. | An sayar da ita a wajen jihar kuma an sake yi mata rajista a Kaduna. | ☐ | |
| `ofcTrSampleClosure` | Premises visited on 12 August: the shop has been empty since the market fire in March. | An ziyarci wurin a 12 ga Agusta: shagon babu kowa tun gobarar kasuwa a watan Maris. | ☐ | |
| `ofcTrRecordedBy` | Recorded by | Wanda ya rubuta | ☐ | |
| `ofcTrVehicleBackInService` | {{plate}} is back in service and its particulars can be renewed. | An maido da {{plate}} aiki kuma za a iya sabunta takardunta. | ☐ | |
| `ofcTrVehicleSuspended` | {{plate}} is suspended. Renewals are refused until it is lifted. | An dakatar da {{plate}}. Ba za a karbi sabuntawa ba sai an dage dakatarwar. | ☐ | |
| `ofcTrVehicleArchived` | {{plate}} has been taken off the register. Renewals are refused. | An cire {{plate}} daga rajista. Ba za a karbi sabuntawa ba. | ☐ | |
| `ofcTrObligationsUpdated` | {{added}} obligation(s) added, {{waived}} waived. | An kara wajibai {{added}}, an yafe {{waived}}. | ☐ | |
| `ofcTrOneDetailCorrected` | One detail on this taxpayer record has been corrected. The change is on the audit trail. | An gyara bayani daya a wannan rikodin mai biyan haraji. Sauyin yana kan tarihin bincike. | ☐ | |
| `ofcTrDetailsCorrected` | {{n}} details on this taxpayer record have been corrected. The change is on the audit trail. | An gyara bayanai {{n}} a wannan rikodin mai biyan haraji. Sauyin yana kan tarihin bincike. | ☐ | |
| `ofcTrOnRegisterAgain` | {{name}} is on the register again and can be assessed. | {{name}} ya koma kan rajista kuma za a iya yi masa kima. | ☐ | |
| `ofcTrRecordEnded` | {{name}} is {{status}}. No new assessment can be raised and reminders stop. | {{name}} yanzu {{status}} ne. Ba za a iya yin sabuwar kima ba kuma tunatarwa za ta tsaya. | ☐ | |
| `ofcTrStillOwedAfterEnding` | What is already owed remains owed, and this record now appears in the queue of ended records with arrears. | Abin da ake bin sa yana nan, kuma wannan rikodin yanzu yana cikin jerin rikodin da aka rufe da ake bin su. | ☐ | |
| `ofcTrNothingWasOutstanding` | Nothing was outstanding. | Babu abin da ya rage. | ☐ | |
| `ofcTrCorrecting` | Correcting… | Ana gyarawa… | ☐ | |
| `ofcTrEnterTheCorrectedValue` | Enter the corrected value in whichever field is wrong. | Ka shigar da darajar da aka gyara a duk filin da ba daidai ba ne. | ☐ | |
| `ofcTrNameTheTypeOf` | Name the type of identification when changing the number. | Ka fadi nau’in shaidar mutum idan kana canza lambar. | ☐ | |
| `ofcTrOnRecordNow` | On record now | Abin da ke rubuce yanzu | ☐ | |
| `ofcTrPutBackOnThe` | Put back on the register | Mayar da shi cikin rijistar | ☐ | |
| `ofcTrRecordThisCorrection` | Record this correction | Rubuta wannan gyara | ☐ | |
| `ofcTrRecording` | Recording… | Ana rubutawa… | ☐ | |
| `ofcTrSayWhatIsBeing` | Say what is being corrected and why, in at least 10 characters. It is the only record of why. | Ka fadi abin da ake gyarawa da dalili, a cikin akalla haruffa 10. Shi ne kadai rikodin dalilin. | ☐ | |

#### The officer portal — outstanding work

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcOsCleared` | Cleared | An share | ☐ | |
| `ofcOsStillOutstanding` | Still outstanding | Har yanzu ya rage | ☐ | |
| `ofcOsReadingNeeds` | Reading this queue needs | Karanta wannan jerin yana bukatar | ☐ | |
| `ofcOsNotYours` | , which your role does not hold. It is not empty — it is not yours. | , wanda matsayinka bai rike ba. Ba fanko ba ne — ba naka ba ne. | ☐ | |
| `ofcOsRefundsOwed` | Refunds owed to taxpayers | Mayarwar da ake bin masu biyan haraji | ☐ | |
| `ofcOsReversalBody` | A reversal voids the receipt immediately; the money comes back only when the gateway confirms it. Until then the taxpayer has not been refunded. | Juyarwa tana soke rasit nan take; kudin yana dawowa ne kawai idan tashar ta tabbatar. Har lokacin ba a mayar wa mai biyan haraji ba. | ☐ | |
| `ofcOsWaitingTinTitle` | Taxpayers waiting for a TIN | Masu biyan haraji da ke jiran TIN | ☐ | |
| `ofcOsWaitingTinBody` | Registered while the PSIRS TIN service could not be reached. They can be assessed and can pay; only the number is missing. | An yi musu rajista yayin da ba a iya samun sashen TIN na PSIRS ba. Za a iya yi musu kima kuma za su iya biya; lambar kadai ce babu. | ☐ | |
| `ofcOsRenewalsUnackTitle` | Renewals the vehicle authority has not acknowledged | Sabuntawar da hukumar motoci ba ta amince da ita ba | ☐ | |
| `ofcOsRenewalsUnackBody` | The renewal itself is valid and paid for. What is outstanding is the authority recording it, which matters the first time the driver is stopped. | Sabuntawar da kanta tana da inganci kuma an biya ta. Abin da ya rage shi ne hukumar ta rubuta ta, wanda ke da muhimmanci a karo na farko da aka tsayar da direba. | ☐ | |
| `ofcOsVehiclesUncheckedTitle` | Vehicles captured without an authority check | Motocin da aka rubuta ba tare da duban hukuma ba | ☐ | |
| `ofcOsVehiclesUncheckedBody` | Recorded from what the owner presented because the authority could not be reached. The details have not been confirmed against the register. | An rubuta daga abin da mai motar ya gabatar saboda ba a iya samun hukumar ba. Ba a tabbatar da bayanan da rajistar ba. | ☐ | |
| `ofcOsEndedOwingTitle` | Ended records that still owe | Rikodin da aka rufe da ake bin su | ☐ | |
| `ofcOsEndedOwingBody` | Closed or suspended while money was outstanding. Nothing has been written off — the reminder sweep has stopped chasing these, so they are worked by hand until they are paid or the record goes back on the register. | An rufe ko an dakatar yayin da ake bin kudi. Ba a share komai ba — tunatarwa ta daina bin wadannan, don haka ana yin su da hannu har sai an biya ko rikodin ya koma rajistar. | ☐ | |
| `ofcOsNothingOutstanding` | Nothing is outstanding | Babu abin da ya rage | ☐ | |
| `ofcOsOwedToTaxpayers` | Owed to taxpayers | Ana bin masu biyan haraji | ☐ | |
| `ofcOsRefundsNotMade` | Refunds not yet made | Mayarwar da ba a yi ba tukuna | ☐ | |
| `ofcOsWaitingForTin` | Waiting for a TIN | Ana jiran TIN | ☐ | |
| `ofcOsRenewalsUnacknowledged` | Renewals unacknowledged | Sabuntawar da ba a amince da ita ba | ☐ | |
| `ofcOsRefund` | Refund | Mayarwa | ☐ | |
| `ofcOsAttempts` | Attempts | Yunkuri | ☐ | |
| `ofcOsWhyNotYet` | Why not yet | Dalilin da bai riga ba | ☐ | |
| `ofcOsLastTried` | Last tried | Gwadawa na karshe | ☐ | |
| `ofcOsOwedSince` | Owed since | Ana bin tun | ☐ | |
| `ofcOsValidUntil` | Valid until | Yana aiki har | ☐ | |
| `ofcOsState` | State | Matsayi | ☐ | |
| `ofcOsOwed` | Owed | Ana bin | ☐ | |
| `ofcOsWhyEnded` | Why it ended | Dalilin da ya sa ya kare | ☐ | |
| `ofcOsEnded` | Ended | Ya kare | ☐ | |
| `ofcOsQueueUnreadable` | A queue could not be read | Ba a iya karanta wani jeri ba | ☐ | |
| `ofcOsQueueUnreadableBody` | {{n}} of the queues on this page could not be loaded, so what is shown is not the whole picture. An empty section below does not mean that queue is empty — it means nobody can see it. Reload, and raise it if it does not clear. | Ba a iya lodin jeri {{n}} a wannan shafi ba, don haka abin da ake nunawa ba shi ne cikakken hoto ba. Sashe mara komai a kasa ba yana nufin jerin babu komai ba — yana nufin babu wanda ke iya ganin sa. Ka sake lodi, kuma ka daga kara idan bai warware ba. | ☐ | |
| `ofcOsRefundsReturned` | {{n}} refund(s) returned to taxpayers. | An mayar da kudi {{n}} ga masu biyan haraji. | ☐ | |
| `ofcOsRefundsPartly` | {{done}} returned; {{left}} still owed. Those taxpayers have not had their money back yet. | An mayar {{done}}; {{left}} har yanzu ana bin su. Wadannan masu biyan haraji ba su samu kudinsu ba tukuna. | ☐ | |
| `ofcOsTinsAssigned` | {{n}} TIN(s) assigned. | An ba da TIN {{n}}. | ☐ | |
| `ofcOsTinsPartly` | {{done}} assigned; {{left}} still outstanding. Those taxpayers remain registered and can still be assessed and pay. | An ba da {{done}}; {{left}} har yanzu ya rage. Wadannan masu biyan haraji na kan rajista kuma za a iya yi musu kima kuma za su iya biya. | ☐ | |
| `ofcOsRenewalsAcked` | {{n}} renewal(s) acknowledged by the vehicle authority. | Hukumar motoci ta amince da sabuntawa {{n}}. | ☐ | |
| `ofcOsRenewalsPartly` | {{done}} acknowledged; {{left}} still could not be sent. The renewals themselves remain valid — retry again later. | An amince da {{done}}; {{left}} har yanzu ba a iya aikawa ba. Sabuntawar da kansu suna da inganci — ka sake gwadawa daga baya. | ☐ | |
| `ofcOsAskTheGatewayAgain` | Ask the gateway again | Sake tambayar shigarwar | ☐ | |
| `ofcOsAskTheTinService` | Ask the TIN service again | Sake tambayar sabis din TIN | ☐ | |
| `ofcOsAskingTheGateway` | Asking the gateway… | Ana tambayar shigarwar… | ☐ | |
| `ofcOsAskingTheTinService` | Asking the TIN service… | Ana tambayar sabis din TIN… | ☐ | |
| `ofcOsEveryQueueYouCan` | Every queue you can see is empty. Others are guarded by permissions your role does not hold. | Duk jerin da za ka iya gani babu komai a ciki. Sauran suna karkashin izinin da matsayinka bai kunsa ba. | ☐ | |
| `ofcOsEveryRefundHasBeen` | Every refund has been returned, every taxpayer has their TIN, and the vehicle authority has acknowledged every renewal. | An mayar da kowane kudi, kowane mai biyan haraji yana da TIN dinsa, kuma hukumar ababen hawa ta amsa kowane sabuntawa. | ☐ | |
| `ofcOsNotAttemptedYet` | Not attempted yet | Ba a gwada ba tukuna | ☐ | |
| `ofcOsSendToTheAuthority` | Send to the authority again | Sake turawa hukumar | ☐ | |
| `ofcOsSendingToTheAuthority` | Sending to the authority… | Ana turawa hukumar… | ☐ | |

#### The officer portal — product usage

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcUsPrivacyBody` | How the software is being used, not who is using it. These figures carry no identity: no officer, agent or taxpayer is named in them, and groups smaller than {{n}} are withheld rather than shown, because a small enough count singles somebody out even without a name. For an individual agent's work, see | Yadda ake amfani da manhajar, ba wanda ke amfani da ita ba. Wadannan lambobi ba su dauke da shaidar kowa: ba a ambaci sunan wani jami’i, wakili ko mai biyan haraji a cikinsu ba, kuma ana boye kungiyoyi kasa da {{n}} maimakon nuna su, domin kidaya karama tana bayyana mutum ko da ba a ambaci sunansa ba. Domin aikin wakili daya, duba | ☐ | |
| `ofcUsStartedCount` | {{n}} started | An fara {{n}} | ☐ | |
| `ofcUsNoAttempts` | No attempts recorded | Ba a rubuta wani yunkuri ba | ☐ | |
| `ofcUsNoAbandonment` | No abandonment point reached {{n}} attempts. | Babu wurin watsarwa da ya kai yunkuri {{n}}. | ☐ | |
| `ofcUsTitle` | Product usage — last 30 days | Amfani da manhaja — kwanaki 30 na karshe | ☐ | |
| `ofcUsReportsCollections` | , which reports collections. | , wanda ke bayar da rahoton karba. | ☐ | |
| `ofcUsIntro` | Usage is reported by the agent application and this portal as they are used. An empty page here means no version carrying the reporting has been deployed yet, or nobody has opened one since it was. | Manhajar wakilai da wannan shafin suna bayar da rahoton amfani yayin da ake amfani da su. Shafi mara komai a nan yana nufin ba a tura sigar da ke dauke da rahoton ba tukuna, ko babu wanda ya bude daya tun lokacin. | ☐ | |
| `ofcUsEveryFlow` | Every flow | Kowane mataki | ☐ | |
| `ofcUsWhereGiveUp` | Where people give up | Inda mutane ke daina | ☐ | |
| `ofcUsWhereGiveUpBody` | The last step an abandoned attempt reached. This is the screen to go and look at — an abandoned registration creates no taxpayer, so nothing else in the platform records that it happened. | Matakin karshe da yunkurin da aka watsar ya kai. Wannan shi ne shafin da za a je a duba — rajistar da aka watsar ba ta samar da mai biyan haraji ba, don haka babu wani abu a dandalin da ke rubuta cewa ya faru. | ☐ | |
| `ofcUsReachBeyondJos` | Reach beyond Jos | Isa bayan Jos | ☐ | |
| `ofcUsReachBody` | Whether the platform works as well in the rural LGAs as in the capital. A completion rate that is fine statewide and poor here is the difference between serving the grassroots and serving Jos. | Ko dandalin yana aiki a Kananan Hukumomin karkara kamar yadda yake a babban birni. Adadin kammalawa mai kyau a fadin jiha amma mara kyau a nan shi ne bambanci tsakanin yi wa talakawa hidima da yi wa Jos hidima. | ☐ | |
| `ofcUsOfflineQueue` | The offline queue | Jerin gwanon ba tare da layi ba | ☐ | |
| `ofcUsScreensReached` | Screens reached | Shafukan da aka kai | ☐ | |
| `ofcUsNothingReported` | Nothing has been reported yet | Ba a bayar da rahoton komai ba tukuna | ☐ | |
| `ofcUsRegistrationsCompleted` | Registrations completed | Rajistar da aka kammala | ☐ | |
| `ofcUsCollectionsCompleted` | Collections completed | Karban da aka kammala | ☐ | |
| `ofcUsMedianRegistration` | Median registration | Matsakaicin rajista | ☐ | |
| `ofcUsStartToFinish` | Start to finish, on the device | Daga fara zuwa karshe, a kan na’ura | ☐ | |
| `ofcUsMedianCollection` | Median collection | Matsakaicin karba | ☐ | |
| `ofcUsUntilHandedOff` | Until payment is handed off | Har sai an mika biyan kudi | ☐ | |
| `ofcUsFlow` | Flow | Mataki | ☐ | |
| `ofcUsStarted` | Started | An fara | ☐ | |
| `ofcUsCompleted` | Completed | An kammala | ☐ | |
| `ofcUsCompletion` | Completion | Kammalawa | ☐ | |
| `ofcUsGivenUp` | Given up | An daina | ☐ | |
| `ofcUsMedianTime` | Median time | Matsakaicin lokaci | ☐ | |
| `ofcUsLastStepReached` | Last step reached | Matakin karshe da aka kai | ☐ | |
| `ofcUsZone` | Zone | Yanki | ☐ | |
| `ofcUsCount` | Count | Adadi | ☐ | |
| `ofcUsMedianDelay` | Median delay | Matsakaicin jinkiri | ☐ | |
| `ofcUsEvents` | Events | Abubuwan da suka faru | ☐ | |
| `ofcUsScreen` | Screen | Shafi | ☐ | |
| `ofcUsViews` | Views | Kallo | ☐ | |
| `ofcUsApplyingToBecomeAn` | Applying to become an agent | Nema domin zama wakili | ☐ | |
| `ofcUsCapturingAVehicle` | Capturing a vehicle | Daukar bayanan mota | ☐ | |
| `ofcUsRegisteringATaxpayer` | Registering a taxpayer | Yin rijistar mai biyan haraji | ☐ | |
| `ofcUsTakingACollection` | Taking a collection | Karbar kudi | ☐ | |

#### The officer portal — the support desk

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcSpOpenComplaints` | {{n}} open complaint(s) about conduct or charges | Korafe-korafe {{n}} a bude kan hali ko kudi | ☐ | |
| `ofcSpAboutRevenue` | These are reports about how revenue was collected, not about the platform. They are listed first below. | Wadannan rahotanni ne kan yadda aka karbi haraji, ba kan dandalin ba. An jera su a farko a kasa. | ☐ | |
| `ofcSpSupportQueue` | Support queue | Jerin gwanon taimako | ☐ | |
| `ofcSpQueueIntro` | Ordered by priority. A ticket is answered in its thread — a status change on its own tells the person who reported it nothing. | An jera bisa muhimmanci. Ana amsa rahoto a cikin zaren sa — canza matsayi kadai ba ya gaya wa wanda ya kai rahoton komai. | ☐ | |
| `ofcSpAssigned` | Assigned | An ba da | ☐ | |
| `ofcSpInProgress` | In progress | Ana kan aiki | ☐ | |
| `ofcSpResolved` | Resolved | An warware | ☐ | |
| `ofcSpClosed` | Closed | An rufe | ☐ | |
| `ofcSpBackToQueue` | Back to the queue | Koma ga jerin gwanon | ☐ | |
| `ofcSpNobodyReplied` | Nobody has replied yet. | Babu wanda ya amsa tukuna. | ☐ | |
| `ofcSpReadOnlyNote` | Replying and moving a ticket need support:manage. You can read everything here, including internal notes. | Amsawa da matsar da rahoto suna bukatar support:manage. Za ka iya karanta komai a nan, hade da bayanan cikin gida. | ☐ | |
| `ofcSpClosedKeepsHistory` | A closed ticket keeps its history. New problems get new tickets. | Rahoton da aka rufe yana rike da tarihinsa. Sabbin matsaloli suna samun sabbin rahotanni. | ☐ | |
| `ofcSpKeepInternal` | Keep this internal — do not show it to the reporter | Ka rike wannan a cikin gida — kada ka nuna wa wanda ya kai rahoton | ☐ | |
| `ofcSpMoveTicket` | Move this ticket | Matsar da wannan rahoton | ☐ | |
| `ofcSpHowResolved` | How was it resolved? | Yaya aka warware shi? | ☐ | |
| `ofcSpResolutionRequired` | A resolution is required before a ticket can be marked resolved, and it is shown to the person who reported it. | Ana bukatar warwarewa kafin a sanya rahoto a matsayin warware, kuma ana nuna ta ga wanda ya kai rahoton. | ☐ | |
| `ofcSpMarkResolved` | Mark resolved | Sanya a matsayin warware | ☐ | |
| `ofcSpResolutionRecorded` | Resolution recorded | An rubuta warwarewa | ☐ | |
| `ofcSpDone` | Done | An gama | ☐ | |
| `ofcSpReadAccess` | You have read access to this ticket | Kana da izinin karanta wannan rahoton | ☐ | |
| `ofcSpTicketClosed` | This ticket is closed | An rufe wannan rahoton | ☐ | |
| `ofcSpTicket` | Ticket | Rahoto | ☐ | |
| `ofcSpSubject` | Subject | Batu | ☐ | |
| `ofcSpPriority` | Priority | Muhimmanci | ☐ | |
| `ofcSpReportedBy` | Reported by | Wanda ya kai rahoto | ☐ | |
| `ofcSpReplies` | Replies | Amsoshi | ☐ | |
| `ofcSpTicketMoved` | Ticket moved to {{status}}. | An mayar da takardar zuwa {{status}}. | ☐ | |
| `ofcSpAddAnInternalNote` | Add an internal note | Kara bayanin cikin gida | ☐ | |
| `ofcSpAssignedTo` | Assigned to | An ba wa | ☐ | |
| `ofcSpContact` | Contact | Hanyar tuntuba | ☐ | |
| `ofcSpInternalNoteSavedThe` | Internal note saved. The reporter cannot see it. | An ajiye bayanin cikin gida. Wanda ya kawo korafin ba zai gan shi ba. | ☐ | |
| `ofcSpNobodyYet` | Nobody yet | Ba wanda ya karba tukuna | ☐ | |
| `ofcSpOnlyStaffWithSupport` | Only staff with support access can read this. The reporter never sees it. | Ma’aikatan da ke da izinin tallafi ne kadai za su iya karanta wannan. Wanda ya kawo korafin ba ya ganin sa ko kadan. | ☐ | |
| `ofcSpReplySent` | Reply sent. | An aika amsar. | ☐ | |
| `ofcSpReplyToTheReporter` | Reply to the reporter | Amsa wa wanda ya kawo korafin | ☐ | |
| `ofcSpSaveInternalNote` | Save internal note | Ajiye bayanin cikin gida | ☐ | |
| `ofcSpSendReply` | Send reply | Aika amsar | ☐ | |
| `ofcSpThisGoesToThe` | This goes to the person who raised the ticket, and they are notified. | Wannan zai je wa wanda ya kawo korafin, kuma za a sanar da shi. | ☐ | |

#### The officer portal — groups and distributions

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcGpRecordDeparture` | Record departure | Rubuta ficewa | ☐ | |
| `ofcGpAwardedNotCollected` | {{n}} beneficiaries were awarded and have not turned up. That is either a distribution that is not reaching people, or names on a list that do not correspond to anybody — worth establishing which before the next round. | An ba {{n}} masu amfana kyauta amma ba su zo ba. Ko dai rabon bai isa ga mutane ba, ko kuma sunaye ne a jerin da ba su dace da kowa ba — ya kamata a tabbatar da wanne kafin zagaye na gaba. | ☐ | |
| `ofcGpMembersFor` | Members — {{name}} | Mambobi — {{name}} | ☐ | |
| `ofcGpEnoughForMore` | enough for {{n}} more | ya isa ga wasu {{n}} | ☐ | |
| `ofcGpConfirmationLinkFor` | Confirmation link for {{group}} | Hanyar tabbatarwa ta {{group}} | ☐ | |
| `ofcGpLeaderCodeOnce` | Send this to the group leader. It is shown once — PSIRS stores only a hash of it, so it cannot be read back later. Request another if it is lost. | Ka tura wannan ga shugaban kungiyar. Ana nuna shi sau daya — PSIRS na adana sa hannunsa kawai, don haka ba za a iya sake karanta shi ba. Ka nemi wani idan ya bata. | ☐ | |
| `ofcGpWaitingDecision` | Waiting for a decision | Ana jiran shawara | ☐ | |
| `ofcGpWaitingIntro` | An agent has recorded these groups in the field. Members cannot be added until a group is approved, so nothing else happens while they sit here. | Wakili ya rubuta wadannan kungiyoyi a filin aiki. Ba za a iya kara mambobi ba sai an amince da kungiya, don haka babu abin da ke faruwa yayin da suke nan. | ☐ | |
| `ofcGpDistributions` | Distributions | Rabo | ☐ | |
| `ofcGpDistributionsIntro` | Fertiliser, seed and other allocations with a fixed quantity behind them. Open one to see who has been awarded and who has actually collected. | Taki, iri da sauran rabon da ke da adadi tsayayye a bayansu. Ka bude daya don ganin wanda aka ba da wanda ya karba a hakika. | ☐ | |
| `ofcGpRegisteredGroups` | Registered groups | Kungiyoyin da aka yi wa rajista | ☐ | |
| `ofcGpTaxRole` | Part in enumeration | Rawar da take takawa a kidaya | ☐ | |
| `ofcGpTaxRoleNone` | No part | Babu rawar da take takawa | ☐ | |
| `ofcGpTaxRoleNeedsReason` | Write down the reason first. Giving a leader standing over what a member is assessed on is recorded. | Ka rubuta dalili tukuna. Ba shugaba iko a kan abin da za a kimanta wa dan kungiya ana ajiye shi a rubuce. | ☐ | |
| `ofcGpGroupsIntro` | Cooperatives, market associations and unions. The member count is confirmed membership only — what an agent recorded but the leader has not yet confirmed does not count towards anything. | Kungiyoyin hadin kai, kungiyoyin kasuwa da kungiyoyin sana’a. Adadin mambobi shi ne wanda aka tabbatar kawai — abin da wakili ya rubuta amma shugaba bai tabbatar ba tukuna ba ya kirguwa a komai. | ☐ | |
| `ofcGpMembersIntro` | Only confirmed members count towards allocations and group-based programmes. Somebody who has left stays on this list: they were a member when whatever they already collected was awarded. | Mambobin da aka tabbatar kawai ne ke kirguwa ga rabo da shirye-shiryen kungiya. Wanda ya fita yana nan a jerin: mamba ne a lokacin da aka ba shi abin da ya riga ya karba. | ☐ | |
| `ofcGpMembershipEnded` | Reason a membership ended | Dalilin da ya sa mamba ta kare | ☐ | |
| `ofcGpMembers` | Members | Mambobi | ☐ | |
| `ofcGpAskLeader` | Ask the leader | Tambayi shugaba | ☐ | |
| `ofcGpTotal` | Total | Jimla | ☐ | |
| `ofcGpAwarded` | Awarded | An ba da | ☐ | |
| `ofcGpRemaining` | Remaining | Da ya rage | ☐ | |
| `ofcGpSampleNote` | Checked against the ministry register of cooperatives. | An duba shi da rajistar kungiyoyin hadin kai ta ma’aikatar. | ☐ | |
| `ofcGpSampleEnded` | Moved his stall to Bukuru market and left the association. | Ya matsar da shagonsa zuwa kasuwar Bukuru kuma ya bar kungiyar. | ☐ | |
| `ofcGpMostNotCollected` | Most of this round has not been collected | Ba a karbi mafi yawan wannan zagayen ba | ☐ | |
| `ofcGpNote` | Note | Bayani | ☐ | |
| `ofcGpSector` | Sector | Bangare | ☐ | |
| `ofcGpConfirmedMembers` | Confirmed members | Mambobin da aka tabbatar | ☐ | |
| `ofcGpScoreAtAward` | Score at award | Maki a lokacin bayarwa | ☐ | |
| `ofcGpMemberLeft` | {{member}} is recorded as having left {{group}}. They keep what they already collected and will not be counted in future allocations. | An rubuta cewa {{member}} ya bar {{group}}. Yana rike da abin da ya riga ya karba kuma ba za a kirga shi a rabon nan gaba ba. | ☐ | |
| `ofcGpConfirmationLinkCreated` | Confirmation link created. | An kirkiri hanyar tabbatarwa. | ☐ | |

#### The officer portal — levies

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcLvIntroAll` | What each levy has brought in, who is registered under it, and who is behind. | Abin da kowane haraji ya shigar, wa aka yi wa rajista karkashinsa, da wa ke baya. | ☐ | |
| `ofcLvIntroNoRegister` | What each levy has brought in, and who is behind on it. | Abin da kowane haraji ya shigar, da wa ke baya a kansa. | ☐ | |
| `ofcLvChooseOnce` | Choose a category or an item once and every section below answers for it. | Zabi rukuni ko abu sau daya kuma kowane sashe a kasa zai amsa a kansa. | ☐ | |
| `ofcLvBroughtIn` | What {{levy}} brought in | Abin da {{levy}} ya shigar | ☐ | |
| `ofcLvBehindOn` | Who is behind on {{levy}} | Wa ke baya a kan {{levy}} | ☐ | |
| `ofcLvRegisteredUnder` | Who is registered under {{levy}} | Wa aka yi wa rajista karkashin {{levy}} | ☐ | |
| `ofcLvShowingLargest` | Showing the {{n}} largest debts. Narrow by category, levy or LGA to see the rest — the totals above cover only what is listed. | Ana nuna manyan bashi {{n}}. Ka tace da rukuni, haraji ko Karamar Hukuma domin ganin sauran — jimillar da ke sama ta kunshi abin da aka lissafa kadai. | ☐ | |
| `ofcLvTitle` | Levies and tax categories | Haraji da rukunonin haraji | ☐ | |
| `ofcLvTaxCategory` | Tax category | Rukunin haraji | ☐ | |
| `ofcLvAllCategories` | All categories | Dukkan rukunoni | ☐ | |
| `ofcLvLevyOrItem` | Levy or tax item | Haraji ko nau’in haraji | ☐ | |
| `ofcLvAllItems` | All items | Dukkan nau’ika | ☐ | |
| `ofcLvCollectedFrom` | Collected from | An karba daga | ☐ | |
| `ofcLvCollectedTo` | Collected to | An karba zuwa | ☐ | |
| `ofcLvByIndividualLevy` | By individual levy | Bisa ga kowane haraji | ☐ | |
| `ofcLvOnlyUnpaid` | Only those with something unpaid | Wadanda kawai suke da abin da ba a biya ba | ☐ | |
| `ofcLvChooseFilter` | Choose a category, a levy, an LGA, or "only those with something unpaid" to list the taxpayers it applies to. | Ka zabi rukuni, haraji, Karamar Hukuma, ko “wadanda kawai suke da abin da ba a biya ba” domin jera masu biyan harajin da ya shafa. | ☐ | |
| `ofcLvSettledToState` | Settled to the State | An tura wa Jiha | ☐ | |
| `ofcLvAwaitingSettlement` | Awaiting settlement | Ana jiran turawa | ☐ | |
| `ofcLvTaxpayersInArrears` | Taxpayers in arrears | Masu biyan haraji da ke bin bashi | ☐ | |
| `ofcLvTotalOutstanding` | Total outstanding | Jimlar da ta rage | ☐ | |
| `ofcLvCollections` | Collections | Karba | ☐ | |
| `ofcLvSettled` | Settled | An tura | ☐ | |
| `ofcLvLevy` | Levy | Haraji | ☐ | |
| `ofcLvInvoices` | Invoices | Takardun biya | ☐ | |
| `ofcLvOldestDue` | Oldest due | Mafi tsufa da ya kamata a biya | ☐ | |

#### The officer portal — the arrears worklist

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcArTitle` | Who owes the State money | Wanda ke bin jiha bashi | ☐ | |
| `ofcArIntro` | Assessed, unpaid and still payable, largest debt first. These taxpayers are already on the register — this is money the State is owed today, not money it has to go and find. | An kimanta, ba a biya ba, kuma har yanzu ana iya biya, mafi girman bashi da farko. Wadannan masu biyan haraji suna cikin rajista — wannan kudi ne da ake bin jiha yau, ba kudin da za ta fita nema ba. | ☐ | |
| `ofcArAtLeast` | Owing at least (₦) | Yana bin akalla (₦) | ☐ | |
| `ofcArLapsingWithin` | Deadline closing within | Ranar karshe na zuwa cikin | ☐ | |
| `ofcArAnyDeadline` | Any deadline | Kowace ranar karshe | ☐ | |
| `ofcArWithin7` | 7 days | Kwana 7 | ☐ | |
| `ofcArWithin14` | 14 days | Kwana 14 | ☐ | |
| `ofcArWithin30` | 30 days | Kwana 30 | ☐ | |
| `ofcArCollectableNow` | Collectable now | Ana iya karba yanzu | ☐ | |
| `ofcArTaxpayers` | Taxpayers owing | Masu biyan haraji da ke bin bashi | ☐ | |
| `ofcArNeedsReassessment` | Needs re-assessment | Yana bukatar sake kimantawa | ☐ | |
| `ofcArEndedElsewhere` | Owed by closed records | Bashin rikodin da aka rufe | ☐ | |
| `ofcArWhoIsMissing` | Who is not on this list | Wanda ba ya cikin wannan jerin | ☐ | |
| `ofcArInFlightExplained` | Anyone part-way through paying is left off, so this list is safe to work as it stands: {{n}} invoice(s) are excluded because a payment is running against them right now. Nobody holding a receipt will be called. | An bar duk wanda ke tsakiyar biya, don haka ana iya aiki da wannan jerin kamar yadda yake: an cire daftari {{n}} saboda ana biya a kansu yanzu. Ba za a kira wanda ke rike da rasit ba. | ☐ | |
| `ofcArLapsedTitle` | Debt that cannot be paid as it stands | Bashin da ba a iya biya kamar yadda yake | ☐ | |
| `ofcArLapsedExplained` | {{n}} invoice(s) have passed their payment deadline. The platform will refuse money against them, so they are counted above but kept off the call list — collecting means raising a fresh assessment first. | Daftari {{n}} sun wuce ranar karshen biya. Tsarin zai ki karbar kudi a kansu, don haka an kidaya su a sama amma ba a sa su cikin jerin kira ba — karba yana nufin fara sabon kimantawa. | ☐ | |
| `ofcArWhoToCall` | Who to call | Wanda za a kira | ☐ | |
| `ofcArShowingLargest` | Showing the {{n}} largest debts. Narrow by LGA or amount to see further down. | Ana nuna manyan bashi {{n}}. Ka rage ta LGA ko adadi domin ganin kasa. | ☐ | |
| `ofcArOwedFor` | Owed for | Bashin | ☐ | |
| `ofcArDaysLeft` | Days left to pay | Kwanakin da suka rage a biya | ☐ | |
| `ofcArNoDeadline` | No deadline | Babu ranar karshe | ☐ | |
| `ofcArLastPaid` | Last paid | Biya na karshe | ☐ | |
| `ofcArNeverPaid` | Never | Bai taba ba | ☐ | |
| `ofcArPartPaid` | Part paid | An biya wani sashe | ☐ | |
| `ofcArNobodyOwes` | Nobody in this scope owes a collectable debt. | Babu wanda ke bin bashin da ake iya karba a wannan yanki. | ☐ | |

#### The officer portal — assets and coverage leads

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcIgReasonLabel` | Why are you changing this claim? | Me ya sa kake canza wannan ikirari? | ☐ | |
| `ofcIgReasonFirst` | Write the reason first. | Ka fara rubuta dalili. | ☐ | |
| `ofcIgTitle` | What is connected to a taxpayer | Abin da ke da alaka da mai biyan haraji | ☐ | |
| `ofcIgIntro` | People running commercial vehicles the State has never assessed for income tax, drawn from the vehicle register PSIRS already keeps. Nothing here comes from outside the platform. | Mutanen da ke tafiyar da motocin kasuwanci wadanda jiha ba ta taba kimanta harajin kudin shiga a kansu ba, daga rajistar motoci da PSIRS ke rike da ita. Babu abin da ya fito daga wajen tsarin. | ☐ | |
| `ofcIgLimitsTitle` | What this list is, and what it is not | Menene wannan jerin, kuma menene ba shi ba | ☐ | |
| `ofcIgLimits` | Every line is a claim, not a finding. Read the grounds column before acting: a match on a shared phone number is a reason to ask, never a reason to assess. Opening a record is logged against that person with the purpose you choose. | Kowane layi ikirari ne, ba binciken karshe ba. Ka karanta ginshikin dalili kafin ka yi aiki: daidaituwa ta lambar waya daya dalili ne na tambaya, ba na kimantawa ba. Ana rubuta bude rikodi a kan mutumin tare da dalilin da ka zaba. | ☐ | |
| `ofcIgAtLeastVehicles` | With at least this many vehicles | Da akalla motoci masu yawa haka | ☐ | |
| `ofcIgRebuildLabel` | From the register | Daga rajista | ☐ | |
| `ofcIgRebuildAction` | Rebuild connections | Sake gina alakoki | ☐ | |
| `ofcIgRebuilt` | {{asserted}} connection(s) recorded: {{registry}} from the register, {{phone}} matched on a shared phone. {{ambiguous}} vehicle(s) matched more than one taxpayer and were left alone. | An rubuta alaka {{asserted}}: {{registry}} daga rajista, {{phone}} sun dace ta lambar waya daya. Motoci {{ambiguous}} sun dace da fiye da mai biyan haraji daya kuma an bar su. | ☐ | |
| `ofcIgLeads` | People to look at | Mutanen da za a duba | ☐ | |
| `ofcIgVehicles` | Commercial vehicles | Motocin kasuwanci | ☐ | |
| `ofcIgUnmatched` | Vehicles with no owner matched | Motocin da ba a gano mai su ba | ☐ | |
| `ofcIgUnmatchedExplained` | {{n}} vehicle(s) on the register are connected to nobody, so they are not in the count above. That is the part of the problem this list cannot see. | Motoci {{n}} a rajista ba su da alaka da kowa, don haka ba sa cikin kidayar da ke sama. Wannan shi ne bangaren matsalar da wannan jerin ba zai iya gani ba. | ☐ | |
| `ofcIgPurpose` | Why are you opening this record? | Me ya sa kake bude wannan rikodin? | ☐ | |
| `ofcIgPurposeChoose` | Choose a reason | Zabi dalili | ☐ | |
| `ofcIgPurposeFirst` | Choose a reason first — every read of a record is logged with one. | Ka fara zabar dalili — ana rubuta kowace karatun rikodi da dalili. | ☐ | |
| `ofcIgRegistrations` | Registrations | Lambobin rajista | ☐ | |
| `ofcIgGrounds` | Grounds | Dalili | ☐ | |
| `ofcIgFromRegister` | The register names them | Rajista ta ambace su | ☐ | |
| `ofcIgFromPhone` | Matched on a shared phone number | An dace ta lambar waya daya | ☐ | |
| `ofcIgChargedCommercial` | Charged the commercial rate | An caje kudin kasuwanci | ☐ | |
| `ofcIgPaidLastYear` | Paid in the last year | An biya a shekarar da ta gabata | ☐ | |
| `ofcIgOpen` | Open record | Bude rikodi | ☐ | |
| `ofcIgNoLeads` | Nobody in this scope has a commercial vehicle and no income assessment. | Babu wanda ke da motar kasuwanci kuma ba a kimanta harajin kudin shiga a kansa ba a wannan yanki. | ☐ | |
| `ofcIgRecordTitle` | The record | Rikodin | ☐ | |
| `ofcIgWhatWeClaim` | What the State claims about them | Abin da jiha ke ikirari a kansu | ☐ | |
| `ofcIgWhatTheyOwe` | What they owe | Abin da suke bin bashi | ☐ | |
| `ofcIgThing` | Thing | Abu | ☐ | |
| `ofcIgRelationship` | Relationship | Alaka | ☐ | |
| `ofcIgSource` | Where it came from | Inda ya fito | ☐ | |
| `ofcIgObtained` | Recorded on | An rubuta a | ☐ | |
| `ofcIgLawfulBasis` | Power relied on | Ikon da aka dogara a kai | ☐ | |
| `ofcIgDecide` | Decision | Shawara | ☐ | |
| `ofcIgConfirm` | Taxpayer confirms | Mai biyan haraji ya tabbatar | ☐ | |
| `ofcIgDispute` | Taxpayer disputes | Mai biyan haraji ya ki amincewa | ☐ | |
| `ofcIgWithdraw` | Withdraw claim | Janye ikirari | ☐ | |
| `ofcIgReasonPrompt` | Say why. This is a record about a person, and a change nobody explained cannot be defended to them. | Ka fadi dalili. Wannan rikodi ne game da mutum, kuma canjin da babu wanda ya bayyana ba za a iya kare shi a gaban sa ba. | ☐ | |
| `ofcIgNothingClaimed` | The State claims nothing about this person. | Jiha ba ta ikirari komai a kan wannan mutumin. | ☐ | |
| `ofcIgReference` | Reference | Lamba | ☐ | |
| `ofcIgSince` | Since | Tun | ☐ | |
| `ofcIgPayableNow` | Can be paid now | Ana iya biya yanzu | ☐ | |
| `ofcIgPayableYes` | Yes | Eh | ☐ | |
| `ofcIgPayableNeedsReassessment` | No — needs a fresh assessment | A’a — yana bukatar sabon kimantawa | ☐ | |
| `ofcIgOwesNothing` | They owe the State nothing. | Ba sa bin jiha komai. | ☐ | |

#### The officer portal — employers and payroll returns

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcPrWithdraw` | Withdraw | Janye | ☐ | |
| `ofcPrWithdrawReason` | Why is this return being withdrawn? | Me ya sa ake janye wannan rahoto? | ☐ | |
| `ofcPrWithdrawFirst` | Write the reason first. | Ka fara rubuta dalili. | ☐ | |
| `ofcPrTitle` | Employers who should be filing | Masu daukar ma’aikata da ya kamata su kai rahoto | ☐ | |
| `ofcPrIntro` | Schools, clinics, hotels and haulage yards on the register with no PAYE return on record. One employer with forty staff is worth a hundred market visits, and this list costs no field work — it is built from what registration already recorded. | Makarantu, asibitoci, otal-otal da wuraren jigilar kaya da ke cikin rajista amma ba su kai rahoton PAYE ba. Mai daukar ma’aikata 40 ya fi ziyarar kasuwa dari daraja, kuma wannan jerin bai bukaci aikin fili ba — an gina shi daga abin da rajista ta riga ta rubuta. | ☐ | |
| `ofcPrWhichList` | Which list | Wanne jeri | ☐ | |
| `ofcPrListPaye` | Employers with no PAYE return | Masu daukar ma’aikata da ba su kai rahoton PAYE ba | ☐ | |
| `ofcPrListConsumption` | Hospitality with no consumption tax | Wuraren baki da ba su biya harajin amfani ba | ☐ | |
| `ofcPrNotFiling` | Not filing | Ba sa kai rahoto | ☐ | |
| `ofcPrFiling` | Already filing | Suna kai rahoto | ☐ | |
| `ofcPrSector` | Sector | Bangare | ☐ | |
| `ofcPrNature` | Nature of business | Irin kasuwanci | ☐ | |
| `ofcPrOpen` | Open | Bude | ☐ | |
| `ofcPrNoneNotFiling` | Every employer in these sectors has filed a return. | Kowane mai daukar ma’aikata a wadannan bangarori ya kai rahoto. | ☐ | |
| `ofcPrNoneNotPaying` | Every hospitality premises here has paid consumption tax this year. | Kowane wurin baki a nan ya biya harajin amfani a wannan shekara. | ☐ | |
| `ofcPrFiledBefore` | Returns already filed | Rahotannin da aka riga aka kai | ☐ | |
| `ofcPrPeriod` | Month | Wata | ☐ | |
| `ofcPrEmployees` | Employees | Ma’aikata | ☐ | |
| `ofcPrGross` | Total pay | Jimlar albashi | ☐ | |
| `ofcPrTax` | Tax due | Harajin da ya kamata | ☐ | |
| `ofcPrFiledOn` | Filed on | An kai a | ☐ | |
| `ofcPrWithdrawnBecause` | Withdrawn because | An janye saboda | ☐ | |
| `ofcPrNeverFiled` | This employer has never filed a return. | Wannan mai daukar ma’aikata bai taba kai rahoto ba. | ☐ | |
| `ofcPrFileAReturn` | File a return | Kai rahoto | ☐ | |
| `ofcPrHowTheTaxIsWorkedOut` | How the tax is worked out | Yadda ake lissafin haraji | ☐ | |
| `ofcPrHowExplained` | Enter what each person was paid for the month. The platform works out the tax on each of them separately, using the annual bands, and adds it up. There is no box for the tax because the tax is not something anybody types. | Ka shigar da abin da aka biya kowane mutum a wannan wata. Tsarin zai lissafa harajin kowannensu daban, ta amfani da matakan shekara, sannan ya hada su. Babu wurin shigar da haraji domin haraji ba abin da kowa ke rubutawa ba ne. | ☐ | |
| `ofcPrYear` | Year | Shekara | ☐ | |
| `ofcPrMonth` | Month number | Lambar wata | ☐ | |
| `ofcPrEmployeeName` | Employee name | Sunan ma’aikaci | ☐ | |
| `ofcPrMonthlyPay` | Paid this month (₦) | An biya wannan wata (₦) | ☐ | |
| `ofcPrAddEmployee` | Add another employee | Kara wani ma’aikaci | ☐ | |
| `ofcPrSubmit` | File this return ({{n}} employees) | Kai wannan rahoto (ma’aikata {{n}}) | ☐ | |
| `ofcPrFiledTitle` | Return filed | An kai rahoto | ☐ | |
| `ofcPrFiledExplained` | The return covers {{n}} employee(s) and invoice {{invoice}} has been raised for the tax. | Rahoton ya shafi ma’aikata {{n}} kuma an fitar da daftari {{invoice}} na haraji. | ☐ | |
| `ofcPrMissingTins` | {{n}} of them had no TIN — collect those and add them to the next return. | {{n}} daga cikinsu ba su da TIN — ka tattara su ka kara su a rahoto na gaba. | ☐ | |

#### The officer portal — the presumptive schedule

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcPsPublish` | Publishing | Wallafawa | ☐ | |
| `ofcPsPublishClass` | Publish a local government class | Wallafa matakin karamar hukuma | ☐ | |
| `ofcPsPublishFigure` | Publish a schedule figure | Wallafa adadin jadawali | ☐ | |
| `ofcPsChoose` | Choose | Zaba | ☐ | |
| `ofcPsIndicators` | Indicators behind this class | Alamomin da suka haifar da wannan mataki | ☐ | |
| `ofcPsIndicatorsHint` | e.g. road access, electrification, poverty headcount | misali hanya, wutar lantarki, adadin talauci | ☐ | |
| `ofcPsClassPublished` | The classification has been published. | An wallafa rarrabuwar. | ☐ | |
| `ofcPsFigurePublished` | The figure has been published. | An wallafa adadin. | ☐ | |
| `ofcPsAssumedTurnoverNaira` | Assumed annual turnover (₦) | Kudin shigar shekara da ake zato (₦) | ☐ | |
| `ofcPsAdoptExemption` | Adopt a reading of the exemption | Amince da fassarar kebewa | ☐ | |
| `ofcPsAdoptWarningTitle` | This decides who is taxed at all | Wannan yana yanke wanda za a biya haraji | ☐ | |
| `ofcPsAdoptWarning` | Adopting a construction decides whether a trader with a shop is exempt, which moves the covered population enormously. Record it only on a written opinion, and cite that opinion below — it will be quoted back at PSIRS by the first person who disagrees. | Amince da fassara yana yanke ko an kebe mai shago, wanda ke canza adadin mutanen da abin ya shafa sosai. Ka rubuta shi ne kawai bisa ra’ayin da aka rubuta, kuma ka ambaci wannan ra’ayin a kasa — mutum na farko da bai yarda ba zai maido da shi ga PSIRS. | ☐ | |
| `ofcPsConstruction` | Which reading | Wace fassara | ☐ | |
| `ofcPsCeiling` | Turnover ceiling (₦) | Iyakar kudin shiga (₦) | ☐ | |
| `ofcPsLegalBasis` | Opinion or instrument relied on | Ra’ayi ko dokar da aka dogara a kai | ☐ | |
| `ofcPsExemptionAdopted` | The construction has been recorded. | An rubuta fassarar. | ☐ | |
| `ofcPsTitle` | The presumptive schedule | Jadawalin haraji na kimantawa | ☐ | |
| `ofcPsIntro` | What a trade of a given size is assumed to turn over, by local government class. The rate is one per cent everywhere — what differs is the assumed turnover, because turnover really is lower in some places. Nobody grants a discount and no officer decides anything. | Abin da ake ganin sana’a mai wani girma take samu, bisa matakin karamar hukuma. Adadin haraji kashi daya ne a ko’ina — abin da ya bambanta shi ne kudin shigar da ake zato, domin hakika samu ya fi kankanta a wasu wurare. Babu wanda ke bayar da ragi kuma babu jami’in da ke yanke shawara. | ☐ | |
| `ofcPsReadiness` | Whether it can be used yet | Ko ana iya amfani da shi tukuna | ☐ | |
| `ofcPsLgasClassified` | Local governments classified | Kananan hukumomin da aka rarraba | ☐ | |
| `ofcPsCells` | Figures published | Adadin da aka wallafa | ☐ | |
| `ofcPsExemptionInForce` | The exemption as adopted | Kebewar kamar yadda aka amince da ita | ☐ | |
| `ofcPsConjunctive` | All three limbs must hold: no fixed premises, no employees, and turnover at or below the ceiling. A trader with a shop is therefore assessed even if their turnover is small. | Dole ne dukkan sharudda uku su cika: babu wurin kasuwanci na dindindin, babu ma’aikata, kuma kudin shiga bai wuce iyaka ba. Don haka ana kimanta mai shago ko da kudin shigarsa kadan ne. | ☐ | |
| `ofcPsTurnoverGoverned` | Turnover governs alone: anyone at or below the ceiling is exempt, whether or not they have a shop or staff. | Kudin shiga kadai ke yanke hukunci: duk wanda bai wuce iyaka ba an kebe shi, ko yana da shago ko ma’aikata ko babu. | ☐ | |
| `ofcPsNoExemptionAdopted` | No reading of the exemption has been adopted | Ba a amince da wata fassarar kebewa ba | ☐ | |
| `ofcPsNoExemptionExplained` | Nobody can be assessed presumptively until PSIRS records which construction of the nano exemption applies, and on whose written opinion. The two readings differ on whether a trader with a shop is exempt, which is not a question this platform may answer by default. | Ba za a iya kimanta kowa ba har sai PSIRS ta rubuta wace fassarar kebewar nano ce ta shafi, kuma bisa ra’ayin wa aka rubuta. Fassarorin biyu sun bambanta kan ko an kebe mai shago, kuma wannan ba tambaya ce da wannan tsarin zai amsa da kansa ba. | ☐ | |
| `ofcPsPartlyPublished` | The schedule is only partly published | An wallafa jadawalin bangare kadai | ☐ | |
| `ofcPsPartlyPublishedExplained` | {{done}} of {{total}} local governments have a published class. Anyone in the rest cannot be assessed, and quoting figures from this table for them would be quoting figures that do not apply. | Kananan hukumomi {{done}} daga {{total}} ne ke da matakin da aka wallafa. Ba za a iya kimanta wadanda ke sauran ba, kuma ambaton adadi daga wannan jadawalin gare su zai zama ambaton abin da bai shafe su ba. | ☐ | |
| `ofcPsWhatItWouldCost` | What a given trade would pay | Abin da wata sana’a za ta biya | ☐ | |
| `ofcPsCheckIntro` | Enter what an agent would see standing in the doorway. There is no field for a turnover or a band — those are worked out from what was observed, which is what stops the figure being negotiable. | Ka shigar da abin da wakili zai gani yana tsaye a bakin kofa. Babu wurin shigar da kudin shiga ko mataki — ana lissafa su daga abin da aka gani, wanda shi ne ke hana a yi ciniki a kan adadin. | ☐ | |
| `ofcPsPremises` | Premises | Wurin sana’a | ☐ | |
| `ofcPsEquipment` | Machines or equipment | Injuna ko kayan aiki | ☐ | |
| `ofcPsPeople` | People working besides the operator | Mutanen da ke aiki ban da mai sana’a | ☐ | |
| `ofcPsWorkItOut` | Work it out | Yi lissafi | ☐ | |
| `ofcPsBand` | Size band | Matakin girma | ☐ | |
| `ofcPsClass` | Class | Mataki | ☐ | |
| `ofcPsAssumedTurnover` | Assumed annual turnover | Kudin shigar shekara da ake zato | ☐ | |
| `ofcPsAllAdoptedUnder` | Every figure below was adopted under | An amince da kowace lamba a kasa a karkashin | ☐ | |
| `ofcPsAnnualTax` | Tax a year | Harajin shekara | ☐ | |
| `ofcPsMonthlyTax` | Tax a month | Harajin wata | ☐ | |
| `ofcPsExempt` | Exempt — nothing is payable | An kebe — babu abin biya | ☐ | |
| `ofcPsExemptExplained` | This operator is a nano business under the construction of the exemption in force, so no presumptive tax is due at all. That is the law working, not a figure that came out small. | Wannan mai sana’a kanana ne bisa fassarar kebewar da ke aiki, don haka babu wani harajin kimantawa da ya kamata. Wannan doka ce ke aiki, ba adadi ne da ya fito kankani ba. | ☐ | |
| `ofcPsHowWeGotThere` | How that figure was reached | Yadda aka kai ga wannan adadin | ☐ | |
| `ofcPsStep` | Step | Mataki | ☐ | |
| `ofcPsDetail` | What was used | Abin da aka yi amfani da shi | ☐ | |
| `ofcPsAmount` | Amount | Adadi | ☐ | |
| `ofcPsNoWorking` | No working to show. | Babu lissafin da za a nuna. | ☐ | |
| `ofcPsClasses` | How each local government is classified | Yadda aka rarraba kowace karamar hukuma | ☐ | |
| `ofcPsClassesIntro` | Classified on data PSIRS does not produce, and fixed for three years. Both are deliberate: a class drawn from an area’s own collection figures would pay it to under-collect, and one that can move next year is one that will be lobbied about. | An rarraba bisa bayanan da PSIRS ba ta samar ba, kuma an daidaita shi na shekara uku. Duka biyu da gangan ne: mataki da aka samo daga kudin da yankin ya tara zai sa a rage tarawa, kuma wanda za a iya canzawa badi zai jawo matsin lamba. | ☐ | |
| `ofcPsIndexSource` | Whose data | Bayanan wa | ☐ | |
| `ofcPsFrom` | From | Daga | ☐ | |
| `ofcPsUntil` | Until | Har zuwa | ☐ | |
| `ofcPsNoEndDate` | No end date set | Ba a saita ranar karshe ba | ☐ | |
| `ofcPsNoClasses` | No local government has a published class yet. | Babu karamar hukumar da ke da matakin da aka wallafa tukuna. | ☐ | |
| `ofcPsTheTable` | The published figures | Adadin da aka wallafa | ☐ | |
| `ofcPsInstrument` | Adopted under | An amince da shi karkashin | ☐ | |
| `ofcPsVersion` | Version | Sigar | ☐ | |
| `ofcPsNoEntries` | No figures have been published yet. | Ba a wallafa wani adadi ba tukuna. | ☐ | |
| `ofcPsHowToChange` | A published figure is never edited. Publishing a new one closes the old period and starts a new version, so an assessment made last year can still be checked against the figure it was made under. | Ba a taba gyara adadin da aka wallafa. Wallafa sabo yana rufe tsohon lokaci ya fara sabuwar siga, don haka ana iya duba kimantawar bara bisa adadin da aka yi ta a kansa. | ☐ | |

#### The officer portal — enumeration queues

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcEnRecorded` | What has been recorded | Abin da aka rubuta | ☐ | |
| `ofcEnRecordedIntro` | Observations from the field and what became of each. An observation the association disputed cannot be assessed until somebody goes back and looks again. | Abubuwan da aka lura da su daga fili da abin da ya faru da kowanne. Ba za a iya kimanta abin da kungiya ta ki amincewa da shi ba sai wani ya sake dawowa ya duba. | ☐ | |
| `ofcEnAttestation` | Attestation | Tabbatarwa | ☐ | |
| `ofcEnNotYetAssessed` | Not assessed yet | Ba a kimanta ba tukuna | ☐ | |
| `ofcEnExempt` | Exempt | An kebe | ☐ | |
| `ofcEnAction` | Next | Na gaba | ☐ | |
| `ofcEnSettleFirst` | Disputed — settle it first | Ana takaddama — a fara warwarewa | ☐ | |
| `ofcEnLeaderAgrees` | Leader confirms | Shugaba ya tabbatar | ☐ | |
| `ofcEnAssess` | Assess | Kimanta | ☐ | |
| `ofcEnAlreadyObjected` | Objection open | Ana kalubalanta | ☐ | |
| `ofcEnRecordObjection` | Record an objection | Rubuta kalubale | ☐ | |
| `ofcEnAttestedByName` | Attesting leader’s name | Sunan shugaban da ke tabbatarwa | ☐ | |
| `ofcEnStatementFirst` | Write what the taxpayer says first. | Ka fara rubuta abin da mai biyan haraji ya ce. | ☐ | |
| `ofcEnNothingRecorded` | Nothing has been recorded yet. | Ba a rubuta komai ba tukuna. | ☐ | |
| `ofcEnTitle` | What enumeration left for a person to decide | Abin da kidayar ta bar wa mutum ya yanke | ☐ | |
| `ofcEnIntro` | Two queues. Where an agent and an association leader described the same trader differently, and where a taxpayer has formally disputed an estimate. Both are decisions a machine should not make. | Jeri biyu. Inda wakili da shugaban kungiya suka bayyana mai sana’a daban, da kuma inda mai biyan haraji ya ki amincewa da kiyasi a hukumance. Duka biyu shawarwari ne da bai kamata na’ura ta yanke ba. | ☐ | |
| `ofcEnDisagreements` | Where the agent and the leader differ | Inda bayanan suka bambanta | ☐ | |
| `ofcEnDisagreementsIntro` | An agent recorded one thing and the association leader another. Both versions are shown, with the band each would produce — a difference that does not change the band is a phone call, one that does is a visit. | Wakili ya rubuta abu daya shugaban kungiya kuma ya rubuta wani. An nuna bayanan biyu, tare da matakin da kowanne zai haifar — bambancin da bai canza mataki ba kiran waya ne, wanda ya canza kuwa ziyara ce. | ☐ | |
| `ofcEnGroup` | Association | Kungiya | ☐ | |
| `ofcEnAgentSaw` | The agent recorded | Wakili ya rubuta | ☐ | |
| `ofcEnLeaderSays` | The leader disputes | Shugaba ya ki amincewa | ☐ | |
| `ofcEnBandGap` | Effect on the band | Tasiri a kan mataki | ☐ | |
| `ofcEnSameBand` | Same band either way | Mataki daya ko ta yaya | ☐ | |
| `ofcEnObservedOn` | Recorded on | An rubuta a | ☐ | |
| `ofcEnAttestedBy` | Attested by | Wanda ya tabbatar | ☐ | |
| `ofcEnNoDisagreements` | Nothing is in dispute. | Babu bayanin da ake takaddama a kai. | ☐ | |
| `ofcEnObjections` | Estimates under objection | Kiyasin da ake kalubalanta | ☐ | |
| `ofcEnOpenObjections` | Open objections | Kalubalen da ba a warware ba | ☐ | |
| `ofcEnUnderObjection` | Tax under objection | Harajin da ake kalubalanta | ☐ | |
| `ofcEnWhileOpenTitle` | While an objection is open | Yayin da ake kalubalanta | ☐ | |
| `ofcEnWhileOpen` | The debt is not chased. It is off the arrears worklist until this is decided, so nobody will be called about it in the meantime. | Ba a bin bashin. An cire shi daga jerin bashin da ake bi har sai an yanke shawara, don haka ba za a kira kowa a kansa ba a wannan lokacin. | ☐ | |
| `ofcEnDecisionReason` | Why are you deciding this way? | Me ya sa kake yanke haka? | ☐ | |
| `ofcEnDecisionReasonHint` | The taxpayer will be shown this. | Za a nuna wa mai biyan haraji wannan. | ☐ | |
| `ofcEnGround` | Ground | Dalili | ☐ | |
| `ofcEnWhatTheySay` | What the taxpayer says | Abin da mai biyan haraji ya ce | ☐ | |
| `ofcEnRaisedOn` | Raised on | An gabatar a | ☐ | |
| `ofcEnDecision` | Decision | Shawara | ☐ | |
| `ofcEnYoursToPassOn` | You raised this assessment — another officer must decide | Kai ka yi wannan kimantawa — wani jami’i ne zai yanke | ☐ | |
| `ofcEnUphold` | Uphold the objection | Amince da kalubalen | ☐ | |
| `ofcEnReject` | Reject the objection | Ki kalubalen | ☐ | |
| `ofcEnReasonFirst` | Write the reason first. | Ka fara rubuta dalili. | ☐ | |
| `ofcEnNoObjections` | No estimate is under objection. | Babu kiyasin da ake kalubalanta. | ☐ | |

#### The officer portal — distribution rounds

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcAlForfeitTooShort` | Give at least ten characters saying why this share is being released. | Ka ba da akalla haruffa goma da ke fadin dalilin sakin wannan rabon. | ☐ | |
| `ofcAlReleased` | Released. The {{quantity}} is back in {{round}} for another beneficiary. | An sake shi. {{quantity}} ya koma cikin {{round}} domin wani mai amfana. | ☐ | |
| `ofcAlAwardsFor` | Awards — {{name}} | Kyautuka — {{name}} | ☐ | |
| `ofcAlAwardsIntro` | Who has been awarded under this round, and who has collected. | Wa aka ba kyauta a wannan zagayen, kuma wa ya karba. | ☐ | |
| `ofcAlRoundQuantity` | {{total}} {{unit}}, {{per}} each | {{total}} {{unit}}, {{per}} ga kowanne | ☐ | |
| `ofcAlAwardedLeft` | {{awarded}} awarded, {{left}} left | An bayar {{awarded}}, {{left}} ya rage | ☐ | |
| `ofcAlIntro` | A programme decides who is eligible; a round is one actual distribution. Awards accrue only while a round is open, which is what stops a programme distributing on paper what is not at the collection point. | Shiri yana yanke wanda ya cancanta; zagaye kuwa rabo daya ne na hakika. Ana tara bayarwa ne kawai yayin da zagayen yake a bude, wannan ne ke hana shiri raba a takarda abin da babu shi a wurin karba. | ☐ | |
| `ofcAlNewRound` | New round | Sabon zagaye | ☐ | |
| `ofcAlProgramme` | Programme | Shiri | ☐ | |
| `ofcAlSelectProgramme` | Select a programme | Zabi shiri | ☐ | |
| `ofcAlNoProgramme` | No programme exists yet. One has to be created under Social incentives before a round can distribute under it. | Babu shirin da ke nan tukuna. Dole a kirkiri daya a karkashin Tallafin jama’a kafin zagaye ya iya rabawa a karkashinsa. | ☐ | |
| `ofcAlRoundName` | What this round is called | Sunan wannan zagayen | ☐ | |
| `ofcAlMeasuredIn` | Measured in | Ana aunawa da | ☐ | |
| `ofcAlTotalToDistribute` | Total to distribute | Jimlar da za a raba | ☐ | |
| `ofcAlEachReceives` | Each beneficiary receives | Kowane mai amfana zai karba | ☐ | |
| `ofcAlEnoughFor` | Enough for | Ya isa ga | ☐ | |
| `ofcAlBeneficiariesWord` | beneficiaries. | masu amfana. | ☐ | |
| `ofcAlCollectionPoint` | Collection point | Wurin karba | ☐ | |
| `ofcAlOpens` | Opens | Zai bude | ☐ | |
| `ofcAlClosesOptional` | Closes (optional) | Zai rufe (ba dole ba) | ☐ | |
| `ofcAlRelease` | Release | Saki | ☐ | |
| `ofcAlAwards` | Awards | Bayarwa | ☐ | |
| `ofcAlSampleRound` | Dry season fertiliser, Jos North | Takin damina, Jos ta Arewa | ☐ | |
| `ofcAlSamplePoint` | Terminus Market store, Jos North | Shagon Kasuwar Terminus, Jos ta Arewa | ☐ | |
| `ofcAlBeneficiary` | Beneficiary | Mai amfana | ☐ | |
| `ofcAlQuantity` | Quantity | Yawa | ☐ | |
| `ofcAlRound` | Round | Zagaye | ☐ | |
| `ofcAlDistributing` | Distributing | Ana rabawa | ☐ | |
| `ofcAlForfeitWhy` | Why is {{name}}’s {{quantity}} forfeited? | Me ya sa aka kwace {{quantity}} na {{name}}? | ☐ | |
| `ofcAlThisBeneficiary` | this beneficiary | wannan mai amfana | ☐ | |
| `ofcAlRoundOpened` | {{name}} is open. Awards can now be made. | {{name}} a bude yake. Yanzu za a iya yin rabo. | ☐ | |
| `ofcAlRoundClosed` | {{name}} is closed. No further awards. | An rufe {{name}}. Babu sauran rabo. | ☐ | |
| `ofcAlRoundCannotCloseBeforeOpen` | A round cannot close before it opens. | Zagaye ba zai iya rufewa kafin ya bude ba. | ☐ | |
| `ofcAlChooseTheProgrammeThis` | Choose the programme this round distributes under. | Ka zabi shirin da wannan zagaye zai rarraba a karkashinsa. | ☐ | |
| `ofcAlCreateARound` | Create a round | Kirkiri zagaye | ☐ | |
| `ofcAlCreateRound` | Create round | Kirkiri zagaye | ☐ | |
| `ofcAlCreating` | Creating… | Ana kirkira… | ☐ | |
| `ofcAlGiveTheRoundA` | Give the round a name people will recognise. | Ka ba zagayen suna da mutane za su gane. | ☐ | |
| `ofcAlHowMuchDoesEach` | How much does each beneficiary receive? | Nawa kowane mai amfana zai samu? | ☐ | |
| `ofcAlHowMuchIsThere` | How much is there to distribute in total? | Nawa ne za a rarraba gaba daya? | ☐ | |
| `ofcAlNotYet` | Not yet | Ba tukuna | ☐ | |
| `ofcAlOneBeneficiaryCannotReceive` | One beneficiary cannot receive more than the whole round holds. | Mai amfana daya ba zai iya samun fiye da abin da zagayen ya kunsa ba. | ☐ | |
| `ofcAlRoundCreatedItAwards` | Round created. It awards nothing until you open it. | An kirkiri zagayen. Ba ya bayar da komai sai ka bude shi. | ☐ | |
| `ofcAlWhenDoesCollectionOpen` | When does collection open? | Yaushe karbar za ta bude? | ☐ | |

#### The officer portal — agent performance

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcPfWorkedOf` | {{worked}} of {{total}} | {{worked}} cikin {{total}} | ☐ | |
| `ofcPfFlagIsQuestion` | A flag is a question, not a finding. Their figures are shown here unchanged — | Alama tambaya ce, ba hukunci ba. An nuna adadinsu a nan ba tare da canji ba — | ☐ | |
| `ofcPfAgentsWithFlag` | {{n}} agent(s) with an open fraud flag | Wakilai {{n}} da ke da alamar zamba a bude | ☐ | |
| `ofcPfIntro` | Collections, reach and trouble side by side. An agent in a commercial ward will out-collect the best agent in a rural one, so read the columns together rather than sorting by naira. | Karba, isa da matsala gefe da gefe. Wakili a unguwar kasuwanci zai fi karbar mafi kyawun wakili a unguwar karkara, don haka ka karanta ginshikan tare maimakon jera su da naira. | ☐ | |
| `ofcPfCollectedByAgents` | Collected by agents | Abin da wakilai suka karba | ☐ | |
| `ofcPfTaxpayersOnboarded` | Taxpayers onboarded | Masu biyan haraji da aka shigar | ☐ | |
| `ofcPfAgentsWorked` | Agents who worked | Wakilan da suka yi aiki | ☐ | |
| `ofcPfOpenFraudFlags` | Open fraud flags | Alamun zamba a bude | ☐ | |
| `ofcPfFiguresUnreadable` | These figures could not be read | Ba a iya karanta wadannan alkaluma ba | ☐ | |
| `ofcPfFiguresUnreadableBody` | The totals and the list below are missing, not zero. Nothing on this page is a count of anything — in particular, no claim is being made here about open fraud flags. Reload, and raise it if it does not clear. | Jimillar da jerin da ke kasa ba sa nan — ba sifili ba ne. Babu wata lamba a wannan shafi da ke nufin komai, musamman ba a ce komai game da alamun zamba da ke bude ba. Ka sake lodi, kuma ka daga kara idan bai warware ba. | ☐ | |
| `ofcPfCollected` | Collected | An karba | ☐ | |
| `ofcPfAverage` | Average | Matsakaici | ☐ | |
| `ofcPfOnboarded` | Onboarded | An shigar | ☐ | |
| `ofcPfTins` | TINs | TIN | ☐ | |
| `ofcPfRenewals` | Renewals | Sabuntawa | ☐ | |
| `ofcPfFailed` | Failed | Ya gaza | ☐ | |
| `ofcPfReversed` | Reversed | An juyar | ☐ | |
| `ofcPfFlags` | Flags | Alamu | ☐ | |
| `ofcPfDaysWorked` | Days worked | Kwanakin aiki | ☐ | |
| `ofcPfGrowth` | Against last month | Kan watan jiya | ☐ | |
| `ofcPfCategories` | Levies worked | Harajin da ake aiki da su | ☐ | |

#### The officer portal — transactions

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcTxReceipt` | Receipt | Rasit | ☐ | |
| `ofcTxCreated` | Created | An kirkira | ☐ | |
| `ofcTxDirect` | Direct | Kai tsaye | ☐ | |

#### The officer portal — empty states

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcNoneConfirmedCollectionReachedGovernment` | Every confirmed collection has reached the government account. | Duk karban da aka tabbatar ya isa asusun gwamnati. | ☐ | |
| `ofcNoneEveryoneTin` | Everyone has their TIN. | Kowa yana da TIN dinsa. | ☐ | |
| `ofcNoneLgaEnoughActivityReport` | No LGA has enough activity to report without singling somebody out. | Babu Karamar Hukuma da ke da isasshen aiki da za a bayar da rahoto ba tare da nuna wani ba. | ☐ | |
| `ofcNoneMdaCollectionsRecorded` | No MDA collections recorded yet. | Ba a rubuta karban ma’aikatu ba tukuna. | ☐ | |
| `ofcNoneMdaConfigured` | No MDA is configured. | Babu ma’aikatar da aka saita. | ☐ | |
| `ofcNoneAccessRecorded` | No access recorded. | Ba a rubuta shiga ba. | ☐ | |
| `ofcNoneAgentCollectionsRecorded` | No agent collections recorded yet. | Ba a rubuta karban wakilai ba tukuna. | ☐ | |
| `ofcNoneAgentCollectedPeriod` | No agent has collected in this period. | Babu wakilin da ya karba a wannan lokacin. | ☐ | |
| `ofcNoneAgentsCleared` | No agents have been cleared yet. | Ba a ba wa wakilai izini ba tukuna. | ☐ | |
| `ofcNoneAgentsMatchFilter` | No agents match this filter. | Babu wakilin da ya dace da wannan tacewar. | ☐ | |
| `ofcNoneApplicationsWaitingReview` | No applications are waiting for review. | Babu bukatun da ke jiran dubawa. | ☐ | |
| `ofcNoneApprovalRequestsMatchFilter` | No approval requests match this filter. | Babu bukatun amincewa da suka dace da wannan tacewar. | ☐ | |
| `ofcNoneAuditEntriesMatchThese` | No audit entries match these filters. | Babu shigarwar bincike da ta dace da wadannan tacewar. | ☐ | |
| `ofcNoneBackgroundJobsDeclared` | No background jobs are declared. | Ba a bayyana wani aikin baya ba. | ☐ | |
| `ofcNoneBeneficiariesFound` | No beneficiaries found. | Ba a samu masu amfana ba. | ☐ | |
| `ofcNoneClearanceEventsRecorded` | No clearance events recorded. | Ba a rubuta abin da ya faru kan izini ba. | ☐ | |
| `ofcNoneCollectionsRecordedArea` | No collections recorded for this area. | Ba a rubuta karba ga wannan yankin ba. | ☐ | |
| `ofcNoneDevicesRegistered` | No devices registered. | Ba a yi rajistar na’ura ba. | ☐ | |
| `ofcNoneDistributionRoundCreated` | No distribution round has been created. | Ba a bude zagayen rabo ba. | ☐ | |
| `ofcNoneDistributionsSetUp` | No distributions have been set up yet. | Ba a shirya rabo ba tukuna. | ☐ | |
| `ofcNoneDocuments` | No documents. | Babu takardu. | ☐ | |
| `ofcNoneEndedRecordOwesAnything` | No ended record owes anything. | Babu rikodin da aka rufe da ake bin sa komai. | ☐ | |
| `ofcNoneFlowsAttemptedPeriod` | No flows have been attempted in this period. | Ba a gwada wani mataki ba a wannan lokacin. | ☐ | |
| `ofcNoneFraudSignalsMatchFilter` | No fraud signals match this filter. | Babu alamun zamba da suka dace da wannan tacewar. | ☐ | |
| `ofcNoneGroupsRegistered` | No groups have been registered yet. | Ba a yi rajistar kungiya ba tukuna. | ☐ | |
| `ofcNoneHandsetRegistered` | No handset has been registered yet. | Ba a yi rajistar waya ba tukuna. | ☐ | |
| `ofcNoneIncentiveProgrammesCreated` | No incentive programmes have been created. | Ba a kirkiri shirin tallafi ba. | ☐ | |
| `ofcNoneIndividualLevyCollectedAnything` | No individual levy has collected anything under this filter. | Babu harajin da ya karbi komai a karkashin wannan tacewar. | ☐ | |
| `ofcNoneLanguageUseReported` | No language use has been reported. | Ba a bayar da rahoton amfani da harshe ba. | ☐ | |
| `ofcNoneLocalGovernmentRevenueCollected` | No local government revenue has been collected in this period. | Ba a karbi harajin karamar hukuma ba a wannan lokacin. | ☐ | |
| `ofcNoneObligationsRecordedAgainstTaxpayer` | No obligations are recorded against this taxpayer. | Ba a rubuta wani wajibi a kan wannan mai biyan haraji ba. | ☐ | |
| `ofcNoneOfficersRecorded` | No officers are recorded. | Ba a rubuta jami’ai ba. | ☐ | |
| `ofcNoneOpenReconciliationExceptions` | No open reconciliation exceptions. | Babu kura-kuran daidaita lissafi a bude. | ☐ | |
| `ofcNonePayoutRequests` | No payout requests. | Babu bukatun biyan kudi. | ☐ | |
| `ofcNoneRateHistory` | No rate history. | Babu tarihin kudin haraji. | ☐ | |
| `ofcNoneRecordsMatchQuery` | No records match this query. | Babu rikodin da ya dace da wannan binciken. | ☐ | |
| `ofcNoneRefereeNominated` | No referee has been nominated. | Ba a zabi mai shaida ba. | ☐ | |
| `ofcNoneRefereeRiskFlagsOpen` | No referee risk flags are open. | Babu alamun hadarin mai shaida a bude. | ☐ | |
| `ofcNoneRefereeSupportsMoreApplicant` | No referee supports more than one applicant. | Babu mai shaida da ke goyon bayan mai nema fiye da daya. | ☐ | |
| `ofcNoneRefundOutstanding` | No refund is outstanding. | Babu mayarwar da ta rage. | ☐ | |
| `ofcNoneRevenueCollectedPeriod` | No revenue has been collected in this period. | Ba a karbi haraji ba a wannan lokacin. | ☐ | |
| `ofcNoneRevenueItemsConfigured` | No revenue items configured. | Ba a saita nau’in haraji ba. | ☐ | |
| `ofcNoneScreensReported` | No screens have been reported. | Ba a bayar da rahoton shafuka ba. | ☐ | |
| `ofcNoneSettlementsRecorded` | No settlements recorded. | Ba a rubuta turawar kudi ba. | ☐ | |
| `ofcNoneTicketsMatchFilter` | No tickets match this filter. | Babu rahotannin da suka dace da wannan tacewar. | ☐ | |
| `ofcNoneTrainingRecords` | No training records. | Babu rikodin horo. | ☐ | |
| `ofcNoneTransactionsMatchTheseFilters` | No transactions match these filters. | Babu ma’amalolin da suka dace da wadannan tacewar. | ☐ | |
| `ofcNoneVehiclesRecordedAgainstTaxpayer` | No vehicles are recorded against this taxpayer. | Ba a rubuta motoci a kan wannan mai biyan haraji ba. | ☐ | |
| `ofcNoneNobodyAwardedRound` | Nobody has been awarded from this round yet. | Ba a ba wa kowa daga wannan zagayen ba tukuna. | ☐ | |
| `ofcNoneNobodyAwardedRound2` | Nobody has been awarded under this round yet. | Ba a ba wa kowa a karkashin wannan zagayen ba tukuna. | ☐ | |
| `ofcNoneNobodyRecordedGroup` | Nobody has been recorded in this group yet. | Ba a rubuta kowa a wannan kungiyar ba tukuna. | ☐ | |
| `ofcNoneNobodyArrearsFilter` | Nobody is in arrears under this filter. | Babu wanda ke bin bashi a karkashin wannan tacewar. | ☐ | |
| `ofcNoneNobodyRegisteredFilter` | Nobody is registered under this filter. | Babu wanda aka yi wa rajista a karkashin wannan tacewar. | ☐ | |
| `ofcNoneNone` | None. | Babu. | ☐ | |
| `ofcNoneNothingCollectedFilter` | Nothing has been collected under this filter. | Ba a karbi komai a karkashin wannan tacewar ba. | ☐ | |
| `ofcNoneNothingPublished` | Nothing has been published yet. | Ba a buga komai ba tukuna. | ☐ | |
| `ofcNoneNothingWaiting` | Nothing waiting. | Babu abin da ke jira. | ☐ | |
| `ofcNoneAuthorityAcknowledgedRenewal` | The authority has acknowledged every renewal. | Hukumar ta amince da kowace sabuntawa. | ☐ | |
| `ofcNoneOfflineQueueUsedPeriod` | The offline queue has not been used in this period. | Ba a yi amfani da jerin gwanon ba tare da layi ba a wannan lokacin. | ☐ | |
| `ofcNoneRoles` | No role is configured. | Ba a saita wani matsayi ba. | ☐ | |
| `ofcNonePeriods` | No financial period has been opened yet. | Ba a bude wani lokacin kudi ba tukuna. | ☐ | |
| `ofcNoneDepartments` | No department has been created yet. | Ba a kirkiri wani sashe ba tukuna. | ☐ | |
| `ofcNoneOffices` | No revenue office has been created yet. | Ba a kirkiri ofishin haraji ba tukuna. | ☐ | |
| `ofcNoneTransfers` | No posting has been recorded for this officer. | Ba a rubuta wani matsayi ga wannan jami’i ba. | ☐ | |
| `ofcNoneTargetsSet` | No target has been set for this period. | Ba a sanya manufa don wannan lokaci ba. | ☐ | |
| `ofcNoneCasesMatchFilter` | No cases match these filters. | Babu kara da ya dace da wadannan tacewa. | ☐ | |

#### The officer portal — everything else

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcGrGroupSuspended` | {{name}} suspended. | An dakatar da {{name}}. | ☐ | |
| `ofcGrQuantityPeople` | {{quantity}} ({{n}} people) | {{quantity}} (mutane {{n}}) | ☐ | |
| `ofcPhTitle` | What they have already paid | Abin da suka riga suka biya | ☐ | |
| `ofcPhIntro` | Every payment that reached a government account, and what it was for. A taxpayer asking what they have paid is entitled to an answer they can check against their receipts. | Kowane biyan da ya isa asusun gwamnati, da abin da aka biya shi. Mai biyan haraji da ya tambayi abin da ya biya yana da hakkin samun amsar da zai iya duba ta da rasitunsa. | ☐ | |
| `ofcPhFrom` | From | Daga | ☐ | |
| `ofcPhTo` | To | Zuwa | ☐ | |
| `ofcPhPaid` | Paid | An biya | ☐ | |
| `ofcPhPayments` | Payments | Biyayya | ☐ | |
| `ofcPhReturned` | Returned to them | An mayar musu | ☐ | |
| `ofcPhForWhat` | What it went to | Abin da aka biya | ☐ | |
| `ofcPhLevy` | Tax or levy | Haraji ko kudin shiga | ☐ | |
| `ofcPhEachPayment` | Each payment | Kowane biya | ☐ | |
| `ofcPhWhen` | When | Yaushe | ☐ | |
| `ofcPhPeriod` | Period | Lokaci | ☐ | |
| `ofcPhAmount` | Amount | Adadi | ☐ | |
| `ofcPhReceipt` | Receipt | Rasit | ☐ | |
| `ofcPhNothingPaid` | Nothing was paid in this period. | Ba a biya komai a wannan lokacin ba. | ☐ | |
| `ofcAllStatuses` | All statuses | Dukkan matsayi | ☐ | |
| `ofcAllLgas` | All LGAs | Dukkan Kananan Hukumomi | ☐ | |
| `ofcFrom` | From | Daga | ☐ | |
| `ofcTo` | To | Zuwa | ☐ | |
| `ofcExportCsv` | Export CSV | Fitar da CSV | ☐ | |
| `ofcRlExportLimit` | Rows it may export | Layukan da zai iya fitarwa | ☐ | |
| `ofcRlExportsNothing` | Exports nothing | Ba ya fitar da komai | ☐ | |
| `ofcCwSave` | Save | Ajiye | ☐ | |
| `ofcInHint` | What you have been told, and what the platform is saying about itself. Mark a row read once you have dealt with it. | Abin da aka gaya maka, da abin da tsarin ke fada game da kansa. Ka yi wa layi alama a matsayin an karanta bayan ka magance shi. | ☐ | |
| `ofcInUnread` | Not yet read | Ba a karanta ba tukuna | ☐ | |
| `ofcInCritical` | Needing attention now | Na bukatar kulawa yanzu | ☐ | |
| `ofcInCriticalTitle` | The platform needs attention | Tsarin na bukatar kulawa | ☐ | |
| `ofcInSeverity` | How urgent | Yadda yake da gaggawa | ☐ | |
| `ofcInKind` | What it is | Menene shi | ☐ | |
| `ofcInSubject` | What happened | Abin da ya faru | ☐ | |
| `ofcInWhen` | When | Yaushe | ☐ | |
| `ofcInRead` | Read | An karanta | ☐ | |
| `ofcInMarkRead` | Mark read | Yi masa alamar an karanta | ☐ | |
| `ofcInReadAll` | Mark all read | Yi wa duka alamar an karanta | ☐ | |
| `ofcInShowAll` | Show everything | Nuna komai | ☐ | |
| `ofcInShowUnread` | Show unread only | Nuna wanda ba a karanta ba kadai | ☐ | |
| `ofcInToYourRole` | to your role | ga matsayinka | ☐ | |
| `ofcInNothing` | Nothing has been raised for you. | Ba a tayar da komai a gare ka ba. | ☐ | |
| `ofcAcSessions` | Sessions | Zaman shiga | ☐ | |
| `ofcAcSessionsHint` | Every browser this account is signed in on. End any you do not recognise, then change your password. | Kowane burauza da wannan asusun ya shiga a ciki. Ka kawo karshen duk wanda ba ka gane ba, sannan ka canza kalmar sirri. | ☐ | |
| `ofcAcDevices` | Machines | Na’urori | ☐ | |
| `ofcAcDevicesHint` | Recorded the first time this account signs in from a machine. Blocking one ends every session it holds and stops it opening another. | Ana rubuta shi lokacin da asusun ya fara shiga daga na’ura. Toshe daya yana kawo karshen kowane zaman da yake rike da shi kuma yana hana shi bude wani. | ☐ | |
| `ofcAcDevice` | Machine | Na’ura | ☐ | |
| `ofcAcUnknownDevice` | Unknown machine | Na’urar da ba a sani ba | ☐ | |
| `ofcAcThisOne` | this one | wannan | ☐ | |
| `ofcAcAddress` | Address | Adireshi | ☐ | |
| `ofcAcSignedIn` | Signed in | An shiga | ☐ | |
| `ofcAcLastUsed` | Last used | An yi amfani da shi ta karshe | ☐ | |
| `ofcAcFirstSeen` | First seen | An fara ganin sa | ☐ | |
| `ofcAcLastSeen` | Last seen | An gan shi ta karshe | ☐ | |
| `ofcAcLiveSessions` | Open sessions | Zaman da ke bude | ☐ | |
| `ofcAcEnd` | End | Kawo karshe | ☐ | |
| `ofcAcEndThisOne` | End and sign out | Kawo karshe ka fita | ☐ | |
| `ofcAcEnded` | Ended | An kawo karshe | ☐ | |
| `ofcAcBlock` | Block | Toshe | ☐ | |
| `ofcAcUnblock` | Unblock | Cire toshewa | ☐ | |
| `ofcAcBlockedBy` | Blocked by | Wanda ya toshe | ☐ | |
| `ofcAcNoSessions` | This account has never been signed in. | Wannan asusun bai taba shiga ba. | ☐ | |
| `ofcAcNoDevices` | No machine has been recorded yet. | Ba a rubuta wata na’ura ba tukuna. | ☐ | |
| `ofcCwUploadEvidence` | Upload evidence | Loda shaida | ☐ | |
| `ofcCwUploadHint` | For a document this platform did not issue: a bank advice, a letter, a photograph. Images and PDFs, up to 15 MB. | Don takardar da wannan tsarin bai fitar ba: sanarwar banki, wasika, hoto. Hotuna da PDF, har zuwa 15 MB. | ☐ | |
| `ofcCwUploadFile` | The file | Fayil | ☐ | |
| `ofcCwUploadWhat` | What it is | Menene shi | ☐ | |
| `ofcCwUploadWhere` | Where it came from | Daga ina ya zo | ☐ | |
| `ofcExportExcel` | Spreadsheet | Takardar lissafi | ☐ | |
| `ofcExportPdf` | Document to file | Takarda don ajiyewa | ☐ | |
| `ofcExportWorking` | Preparing... | Ana shirya... | ☐ | |
| `ofcDownloadCsv` | Download CSV | Sauke CSV | ☐ | |
| `ofcNothingToShow` | Nothing to show. | Babu abin da za a nuna. | ☐ | |
| `ofcRevenueAdministration` | Revenue administration | Gudanar da haraji | ☐ | |
| `ofcDistributionRound` | Distribution round | Zagayen rabo | ☐ | |
| `ofcLanguage` | Language | Harshe | ☐ | |
| `ofcSearchLabel` | Search government records | Nemi bayanan gwamnati | ☐ | |
| `ofcSearchPlaceholder` | Reference, TIN, name or receipt number | Lamba, TIN, suna ko lambar rasit | ☐ | |
| `ofcSearchSearching` | Searching… | Ana nema… | ☐ | |
| `ofcSearchNoResults` | Nothing matches that. | Babu abin da ya dace da haka. | ☐ | |
| `ofcSearchHint` | Two characters or more. | Haruffa biyu ko fiye. | ☐ | |
| `ofcSearchTransaction` | Transaction | Ma’amala | ☐ | |
| `ofcSearchTaxpayer` | Taxpayer | Mai biyan haraji | ☐ | |
| `ofcSearchAgent` | Agent | Wakili | ☐ | |
| `ofcSearchOfficer` | Officer | Jami’i | ☐ | |
| `ofcSearchInvoice` | Invoice | Takardar biya | ☐ | |
| `ofcSearchReceipt` | Receipt | Rasit | ☐ | |
| `ofcSearchPayment` | Payment | Biyan kudi | ☐ | |
| `ofcSearchAssessment` | Assessment | Kima | ☐ | |
| `ofcSearchVehicle` | Vehicle | Abin hawa | ☐ | |
| `ofcSearchRevenueItem` | Revenue item | Nau’in haraji | ☐ | |
| `ofcSearchPlace` | Local Government Area | Karamar hukuma | ☐ | |
| `ofcSearchCase` | Case | Kara | ☐ | |
| `ofcMwIntro` | Everything waiting for you, wherever on the platform it came from. | Duk abin da ke jiranka, ko daga ina ya zo a manhajar. | ☐ | |
| `ofcMwAssigned` | Assigned to you | An ba ka | ☐ | |
| `ofcMwAssignedBody` | Cases somebody has put in your hands. | Kararrakin da wani ya sa a hannunka. | ☐ | |
| `ofcMwOpened` | Cases you opened | Kararrakin da ka bude | ☐ | |
| `ofcMwOpenedBody` | Now somebody else’s to work, and still yours to follow. | Yanzu na wani ne ya yi, amma har yanzu naka ne ka bi. | ☐ | |
| `ofcMwMentions` | Where you were named | Inda aka ambace ka | ☐ | |
| `ofcMwMentionsBody` | An officer wrote your name on a case. | Wani jami’i ya rubuta sunanka a kan kara. | ☐ | |
| `ofcMwDepartment` | Waiting for your department | Yana jiran sashenka | ☐ | |
| `ofcMwDepartmentBody` | Sent to your role and picked up by nobody yet. | An aika wa matsayinka kuma babu wanda ya karba tukuna. | ☐ | |
| `ofcMwApprovals` | Approvals awaiting a decision | Amincewa da ke jiran hukunci | ☐ | |
| `ofcMwExceptions` | Reconciliation exceptions | Bambancin lissafi | ☐ | |
| `ofcMwFlags` | Risk flags | Alamun hadari | ☐ | |
| `ofcMwOverdue` | Overdue | Ya wuce lokaci | ☐ | |
| `ofcMwNothing` | Nothing is waiting for you. | Babu abin da ke jiranka. | ☐ | |
| `ofcMwOpenQueue` | Open the whole queue | Bude dukkan jerin aikin | ☐ | |
| `ofcCwTitle` | Government work queue | Jerin aikin gwamnati | ☐ | |
| `ofcCwIntro` | A case carries work between departments, and keeps every step of it. | Kara na daukar aiki tsakanin sassa, kuma yana rike da kowane matakinsa. | ☐ | |
| `ofcCwOpenCase` | Open a case | Bude kara | ☐ | |
| `ofcCwStatus` | Status | Matsayi | ☐ | |
| `ofcRlTitle` | Roles and permissions | Matsayi da izini | ☐ | |
| `ofcRlIntro` | Who may do what. This is data now, so a change in the Service's delegation of authority does not wait for a release. | Wa zai iya yin me. Wannan bayanai ne yanzu, don haka sauya wa wanda Hukumar ta ba iko ba ya jiran sabon fitarwa. | ☐ | |
| `ofcRlCatalogueNote` | The list of permissions that exist stays in code, because a permission is a name the routes check. A grant naming something no route checks would look like a control and be none. | Jerin izinin da suke nan ya kasance a cikin lambar, saboda izini suna ne da hanyoyin ke duba. Bayar da izinin da babu hanyar da ke duba shi zai yi kama da iko amma ba iko ba ne. | ☐ | |
| `ofcRlRole` | Role | Matsayi | ☐ | |
| `ofcRlOfficers` | Officers holding it | Jami’an da ke rike da shi | ☐ | |
| `ofcRlPermissions` | Permissions | Izini | ☐ | |
| `ofcRlSystemRole` | Ships with the platform | Yana zuwa da manhajar | ☐ | |
| `ofcRlPortalRole` | Signs in to this portal | Yana shiga wannan tashar | ☐ | |
| `ofcRlGrant` | Grant | Bayar | ☐ | |
| `ofcRlRevoke` | Take away | Cire | ☐ | |
| `ofcRlGrantReason` | Why this authority is being given | Dalilin bayar da wannan iko | ☐ | |
| `ofcRlRevokeReason` | Why this authority is being taken away | Dalilin cire wannan iko | ☐ | |
| `ofcRlRevokeWarning` | Everybody holding this role will be signed out. That is deliberate: the map is cached, and thirty seconds is a long time for somebody whose authority has just been withdrawn to keep exercising it. | Duk wanda ke rike da wannan matsayi za a fitar da shi. An yi haka da gangan: ana ajiye taswirar, kuma dakika talatin lokaci ne mai tsawo ga wanda aka cire wa iko ya ci gaba da amfani da shi. | ☐ | |
| `ofcRlNewRole` | Add a role | Kara matsayi | ☐ | |
| `ofcRlRoleName` | Name used in code | Sunan da ake amfani da shi a lambar | ☐ | |
| `ofcRlRoleLabel` | What officers see | Abin da jami’ai ke gani | ☐ | |
| `ofcRlCopyFrom` | Start from | Fara daga | ☐ | |
| `ofcRlCopyFromBody` | Starting from the nearest existing role and taking things away is safer than starting from nothing, which is how a role ends up with everything a week later, one emergency at a time. | Farawa daga matsayin da ya fi kusa sannan a cire abubuwa ya fi aminci fiye da farawa ba tare da komai ba, wanda shi ne yadda matsayi ke samun komai bayan mako guda, gaggawa daya bayan daya. | ☐ | |
| `ofcRlRetire` | Retire | Yi ritaya | ☐ | |
| `ofcRlRestore` | Bring back | Mayar da shi aiki | ☐ | |
| `ofcRlIsPortalRole` | This role signs in to the officer portal | Wannan matsayi yana shiga tashar jami’ai | ☐ | |
| `ofcRlSignedOut` | Officers signed out | Jami’an da aka fitar | ☐ | |
| `ofcRlSearchPermission` | Find a permission | Nemo izini | ☐ | |
| `ofcWbSamplesDrawn` | Samples drawn | Samfuran da aka zana | ☐ | |
| `ofcWbItemsOutstanding` | Items still to examine | Abubuwan da suka rage a duba | ☐ | |
| `ofcWbExceptionsFound` | Exceptions found | Matsalolin da aka samu | ☐ | |
| `ofcWbReportsHeld` | Reports on file | Rahotannin da ke fayil | ☐ | |
| `ofcWbSamples` | Samples | Samfura | ☐ | |
| `ofcWbSamplesHint` | Each row records a draw that already happened. The criteria, the method and the seed cannot be changed afterwards, which is what lets somebody else reproduce it. | Kowane layi yana rubuta zanen da ya riga ya faru. Ba za a iya canza sharudda, hanya ko iri ba bayan haka, wanda shi ne abin da ke ba wani damar maimaita shi. | ☐ | |
| `ofcWbSampleNumber` | Sample | Samfur | ☐ | |
| `ofcWbTitle` | What this is about | Abin da ya shafa | ☐ | |
| `ofcWbMethod` | How it was drawn | Yadda aka zana shi | ☐ | |
| `ofcWbMethodRandom` | At random, from a stored seed | Bazuwa, daga iri da aka ajiye | ☐ | |
| `ofcWbMethodSystematic` | Every nth, in date order | Kowane na n, bisa tsarin kwanan wata | ☐ | |
| `ofcWbMethodHighestValue` | The largest amounts (not a sample) | Mafi girman kudi (ba samfur ba ne) | ☐ | |
| `ofcWbDrawn` | Drawn of population | An zana daga jimla | ☐ | |
| `ofcWbPending` | Not yet examined | Ba a duba ba tukuna | ☐ | |
| `ofcWbExceptions` | Exceptions | Matsaloli | ☐ | |
| `ofcWbDrawnAt` | Drawn on | An zana a | ☐ | |
| `ofcWbDrawnBy` | Drawn by | Wanda ya zana | ☐ | |
| `ofcWbNoSamples` | No sample has been drawn yet. | Ba a zana samfur ba tukuna. | ☐ | |
| `ofcWbDraw` | Draw a sample | Zana samfur | ☐ | |
| `ofcWbDrawHint` | Say what the sample is for and how wide to look. Leaving a field empty means it does not narrow anything. | Ka fada me ake bukatar samfurin da kuma yadda za a duba. Barin fili babu komai yana nufin ba ya rage komai. | ☐ | |
| `ofcWbSize` | How many to draw | Nawa za a zana | ☐ | |
| `ofcWbFrom` | From | Daga | ☐ | |
| `ofcWbTo` | To | Zuwa | ☐ | |
| `ofcWbMinimumNaira` | Smallest amount (naira) | Mafi karancin kudi (naira) | ☐ | |
| `ofcWbDrawIsFinal` | A draw cannot be taken back or redrawn. Draw a fresh sample if these criteria are wrong. | Ba za a iya soke zane ko sake zana shi ba. Ka zana sabon samfur idan wadannan sharuddan ba daidai ba ne. | ☐ | |
| `ofcWbDrawnNotice` | {{number}} drawn, {{n}} transactions to examine. | An zana {{number}}, cinikayya {{n}} za a duba. | ☐ | |
| `ofcWbSeed` | Seed | Iri | ☐ | |
| `ofcWbPopulation` | Drawn from | An zana daga | ☐ | |
| `ofcWbPosition` | Item | Abu | ☐ | |
| `ofcWbOutcome` | Finding | Sakamako | ☐ | |
| `ofcWbFinding` | What was found | Abin da aka samu | ☐ | |
| `ofcWbRecord` | Record | Rubuta | ☐ | |
| `ofcWbNoItems` | This sample selected nothing. | Wannan samfurin bai zabi komai ba. | ☐ | |
| `ofcWbCompleteHint` | A sample can only be completed once every item has a finding. Half-finished work reported as complete is worse than no sample. | Ba za a iya kammala samfur ba sai kowane abu ya sami sakamako. Aikin da ba a gama ba amma aka ce an gama ya fi rashin samfur muni. | ☐ | |
| `ofcWbComplete` | Complete this sample | Kammala wannan samfurin | ☐ | |
| `ofcWbReports` | Audit reports | Rahotannin bincike | ☐ | |
| `ofcWbReportsHint` | Each report holds the rows as they stood when it was generated, with a checksum a reader can recompute. | Kowane rahoto yana rike da bayanan yadda suke a lokacin da aka samar da shi, tare da lambar tantancewa da mai karatu zai iya sake lissafawa. | ☐ | |
| `ofcWbReportNumber` | Report | Rahoto | ☐ | |
| `ofcWbReportType` | Question it answers | Tambayar da yake amsawa | ☐ | |
| `ofcWbRows` | Rows | Layuka | ☐ | |
| `ofcWbPeriod` | Period | Lokaci | ☐ | |
| `ofcWbGeneratedAt` | Generated on | An samar a | ☐ | |
| `ofcWbSignedBy` | Signed by | Wanda ya sa hannu | ☐ | |
| `ofcWbChecksum` | Checksum | Lambar tantancewa | ☐ | |
| `ofcWbAltered` | Altered | An sauya | ☐ | |
| `ofcWbAlteredTitle` | A report on this page no longer matches its checksum | Wani rahoto a wannan shafi bai sake dacewa da lambar tantancewarsa ba | ☐ | |
| `ofcWbAlteredBody` | {{n}} report(s) below hold figures that no longer hash to the checksum recorded when they were generated. A signature on such a report does not cover what it now shows. This is a change made in the database rather than through the platform — do not rely on those figures, and raise it. | Rahotanni {{n}} da ke kasa suna dauke da lambobin da ba su sake dacewa da lambar tantancewar da aka rubuta lokacin da aka kirkire su ba. Sa hannu a kan irin wannan rahoto bai shafi abin da yake nunawa yanzu ba. Wannan sauyi ne da aka yi a cikin bayanan kai tsaye, ba ta hanyar dandalin ba — kada ka dogara da wadannan lambobin, kuma ka daga kara. | ☐ | |
| `ofcWbNoReports` | No report has been generated yet. | Ba a samar da rahoto ba tukuna. | ☐ | |
| `ofcWbGenerate` | Generate a report | Samar da rahoto | ☐ | |
| `ofcWbGenerateHint` | Generating freezes the figures. Signing is a separate step, and often a different officer. | Samar da rahoto yana daskarar da lambobin. Sa hannu mataki ne daban, kuma sau da yawa jami’i ne daban. | ☐ | |
| `ofcWbGenerated` | {{number}} generated, {{n}} rows. | An samar da {{number}}, layuka {{n}}. | ☐ | |
| `ofcWbSign` | Sign | Sa hannu | ☐ | |
| `ofcWbWithdraw` | Withdraw | Janye | ☐ | |
| `ofcWbActions` | Actions | Ayyuka | ☐ | |
| `ofcWbClose` | Close | Rufe | ☐ | |
| `ofcWbReference` | Reference | Lamba | ☐ | |
| `ofcWbTaxpayer` | Taxpayer | Mai biyan haraji | ☐ | |
| `ofcWbAmount` | Amount | Kudi | ☐ | |
| `ofcPeTitle` | Financial periods | Lokutan kudi | ☐ | |
| `ofcPeIntro` | Closing a month freezes what the State says it collected in it. After a close the database itself refuses to write into the month — this is a control, not a report. | Rufe wata yana daskarar da abin da Jihar ta ce ta tara a cikinsa. Bayan rufewa, bayanan kansu suna hana rubutu cikin watan — wannan iko ne, ba rahoto ba. | ☐ | |
| `ofcPeOpenPeriod` | Open a period | Bude lokaci | ☐ | |
| `ofcPePeriod` | Period | Lokaci | ☐ | |
| `ofcPeCollected` | Collected | An tara | ☐ | |
| `ofcPeSettled` | Settled to government | An tura wa gwamnati | ☐ | |
| `ofcPeCommission` | Commission | Kwamishan | ☐ | |
| `ofcPeTransactions` | Transactions | Ma’amaloli | ☐ | |
| `ofcPeClose` | Close the month | Rufe watan | ☐ | |
| `ofcPeBeginClosing` | Begin closing | Fara rufewa | ☐ | |
| `ofcPeReopen` | Reopen | Sake budewa | ☐ | |
| `ofcPeClosedBy` | Closed by | Wanda ya rufe | ☐ | |
| `ofcPeReopenedBy` | Reopened by | Wanda ya sake budewa | ☐ | |
| `ofcPeClosingNote` | What is being certified | Abin da ake tabbatarwa | ☐ | |
| `ofcPeReopenReason` | Why it is being reopened | Dalilin sake budewa | ☐ | |
| `ofcPeNotReady` | Not ready to close | Bai shirya rufewa ba | ☐ | |
| `ofcPeNotReadyBody` | Closing over an unresolved exception or a pending payment freezes a figure already known to be wrong. It is sometimes the right call, and it is never a silent one. | Rufewa a kan bambancin da ba a warware ba ko biyan da ke jira yana daskarar da adadin da aka riga aka san ba daidai ba ne. Wani lokaci shi ne daidai, kuma ba a taba yin sa a boye ba. | ☐ | |
| `ofcPeOverride` | Why you are closing over them | Dalilin rufewa duk da haka | ☐ | |
| `ofcPeFiguresUnknown` | What this month still holds could not be read | Ba a iya karanta abin da wannan wata ke rike da shi ba | ☐ | |
| `ofcPeFiguresUnknownBody` | The platform could not count this month's unresolved exceptions or pending payments, so it cannot tell you whether the figure is settled. It may be. Closing is still possible, and it needs a reason in writing, because a month closed without knowing is a month closed over whatever was there. | Dandalin bai iya kirga sauran matsalolin da ba a warware ba ko biyan da ke jira na wannan wata ba, don haka ba zai iya gaya maka ko lambar ta tabbata ba. Watakila ta tabbata. Har yanzu ana iya rufewa, kuma yana bukatar dalili a rubuce, domin wata da aka rufe ba tare da sani ba, an rufe shi ne a kan duk abin da ke ciki. | ☐ | |
| `ofcPeUnreconciled` | Unresolved exceptions | Bambancin da ba a warware ba | ☐ | |
| `ofcPePendingPayments` | Payments still pending | Biyan da ke jira | ☐ | |
| `ofcPeFiguresNow` | What the month holds now | Abin da watan ke da shi yanzu | ☐ | |
| `ofcPeFrozen` | Frozen at close | An daskare a rufewa | ☐ | |
| `ofcPeReopenSeparate` | Reopening is the administrator's, not the closer's. The officer who closes the books also being able to unclose them removes most of what a period lock is for. | Sake budewa na mai gudanarwa ne, ba na wanda ya rufe ba. Idan jami’in da ya rufe littattafan zai iya sake budewa, hakan na kawar da yawancin dalilin kulle lokacin. | ☐ | |
| `ofcOrTitle` | The organisation | Kungiyar | ☐ | |
| `ofcOrIntro` | Who works with whom, who answers for them, and where they sit. A department is a body; a role is what somebody may do. Both are needed and neither replaces the other. | Wanda ke aiki da wa, wanda ke da alhakinsu, da inda suke zaune. Sashe jiki ne; matsayi shi ne abin da mutum zai iya yi. Ana bukatar dukansu kuma babu wanda ya maye gurbin dayan. | ☐ | |
| `ofcOrDepartments` | Departments | Sassa | ☐ | |
| `ofcOrOffices` | Revenue offices | Ofisoshin haraji | ☐ | |
| `ofcOrOfficesBody` | Where officers sit, which is not the territory they cover. The Jos North office administers three LGAs. | Inda jami’ai ke zaune, wanda ba yankin da suke rufewa ba ne. Ofishin Jos North yana kula da kananan hukumomi uku. | ☐ | |
| `ofcOrNewDepartment` | Add a department | Kara sashe | ☐ | |
| `ofcOrNewOffice` | Add an office | Kara ofishi | ☐ | |
| `ofcOrCode` | Code | Lamba | ☐ | |
| `ofcOrFunction` | Work it does | Aikin da yake yi | ☐ | |
| `ofcOrHead` | Answers for it | Wanda ke da alhakinsa | ☐ | |
| `ofcOrParent` | Sits under | Yana karkashin | ☐ | |
| `ofcOrOfficers` | Officers | Jami’ai | ☐ | |
| `ofcOrOpenCases` | Open cases | Kararrakin da ba a rufe ba | ☐ | |
| `ofcOrCovers` | Administers | Yana kula da | ☐ | |
| `ofcOrClose` | Close | Rufe | ☐ | |
| `ofcOrPosting` | Posting | Matsayi | ☐ | |
| `ofcOrPostingBody` | Each part that moves is recorded as its own dated transfer, so a move to Finance and a change of supervisor have separate answers. | Ana rubuta kowane bangare da ya motsa a matsayin canjin kansa mai kwanan wata, don haka matsawa zuwa Kudi da sauya wanda ake bayar da rahoto gare shi suna da amsoshi daban. | ☐ | |
| `ofcOrMoveOfficer` | Move this officer | Matsar da wannan jami’i | ☐ | |
| `ofcOrDepartment` | Department | Sashe | ☐ | |
| `ofcOrOffice` | Office | Ofishi | ☐ | |
| `ofcOrSupervisor` | Reports to | Yana bayar da rahoto ga | ☐ | |
| `ofcOrJobTitle` | Job title | Mukami | ☐ | |
| `ofcOrStaffNumber` | Staff number | Lambar ma’aikaci | ☐ | |
| `ofcOrWhyMoving` | Why they are moving | Dalilin matsawa | ☐ | |
| `ofcOrEffectiveFrom` | From | Daga | ☐ | |
| `ofcOrHistory` | Posting history | Tarihin matsayi | ☐ | |
| `ofcOrHistoryBody` | Append-only. Who was responsible for an area in a given month is asked in revenue disputes, and an answer that can be adjusted afterwards is not one. | Ana kara kawai. Ana tambayar wa ke da alhakin wani yanki a wani wata a jayayyar haraji, kuma amsar da za a iya gyarawa daga baya ba amsa ba ce. | ☐ | |
| `ofcOrNobody` | Nobody | Babu kowa | ☐ | |
| `ofcOrUnposted` | Not posted | Ba a saka ba | ☐ | |
| `ofcCwEscalate` | Escalate | Daukaka | ☐ | |
| `ofcCwEscalateBody` | Sends the case to the officer above, with its whole history attached. If nobody is above, it says so rather than marking the case escalated and leaving it here. | Yana aika karar ga jami’in da ke sama, tare da duk tarihinta. Idan babu kowa a sama, zai fada maimakon a sa alamar daukaka a bar ta a nan. | ☐ | |
| `ofcCwEscalateReason` | Why it needs somebody above | Dalilin bukatar wani a sama | ☐ | |
| `ofcCwEscalatedTo` | Escalated to | An daukaka zuwa | ☐ | |
| `ofcTaTitle` | The taxpayer base | Masu biyan haraji | ☐ | |
| `ofcTaIntro` | Not how many people are on the register, but how many are still paying, how often, and where the ones who stopped are. | Ba yawan mutanen da ke rajista ba, sai dai nawa ne har yanzu ke biya, sau nawa, da kuma inda wadanda suka daina suke. | ☐ | |
| `ofcTaActive` | Paying | Suna biya | ☐ | |
| `ofcTaActiveHint` | Paid something in the last ninety days | Sun biya wani abu cikin kwanaki casa’in da suka wuce | ☐ | |
| `ofcTaInactive` | Stopped paying | Sun daina biya | ☐ | |
| `ofcTaNeverPaid` | Never paid | Ba su taba biya ba | ☐ | |
| `ofcTaTotal` | On the register | A rajista | ☐ | |
| `ofcTaNewThisMonth` | Registered this month | An yi rajista wannan watan | ☐ | |
| `ofcTaAverageLifetime` | Average paid, each | Matsakaicin abin da kowa ya biya | ☐ | |
| `ofcTaFrequency` | How often somebody who pays, pays | Sau nawa mai biya yake biya | ☐ | |
| `ofcTaFrequencyBody` | Banded rather than averaged. A mean over a population where most paid once and a few paid twelve times describes nobody in it. | An rarraba maimakon a dauki matsakaici. Matsakaici a cikin jama’a inda mafi yawa suka biya sau daya kuma kadan suka biya sau goma sha biyu ba ya siffanta kowa a cikinsu. | ☐ | |
| `ofcTaByLga` | The register by Local Government Area | Rajista bisa karamar hukuma | ☐ | |
| `ofcTaByCategory` | Which levies the register is engaged with | Harajin da masu rajista ke da alaka da su | ☐ | |
| `ofcTaTaxpayersAssessed` | Assessed | An kima | ☐ | |
| `ofcTaTaxpayersPaid` | Paid | Sun biya | ☐ | |
| `ofcTaAveragePayment` | Average payment | Matsakaicin biya | ☐ | |
| `ofcTaComplianceScore` | Average compliance score | Matsakaicin makin bin doka | ☐ | |
| `ofcTaOutstanding` | Outstanding | Abin da ake bin su | ☐ | |
| `ofcCmByPlace` | Commission by Local Government Area | Kwamishan bisa karamar hukuma | ☐ | |
| `ofcCmByPeriod` | Commission by month | Kwamishan bisa wata | ☐ | |
| `ofcCmAccrued` | Accrued | An tara | ☐ | |
| `ofcCmPaidOut` | Paid | An biya | ☐ | |
| `ofcCmOutstandingCommission` | Outstanding | Bai biya ba | ☐ | |
| `ofcTgTitle` | Revenue targets | Manufofin haraji | ☐ | |
| `ofcTgIntro` | What the Service expects to raise, and what has come in against it. | Abin da Hukumar ke tsammanin tarawa, da abin da ya shigo a kansa. | ☐ | |
| `ofcTgSetTarget` | Set a target | Sanya manufa | ☐ | |
| `ofcTgScope` | Set against | An sanya wa | ☐ | |
| `ofcTgScopeState` | The whole State | Duk Jihar | ☐ | |
| `ofcTgScopeLga` | One Local Government Area | Karamar hukuma daya | ☐ | |
| `ofcTgScopeCategory` | One revenue category | Nau’in haraji daya | ☐ | |
| `ofcTgScopeItem` | One revenue item | Harajin guda daya | ☐ | |
| `ofcTgScopeAgent` | One agent | Wakili daya | ☐ | |
| `ofcTgPeriod` | Period | Lokaci | ☐ | |
| `ofcTgPeriodDaily` | Daily | Kullum | ☐ | |
| `ofcTgPeriodWeekly` | Weekly | Mako-mako | ☐ | |
| `ofcTgPeriodMonthly` | Monthly | Wata-wata | ☐ | |
| `ofcTgPeriodQuarterly` | Quarterly | Kwata-kwata | ☐ | |
| `ofcTgPeriodAnnual` | Annual | Shekara-shekara | ☐ | |
| `ofcTgAmount` | Target amount | Adadin manufa | ☐ | |
| `ofcTgNote` | Why this figure | Dalilin wannan adadi | ☐ | |
| `ofcTgTarget` | Target | Manufa | ☐ | |
| `ofcTgCollected` | Collected | An tara | ☐ | |
| `ofcTgAchievement` | Achievement | Cimma buri | ☐ | |
| `ofcTgGap` | Gap | Rata | ☐ | |
| `ofcTgThroughPeriod` | Through the period | Cikin lokacin | ☐ | |
| `ofcTgRollup` | State target and what was apportioned below it | Manufar jiha da abin da aka raba a karkashinta | ☐ | |
| `ofcTgRollupBody` | These do not have to agree. The State figure normally carries headroom, and an LGA with no target of its own is the more useful thing to notice. | Ba lallai su daidaita ba. Adadin Jihar yakan dauki karin sarari, kuma karamar hukuma da ba ta da manufa ita ce abin lura mafi amfani. | ☐ | |
| `ofcTgStateTarget` | State target | Manufar jiha | ☐ | |
| `ofcTgApportioned` | Apportioned to LGAs | An raba wa kananan hukumomi | ☐ | |
| `ofcTgLgasWithout` | LGAs with no target | Kananan hukumomin da ba su da manufa | ☐ | |
| `ofcTgWithdraw` | Withdraw | Janye | ☐ | |
| `ofcTgWithdrawReason` | Why it is being withdrawn | Dalilin janyewa | ☐ | |
| `ofcTgSuperseded` | This replaces an earlier target for the same period. | Wannan ya maye gurbin manufar da ta gabata na wannan lokaci. | ☐ | |
| `ofcTgSetBy` | Set by | Wanda ya sanya | ☐ | |
| `ofcTgShowSuperseded` | Include revised and withdrawn | Hada da wadanda aka sauya ko janye | ☐ | |
| `ofcFcTitle` | Forecast | Hasashe | ☐ | |
| `ofcFcNotATarget` | This is a forecast, not a target and not guaranteed revenue. It is arithmetic on what has been collected so far and what previous years did by this point. | Wannan hasashe ne, ba manufa ba kuma ba tabbataccen kudin shiga ba. Lissafi ne kan abin da aka tara ya zuwa yanzu da abin da shekarun baya suka yi a wannan lokaci. | ☐ | |
| `ofcFcProjected` | Projected for the period | Hasashen lokacin | ☐ | |
| `ofcFcBasis` | Worked out from | An lissafa daga | ☐ | |
| `ofcFcConfidence` | Confidence | Tabbaci | ☐ | |
| `ofcFcSeasonalShare` | Usually collected by this point | Yawanci ana tarawa ya zuwa yanzu | ☐ | |
| `ofcFcComparablePeriods` | Comparable periods used | Lokutan da aka kwatanta | ☐ | |
| `ofcFcProjectedAchievement` | Projected against target | Hasashe kan manufa | ☐ | |
| `ofcCwSubject` | Subject | Batu | ☐ | |
| `ofcCwDescription` | What happened | Abin da ya faru | ☐ | |
| `ofcCwCategory` | Category | Nau’i | ☐ | |
| `ofcCwRisk` | Risk | Hadari | ☐ | |
| `ofcCwPriority` | Priority | Muhimmanci | ☐ | |
| `ofcCwDepartment` | Send to | Aika wa | ☐ | |
| `ofcCwAssignee` | Assign to | Ba wa | ☐ | |
| `ofcCwNobody` | Nobody yet | Babu kowa tukuna | ☐ | |
| `ofcCwAnyDepartment` | No department | Babu sashe | ☐ | |
| `ofcCwDue` | Due | Ranar karshe | ☐ | |
| `ofcCwOnlyOpen` | Only open cases | Kararrakin da ba a rufe ba kadai | ☐ | |
| `ofcCwOnlyOverdue` | Only overdue | Wadanda suka wuce lokaci kadai | ☐ | |
| `ofcCwOpenedBy` | Opened by | Wanda ya bude | ☐ | |
| `ofcCwCaseNumber` | Case | Kara | ☐ | |
| `ofcCwComments` | Comments | Sharhi | ☐ | |
| `ofcCwEvidence` | Evidence | Hujja | ☐ | |
| `ofcCwBackToQueue` | Back to the queue | Koma jerin aikin | ☐ | |
| `ofcCwHistory` | History | Tarihi | ☐ | |
| `ofcCwAddComment` | Add a comment | Kara sharhi | ☐ | |
| `ofcCwInternalNote` | Keep this as an internal note | Ajiye wannan a matsayin bayanin cikin gida | ☐ | |
| `ofcCwMention` | Name an officer | Ambaci jami’i | ☐ | |
| `ofcCwPost` | Post | Aika | ☐ | |
| `ofcCwMoveCase` | Move this case | Matsar da wannan kara | ☐ | |
| `ofcCwChangeStatus` | Change the status | Sauya matsayi | ☐ | |
| `ofcCwResolution` | What it concluded | Abin da ya kammala | ☐ | |
| `ofcCwResolutionRequired` | Say what the case concluded before resolving it. | Fada abin da karar ta kammala kafin ka warware ta. | ☐ | |
| `ofcCwSaved` | Saved. | An adana. | ☐ | |
| `ofcCwNotYours` | This case is not assigned to you and you did not open it, so you may comment and nothing more. | Ba a ba ka wannan kara ba kuma ba kai ka bude ta ba, don haka za ka iya yin sharhi kadai. | ☐ | |
| `ofcCwAbout` | About | Game da | ☐ | |
| `ofcCwWhy` | Why | Dalili | ☐ | |
| `ofcCwSubjectTooShort` | Give the case a subject of at least five characters. | Ba karar batu na akalla haruffa biyar. | ☐ | |
| `ofcCwSampleSubject` | Collections trebled with no new taxpayers | Karbar kudi ta ninka sau uku ba tare da sabbin masu biyan haraji ba | ☐ | |
| `ofcCwSampleDescription` | Say what you saw, where, and what you would like the other department to check. | Fada abin da ka gani, a ina, da abin da kake so dayan sashen ya duba. | ☐ | |
| `ofcCwAppendOnly` | Nothing here can be edited or removed. A correction is another entry. | Ba za a iya gyara ko cire komai a nan ba. Gyara wani shigarwa ne. | ☐ | |
| `ofcT3Title` | Transaction file | Fayil din ma’amala | ☐ | |
| `ofcT3Intro` | The whole story of one collection, from the taxpayer to the government account. | Cikakken labarin karbar kudi guda, daga mai biyan haraji zuwa asusun gwamnati. | ☐ | |
| `ofcT3Find` | Find a transaction | Nemo ma’amala | ☐ | |
| `ofcT3FindBody` | A transaction reference, or a receipt number off a citizen’s message. | Lambar ma’amala, ko lambar rasit daga sakon dan kasa. | ☐ | |
| `ofcT3Chain` | The chain | Sarkar | ☐ | |
| `ofcT3Assessment` | Assessment | Kima | ☐ | |
| `ofcT3Invoice` | Invoice | Takardar biya | ☐ | |
| `ofcT3Payment` | Payment | Biyan kudi | ☐ | |
| `ofcT3Gateway` | Gateway | Kofar biyan kudi | ☐ | |
| `ofcT3Settlement` | Settlement | Turawar kudi | ☐ | |
| `ofcT3Reconciliation` | Reconciliation | Daidaita lissafi | ☐ | |
| `ofcT3Commission` | Commission | Kwamishan | ☐ | |
| `ofcT3Refunds` | Refunds | Mayar da kudi | ☐ | |
| `ofcT3Timeline` | What happened, in order | Abin da ya faru, bi da bi | ☐ | |
| `ofcT3TimelineBody` | The platform’s own record and the officers’ actions, on one clock. | Rijistar manhajar da ayyukan jami’ai, a agogo guda. | ☐ | |
| `ofcT3Platform` | Platform | Manhaja | ☐ | |
| `ofcT3OfficerAction` | Officer action | Aikin jami’i | ☐ | |
| `ofcT3Before` | Before | Kafin | ☐ | |
| `ofcT3After` | After | Bayan | ☐ | |
| `ofcT3CasesAndFlags` | Cases and risk flags | Kararraki da alamun hadari | ☐ | |
| `ofcT3OpenCaseAbout` | Open a case about this transaction | Bude kara game da wannan ma’amala | ☐ | |
| `ofcT3Withheld` | Not shown to your role | Ba a nuna wa matsayinka ba | ☐ | |
| `ofcT3WithheldBody` | These parts exist and your permissions do not reach them. They are named so an empty section is never mistaken for an empty record. | Wadannan sassan suna nan amma izininka bai kai gare su ba. An ambace su domin kada a dauki sashe mara komai a matsayin rijista mara komai. | ☐ | |
| `ofcT3NoPayment` | No payment has been attempted. | Ba a yi yunkurin biyan kudi ba. | ☐ | |
| `ofcT3NoReceipt` | No receipt has been issued. | Ba a bayar da rasit ba. | ☐ | |
| `ofcT3NoSettlement` | The money has not reached the government account yet. | Kudin bai isa asusun gwamnati ba tukuna. | ☐ | |
| `ofcT3NoCommission` | No commission was earned. | Ba a samu kwamishan ba. | ☐ | |
| `ofcT3NoReconciliation` | This has not been through a reconciliation run. | Wannan bai wuce ta zagayen daidaita lissafi ba. | ☐ | |
| `ofcT3Channel` | Channel | Hanya | ☐ | |
| `ofcT3Where` | Where | Ina | ☐ | |
| `ofcT3ServiceCharge` | Service charge | Kudin hidima | ☐ | |
| `ofcT3Verified` | Verified | An tabbatar | ☐ | |
| `ofcT3NothingLinked` | No case or flag is linked to this transaction. | Babu kara ko alamar hadari da ke da nasaba da wannan ma’amala. | ☐ | |
| `ofcPortalName` | PSIRS Portal | Shafin PSIRS | ☐ | |
| `ofcStateGovernment` | Plateau State Government | Gwamnatin Jihar Filato | ☐ | |
| `ofcReturnToDashboard` | Return to the dashboard | Koma allon aiki | ☐ | |
| `ofcSignOut` | Sign out | Fita | ☐ | |
| `ofcPageNotFound` | That page does not exist. | Wannan shafin babu shi. | ☐ | |
| `ofcReadOnly` | read-only | karatu kawai | ☐ | |
| `ofcDailyTrend` | Daily collection trend | Yanayin karban kudi na kullum | ☐ | |
| `ofcNoDataForPeriod` | No data for this period. | Babu bayanai na wannan lokacin. | ☐ | |
| `ofcGrApproved` | {{name}} approved. Members can now be recorded. | An amince da {{name}}. Yanzu za a iya rubuta mambobi. | ☐ | |
| `ofcGrCollectedAt` |  · collected at {{place}} |  · ana karba a {{place}} | ☐ | |
| `ofcItemBackInCatalogue` | {{name}} is back in the catalogue and can be assessed again. | {{name}} ya dawo cikin lissafin kuma ana iya kimanta shi kuma. | ☐ | |
| `ofcItemSuspended` | {{name}} is suspended. No new assessment can be raised against it; invoices already issued stay payable. | An dakatar da {{name}}. Ba za a iya kada wani sabon kimantawa a kansa ba; takardun biya da aka riga aka fitar sun ci gaba da zama abin biya. | ☐ | |
| `ofcItemRetired` | {{name}} has been retired. Invoices already issued stay payable, and the item cannot be brought back. | An yi ritayar {{name}}. Takardun biya da aka riga aka fitar sun ci gaba da zama abin biya, kuma ba za a iya mayar da abun ba. | ☐ | |
| `ofcKyOpenAndReview` | Open and review | Bude ka duba | ☐ | |
| `ofcKyReviewedOn` | Reviewed on | An duba a ranar | ☐ | |
| `ofcKyTheAccessLogCould` | The access log could not be read. | Ba a iya karanta rikodin shiga ba. | ☐ | |
| `ofcLgCouldNotReachThe` | Could not reach the revenue platform. Check your connection. | Ba a iya isa ga dandalin haraji ba. Ka duba haduwarka da yanar gizo. | ☐ | |

#### The agent’s first screen

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `homeQaRenewVehicle` | Renew vehicle | Sabunta mota | ☐ | |
| `homeQaFindTaxpayer` | Find taxpayer | Nemo mai biyan haraji | ☐ | |
| `homeQaCheckReceipt` | Check a receipt | Duba rasit | ☐ | |
| `homeQaHandOut` | Hand out allocation | Bayar da rabo | ☐ | |
| `homeQaGroups` | Groups | Kungiyoyi | ☐ | |
| `homeGoodMorning` | Good morning | Barka da safiya | ☐ | |
| `homeGoodAfternoon` | Good afternoon | Barka da rana | ☐ | |
| `homeGoodEvening` | Good evening | Barka da yamma | ☐ | |
| `homeAccountSuspended` | Your agent account is suspended | An dakatar da asusun wakilcinka | ☐ | |
| `homeApplicationProcessing` | Your application is still being processed | Ana ci gaba da sarrafa bukatarka | ☐ | |
| `homeTransactions` | transactions | ma’amaloli | ☐ | |
| `homeCommissionWord` | commission | kwamishan | ☐ | |
| `homeRegisteredWord` | registered | an yi rajista | ☐ | |
| `homePendingTitle` | {{n}} payment(s) awaiting confirmation | Biyan kudi {{n}} na jiran tabbatarwa | ☐ | |
| `homeViewApplication` | View my application | Duba bukatata | ☐ | |
| `homeCollectedToday` | Collected today | An karba yau | ☐ | |
| `homeQuickActions` | Quick actions | Ayyuka masu sauri | ☐ | |
| `homeRecentTransactions` | Recent transactions | Ma’amalolin baya-bayan nan | ☐ | |
| `homeNoTransactions` | No transactions yet. Start by registering or finding a taxpayer. | Babu ma’amala tukuna. Fara da yin rajista ko neman mai biyan haraji. | ☐ | |
| `homeLifetime` | Lifetime | Jimla gaba daya | ☐ | |
| `homeTaxpayersRegistered` | Taxpayers registered | Masu biyan haraji da aka yi wa rajista | ☐ | |
| `homeCommissionEarned` | Commission earned | Kwamishan da aka samu | ☐ | |
| `homeAvailableForPayout` | Available for payout | Wanda ake iya biya | ☐ | |

#### The tab bar

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `navHome` | Home | Gida | ☐ | |
| `navTaxpayers` | Taxpayers | Masu Biyan Haraji | ☐ | |
| `navCollect` | Collect | Karbi Haraji | ☐ | |
| `navReceipts` | Receipts | Takardun Rasit | ☐ | |
| `navCommission` | Commission | Kwamishan | ☐ | |
| `navProfile` | Profile | Profile | ☐ | |

#### Taking a payment

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `colReceiptNumbered` | Receipt {{number}} | Rasit {{number}} | ☐ | |
| `colPayReceipted` | Payment confirmed. Receipt {{number}} has been issued. | An tabbatar da biyan kudi. An fitar da rasit {{number}}. | ☐ | |
| `colPayAwaitingSettlement` | The gateway has confirmed this payment. The government receipt is issued once the money reaches a government account. | Tashar ta tabbatar da wannan biyan kudi. Za a fitar da rasit na gwamnati sai kudin ya isa asusun gwamnati. | ☐ | |
| `colPayStillPending` | The gateway has not answered yet. Do not take this payment again — check back shortly. | Tashar ba ta ba da amsa ba tukuna. Kada ka sake karbar wannan kudin — ka sake dubawa nan ba da jimawa ba. | ☐ | |
| `colPayFailed` | The payment did not succeed. No money has been received and no receipt has been issued. | Biyan kudin bai yi nasara ba. Ba a karbi kudi ba kuma ba a fitar da rasit ba. | ☐ | |
| `colShareTitle` | PSIRS receipt | Rasit na PSIRS | ☐ | |
| `colShareBody` | PSIRS receipt {{number}} for {{name}}. Verify with code {{code}}. | Rasit na PSIRS {{number}} na {{name}}. Ka tantance da lambar {{code}}. | ☐ | |
| `colChangeChoice` | Change | Canza | ☐ | |
| `colNeedBaseAmount` | Enter the amount the assessment is based on, in naira. | Ka shigar da kudin da aka gina kimar a kansa, da naira. | ☐ | |
| `colNoTin` | No TIN | Babu TIN | ☐ | |
| `colBasisAmountHint` | For example turnover, income or contract value. The charge itself is set by government. | Misali kudin shiga, riba ko darajar kwangila. Gwamnati ce ke saita kudin da kansa. | ☐ | |
| `colTaxpayerLabel` | Taxpayer | Mai biyan haraji | ☐ | |
| `colRevenueLabel` | Revenue | Haraji | ☐ | |
| `colGovernmentRevenue` | Government revenue | Harajin gwamnati | ☐ | |
| `colServiceCharge` | Approved service charge | Kudin hidima da aka amince da shi | ☐ | |
| `colTotalPayable` | Total payable | Jimlar da za a biya | ☐ | |
| `colInvoiceLabel` | Invoice | Takardar biya | ☐ | |
| `colPaymentStatus` | Payment status | Matsayin biyan kudi | ☐ | |
| `colGatewayReference` | Gateway reference | Lambar tashar biya | ☐ | |
| `colPrinting` | Transmitting receipt to Bluetooth printer... | Ana tura rasit zuwa na’urar buga takarda ta Bluetooth... | ☐ | |
| `colPrinted` | Receipt printed successfully on Bluetooth printer! | An buga rasit cikin nasara a na’urar Bluetooth! | ☐ | |
| `colPrintFailed` | Bluetooth printing failed: {{reason}} | Buga takarda ta Bluetooth ya gagara: {{reason}} | ☐ | |
| `colCheckPrinter` | Check printer connection | Ka duba hadin na’urar buga takarda | ☐ | |
| `colPrintBluetooth` | Print (Bluetooth) | Buga (Bluetooth) | ☐ | |
| `colReceiptCopied` | Receipt details copied. You can paste them into a message. | An kwafi bayanan rasit. Za ka iya liko su cikin sako. | ☐ | |
| `colPreparingInvoice` | Preparing the invoice… | Ana shirya takardar biya… | ☐ | |
| `colGiveInvoice` | Give the taxpayer an invoice | Ba mai biyan haraji takardar biya | ☐ | |
| `colInvoiceHint` | A printable demand notice with the invoice number, what it is for and how the amount was worked out | Sanarwar biya da za a iya bugawa, dauke da lambar takardar biya, abin da ake biya da yadda aka lissafa kudin | ☐ | |
| `colInvoiceValidUntil` | , valid until {{date}} | , yana aiki har {{date}} | ☐ | |
| `colInvoiceGiveReference` | Give them the payment reference {{reference}} as well — that is what a bank or USSD channel asks for. | Ka ba su lambar biyan kudi {{reference}} shi ma — wannan ne abin da banki ko tashar USSD ke nema. | ☐ | |
| `colCheckingPayment` | Checking with the payment system… | Ana dubawa tare da tsarin biyan kudi… | ☐ | |
| `colCheckPaymentStatus` | Check payment status | Duba matsayin biyan kudi | ☐ | |
| `colDevGateway` | Development gateway | Tashar gwaji | ☐ | |
| `colDevGatewayHint` | This platform is running against a test payment gateway. Use these controls to simulate what a real gateway would report. | Wannan dandalin yana aiki da tashar biyan kudi ta gwaji. Ka yi amfani da wadannan don kwaikwayon abin da tashar gaske za ta bayar. | ☐ | |
| `colSimulateSuccess` | Simulate success | Kwaikwayon nasara | ☐ | |
| `colSimulateFailure` | Simulate failure | Kwaikwayon gazawa | ☐ | |
| `colWhoIsPaying` | Who is paying? | Wa ke biya? | ☐ | |
| `colSearchTaxpayer` | Search taxpayer | Nemo mai biyan haraji | ☐ | |
| `colNamePhoneTin` | Name, phone or TIN | Suna, waya ko TIN | ☐ | |
| `colChangeTaxpayer` | Change taxpayer | Canza mai biyan haraji | ☐ | |
| `colRegisterNew` | Register a new taxpayer | Yi rajistar sabon mai biyan haraji | ☐ | |
| `colWhatPaying` | What are they paying? | Me suke biya? | ☐ | |
| `colRevenueItem` | Revenue item | Nau’in haraji | ☐ | |
| `colSelectItem` | Select a revenue item | Zabi nau’in haraji | ☐ | |
| `colBasisAmount` | Amount the charge is calculated on (₦) | Adadin da ake lissafin haraji a kai (₦) | ☐ | |
| `colCalculate` | Calculate amount | Lissafa adadi | ☐ | |
| `colHowCalculated` | How this amount was calculated | Yadda aka lissafa wannan adadin | ☐ | |
| `colAboutToCollect` | You are about to collect | Za ka karba | ☐ | |
| `colConfirmProceed` | Confirm and proceed to payment | Tabbatar ka ci gaba zuwa biyan kudi | ☐ | |
| `colDownloadReceipt` | Download receipt | Sauke rasit | ☐ | |
| `colShareReceipt` | Share receipt | Raba rasit | ☐ | |
| `colHistory` | History | Tarihi | ☐ | |
| `colBackHome` | Back to home | Koma shafin farko | ☐ | |
| `colOfflineTitle` | You are offline | Ba ka da intanet | ☐ | |
| `colOfflineBody` | Revenue cannot be collected without a connection. Government payments must be confirmed by the payment system before a receipt exists. | Ba za a iya karbar haraji ba tare da intanet ba. Dole tsarin biyan kudi ya tabbatar da kudin gwamnati kafin a sami rasit. | ☐ | |
| `colInvoiceReady` | Invoice {{number}} is ready to print or send. | Takardar biyan kudi {{number}} tana shirye don bugawa ko aikawa. | ☐ | |

#### The taxpayer register

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `tpFindTaxpayer` | Find a taxpayer | Nemo mai biyan haraji | ☐ | |
| `tpSearchHint` | Search by name, business name, phone number, TIN, receipt number or vehicle registration. | Ka bincika da suna, sunan kasuwanci, lambar waya, TIN, lambar rasit ko lambar mota. | ☐ | |
| `tpSearchPlaceholder` | Name, phone or TIN | Suna, waya ko TIN | ☐ | |
| `tpSearchByNamePhoneTin` | Search by name, phone number or TIN | Ka bincika da suna, lambar waya ko TIN | ☐ | |
| `tpNoTinYet` | No TIN yet | Babu TIN tukuna | ☐ | |
| `tpRegisterNew` | Register a new taxpayer | Yi rajistar sabon mai biyan haraji | ☐ | |
| `tpTaxpayerPaying` | Taxpayer paying | Mai biyan haraji | ☐ | |
| `tpUnnamedTaxpayer` | Unnamed taxpayer | Mai biyan haraji marar suna | ☐ | |
| `tpChooseSomeoneElse` | Choose someone else | Zabi wani | ☐ | |
| `tpStepTin` | TIN | Lambar TIN | ☐ | |
| `tpStepDetails` | Details | Bayanai | ☐ | |
| `tpStepIdentification` | Identification | Shaida | ☐ | |
| `tpStepAddress` | Address | Adireshi | ☐ | |
| `tpStepActivity` | Activity | Sana’a | ☐ | |
| `tpStepReview` | Review | Duba | ☐ | |
| `tpStepOf` | Step {{n}} of {{total}} | Mataki {{n}} na {{total}} | ☐ | |
| `tpSavedOnDevice` | Saved on this device | An adana a wannan na’ura | ☐ | |
| `tpBackToHome` | Back to home | Koma shafin farko | ☐ | |
| `tpTaxpayerRegistered` | Taxpayer registered | An yi wa mai biyan haraji rajista | ☐ | |
| `tpGiveTinToTaxpayer` | Give this number to the taxpayer. They will need it for every government payment. | Ka ba mai biyan haraji wannan lambar. Za su bukace ta a duk biyan kudi na gwamnati. | ☐ | |
| `tpTinRequested` | TIN request submitted | An tura bukatar TIN | ☐ | |
| `tpCollectRevenue` | Collect revenue | Karbi haraji | ☐ | |
| `tpEnumerate` | Write down the business | Rubuta yadda kasuwancin yake | ☐ | |
| `tpViewProfile` | View profile | Duba bayanai | ☐ | |
| `tpPossibleExisting` | Possible existing taxpayer | Mai biyan haraji da watakila yana nan | ☐ | |
| `tpDupIdentityNumber` | The same identification number is already registered | An riga an yi rajistar wannan lambar shaida | ☐ | |
| `tpDupPhoneAndName` | Same phone number and same name | Lambar waya daya da suna daya | ☐ | |
| `tpDupPhone` | This phone number is already registered to another taxpayer | An riga an yi rajistar wannan lambar waya ga wani mai biyan haraji | ☐ | |
| `tpDupBusinessNameInLga` | A business with this name is already registered in this LGA | An riga an yi rajistar wani kasuwanci mai wannan suna a wannan karamar hukuma | ☐ | |
| `tpDupNameInLga` | A taxpayer with this name is already registered in this LGA | An riga an yi rajistar wani mai biyan haraji mai wannan suna a wannan karamar hukuma | ☐ | |
| `tpDupCouldNotList` | The matching records could not be shown | Ba a iya nuna bayanan da suka yi daidai ba | ☐ | |
| `tpDupCouldNotListBody` | PSIRS has flagged this as a possible duplicate, but the records it matched could not be loaded, so you cannot check them here. Try again. If it will not load, look the person up by phone number before you register them again. | PSIRS ta ce watakila wannan kwafi ne, amma ba a iya lodin bayanan da ta samu ba, don haka ba za ka iya duba su a nan ba. Ka sake gwadawa. Idan bai lodi ba, ka nemi mutumin da lambar waya kafin ka sake yi masa rajista. | ☐ | |
| `tpDupTryAgain` | Try showing them again | Sake gwada nuna su | ☐ | |
| `tpCheckSamePerson` | Check whether any of these is the same person before creating a new record. | Ka duba ko daya daga cikin wadannan shi ne mutumin kafin ka bude sabuwar rajista. | ☐ | |
| `tpNoneOfThese` | None of these — register as a new taxpayer | Babu daya daga cikinsu — yi rajistar sabon mai biyan haraji | ☐ | |
| `tpHasTin` | Does the taxpayer already have a TIN? | Mai biyan haraji yana da TIN kuwa? | ☐ | |
| `tpYes` | Yes | Eh | ☐ | |
| `tpNo` | No | A’a | ☐ | |
| `tpExistingTin` | Existing TIN | TIN da yake da shi | ☐ | |
| `tpExistingTinHint` | We will confirm it with the PSIRS TIN service | Za mu tabbatar da shi ta sashen TIN na PSIRS | ☐ | |
| `tpBasicInfo` | Basic information | Bayanai na asali | ☐ | |
| `tpRegisteringAs` | Registering as | Ana yin rajista a matsayin | ☐ | |
| `tpAnIndividual` | An individual | Mutum daya | ☐ | |
| `tpABusiness` | A business | Kasuwanci | ☐ | |
| `tpBusinessName` | Business name | Sunan kasuwanci | ☐ | |
| `tpTypeOfBusiness` | Type of business | Nau’in kasuwanci | ☐ | |
| `tpFirstName` | First name | Sunan farko | ☐ | |
| `tpMiddleName` | Middle name | Sunan tsakiya | ☐ | |
| `tpLastName` | Last name | Sunan karshe | ☐ | |
| `tpDateOfBirth` | Date of birth | Ranar haihuwa | ☐ | |
| `tpPhoneNumber` | Phone number | Lambar waya | ☐ | |
| `tpEmailAddress` | Email address | Adireshin imel | ☐ | |
| `tpNeedBusinessName` | Enter the name of the business. | Ka rubuta sunan kasuwancin. | ☐ | |
| `tpIdentificationHint` | Optional, but it helps prevent duplicate records. The number is stored securely and never shown in full. | Ba dole ba ne, amma yana taimakawa wajen hana maimaita rajista. Ana adana lambar cikin tsaro kuma ba a taba nuna ta gaba daya ba. | ☐ | |
| `tpLga` | Local Government Area | Karamar Hukuma | ☐ | |
| `tpSelectLga` | Select LGA | Zabi Karamar Hukuma | ☐ | |
| `tpWardHint` | Where revenue is reported from. Without it this collection cannot be counted below LGA level. | Inda ake bayar da rahoton haraji. Ba tare da shi ba, ba za a iya kirga wannan karban a kasa da matakin Karamar Hukuma ba. | ☐ | |
| `tpChooseLgaFirst` | Choose an LGA first | Ka zabi Karamar Hukuma tukuna | ☐ | |
| `tpNoWardsListed` | No wards listed | Babu unguwannin da aka jera | ☐ | |
| `tpSelectWard` | Select ward | Zabi unguwa | ☐ | |
| `tpCommunity` | Community | Al’umma | ☐ | |
| `tpBusinessOrActivity` | Business or activity | Kasuwanci ko sana’a | ☐ | |
| `tpEconomicSector` | Economic sector | Bangaren tattalin arziki | ☐ | |
| `tpSelectSector` | — Select sector — | — Zabi bangare — | ☐ | |
| `tpSuggestedObligations` | Suggested tax obligations for {{sector}} | Harajin da aka ba da shawara ga {{sector}} | ☐ | |
| `tpConfirmWhichTaxes` | Confirm which taxes apply to this taxpayer. You can add more later. | Ka tabbatar da harajin da ya shafi wannan mai biyan haraji. Za ka iya kara wasu daga baya. | ☐ | |
| `tpOccupation` | Occupation (optional) | Sana’a (ba dole ba) | ☐ | |
| `tpBusinessActivity` | Business activity (optional) | Sana’ar kasuwanci (ba dole ba) | ☐ | |
| `tpReviewConfirm` | Review and confirm | Duba ka tabbatar | ☐ | |
| `tpType` | Type | Nau’i | ☐ | |
| `tpBusiness` | Business | Kasuwanci | ☐ | |
| `tpIndividual` | Individual | Mutum | ☐ | |
| `tpName` | Name | Suna | ☐ | |
| `tpPhone` | Phone | Waya | ☐ | |
| `tpLgaShort` | LGA | Karamar Hukuma | ☐ | |
| `tpWard` | Ward | Unguwa | ☐ | |
| `tpWillBeRequested` | Will be requested | Za a nema | ☐ | |
| `tpBack` | Back | Koma baya | ☐ | |
| `tpContinue` | Continue | Ci gaba | ☐ | |
| `tpRegistering` | Registering… | Ana yin rajista… | ☐ | |
| `tpRegisterTaxpayer` | Register taxpayer | Yi rajistar mai biyan haraji | ☐ | |
| `tpYouAreOffline` | You are offline | Ba ka kan layi | ☐ | |
| `tpSaveOfflineBody` | Save this registration on the device. It will be sent to PSIRS automatically when you are back online, and a TIN will be requested then. | Ka adana wannan rajistar a na’ura. Za a tura ta zuwa PSIRS ta atomatik idan ka dawo kan layi, sannan a nemi TIN. | ☐ | |
| `tpSaveOnDevice` | Save on this device | Adana a wannan na’ura | ☐ | |
| `tpNotYetAssigned` | Not yet assigned | Ba a ba da shi ba tukuna | ☐ | |
| `tpTransactionsYouFacilitated` | Transactions you facilitated | Ma’amalolin da ka gudanar | ☐ | |
| `tpNoTransactions` | You have not processed any transaction for this taxpayer. | Ba ka gudanar da wata ma’amala ga wannan mai biyan haraji ba. | ☐ | |
| `tpWhatYouCanSee` | What you can see here | Abin da za ka iya gani a nan | ☐ | |
| `tpVehicles` | Vehicles | Motoci | ☐ | |
| `tpExpires` | Expires {{date}} | Zai kare {{date}} | ☐ | |
| `tpNoRenewal` | No renewal on record | Babu sabuntawa a rajista | ☐ | |

#### Becoming an agent, and the clearance steps

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `appName` | PSIRS Revenue Platform | Hukumar Haraji ta Jihar Filato (PSIRS) | ☐ | |
| `appTagline` | Plateau State Digital Grassroots Revenue & Taxpayer Services | Tsarin Karbar Haraji da Hidimar Masu Biyan Haraji a Jihar Filato | ☐ | |
| `appStageSubmitted` | Application submitted | An mika bukata | ☐ | |
| `appStageKyc` | Identity verified | An tabbatar da shaida | ☐ | |
| `appStageReview` | Ready for government review | A shirye don nazarin gwamnati | ☐ | |
| `appStageApproved` | Approved by PSIRS | PSIRS ta amince | ☐ | |
| `appStageTraining` | Training completed | An kammala horo | ☐ | |
| `appStageDevice` | Device registered | An yi rajistar na’ura | ☐ | |
| `appStageActive` | Active agent | Wakili mai aiki | ☐ | |
| `appActionNeeded` | Action needed | Ana bukatar mataki | ☐ | |
| `appSuspended` | Your account is suspended | An dakatar da asusunka | ☐ | |
| `appNotApproved` | Application not approved | Ba a amince da bukatar ba | ☐ | |
| `appContactSupervisor` | Contact your supervisor or PSIRS support for details of what to do next. | Ka tuntubi shugabanka ko sashen taimako na PSIRS domin sanin abin da za ka yi na gaba. | ☐ | |
| `appTakePhotograph` | Take photograph | Dauki hoto | ☐ | |
| `appTakeAgain` | Take again | Sake daukar hoto | ☐ | |
| `appSending` | Sending... | Ana turawa... | ☐ | |
| `appDocumentNotSent` | The document could not be sent. | Ba a iya tura takardar ba. | ☐ | |
| `appIdDocument` | Your identification document | Takardar shaidarka | ☐ | |
| `appIdDocumentHint` | Photograph the card itself, flat and in focus, with all four corners visible. | Ka dauki hoton katin da kansa, a shimfide kuma a bayyane, kusurwoyi hudu duka suna bayyana. | ☐ | |
| `appSelfie` | A photograph of you | Hotonka | ☐ | |
| `appSelfieHint` | Taken now, holding the same document, so PSIRS can see that they match. | A dauka yanzu, kana rike da takardar guda, domin PSIRS ta ga sun yi daidai. | ☐ | |
| `appJustCaptured` | just captured | an dauka yanzu | ☐ | |
| `appKycHint` | PSIRS checks your identity against the national record. Your identity number is stored securely and is never shown in full. | PSIRS na duba shaidarka a rajistar kasa. Ana adana lambar shaidarka cikin tsaro kuma ba a taba nuna ta gaba daya ba. | ☐ | |
| `appSubmitForVerification` | Submit for verification | Tura don tabbatarwa | ☐ | |
| `appVerifying` | Verifying… | Ana tabbatarwa… | ☐ | |
| `appStillNeeded` | Still needed before this can be submitted: | Abin da ya rage kafin a iya turawa: | ☐ | |
| `appStatus` | Status | Matsayi | ☐ | |
| `appClearFilters` | Clear | Sake saita | ☐ | |
| `appDocumentOnFile` | Document on file | Takardar da ke rijista | ☐ | |
| `appRefereeNoAccount` | They do not need an account — they receive a secure link. | Ba sa bukatar asusu — za su karbi hanyar sadarwa mai tsaro. | ☐ | |
| `appRefereeShareLink` | If your referee did not receive the message, share this link with them directly: | Idan mai shaidarka bai karbi sakon ba, ka aika masa da wannan hanyar kai tsaye: | ☐ | |
| `appRefereeConfirmedYour` | has confirmed your application. | ya tabbatar da bukatarka. | ☐ | |
| `appRefereeSentRequest` | has been sent a verification request. You can nominate a replacement if they cannot respond. | an tura masa bukatar tabbatarwa. Za ka iya zabar wani idan ba zai iya amsawa ba. | ☐ | |
| `appRefereeLinkHere` | They will receive the verification link here | Za su karbi hanyar tabbatarwa a nan | ☐ | |
| `appNominateReplacement` | Nominate a replacement referee | Zabi wani mai shaida | ☐ | |
| `appSendVerification` | Send verification request | Tura bukatar tabbatarwa | ☐ | |
| `appTrainingAllComplete` | All mandatory training is complete. | An kammala dukkan horon wajibi. | ☐ | |
| `appTrainingRemaining` | {{done}} of {{total}} modules still to complete. | Sauran darussa {{done}} cikin {{total}} da za a kammala. | ☐ | |
| `appPassMark` | pass mark | matakin cin jarabawa | ☐ | |
| `appNoAssessment` | no assessment | babu jarabawa | ☐ | |
| `appBankVerifiedMsg` | Your bank account has been verified. | An tabbatar da asusun bankinka. | ☐ | |
| `appBankCouldNotVerify` | The account could not be verified. | Ba a iya tabbatar da asusun ba. | ☐ | |
| `appAcceptAgreementText` | I have read and accept the {{title}} (version {{version}}). | Na karanta kuma na amince da {{title}} (sigar {{version}}). | ☐ | |
| `appDeviceLabel` | Device | Na’ura | ☐ | |
| `appAppVersion` | App version | Sigar manhaja | ☐ | |
| `appNotRegistered` | Not registered | Ba a yi rajista ba | ☐ | |
| `appRegisteredDevice` | Registered device | Na’urar da aka yi wa rajista | ☐ | |
| `appYourApplication` | Your application | Bukatarka | ☐ | |
| `appBeingProcessed` | Your application is being processed | Ana sarrafa bukatarka | ☐ | |
| `appClearedToCollect` | You are cleared to collect revenue | An ba ka izinin karbar haraji | ☐ | |
| `appAllRequirementsMet` | All clearance requirements have been met. | An cika dukkan sharudan izinin. | ☐ | |
| `appStillOutstanding` | Still outstanding | Sauran da ba a kammala ba | ☐ | |
| `appBlockerKyc` | Your identity has not been checked yet | Ba a duba shaidarka ba tukuna | ☐ | |
| `appBlockerReferee` | No referee has confirmed you yet | Babu mai shaida da ya tabbatar da kai tukuna | ☐ | |
| `appBlockerGovernmentApproval` | PSIRS has not approved your application yet | PSIRS ba ta amince da bukatarka ba tukuna | ☐ | |
| `appBlockerTraining` | You have not finished the required training | Ba ka kammala horon da ake bukata ba | ☐ | |
| `appBlockerBank` | Your commission bank account has not been verified | Ba a tabbatar da asusun bankin kwamishan dinka ba | ☐ | |
| `appBlockerAgreement` | You have not accepted the agent agreement | Ba ka amince da yarjejeniyar wakili ba | ☐ | |
| `appBlockerDevice` | No device has been registered to you | Ba a yi rajistar wata na’ura da sunanka ba | ☐ | |
| `appComplete` | Complete | An kammala | ☐ | |
| `appGoToDashboard` | Go to my dashboard | Je shafin aikina | ☐ | |
| `appIdentityVerification` | Identity verification | Tabbatar da shaida | ☐ | |
| `appIdentificationType` | Identification type | Nau’in shaida | ☐ | |
| `appIdentificationNumber` | Identification number | Lambar shaida | ☐ | |
| `appEnterIdInFull` | Enter your identification number in full before submitting. | Ka shigar da lambar shaidarka gaba daya kafin ka tura. | ☐ | |
| `appPreviousAttemptRejected` | Previous attempt was not accepted | Ba a karbi yunkurin da ya gabata ba | ☐ | |
| `appDocumentNotAccepted` | This document was not accepted | Ba a karbi wannan takardar ba | ☐ | |
| `appDocuments` | Documents | Takardu | ☐ | |
| `appNotCaptured` | Not captured | Ba a dauka ba | ☐ | |
| `appReferee` | Referee | Mai shaida | ☐ | |
| `appRefereeFullName` | Referee full name | Cikakken sunan mai shaida | ☐ | |
| `appRefereePhone` | Referee phone number | Lambar wayar mai shaida | ☐ | |
| `appRefereeEmail` | Referee email | Imel na mai shaida | ☐ | |
| `appHowDoTheyKnowYou` | How do they know you? | Ta yaya ya san ka? | ☐ | |
| `appWhoIsThisPerson` | Who is this person? | Wanene wannan mutumin? | ☐ | |
| `appRefereeConfirmed` | Referee confirmed | Mai shaida ya tabbatar | ☐ | |
| `appWaitingReferee` | Waiting for your referee | Ana jiran mai shaidarka | ☐ | |
| `appVerificationSent` | Verification request sent | An tura bukatar tabbatarwa | ☐ | |
| `appTraining` | Training | Horo | ☐ | |
| `appAgreement` | Agent agreement | Yarjejeniyar wakili | ☐ | |
| `appAcceptAgreement` | Accept agreement | Amince da yarjejeniya | ☐ | |
| `appAgreementAccepted` | Agreement accepted | An amince da yarjejeniya | ☐ | |
| `appAgreementRecorded` | Your acceptance has been recorded. | An rubuta amincewarka. | ☐ | |
| `appReadCarefully` | Read this carefully. It sets out what you may and may not do. | Ka karanta wannan sosai. Yana bayyana abin da za ka iya yi da abin da ba za ka iya yi ba. | ☐ | |
| `appBankAccount` | Commission bank account | Asusun bankin kwamishan | ☐ | |
| `appVerifyBankAccount` | Verify my bank account | Tabbatar da asusun bankina | ☐ | |
| `appBankVerified` | Bank account verified | An tabbatar da asusun banki | ☐ | |
| `appCommissionPaidHere` | Your commission will be paid to this account. | Za a biya kwamishan dinka a wannan asusun. | ☐ | |
| `appRegisterDevice` | Register this device | Yi rajistar wannan na’ura | ☐ | |
| `appOtherDevices` | Other devices | Sauran na’urori | ☐ | |
| `appDeviceAfterApproval` | You can register a device once PSIRS has approved your application. | Za ka iya yin rajistar na’ura da zarar PSIRS ta amince da bukatarka. | ☐ | |
| `appRefereeWhoIs` | A referee is someone who knows you and can confirm your identity to PSIRS. | Mai shaida shi ne wanda ya san ka kuma zai iya tabbatar da kai ga PSIRS. | ☐ | |
| `appRecordsWaiting` | saved records waiting to send | bayanan da aka ajiye suna jiran aikawa | ☐ | |
| `appDraftsSynced` | {{count}} saved record(s) sent to PSIRS. | An aika bayanai {{count}} da aka ajiye zuwa PSIRS. | ☐ | |
| `appDraftsSyncedRejected` | {{count}} saved record(s) sent to PSIRS, {{rejected}} need correction. | An aika bayanai {{count}} da aka ajiye zuwa PSIRS, {{rejected}} na bukatar gyara. | ☐ | |
| `appSignOut` | Sign out | Fita | ☐ | |
| `appSwitchLanguage` | Switch language | Canza harshe | ☐ | |
| `appPageNotFound` | Page not found | Ba a sami shafin ba | ☐ | |
| `appPageNotFoundBody` | That screen does not exist. | Wannan shafin babu shi. | ☐ | |
| `appReturnHome` | Return to the home screen | Koma shafin farko | ☐ | |
| `appRecordsSynced` | Records synchronised | An aika bayanan | ☐ | |
| `appRecordsNotSent` | Saved records could not be sent | Ba a iya aika bayanan da aka ajiye ba | ☐ | |
| `appUpdateRequired` | Update required | Ana bukatar sabuntawa | ☐ | |

#### Kinds of identification

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `idNin` | National Identification Number | Lambar Shaidar Kasa | ☐ | |
| `idBvn` | Bank Verification Number | Lambar Tabbatar da Banki | ☐ | |
| `idPassport` | International passport | Fasfo na kasa da kasa | ☐ | |
| `idLicence` | Driver’s licence | Lasisin tuki | ☐ | |
| `idVoters` | Voter’s card | Katin zabe | ☐ | |

#### Kinds of referee

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `refCivilServant` | Civil or public servant | Ma’aikacin gwamnati | ☐ | |
| `refCommunityLeader` | Community leader | Shugaban unguwa | ☐ | |
| `refDistrictHead` | District head of my community | Hakimin unguwata | ☐ | |
| `refReligiousLeader` | Religious leader | Shugaban addini | ☐ | |
| `refTraditionalAuthority` | Traditional authority | Sarauta | ☐ | |
| `refProfessional` | Recognised professional | Kwararre da aka sani | ☐ | |
| `refEmployer` | Employer | Ma’aikaci | ☐ | |

#### Groups: cooperatives, unions, associations

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `grpNotActiveYet` | This group is {{status}}. Members can be recorded once an officer has approved it — there is nothing more to do here until then. | Wannan kungiya tana {{status}}. Za a iya rubuta mambobi bayan jami’i ya amince da ita — babu sauran abin yi a nan har sai lokacin. | ☐ | |
| `grpLeaderMustConfirm` | {{name}} can open it on any phone. Until they confirm, the members you recorded are not counted. | {{name}} zai iya budewa a kowace waya. Har sai ya tabbatar, ba a kirga mambobin da ka rubuta ba. | ☐ | |
| `grpNameHint` | As the group itself gives it | Kamar yadda kungiyar da kanta ta bayar | ☐ | |
| `grpCommunityHint` | Where the group meets. Optional. | Inda kungiyar ke haduwa. Ba dole ba. | ☐ | |
| `grpLeaderNameHint` | The person who can confirm who belongs | Mutumin da zai iya tabbatar da wanda ke cikinta | ☐ | |
| `grpLeaderPhoneHint` | They are sent a link to confirm the membership list | Ana tura masa hanyar tabbatar da jerin mambobi | ☐ | |
| `grpMemberCountHint` | An estimate is fine. Optional. | Kiyasi ya isa. Ba dole ba. | ☐ | |
| `grpConfirmedMembers` | {{n}} confirmed member(s) | Mambobin da aka tabbatar: {{n}} | ☐ | |
| `grpListHint` | The groups you registered, and any an officer recorded for you to work. Another agent’s cooperatives are not listed here. | Kungiyoyin da ka yi wa rajista, da duk wanda jami’i ya rubuta domin ka yi aiki da su. Ba a jera kungiyoyin wani wakili a nan ba. | ☐ | |
| `grpEmpty` | No groups yet. When you meet a cooperative, a market association or a union, register it here so its members can be brought onto the register together. | Babu kungiyoyi tukuna. Idan ka hadu da kungiyar hadin kai, kungiyar kasuwa ko kungiyar sana’a, ka yi mata rajista a nan domin a shigar da mambobinta tare. | ☐ | |
| `grpRegisterHint` | Record the body itself, and who leads it. Members are added after an officer has approved the group. | Ka rubuta kungiyar da kanta, da wanda ke shugabanta. Ana kara mambobi bayan jami’i ya amince da kungiyar. | ☐ | |
| `grpMemberHint` | The person has to be registered as a taxpayer first. Search for them by name, phone or TIN. | Dole ne a fara yi wa mutumin rajista a matsayin mai biyan haraji. Ka neme shi da suna, waya ko TIN. | ☐ | |
| `grpRegisterGroup` | Register group | Yi rajistar kungiya | ☐ | |
| `grpRecordThisMember` | Record this member | Rubuta wannan mamba | ☐ | |
| `grpSendLeaderLink` | Send the leader a confirmation link | Tura wa shugaba hanyar tabbatarwa | ☐ | |
| `grpFarmers` | Farmers’ cooperative | Kungiyar hadin kan manoma | ☐ | |
| `grpMarket` | Market association | Kungiyar kasuwa | ☐ | |
| `grpTransport` | Transport union | Kungiyar masu sufuri | ☐ | |
| `grpArtisan` | Artisan guild | Kungiyar masu sana’a | ☐ | |
| `grpTraders` | Traders’ association | Kungiyar ’yan kasuwa | ☐ | |
| `grpFisheries` | Fisheries group | Kungiyar masunta | ☐ | |
| `grpLivestock` | Livestock association | Kungiyar masu dabbobi | ☐ | |
| `grpOther` | Other | Wani | ☐ | |
| `grpLocalGovernment` | Local Government | Karamar Hukuma | ☐ | |
| `grpLeader` | Leader | Shugaba | ☐ | |
| `grpMembersConfirmed` | Members confirmed | Mambobin da aka tabbatar | ☐ | |
| `grpAwaitingLeader` | Awaiting the leader | Ana jiran shugaba | ☐ | |
| `grpTitle` | Groups and cooperatives | Kungiyoyi da hadin gwiwa | ☐ | |
| `grpRegister` | Register a group | Yi rajistar kungiya | ☐ | |
| `grpName` | Group name | Sunan kungiya | ☐ | |
| `grpKind` | What kind of group | Wace irin kungiya | ☐ | |
| `grpChooseOne` | Choose one | Zabi daya | ☐ | |
| `grpLeaderName` | Leader’s name | Sunan shugaba | ☐ | |
| `grpLeaderPhone` | Leader’s phone number | Lambar wayar shugaba | ☐ | |
| `grpLga` | Local Government Area | Karamar Hukuma | ☐ | |
| `grpCommunity` | Community | Unguwa | ☐ | |
| `grpMemberCount` | Roughly how many members | Kimanin adadin mambobi | ☐ | |
| `grpRecordMember` | Record a member | Rubuta mamba | ☐ | |
| `grpMember` | Member | Mamba | ☐ | |
| `grpRecorded` | Recorded | An rubuta | ☐ | |
| `grpWaitingOfficer` | Waiting for an officer | Ana jiran jami’i | ☐ | |
| `grpAskLeaderConfirm` | Ask the leader to confirm | Ka nemi shugaba ya tabbatar | ☐ | |
| `grpSendToLeader` | Send this to the leader | Tura wannan ga shugaba | ☐ | |
| `grpNoAssessment` | This does not assess anybody | Wannan ba ya sanya wa kowa haraji | ☐ | |

#### Handing out an allocation

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `allocScanHint` | Scan or type the collection code the beneficiary was given. Record it before you hand anything over — a code can only be used once, and this is what stops the same allocation being collected twice. | Ka duba ko ka rubuta lambar karban da aka ba mai amfana. Ka rubuta ta kafin ka mika komai — ana amfani da lamba sau daya kawai, wannan ne ke hana a karbi rabo iri daya sau biyu. | ☐ | |
| `allocNotACode` | That code is not a PSIRS collection code. Keep it in frame. | Wannan lambar ba lambar karba ta PSIRS ba ce. Ka rike ta a cikin firam. | ☐ | |
| `allocCameraFailed` | The camera could not be opened. Type the code instead. | Ba a iya bude kyamara ba. Maimakon haka ka rubuta lambar. | ☐ | |
| `allocRecordCollection` | Record this collection | Rubuta wannan karban | ☐ | |
| `allocGive` | Give | Ka ba | ☐ | |
| `allocHandOut` | Hand out an allocation | Bayar da kason taimako | ☐ | |
| `allocScanCode` | Scan the code | Duba lambar | ☐ | |
| `allocStopScanning` | Stop scanning | Daina duba | ☐ | |
| `allocTypeCode` | Or type the collection code | Ko rubuta lambar karba | ☐ | |
| `allocRecorded` | Recorded | An rubuta | ☐ | |
| `allocCodeUsed` | This code is now used. If the beneficiary comes back with it, PSIRS will refuse it. | An riga an yi amfani da wannan lambar. Idan mai amfana ya dawo da ita, PSIRS ba za ta karba ba. | ☐ | |

#### Checking a receipt

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `verifyScanHint` | Scan the square on the receipt, or type the code printed beneath it. PSIRS confirms whether the receipt was issued — reading the code only tells you what is on the paper. | Ka duba murabba’in da ke kan rasit, ko ka rubuta lambar da ke kasansa. PSIRS na tabbatar ko an bayar da rasit — karanta lambar kawai yana gaya maka abin da ke kan takardar. | ☐ | |
| `verifyCameraFailed` | The camera could not be opened. Type the code printed under the QR square instead. | Ba a iya bude kyamara ba. Maimakon haka ka rubuta lambar da aka buga karkashin murabba’in QR. | ☐ | |
| `verifyChecking` | Checking with PSIRS… | Ana dubawa tare da PSIRS… | ☐ | |
| `verifyCheckThisCode` | Check this code | Duba wannan lambar | ☐ | |
| `verifyRevenueItem` | Revenue item | Nau’in haraji | ☐ | |
| `verifyIssued` | Issued | An bayar | ☐ | |
| `verifyFingerprint` | Document fingerprint | Sa hannun takardar | ☐ | |
| `verifyMatchesOriginal` | Matches the original | Ya yi daidai da na asali | ☐ | |
| `verifyNotConfirmed` | Could not be confirmed | Ba a iya tabbatarwa ba | ☐ | |
| `verifyCheckReceipt` | Check a receipt | Duba rasit | ☐ | |
| `verifyScanQr` | Scan the QR code | Duba lambar QR | ☐ | |
| `verifyTypeCode` | Or type the verification code | Ko rubuta lambar tantancewa | ☐ | |
| `verifyOffline` | You are offline | Ba ka da intanet | ☐ | |

#### Reporting a problem

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `supYouAt` | You · {{when}} | Kai · {{when}} | ☐ | |
| `supRepliesCount` | {{n}} reply(s) | amsa {{n}} | ☐ | |
| `supGetHelpHint` | Report a problem to PSIRS. You will get a reply here, and a message when there is something to read. | Ka kai rahoton matsala ga PSIRS. Za ka samu amsa a nan, da sako idan akwai abin karantawa. | ☐ | |
| `supNormal` | Normal | Na yau da kullum | ☐ | |
| `supProblemCameBack` | If the problem has come back, | Idan matsalar ta dawo, | ☐ | |
| `supReportItAgain` | report it again | ka sake bayar da rahoto | ☐ | |
| `supKeepsHistory` | so it keeps its own history. | domin ya ci gaba da tarihinsa. | ☐ | |
| `supCatPayment` | A payment has not gone through | Biyan kudi bai wuce ba | ☐ | |
| `supCatReceipt` | A receipt is wrong or missing | Rasit ba daidai ba ne ko ya bata | ☐ | |
| `supCatAssessment` | The amount charged looks wrong | Kudin da aka caje ba daidai ba ne | ☐ | |
| `supCatTin` | A taxpayer has no TIN yet | Mai biyan haraji babu TIN tukuna | ☐ | |
| `supCatVehicle` | A vehicle renewal problem | Matsalar sabunta mota | ☐ | |
| `supCatTechnical` | The app is not working | Manhajar ba ta aiki | ☐ | |
| `supCatComplaint` | A taxpayer has a complaint | Mai biyan haraji yana da korafi | ☐ | |
| `supCatUnauthorised` | Someone was charged money they should not have been | An caji wani kudi da bai kamata ba | ☐ | |
| `supCatUnauthorisedHint` | Use this if a taxpayer was asked for money outside an official assessment. | Ka yi amfani da wannan idan an nemi mai biyan haraji kudi ba tare da kima ta hukuma ba. | ☐ | |
| `supCatMisconduct` | Report the conduct of an agent | Kai rahoton halin wani wakili | ☐ | |
| `supCatMisconductHint` | This goes to PSIRS oversight, not to the agent concerned. | Wannan zai je sashen sa ido na PSIRS, ba ga wakilin da abin ya shafa ba. | ☐ | |
| `supWhatHappenedHint` | Include anything PSIRS would need to look it up. | Ka hada duk abin da PSIRS za ta bukata don nemo shi. | ☐ | |
| `supTransactionHint` | If this is about one payment, the reference lets PSIRS find it without asking you. | Idan wannan game da biyan kudi daya ne, lambar tana taimaka wa PSIRS ta same shi ba tare da tambayar ka ba. | ☐ | |
| `supSending` | Sending… | Ana turawa… | ☐ | |
| `supSendToPsirs` | Send to PSIRS | Tura zuwa PSIRS | ☐ | |
| `supSendWord` | Send | Tura | ☐ | |
| `supReopenedNotice` | This report has been opened again for PSIRS to look at. | An sake bude wannan rahoton domin PSIRS ta duba. | ☐ | |
| `supAbout` | About | Game da | ☐ | |
| `supTransactionLabel` | Transaction | Ma’amala | ☐ | |
| `supReported` | Reported | An bayar da rahoto | ☐ | |
| `supGetHelp` | Get help | Nemi taimako | ☐ | |
| `supReportProblem` | Report a problem | Kai korafi | ☐ | |
| `supMyReports` | My reports | Korafina | ☐ | |
| `supNothingReported` | You have not reported anything yet. | Ba ka kai wani korafi ba tukuna. | ☐ | |
| `supWhatProblem` | What is the problem? | Menene matsalar? | ☐ | |
| `supChooseOne` | Choose one | Zabi daya | ☐ | |
| `supShortSummary` | Short summary | Takaitaccen bayani | ☐ | |
| `supWhatHappened` | What happened? | Me ya faru? | ☐ | |
| `supHowUrgent` | How urgent is it? | Yaya gaggawarsa? | ☐ | |
| `supNotUrgent` | Not urgent | Ba gaggawa ba | ☐ | |
| `supUrgent` | Urgent — a taxpayer is waiting | Gaggawa — mai biyan haraji na jira | ☐ | |
| `supVeryUrgent` | Very urgent — money may be at risk | Gaggawa kwarai — kudi na iya cikin hadari | ☐ | |
| `supTransactionRef` | Transaction reference | Lambar ma’amala | ☐ | |
| `supBeforeYouSend` | Before you send this | Kafin ka tura wannan | ☐ | |
| `supConversation` | Conversation | Tattaunawa | ☐ | |
| `supAddToReport` | Add to this report | Kara a kan wannan korafin | ☐ | |
| `supReportClosed` | This report is closed | An rufe wannan korafin | ☐ | |
| `supReopened` | Reopened | An sake budewa | ☐ | |

#### The profile screen

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `moreDraftCaptured` | Captured {{when}} | An dauka {{when}} | ☐ | |
| `moreCommissionRateOf` | {{rate}}% of | {{rate}}% na | ☐ | |
| `moreBankChangeAsking` | You are asking PSIRS to pay your commission into this account: {{destination}}. | Kana neman PSIRS ta biya kwamishanka cikin wannan asusun: {{destination}}. | ☐ | |
| `moreMonths` | {{n}} months | Watanni {{n}} | ☐ | |
| `moreSearchVehicleFirst` | Search the vehicle first. Records confirmed by the vehicle authority are marked as such. | Ka fara neman motar. An yiwa rikodin da hukumar motoci ta tabbatar alama. | ☐ | |
| `moreOwnerName` | Owner’s name | Sunan mai motar | ☐ | |
| `moreOwnerNameHint` | As written on the papers | Kamar yadda aka rubuta a takardun | ☐ | |
| `moreOwnerPhone` | Owner’s phone | Wayar mai motar | ☐ | |
| `moreMotorcycle` | Motorcycle / Okada | Babur / Acaba | ☐ | |
| `moreTricycle` | Tricycle / Keke | Keke napep | ☐ | |
| `moreRegistrationLabel` | Registration | Lambar rajista | ☐ | |
| `moreOwnerLabel` | Owner | Mai motar | ☐ | |
| `moreVehicleLabel` | Vehicle | Mota | ☐ | |
| `moreChassis` | Chassis | Lambar jiki | ☐ | |
| `moreCurrentExpiry` | Current expiry | Karewar yanzu | ☐ | |
| `moreAuthorityConfirmed` | Authority confirmed | Hukuma ta tabbatar | ☐ | |
| `moreEnteredManually` | No — entered manually | A’a — an shigar da hannu | ☐ | |
| `moreChooseRenewal` | Choose which renewal is being paid for. | Ka zabi wace sabuntawa ake biya. | ☐ | |
| `moreFindPayingTaxpayer` | Find the taxpayer paying for this renewal. Every payment must be attributed to somebody. | Ka nemo mai biyan haraji da ke biyan wannan sabuntawar. Dole a danganta kowane biyan kudi ga wani. | ☐ | |
| `moreReceiptsIssuedAfter` | Every receipt here was issued by government after the payment was independently confirmed. | Gwamnati ce ta bayar da kowanne rasit a nan bayan an tabbatar da biyan kudin da kansa. | ☐ | |
| `morePendingWord` | pending | ana jira | ☐ | |
| `morePaidWord` | paid | an biya | ☐ | |
| `moreTransactionsWord` | transactions | ma’amaloli | ☐ | |
| `moreOwedBackBody` | was paid on transactions that were later reversed. It is taken off your next payout, so you will receive that much less than the amount above. | an biya shi a kan ma’amalolin da aka juyar da su daga baya. Ana cire shi daga biyan ka na gaba, don haka za ka karbi kasa da adadin da ke sama. | ☐ | |
| `moreOwedBackDeducted` | owed back will be deducted. | da ake bin ka za a cire shi. | ☐ | |
| `moreConfirmPayout` | Confirm payout | Tabbatar da biyan kwamishan | ☐ | |
| `moreCommissionAvailableWhen` | Commission becomes available once the transaction has been settled to the government account and the hold period has passed. You will be sent a one-time code to confirm the request. | Kwamishan yana samuwa ne bayan an tura ma’amalar zuwa asusun gwamnati kuma lokacin rikewa ya wuce. Za a tura maka lamba ta sau daya domin tabbatar da bukatar. | ☐ | |
| `moreDeviceId` | Device ID | Lambar na’ura | ☐ | |
| `morePrinterHint` | Pair a 58mm or 80mm Bluetooth ESC/POS mobile belt printer to issue instant paper receipts to taxpayers in remote field locations. | Ka hada na’urar buga takarda ta Bluetooth ta 58mm ko 80mm domin bayar da rasit na takarda nan take ga masu biyan haraji a wurare masu nisa. | ☐ | |
| `moreConnectedDevice` | Connected device | Na’urar da aka hada | ☐ | |
| `morePaperWidth` | Paper width | Fadin takarda | ☐ | |
| `moreNone` | None | Babu | ☐ | |
| `morePaper58` | 58mm (standard) | 58mm (na kowa) | ☐ | |
| `morePaper80` | 80mm (wide) | 80mm (mai fadi) | ☐ | |
| `morePrintTestSlip` | Print test slip | Buga takardar gwaji | ☐ | |
| `morePairPrinter` | Pair Bluetooth printer | Hada na’urar buga takarda ta Bluetooth | ☐ | |
| `moreNoWebBluetooth` | Web Bluetooth is not supported on this browser (use Chrome on Android or desktop). | Wannan burauzar ba ta goyon bayan Web Bluetooth ba (ka yi amfani da Chrome a Android ko kwamfuta). | ☐ | |
| `morePrinterConnected` | Connected to Bluetooth printer. | An hada da na’urar buga takarda ta Bluetooth. | ☐ | |
| `morePrinterConnectFailed` | Connection failed. | Hadin ya gagara. | ☐ | |
| `morePrinterTestSent` | Test receipt sent to printer! | An tura rasit na gwaji zuwa na’urar buga takarda! | ☐ | |
| `morePrinterPrintFailed` | Print failed. | Buga takarda ya gagara. | ☐ | |
| `morePushHint` | Receive real-time alerts when your KYC clears, referee responds, or commissions settle. | Ka karbi sanarwa nan take idan shaidarka ta wuce, mai shaida ya amsa, ko an sasanta kwamishan. | ☐ | |
| `morePermission` | Permission | Izini | ☐ | |
| `morePushEngine` | Push engine | Na’urar tura sanarwa | ☐ | |
| `moreSupported` | Supported | Ana goyon baya | ☐ | |
| `moreUnavailable` | Unavailable | Babu | ☐ | |
| `morePushDisabled` | Push notifications disabled. | An kashe sanarwar turawa. | ☐ | |
| `morePushActive` | Push notifications active! | Sanarwar turawa tana aiki! | ☐ | |
| `morePushNotGranted` | Permission was not granted. | Ba a bayar da izini ba. | ☐ | |
| `morePushFailed` | Could not configure push notifications. | Ba a iya saita sanarwar turawa ba. | ☐ | |
| `moreChangeBankHint` | Change the bank account PSIRS pays your commission into. It takes a one-time code, the bank’s confirmation and an officer’s approval, so your existing account keeps being used until all three are done. | Canza asusun bankin da PSIRS ke biyan kwamishan dinka. Yana bukatar lamba ta sau daya, tabbatarwa daga banki da amincewar jami’i, don haka za a ci gaba da amfani da asusunka na yanzu sai an cika ukun. | ☐ | |
| `moreSupportHint` | Report a problem to PSIRS — a payment that has not confirmed, a receipt that looks wrong, or anything a taxpayer has complained about. | Ka kai rahoton matsala ga PSIRS — biyan kudi da ba a tabbatar ba, rasit da ba ya kama da daidai, ko duk abin da mai biyan haraji ya yi korafi a kai. | ☐ | |
| `moreSavedRecordsHint` | Captures made offline. They are sent to PSIRS automatically when you have a connection. | Abubuwan da aka rubuta ba tare da layi ba. Ana tura su zuwa PSIRS ta atomatik idan ka samu hanyar sadarwa. | ☐ | |
| `moreBack` | Back | Koma baya | ☐ | |
| `moreToldEitherWayBody` | A message goes to your phone when this is approved or refused. Only one change can be waiting at a time. | Sako zai zo wayarka idan an amince ko an ki wannan. Canji daya ne kawai zai iya jira a lokaci guda. | ☐ | |
| `morePaidIntoNow` | Paid into now | Ana biya a nan yanzu | ☐ | |
| `moreWouldChangeTo` | Would change to | Zai canza zuwa | ☐ | |
| `moreNameOnNewAccount` | Name on the new account | Sunan da ke sabon asusun | ☐ | |
| `moreBankCheck` | Bank check | Dubawar banki | ☐ | |
| `moreBankCheckConfirmed` | Confirmed | An tabbatar | ☐ | |
| `moreBankCheckConfirmedAs` | Confirmed as {{name}} | An tabbatar a matsayin {{name}} | ☐ | |
| `moreBankCheckWaiting` | Waiting — the bank could not be reached | Ana jira — ba a iya samun banki ba | ☐ | |
| `moreBankCheckNotConfirmed` | Not confirmed | Ba a tabbatar ba | ☐ | |
| `moreBankCheckNotConfirmedBecause` | Not confirmed: {{reason}} | Ba a tabbatar ba: {{reason}} | ☐ | |
| `moreReasonYouGave` | Reason you gave | Dalilin da ka bayar | ☐ | |
| `moreBankLabel` | Bank | Banki | ☐ | |
| `moreBankCodeHint` | The 3 to 6 digit code the bank uses | Lambar lambobi 3 zuwa 6 da banki ke amfani da ita | ☐ | |
| `moreAccountNameHint` | Exactly as the bank has it | Daidai yadda banki yake da shi | ☐ | |
| `moreNeedBankName` | Choose the bank the new account is with. | Ka zabi bankin da sabon asusun yake. | ☐ | |
| `moreNeedBankCode` | Enter the bank code. It is the 3 to 6 digit number the bank uses, not your account number. | Ka shigar da lambar banki. Lamba ce ta lambobi 3 zuwa 6 da banki ke amfani da ita, ba lambar asusunka ba. | ☐ | |
| `moreNeedAccountName` | Enter the name the account is held in, exactly as the bank has it. | Ka shigar da sunan da asusun yake a kansa, daidai yadda banki yake da shi. | ☐ | |
| `moreNeedAccountNumber` | A Nigerian account number is 10 digits. | Lambar asusu ta Najeriya lambobi 10 ce. | ☐ | |
| `moreNeedReason` | Say why the account is changing, in at least 10 characters. | Ka fadi dalilin canza asusun, da akalla haruffa 10. | ☐ | |
| `moreThisDevice` | This device | Wannan na’ura | ☐ | |
| `moreSignOut` | Sign out | Fita | ☐ | |
| `moreSomethingWrong` | Something wrong? | Akwai matsala? | ☐ | |
| `moreGetHelp` | Get help | Nemi taimako | ☐ | |
| `moreViewApplication` | View my application and clearance | Duba bukatata da izinina | ☐ | |
| `moreWhereCommissionPaid` | Where your commission is paid | Inda ake biyan kwamishan dinka | ☐ | |
| `moreCommissionRecordNotAccount` | This is a commission record, not a bank account | Wannan bayanin kwamishan ne, ba asusun banki ba | ☐ | |
| `moreChangeBankAccount` | Change my bank account | Canza asusun bankina | ☐ | |
| `moreAskDifferentAccount` | Ask for a different account | Nemi wani asusun daban | ☐ | |
| `moreAuthoriseChange` | Authorise this change | Ba da izinin wannan canjin | ☐ | |
| `moreAuthorisePayout` | Authorise this payout | Ba da izinin wannan biyan | ☐ | |
| `moreChangeWaiting` | A change is waiting for PSIRS | Ana jiran PSIRS ta duba canjin | ☐ | |
| `moreNothingChangesYet` | Nothing changes until an officer approves it. | Babu abin da zai canza sai jami’i ya amince. | ☐ | |
| `moreToldEitherWay` | You will be told either way | Za a sanar da kai ko ta yaya | ☐ | |
| `moreBankNotConfirmed` | The bank has not confirmed this account | Banki bai tabbatar da wannan asusun ba | ☐ | |
| `moreWhyChanging` | Why it is changing | Dalilin canjin | ☐ | |
| `moreAccountName` | Name on the account | Sunan da ke kan asusun | ☐ | |
| `moreAccountNumber` | Account number | Lambar asusu | ☐ | |
| `moreBankCode` | Bank code | Lambar banki | ☐ | |
| `moreCommissionHistory` | Commission history | Tarihin kwamishan | ☐ | |
| `moreNoCommission` | No commission recorded yet. | Ba a rubuta kwamishan ba tukuna. | ☐ | |
| `moreAvailableForPayout` | Available for payout | Wanda ake iya biya | ☐ | |
| `moreRequestPayout` | Request payout | Nemi a biya ka | ☐ | |
| `moreRequestingPayout` | You are requesting a payout of | Kana neman a biya ka | ☐ | |
| `moreSomeCommissionOwedBack` | Some commission is owed back | Ana bin ka wasu kwamishan | ☐ | |
| `moreSomeCommissionOnHold` | Some commission is on hold | An dakatar da wasu kwamishan | ☐ | |
| `moreOnHoldBody` | is on hold and is not counted in any of the figures above. It is held while something about those collections is checked. Ask your supervisor what is outstanding. | an dakatar da shi kuma ba a kirga shi cikin ko daya daga cikin alkaluman da ke sama ba. Ana rike shi yayin da ake duba wani abu game da wadannan karbe-karben. Ka tambayi shugabanka abin da ya rage. | ☐ | |
| `moreCommissionApproved` | Some commission is approved for payment | An amince a biya wasu kwamishan | ☐ | |
| `moreApprovedBody` | has been approved and is waiting to be paid. It is no longer available to request, and it has not reached your account yet. | an amince da shi kuma yana jiran a biya. Ba za ka iya sake neman sa ba, kuma bai kai asusunka ba tukuna. | ☐ | |
| `moreSomeCommissionReversed` | Some commission was reversed | An juyar da wasu kwamishan | ☐ | |
| `moreReversedBody` | was earned on collections that were later reversed, and was never paid. You will not receive it. This is separate from anything owed back. | an same shi a kan karbe-karben da aka juyar da su daga baya, kuma ba a taba biyan sa ba. Ba za ka karbe shi ba. Wannan ya bambanta da abin da ake bin ka. | ☐ | |
| `moreReceiptsFacilitated` | Receipts you facilitated | Rasit da ka taimaka a bayar | ☐ | |
| `moreNoReceipts` | No receipts yet. | Babu rasit tukuna. | ☐ | |
| `moreSavedRecords` | Saved records on this device | Bayanan da aka ajiye a wannan na’ura | ☐ | |
| `moreNothingWaiting` | Nothing is waiting to be sent. | Babu abin da ke jiran a aika. | ☐ | |
| `moreSavedOnPhone` | Saved on this phone | An ajiye a wannan wayar | ☐ | |
| `moreVehicleRenewal` | Vehicle particulars renewal | Sabunta takardun mota | ☐ | |
| `moreSearchVehicle` | Search vehicle | Nemo mota | ☐ | |
| `moreRegistrationNumber` | Registration number | Lambar rajista | ☐ | |
| `moreVehicleType` | Vehicle type | Nau’in mota | ☐ | |
| `morePrivate` | Private | Na kaina | ☐ | |
| `moreCommercial` | Commercial | Na kasuwanci | ☐ | |
| `moreRenewalService` | Renewal service | Sabis na sabuntawa | ☐ | |
| `moreSelectRenewalType` | Select renewal type | Zabi nau’in sabuntawa | ☐ | |
| `moreRenewalPeriod` | Renewal period | Tsawon sabuntawa | ☐ | |
| `moreCalculateProceed` | Calculate and proceed to payment | Lissafa ka ci gaba zuwa biyan kudi | ☐ | |
| `moreSaveVehicleOnPhone` | Save vehicle on this phone | Ajiye motar a wannan wayar | ☐ | |
| `moreCaptureOffline` | Capture without a connection | Rubuta ba tare da intanet ba | ☐ | |
| `moreVehicleAuthorityUnreachable` | The vehicle authority cannot be reached | Ba a iya isa ga hukumar motoci ba | ☐ | |
| `moreTryVehicleAuthorityAgain` | Try the vehicle authority again | Sake gwada hukumar motoci | ☐ | |
| `morePrinter` | Field Thermal Printer | Na’urar buga rasit | ☐ | |
| `moreDisconnect` | Disconnect | Cire hadi | ☐ | |
| `morePushTitle` | Instant Push Notifications | Sakonnin gargadi kai tsaye | ☐ | |
| `moreContinue` | Continue | Ci gaba | ☐ | |
| `morePushUnsupported` | Push notifications are not supported on this device or browser. | Wannan na’ura ko burauza ba ta goyon bayan sanarwar turawa ba. | ☐ | |
| `morePayoutRequested` | Payout requested. It will be paid after finance approval. Reference {{reference}}. | An nemi biyan kudi. Za a biya bayan amincewar sashen kudi. Lamba: {{reference}}. | ☐ | |
| `morePayoutClawback` | Payout requested for {{amount}}. {{gross}} of commission was eligible and {{clawback}} was deducted for transactions that were reversed after their commission had been paid. It will be paid after finance approval. Reference {{reference}}. | An nemi biyan {{amount}}. {{gross}} na kwamishan ya cancanta, an kuma cire {{clawback}} saboda ma’amalolin da aka juyar bayan an biya kwamishansu. Za a biya bayan amincewar sashen kudi. Lamba: {{reference}}. | ☐ | |
| `moreDisablePushNotifications` | Disable Push Notifications | Kashe sanarwar turawa | ☐ | |
| `moreSentToPsirsYour` | Sent to PSIRS. Your commission still goes to your existing account until an officer approves the change. | An tura wa PSIRS. Kwamishan naka zai ci gaba da zuwa asusunka na yanzu har sai wani jami’i ya amince da canjin. | ☐ | |
| `moreUnknownOwner` | Unknown owner | Ba a san mai shi ba | ☐ | |

#### Signing in

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `authKeepItSafe` | . Keep it safe. | . Ka adana ta lafiya. | ☐ | |
| `authSigningIn` | Signing in… | Ana shiga… | ☐ | |
| `authPasswordHint` | At least 8 characters, including a letter and a number | Akalla haruffa 8, tare da harafi da lamba | ☐ | |
| `authPasswordPatternHint` | At least 8 characters, including at least one letter and at least one number. | Akalla haruffa 8, tare da akalla harafi daya da akalla lamba daya. | ☐ | |
| `authBankName` | Bank name | Sunan banki | ☐ | |
| `authAccountName` | Account name | Sunan asusu | ☐ | |
| `authAccountNumber` | Account number | Lambar asusu | ☐ | |
| `authTenDigits` | 10 digits | Lambobi 10 | ☐ | |
| `authSubmitting` | Submitting… | Ana turawa… | ☐ | |
| `authSubmitApplication` | Submit application | Tura bukata | ☐ | |
| `authPsirsFull` | Plateau State Internal Revenue Service | Hukumar Karbar Haraji ta Cikin Gida ta Jihar Filato | ☐ | |
| `authSignInTitle` | Sign in to continue | Shiga domin ci gaba | ☐ | |
| `authSignIn` | Sign in | Shiga | ☐ | |
| `authPhoneHint` | Use the phone number you registered with PSIRS. | Ka yi amfani da lambar wayar da ka yi rajista da ita a PSIRS. | ☐ | |
| `authPassword` | Password | Kalmar sirri | ☐ | |
| `authApply` | Apply to become an agent | Nemi zama wakili | ☐ | |
| `authApplyTitle` | Apply to become a revenue agent | Nemi zama wakilin karbar haraji | ☐ | |
| `authBackToSignIn` | Back to sign in | Koma shiga | ☐ | |
| `authYourDetails` | Your details | Bayananka | ☐ | |
| `authFullName` | Full name | Cikakken suna | ☐ | |
| `authPhone` | Phone number | Lambar waya | ☐ | |
| `authEmail` | Email address | Adireshin imel | ☐ | |
| `authDateOfBirth` | Date of birth | Ranar haihuwa | ☐ | |
| `authOccupation` | Occupation | Sana’a | ☐ | |
| `authWhereYouLive` | Where you live | Inda kake zama | ☐ | |
| `authAddress` | Residential address | Adireshin gida | ☐ | |
| `authSelectLga` | Select your LGA | Zabi Karamar Hukumarka | ☐ | |
| `authNeedDocuments` | You will need identity documents, bank details and a referee. | Za ka bukaci takardun shaida, bayanan banki da mai shaida. | ☐ | |
| `authWhatNext` | What happens next | Abin da zai biyo baya | ☐ | |
| `authNextSignIn` | Sign in and complete identity verification. | Ka shiga ka kammala tabbatar da shaidarka. | ☐ | |
| `authNextReferee` | Nominate a referee who can confirm who you are. | Ka gabatar da mai shaida wanda zai iya tabbatar da kai. | ☐ | |
| `authNextReview` | PSIRS reviews your application. | PSIRS za ta duba bukatarka. | ☐ | |
| `authNextClearance` | Complete training, bank verification and device registration. | Ka kammala horo, tabbatar da banki da rajistar na’ura. | ☐ | |
| `authApplicationReceived` | Application received | An karbi bukatar | ☐ | |
| `authApplicationNumber` | Your application number is | Lambar bukatarka ita ce | ☐ | |

#### The one-time code

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `stepUpExpiresIn` | Expires in {{time}} | Zai kare cikin {{time}} | ☐ | |
| `stepUpCodeFailed` | Could not send a code. | Ba a iya tura lamba ba. | ☐ | |
| `stepUpAuthoriseFailed` | Could not authorise this. | Ba a iya bada izinin wannan ba. | ☐ | |
| `stepUpNoSms` | No real SMS is configured, so the code is shown here: | Ba a saita SMS na gaske ba, don haka an nuna lambar a nan: | ☐ | |
| `stepUpSignInAgain` | Sign in again to request a code. | Ka sake shiga don neman lamba. | ☐ | |
| `stepUpEnterCode` | Enter the one-time code sent to your phone to authorise this action: | Ka shigar da lambar sirri da aka aika zuwa wayarka domin amincewa da wannan aikin: | ☐ | |
| `stepUpCodeRequired` | A one-time code is required to continue. | Ana bukatar lambar sirri kafin a ci gaba. | ☐ | |
| `stepUpOneTimeCode` | One-time code | Lambar amfani sau daya | ☐ | |
| `stepUpExpired` | That code has expired | Lambar ta kare | ☐ | |
| `stepUpAskNew` | Ask for a new one to continue. | Ka nemi sabuwa domin ci gaba. | ☐ | |
| `stepUpSendNew` | Send a new code | Tura sabuwar lamba | ☐ | |
| `stepUpCouldNotContinue` | Could not continue | Ba a iya ci gaba ba | ☐ | |
| `stepUpDevelopmentBuild` | Development build | Sigar gwaji | ☐ | |

#### The frame around every screen

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `shellSyncFailed` | Your saved records could not be sent to PSIRS. They are still on this phone. | Ba a iya tura rikodin da ka adana zuwa PSIRS ba. Suna nan a wannan wayar. | ☐ | |
| `shellMain` | Main | Babban | ☐ | |
| `shellNothingLost` | Nothing has been lost — the records are still on this phone and will be sent once this is put right. | Ba a rasa komai ba — rikodin na nan a wayar kuma za a tura su idan an gyara wannan. | ☐ | |
| `shellRestoring` | Restoring your session… | Ana dawo da zamanka… | ☐ | |
| `shellAgentTitle` | PSIRS Revenue Agent | Wakilin Haraji na PSIRS | ☐ | |
| `shellAgentBrand` | Plateau State Revenue Agent | Wakilin Haraji na Jihar Filato | ☐ | |

#### The camera

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `camCancel` | Cancel | Soke | ☐ | |

#### What the platform says when it refuses

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `errRateLimited` | Too many attempts. Wait a moment and try again. | Yunkuri sun yi yawa. Ka dan jira sannan ka sake gwadawa. | ☐ | |
| `errReference` | Reference | Lamba | ☐ | |
| `errUploadFailed` | The document could not be sent. Try again. | Ba a iya aika takardar ba. Ka sake gwadawa. | ☐ | |
| `errUploadOffline` | You are offline. An identity document is sent to PSIRS as it is captured and is not stored on this device — take the photograph again when you have a connection. | Babu hanyar sadarwa. Ana aika takardar shaida zuwa PSIRS yayin daukarta, ba a ajiye ta a wannan na’ura ba — ka sake daukar hoton idan ka samu hanyar sadarwa. | ☐ | |
| `errRequestFailed` | The request failed. Try again, or contact support. | Bukatar ba ta yi nasara ba. Ka sake gwadawa, ko ka tuntubi tallafi. | ☐ | |
| `errDraftInvalid` | PSIRS could not accept this capture: {{detail}}. It is still on your phone — correct it and send it again. | PSIRS ba ta iya karbar wannan shigarwa ba: {{detail}}. Tana nan a wayarka — ka gyara ta ka sake aikawa. | ☐ | |
| `errDraftTypeUnsupported` | This version of the app made a "{{type}}" capture that PSIRS cannot process yet. It has not been lost — update the app, or quote this reference to support. | Wannan sigar manhajar ta yi shigarwa irin "{{type}}" wadda PSIRS ba ta iya sarrafawa tukuna. Ba a rasa ta ba — ka sabunta manhajar, ko ka ba da wannan lamba ga tallafi. | ☐ | |
| `errDraftNotProcessed` | PSIRS could not process this capture. It is still on your phone — quote reference {{reference}} to support. | PSIRS ba ta iya sarrafa wannan shigarwa ba. Tana nan a wayarka — ka ba da lamba {{reference}} ga tallafi. | ☐ | |

#### Shared controls

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `uiLoading` | Loading | Ana lodi | ☐ | |
| `uiHide` | Hide | Boye | ☐ | |
| `uiHidePassword` | Hide password | Boye kalmar sirri | ☐ | |
| `uiShow` | Show | Nuna | ☐ | |
| `uiShowPassword` | Show password | Nuna kalmar sirri | ☐ | |

#### The pages a citizen reads without an account

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `pubRefereeIntroOfLga` | {{name}}, of {{lga}}, has applied to become an authorised revenue agent. PSIRS needs somebody who knows them to confirm their identity and suitability. | {{name}}, na {{lga}}, ya nemi ya zama wakilin karbar haraji da izini. PSIRS na bukatar wanda ya san shi don tabbatar da ko wanene shi da cancantarsa. | ☐ | |
| `pubAttestProgress` | ({{answered}} of {{total}} answered) | (an amsa {{answered}} daga {{total}}) | ☐ | |
| `pubRefereeNamedYou` | {{name}} has named you as their referee | {{name}} ya sanya ka a matsayin mai shaidarsa | ☐ | |
| `pubService` | Plateau State Internal Revenue Service | Hukumar Karbar Haraji ta Jihar Filato | ☐ | |
| `pubLanguage` | Language | Harshe | ☐ | |
| `pubEnglish` | English | Turanci | ☐ | |
| `pubHausa` | Hausa | Hausa | ☐ | |
| `pubThankYou` | THANK YOU | NA GODE | ☐ | |
| `pubVerifyTitle` | Verify a government receipt | Tantance rasitin gwamnati | ☐ | |
| `pubVerifyField` | Receipt number or verification code | Lambar rasit ko lambar tantancewa | ☐ | |
| `pubVerifyAction` | Verify | Tantance | ☐ | |
| `pubVerifyChecking` | Checking… | Ana bincike… | ☐ | |
| `pubVerifyReceiptNumber` | Receipt number | Lambar rasit | ☐ | |
| `pubVerifyRevenueType` | Revenue type | Nau’in haraji | ☐ | |
| `pubVerifyAmount` | Amount | Adadi | ☐ | |
| `pubVerifyIssued` | Issued | Ranar bayarwa | ☐ | |
| `pubVerifyLga` | Local Government Area | Karamar Hukuma | ☐ | |
| `pubVerifyFingerprint` | Document fingerprint | Hatimin takardar | ☐ | |
| `pubVerifyMatches` | Matches the original | Ya yi daidai da na asali | ☐ | |
| `pubVerifyNoMatch` | Does not match the original | Bai yi daidai da na asali ba | ☐ | |
| `pubVerifyPrivacy` | For privacy, taxpayer names, phone numbers and TINs are never shown on this page. | Domin sirri, ba a taba nuna sunan mai biyan haraji, lambar waya ko TIN a wannan shafi ba. | ☐ | |
| `pubRefereeTitle` | Agent verification request | Bukatar tantance wakili | ☐ | |
| `pubRefereeIntro` | {{name}} has applied to become an authorised revenue agent. PSIRS needs somebody who knows them to confirm their identity and suitability. | {{name}} ya nemi ya zama wakilin karbar haraji da izini. PSIRS na bukatar wanda ya san shi don tabbatar da ko wanene shi da cancantarsa. | ☐ | |
| `pubRefereeApplicant` | Applicant | Mai neman | ☐ | |
| `pubRefereeYouAre` | You are recorded as | An rubuta ka a matsayin | ☐ | |
| `pubRefereeRelationship` | Stated relationship | Alakar da aka bayyana | ☐ | |
| `pubRefereeCategory` | Referee category | Nau’in mai shaida | ☐ | |
| `pubRefereeRespondBefore` | Respond before | Ka amsa kafin | ☐ | |
| `pubRefereeConfirmEach` | Please confirm each of the following: | Da fatan za ka tabbatar da kowanne daga cikin wadannan: | ☐ | |
| `pubDeclarationKnows` | I know this person. | Na san wannan mutumin. | ☐ | |
| `pubDeclarationAccurate` | The information presented is reasonably accurate. | Bayanan da aka gabatar daidai ne gwargwadon saninna. | ☐ | |
| `pubDeclarationWilling` | I am willing to act as referee. | Na yarda in tsaya masa a matsayin mai shaida. | ☐ | |
| `pubDeclarationConsequences` | I understand that providing false information may have consequences. | Na fahimci cewa bayar da bayanan karya na iya haifar da hukunci. | ☐ | |
| `pubRefereeIdType` | Your identification type | Nau’in shaidarka | ☐ | |
| `pubRefereeIdNumber` | Your identification number | Lambar shaidarka | ☐ | |
| `pubRefereeIdHint` | Stored securely and never shown in full. If you leave this blank, a PSIRS officer will review your response manually. | Ana adana ta cikin tsaro kuma ba a taba nuna ta gaba daya ba. Idan ka bar wannan a fade, jami’in PSIRS zai duba amsarka da hannu. | ☐ | |
| `pubRefereeOccupation` | Your occupation | Sana’arka | ☐ | |
| `pubIdNin` | National Identification Number | Lambar Shaidar Kasa (NIN) | ☐ | |
| `pubIdBvn` | Bank Verification Number | Lambar Tantancewar Banki (BVN) | ☐ | |
| `pubIdPassport` | International passport | Fasfo na kasashen waje | ☐ | |
| `pubIdLicence` | Driver’s licence | Lasisin tuki | ☐ | |
| `pubIdVoters` | Voter’s card | Katin zabe | ☐ | |
| `pubRefereeSubmit` | Confirm and submit | Tabbatar da aikawa | ☐ | |
| `pubRefereeSubmitting` | Submitting… | Ana aikawa… | ☐ | |
| `pubRefereeDecline` | I cannot act as referee | Ba zan iya tsayawa a matsayin mai shaida ba | ☐ | |
| `pubRefereeNoAccount` | You do not need an account. This link can be used once and expires on | Ba ka bukatar asusu. Ana amfani da wannan mahadin sau daya kuma zai kare a | ☐ | |
| `pubDeclineTitle` | Decline to act as referee? | Ka ki tsayawa a matsayin mai shaida? | ☐ | |
| `pubDeclineBody1a` | You are about to tell PSIRS that you cannot vouch for | Za ka gaya wa PSIRS cewa ba za ka iya tsayawa wa | ☐ | |
| `pubDeclineBody1b` | Their application to collect government revenue will not go forward on your word. | ba. Bukatarsa ta karbar harajin gwamnati ba za ta ci gaba ba bisa maganarka. | ☐ | |
| `pubDeclineBody2` | This cannot be undone from this page, and the link cannot be used again. | Ba za a iya soke wannan daga wannan shafi ba, kuma ba za a sake amfani da mahadin ba. | ☐ | |
| `pubDeclineReason` | Reason (optional) | Dalili (na zabi) | ☐ | |
| `pubDeclineReasonHint` | If you simply do not know this person well enough, saying so is enough. | Idan kawai ba ka san wannan mutumin sosai ba, fadin haka ya isa. | ☐ | |
| `pubDeclineYes` | Yes, decline | Eh, na ki | ☐ | |
| `pubDeclineNo` | No, go back | A’a, kada a ci gaba | ☐ | |
| `pubDeclineSending` | Sending… | Ana aikawa… | ☐ | |
| `pubAttestTitle` | Group membership check | Tantance mambobin kungiya | ☐ | |
| `pubAttestIntro` | PSIRS needs you to confirm which of these people really are members. Government support is offered to members, so confirming somebody who is not one takes it from somebody who is. | PSIRS na bukatar ka tabbatar da wadanne daga cikin wadannan mutane ne mambobi da gaske. Ana ba mambobi tallafin gwamnati, don haka tabbatar da wanda ba mamba ba yana kwace shi daga wanda yake mamba. | ☐ | |
| `pubAttestGroup` | Group | Kungiya | ☐ | |
| `pubAttestAlready` | Already confirmed | An riga an tabbatar | ☐ | |
| `pubAttestNothingTitle` | Nothing waiting | Babu abin da ake jira | ☐ | |
| `pubAttestNothingBody` | Every member on this list has already been confirmed. There is nothing for you to do. | An riga an tabbatar da kowane mamba a wannan jerin. Babu abin da za ka yi. | ☐ | |
| `pubAttestQuestion` | Is each of these people a member of your group? | Shin kowane daya daga cikin wadannan mutane mamba ne a kungiyarka? | ☐ | |
| `pubAttestYes` | Member | Mamba | ☐ | |
| `pubAttestNo` | Not a member | Ba mamba ba | ☐ | |
| `pubAttestAnswerAll` | Please answer for every person before sending. | Da fatan za ka amsa game da kowane mutum kafin aikawa. | ☐ | |
| `pubAttestSubmit` | Send my answers | Aika amsoshina | ☐ | |
| `pubCitizenTitle` | Check your tax status | Duba matsayin harajinka | ☐ | |
| `pubCitizenModeTin` | By TIN | Ta TIN | ☐ | |
| `pubCitizenModePhone` | By phone | Ta waya | ☐ | |
| `pubCitizenModeName` | By name | Ta suna | ☐ | |
| `pubCitizenCheck` | Check status | Duba matsayi | ☐ | |
| `pubCitizenSearching` | Searching… | Ana dubawa… | ☐ | |
| `pubCitizenExampleTin` | e.g. PL-000001234 | misali PL-000001234 | ☐ | |
| `pubCitizenExamplePhone` | e.g. 08012345678 | misali 08012345678 | ☐ | |
| `pubCitizenExampleName` | e.g. Aminu Ibrahim | misali Aminu Ibrahim | ☐ | |
| `pubCitizenByTin` | Tax Identification Number (TIN) | Lambar Shaidar Haraji (TIN) | ☐ | |
| `pubCitizenByPhone` | Registered phone number | Lambar wayar da aka yi rijista | ☐ | |
| `pubCitizenByName` | Full name or business name | Cikakken suna ko sunan kasuwanci | ☐ | |
| `pubCitizenTooMany` | Use your TIN or exact phone number for a precise result. | Yi amfani da TIN dinka ko ainihin lambar wayarka don sakamako madaidaici. | ☐ | |
| `pubRefereeThankYouCleared` | Thank you. Your verification has been completed and recorded. | Na gode. An kammala tantancewarka kuma an rubuta ta. | ☐ | |
| `pubRefereeCouldNotVerify` | Your identity could not be verified. PSIRS may contact you for more information. | Ba a iya tantance wanene kai ba. PSIRS na iya tuntubarka domin karin bayani. | ☐ | |
| `pubRefereeUnderReview` | Thank you. Your response has been recorded and is now being reviewed by PSIRS. | Na gode. An rubuta amsarka kuma yanzu PSIRS na duba ta. | ☐ | |
| `pubRefereeDeclineRecorded` | Your decision has been recorded. The applicant will be told they need a different referee. | An rubuta shawararka. Za a gaya wa mai nema cewa yana bukatar wani mai shaida. | ☐ | |
| `pubGroupAllConfirmed` | Thank you. You confirmed {{confirmed}} membership(s). | Na gode. Ka tabbatar da mambobi {{confirmed}}. | ☐ | |
| `pubGroupSomeConfirmed` | Thank you. You confirmed {{confirmed}} membership(s) and did not confirm {{rejected}}. | Na gode. Ka tabbatar da mambobi {{confirmed}} kuma ba ka tabbatar da {{rejected}} ba. | ☐ | |
| `pubCitizenNoTinMatch` | No taxpayer record found for that TIN. | Ba a sami rajistar mai biyan haraji da wannan TIN ba. | ☐ | |
| `pubCitizenNoPhoneMatch` | No taxpayer record found for that phone number. | Ba a sami rajistar mai biyan haraji da wannan lambar waya ba. | ☐ | |
| `pubCitizenNoNameMatch` | No record found with that name. | Ba a sami rajista da wannan suna ba. | ☐ | |
| `pubCitizenOneMatch` | One matching record found. | An sami rajista guda daya da ta yi daidai. | ☐ | |
| `pubCitizenManyMatches` | {{count}} records found with a similar name. | An sami rajista {{count}} masu kama da wannan suna. | ☐ | |
| `pubCitizenStatusHeading` | Tax compliance status | Matsayin bin ka’idar haraji | ☐ | |
| `pubCitizenCompliant` | Compliant | Ya bi ka’ida | ☐ | |
| `pubCitizenArrears` | Has arrears | Yana da bashin haraji | ☐ | |
| `pubCitizenAttention` | Needs attention | Yana bukatar kulawa | ☐ | |
| `pubCitizenNotAssessed` | Not yet assessed | Ba a kimanta ba tukuna | ☐ | |
| `pubCitizenMsgCompliant` | Your tax records are up to date. Keep paying on time to maintain your status. | Bayanan harajinka sun cika. Ka ci gaba da biya a kan lokaci domin ka rike wannan matsayi. | ☐ | |
| `pubCitizenMsgArrears` | You have outstanding tax obligations. Please contact your nearest PSIRS office or a revenue agent to pay. | Kana da harajin da ake bin ka. Da fatan za ka tuntubi ofishin PSIRS mafi kusa da kai ko wakilin karbar haraji domin ka biya. | ☐ | |
| `pubCitizenMsgAttention` | Your compliance score needs improvement. Paying your obligations on time will raise it. | Makin bin ka’idar harajinka yana bukatar gyara. Biyan harajin da ake bin ka a kan lokaci zai daga shi. | ☐ | |
| `pubCitizenMsgNotAssessed` | Nothing has been assessed against you yet, so there is no compliance score to report. This will update after your first assessment. | Ba a kimanta maka komai ba tukuna, don haka babu makin bin ka’ida da za a nuna. Wannan zai sabunta bayan kimantawarka ta farko. | ☐ | |
| `pubCitizenDetail` | For your TIN, your compliance score, what you owe and which support programmes you qualify for, visit any PSIRS office or an authorised revenue agent. They will confirm who you are first, which is why those details are not shown here. | Domin sanin TIN dinka, makin bin ka’idarka, abin da ake bin ka da kuma shirye-shiryen tallafi da ka cancanta, ka ziyarci kowane ofishin PSIRS ko wakilin karbar haraji da izini. Za su fara tabbatar da ko wane ne kai, shi ya sa ba a nuna wadannan bayanai a nan ba. | ☐ | |
| `pubCitizenTinStatus` | TIN status | Matsayin TIN | ☐ | |
| `pubCitizenOutstanding` | Outstanding obligations | Harajin da ake bin ka | ☐ | |
| `pubCitizenOutstandingYes` | Yes — please contact PSIRS | Eh — da fatan za ka tuntubi PSIRS | ☐ | |
| `pubCitizenNone` | None | Babu | ☐ | |
| `pubStmtFrom` | From | Daga | ☐ | |
| `pubStmtTo` | To | Zuwa | ☐ | |
| `pubStmtBackwards` | The start of the period is after its end. | Farkon lokacin ya zo bayan karshensa. | ☐ | |
| `pubStmtAnotherPeriod` | Look at a different period (sends a new code) | Duba wani lokaci dabam (za a aika sabuwar lamba) | ☐ | |
| `pubStmtTitle` | What you have already paid | Abin da ka riga ka biya | ☐ | |
| `pubStmtIntro` | To see your payments we send a code to the phone number on your record. It is never sent to a number typed here. | Domin ganin biyayyarka muna aika lamba zuwa lambar wayar da ke rubuce a bayananka. Ba a taba aika ta zuwa lambar da aka rubuta a nan ba. | ☐ | |
| `pubStmtSendCode` | Send me a code | Aiko min da lamba | ☐ | |
| `pubStmtSending` | Sending… | Ana aikawa… | ☐ | |
| `pubStmtCodeSent` | If a record matches, a code has gone to the phone number on it. Enter it below. | Idan akwai bayanan da suka dace, an aika lamba zuwa wayar da ke kansu. Ka shigar da ita a kasa. | ☐ | |
| `pubStmtCode` | Code from the SMS | Lambar da ke cikin sakon | ☐ | |
| `pubStmtShow` | Show my payments | Nuna min biyayyata | ☐ | |
| `pubStmtChecking` | Checking… | Ana duba… | ☐ | |
| `pubStmtPeriod` | Payments from {{from}} to {{to}}. | Biyayya daga {{from}} zuwa {{to}}. | ☐ | |
| `pubStmtTotal` | Total paid | Jimlar da aka biya | ☐ | |
| `pubStmtCount` | Payments | Biyayya | ☐ | |
| `pubStmtReturned` | Returned to you | An mayar maka | ☐ | |
| `pubStmtReturnedRow` | returned to you | an mayar maka | ☐ | |
| `pubStmtForWhat` | What it went to | Abin da aka biya | ☐ | |
| `pubStmtEach` | Each payment | Kowane biya | ☐ | |
| `pubStmtNothing` | Nothing was paid in this period. | Ba a biya komai a wannan lokacin ba. | ☐ | |
| `pubStmtFooter` | Keep your receipts. If this list and your receipts disagree, take them to a PSIRS office — the receipt is the proof, this is the record. | Ka ajiye rasitunka. Idan wannan jerin da rasitunka ba su dace ba, ka kai su ofishin PSIRS — rasit shi ne hujja, wannan kuwa rikodi ne. | ☐ | |
| `pubCitizenFooter` | For questions about your account, visit any PSIRS office or contact an authorised revenue agent. | Don tambaya game da asusunka, ka ziyarci kowane ofishin PSIRS ko ka tuntubi wakilin karbar haraji da izini. | ☐ | |
| `pubCitizenAlso` | Also available: | Akwai kuma: | ☐ | |
| `pubCitizenVerifyLink` | Verify a payment receipt | Tantance rasitin biyan kudi | ☐ | |

#### Everything else

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `home` | Home | Gida | ☐ | |
| `collect` | Collect | Karbi Haraji | ☐ | |
| `taxpayers` | Taxpayers | Masu Biyan Haraji | ☐ | |
| `vehicles` | Vehicles | Motoci | ☐ | |
| `receipts` | Receipts | Takardun Rasit | ☐ | |
| `more` | More | Karin Bayani | ☐ | |
| `search` | Search | Bincika | ☐ | |
| `verify` | Verify Receipt | Tabbatar da Rasit | ☐ | |
| `signOut` | Sign Out | Fita Daga Tsarin | ☐ | |
| `payRevenue` | Pay Revenue | Biyan Haraji | ☐ | |
| `confirmPayment` | Confirm Payment | Tabbatar da Biyan Kudi | ☐ | |
| `downloadReceipt` | Download Receipt | Sauke Rasit (PDF) | ☐ | |
| `shareReceipt` | Share Receipt | Tura Rasit | ☐ | |
| `printBluetooth` | Print (Bluetooth Thermal) | Buga Rasit a Inji (Bluetooth) | ☐ | |
| `registerTaxpayer` | Register Taxpayer | Yi Rajistar Mai Biyan Haraji | ☐ | |
| `renewVehicle` | Renew Vehicle | Sabunta Lasisin Mota | ☐ | |
| `pairPrinter` | Pair Bluetooth Printer | Hada Injin Buga Rasit | ☐ | |
| `testPrint` | Print Test Slip | Buga Gwaji | ☐ | |
| `enablePush` | Enable Push Notifications | Kunna Sanarwa ta Wayar Salula | ☐ | |
| `taxpayerName` | Taxpayer Name | Sunan Mai Biyan Haraji | ☐ | |
| `taxpayerTin` | Tax Identification Number (TIN) | Lambar Shaida ta Haraji (TIN) | ☐ | |
| `phone` | Phone Number | Lambar Waya | ☐ | |
| `lga` | LGA (Local Government) | Karamar Hukuma (LGA) | ☐ | |
| `ward` | Ward | Gunduma (Ward) | ☐ | |
| `service` | Revenue Item / Service | Nau’in Haraji / Aiki | ☐ | |
| `amount` | Amount | Kudin Haraji | ☐ | |
| `totalPaid` | Total Paid | Jimlar Kudin da Aka Biya | ☐ | |
| `receiptNumber` | Receipt Number | Lambar Rasit | ☐ | |
| `verificationCode` | Verification Code | Lambar Tantancewa | ☐ | |
| `paymentMode` | Payment Mode | Hanyar Biyan Kudi | ☐ | |
| `noTaxPayable` | No tax is payable | Babu harajin da za a biya | ☐ | |
| `noTaxPayableBody` | This taxpayer owes nothing on the amount declared. Do not increase it to make a payment go through — there is nothing to collect. | Wannan mai biyan haraji ba shi da abin biya a kan adadin da aka shigar. Kada ka kara adadin domin a sami biyan kudi — babu abin karba. | ☐ | |
| `paymentAcknowledged` | Payment confirmed — receipt to follow | An tabbatar da biyan kudin — rasit zai biyo baya | ☐ | |
| `paymentAcknowledgedBody` | The payment system has confirmed this payment. Government has not yet received the money, so this is an acknowledgement and NOT a receipt. The receipt is issued automatically once the money reaches the government account. Do not ask the taxpayer to pay again. | Na’urar biyan kudi ta tabbatar da wannan biyan. Gwamnati ba ta riga ta karbi kudin ba, don haka wannan shaidar karbar kudi ce, BA rasit ba. Za a fitar da rasit ta atomatik da zarar kudin ya isa asusun gwamnati. Kada ka ce wa mai biyan haraji ya sake biya. | ☐ | |
| `acknowledgementLabel` | Acknowledgement | Shaidar karbar kudi | ☐ | |
| `searchAnotherArea` | A name search covers your own Local Government Area. If they are registered elsewhere, search by their phone number, TIN, vehicle registration or a receipt number. | Binciken suna yana rufe Karamar Hukumar da kake aiki a ciki kadai. Idan an yi masa rajista a wata Karamar Hukuma, ka nemo shi da lambar wayarsa, TIN, lambar mota ko lambar rasit. | ☐ | |
| `languageForMessages` | Language for their messages | Harshen sakonnin sa | ☐ | |
| `languageForMessagesHint` | Ask the taxpayer. Their receipt arrives by SMS and it is the only copy they will have. | Ka tambayi mai biyan haraji. Rasit dinsa yana zuwa ta SMS, kuma shi ne kwafin da zai samu kadai. | ☐ | |
| `enumDeviceVelocity` | One handset, too many collections | Na’ura daya, karbar kudi da yawa | ☐ | |
| `enumSharedPhoneNumber` | One phone number on several taxpayers | Lambar waya daya a kan masu biyan haraji da yawa | ☐ | |
| `enumDuplicateTaxpayerDetails` | Details already on another record | Bayanan da suke a wani bayanin | ☐ | |
| `enumOutOfTerritory` | Collected outside the agent’s area | An karba a wajen yankin wakili | ☐ | |
| `enumRepeatedFailedPayments` | Payments that keep failing | Biyan kudi da ke ci gaba da gazawa | ☐ | |
| `enumReversalPattern` | A pattern of reversals | Yanayin mayar da kudi akai-akai | ☐ | |
| `enumUnusualVolume` | More collections than usual | Karbar kudi fiye da yadda aka saba | ☐ | |
| `enumFrequentManualIntervention` | Often changed by hand | Ana yawan canza shi da hannu | ☐ | |
| `enumRepeatedReceiptRegeneration` | Receipt issued or fetched again and again | An sake fitar da rasit ko saukar da shi sau da yawa | ☐ | |
| `enumUnusualOfficerActivity` | Busier than this officer's usual day | Aiki ya fi na yau da kullun na wannan jami’in | ☐ | |
| `enumUnusualTransactionTiming` | Collections written late at night | An rubuta karbar kudi da tsakar dare | ☐ | |
| `enumUser` | Officer | Jami’i | ☐ | |
| `enumRapidSuccession` | Collections one after another, too fast | Karbar kudi a jere, da sauri sosai | ☐ | |
| `enumCommissionAnomaly` | Commission that does not add up | Kwamishan da bai yi daidai ba | ☐ | |
| `enumSettlementVariance` | The gateway paid a different amount | Hanyar biya ta biya wani adadi daban | ☐ | |
| `enumAbandoned` | Abandoned | An yashe | ☐ | |
| `enumAborted` | Aborted | An dakatar da shi | ☐ | |
| `enumAccepted` | Accepted | An karba | ☐ | |
| `enumAccountTransfer` | Account transfer | Tura kudi daga asusu | ☐ | |
| `enumActionRequired` | Action required | Ana bukatar mataki | ☐ | |
| `enumActivated` | Activated | An kunna | ☐ | |
| `enumActive` | Active | Mai aiki | ☐ | |
| `enumAdditionalIdentification` | Additional identification | Karin shaida | ☐ | |
| `enumAdditiveBenefit` | Extra benefit | Karin amfani | ☐ | |
| `enumAdmin` | Administrator | Mai gudanarwa | ☐ | |
| `enumAgent` | Agent | Wakili | ☐ | |
| `enumAgentActivation` | Activating an agent | Kunna wakili | ☐ | |
| `enumAgentAssisted` | Agent-assisted | Taimakon wakili | ☐ | |
| `enumAgentMisconduct` | Agent misconduct | Rashin da’a na wakili | ☐ | |
| `enumAgentOnboarding` | Agent onboarding | Shigar da sabon wakili | ☐ | |
| `enumAgentOverrideActivation` | Activating an agent by override | Kunna wakili ta hanyar kebewa | ☐ | |
| `enumAgentPwa` | Agent app | Manhajar wakili | ☐ | |
| `enumAgentSuspension` | Suspending an agent | Dakatar da wakili | ☐ | |
| `enumAgreementAccepted` | Agreement accepted | An karbi yarjejeniya | ☐ | |
| `enumAgriculture` | Farming | Noma | ☐ | |
| `enumAgricultureProcessing` | Processing farm produce | Sarrafa amfanin gona | ☐ | |
| `enumAmountMismatch` | Amount does not match | Adadin bai dace ba | ☐ | |
| `enumAnnual` | Yearly | Kowace shekara | ☐ | |
| `enumApi` | API | API | ☐ | |
| `enumApplicationSubmitted` | Application submitted | An tura takardar neman aiki | ☐ | |
| `enumApproved` | Approved | An amince | ☐ | |
| `enumArchived` | Archived | An ajiye | ☐ | |
| `enumArtisanCraft` | Craft and trade work | Sana’ar hannu | ☐ | |
| `enumArtisanGuild` | Artisan guild | Kungiyar masu sana’a | ☐ | |
| `enumAssessment` | Assessment | Kimantawa | ☐ | |
| `enumAssessmentCreated` | Assessment made | An yi kimantawa | ☐ | |
| `dowSun` | Sunday | Lahadi | ☐ | |
| `dowMon` | Monday | Litinin | ☐ | |
| `dowTue` | Tuesday | Talata | ☐ | |
| `dowWed` | Wednesday | Laraba | ☐ | |
| `dowThu` | Thursday | Alhamis | ☐ | |
| `dowFri` | Friday | Jumma’a | ☐ | |
| `dowSat` | Saturday | Asabar | ☐ | |
| `monthJan` | January | Janairu | ☐ | |
| `monthFeb` | February | Faburairu | ☐ | |
| `monthMar` | March | Maris | ☐ | |
| `monthApr` | April | Afirilu | ☐ | |
| `monthMay` | May | Mayu | ☐ | |
| `monthJun` | June | Yuni | ☐ | |
| `monthJul` | July | Yuli | ☐ | |
| `monthAug` | August | Agusta | ☐ | |
| `monthSep` | September | Satumba | ☐ | |
| `monthOct` | October | Oktoba | ☐ | |
| `monthNov` | November | Nuwamba | ☐ | |
| `monthDec` | December | Disamba | ☐ | |
| `monJan` | Jan | Jan | ☐ | |
| `monFeb` | Feb | Fab | ☐ | |
| `monMar` | Mar | Mar | ☐ | |
| `monApr` | Apr | Afi | ☐ | |
| `monMay` | May | May | ☐ | |
| `monJun` | Jun | Yun | ☐ | |
| `monJul` | Jul | Yul | ☐ | |
| `monAug` | Aug | Agu | ☐ | |
| `monSep` | Sept | Sat | ☐ | |
| `monOct` | Oct | Okt | ☐ | |
| `monNov` | Nov | Nuw | ☐ | |
| `monDec` | Dec | Dis | ☐ | |
| `enumAssigned` | Assigned | An ba wa wani | ☐ | |
| `enumTinAssigned` | Assigned | An bayar | ☐ | |
| `enumAttested` | Attested | An shaida | ☐ | |
| `enumAuditor` | Auditor | Mai binciken lissafi | ☐ | |
| `enumAuthorityLookup` | Authority lookup | Binciken hukuma | ☐ | |
| `enumAutoRecommendation` | Suggested automatically | An ba da shawara ta atomatik | ☐ | |
| `enumAwarded` | Awarded | An ba da kyauta | ☐ | |
| `enumBag25kg` | 25kg bag | Buhu 25kg | ☐ | |
| `enumBag50kg` | 50kg bag | Buhu 50kg | ☐ | |
| `enumBankAccountChange` | Changing a bank account | Canja asusun banki | ☐ | |
| `enumBankChangeApplied` | Bank account changed | An canja asusun banki | ☐ | |
| `enumBankChangeRefused` | Bank account change refused | An ki canja asusun banki | ☐ | |
| `enumBankChangeRequested` | Bank account change requested | An nemi canja asusun banki | ☐ | |
| `enumBankTransfer` | Bank transfer | Tura kudi ta banki | ☐ | |
| `enumBankVerified` | Bank account verified | An tabbatar da asusun banki | ☐ | |
| `enumBase` | Base | Tushe | ☐ | |
| `enumBlocked` | Blocked | An hana | ☐ | |
| `enumBoth` | Both | Duka biyu | ☐ | |
| `enumBusiness` | Business | Kasuwanci | ☐ | |
| `enumBvn` | Bank Verification Number | Lambar Tabbatar da Banki | ☐ | |
| `enumCamera` | Camera | Kamara | ☐ | |
| `enumCancelled` | Cancelled | An soke | ☐ | |
| `enumCard` | Card | Katin banki | ☐ | |
| `enumCivilServant` | Civil servant | Ma’aikacin gwamnati | ☐ | |
| `enumCleared` | Cleared | An tantance | ☐ | |
| `enumClosed` | Closed | An rufe | ☐ | |
| `enumCollected` | Collected | An karba | ☐ | |
| `enumCommission` | Commission | Kwamishan | ☐ | |
| `enumCommissionAdjustment` | Adjusting commission | Gyara kwamishan | ☐ | |
| `enumCommissionPayout` | Paying out commission | Fitar da kwamishan | ☐ | |
| `enumCommunityLeader` | Community leader | Shugaban al’umma | ☐ | |
| `enumCompleted` | Completed | An kammala | ☐ | |
| `enumConfirmed` | Confirmed | An tabbatar | ☐ | |
| `enumConstruction` | Construction | Gine-gine | ☐ | |
| `enumCritical` | Critical | Mai matukar hatsari | ☐ | |
| `enumDaily` | Daily | Kullum | ☐ | |
| `enumDelivered` | Delivered | An isar | ☐ | |
| `enumDenied` | Refused | An hana | ☐ | |
| `enumDevice` | Device | Na’ura | ☐ | |
| `enumDeviceRegistered` | Device registered | An yi rajistar na’ura | ☐ | |
| `enumDismissed` | Dismissed | An yi watsi da shi | ☐ | |
| `enumDisputed` | Disputed | Ana jayayya | ☐ | |
| `enumDocument` | Document | Takarda | ☐ | |
| `enumDocumentCapture` | Document photograph | Hoton takarda | ☐ | |
| `enumDownload` | Download | Sauke | ☐ | |
| `enumDraft` | Draft | Daftari | ☐ | |
| `enumDriversLicence` | Driver’s licence | Lasisin tuki | ☐ | |
| `enumDuplicate` | Duplicate | Kwafi | ☐ | |
| `enumDuplicatePayment` | Duplicate payment | Biyan kudi sau biyu | ☐ | |
| `enumEducation` | Education | Ilimi | ☐ | |
| `enumEligibilityGate` | Condition of eligibility | Sharadin cancanta | ☐ | |
| `enumEligible` | Eligible | Ya cancanta | ☐ | |
| `enumEmail` | Email | Imel | ☐ | |
| `enumEmployer` | Employer | Ma’aikaci | ☐ | |
| `enumEn` | English | Turanci | ☐ | |
| `enumEntertainmentArts` | Entertainment and the arts | Nishadi da fasaha | ☐ | |
| `enumExecuted` | Executed | An zartar | ☐ | |
| `enumExisting` | Already held | Ana da shi | ☐ | |
| `enumExpired` | Expired | Ya kare | ☐ | |
| `enumFailed` | Failed | Ya gaza | ☐ | |
| `enumFailure` | Failure | Gazawa | ☐ | |
| `enumFarmersCooperative` | Farmers’ cooperative | Kungiyar manoma | ☐ | |
| `enumFederal` | Federal | Tarayya | ☐ | |
| `enumFemale` | Female | Mace | ☐ | |
| `enumFile` | File | Fayil | ☐ | |
| `enumFinanceOfficer` | Finance officer | Jami’in kudi | ☐ | |
| `enumFinancialServices` | Financial services | Ayyukan kudi | ☐ | |
| `enumFisheriesGroup` | Fisheries group | Kungiyar masunta | ☐ | |
| `enumFishing` | Fishing | Kamun kifi | ☐ | |
| `enumFixed` | Fixed amount | Adadi kayyadadde | ☐ | |
| `enumFoodBeverage` | Food and drink | Abinci da abin sha | ☐ | |
| `enumForfeited` | Forfeited | An rasa | ☐ | |
| `enumFormula` | Formula | Tsari na lissafi | ☐ | |
| `enumFortnightly` | Every two weeks | Kowane mako biyu | ☐ | |
| `enumFound` | Found | An samu | ☐ | |
| `enumFull` | Full | Cikakke | ☐ | |
| `enumGamingBetting` | Gaming and betting | Caca | ☐ | |
| `enumGateway` | Payment gateway | Hanyar biyan kudi | ☐ | |
| `enumGatewayWebhook` | Gateway notice | Sanarwar hanyar biya | ☐ | |
| `enumGovernment` | Government | Gwamnati | ☐ | |
| `enumGovernmentApproved` | Approved by the government | Gwamnati ta amince | ☐ | |
| `enumGovernmentRejected` | Refused by the government | Gwamnati ta ki | ☐ | |
| `enumHa` | Hausa | Hausa | ☐ | |
| `enumHealthcare` | Healthcare | Kiwon lafiya | ☐ | |
| `enumHigh` | High | Mai yawa | ☐ | |
| `enumHotelHospitality` | Hotels and hospitality | Otal da masauki | ☐ | |
| `enumIctTelecoms` | ICT & Telecommunications | Fasahar sadarwa da na’ura | ☐ | |
| `enumIdentityDocument` | Identity document | Takardar shaida | ☐ | |
| `enumIgnored` | Ignored | An yi watsi da shi | ☐ | |
| `enumInProgress` | In progress | Ana ci gaba | ☐ | |
| `enumInactive` | Inactive | Ba ya aiki | ☐ | |
| `enumIncorrectAssessment` | Incorrect assessment | Kimantawa mara daidai | ☐ | |
| `enumIndividual` | Individual | Mutum | ☐ | |
| `enumInfoRequested` | Information requested | An nemi karin bayani | ☐ | |
| `enumInformalWorker` | Informal worker | Mai aiki ba bisa ka’ida ba | ☐ | |
| `enumInitiated` | Started | An fara | ☐ | |
| `enumInvalid` | Not valid | Ba sahihi ba | ☐ | |
| `enumInvited` | Invited | An gayyata | ☐ | |
| `enumInvoice` | Invoice | Takardar biya | ☐ | |
| `enumInvoiceGenerated` | Invoice issued | An fitar da takardar biya | ☐ | |
| `enumInvoiced` | Invoiced | An fitar da takardar biya | ☐ | |
| `enumIssued` | Issued | An bayar | ☐ | |
| `enumKilogram` | Kilogram | Kilogiram | ☐ | |
| `enumKycCleared` | Identity cleared | An tantance shaida | ☐ | |
| `enumKycFailed` | Identity check failed | Tantance shaida ya gaza | ☐ | |
| `enumKycInfoRequired` | More identity information needed | Ana bukatar karin shaida | ☐ | |
| `enumKycSubmitted` | Identity submitted | An tura shaida | ☐ | |
| `enumLeft` | Left the group | Ya bar kungiyar | ☐ | |
| `enumLimited` | Limited connectivity | Hanyar sadarwa mai iyaka | ☐ | |
| `enumLinkedExisting` | Linked to an existing record | An hade da bayanin da ake da shi | ☐ | |
| `enumLitre` | Litre | Lita | ☐ | |
| `enumLivestock` | Livestock | Kiwon dabbobi | ☐ | |
| `enumLivestockAssociation` | Livestock association | Kungiyar masu dabbobi | ☐ | |
| `enumLocalGovernment` | Local government | Karamar hukuma | ☐ | |
| `enumLogin` | Sign in | Shiga | ☐ | |
| `enumLow` | Low | Kadan | ☐ | |
| `enumMale` | Male | Namiji | ☐ | |
| `enumManualCorrection` | Manual correction | Gyara da hannu | ☐ | |
| `enumManualEntry` | Entered by hand | An shigar da hannu | ☐ | |
| `enumManualReview` | Manual review | Bitar hannu | ☐ | |
| `enumManufacturing` | Manufacturing | Masana’antu | ☐ | |
| `enumMarketAssociation` | Market association | Kungiyar kasuwa | ☐ | |
| `enumMatched` | Matched | Ya dace | ☐ | |
| `enumMedium` | Medium | Matsakaici | ☐ | |
| `enumMerged` | Merged | An hade | ☐ | |
| `enumMigration` | Migration | Canja bayanai | ☐ | |
| `enumMining` | Mining | Hakar ma’adinai | ☐ | |
| `enumMissingPayment` | Payment missing | Babu biyan kudi | ☐ | |
| `enumMissingPlatformTransaction` | No record on the platform | Babu bayani a dandalin | ☐ | |
| `enumMonthly` | Monthly | Kowane wata | ☐ | |
| `enumMotorVehicle` | Motor vehicles | Motoci | ☐ | |
| `enumNin` | National Identification Number | Lambar Shaidar Kasa | ☐ | |
| `enumNormal` | Normal | Na yau da kullum | ☐ | |
| `enumNotAttempted` | Not attempted | Ba a gwada ba | ☐ | |
| `enumNotFound` | Not found | Ba a samu ba | ☐ | |
| `enumNotPerformed` | Not performed | Ba a yi ba | ☐ | |
| `enumNotRequested` | Not requested | Ba a nema ba | ☐ | |
| `enumNotStarted` | Not started | Ba a fara ba | ☐ | |
| `enumOfficer` | Officer | Jami’i | ☐ | |
| `enumOfficerReview` | Officer review | Dubawar jami’i | ☐ | |
| `enumOffline` | Offline | Babu layi | ☐ | |
| `enumOnHold` | On hold | An dakatar na dan lokaci | ☐ | |
| `enumOneOff` | One-off | Sau daya | ☐ | |
| `enumOnline` | Online | Yana kan layi | ☐ | |
| `enumOpen` | Open | A bude | ☐ | |
| `enumOpened` | Opened | An bude | ☐ | |
| `enumOther` | Other | Wani | ☐ | |
| `enumOverrideApplied` | Override applied | An yi amfani da kebewa | ☐ | |
| `enumPaid` | Paid | An biya | ☐ | |
| `enumPartial` | Partial | Bangare | ☐ | |
| `enumPartiallyPaid` | Partially paid | An biya wani bangare | ☐ | |
| `enumPassed` | Passed | Ya wuce | ☐ | |
| `enumPassport` | Passport | Fasfo | ☐ | |
| `enumPassportPhotograph` | Passport photograph | Hoton fasfo | ☐ | |
| `enumPasswordReset` | Password reset | Sauya kalmar sirri | ☐ | |
| `enumPaymentAcknowledgement` | Acknowledgement of payment | Sanarwar karbar biyan kudi | ☐ | |
| `enumPaymentEvidence` | Evidence of payment | Shaidar biyan kudi | ☐ | |
| `enumPaymentInitiated` | Payment started | An fara biyan kudi | ☐ | |
| `enumPaymentIssue` | Payment issue | Matsalar biyan kudi | ☐ | |
| `enumPaymentPending` | Payment pending | Ana jiran biyan kudi | ☐ | |
| `enumPaymentReversal` | Reversing a payment | Mayar da biyan kudi | ☐ | |
| `enumPaymentSuccessful` | Payment successful | Biyan kudi ya yi nasara | ☐ | |
| `enumPaymentVerified` | Payment verified | An tabbatar da biyan kudi | ☐ | |
| `enumPending` | Pending | Ana jira | ☐ | |
| `enumPendingAttestation` | Waiting for the leader to confirm | Ana jiran shugaba ya tabbatar | ☐ | |
| `enumPendingPayment` | Waiting for payment | Ana jiran biyan kudi | ☐ | |
| `enumPendingSettlement` | Waiting for settlement | Ana jiran biya | ☐ | |
| `enumPendingSync` | Waiting to be sent | Ana jiran a tura | ☐ | |
| `enumPercentage` | Percentage | Kaso | ☐ | |
| `enumPoll` | Gateway check | Duba hanyar biya | ☐ | |
| `enumPortal` | Officer portal | Tashar jami’i | ☐ | |
| `enumPos` | POS | POS | ☐ | |
| `enumPrivateEmployee` | Private sector employee | Ma’aikacin kamfani mai zaman kansa | ☐ | |
| `enumProceeded` | Proceeded | An ci gaba | ☐ | |
| `enumProcessed` | Processed | An sarrafa | ☐ | |
| `enumProcessing` | Processing | Ana aiwatarwa | ☐ | |
| `enumProfessionalServices` | Professional services | Ayyukan kwararru | ☐ | |
| `enumProofOfAddress` | Proof of address | Shaidar adireshi | ☐ | |
| `enumProposed` | Proposed | An gabatar | ☐ | |
| `enumPsirsSync` | PSIRS records | Bayanan PSIRS | ☐ | |
| `enumPublicServant` | Public servant | Ma’aikacin gwamnati | ☐ | |
| `enumPush` | App notification | Sanarwar manhaja | ☐ | |
| `enumQuarterly` | Quarterly | Kowane wata uku | ☐ | |
| `enumQueued` | Queued | Yana layi | ☐ | |
| `enumRead` | Read | An karanta | ☐ | |
| `enumReadyForReview` | Ready for review | A shirye don dubawa | ☐ | |
| `enumRealProperty` | Land and buildings | Filaye da gine-gine | ☐ | |
| `enumReceipt` | Receipt | Rasit | ☐ | |
| `enumReceiptGenerated` | Receipt issued | An fitar da rasit | ☐ | |
| `enumReceiptIssue` | Receipt issue | Matsalar rasit | ☐ | |
| `enumReceived` | Received | An karba | ☐ | |
| `enumRecognisedProfessional` | Recognised professional | Kwararre da aka amince da shi | ☐ | |
| `enumReconciled` | Reconciled | An daidaita lissafi | ☐ | |
| `enumReconciliation` | Reconciliation | Daidaita lissafi | ☐ | |
| `enumReconciliationPending` | Waiting for reconciliation | Ana jiran daidaita lissafi | ☐ | |
| `enumReferee` | Referee | Mai shaida | ☐ | |
| `enumRefereeCleared` | Referee cleared | Mai shaida ya tabbatar | ☐ | |
| `enumRefereeFailed` | Referee did not clear | Mai shaida bai tabbatar ba | ☐ | |
| `enumRefereeInvited` | Referee invited | An gayyaci mai shaida | ☐ | |
| `enumRefereeReplaced` | Referee replaced | An maye gurbin mai shaida | ☐ | |
| `enumRefereeVerify` | Referee verification | Tabbatar da mai shaida | ☐ | |
| `enumRefund` | Refund | Mayar da kudi | ☐ | |
| `enumRefunded` | Refunded | An mayar da kudi | ☐ | |
| `enumRegistration` | Registration | Rajista | ☐ | |
| `enumReinstated` | Reinstated | An mayar da shi aiki | ☐ | |
| `enumRejected` | Rejected | An ki | ☐ | |
| `enumReligiousLeader` | Religious leader | Shugaban addini | ☐ | |
| `enumReligiousNgo` | Religious body or charity | Kungiyar addini ko agaji | ☐ | |
| `enumReplaced` | Replaced | An maye gurbinsa | ☐ | |
| `enumRequested` | Requested | An nema | ☐ | |
| `enumResolved` | Resolved | An warware | ☐ | |
| `enumResponded` | Responded | An amsa | ☐ | |
| `enumRetailTrade` | Retail trade | Sayarwa kanana | ☐ | |
| `enumRetired` | Retired | An janye | ☐ | |
| `enumRevenueOfficer` | Revenue officer | Jami’in kudaden shiga | ☐ | |
| `enumRevenueRateChange` | Changing a rate | Canja kudin haraji | ☐ | |
| `enumReversal` | Reversal | Mayarwa | ☐ | |
| `enumReversed` | Reversed | An mayar da shi | ☐ | |
| `enumReview` | Review | Dubawa | ☐ | |
| `enumReviewed` | Reviewed | An duba | ☐ | |
| `enumRevoked` | Revoked | An janye izini | ☐ | |
| `enumRunning` | Running | Yana gudana | ☐ | |
| `enumSeedling` | Seedling | Tsiro | ☐ | |
| `enumSelfAssessment` | Self-assessment | Kimanta kai | ☐ | |
| `enumSelfEmployed` | Self-employed | Mai aikin kansa | ☐ | |
| `enumSelfie` | Photograph of yourself | Hoton kanka | ☐ | |
| `enumSent` | Sent | An aika | ☐ | |
| `enumServiceRequest` | Service request | Neman hidima | ☐ | |
| `enumSettled` | Settled | An daidaita | ☐ | |
| `enumSettlement` | Settlement | Biyan kudi | ☐ | |
| `enumShare` | Share | Rabawa | ☐ | |
| `enumSms` | SMS | SMS | ☐ | |
| `enumStarted` | Started | An fara | ☐ | |
| `enumState` | State | Jiha | ☐ | |
| `enumStepUp` | Extra confirmation | Karin tabbatarwa | ☐ | |
| `enumCitizenStatement` | Statement of payments | Bayanin biyayya | ☐ | |
| `enumStudentUnemployed` | Student or not working | Dalibi ko marar aikin yi | ☐ | |
| `enumSubmitted` | Submitted | An tura | ☐ | |
| `enumSucceeded` | Succeeded | Ya yi nasara | ☐ | |
| `enumSuccess` | Success | Nasara | ☐ | |
| `enumSuccessful` | Successful | Ya yi nasara | ☐ | |
| `enumSuperseded` | Superseded | An maye gurbinsa | ☐ | |
| `enumSupervisor` | Supervisor | Shugaba | ☐ | |
| `enumSupportingDocument` | Supporting document | Takardar tallafi | ☐ | |
| `enumSuspended` | Suspended | An dakatar | ☐ | |
| `enumSynced` | Sent | An tura | ☐ | |
| `enumSystem` | System | Tsarin | ☐ | |
| `enumTaxpayer` | Taxpayer | Mai biyan haraji | ☐ | |
| `enumTaxpayerAdjustment` | Adjusting a taxpayer record | Gyara bayanin mai biyan haraji | ☐ | |
| `enumTaxpayerComplaint` | Taxpayer complaint | Korafin mai biyan haraji | ☐ | |
| `enumTaxpayerRegistration` | Taxpayer registration | Rajistar mai biyan haraji | ☐ | |
| `enumTechnicalIssue` | Technical issue | Matsalar manhaja | ☐ | |
| `enumTiered` | Tiered | Matakai | ☐ | |
| `enumTinConfirmation` | TIN confirmation | Tabbatar da TIN | ☐ | |
| `enumTinIssue` | TIN issue | Matsalar TIN | ☐ | |
| `enumTractorDay` | Tractor day | Ranar tarakta | ☐ | |
| `enumTradersAssociation` | Traders’ association | Kungiyar ’yan kasuwa | ☐ | |
| `enumTraditionalAuthority` | Traditional authority | Sarauta | ☐ | |
| `enumTrainingCompleted` | Training completed | An kammala horo | ☐ | |
| `enumTransaction` | Transaction | Ciniki | ☐ | |
| `enumTransportHaulage` | Carrying goods | Daukar kaya | ☐ | |
| `enumTransportPassenger` | Carrying passengers | Daukar fasinja | ☐ | |
| `enumTransportUnion` | Transport union | Kungiyar masu sufuri | ☐ | |
| `enumUnauthorisedCharge` | Unauthorised charge | Kudin da ba a ba da izini ba | ☐ | |
| `enumUnavailable` | Unavailable | Ba ya samuwa | ☐ | |
| `enumUnchecked` | Not checked | Ba a duba ba | ☐ | |
| `enumUnderReview` | Under review | Ana dubawa | ☐ | |
| `enumUnit` | Unit | Guda | ☐ | |
| `enumUnknown` | Unknown | Ba a sani ba | ☐ | |
| `enumUnpaid` | Unpaid | Ba a biya ba | ☐ | |
| `enumUnspecified` | Not stated | Ba a fada ba | ☐ | |
| `enumUnverified` | Not verified | Ba a tabbatar ba | ☐ | |
| `enumUpload` | Upload | Tura | ☐ | |
| `enumUrgent` | Urgent | Na gaggawa | ☐ | |
| `enumUssd` | USSD | USSD | ☐ | |
| `enumValid` | Valid | Sahihi | ☐ | |
| `enumVehicle` | Vehicle | Mota | ☐ | |
| `enumVehicleCapture` | Vehicle details | Bayanin mota | ☐ | |
| `enumVehicleIssue` | Vehicle issue | Matsalar mota | ☐ | |
| `enumVehicleRenewal` | Vehicle renewal | Sabunta takardun mota | ☐ | |
| `enumVerificationRequired` | Verification required | Ana bukatar tabbatarwa | ☐ | |
| `enumVerified` | Verified | An tabbatar | ☐ | |
| `enumVerify` | Verify | Tabbatar | ☐ | |
| `enumView` | View | Duba | ☐ | |
| `enumVotersCard` | Voter’s card | Katin zabe | ☐ | |
| `enumWaived` | Waived | An yafe | ☐ | |
| `enumWebhook` | Gateway notice | Sanarwar hanyar biya | ☐ | |
| `enumWeekly` | Weekly | Kowane mako | ☐ | |
| `enumWhatsapp` | WhatsApp | WhatsApp | ☐ | |
| `enumWholesaleTrade` | Wholesale trade | Sayarwa da yawa | ☐ | |
| `actionSearch` | Search | Nema | ☐ | |
| `pickNoTaxpayerMatch` | No taxpayer matches that search. They must be registered before a payment can be attributed to them. | Babu mai biyan haraji da ya dace da wannan binciken. Sai an yi masa rajista kafin a iya danganta biyan kudi da shi. | ☐ | |
| `enumAssessed` | Assessed | An kimanta | ☐ | |
| `enumFactsWrong` | The facts are wrong | Bayanan ba daidai ba | ☐ | |
| `enumHasRecords` | Has proper records | Yana da rikodi na gaskiya | ☐ | |
| `enumNotTrading` | No longer trading | Ba ya kasuwanci kuma | ☐ | |
| `enumEnumeration` | Enumeration only | Kidaya kadai | ☐ | |
| `enumBusinessObservation` | Business written down | An rubuta kasuwanci | ☐ | |
| `enumAttestation` | Enumeration and attestation | Kidaya da tabbatarwa | ☐ | |
| `enumObjected` | Under objection | Ana kalubalanta | ☐ | |
| `enumUpheld` | Upheld | An amince | ☐ | |
| `enumAgreed` | Leader agreed | Shugaba ya amince | ☐ | |
| `enumDisagreed` | Leader disagreed | Shugaba bai amince ba | ☐ | |
| `enumNotSought` | No attestation sought | Ba a nemi tabbatarwa ba | ☐ | |
| `enumSmall` | Small | Karami | ☐ | |
| `enumNano` | Nano — exempt | Nano — an kebe | ☐ | |
| `enumPresumptive` | Presumptive — assessed off the schedule | Kimantawa — bisa jadawali | ☐ | |
| `enumBooks` | Books — assessed on records | Littattafai — bisa rikodin | ☐ | |
| `enumClassA` | Class A — strongest local economy | Mataki A — tattalin arziki mafi karfi | ☐ | |
| `enumClassB` | Class B | Mataki B | ☐ | |
| `enumClassC` | Class C | Mataki C | ☐ | |
| `enumClassD` | Class D — weakest local economy | Mataki D — tattalin arziki mafi rauni | ☐ | |
| `enumMicro` | Micro | Karami sosai | ☐ | |
| `enumConjunctive` | All three limbs together | Dukkan sharudda uku tare | ☐ | |
| `enumTurnoverGoverned` | Turnover governs alone | Kudin shiga kadai ke yanke hukunci | ☐ | |
| `enumNone` | No fixed premises | Babu wurin dindindin | ☐ | |
| `enumStall` | Market stall or table | Rumfa ko tebur a kasuwa | ☐ | |
| `enumKiosk` | Kiosk or container | Kanti ko kwantena | ☐ | |
| `enumLockUpShop` | Lock-up shop | Shago mai kulle | ☐ | |
| `enumBuilding` | Building or yard | Gini ko fili | ☐ | |
| `enumFiled` | Filed | An kai | ☐ | |
| `enumAsserted` | Claimed | An yi ikirari | ☐ | |
| `enumConfirmedByTaxpayer` | Confirmed by the taxpayer | Mai biyan haraji ya tabbatar | ☐ | |
| `enumConsistencyCheck` | Checking an assessment against assets | Duba kimantawa da dukiya | ☐ | |
| `enumCoverageLead` | Looking for people not yet assessed | Neman wadanda ba a kimanta ba tukuna | ☐ | |
| `enumTaxpayerRequest` | The taxpayer asked to see it | Mai biyan haraji ya nemi ganin sa | ☐ | |
| `enumWithdrawn` | Withdrawn | An janye | ☐ | |
| `enumIntegrationAlert` | An outside service is not answering | Wata hidimar waje ba ta amsawa | ☐ | |
| `enumNeverCalled` | Not called yet | Ba a kira ba tukuna | ☐ | |
| `enumDegraded` | A call went unanswered | An yi kira ba a amsa ba | ☐ | |
| `enumDown` | Not answering | Ba ya amsawa | ☐ | |
| `enumApprovalWaiting` | An approval is waiting for you | Amincewa na jiran ka | ☐ | |
| `enumCaseAssigned` | A case was assigned to you | An ba ka wani shari’a | ☐ | |
| `enumCaseEscalated` | A case was escalated to you | An daga shari’a zuwa gare ka | ☐ | |
| `enumCaseMention` | You were named on a case | An ambaci sunanka a shari’a | ☐ | |
| `enumSystemAlert` | Something on the platform has stopped | Wani abu a tsarin ya tsaya | ☐ | |
| `enumInfo` | For information | Don sanarwa | ☐ | |
| `enumWarning` | Worth looking at | Ya cancanci duba | ☐ | |
| `enumClosing` | Being closed | Ana rufewa | ☐ | |
| `enumClean` | Clean | Babu matsala | ☐ | |
| `enumException` | Exception | Matsala | ☐ | |
| `enumNotAvailable` | Could not be examined | Ba a iya duba shi ba | ☐ | |
| `enumRandom` | Random | Bazuwa | ☐ | |
| `enumSystematic` | Every nth | Kowane na n | ☐ | |
| `enumHighestValue` | Largest amounts | Mafi girman kudi | ☐ | |
| `enumDrawn` | Drawn | An zana | ☐ | |
| `enumInReview` | Being examined | Ana duba shi | ☐ | |
| `enumGenerated` | Generated | An samar da shi | ☐ | |
| `enumSigned` | Signed | An sa hannu | ☐ | |
| `enumTransactionAudit` | Transaction audit | Binciken cinikayya | ☐ | |
| `enumAgentActivity` | Agent activity | Ayyukan wakili | ☐ | |
| `enumRevenueCollection` | Revenue collected | Kudin da aka karba | ☐ | |
| `enumLgaPerformance` | Council performance | Aikin karamar hukuma | ☐ | |
| `enumPaymentReconciliation` | Payment reconciliation | Daidaita biyan kudi | ☐ | |
| `enumUserActivity` | Officer activity | Ayyukan jami’i | ☐ | |
| `enumAnomaly` | Anomalies | Abubuwan da ba a saba gani ba | ☐ | |
| `enumAuditSample` | Audit samples | Samfuran bincike | ☐ | |
| `enumRevenueTarget` | Revenue targets | Burin kudin shiga | ☐ | |
| `enumPeriodClosing` | Period closing | Rufe lokaci | ☐ | |
| `enumDataChange` | Record changes | Canje-canjen bayanai | ☐ | |
| `enumSupervisorChange` | Reporting line | Layin rahoto | ☐ | |
| `enumRoleChange` | Role | Matsayi | ☐ | |
| `enumCollection` | Collection | Karbar kudi | ☐ | |
| `enumFinance` | Finance | Kudi | ☐ | |
| `enumAudit` | Audit | Bincike | ☐ | |
| `enumEnforcement` | Enforcement | Aiwatarwa | ☐ | |
| `enumTaxpayerServices` | Taxpayer services | Hidimar masu biyan haraji | ☐ | |
| `enumAdministration` | Administration | Gudanarwa | ☐ | |
| `enumTechnology` | Technology | Fasaha | ☐ | |
| `enumPosting` | Posting | Matsayi | ☐ | |
| `enumDepartment` | Department | Sashe | ☐ | |
| `enumOffice` | Office | Ofishi | ☐ | |
| `enumTerritory` | Territory | Yanki | ☐ | |
| `enumOnce` | Once | Sau daya | ☐ | |
| `enumTwoToThree` | Two or three times | Sau biyu ko uku | ☐ | |
| `enumFourToEleven` | Four to eleven times | Sau hudu zuwa goma sha daya | ☐ | |
| `enumTwelveOrMore` | Twelve times or more | Sau goma sha biyu ko fiye | ☐ | |
| `enumCategory` | Category | Nau’i | ☐ | |
| `enumItem` | Revenue item | Harajin guda | ☐ | |
| `enumLga` | Local Government Area | Karamar hukuma | ☐ | |
| `forecastSeasonal` | Shaped by the collection curve: previous years are used to say what share of a period is usually in by now. | An tsara shi bisa yadda ake tarawa: an yi amfani da shekarun baya don sanin kaso nawa ake tarawa ya zuwa yanzu. | ☐ | |
| `forecastRunRate` | A straight run rate. There is not enough history to know the collection curve, so this is likely to be wrong early and late in the period. | Kai tsaye bisa saurin tarawa. Babu isasshen tarihi don sanin yadda ake tarawa, don haka watakila ba daidai ba ne a farko da karshen lokacin. | ☐ | |
| `forecastTooEarlyInCurve` | Previous years had collected almost nothing by this point, so the curve cannot be used yet. A straight run rate is shown instead. | Shekarun baya kusan ba su tara komai ba ya zuwa yanzu, don haka ba za a iya amfani da yadda ake tarawa ba tukuna. An nuna saurin tarawa kai tsaye. | ☐ | |
| `forecastPeriodComplete` | The period has finished. This is the actual figure, not a projection. | Lokacin ya kare. Wannan shi ne ainihin adadin, ba hasashe ba. | ☐ | |
| `forecastNotStarted` | The period has not started. There is nothing to project from yet. | Lokacin bai fara ba. Babu abin da za a yi hasashe daga gare shi tukuna. | ☐ | |
| `enumSeasonal` | Collection curve | Yadda ake tarawa | ☐ | |
| `enumRunRate` | Run rate | Saurin tarawa | ☐ | |
| `enumInsufficientHistory` | Not enough history | Babu isasshen tarihi | ☐ | |
| `enumAwaitingInformation` | Awaiting information | Ana jiran bayani | ☐ | |
| `enumEscalated` | Escalated | An daukaka | ☐ | |
| `enumInvestigating` | Investigating | Ana bincike | ☐ | |
| `enumAgentConduct` | Agent conduct | Halin wakili | ☐ | |
| `enumCommissionQuery` | Commission query | Tambaya kan kwamishan | ☐ | |
| `enumDataCorrection` | Data correction | Gyaran bayanai | ☐ | |
| `enumFraudInvestigation` | Fraud investigation | Binciken zamba | ☐ | |
| `enumGeneral` | General | Na gama-gari | ☐ | |
| `enumReconciliationException` | Reconciliation exception | Bambancin lissafi | ☐ | |
| `enumRevenueAnomaly` | Revenue anomaly | Rashin daidaito a haraji | ☐ | |
| `enumSystemIssue` | System issue | Matsalar manhaja | ☐ | |
| `enumTaxpayerDispute` | Taxpayer dispute | Takaddamar mai biyan haraji | ☐ | |
| `enumApproval` | Approval | Amincewa | ☐ | |
| `enumFraudFlag` | Risk flag | Alamar hadari | ☐ | |
| `enumManual` | Raised by an officer | Jami’i ya bude | ☐ | |
| `enumSupportTicket` | Support ticket | Takardar taimako | ☐ | |
| `enumAssignment` | Assigned | An ba wa | ☐ | |
| `enumComment` | Comment | Sharhi | ☐ | |
| `enumDueDateChange` | Due date changed | An sauya ranar karshe | ☐ | |
| `enumEscalation` | Escalated | An daukaka | ☐ | |
| `enumEvidence` | Evidence attached | An hada hujja | ☐ | |
| `enumNote` | Internal note | Bayanin cikin gida | ☐ | |
| `enumPriorityChange` | Priority changed | An sauya muhimmanci | ☐ | |
| `enumResolution` | Resolution | Warware | ☐ | |
| `enumRouted` | Routed | An tura | ☐ | |
| `enumStatusChange` | Status changed | An sauya matsayi | ☐ | |
| `agEnTitle` | What the business looks like | Yadda kasuwancin yake | ☐ | |
| `agEnIntro` | Write down what you can see. You are not setting a price — the office works out the band from what you record, and the taxpayer is told by notice. | Ka rubuta abin da kake gani. Ba kai ne kake sanya farashi ba — ofis shi ke fitar da mataki daga abin da ka rubuta, kuma za a sanar da mai biyan haraji da takarda. | ☐ | |
| `agEnWho` | Who | Wane ne | ☐ | |
| `agEnPremises` | Where they trade from | Inda yake kasuwanci | ☐ | |
| `agEnPremisesHint` | What you can see today, not what they say they are building. | Abin da kake gani yau, ba abin da ya ce zai gina ba. | ☐ | |
| `agEnEquipment` | Machines or equipment | Injuna ko kayan aiki | ☐ | |
| `agEnEquipmentHint` | Count what is being used for the business. Write 0 if there is none. | Ka kirga abin da ake amfani da shi don kasuwanci. Ka rubuta 0 idan babu. | ☐ | |
| `agEnPeople` | People working besides the owner | Mutanen da ke aiki banda mai shi | ☐ | |
| `agEnPeopleHint` | Including apprentices and family who work there. Write 0 if the owner works alone. | Har da almajirai da ’yan uwa da ke aiki a wurin. Ka rubuta 0 idan mai shi kadai ke aiki. | ☐ | |
| `agEnSector` | Trade | Sana’a | ☐ | |
| `agEnGroup` | Market association | Kungiyar kasuwa | ☐ | |
| `agEnGroupHint` | If they belong to one, the leader will be asked to confirm what you wrote. | Idan yana cikin daya, za a tambayi shugaba ya tabbatar da abin da ka rubuta. | ☐ | |
| `agEnNoGroupChosen` | Not through an association | Ba ta hannun kungiya ba | ☐ | |
| `agEnNoGroupsTitle` | No association to record this through | Babu kungiyar da za a bi | ☐ | |
| `agEnNoGroups` | None of your groups has been given a part in enumeration yet. Record it anyway — an officer can ask the leader later. | Babu wata kungiyarka da aka ba ta rawa a kidaya har yanzu. Ka rubuta duk da haka — jami’i na iya tambayar shugaba daga baya. | ☐ | |
| `agEnNoAmountTitle` | You are not setting the tax | Ba kai ne kake sanya harajin ba | ☐ | |
| `agEnNoAmount` | There is no amount on this form and there will not be one. If the trader asks what it will cost, tell them the office will send a notice, and that they can object to it. | Babu adadi a wannan takarda kuma ba za a sa ba. Idan mai kasuwanci ya tambaya nawa ne, ka ce masa ofis zai aika da sanarwa, kuma yana da damar kalubalantar ta. | ☐ | |
| `agEnChoose` | Choose | Zaba | ☐ | |
| `agEnSave` | Save what you saw | Ajiye abin da ka gani | ☐ | |
| `agEnSaving` | Saving… | Ana ajiyewa… | ☐ | |
| `agEnRecordedTitle` | Written down | An rubuta | ☐ | |
| `agEnBand` | Size recorded | Girman da aka rubuta | ☐ | |
| `agEnWhatHappensNextTitle` | What happens next | Abin da zai biyo baya | ☐ | |
| `agEnNextWithLeader` | The association leader will be asked to confirm this. Nothing is charged until an officer looks at it. | Za a tambayi shugaban kungiya ya tabbatar da wannan. Ba a caji komai ba sai jami’i ya duba shi. | ☐ | |
| `agEnNextWithoutLeader` | An officer will look at this. Nothing is charged yet, and the taxpayer can object once they receive the notice. | Jami’i zai duba wannan. Ba a caji komai ba tukuna, kuma mai biyan haraji na iya kalubalanta idan ya karbi sanarwa. | ☐ | |
| `agEnBackToTaxpayer` | Back to the taxpayer | Koma ga mai biyan haraji | ☐ | |
| `agEnQueuedTitle` | Held on this phone | Yana kan wannan wayar | ☐ | |
| `agEnQueuedNext` | There is no signal, so this has not reached the office yet. It will be sent on its own when the phone is back online — do not write it down a second time. The office checks the size again when it arrives. | Babu sigina, don haka wannan bai kai ofis ba tukuna. Za a aika da shi da kansa idan wayar ta koma kan layi — kada ka sake rubuta shi. Ofis zai sake duba girman idan ya iso. | ☐ | |
| `agEnBandSoFarTitle` | Size from what you have written | Girma daga abin da ka rubuta | ☐ | |
| `agEnBandSoFar` | This is a {{band}} business on what you have entered. If the trader asks, that is what has been written down. It is not the amount — the office works that out and sends a notice. | Wannan kasuwanci na {{band}} ne bisa abin da ka shigar. Idan mai kasuwanci ya tambaya, wannan shi ne abin da aka rubuta. Ba shi ne adadin kudi ba — ofis zai fitar da shi ya aika da sanarwa. | ☐ | |
| `scanCamera` | Camera | Kyamara | ☐ | |
| `rcpGovernment` | PLATEAU STATE GOVERNMENT | GWAMNATIN JIHAR FILATO | ☐ | |
| `prnNoWritable` | No writable printer service was found on this device. | Ba a samu hanyar bugawa a wannan na’ura ba. | ☐ | |
| `prnNotConnected` | No printer is connected. Connect one first. | Ba a hada da na’urar bugawa ba. Ka hada da daya tukuna. | ☐ | |
| `prnSendFailed` | The printer did not accept the data. Try again. | Na’urar bugawa ba ta karbi bayanan ba. Ka sake gwadawa. | ☐ | |
| `prnDisconnected` | The printer disconnected. | Na’urar bugawa ta katse. | ☐ | |
| `slipTestOk` | PRINTER TEST OK | GWAJIN NA’URAR BUGAWA YA YI | ☐ | |
| `slipWidth` | Width | Fadi | ☐ | |
| `slipStatus` | Status | Matsayi | ☐ | |
| `slipConnected` | Connected (BLE) | An hada (BLE) | ☐ | |
| `slipReady` | Mobile POS Terminal Ready | Na’urar POS a shirye take | ☐ | |
| `rcpThanks` | Thank you for your civic duty | Mun gode da sauke nauyin ku | ☐ | |
| `rcpBureau` | INTERNAL REVENUE SERVICE | HUKUMAR KARBAR HARAJI | ☐ | |
| `rcpPlatform` | Digital Grassroots Platform | Tsarin Karbar Haraji na Dijital | ☐ | |
| `rcpTitle` | OFFICIAL REVENUE RECEIPT | RASIT NA HARAJI NA HUKUMA | ☐ | |
| `rcpDateTime` | Date / Time | Kwanan Wata / Lokaci | ☐ | |
| `rcpReference` | Reference | Lambar Tunani | ☐ | |
| `rcpLga` | LGA | Karamar Hukuma | ☐ | |
| `rcpWard` | Ward | Gunduma | ☐ | |
| `rcpTaxpayer` | Taxpayer | Mai Biyan Haraji | ☐ | |
| `rcpPhone` | Phone | Lambar Waya | ☐ | |
| `rcpItem` | Service | Hidima | ☐ | |
| `rcpCategory` | Category | Rukuni | ☐ | |
| `rcpAgentCode` | Agent ID | Lambar Wakili | ☐ | |
| `rcpAgentName` | Agent Name | Sunan Wakili | ☐ | |
| `rcpScanToVerify` | SCAN TO VERIFY AUTHENTICITY | DUBA DOMIN TANTANCE SAHIHANCI | ☐ | |
| `rcpCheckOffice` | Check this receipt at any | Ka duba wannan rasit a | ☐ | |
| `rcpCheckOfficeCont` | PSIRS office with the code. | kowane ofishin PSIRS. | ☐ | |
| `rcpOffice` | Government Revenue Office | Ofishin Karbar Harajin Gwamnati | ☐ | |
| `rcpVehAdmin` | MOTOR VEHICLE ADMINISTRATION | HUKUMAR KULA DA MOTOCI | ☐ | |
| `rcpVehLicensing` | Vehicle Licensing & Renewal | Lasisi da Sabunta Takardun Mota | ☐ | |
| `rcpVehTitle` | VEHICLE RENEWAL CLEARANCE | TAKARDAR SABUNTA MOTA | ☐ | |
| `rcpVehPlate` | Plate Number | Lambar Mota | ☐ | |
| `rcpVehDoc` | Document Number | Lambar Takarda | ☐ | |
| `rcpVehOwner` | Owner | Mai Mota | ☐ | |
| `rcpVehMakeModel` | Make/Model | Nau’i/Samfuri | ☐ | |
| `rcpVehYear` | Year | Shekara | ☐ | |
| `rcpVehChassis` | Chassis | Lambar Chassis | ☐ | |
| `rcpVehFrom` | Valid From | Yana aiki daga | ☐ | |
| `rcpVehUntil` | Valid Until | Yana aiki har | ☐ | |
| `rcpVehFee` | FEE PAID | KUDIN DA AKA BIYA | ☐ | |
| `rcpVehOfficial` | OFFICIAL DIGITAL CLEARANCE | TAKARDAR HUKUMA TA DIJITAL | ☐ | |
| `rcpVehCheck` | Check the code at PSIRS. | Ka duba lambar a PSIRS. | ☐ | |
| `connOnline` | Online | Akwai hanyar sadarwa | ☐ | |
| `connOnlineDetail` | All services are available. | Duk ayyukan suna aiki. | ☐ | |
| `connLimited` | Poor connection | Hanyar sadarwa mai rauni | ☐ | |
| `connLimitedDetail` | Your connection is weak. Payments may take longer to confirm — do not start a payment twice. | Hanyar sadarwarka tana da rauni. Tabbatar da biyan kudi na iya daukar lokaci — kada ka fara biyan kudi sau biyu. | ☐ | |
| `connOffline` | Offline | Babu hanyar sadarwa | ☐ | |
| `connOfflineDetail` | You can register a taxpayer and write down a business, and both will be sent when you are back online. Payments are not possible while offline. | Za ka iya yin rajistar mai biyan haraji ka kuma rubuta sana’a, za a aika dukansu idan ka dawo kan layi. Ba a iya biyan kudi ba yayin da babu hanyar sadarwa. | ☐ | |
| `scanCameraDenied` | PSIRS does not have permission to use the camera. Allow it in your browser settings, or type the code instead. | PSIRS ba ta da izinin amfani da kyamara. Ka ba da izini a saitin burauzarka, ko ka rubuta lambar. | ☐ | |
| `scanCameraMissing` | No camera was found on this device. Type the code instead. | Ba a samu kyamara a wannan na’ura ba. Maimakon haka ka rubuta lambar. | ☐ | |
| `scanCameraUnsupported` | This browser cannot open the camera. Type the code instead. | Wannan burauzar ba ta iya bude kyamara ba. Maimakon haka ka rubuta lambar. | ☐ | |
| `agStepCodeSentTo` | We sent a code to {{phone}}. It is only for this one action. | Mun aika lamba zuwa {{phone}}. Don wannan aiki daya kadai ne. | ☐ | |
| `statusPaid` | PAID / VERIFIED | AN BIYA / AN TABBATAR | ☐ | |
| `statusPending` | PENDING | ANA JIRA | ☐ | |
| `statusFailed` | FAILED | BA TA YI BA | ☐ | |
| `statusOffline` | OFFLINE | BA HANYAR SADARWA (OFFLINE) | ☐ | |
| `statusOnline` | ONLINE | AKWAI HANYAR SADARWA (ONLINE) | ☐ | |
| `offlineMessage` | You are offline. Saved records will sync when signal returns. | Babu hanyar sadarwa a yanzu. Za a aika bayanan da zaran an samu netiwok. | ☐ | |
| `offlineNotice` | Captured offline. No money has been marked as received until confirmed. | An ajiye a waya. Ba a karbi kudi a tsari ba har sai an tabbatar. | ☐ | |
| `civicDutyThanks` | Thank you for fulfilling your civic duty. | Mun gode da kuka sauke nauyin da ya rataya a wuyanku. | ☐ | |
| `paymentSuccess` | Payment Successful | An Biyar da Kudi Cikin Nasara | ☐ | |
| `nsStepUpRequired` | Confirm this with the one-time code, then try again. | Ka tabbatar da wannan da lambar amfani sau daya, sannan ka sake gwadawa. | ☐ | |
| `nsDeviceNotRegistered` | Open Profile, then "View my application and clearance", to register it. | Ka bude Bayanan Kaina, sannan "Duba nemana da izinina", domin ka yi rajistarta. | ☐ | |
| `nsDeviceRevoked` | A revoked handset cannot be registered again. Register the replacement handset and ask your supervisor to approve it. | Ba za a iya sake yin rajistar na’urar da aka soke ba. Ka yi rajistar na’ura ta maye gurbi ka nemi shugabanka ya amince da ita. | ☐ | |
| `nsDeviceSuspended` | Your supervisor can tell you why, and restore it. | Shugabanka na iya gaya maka dalili, kuma ya mayar da ita. | ☐ | |
| `nsUpdateRequired` | Close and reopen the app to install the latest version. | Ka rufe manhajar ka sake budewa domin shigar da sabuwar siga. | ☐ | |
| `nsUpdateRequiredToEnumerate` | Close and reopen the app to install the latest version. Anything already saved on this phone will still be sent. | Ka rufe manhajar ka sake budewa domin shigar da sabuwar siga. Duk abin da aka riga aka ajiye a wannan waya za a aika shi. | ☐ | |
| `nsTinServiceUnavailable` | Try again in a few minutes. Do NOT register this taxpayer as a new TIN applicant — that would create a second TIN for someone who already has one. | Ka sake gwadawa nan da mintuna kadan. KADA ka yi rajistar wannan mai biyan haraji a matsayin sabon mai neman TIN — hakan zai kirkiri TIN na biyu ga wanda ya riga ya mallaki daya. | ☐ | |
| `nsTinNotFound` | Check the number against the taxpayer’s own document first — a mistyped digit is the usual cause. Only if they have never had a TIN, go back and register them without one; the platform will apply for a new TIN for them. | Da farko ka duba lambar da takardar mai biyan harajin kansa — yawanci kuskuren buga lamba ne sanadi. Sai kawai idan bai taba mallakar TIN ba, ka koma ka yi rajistarsa ba tare da TIN ba; dandalin zai nema masa sabuwar TIN. | ☐ | |
| `nsKycProviderUnavailable` | Try again in a few minutes. Your application is unchanged. | Ka sake gwadawa nan da mintuna kadan. Nemanka bai canza ba. | ☐ | |
| `nsPaymentUnconfirmed` | Open the transaction from your history to see its current status. | Ka bude cinikin daga tarihinka domin ka ga halin da yake ciki yanzu. | ☐ | |
| `nsPaymentFailed` | Start the payment again, or choose a different payment method. | Ka sake fara biyan, ko ka zabi wata hanyar biya. | ☐ | |
| `nsAgentNotCleared` | Open "My Application" to see what is still outstanding. | Ka bude "Nemana" domin ka ga abin da ya rage. | ☐ | |
| `agVehFoundConfirmed` | Vehicle found and confirmed against the vehicle authority record. | An sami motar kuma an tabbatar da ita a rajistar hukumar motoci. | ☐ | |
| `agVehFoundUnconfirmed` | Vehicle found on the platform. It has not been confirmed against the vehicle authority. | An sami motar a dandalin. Ba a tabbatar da ita a hukumar motoci ba tukuna. | ☐ | |
| `agVehRegistryUnavailable` | The vehicle authority could not be reached, so we cannot say whether this vehicle is registered. Try again shortly. If the renewal cannot wait, capture the details manually — the record will be flagged for checking once the authority is back. | Ba a iya tuntubar hukumar motoci ba, don haka ba za mu iya cewa an yi rajistar wannan mota ba. Ka sake gwadawa nan ba da dadewa ba. Idan sabuntawar ba za ta iya jira ba, ka shigar da bayanan da hannu — za a yi wa rajistar alama domin a duba ta idan hukumar ta dawo. | ☐ | |
| `agVehNotFound` | No record of this vehicle was found on the platform or at the vehicle authority. Capture the vehicle details manually — the record will be marked as unverified. | Ba a sami rajistar wannan mota a dandalin ko a hukumar motoci ba. Ka shigar da bayanan motar da hannu — za a yi wa rajistar alama a matsayin wadda ba a tabbatar da ita ba. | ☐ | |
| `agVehFoundAtAuthority` | Vehicle found at the vehicle authority. Confirm the owner before proceeding. | An sami motar a hukumar motoci. Ka tabbatar da mai ita kafin ka ci gaba. | ☐ | |
| `agRefereeRequestSent` | A verification request has been sent to {{name}}. | An aika bukatar tantancewa zuwa ga {{name}}. | ☐ | |
| `agDevicePendingApproval` | Device registered and awaiting approval by your supervisor. | An yi rajistar na’urar kuma tana jiran amincewar shugabanka. | ☐ | |
| `agDeviceSuspended` | This device is registered but suspended. Your supervisor can restore it. | An yi rajistar wannan na’ura amma an dakatar da ita. Shugabanka na iya mayar da ita. | ☐ | |
| `agDeviceActive` | Device registered and active. | An yi rajistar na’urar kuma tana aiki. | ☐ | |
| `agGroupMemberRecorded` | Recorded. The membership counts only once the group leader has confirmed it. | An rubuta. Mambancin zai kirgu ne kawai bayan shugaban kungiyar ya tabbatar da shi. | ☐ | |
| `agSupYou` | You | Kai | ☐ | |
| `collAuthorizedFieldOfficer` | Authorized Field Officer | Jami’in fili mai izini | ☐ | |
| `agStepSendingACode` | Sending a one-time code… | Ana aika lamba ta lokaci daya… | ☐ | |
| `agStepCodeSentToNumber` | We sent a code to your registered number. | Mun aika lamba zuwa lambarka da aka yi rijista. | ☐ | |

### C · The messages PSIRS sends

30 templates, and the highest-stakes strings in the project. A
citizen holds no account here: the SMS is the entire record of the
transaction as far as they are concerned, and nobody is standing beside
them to explain it. Read the acknowledgement wording especially closely —
it has to be unmistakably **not** a receipt.

| Code | Channel | Subject | Body | OK? | Your correction |
|---|---|---|---|:---:|---|
| `COMMISSION_PAYOUT_FAILED_SMS_HA` | SMS | — | PSIRS: Ba a iya tura kwamishan dinka {{reference}} zuwa asusunka ba: {{reason}}. Kudin bai bata ba — ya koma cikin kudin da ake bin ka, kuma za a sake turawa idan an gyara bayanan asusun. Duba bayanan bankinka a cikin manhajar. | ☐ | |
| `COMMISSION_PAYOUT_REFUSED_SMS_HA` | SMS | — | PSIRS: Ba a amince da bukatarka ta biyan kwamishan {{reference}} ba: {{reason}}. Kudin bai bata ba — ya kasance cikin kudin da ake bin ka kuma kana iya sake nema. | ☐ | |
| `AGENT_SUSPENDED_PUSH_HA` | PUSH | An dakatar da kai | Ka daina karbar kudi yanzu. Dalili: {{reason}}. Bude manhajar don ka ga abin da zai biyo baya. | ☐ | |
| `AGENT_APPROVED_PUSH_HA` | PUSH | An amince ka fara karba | An amince da bukatarka. Bude manhajar don ka yi rajistar na’urarka ka fara aiki. | ☐ | |
| `KYC_ACTION_REQUIRED_PUSH_HA` | PUSH | Bukatarka na bukatar wani abu | Tabbatar da shaidarka bai cika ba: {{reason}}. Bude manhajar don ka sake turawa. | ☐ | |
| `COMMISSION_PAID_PUSH_HA` | PUSH | An biya kwamishan | An tura kwamishan dinka {{reference}} zuwa bankinka. | ☐ | |
| `COMMISSION_PAYOUT_FAILED_PUSH_HA` | PUSH | Ba a iya biyan kwamishan ba | {{reason}}. Kudin naka ne har yanzu — duba bayanan bankinka a cikin manhajar. | ☐ | |
| `TIN_CREATED_SMS_HA` | SMS | — | PSIRS: Lambar Shaidar Biyan Haraji taka ita ce {{tin}}. Ka adana ta — za ka bukace ta a duk biyan kudi na gwamnati. | ☐ | |
| `INVOICE_SMS_HA` | SMS | — | PSIRS: An bayar da takardar biya {{reference}} na {{amount}}. Ka biya ta hanyoyin gwamnati da aka amince da su kadai. | ☐ | |
| `PAYMENT_SUCCESS_SMS_HA` | SMS | — | PSIRS: An tabbatar da biyan kudin ka na {{amount}}. Wannan shaidar karba ce {{receiptNumber}} — BA rasit ba ne. Rasit din gwamnati zai zo bayan kudin ya isa asusun gwamnati. Kana iya duba shi a kowane lokaci da wannan lambar. | ☐ | |
| `PAYMENT_SUCCESS_EMAIL_HA` | EMAIL | — | Ranka ya dade {{name}},  An tabbatar da biyan kudin ka na {{amount}} ta tsarin biyan kudi (ma’amala {{reference}}).  Wannan sakon SHAIDAR KARBA ce, lamba {{receiptNumber}}. BA rasit din gwamnati ba ne. Kudin zai isa asusun Gwamnatin Jihar Plateau nan ba da jimawa ba, kuma za a bayar da rasit din ka kai tsaye idan ya isa — za mu tura maka lambarsa.  Kana iya duba wannan shaidar karba a kowane lokaci ba tare da shiga asusu ba.  Hukumar Haraji ta Jihar Plateau | ☐ | |
| `RECEIPT_GENERATED_SMS_HA` | SMS | — | PSIRS: Gwamnati ta karbi biyan kudin ka na {{amount}}. Rasit din ka na gwamnati shi ne {{receiptNumber}} (ma’amala {{reference}}). Kana iya duba shi a kowane lokaci da wannan lambar. | ☐ | |
| `RECEIPT_GENERATED_EMAIL_HA` | EMAIL | — | Ranka ya dade {{name}},  Gwamnatin Jihar Plateau ta karbi biyan kudin ka na {{amount}} (ma’amala {{reference}}).  Lambar rasit din ka ta gwamnati ita ce {{receiptNumber}}. Wannan ya maye gurbin shaidar karba da aka tura maka a baya, kuma shi ne shaidar biyan kudin ka.  Kana iya tabbatar da shi a kowane lokaci ba tare da shiga asusu ba.  Hukumar Haraji ta Jihar Plateau | ☐ | |
| `PAYMENT_FAILED_SMS_HA` | SMS | — | PSIRS: Biyan kudi na {{reference}} bai yi nasara ba. Ba a karbi kudi ba. Kana iya sake gwadawa. | ☐ | |
| `VEHICLE_RENEWAL_SMS_HA` | SMS | — | PSIRS: An sabunta motar {{registration}}, tana aiki har zuwa {{expiry}}. Sauke takardarka daga shafin. | ☐ | |
| `COMMISSION_EARNED_SMS_HA` | SMS | — | PSIRS: Ka samu kwamishan {{amount}} a kan ma’amala {{reference}}. Za a iya biyan sa bayan an sasanta kudin. | ☐ | |
| `COMMISSION_EARNED_PUSH_HA` | PUSH | An rubuta kwamishan | {{amount}} a kan {{reference}}. Za a iya biyan sa bayan an sasanta kudin. | ☐ | |
| `COMMISSION_PAID_SMS_HA` | SMS | — | PSIRS: An biya kwamishan {{amount}} zuwa asusun bankin ka da aka tabbatar. Lamba {{reference}}. | ☐ | |
| `AGENT_APPROVED_SMS_HA` | SMS | — | PSIRS: An amince da bukatarka ta zama wakili. Ka kammala horo ka yi rajistar na’urarka don fara aiki. | ☐ | |
| `AGENT_REJECTED_SMS_HA` | SMS | — | PSIRS: Ba a amince da bukatarka ta zama wakili ba. Dalili: {{reason}} | ☐ | |
| `AGENT_SUSPENDED_SMS_HA` | SMS | — | PSIRS: An dakatar da asusun wakilcin ka. Dalili: {{reason}}. Ka tuntubi shugabanka. | ☐ | |
| `REFEREE_INVITATION_SMS_HA` | SMS | — | PSIRS: {{applicant}} ya sa ka a matsayin mai shaida a kan bukatar zama wakilin karbar haraji ({{reference}}). Ka tabbatar a {{link}} kafin {{expiry}}. | ☐ | |
| `KYC_ACTION_SMS_HA` | SMS | — | PSIRS: Tabbatar da shaidarka na bukatar kulawa. {{reason}}. Bude manhajar don ka sake turawa. | ☐ | |
| `SUPPORT_REPLY_SMS_HA` | SMS | — | PSIRS: An amsa takardar korafinka {{ticketNumber}}. Bude manhajar don ka karanta. | ☐ | |
| `SECURITY_OTP_SMS_HA` | SMS | — | PSIRS: Lambar tabbatarwarka ita ce {{code}}. Za ta kare cikin mintuna {{minutes}}. Kada ka fada wa kowa, hatta ma’aikatan PSIRS. | ☐ | |
| `AGENT_BANK_CHANGE_REQUESTED_SMS_HA` | SMS | — | PSIRS: An nemi a rika biyan kwamishan dinka a {{bank}} {{account}}. Babu abin da ya canza tukuna. Idan ba kai ba ne, ka tuntubi shugabanka yanzu. | ☐ | |
| `AGENT_BANK_CHANGE_APPLIED_SMS_HA` | SMS | — | PSIRS: Yanzu za a rika biyan kwamishan dinka a {{bank}} {{account}}. Idan ba kai ba ne, ka tuntubi shugabanka yanzu. | ☐ | |
| `AGENT_BANK_CHANGE_REFUSED_SMS_HA` | SMS | — | PSIRS: Ba a amince da bukatar canza asusun kwamishan dinka ba. Dalili: {{reason}}. Asusun ka na yanzu bai canza ba. | ☐ | |
| `TAXPAYER_RECORD_CORRECTED_SMS_HA` | SMS | — | PSIRS: An gyara {{fields}} a kan bayananka na mai biyan haraji ta hannun jami’in haraji. Idan ba kai ka nema ba, ka je kowane ofishin PSIRS. | ☐ | |
| `USER_ROLE_CHANGED_SMS_HA` | SMS | — | PSIRS: An canza matsayinka daga {{previousRole}} zuwa {{newRole}}. An fitar da kai, dole ka sake shiga. Idan ba a sa ran haka ba, ka tuntubi mai gudanarwarka yanzu. | ☐ | |

<!-- END:GENERATED -->

## Words this draft chose, and why

| English | Used here | Note |
|---|---|---|
| taxpayer | `mai biyan haraji` | Already used in the existing dictionary. |
| cash (in hand) | `kudi a hannu` | Distinguishes physical cash from payment generally. |
| account | `asusu` | |
| commission | `kwamishan` | The loanword, as used in Nigerian financial speech. `lada` was considered and may be better — please say. |
| receipt | `rasit` | Already used in the existing dictionary. |
| confirm | `tabbatar` | Already used. Consistency matters more than elegance here. |
| device | `na'ura` | |
| Local Government Area | `Karamar Hukuma` | |

---

## After your review

Corrections go into `packages/shared/src/i18n.ts` under `ha`. Two tests guard
them: `hausa-safety-strings.test.tsx` checks the safety tier is genuinely
translated and that the screens read the dictionary rather than holding
English literals, and `hausa-dictionary-consistency.test.tsx` holds the
bookkeeping listed at the top of this document. Both will fail if a correction
drops an agreed word or a negation, which is deliberate — change the test
alongside the translation when the decision itself changes.

If you shorten a tab label, put it in the `nav*` key, not the prose one.

**Reviewed by:** ___________________________  **Date:** ____________

**Is any of this safe to put in front of an agent as it stands?**  ☐ Yes  ☐ No  ☐ With the corrections above
