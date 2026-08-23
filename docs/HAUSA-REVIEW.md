# Hausa review sheet

**For a native Hausa speaker to check, before any of this reaches an agent.**

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

## What a machine has already checked, so you need not

A consistency pass runs in the test suite
(`hausa-dictionary-consistency.test.tsx`) and currently holds. None of it is a
judgement about the Hausa — it is bookkeeping, and it is listed here only so
you do not spend your attention repeating it:

- All 72 keys exist in both languages; nothing is missing and nothing is spare.
- No Hausa string is a copy of its English (one exception, `navProfile`, is
  named below and is waiting on you).
- **Every English string containing a negative has a Hausa negation** —
  `ba`, `kada`, `babu`, `bai` or `banda`. This is a crude proxy and it cannot
  tell you whether the negative is attached to the right verb. It only
  guarantees that none of them vanished entirely. Question 2 is still yours.
- The glossary below is applied consistently across all 72 strings: where the
  English says *taxpayer*, the Hausa says *mai biyan haraji*, and so on for
  receipt, confirm, device, account, commission and cash.
- No hooked letters; no `kuɗi`; apostrophes written one way throughout.
- Example phone numbers and receipt codes survive translation intact.

What no machine can check is whether a Hausa speaker takes the same
instruction from these that an English speaker takes from the left-hand
column. That is questions 1, 2 and 3, and it is the whole reason this
document exists.

---

## A second reading, which is still not yours

A second language model read all 78 pairs cold, without the drafting context
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
| `scanHelp` | The English says "the receipt QR code **or vehicle license**". The Hausa names only the receipt. Half the instruction is missing, and an agent scanning a vehicle licence is told this screen does not do that. |
| `statusOffline` / `offlineMessage` | `BA HANYAR SADARWA` in one, `Babu hanyar sadarwa` in the other, for the same thing. |
| `statusFailed` / `paymentFailed` | `BA TA YI BA` treats the subject as feminine; `bai yi nasara ba` treats it as masculine. Same subject, two agreements. |
| `needDeclaration` / `enablePush` | `sanarwa` does duty for both the *declaration* a taxpayer accepts and a push *notification*. One word, two unrelated things. |
| `receiptCodeShape` | Calls `T7C72-QTUDN` a `lambar rasit`, but `lambar rasit` is already the receipt **number** (`receiptNumber`) and the verification **code** is `lambar tabbatarwa` (`verificationCode`). If this string means the verification code, it points the agent at the wrong field. |

`Mungode` → `Mun gode` in `civicDutyThanks` was a plain word-separation typo
and has been corrected already. It is the only change made without you.

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

## Conventions used

The existing dictionary avoids hooked letters (`ɗ`, `ƙ`) and writes `kudi`
rather than `kuɗi`, because agents type on phone keyboards without them. New
strings follow that. **If you disagree, say so — it is a decision, not an
accident, and it can be changed.**

Numbers, receipt codes and the example phone number are left as they are.
They are read off a screen and typed.

---

## The strings

Two tables. **A** is the tier where being wrong costs somebody money — read
these first, and if your time runs out, stop after them. **B** is everything
else in the dictionary; it has never been put to a native speaker at all.

### A · The safety tier

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
| `receiptCodeShape` | A receipt code looks like T7C72-QTUDN. Check the code and try again. | Lambar rasit tana kama da T7C72-QTUDN. Ka duba lambar ka sake gwadawa. | ☐ | |
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


### B · The rest of the dictionary

Never reviewed by a Hausa speaker. Lower stakes than table A — these are
labels, headings and status words rather than instructions — but they are what
an agent reads all day, and the tab-bar question above lives in here.

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `appName` | PSIRS Revenue Platform | Hukumar Haraji ta Jihar Filato (PSIRS) | ☐ | |
| `appTagline` | Plateau State Digital Grassroots Revenue & Taxpayer Services | Tsarin Karbar Haraji da Hidimar Masu Biyan Haraji a Jihar Filato | ☐ | |
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
| `scanQr` | Scan QR / Barcode | Duba Lambar QR | ☐ | |
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
| `verificationCode` | Verification Code | Lambar Tabbatarwa | ☐ | |
| `paymentMode` | Payment Mode | Hanyar Biyan Kudi | ☐ | |
| `navHome` | Home | Gida | ☐ | |
| `navTaxpayers` | Taxpayers | Masu Biyan Haraji | ☐ | |
| `navCollect` | Collect | Karbi Haraji | ☐ | |
| `navReceipts` | Receipts | Takardun Rasit | ☐ | |
| `navCommission` | Commission | Kwamishan | ☐ | |
| `navProfile` | Profile | Profile | ☐ | |
| `statusPaid` | PAID / VERIFIED | AN BIYA / AN TABBATAR | ☐ | |
| `statusPending` | PENDING | ANA JIRA | ☐ | |
| `statusFailed` | FAILED | BA TA YI BA | ☐ | |
| `statusOffline` | OFFLINE | BA HANYAR SADARWA (OFFLINE) | ☐ | |
| `statusOnline` | ONLINE | AKWAI HANYAR SADARWA (ONLINE) | ☐ | |
| `offlineMessage` | You are offline. Saved records will sync when signal returns. | Babu hanyar sadarwa a yanzu. Za a aika bayanan da zaran an samu netiwok. | ☐ | |
| `offlineNotice` | Captured offline. No money has been marked as received until confirmed. | An ajiye a waya. Ba a karbi kudi a tsari ba har sai an tabbatar. | ☐ | |
| `scanHelp` | Align the receipt QR code or vehicle license inside the frame. | Sanya lambar QR ta rasit din a tsakiyar akwatin. | ☐ | |
| `civicDutyThanks` | Thank you for fulfilling your civic duty. | Mungode da kuka sauke nauyin da ya rataya a wuyanku. | ☐ | |
| `paymentSuccess` | Payment Successful | An Biyar da Kudi Cikin Nasara | ☐ | |

---

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
