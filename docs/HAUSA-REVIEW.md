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

## What has changed since this sheet was first written

It listed 78 strings. It now lists **1,549 dictionary strings and 30 message
templates**, because the app it describes went from six translated screens to
all of them, because the officer portal behind it was translated too, and
because the SMS, email and push messages PSIRS sends are now sent in the
language the recipient reads rather than always in English.

Two things follow, and both matter to how you spend your time.

**The tables are generated now.** `node scripts/build-hausa-review.mjs` rebuilds
them from `packages/shared/src/i18n.ts` and from the migration that inserts the
templates, and `npm run verify` runs it with `--check`. A sheet that lists 78 of
1,549 strings is worse than no sheet, because it looks complete; this one cannot
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

- All 1,549 keys exist in both languages; nothing is missing and nothing is spare.
- No Hausa string is a copy of its English (one exception, `navProfile`, is
  named below and is waiting on you).
- **Every English string containing a negative has a Hausa negation** —
  `ba`, `kada`, `babu`, `bai` or `banda`. This is a crude proxy and it cannot
  tell you whether the negative is attached to the right verb. It only
  guarantees that none of them vanished entirely. Question 2 is still yours.
- The glossary below is applied consistently across all 1,549 strings: where the
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
| `verifyNotAReceiptCode` | That QR code is not a PSIRS receipt code. Keep the receipt in frame. | Wannan QR code ba lambar rasit ta PSIRS ba ce. Ka rike rasit a cikin firam. | ☐ | |
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

### B · The rest of the dictionary, by screen

1483 strings, grouped by where an agent meets them. Lower stakes
than table A — these are labels, headings and status words rather than
instructions — but they are what an agent reads all day.

#### The officer portal — navigation

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
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

#### The officer portal — menu headings

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
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

#### The officer portal — agent clearance

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
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

#### The officer portal — identity documents

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
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

#### The officer portal — the minimum app version

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
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

#### The officer portal — officer access

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
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

#### The officer portal — settlement and commission

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
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

#### The officer portal — fraud and the audit trail

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcOvTransactionCount` | {{n}} transaction(s) | Ma’amaloli {{n}} | ☐ | |
| `ofcOvSettlementsOutstanding` | {{n}} settlement(s) outstanding | Turawar kudi {{n}} da ta rage | ☐ | |
| `ofcOvIntact` | Audit trail intact | Rajistar bincike ba ta lalace ba | ☐ | |
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

#### The officer portal — the revenue catalogue

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
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

#### The officer portal — correcting a record

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
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

#### The officer portal — product usage

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
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

#### The officer portal — groups and distributions

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcGpConfirmationLinkFor` | Confirmation link for {{group}} | Hanyar tabbatarwa ta {{group}} | ☐ | |
| `ofcGpLeaderCodeOnce` | Send this to the group leader. It is shown once — PSIRS stores only a hash of it, so it cannot be read back later. Request another if it is lost. | Ka tura wannan ga shugaban kungiyar. Ana nuna shi sau daya — PSIRS na adana sa hannunsa kawai, don haka ba za a iya sake karanta shi ba. Ka nemi wani idan ya bata. | ☐ | |
| `ofcGpWaitingDecision` | Waiting for a decision | Ana jiran shawara | ☐ | |
| `ofcGpWaitingIntro` | An agent has recorded these groups in the field. Members cannot be added until a group is approved, so nothing else happens while they sit here. | Wakili ya rubuta wadannan kungiyoyi a filin aiki. Ba za a iya kara mambobi ba sai an amince da kungiya, don haka babu abin da ke faruwa yayin da suke nan. | ☐ | |
| `ofcGpDistributions` | Distributions | Rabo | ☐ | |
| `ofcGpDistributionsIntro` | Fertiliser, seed and other allocations with a fixed quantity behind them. Open one to see who has been awarded and who has actually collected. | Taki, iri da sauran rabon da ke da adadi tsayayye a bayansu. Ka bude daya don ganin wanda aka ba da wanda ya karba a hakika. | ☐ | |
| `ofcGpRegisteredGroups` | Registered groups | Kungiyoyin da aka yi wa rajista | ☐ | |
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

