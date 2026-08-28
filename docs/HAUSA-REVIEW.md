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

It listed 78 strings. It now lists **749 dictionary strings and 30 message
templates**, because the app it describes went from six translated screens to
all of them, and because the SMS, email and push messages PSIRS sends are now
sent in the language the recipient reads rather than always in English.

Two things follow, and both matter to how you spend your time.

**The tables are generated now.** `node scripts/build-hausa-review.mjs` rebuilds
them from `packages/shared/src/i18n.ts` and from the migration that inserts the
templates. A sheet that lists 78 of 749 strings is worse than no sheet, because
it looks complete; this one cannot fall behind without somebody noticing.

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

- All 749 keys exist in both languages; nothing is missing and nothing is spare.
- No Hausa string is a copy of its English (one exception, `navProfile`, is
  named below and is waiting on you).
- **Every English string containing a negative has a Hausa negation** —
  `ba`, `kada`, `babu`, `bai` or `banda`. This is a crude proxy and it cannot
  tell you whether the negative is attached to the right verb. It only
  guarantees that none of them vanished entirely. Question 2 is still yours.
- The glossary below is applied consistently across all 749 strings: where the
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

683 strings, grouped by where an agent meets them. Lower stakes
than table A — these are labels, headings and status words rather than
instructions — but they are what an agent reads all day.

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
