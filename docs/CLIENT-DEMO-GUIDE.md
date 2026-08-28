# Demonstrating the platform to a client

A script for showing the Plateau State grassroots revenue platform to people who
will decide whether to fund, adopt or sign off on it: PSIRS management, local
government chairmen, a ministry committee, a donor.

It assumes nothing about the audience's technical background and it does not ask
you to explain any. Everything below is a thing to do on screen, followed by the
sentence that says why it matters.

Read it once before the room. Twenty-five minutes of demonstration, ten minutes
of questions, and about fifteen minutes of setup beforehand.

---

## Before the room

### Ten minutes before, on the laptop you will project

```bash
scripts/uat/stack.sh up
```

Wait for the sign-in block to print. That command recreates the demonstration
database, starts all three applications and fills them with a day's work.
Everything it creates is created by calling the same endpoints the real
applications call, so nothing you are about to show is a mock-up.

Then open four browser tabs and leave them signed out:

| Tab | Address | Who |
|---|---|---|
| 1 | `http://localhost:5173/?device=uat-agent-device-000001` | The agent's phone app — **narrow the window to phone width**. The `?device=` part matters; see below |
| 2 | `http://localhost:5174` | The officer portal |
| 3 | `http://localhost:5174/#/verify` | Public verification — the citizen's view |
| 4 | `http://localhost:5174/#/citizen` | Citizen self-service |

Sign-in details, all on the demonstration database only:

| Role | Phone | Password |
|---|---|---|
| Field agent | `+2347010000001` | `FieldAgent2026` |
| Admin officer | `+2348000000001` | `Password123` |
| Revenue officer | `+2348000000002` | `Password123` |
| Finance officer | `+2348000000003` | `Password123` |
| Agent supervisor | `+2348000000004` | `Password123` |
| State auditor | `+2348000000005` | `Password123` |
| Finance officer (second) | `+2348000000006` | `Password123` |

The second finance officer exists because several of the money controls need
two. It is only needed in the optional part of Act 3.

### Why the agent app needs `?device=`

Open tab 1 without it and the app will refuse the moment you try to collect:

> *This device is not registered to your agent account. Register it before
> collecting revenue.*

That is the platform working correctly, and it is worth understanding before
somebody in the room asks.

An agent's **first** handset is approved automatically, so onboarding can
finish. Every handset after that starts PENDING and waits for a supervisor —
because revoking a stolen phone would be worth nothing if the thief could
register another one and carry on collecting. The seeded agent already has a
handset, since the seed had to register one to build the demonstration data
through the real API. Your browser therefore arrives as that agent's *second*
handset, and is refused.

`?device=uat-agent-device-000001` tells the app to present the handset the seed
already registered and approved. It is not a way past any check: the server
still requires that handset to be approved against the signed-in agent's own
account. Production builds ignore the parameter entirely.

**If somebody asks whether you just disabled a control**, the honest answer is
no, and the proof is the next paragraph.

### Optional: show the block on purpose (2 minutes)

Worth doing if the room includes an auditor. Open a **private window** at
`http://localhost:5173` with no `?device=`, sign in as the field agent, and try
to collect.

> A cleared, active, trusted agent, signed in with the right password — and the
> platform will not let them take a naira, because this handset is not the one
> government approved. Losing your phone does not lose your clearance, and
> finding somebody's phone does not gain you theirs.

Then, in **tab 2** as the admin officer, open **Agents & clearance**, find the
agent, and approve the pending handset. Reload the private window and it
collects. That is the whole replacement-handset path, and it takes about ninety
seconds.

### Two codes to have written down

The seed prints them at the end of `stack.sh up`, under **"To demonstrate public
verification"**. You do not need a database client, and you should not open one
in front of an audience. They change on every seed, so take them from the run in
front of you:

```
To demonstrate public verification, at http://localhost:5174/#/verify
  receipt          3WCDM-EAF4M  (PSIRS/2026/000010)
                   answers VALID - a genuine government receipt
  acknowledgement  79TKP-MGCJY  (PSIRS-ACK/2026/000008)
                   answers VALID - NOT A RECEIPT, money not yet received
  anything else    answers NOT FOUND
```

The acknowledgement belongs to the one collection the seed deliberately leaves
awaiting its bank credit, which is why it is still an acknowledgement and not a
receipt. Those two codes answering differently is Act 5, and it is the part of
the demonstration the room can check for itself.

