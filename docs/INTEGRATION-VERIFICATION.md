# Integration verification

> This is the **internal checklist**: what must be configured once credentials
> arrive, and how the harness proves it. For the outward-facing ask — what to
> request from each of the six providers, and the questions only they can
> answer — see **[INTEGRATION-CREDENTIAL-BRIEF.md](INTEGRATION-CREDENTIAL-BRIEF.md)**,
> whose sections are written to be detached and sent.

**Status: not complete, and not completable from this repository.**

Five external services stand between this platform and a working revenue
operation. None of them has ever been spoken to. Every adapter has been written,
typed, unit-tested and exercised against a development mock, and that proves the
platform handles each *shape* of answer correctly. It proves nothing about
whether the mapping matches what the real provider says.

This document exists so that gap is a task with an owner rather than an
assumption.

## Why the boot guard is not enough

`config.ts` refuses to start in production while any adapter is still `mock`.
That catches a deployment that forgot to configure one. It cannot catch the
likelier mistake: an adapter pointed at the right provider with the wrong
mapping.

Every adapter reads its provider's response through configurable field paths and
maps that provider's status vocabulary onto the platform's. Both halves are
configuration because the vendors disagree, and both halves are unverified.

A wrong mapping is quiet, and it fails closed — which is the correct design and
also the reason nobody notices:

| Misconfiguration | What actually happens | What it looks like |
|---|---|---|
| `KYC_CLEARED_VALUES` missing the vendor's word for success | Every applicant becomes `UNDER_REVIEW` | A slow review queue |
| `TIN_ASSIGNED_VALUES` missing the service's word | Every taxpayer waits forever for a TIN already issued | A slow TIN service |
| `REMITA_SUCCESS_STATUS_CODES` wrong | Every payment stays `PENDING`, no receipt is ever issued | A gateway outage |
| `VEHICLE_REGISTRY_NOT_FOUND_VALUES` too broad | Registered vehicles reported unregistered | Bad registry data |
| Bank `accountNamePath` wrong | Every agent's account fails to verify | Agents blaming their bank |

Each of those is weeks of confusion that looks like somebody else's fault. None
of them is detectable without asking the real service a real question.

## The harness

```bash
npm run verify:integrations -- --tin 12345678901
npm run verify:integrations -- --all --tin … --nin … --plate … --rrr … --account … --bank-code …
```

It asks each configured provider one real question and reports what the platform
made of the answer, in the platform's own vocabulary. It writes nothing: no
taxpayer registered, no agent cleared, no payment made. Exit code 0 when every
answer was understood, 1 when any was not — so it works as a go-live gate in a
pipeline.

Two outcomes are reported as **failures even though they are valid results**,
and this is deliberate:

- **KYC `UNDER_REVIEW`** — what an unrecognised status maps to. Correct
  fail-closed behaviour, and indistinguishable from a bad mapping, so a human
  has to confirm which it is.
- **Gateway `PENDING`/`UNKNOWN`** — what an unmapped status code becomes. Safe,
  and it means that reference can never be confirmed.

A third outcome is reported the same way, for the same reason:

- **Any provider still on `mock`** — the check is printed as `MOCK` rather than
  `ok` and the run exits 1. A mock answers whatever it was written to answer, so
  a run whose subjects were mocks is not evidence about any real provider and
  must not be filed as though it were. Until 25 August 2026 this was only a note
  in the output: mock checks printed `ok`, and a run against six mocks ended
  "every answer was understood by the platform. Record this output against the
  go-live checklist" and exited 0.

## What must be confirmed, per provider

Each row is a decision that belongs to PSIRS or the vendor, not to this
codebase. Record the confirmed value and the date it was confirmed.

### Payment gateway — Remita

| Setting | What it must be | Confirmed |
|---|---|---|
| `REMITA_BASE_URL` | the live endpoint, not `remitademo.net` (boot refuses the demo URL) | ☐ |
| `REMITA_MERCHANT_ID` | PSIRS's merchant ID | ☐ |
| `REMITA_API_KEY` | PSIRS's API key | ☐ |
| `REMITA_SERVICE_TYPE_ID` | issued per revenue stream; **the one that credits the correct government account** | ☐ |
| `REMITA_SUCCESS_STATUS_CODES` | every code meaning "money received". Default `00` | ☐ |
| `REMITA_FAILURE_STATUS_CODES` | codes meaning definitively failed. Empty by default so an unmapped code stays pending | ☐ |
| `REMITA_STATEMENT_PATH` | the bulk report path for this merchant, if provisioned | ☐ |
| Notification source addresses | for `REMITA_NOTIFICATION_IP_ALLOWLIST` | ☐ |
| Webhook URL registered | pointing at `/api/v1/webhooks/payments` | ☐ |

