# Hausa review: everything still waiting on a decision

`HAUSA-REVIEW.md` carries all 3,031 dictionary strings, and most of its length
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

**332 strings address the reader as `ka`: masculine singular.** A woman
collecting revenue in Bokkos is addressed as a man by the application she uses
all day.

The options are `ki`, the impersonal subjunctive (`A duba…`), or the polite
plural `ku`, which is gender-neutral. This is a decision about who PSIRS
believes it is talking to, and no translator can make it.

**It is not only about agents.** The review sheet framed this as a question
about field staff. Counting says otherwise:

| Who reads it | Strings |
|---|---|
| The agent app | 179 |
| The officer portal | 111 |
| Citizens, referees and group leaders | 42 |
| **Total** | **332** of 3,031 |

So a female revenue officer in Jos is addressed as a man by her own portal, and
so is a woman looking up her own tax status with no account at all. `ku`, the
polite plural, is the only one of the three options that is both
gender-neutral and unremarkable to address a stranger with — which may matter
more for the 42 than for the 179.

The forms are `ka` (337 occurrences), the possessive `-nka` (56), `-rka` (44),
`dinka` (6), `maka` (6), `naka` (5) and `kanka` (2); many strings carry more
than one. Nothing currently uses `ku`.

**Two earlier figures in this document were wrong, and the second was worse.**
It said 216. That over-counted by treating `kai` as the pronoun — all 49 of its
uses here are something else (`Kimanta kai`, self-assessment; `kai tsaye`,
directly; `ya kai`, reached; `hadin kai`, cooperation) — and under-counted by
missing `dinka`, `kanka` and `maka`. Correcting those gave 222, which was still
wrong: the pattern was case-sensitive, and Hausa imperatives open sentences
constantly. `Ka nemo…`, `Ka tabbatar…`, `Ka yi…` — **144 occurrences across 103
further strings** were invisible. 321 was the number after both corrections;
it moved to 320 when deleting the dead camera-scanner path took `camAlign`
(“Ka daidaita QR code…”) with it, to 323 when the three camera-refusal
strings below were written in the same convention as everything around them, to
328 with the eleven strings the `lib/` lint pass brought in, to 330 with
the receipt template, and to 332 with the printer's own messages.

### What it would cost to change

`scripts/ka-address-preview.mjs` answers that from the dictionary rather than
from anyone's estimate:

```
node scripts/ka-address-preview.mjs            # the scale
node scripts/ka-address-preview.mjs --write ku # the sheet to correct
```

**326 of the 332 are a mechanical substitution. 6 need a human. None defeats
the rules.** So this is a scripted pass and a review, not a re-translation —
which is worth knowing before the size of the number decides the answer.

`docs/HAUSA-ADDRESS-KU.md` and `docs/HAUSA-ADDRESS-KI.md` are that sheet, one
per option: every string, its English, its Hausa now, and what the rules would
make of it. **They are machine output and not translations.** A program that
does not speak Hausa applied a substitution table; two rows of that table are
flagged for confirmation, because `maka` → `muku` is suppletive rather than
suffixal and `kanka` is a reflexive whose plural reading may not be the one
wanted. Verb agreement beyond the pronoun is not attempted at all. Correct the
sheet freely — the corrections are what would be applied, not the generated
text.

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
| ~~`scanHelp`~~ | **Fixed, by deletion.** No screen ever showed it, and the English half the Hausa was missing was not true — see below. |
| `statusOffline` / `offlineMessage` | `BA HANYAR SADARWA` in one, `Babu hanyar sadarwa` in the other, for the same thing. |
| `statusFailed` / `paymentFailed` | `BA TA YI BA` treats the subject as feminine; `bai yi nasara ba` treats it as masculine. Same subject, two agreements. |
| `needDeclaration` / `enablePush` | `sanarwa` does duty for both the *declaration* a taxpayer accepts and a push *notification*. One word, two unrelated things. |
| ~~`receiptCodeShape`~~ | **Fixed.** It was five strings and English caused it — see below. One word left to confirm. |

One further item in this group, `Mungode` → `Mun gode`, was a word-separation
typo and has been corrected.

Five changes have now been made without you, all named below rather than
buried:

