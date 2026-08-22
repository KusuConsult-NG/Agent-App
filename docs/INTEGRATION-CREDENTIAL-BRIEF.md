# What we need from each provider

**Document ID:** PSIRS-INTEG-BRIEF-2026-V1
**Audience:** the people who will contact each provider, and the providers themselves.
**Companion to:** `INTEGRATION-VERIFICATION.md`, which is the internal checklist for
configuring what arrives. This document is the outward-facing ask.

---

## Why this exists

The platform is built and tested. Every one of its external integrations runs
against a development mock, and none has exchanged a packet with the provider
it will depend on. That is blocker **B-4**, and it is the only thing standing
between the platform and certification.

It is not an engineering task. The harness is written, a scheduled workflow
already runs it, and the moment credentials are in place that workflow turns
itself green with no code change. What is missing is credentials from six
organisations, and vendor onboarding runs in weeks rather than hours — so this
is the item to start first, regardless of what else is in flight.

Sections 1–6 are written to be **detached and sent**. Each opens with enough
context for somebody who has never heard of this project.

---

## The one thing every provider must understand

Most integrations handle the answers they expect and shrug at the rest. This
one refuses to.

> **An answer the platform does not recognise is treated as a failure, not as
> a success and not as "probably fine".**

That is deliberate. The platform's governing rule is that no government
revenue transaction may appear successful unless the payment infrastructure
has independently confirmed it. A status value nobody mapped is
indistinguishable from a mapping that is wrong — so `PENDING`, `UNDER_REVIEW`
and `UNKNOWN` all count as failures in our verification run.

The practical consequence, and the thing to say on every call:

> **Please tell us *every* status value your API can return — including the
> rare ones, the deprecated ones, and the ones that only appear when something
> has gone wrong.** A list of the happy-path values is not enough. If you have
> an enumeration in your documentation, send that; if the list lives in
> somebody's head, we would rather have their best recollection than a
> confident subset.

### And on test data

We are asking for **sandbox identities only**. Do not send us a real citizen's
NIN, BVN, or account number, and we will not send you one. Where we ask for a
"known-good" fixture below, a sandbox record that behaves like the real thing
is exactly right.

---

## 1 · Remita — payment gateway

**What it does for us.** Citizens pay government revenue through Remita. The
platform initiates the payment, and treats Remita's confirmation — not the
agent's word, not the citizen's — as the only evidence that money arrived. A
receipt is issued from that confirmation and from nothing else.

### What we need

| # | Ask | Why |
|---|---|---|
| 1.1 | Sandbox **merchant ID** and **API key** | To authenticate at all. |
| 1.2 | Sandbox **base URL** | Note our platform refuses to start against `remitademo.net` in production, by design. |
| 1.3 | **Service type ID** for each revenue stream | This is the setting that decides which government account is credited. Getting it wrong sends money to the wrong place, so we would like it confirmed in writing rather than inferred. |
| 1.4 | **Every status code**, with its meaning | Specifically: which codes mean *money received*, which mean *definitively failed*, and which mean *still in flight*. See the note above — we need the whole list. |
| 1.5 | The **RRR status query** endpoint and its response shape | |
| 1.6 | A **reference known to have been paid**, in sandbox | The only way to prove our success-code list is to query something genuinely settled. A reference that has *not* been paid proves only that the endpoint answers. |
| 1.7 | **Webhook registration** against our callback URL, and the **source IP addresses** notifications originate from | We allowlist them. |
| 1.8 | The **bulk statement / reconciliation report** endpoint, if provisioned for this merchant | We reconcile against it daily; without it, reconciliation is manual. |

### Questions only Remita can answer

- Can a payment move from a success code to a failure code after the fact —
  a reversal, a chargeback, a settlement failure? If so, how are we told?
- Is the webhook retried on failure, and how many times, over what interval?
- Is the webhook signed, and with which algorithm and which secret?

---

## 2 · TIN service — PSIRS internal

**What it does for us.** Every taxpayer registered in the field is issued a
Tax Identification Number. The platform requests one at registration and
records what comes back.

### What we need

| # | Ask | Why |
|---|---|---|
| 2.1 | Sandbox **endpoint** and **API key** | |
| 2.2 | **Lookup** and **register** path templates | |
| 2.3 | Where in the response the **number, name, type and status** sit | Field paths, so we read the right thing. |
| 2.4 | The values meaning **issued**, **still processing**, and **no such TIN** | The full list, per the note above. |
| 2.5 | **The TIN format** — the exact pattern a valid PSIRS TIN takes | See the warning below. |

> **2.5 needs particular care and is worth a conversation rather than an
> email.** Our `tin` column is unique on a row that cannot be deleted, so a
> malformed value written there is permanent and blocks the real number from
> ever being recorded for that taxpayer. We have left format validation *off*
> by default for exactly this reason. Turning it on is a one-way door, and we
> would rather have the pattern confirmed by whoever owns the numbering scheme
> than inferred from a sample of ten.

### Questions only the TIN service can answer

- If a registration is submitted twice for the same person, is a second TIN
  issued, or is the first returned?
- How long does "still processing" typically last, and is there a point after
  which we should stop retrying and escalate?
- Is a TIN ever withdrawn or reissued? If so, how would we learn of it?

---

## 3 · KYC / identity verification provider

**What it does for us.** Before somebody may collect government revenue as an
agent, their identity is verified against the national record and a captured
photograph is matched against it. An agent who fails this check never reaches
the field.

### What we need

