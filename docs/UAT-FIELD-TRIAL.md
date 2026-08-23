# Field trial with real agents

**Document ID:** PSIRS-UAT-FIELD-2026-V1
**Replaces, for field purposes:** `UAT-PLAN.md`, which is a conference-room
walkthrough against a demonstration build and remains useful as that.

---

## What this document is

A plan for putting the platform in front of people who have not seen it
before, in the places they will actually use it, and finding out what they
cannot do.

It is not a demonstration. A demonstration is run by somebody who knows the
answer, and it tells you the software works for that person. This is a trial:
the observer knows the answer and is forbidden from giving it, and what it
tells you is where the software stops working for everybody else.

### Why the existing plan is not this

`UAT-PLAN.md` lists ten journeys against `localhost:5173`, marks each one
pass or fail, and sets the acceptance standard at "100% pass rate". Every part
of that is wrong for a field trial:

- **`localhost` is not a deployment.** Nothing about network loss, handset
  variety, battery, or sunlight on a screen can be learnt from it.
- **A tick is not a finding.** "J-04 Pass" does not record that the agent took
  eleven minutes, asked twice what a TIN was, and got there in the end.
- **100% is the wrong bar.** A trial that must pass everything is either
  rigged or abandoned at the first surprise. The surprises are the output.

Both documents should exist. Use that one to confirm the features are present;
use this one to find out whether they can be used.

---

## 1. The precondition that gates everything

> **No real citizen may pay real money through this platform until B-4 is
> closed.**

Every external integration — the payment gateway, the TIN service, bank
verification, SMS, document storage — currently runs on a mock adapter. Not one
has exchanged a packet with the provider it will depend on.

The platform's governing principle is that no transaction may appear
successful unless the payment infrastructure has independently confirmed it.
A mock confirms everything. So a trial that took real money would be
manufacturing exactly the outcome the whole design exists to prevent: a
citizen holding a receipt for a payment nothing verified.

This is not a caution to be weighed against schedule. It is the reason the
phases below are ordered as they are, and Phase 2 does not begin early.

---

## 2. Phases

### Phase 0 — Everything that does not move money

**Runs now.** Real agents, real markets, real handsets, real taxpayers who
consent to being registered. No payment is taken and no receipt is issued.

Covers: applying to become an agent, identity capture, referee nomination,
training, device registration, finding a taxpayer, registering a taxpayer,
offline capture and sync, the support desk, and reading one's own commission
record.

This is where most usability defects live, because most of the platform is
not the payment itself.

### Phase 1 — Money, against provider sandboxes

**Requires:** B-4 partially closed — payment gateway and TIN service pointed
at vendor **sandbox** credentials, not production.

Adds: assessment, payment initiation, webhook confirmation, receipt issue,
public verification, vehicle renewal. Money is not real; confirmation is.

The distinction that matters: an agent must be able to tell a payment that
confirmed from one that did not, and must not be able to produce a receipt
for the second. That is testable in sandbox and is the single most important
thing to test there.

### Phase 2 — Live, small, watched

**Requires:** B-4 fully closed, and Phase 1 clean on confirmation behaviour.

Real citizens, real money, one LGA, a cohort small enough that every
transaction can be read by a human the same day. Commission is earned but
**not paid out** until reconciliation has been checked by hand against the
bank statement for the full period.

---

## 3. Who the agents should be

Not the best ones. The trial is worthless if it selects for people who would
have succeeded regardless.

Recruit **twelve to sixteen** for Phase 0, and take deliberately:

| Include | Because |
|---|---|
| At least four who are not comfortable reading English | The app offers Hausa, but see §3.1 — the offer is thinner than it looks, and these agents have a specific job in this trial. |
| At least four using a handset under ₦60,000 | Small screens, slow processors, old browsers. The forms were built on a laptop. |
| At least two who share a phone with a family member | Device binding assumes one person, one handset. Households do not. |
| At least two who have never used a banking app | The clearance pipeline asks for bank details, a one-time code, and a document photograph. |
| At least two working a market with poor coverage | Offline capture is the feature most often described and least often observed. |
| A range of ages, with at least two over fifty | Tap targets, contrast, and the assumption that a "search" box is obvious. |

### 3.1 What the Hausa cohort is actually for

Before the trial starts, a fact worth knowing: **the application is not
bilingual in the way the language toggle implies.** The shared dictionary
holds 43 terms — navigation labels and core civic vocabulary — while the agent
screens contain roughly 277 further pieces of user-visible English: field
hints, refusal messages, empty states, and every sentence explaining why a
button will not work.