**Test with a reference you know was paid.** A status query against a genuinely
settled payment is the only thing that proves the success-code list.

### TIN service — PSIRS

| Setting | What it must be | Confirmed |
|---|---|---|
| `TIN_SERVICE_URL`, `TIN_SERVICE_API_KEY` | endpoint and credential | ☐ |
| `TIN_LOOKUP_PATH`, `TIN_REGISTER_PATH` | path templates | ☐ |
| `TIN_NUMBER_PATH`, `TIN_NAME_PATH`, `TIN_TYPE_PATH`, `TIN_STATUS_PATH` | where each field sits in the response | ☐ |
| `TIN_ASSIGNED_VALUES` | the words meaning "issued" | ☐ |
| `TIN_PENDING_VALUES` | the words meaning "still processing" | ☐ |
| `TIN_NOT_FOUND_VALUES` | the words meaning "no such TIN" | ☐ |
| `TIN_FORMAT_PATTERN` | **the PSIRS TIN format** | ☐ |

`TIN_FORMAT_PATTERN` deserves particular care. `taxpayers.tin` is `UNIQUE` on a
row that cannot be deleted, so a malformed value written there is permanent and
blocks the real number from ever being recorded. The pattern is off by default
for that reason; setting it correctly is a one-way door.

### KYC provider

| Setting | What it must be | Confirmed |
|---|---|---|
| `KYC_PROVIDER_URL`, `KYC_PROVIDER_API_KEY` | endpoint and credential | ☐ |
| `KYC_STATUS_PATH`, `KYC_REFERENCE_PATH`, `KYC_LIVENESS_PATH`, `KYC_REASON_PATH` | response field paths | ☐ |
| `KYC_CLEARED_VALUES` | the vendor's words for a pass — boot refuses an empty list | ☐ |
| `KYC_FAILED_VALUES` | the vendor's words for a fail | ☐ |
| `KYC_MORE_INFO_VALUES` | the vendor's words for "resubmit" | ☐ |

Confirm with at least three sandbox identities: one that clears, one that fails,
one that needs more information. Anything unmapped becomes `UNDER_REVIEW`, and
no configuration value can make an unrecognised status clear an applicant.

### Vehicle registry

| Setting | What it must be | Confirmed |
|---|---|---|
| `VEHICLE_REGISTRY_URL`, `VEHICLE_REGISTRY_API_KEY` | endpoint and credential | ☐ |
| `VEHICLE_REGISTRY_LOOKUP_PATH`, `VEHICLE_REGISTRY_RENEWAL_PATH` | path templates | ☐ |
| `VEHICLE_REGISTRY_RECORD_PATH`, `VEHICLE_REGISTRY_STATUS_PATH` | where the vehicle sits in the response | ☐ |
| `VEHICLE_REGISTRY_NOT_FOUND_VALUES` | **only** explicit "no such vehicle" values | ☐ |

The not-found list is short on purpose: recording a registered vehicle as
unregistered is the more expensive mistake, so every other unreadable answer is
treated as "we could not ask".

### Bank verification

| Setting | What it must be | Confirmed |
|---|---|---|
| `BANK_VERIFICATION_URL`, `BANK_VERIFICATION_API_KEY` | endpoint and credential | ☐ |
| `BANK_RESOLVE_PATH` | path template | ☐ |
| `BANK_ACCOUNT_NAME_PATH`, `BANK_REFERENCE_PATH`, `BANK_STATUS_PATH` | response field paths | ☐ |
| `BANK_NOT_FOUND_VALUES` | the words meaning "no such account" | ☐ |

This is commission accounts only. Government revenue never passes through an
agent's account.

### SMS and email

| Setting | What it must be | Confirmed |
|---|---|---|
| `SMS_PROVIDER_URL`, `MESSAGE_PROVIDER_API_KEY` | endpoint and credential | ☐ |
| `MESSAGE_RECIPIENT_FIELD`, `MESSAGE_SENDER_FIELD`, `MESSAGE_BODY_FIELD` | the three field names vendors disagree on | ☐ |
| `MESSAGE_REFERENCE_PATH`, `MESSAGE_ERROR_PATH` | response paths | ☐ |
| `SMS_SENDER_ID` | registered with the gateway, or messages are refused | ☐ |
| `EMAIL_PROVIDER_URL` | if email is a different vendor | ☐ |

An SMS is the citizen's only copy of their receipt. They hold no account here.
Send a real message to a real handset and confirm it arrives, with the right
sender ID and readable content — `--sms` is deliberately excluded from `--all`
because it has a side effect.

## What has been exercised without credentials

A live call needs a credential and a network route, and neither belongs in a
repository. What does not need either is proving the adapter speaks the
provider's protocol correctly through the whole platform, rather than in
isolation — which is where the untested seam actually was.