| # | Ask | Why |
|---|---|---|
| 3.1 | Sandbox **endpoint** and **API key** | |
| 3.2 | The **verification path** and request shape | |
| 3.3 | Where the **status**, **reason** and **reference** sit in the response | |
| 3.4 | The values meaning **cleared**, **failed**, and **more information needed** | The full list. |
| 3.5 | Whether **liveness / face match** is a separate call or part of the same one, and where its result sits | We match a captured photograph against the identity record rather than trusting the number alone. |
| 3.6 | **Sandbox identities** that reliably produce each outcome | One that clears, one that fails, one that returns "more information needed". |

### Questions only the provider can answer

- What does the service return when the national record is unreachable, as
  distinct from when the person is not found? We must be able to tell those
  apart: one means try again, the other means refuse.
- Is there a rate limit, and what happens when we hit it?
- What is retained on your side after a verification, and for how long?

---

## 4 · Vehicle registry

**What it does for us.** Vehicle particulars renewal. The platform looks a
registration up, prices the renewal, takes payment through Remita, and records
the renewal back to the registry.

### What we need

| # | Ask | Why |
|---|---|---|
| 4.1 | Sandbox **endpoint** and **API key** | |
| 4.2 | **Lookup**, **record renewal** and **status** path templates | |
| 4.3 | Where the vehicle's fields sit in a lookup response | |
| 4.4 | The values meaning **found** and **not found** | Plus anything else the lookup can return. |
| 4.5 | **Sandbox plate numbers**: one that exists, one that does not | |
| 4.6 | Whether recording a renewal is **idempotent**, and what identifies a duplicate | We retry on network failure; we must not renew twice. |

### Questions only the registry can answer

- If a vehicle is found but its particulars are disputed or flagged, how is
  that expressed?
- Does recording a renewal fail if the previous one has not expired, and if so
  how is that distinguishable from a technical failure?

---

## 5 · Bank account verification

**What it does for us.** An agent's commission is paid into a bank account
they nominate. Before it is used — and again whenever they change it — we ask
the bank whether the account exists and what name it is held in. The returned
name is the evidence an officer weighs when approving a change.

**Please note what this is *not*.** Government revenue never passes through an
agent's account. This verification is for commission payment only.

### What we need

| # | Ask | Why |
|---|---|---|
| 5.1 | Sandbox **endpoint** and **API key** | |
| 5.2 | The **account resolution** path and request shape | |
| 5.3 | Where the **resolved account name**, **status** and **reference** sit | The name is the important one: it is what an officer compares against the name the agent gave. |
| 5.4 | The values meaning **no such account** | Plus anything else returned. |
| 5.5 | **Bank codes** — the list, or where to fetch it | |
| 5.6 | **Sandbox accounts**: one that resolves, one that does not | |

### Questions only the provider can answer

- Is the returned name the account's full registered name, or an abbreviated
  form? We compare it to a name typed by an agent, so we need to know how
  exact a match to expect.
- What is returned when the *bank* is unreachable, as distinct from when the
  account does not exist?

---

## 6 · SMS gateway (and email, if separate)

**What it does for us.** An SMS is often the citizen's only copy of their
receipt. They hold no account with us and cannot sign in to retrieve anything.
It also carries one-time codes, and the message that tells an agent their bank
account is being changed — which is how somebody finds out if the request was
not theirs.

### What we need

| # | Ask | Why |
|---|---|---|
| 6.1 | Sandbox **endpoint** and **API key** | |
| 6.2 | The **three field names** for recipient, sender and body | Vendors disagree about these more than about anything else. |
| 6.3 | Where the **message reference** and **error** sit in the response | |
| 6.4 | A **registered sender ID** | Nigerian gateways refuse messages without one. This often needs its own approval and can be the longest-lead item on this page — please start it early. |
| 6.5 | Delivery-report mechanism, if any | |
| 6.6 | Email endpoint and credential, if email is a different vendor | |

### Questions only the gateway can answer

- What is the character limit before a message is split, and are we billed per
  part? Several of our messages are near the boundary.
- Are delivery reports available, and are they pushed or polled?
- Is there a throughput limit we should expect to hit at scale? We may send
  thousands of receipts in a market day.

---

## 7 · Object storage — no vendor call needed

Not a third-party integration in the same sense: any S3-compatible bucket
works. Needed from whoever administers it:

- endpoint, region, bucket name
- an access key and secret with read/write on that bucket only
- confirmation the bucket is **not publicly readable** — identity documents
  and receipts live here, and access is granted only through signed URLs the
  platform issues, which expire after fifteen minutes

---

## 8 · What to do as each one arrives

Credentials do not need to arrive together. Each provider can be configured
and verified on its own, and the verification workflow reports per provider.

1. Add the secrets to the repository (see `INTEGRATION-VERIFICATION.md` for the
   exact names). They are held as secrets rather than written into the
   workflow so that no identity number appears in the repository or a build
   log.
2. The scheduled workflow stops reporting "skipped" for that provider and
   starts actually calling it.
3. A green run means the provider answered and every value it returned was one
   the platform recognised. A red run names what it could not read.
4. When all six are green and have stayed green, B-4 closes and certification
   can proceed.

**Do not paper over a red run by adding the unrecognised value to the mapping
without understanding it.** That is the failure this whole arrangement exists
to prevent: a status nobody understood, mapped to "success" because it was
easier than asking.

---

## Progress

| Provider | Contacted | Sandbox credentials | Verified green | Notes |
|---|:---:|:---:|:---:|---|
| Remita — payments | ☐ | ☐ | ☐ | |
| TIN service | ☐ | ☐ | ☐ | |
| KYC / identity | ☐ | ☐ | ☐ | |
| Vehicle registry | ☐ | ☐ | ☐ | |
| Bank verification | ☐ | ☐ | ☐ | |
| SMS gateway | ☐ | ☐ | ☐ | sender ID approval is often the long pole |
| Object storage | ☐ | ☐ | ☐ | internal — no vendor call |