So a Hausa-first agent sees Hausa navigation wrapped around an English
interior, and much of what this platform does to be understandable — the
plain-language refusals, the hints under blocked buttons — is in a language
they may not read.

That is a known gap, and measuring it is not what these four agents are for.
Comparing their completion rate against the English cohort would only produce
a number confirming something already established, at the cost of two weeks of
their time.

**Since this was written, the highest-cost tier has been translated.** Twenty-nine
strings — the cash warning, what happened to the money, attribution, receipt
refusals, every reason a wizard step will not continue, and the device gate —
are now in both languages, and the language toggle has been moved onto the
signed-out screens so a Hausa-first applicant can choose Hausa *before* the
sign-in screen and the application form rather than after them. That
translation is **drafted and not yet reviewed by a native speaker**
(`HAUSA-REVIEW.md`); the review must happen before Phase 0 runs, not after.

**The cohort's job is therefore what remains: which of the other ~218 strings
actually block work.**
Not all text matters equally: a hint nobody reads costs nothing untranslated,
while the sentence explaining why a payment was refused costs everything. The
observer records, for each point where the agent stops, *which specific
English sentence they were unable to act on*. That list — ordered by how many
agents it stopped — is the remaining backlog, and it will be far shorter than
218.

Run this cohort in Phase 0 regardless. The alternative is translating the
remaining strings on the assumption they all matter, or translating none.

Recruit two supervisors and one revenue officer as well: the portal side has
had the same amount of real-user exposure as the app, which is none.

---

## 4. How to observe

### The one rule

**The observer does not help.**

Not a hint, not a pointed finger, not "try scrolling". When the agent is
stuck, the observer says: *"Show me what you would do if I were not here."*

If the observer helps, the trial has measured the observer.

The only exceptions: the agent asks to stop; a taxpayer's data or money is
about to be affected wrongly; or the agent has been stuck on one screen for
more than five minutes, at which point the observer records a **blocking
defect**, gives the minimum help needed, and moves on.

### What to record

For every task, four things:

1. **Completed without help?** Yes / No. This is the primary measure.
2. **Time from start to done.** Wall clock. A task that takes four times
   the expected duration is a defect even when it completes.
3. **Every question asked, verbatim.** *"Wetin be TIN?"* is a finding about
   the platform, not about the agent.
4. **Where their finger went first.** If they tapped somewhere before finding
   the right control, that somewhere is where the control belongs.

Record what they say in their own words and language. Do not translate a
complaint into a feature request.

### What counts as a defect

- The agent asks a question the screen should have answered.
- The agent taps something that does nothing, or does something they did not
  expect.
- The agent completes the task by a route nobody designed.
- The agent believes something happened that did not — **this class is the
  most serious and is recorded as blocking regardless of anything else.**
- The agent abandons.

"The agent got there eventually" is not a pass.

---

## 5. The journeys

Each carries the specific thing it is trying to find out. The hypotheses are
not neutral: several are drawn from defects found by reading the code, and the
trial exists partly to check whether the fixes hold for people who did not
write them.

### J-1 · Becoming an agent

Apply, verify identity, nominate a referee, complete training, register a
device.

| Watch for | Because |
|---|---|
| Where they stop in the application form | Twelve fields on a phone, and it asks for bank details before it asks for anything else about the work. |
| Whether the password rule is understood first time | It asks for a letter and a number and now says so before submission. Does the agent read it? |
| What they photograph for identity | A cropped, glared, or wrong-document photograph is the commonest cause of a KYC rejection nobody understands. |
| Whether the rejection reason means anything to them | A refused document tells them why. Does the reason produce a correct second attempt? |
| Who they nominate as referee, and whether that person answers | The link is sent by SMS to somebody with no stake in it. |

### J-2 · Finding a taxpayer

Search for somebody who is registered; then somebody who is not.

| Watch for | Because |
|---|---|
| What they type first | Name, phone, or TIN — the box accepts all three, and which they reach for tells you what to put first in the hint. |
| **What they do when nobody is found** | This screen used to say nothing at all when a search matched nobody. It now offers registration. Does that land? |
| Whether they try to register a duplicate | Duplicate detection blocks at 100 points; a shared phone scores 85 and is allowed. Does an agent understand a near-match warning? |

### J-3 · Registering a taxpayer

The six-step wizard, with a real trader who is standing there.