#### The officer portal — levies

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
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

#### The officer portal — distribution rounds

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
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

#### The officer portal — agent performance

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcPfFlagIsQuestion` | A flag is a question, not a finding. Their figures are shown here unchanged — | Alama tambaya ce, ba hukunci ba. An nuna adadinsu a nan ba tare da canji ba — | ☐ | |
| `ofcPfAgentsWithFlag` | {{n}} agent(s) with an open fraud flag | Wakilai {{n}} da ke da alamar zamba a bude | ☐ | |
| `ofcPfIntro` | Collections, reach and trouble side by side. An agent in a commercial ward will out-collect the best agent in a rural one, so read the columns together rather than sorting by naira. | Karba, isa da matsala gefe da gefe. Wakili a unguwar kasuwanci zai fi karbar mafi kyawun wakili a unguwar karkara, don haka ka karanta ginshikan tare maimakon jera su da naira. | ☐ | |
| `ofcPfCollectedByAgents` | Collected by agents | Abin da wakilai suka karba | ☐ | |
| `ofcPfTaxpayersOnboarded` | Taxpayers onboarded | Masu biyan haraji da aka shigar | ☐ | |
| `ofcPfAgentsWorked` | Agents who worked | Wakilan da suka yi aiki | ☐ | |
| `ofcPfOpenFraudFlags` | Open fraud flags | Alamun zamba a bude | ☐ | |
| `ofcPfCollected` | Collected | An karba | ☐ | |
| `ofcPfAverage` | Average | Matsakaici | ☐ | |
| `ofcPfOnboarded` | Onboarded | An shigar | ☐ | |
| `ofcPfTins` | TINs | TIN | ☐ | |
| `ofcPfRenewals` | Renewals | Sabuntawa | ☐ | |
| `ofcPfFailed` | Failed | Ya gaza | ☐ | |
| `ofcPfReversed` | Reversed | An juyar | ☐ | |
| `ofcPfFlags` | Flags | Alamu | ☐ | |
| `ofcPfDaysWorked` | Days worked | Kwanakin aiki | ☐ | |

#### The officer portal — transactions

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcTxReceipt` | Receipt | Rasit | ☐ | |
| `ofcTxCreated` | Created | An kirkira | ☐ | |

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

#### The officer portal — everything else

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `ofcAllStatuses` | All statuses | Dukkan matsayi | ☐ | |
| `ofcAllLgas` | All LGAs | Dukkan Kananan Hukumomi | ☐ | |
| `ofcFrom` | From | Daga | ☐ | |
| `ofcTo` | To | Zuwa | ☐ | |
| `ofcExportCsv` | Export CSV | Fitar da CSV | ☐ | |
| `ofcDownloadCsv` | Download CSV | Sauke CSV | ☐ | |
| `ofcNothingToShow` | Nothing to show. | Babu abin da za a nuna. | ☐ | |
| `ofcRevenueAdministration` | Revenue administration | Gudanar da haraji | ☐ | |
| `ofcDistributionRound` | Distribution round | Zagayen rabo | ☐ | |
| `ofcLanguage` | Language | Harshe | ☐ | |
| `ofcPortalName` | PSIRS Portal | Shafin PSIRS | ☐ | |
| `ofcStateGovernment` | Plateau State Government | Gwamnatin Jihar Filato | ☐ | |
| `ofcReturnToDashboard` | Return to the dashboard | Koma allon aiki | ☐ | |
| `ofcSignOut` | Sign out | Fita | ☐ | |
| `ofcPageNotFound` | That page does not exist. | Wannan shafin babu shi. | ☐ | |
| `ofcReadOnly` | read-only | karatu kawai | ☐ | |
| `ofcDailyTrend` | Daily collection trend | Yanayin karban kudi na kullum | ☐ | |
| `ofcNoDataForPeriod` | No data for this period. | Babu bayanai na wannan lokacin. | ☐ | |

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
| `tpViewProfile` | View profile | Duba bayanai | ☐ | |
| `tpPossibleExisting` | Possible existing taxpayer | Mai biyan haraji da watakila yana nan | ☐ | |
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
| `verifyTypeCode` | Or type the receipt code | Ko rubuta lambar rasit | ☐ | |
| `verifyOffline` | You are offline | Ba ka da intanet | ☐ | |