1. the `Mungode` typo — a word split back in two;
2. the receipt-code terminology — five strings, reusing `tantancewa`, which the
   dictionary already used for this exact object;
3. `scanHelp` deleted — no screen showed it and its English was false;
4. the dead camera scanner deleted, taking ten strings only it used;
5. **three new strings written** — `scanCameraDenied`, `scanCameraMissing`,
   `scanCameraUnsupported`;
6. **eleven more written**, after the same check was pointed at the rest of the
   application's non-screen code and found the same fault in four more places
   — see 3.1 below;
7. **thirty-three more written** for the printed receipt, which was hardcoded
   English and is the one document a citizen keeps — see 3.2.

Only the last two invent anything, and it is the arrangement rather than the
vocabulary: every word in them is already in the dictionary. They are the items
on this list that add to your reading rather than subtracting from it, and both
are set out in full below. Everything else on this page still waits.

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

**`scanHelp` is done too, and it was English again — twice over.**

The reading was that the Hausa dropped half the instruction: English said
"Align the receipt QR code **or vehicle license** inside the frame", the Hausa
said only *Sanya lambar QR ta rasit din a tsakiyar akwatin*. The obvious repair
is to add the licence clause to the Hausa. Both halves of that turned out to be
wrong.

*The English is not true.* Both camera screens — `Collection.tsx` and
`Verify.tsx` — pass what the camera reads to `verificationCodeFrom()`, which
accepts a five-and-five verification code or a URL ending in one, and nothing
else. Point either screen at a vehicle licence and it returns null. Adding
`ko lasisin mota` to the Hausa would have translated a false claim into a
second language, which is the same mistake the receipt-code work above had just
finished undoing.

*And no screen showed the string at all.* `scanHelp` was referenced nowhere
outside the dictionary and this sheet. It arrived in one commit alongside
`CameraScannerModal.tsx`, whose own comment mentions "vehicle plate codes" and
which was never wired into a screen. The two live scanners carry their own
hints — `allocScanHint` on the collection screen, `verifyOfflineBody` on
verification — and those are accurate.

So the string was deleted rather than translated. **Nothing to review here, and
nothing to decide** — it is recorded because a reported defect that quietly
disappears is worse than one that is explained. If PSIRS does want licence
scanning, that is a feature request against the scanner, and the help text
follows it rather than the other way round.

**The dead scanner it came from is gone now, and took ten more strings.**

`CameraScannerModal.tsx` and `lib/camera-scanner.ts` have been deleted, with
the trailing block of CSS that only they used. Nothing imported either file.
Their scanner also could not have worked where it mattered: the "Canvas-based
QR extraction fallback" its own header advertises, for browsers without the
native `BarcodeDetector`, draws the video frame to a canvas and returns null.
It decodes nothing. Had it ever been wired up, an agent on iOS would have got a
running camera, a flat battery and no scan, with no error shown. The live
scanner loads a real decoder.

Ten strings existed only for that screen and went with it: `camAlign`,
`camClose`, `camFlashOff`, `camFlashOn`, `camFlip`, `camInitializing`,
`camNoAccess`, `camSwitchFailed`, `camTryAgain` and `scanQr`. If you have
already reviewed any of them, that work is not lost — it is in the dictionary's
history — but they are out of the sheet, and the total fell from 2,985 to
3,031. `camCancel` stays; seven live screens use it.

**One thing this turned up was a real gap, and it is now closed — with three
strings that need your reading.** When the camera could not be opened on the
*live* scanner, `Collection.tsx` and `Verify.tsx` rendered `caught.message`
straight from `scanner.ts`, and those three messages were English literals in
the source:

> "PSIRS does not have permission to use the camera. Allow it in your browser
> settings, or type the code printed under the QR square."

Worse than untranslated: both screens already held a translated string for this
—`allocCameraFailed` and `verifyCameraFailed` — and the English one *won*. The
Hausa was the fallback, reached only when the failure was something other than
the three that actually happen. So an agent who declined the camera permission
was answered in English by an application that has offered Hausa since it was
built, and nothing failed, because an English sentence in an error's `message`
looks exactly like a working one.

The three refusals now have their own strings, and they are **new drafts
nobody has read**:

| Key | English | Hausa |
|---|---|---|
| `scanCameraDenied` | PSIRS does not have permission to use the camera. Allow it in your browser settings, or type the code instead. | PSIRS ba ta da izinin amfani da kyamara. Ka ba da izini a saitin burauzarka, ko ka rubuta lambar. |
| `scanCameraMissing` | No camera was found on this device. Type the code instead. | Ba a samu kyamara a wannan na’ura ba. Maimakon haka ka rubuta lambar. |
| `scanCameraUnsupported` | This browser cannot open the camera. Type the code instead. | Wannan burauzar ba ta iya bude kyamara ba. Maimakon haka ka rubuta lambar. |

**Nothing here is invented vocabulary.** `burauza` is what the dictionary
already calls a browser, in `ofcAcSessionsHint` and `moreNoWebBluetooth`;
`izini` is permission, as in `ofcAgClear` and `enumRevoked`; `saiti` is a
setting; *Maimakon haka ka rubuta lambar* is lifted whole from
`allocCameraFailed`. What is new is the arrangement, and that is what needs a
reading.

Two things worth your eye in particular. The English dropped "printed under the
QR square", because the collection screen's code is not printed under one — the
same over-specific claim `scanHelp` was deleted for. And all three are written
with `ka`, like everything around them, which is why the count in question 1
moved: if you choose `ku`, these change with the rest rather than needing a
separate decision.

### 3.1 — The same fault in four more places, and eleven more strings

`scanHelp` and the camera messages were both found by reading. The obvious next
question was whether the check that is supposed to catch this had simply never
looked, and it had not: `nothing-new-in-english.test.tsx` read every screen and
component and no other code. The camera messages lived in `lib/scanner.ts`,
which is neither.

Pointing it at `lib/` found the identical fault — an English sentence winning
over a translated one sitting beside it — in four more places:

| Where | What an agent read | What was there all along |
|---|---|---|
| `device.ts` | the connection banner, in English | nothing; it held the sentences itself |
| `push.ts` | `err.message`, in English | `t.morePushFailed` |
| `step-up.ts` | `caught.message`, in English | `t.stepUpCodeFailed` |
| `api.ts` | a thrown English sentence | nothing |

**The one worth your eye is the connection banner**, because of what it says.
On a weak connection an agent was told, in English: *"Your connection is weak.
Payments may take longer to confirm — do not start a payment twice."* That is
an instruction about not taking somebody's money twice, and it was unreadable
to an agent working in Hausa.

The eleven new strings, all drafts nobody has read:

| Key | English | Hausa |
|---|---|---|
| `connOnline` | Online | Akwai hanyar sadarwa |
| `connOnlineDetail` | All services are available. | Duk ayyukan suna aiki. |
| `connLimited` | Poor connection | Hanyar sadarwa mai rauni |
| `connLimitedDetail` | Your connection is weak. Payments may take longer to confirm — do not start a payment twice. | Hanyar sadarwarka tana da rauni. Tabbatar da biyan kudi na iya daukar lokaci — kada ka fara biyan kudi sau biyu. |
| `connOffline` | Offline | Babu hanyar sadarwa |
| `connOfflineDetail` | You can register a taxpayer and write down a business, and both will be sent when you are back online. Payments are not possible while offline. | Za ka iya yin rajistar mai biyan haraji ka kuma rubuta sana’a, za a aika dukansu idan ka dawo kan layi. Ba a iya biyan kudi ba yayin da babu hanyar sadarwa. |
| `appRecordsWaiting` | saved records waiting to send | bayanan da aka ajiye suna jiran aikawa |
| `stepUpSignInAgain` | Sign in again to request a code. | Ka sake shiga don neman lamba. |
| `morePushUnsupported` | Push notifications are not supported on this device or browser. | Wannan na’ura ko burauza ba ta goyon bayan sanarwar turawa ba. |
| `errUploadFailed` | The document could not be sent. Try again. | Ba a iya aika takardar ba. Ka sake gwadawa. |
| `errUploadOffline` | You are offline. An identity document is sent to PSIRS as it is captured and is not stored on this device — take the photograph again when you have a connection. | Babu hanyar sadarwa. Ana aika takardar shaida zuwa PSIRS yayin daukarta, ba a ajiye ta a wannan na’ura ba — ka sake daukar hoton idan ka samu hanyar sadarwa. |