### The one sentence to open with

> Every naira this platform says the government collected, the government can
> prove it received. That is the whole design, and everything I am about to show
> you is a consequence of it.

---

## Act 1 · The agent cannot invent money (4 minutes)

**Tab 1.** Sign in as the field agent. The first screen is the money bar:
collected today, transactions, commission earned, taxpayers registered.

**Do:** tap **Collect**, search for `Rifkatu`, pick her, choose *Shops and
Kiosks Rates*.

**Point at the amount.** ₦3,000.00, with the calculation shown underneath.

> The agent did not type that. There is no field to type it in. The price comes
> from the government's own rate catalogue, and the version of the rate that was
> in force today is stamped onto the assessment. When the State raises a rate
> next year, nothing already collected moves.

**Say what this stops.** The commonest leakage in grassroots collection is not
theft of banked money — it is an agent quoting ₦5,000, banking ₦3,000 and
pocketing the difference. There is nowhere in this app to do that.

**Do:** tap **Confirm and proceed to payment**.

**Point at the banner:** *"Payment not yet confirmed. This payment has NOT been
marked as received. Do not ask the taxpayer to pay again."*

> The agent has asked for money and nothing has confirmed it arrived. The app
> refuses to say collected. It is deliberately blunt, because the wrong thing for
> an agent to do at that moment is collect a second time from someone who has
> already paid.

---

## Act 2 · What the citizen gets, and what it says (5 minutes)

This is the act that distinguishes this platform. Spend the time.

**Do:** tap **Simulate success** — the demonstration gateway standing in for
Remita — then **Check payment status**. (In production there is no such button:
the gateway calls the platform, and this stands in for that call.)

**Point at what appears:** a blue banner, *Payment confirmed — receipt to
follow*, an acknowledgement number beginning `PSIRS-ACK`, and the status
**RECONCILIATION PENDING**.

Now say the thing the room is not expecting:

> This is not a receipt, and it says so on its face.
>
> The payment gateway has confirmed the payment. That means the *gateway* holds
> the money. It reaches the Plateau State Government account in a batch, usually
> a day or two later. Those are two different facts, and most systems treat them
> as one — they print a government receipt the moment the gateway says yes.
>
> If that batch never lands — a gateway failure, a disputed settlement, a credit
> that goes missing — that system has issued a government receipt for money the
> government does not have. And it has no way to find out, because it already
> called the transaction finished.

**Then:** the taxpayer is not left with nothing. They have a numbered, verifiable
document confirming their payment, which is what an agent needs to show someone
standing at a market stall who has just been debited.

> Nobody is asked to trust anybody here. The citizen gets evidence immediately.
> The government's own word that it holds the money comes later, when it is true.

---

## Act 3 · The finance officer, and the moment the receipt is earned (5 minutes)

**Tab 2.** Sign in as the **finance officer**. Open **Reconciliation**.

**Point at the four figures across the top:** total expected, total received,
variance, and **awaiting settlement**.

> Awaiting settlement is money the gateway has confirmed and the government has
> not been paid. The collection I just took is in that figure.

**Point at the table below it,** *Awaiting settlement from the gateway*.

> This is not an error queue. Nobody has to do anything with these. It is normal
> for a day or two, and the screen says so. Anything older than three days moves
> into the exception queue underneath, because by then the money should have
> arrived and somebody needs to find it.

**Point at the empty exception queue**, then at *Settlements to government
accounts* — one reconciled settlement, ₦44,225 expected, ₦44,225 received.

**Now the sentence that ties the whole demonstration together:**

> Recording that bank credit is what issues the receipts. Not the agent tapping
> anything. Not the gateway. A finance officer matching a real credit in a
> government account against the collections it covers. Until that happens there
> is no receipt in this system, for anybody, by any route.

**If asked to prove it:** the refusal is in the database itself, not in the
application. A developer with full database credentials still cannot insert a
receipt for an unsettled payment — the database rejects it. Same for vehicle
particulars.

### Now do it live

The **Record a settlement** form on this screen is what a finance officer fills
in each morning from the bank statement. Use it on the collection from Act 2, so
the room watches the receipt being earned rather than being told about it.

Back on **tab 1**, the agent's transaction screen shows a **Gateway reference**
in the detail list — something like `MOCKGW-845DC4F367C041CE`. Copy it.

Then, on the finance screen:

| Field | What to enter |
|---|---|
| Value date | leave as today |
| Bank reference | anything, e.g. `ZENITH-2026-08-27-01` — in real use, the credit's reference on the statement |
| Credited (₦) | `3000.00` — the exact amount of that collection |
| Gateway references | paste the reference you copied |

Press **Record settlement**.

> That is a finance officer saying: this credit landed in the government account,
> and it covers this collection. The platform adds the collections up itself; if
> my figure had not matched, none of it would settle.

### The short-payment case, if the room is sceptical

Do this on a **different** collection — the one the seed deliberately left
awaiting settlement, `Bukuru Cold Room Enterprises`, ₦5,000 — and not on the one
you are about to settle correctly.

Enter its gateway reference with a credit of `4000.00`.

**Point at the result:** the settlement is recorded as **DISPUTED**, and the
figures beside it say `0 collection(s) settled`.

> A thousand naira short. Nothing in that batch is settled, no receipt is
> issued, and no commission on it becomes payable. The platform does not split
> the difference, does not settle the part it can and does not quietly write off
> the shortfall.

**Now try to fix it yourself.** Press **Close dispute** on that row.

> Refused: *"You recorded this settlement, so another officer has to be the one
> to close it."* Closing a dispute releases the commission on every collection in
> the batch, so the person who recorded the credit cannot also be the person who
> declares it resolved.

Sign in as the **second finance officer** (`+2348000000006`) in a private window,
open Reconciliation, press **Close dispute** on the same row, and give the full
₦5,000, a bank reference and a note explaining the variance.

> Two people, a real credit, and a written reason. Now it settles, and now there
> is a receipt.

This is worth ninety seconds of a demonstration. It is the control most revenue
platforms do not have, and the one an auditor in the room will ask about.

**One thing to know before you try it:** a gateway reference that is already in a
settlement — disputed or not — cannot be put into a second one. The platform
refuses it by name, because recording the same money twice is how a set of books
comes to show revenue that was never collected. Closing the dispute is the way
forward, not re-recording it.

**Point at the note under the settlements table:**

> A settlement whose credit does not match the collections it covers settles
> none of them. If the bank pays ₦900,000 against ₦1,000,000 of confirmed
> collections, nothing in that batch is marked settled, no receipts are issued,
> and no agent commission on it becomes payable. It is raised as a dispute for a
> human to resolve. The platform never splits the difference.

---

## Act 4 · Back to the agent: the receipt appears (2 minutes)

**Tab 1.** Refresh the agent's screen on the same collection.

**Point at:** *Payment Successful · ₦3,000.00 · Receipt PSIRS/2026/…*, status
**SETTLED**, and a **Download receipt** button.

> Same transaction, same screen, thirty seconds later. The government now has
> the money, so now there is a government receipt. The agent did nothing to make
> that happen and could not have. It followed the bank credit.

**Open the PDF** if there is a projector worth using: the receipt carries the
taxpayer, the revenue item, the amount, the LGA and a verification code.

**Mention the printer** if the audience is operational: the app prints to a
Bluetooth thermal printer, and shares by SMS or WhatsApp for agents without one.

---

## Act 5 · Anyone can check, with no account (3 minutes)

**Tab 3.** `#/verify`. Type the **receipt** code you wrote down.

> Big green tick. VALID. A genuine government receipt, the revenue type, the
> amount, the LGA. No account, no app, no sign-in — a market trader can do this
> on any phone.

Now type the **acknowledgement** code.

**Point at the verdict:** *VALID — NOT A RECEIPT*.

> The document is genuine, and the platform will not let it pass for a receipt
> even to somebody who only looks at the tick. It says the payment is confirmed,
> the government has not yet received the money, and the receipt follows.

**Then:** try a made-up number.

> NOT FOUND. If somebody is handed a forged receipt, one lookup on any phone
> settles it.

**Tab 4.** `#/citizen` — a taxpayer looking up their own status without an
account.

---

## Act 6 · The oversight side, briefly (4 minutes)

Do not walk every screen. Pick three.

**Still as the finance officer**, or switch to the **auditor**:

1. **Audit log** *(auditor)* — every action, who did it, when, against which
   record. Hash-chained: each entry seals the one before it, so a changed or
   deleted entry breaks the chain and the platform can say exactly where.

   > Nothing here can be edited. Nothing can be deleted. Not by an officer, not
   > by an administrator, not by a database administrator.