#### Reporting a problem

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
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
| `stepUpCodeFailed` | Could not send a code. | Ba a iya tura lamba ba. | ☐ | |
| `stepUpAuthoriseFailed` | Could not authorise this. | Ba a iya bada izinin wannan ba. | ☐ | |
| `stepUpNoSms` | No real SMS is configured, so the code is shown here: | Ba a saita SMS na gaske ba, don haka an nuna lambar a nan: | ☐ | |
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
| `camAlign` | Align QR code or barcode inside frame | Ka daidaita QR code ko barcode cikin firam | ☐ | |
| `camCancel` | Cancel | Soke | ☐ | |
| `camClose` | Close scanner | Rufe na’urar dubawa | ☐ | |
| `camFlip` | Flip camera | Juya kyamara | ☐ | |
| `camInitializing` | Initializing camera... | Ana shirya kyamara... | ☐ | |
| `camTryAgain` | Try again | Sake gwadawa | ☐ | |
| `camFlashOn` | Flash: ON | Fitila: A KUNNE | ☐ | |
| `camFlashOff` | Flash: OFF | Fitila: A KASHE | ☐ | |
| `camNoAccess` | Could not access the device camera. | Ba a iya samun kyamarar na’ura ba. | ☐ | |
| `camSwitchFailed` | The camera could not be switched. | Ba a iya canza kyamara ba. | ☐ | |

#### What the platform says when it refuses

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `errRateLimited` | Too many attempts. Wait a moment and try again. | Yunkuri sun yi yawa. Ka dan jira sannan ka sake gwadawa. | ☐ | |
| `errReference` | Reference | Lamba | ☐ | |

#### Shared controls

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
| `uiLoading` | Loading | Ana lodi | ☐ | |

#### The pages a citizen reads without an account

