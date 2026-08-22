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

## Conventions used

The existing dictionary avoids hooked letters (`ɗ`, `ƙ`) and writes `kudi`
rather than `kuɗi`, because agents type on phone keyboards without them. New
strings follow that. **If you disagree, say so — it is a decision, not an
accident, and it can be changed.**

Numbers, receipt codes and the example phone number are left as they are.
They are read off a screen and typed.

---

## The strings

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

Corrections go into `packages/shared/src/i18n.ts` under `ha`. A test
(`hausa-safety-strings.test.tsx`) checks that each key exists, is not a copy
of the English, and keeps the shared vocabulary — it will fail if a
correction drops one of those words, which is deliberate. Adjust the test with
the translation if the vocabulary decision changes.

**Reviewed by:** ___________________________  **Date:** ____________

**Is any of this safe to put in front of an agent as it stands?**  ☐ Yes  ☐ No  ☐ With the corrections above