| Watch for | Because |
|---|---|
| Whether the taxpayer stays for all six steps | The trial's most useful number may be how many people walk away. |
| The TIN question on step 1 | It is pre-answered "No". Does the agent notice, and is it ever wrong? |
| Whether a blocked Continue is understood | Every blocked step now says what it wants. Does the agent read it or tap the dead button repeatedly? |
| What they enter for date of birth when the person does not know | This is common and the field is optional. Do they guess? A guessed birth date is worse than a blank one. |
| Consent | The declaration is a checkbox. Does the agent read it aloud, paraphrase it, or tick it themselves? |

### J-4 · Working offline

Put the handset in aeroplane mode mid-registration, in a market, and continue.

| Watch for | Because |
|---|---|
| Whether they notice they are offline | There is an indicator. Indicators are not read. |
| Whether they trust the draft was saved | A record they do not believe in gets captured twice on paper. |
| What they do when it syncs | Confirmation arrives later, elsewhere. Do they ever see it? |
| Whether they take money while offline | **They must not.** No payment may be taken against an unsynced registration. If any agent tries, that is a blocking finding about the training and the interface both. |

### J-5 · Taking a payment *(Phase 1 onward)*

| Watch for | Because |
|---|---|
| Whether the taxpayer is attributed before anything else | "Every payment must be attributed" — and the vehicle renewal used to require typing a 36-character identifier, which no agent could do. |
| What the agent tells the taxpayer while waiting for confirmation | The gap between initiating and confirming is where cash gets taken informally. |
| **What they do when confirmation does not arrive** | The single most important observation in the trial. The correct behaviour is to take nothing and tell the taxpayer to wait. |
| Whether they can explain the receipt | If the agent cannot say what makes it genuine, the taxpayer cannot either. |

### J-6 · Being refused

Deliberately induce refusals: an unregistered device, a suspended account, an
expired step-up code, a payment that fails.

| Watch for | Because |
|---|---|
| Whether the message tells them what to do next | Every refusal in the platform is supposed to. This is where that claim is tested. |
| Whether they can recover unaided | A refusal that ends the day's work is a defect. |
| Whether they blame themselves, the app, or PSIRS | Tells you what the message actually communicated. |

### J-7 · Getting paid

Read the commission record; request a payout; wait the 72-hour hold.

| Watch for | Because |
|---|---|
| Whether they understand why commission is not yet payable | The hold is 72 hours after settlement. This is the thing agents will ring about. |
| Whether "owed back" is understood | Commission on a reversed transaction is deducted from the next payout. |
| What they do about a wrong bank account | The change flow needs a one-time code, the bank's confirmation and an officer's approval, and their existing account keeps being used meanwhile. Do they believe nothing has changed yet? |

### J-8 · The officer side

Supervisors and the revenue officer, in their own office, on their own
machines.

| Watch for | Because |
|---|---|
| Whether they can find the queue that is theirs | Five roles see five different menus. |
| Whether a decision reason is written or padded | Every decision demands ten characters. Ten characters of "asdfghjkln" is worse than none, because it looks like a record. |
| Whether they understand what a bank change is asking them to approve | The name the bank returned is the evidence. Do they compare it to the name the agent gave? |
| Whether they notice a refusal | Money-releasing actions used to fail silently. They now report. |

---

## 6. What "acceptable" means

Not a pass rate. Thresholds, by class:

| Measure | Threshold | If missed |
|---|---|---|
| Agents completing J-1 unaided | ≥ 70% | Redesign the application form before proceeding. |
| Agents completing J-3 unaided, second attempt | ≥ 90% | The wizard is not learnable; fix before Phase 1. |
| Agents who believe something happened that did not | **0** | Blocking. No phase advances until it is zero. |
| Agents taking money offline or before confirmation | **0** | Blocking, in the interface and the training both. |
| Median J-3 duration | ≤ 6 minutes | A trader will not stand for longer. |
| Untranslated strings that stopped a Hausa-first agent | Listed and ranked, not a rate | See §3.1. The output is a translation backlog, not a pass mark. |
| Officer decisions with a meaningful reason | ≥ 95% on reading | The audit trail is decorative otherwise. |

Two of those are zero-tolerance. They are the two that correspond to the
platform's inviolable rules, and no amount of good usability elsewhere buys a
tolerance for them.

---

## 6.1 What the dry run already settled

Before the cohort is recruited, the Phase 0 journeys were walked against a
database built from nothing — migrations, seed, and a browser at handset size.
The point is not that the software passed. It is that an observer's day is
expensive, and none of it should be spent discovering something a dry run
would have caught.