| Key | English | Hausa (draft) | OK? | Your correction |
|---|---|---|:---:|---|
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
| `pubRefereeIntro` | has applied to become an authorised revenue agent. PSIRS needs someone who knows them to confirm their identity and suitability. | ya nemi ya zama wakilin karbar haraji da izini. PSIRS na bukatar wanda ya san shi don tabbatar da ko wanene shi da cancantarsa. | ☐ | |
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
| `pubCitizenByTin` | Tax Identification Number (TIN) | Lambar Shaidar Haraji (TIN) | ☐ | |
| `pubCitizenByPhone` | Registered phone number | Lambar wayar da aka yi rijista | ☐ | |
| `pubCitizenByName` | Full name or business name | Cikakken suna ko sunan kasuwanci | ☐ | |
| `pubCitizenTooMany` | Use your TIN or exact phone number for a precise result. | Yi amfani da TIN dinka ko ainihin lambar wayarka don sakamako madaidaici. | ☐ | |
| `pubCitizenStatusHeading` | Tax compliance status | Matsayin bin ka’idar haraji | ☐ | |
| `pubCitizenCompliant` | Compliant | Ya bi ka’ida | ☐ | |
| `pubCitizenArrears` | Has arrears | Yana da bashin haraji | ☐ | |
| `pubCitizenAttention` | Needs attention | Yana bukatar kulawa | ☐ | |
| `pubCitizenNotAssessed` | Not yet assessed | Ba a kimanta ba tukuna | ☐ | |
| `pubCitizenTinStatus` | TIN status | Matsayin TIN | ☐ | |
| `pubCitizenOutstanding` | Outstanding obligations | Harajin da ake bin ka | ☐ | |
| `pubCitizenOutstandingYes` | Yes — please contact PSIRS | Eh — da fatan za ka tuntubi PSIRS | ☐ | |
| `pubCitizenNone` | None | Babu | ☐ | |
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
| `noTaxPayable` | No tax is payable | Babu harajin da za a biya | ☐ | |
| `noTaxPayableBody` | This taxpayer owes nothing on the amount declared. Do not increase it to make a payment go through — there is nothing to collect. | Wannan mai biyan haraji ba shi da abin biya a kan adadin da aka shigar. Kada ka kara adadin domin a sami biyan kudi — babu abin karba. | ☐ | |
| `paymentAcknowledged` | Payment confirmed — receipt to follow | An tabbatar da biyan kudin — rasit zai biyo baya | ☐ | |
| `paymentAcknowledgedBody` | The payment system has confirmed this payment. Government has not yet received the money, so this is an acknowledgement and NOT a receipt. The receipt is issued automatically once the money reaches the government account. Do not ask the taxpayer to pay again. | Naʻurar biyan kudi ta tabbatar da wannan biyan. Gwamnati ba ta riga ta karbi kudin ba, don haka wannan shaidar karbar kudi ce, BA rasit ba. Za a fitar da rasit ta atomatik da zarar kudin ya isa asusun gwamnati. Kada ka ce wa mai biyan haraji ya sake biya. | ☐ | |
| `acknowledgementLabel` | Acknowledgement | Shaidar karbar kudi | ☐ | |
| `searchAnotherArea` | A name search covers your own Local Government Area. If they are registered elsewhere, search by their phone number, TIN, vehicle registration or a receipt number. | Binciken suna yana rufe Karamar Hukumar da kake aiki a ciki kadai. Idan an yi masa rajista a wata Karamar Hukuma, ka nemo shi da lambar wayarsa, TIN, lambar mota ko lambar rasit. | ☐ | |
| `languageForMessages` | Language for their messages | Harshen sakonnin sa | ☐ | |
| `languageForMessagesHint` | Ask the taxpayer. Their receipt arrives by SMS and it is the only copy they will have. | Ka tambayi mai biyan haraji. Rasit dinsa yana zuwa ta SMS, kuma shi ne kwafin da zai samu kadai. | ☐ | |
| `scanCamera` | Camera | Kyamara | ☐ | |
| `statusPaid` | PAID / VERIFIED | AN BIYA / AN TABBATAR | ☐ | |
| `statusPending` | PENDING | ANA JIRA | ☐ | |
| `statusFailed` | FAILED | BA TA YI BA | ☐ | |
| `statusOffline` | OFFLINE | BA HANYAR SADARWA (OFFLINE) | ☐ | |
| `statusOnline` | ONLINE | AKWAI HANYAR SADARWA (ONLINE) | ☐ | |
| `offlineMessage` | You are offline. Saved records will sync when signal returns. | Babu hanyar sadarwa a yanzu. Za a aika bayanan da zaran an samu netiwok. | ☐ | |
| `offlineNotice` | Captured offline. No money has been marked as received until confirmed. | An ajiye a waya. Ba a karbi kudi a tsari ba har sai an tabbatar. | ☐ | |
| `scanHelp` | Align the receipt QR code or vehicle license inside the frame. | Sanya lambar QR ta rasit din a tsakiyar akwatin. | ☐ | |
| `civicDutyThanks` | Thank you for fulfilling your civic duty. | Mun gode da kuka sauke nauyin da ya rataya a wuyanku. | ☐ | |
| `paymentSuccess` | Payment Successful | An Biyar da Kudi Cikin Nasara | ☐ | |

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