Three runs now boot the real app on a real adapter against a server speaking
that provider's wire protocol over TCP. Each one fails if its adapter is
switched back to the mock, so none of them can quietly become a mock test
again:

| Run | Adapter | What it takes the whole way |
|---|---|---|
| `remita-live-path.test.ts` | `RemitaGateway` | RRR generated at Remita, an unconfirmed poll, a notification that does not move the money state, verification, receipt, reconciliation |
| `tin-live-path.test.ts` | `HttpTinService` | an existing TIN confirmed and stored as the register spells it, an unknown one refused, an outage registering nothing |
| `kyc-live-path.test.ts` | `HttpKycProvider` | a clearance, an unrecognised status that cannot clear anybody, an outage that is not a refusal |

The unit boundary is checked end to end in the first of these: the platform
sends Naira where it holds kobo, and the amount on the receipt is the amount
Remita reported. A hundredfold error there would look like an ordinary number
all the way to the taxpayer.

This is not a substitute for the sign-off below. It proves the adapters are
correct against the protocol as documented; it cannot prove PSIRS's own
merchant configuration, status vocabulary or credentials are what the adapters
expect. That still takes one real call.

## Sign-off

This blocker closes when:

- [ ] every box above is ticked, with the confirmed value recorded
- [ ] `npm run verify:integrations -- --all …` exits 0 against the sandboxes
- [ ] one end-to-end collection has been completed against the **live** Remita
      with a real payment, and the receipt verified through the public page
- [ ] one agent has been cleared end to end through the **real** KYC provider
- [ ] the output of the verification run is attached to the go-live record

Until then the platform is configured for these providers, not verified against
them, and the distinction is the whole of blocker B-4.

## Keeping it verified

A sign-off decays. A mapping confirmed in March is not confirmed in September:
a vendor adds a status code, somebody edits an environment variable, a sandbox
is reprovisioned. None of those announce themselves — they surface as payments
that stay `PENDING` and agents who are never cleared, which is exactly the
failure mode B-4 exists to prevent.

`.github/workflows/integration-verification.yml` runs the harness daily against
whatever the repository secrets point at, so the answer is never more than a day
old.

**Until the secrets are set it reports *skipped*, naming what is missing.** Not
failed, because a red cross every morning for a condition nobody can fix that
morning teaches people to ignore red crosses. Not passed either — a green tick
would assert the integrations were verified. "Not checked" must not be able to
look like "checked".

### Secrets to add

Provider selection — the job skips unless at least these are set:

| Secret | Example |
|---|---|
| `PAYMENT_GATEWAY` | `remita` |
| `KYC_PROVIDER` | the provider's name |
| `TIN_SERVICE` | the provider's name |
| `VEHICLE_REGISTRY` | the provider's name |
| `BANK_VERIFICATION` | the provider's name |

Endpoints and credentials: `REMITA_BASE_URL`, `REMITA_MERCHANT_ID`,
`REMITA_API_KEY`, `REMITA_SERVICE_TYPE_ID`, `REMITA_SUCCESS_STATUS_CODES`,
`REMITA_FAILURE_STATUS_CODES`, `KYC_PROVIDER_URL`, `KYC_PROVIDER_API_KEY`,
`KYC_CLEARED_VALUES`, `KYC_FAILED_VALUES`, `KYC_MORE_INFO_VALUES`,
`TIN_SERVICE_URL`, `TIN_ASSIGNED_VALUES`, `TIN_NOT_FOUND_VALUES`,
`TIN_PENDING_VALUES`, `VEHICLE_REGISTRY_URL`, `BANK_VERIFICATION_URL`.

Subjects to ask about — `VERIFY_TIN`, `VERIFY_NIN`, `VERIFY_PLATE`,
`VERIFY_ACCOUNT`, `VERIFY_BANK_CODE`, `VERIFY_RRR`.

These are held as secrets rather than written into the workflow so that no
identity number appears in the repository or in a build log. **Use sandbox
identities.** A real citizen's NIN does not belong in CI configuration, and
`VERIFY_RRR` should be a reference known to have been paid — that is the only
way the run confirms `REMITA_SUCCESS_STATUS_CODES` rather than merely confirming
the gateway answers.

`--sms` is excluded from the scheduled run: sending a message is a side effect,
and a daily job should not text somebody at 05:00 to prove that it can. Run it
by hand at sign-off.

### What a run proves

The job fails if any provider returns something the platform could not read.
`UNDER_REVIEW`, `PENDING` and `UNKNOWN` count as failures, not passes — they are
legitimate vendor replies and therefore indistinguishable from a mapping that
does not recognise what the vendor said. That strictness is what makes a green
run worth having.

Output is kept as a build artifact for 180 days, because B-4 closes on evidence
and evidence that expires in ninety days is little use to an auditor asking in
month four.