`connOnline` and `connOffline` are close to `statusOnline` and `statusOffline`,
which already exist and are already on this page for a casing inconsistency.
**They were not merged**, because the existing pair is upper case and reads as
a badge, these read as a heading, and deciding they are one thing is your call
rather than ours. If they are the same thing, say so and it becomes one pair.

**The printer's own messages are done too, and nothing is left in English.**
The twelve strings in `lib/bluetooth-printer.ts` were listed as debt while
`escpos.ts` replaced every non-ASCII byte with a question mark — translating
them first would have printed `na?ura`. The encoder folds now, so they are
translated: six ways a printer can refuse, and the test slip an agent prints to
check it works. **Nine more new strings**, in table B under `prn` and `slip`.

Two of them reuse what was already here — `moreNoWebBluetooth` and
`morePrinterConnectFailed`, which existed and were losing to English literals
in exactly the way the camera strings were.

**The slip is in the agent's language, not the taxpayer's**, unlike the receipt
above. It is a diagnostic somebody prints to find out whether their own printer
works, and no citizen ever sees it. That distinction is the one thing here
worth disagreeing with if you read it differently.

The list of strings excused from the dictionary is now empty.

### 3.2 — The receipt itself, and whose language it is in

The printed receipt was hardcoded English — every label, every heading, the
footer. It is the **only document a citizen keeps**: a taxpayer holds no
account here, so the paper and an SMS are the whole record as far as they are
concerned.

**The rule was already decided, and the receipt was the one place ignoring it.**
Migration 047 gave `taxpayers` a `preferred_language`, set by the agent
standing in front of them at registration, because "a receipt they cannot read
is a receipt they cannot check". The message queue has honoured it since. The
printed slip did not — and worse, two of its fields were being filled from the
*agent's* dictionary, so a Hausa-reading agent printed a Hausa job title onto
an English-reading citizen's receipt while every label around it stayed
English. It was in nobody's language in particular. It now prints in the
taxpayer's, English when the record does not say.

**Thirty-three new strings**, in table B under the `rcp` prefix — the revenue
receipt and the vehicle renewal clearance. Five existing keys were reused
rather than duplicated: `receiptNumber`, `totalPaid`, `paymentMode`,
`verificationCode` and `civicDutyThanks`. Three of those were on the list of
keys nothing referenced; they existed for this receipt and had never been
wired to it.

**Two things there are worth your eye.**

`TIN:` is deliberately left in English. It is the acronym in both languages,
and the dictionary's long form — `Lambar Shaida ta Haraji (TIN)` — is thirty
of a 58mm receipt's thirty-two columns, which would push every TIN onto a line
of its own to say nothing more.

And **the paper is thirty-two columns wide**, which makes some of this a
question of length rather than of wording. Hausa runs longer: `Jimlar Kudin da
Aka Biya` against `Total Paid`. A line past the width is cut by the printer
silently, so a test now measures every line of both receipts in both languages
— and it caught a real one on the way in, where reusing the screen's
`civicDutyThanks` (41 characters in English, 53 in Hausa) for the footer would
have been trimmed mid-sentence on paper. It became `rcpThanks`, sized for the
roll. If any correction you make runs long, that test will say so rather than
the receipt.

**And `scanHelp` was not the only dead string in this table.** Checking it
raised the obvious next question, so it was measured: **33 of the 3,031 keys
are never named anywhere outside the dictionary**, and four of them are in the
table above — `statusOffline`, `offlineMessage`, `statusFailed`, and
`civicDutyThanks`, the one the `Mungode` typo was in. Three of the four
remaining rows in this section therefore concern at least one string no screen
currently displays.

That is not a reason to delete them and it changes none of the Hausa: a string
can be unused because a screen is still coming. It is a reason to spend your
attention on the rows that reach somebody first — `needDeclaration` /
`enablePush` and `paymentFailed` are all live. The 33 need a pass to sort the
planned from the abandoned, and that is a code question rather than a
translation one; it is not being asked of you here.

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