Settled, and not worth an observer's attention unless an agent contradicts it:

- **J-1.** The form is twelve fields in three named sections. The password
  rule is printed under the field before the button is reached, and a password
  that breaks it is refused at the field with the same rule restated. The bank
  section explains, where it is asked, that the account is for commission only
  and never for government revenue. On submission the applicant gets an
  application number and the four things that happen next; signing in as an
  uncleared applicant shows all nine clearance stages, names what is still
  outstanding, and offers no way to collect.
- **J-4.** Offline capture saves, says so in words that name what has *not*
  happened ("no payment can be taken until it is sent"), and shows a running
  count of unsent records. The Collect screen withdraws its search box
  entirely while offline and explains why in terms of the confirmation rule.
  An unsynced taxpayer cannot be selected for collection. On reconnection the
  queue empties and says how many went.
- **J-6.** An unregistered handset, a suspended account and a missing
  step-up code are each refused with a specific reason and a next step. A
  revoked device loses its session outright.
- **J-7.** The commission screen separates available from pending from paid,
  states that the record is not a bank account, and explains the wait as
  settlement plus a hold rather than naming it.

Two defects were found and fixed in the process, both worth knowing because
they shape what to watch:

- `POST /drafts/sync` exempted itself from the handset check, so going offline
  first was a way around a device binding every other agent write enforced,
  and the resulting audit entry named no device. Both halves fixed. **Watch
  for:** any agent who works from a handset that is not theirs.
- Closing that gate exposed the app catching every sync failure the same way
  and retrying silently, which left a refused queue sitting at "waiting to
  send" with the reason known only to the server. Refusals are now shown with
  their next step. **Watch for:** whether an agent reads that alert or keeps
  waiting.

What the dry run **cannot** settle is everything the trial is actually for:
whether any of this is understood by somebody who did not write it, how long
it takes, what people do when they are hurried, and what they say to the
taxpayer in the gap. One operator who knows the answer proves nothing about
sixteen who do not.

---

## 7. Running it

**Duration:** two weeks per phase, minimum. One week measures novelty.

**Sessions:** one observer to one agent. Never a group — agents help each
other, and that is exactly the signal being destroyed.

**Kit:** the agent's own handset wherever possible. A supplied handset tests a
handset nobody owns.

**Data:** real taxpayers with recorded consent. Phase 0 registrations are real
records and must be treated as such — they are not test data and must not be
deleted afterwards, because deletion is what the audit design forbids.

**Daily:** every observer's notes typed up the same day. A note recalled a
week later is a summary.

**Weekly:** read the notes together and rank by *how many agents hit it*, not
by how bad it looked. One agent baffled by a thing eleven others found obvious
is a training note. Four agents hitting the same wall is a defect.

**Fixes during the trial:** allowed and encouraged for blocking defects, but
record the build every session ran against. A trial whose software changed
silently underneath it cannot be read afterwards.

---

## 8. What this trial cannot establish

State these in the report rather than letting the sign-off imply them.

- **That the integrations work.** Sandbox behaviour is not production
  behaviour, and until Phase 2 has run at volume the providers remain
  unproven under real conditions.
- **That it scales.** Sixteen agents in one LGA says nothing about four
  thousand across seventeen.
- **That reconciliation is correct.** Correctness is established by comparing
  against bank statements over a full settlement period, not by watching
  people use screens.
- **That it is secure.** Usability testing is not penetration testing.
- **That the incentive design is fair.** Whether a compliance score should
  gate fertiliser is a policy question that no amount of user testing
  answers.
- **That agents will not collude.** A trial with an observer present measures
  behaviour under observation.
- **That the platform works in Hausa.** It establishes which untranslated
  strings block work. Whether the platform is usable by a Hausa-first agent
  can only be answered after the backlog from §3.1 has been translated and
  those agents have been observed again.

---

## 9. Sign-off

The trial produces a report, not a tick. The report carries:

- the thresholds above, met or missed, with numbers;
- every blocking defect, its status, and the build it was fixed in;
- the verbatim questions agents asked, unedited;
- what was not tested, from section 8, restated plainly;
- a recommendation to proceed, proceed with conditions, or not proceed.

Signed by the people who ran it, before it reaches the people who commissioned
it:

- **Field trial lead:** ___________________________ Date: ____________
- **Observer (agents):** ___________________________ Date: ____________
- **Observer (officers):** ___________________________ Date: ____________
- **PSIRS Director of Grassroots Revenue:** ___________________________ Date: ____________