2. **Agents & clearance** *(admin)* — six clearance axes per agent: identity,
   referee, training, bank account, device, government approval.

   > An agent cannot collect a naira until all six are green. That is not a rule
   > in the app that somebody could bypass; the database refuses to mark an agent
   > active without them.

3. **Fraud & leakage** *(any oversight role)* — the rules that watch for
   collection patterns that do not look like honest work.

**If the room is a revenue authority rather than a finance one**, swap item 3
for **Levies & categories**. It answers the three questions a revenue officer
actually asks, and it asks them about a *levy* rather than about a person:

- what a category or a single levy has brought in, and how much of that the
  State's account actually holds yet;
- who is registered under it, filtered to an LGA or to only those with
  something unpaid;
- who is behind on it, largest debt first, with the oldest due date.

One filter bar drives all three, so choosing "Development Levy" once answers
all of them at once.

> The point to make: every other revenue platform can tell you what one person
> owes. Ask this one who owes on the shop rate in Jos North and it answers
> without you knowing a single name first — which is the direction enforcement
> actually works in.

**Revenue catalogue** *(admin)* pairs with it. A new bye-law is added from the
screen: name it, file it under a category, then set its rate as a separate,
reason-required, step-up-protected decision. The item is created with no price
and the screen says so, because a levy with no rate cannot be charged in the
field.

**Close on the roles:** the sidebar is different for every officer because the
menu is built from what that person is permitted to do. An auditor sees
everything and can change nothing. A supervisor sees their own agents. There is
no screen anyone is offered that the system will then refuse them.

---

## The five questions clients ask, and what to say

**"Why can't the receipt be instant? Nobody else does this."**

> They can be instant, and that is exactly the problem — instant receipts are
> receipts for money the government does not yet hold. The citizen gets instant
> evidence either way. The difference is that the government's own record only
> claims what it can prove. If PSIRS would rather issue on gateway confirmation,
> it is a configuration decision and we can discuss what it costs you.

**"What happens when the network is down at the market?"**

> The agent app works offline. It captures the taxpayer, the assessment and the
> collection on the handset and syncs when signal returns. The money bar shows
> what is still unsynced. Nothing is marked received until the platform can
> confirm it.

**"Can an agent be paid commission on money that never arrived?"**

> No, and this is the same rule read backwards. Commission becomes payable when
> the transaction settles — when the money is in a government account — not when
> the gateway confirms. A short-paid batch settles nothing and pays nobody.

**"How do we know an agent is real?"**

> Six clearance steps, each verified by a different party: an identity check, a
> referee who is contacted independently and answers on their own device,
> training completed, a bank account in their own name, a specific handset
> registered to them, and a government officer's approval. Losing the handset
> does not lose the clearance; the officer re-approves a new one in one screen.

**"Is this actually built, or is this a prototype?"**

> Built. Every screen you have seen is the real application talking to the real
> API against a real PostgreSQL database. The financial rules are enforced by the
> database, not by the interface. There are 1,280 automated tests covering the
> API, and the whole walkthrough you just watched is itself an automated test
> suite that photographs every screen — `docs/UAT-WALKTHROUGH.md` and the 115
> screenshots beside it.

---

## If something goes wrong mid-demo

| Symptom | What to do |
|---|---|
| A screen is blank or spinning | Refresh. The API restarts in seconds; nothing is lost |
| Sign-in refused | Rate limiter, after many rapid attempts. Wait 20 seconds |
| The seed data looks wrong | `scripts/uat/stack.sh up` again — about 90 seconds, and it recreates everything |
| A port is in use | `scripts/uat/stack.sh down`, then `up` |
| Logs | `/tmp/psirs-uat/` |

Do not troubleshoot in front of the room. Move to the next act and come back.

---

## What to leave behind

- `docs/UAT-WALKTHROUGH.md` — how to run all of this themselves, with the 115
  screenshots
- `docs/ARCHITECTURE.md` — how it is put together
- `docs/SECURITY.md` — the controls, and what each one is protecting against
- `docs/SOP-FINANCE-RECONCILIATION.md` — the finance officer's daily procedure
- `docs/SOP-AGENT-LIFECYCLE.md` — recruiting, clearing and removing an agent

And the sentence to close on, which is the one you opened with:

> Every naira this platform says the government collected, the government can
> prove it received.
