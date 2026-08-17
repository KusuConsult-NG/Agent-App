# Security and anti-leakage model

## What this platform is defending against

The PRD is unusually direct about the threat: the adversary is often an
authorised insider. PRD §68 lists the attacks by name — collect cash and mark it
paid, create fake receipts, alter rates, delete transactions, reuse receipt
numbers, claim commission on unpaid transactions, create duplicate taxpayers for
commission. The controls below are organised around those, not around a generic
checklist.

## 1. Collecting cash and marking it paid

**Blocked structurally.** No endpoint accepts a payment status. `confirmPayment()`
takes no status argument; it calls the gateway and acts on the answer. The
`receipts` trigger refuses to issue a receipt for a payment that is not
`VERIFIED`, and the amount must match exactly — a gateway reporting success for a
different figure raises a `CRITICAL` fraud flag and puts the transaction
`UNDER_REVIEW` rather than receipting it.

The agent agreement (accepted digitally, version-stamped, IP and device
recorded) states the rule, and the PWA repeats it on the collection screen. But
the enforcement is the trigger, not the wording.

## 2. Fake receipts

Receipt numbers come from a PostgreSQL sequence, never from `COUNT(*) + 1`,
which would race under concurrency and reissue a number. `receipt_number`,
`transaction_id`, `payment_id`, `amount_kobo` and `verification_code` are
immutable once written, and the row cannot be deleted.

Every receipt carries a QR code pointing at a public verification page that
needs no login. Verification does two things: it confirms the record exists and
is valid, and it recomputes the SHA-256 of the stored PDF and compares it with
the digest recorded at issuance. A genuine record with a doctored document is
reported as **INVALID** with an instruction to report it.

The public page shows the receipt number, revenue type, amount, date and LGA —
and no taxpayer name, phone number, address or TIN (PRD §20).

## 3. Altering government rates

`catalogue:configure` is held only by revenue officers and administrators, and
the action additionally requires step-up authentication — a fresh one-time code,
consumed on use, regardless of session age.

A rate change cannot edit a rate. It closes the current version with an
`effective_to` and inserts a new version with a future effective date; back-dating
is refused. `revenue_item_rates` rows are immutable and undeletable, and every
assessment stores the id of the version it used. Rate history, with the officer
who made each change and their stated reason, is available at
`GET /government/audit/queries/rate-changes`.

## 4. Deleting or editing transactions

`prevent_delete()` is attached to every table carrying money or evidence of it.
`prevent_column_mutation()` freezes amount, reference and attribution columns.
Corrections happen by reversal under maker-checker approval, which leaves the
original visible.

## 5. Commission fraud

Commission cannot exist without verified revenue (`enforce_commission_requires_
verified_revenue`), cannot exist twice for one transaction (`UNIQUE`), cannot be
marked paid without a bank reference (`enforce_commission_payment_evidence`), and
cannot become eligible until the transaction is `SETTLED` and the hold period has
elapsed. An open `HIGH` or `CRITICAL` fraud flag freezes eligibility.

Payout requires step-up authentication, and approval by a different officer —
`requested_by <> approved_by` is a database constraint, not just a service check.

Duplicate registrations for commission are addressed at source: a decisive match
(same identity number, or same TIN) is refused outright; weaker matches are shown
to the agent with reasons and can be overridden, and every override is recorded.
Five overrides in seven days raises a `HIGH` flag against the agent.

## 6. Agent identity fraud

The addendum's clearance pipeline is the control: identity KYC, an independent
referee who verifies separately through a tokenised link, government review with
a mandatory reason, training, bank verification, agreement, device registration.

`agent_activation_requires_clearance` is a CHECK constraint, so a row cannot even
exist in the database that is operationally active without cleared KYC, a cleared
referee, government approval and completed training.

Government override exists (Addendum §41) but is not a hidden button: it requires
an `AGENT_OVERRIDE_ACTIVATION` approval that a different officer granted, the
approver may not also apply it, and the unmet items are written into the
clearance record and the audit log permanently.

Referee risk controls flag one referee vouching for many applicants, a referee
sharing the applicant's phone number, and reused identification.

## 7. An agent seeing more of government than their job needs

The agent application is a field tool. An agent who could read LGA-wide
collections, other agents' figures, or a taxpayer's full payment history would
hold information that is useful for social engineering, for judging which
taxpayers are worth approaching off-book, and for gauging whether their own
irregularities are likely to be noticed.

The agent role therefore holds no permission that reads across agents, areas or
the platform: no `report:read:all`, no `report:read:territory`, no
`payment:read:all`, no `audit:read`, no `fraud:read`, no `catalogue:configure`,
no `agent:read:all`, and no `incentive:*` at all.

Two specific narrowings were made after an endpoint-by-endpoint audit:

* **Rate-change history** (`/government/audit/queries/rate-changes`) previously
  accepted `catalogue:read`, which every agent holds in order to price a charge.
  It now requires `audit:read` or `catalogue:configure`. Reading the catalogue
  and reading the history of who changed a government rate are different acts.

* **Taxpayer profiles** previously returned the taxpayer's whole financial life
  to any agent who searched for them. An agent now receives
  `scope: "AGENT_LIMITED"`: identity, outstanding obligations, vehicles, and
  only the transactions and receipts that agent facilitated. Compliance scoring
  and programme eligibility — taxpayer incentive data — are withheld entirely.
  Officers receive `scope: "FULL"`.

`apps/api/src/tests/agent-scope.test.ts` asserts this containment against a
genuinely cleared, active agent for 27 administrative endpoints plus the
own-figures and taxpayer-profile cases, so a permission change that widens the
agent's view fails in the test suite rather than in the field.

## Authentication and sessions

- bcrypt password hashing; uniform failure message so the endpoint cannot
  enumerate accounts; lockout after repeated failures.
- Short-lived JWT access tokens; refresh tokens stored only as SHA-256 hashes and
  rotated on every use, so a stolen refresh token is usable at most once.
- The role is read from the database on every request, not trusted from the
  token, so a suspension or role change applies to sessions issued before it.
- Session revocation is immediate: suspending an agent or revoking a device
  revokes the sessions in the same transaction.
- Step-up authentication for high-risk actions, consumed on use — one code
  authorises exactly one action.

In the browser, access tokens live in memory only and refresh tokens in
`sessionStorage`, so closing the app ends the session (Addendum §22). The only
value in `localStorage` is the device identifier, which is not a credential and
must survive restarts for device binding to work.

## Sensitive data

National identity numbers (NIN, BVN, …) are never stored in plaintext. They are
hashed with HMAC-SHA256 under a key held outside the database — HMAC rather than
a bare digest because identity numbers have a small, enumerable key space that
would make an unkeyed hash trivially reversible. A masked form (`*******8901`) is
kept so an officer can confirm which document is on file.

The integration suite asserts that the raw identity number appears nowhere in
the audit log.

Referee invitation tokens are stored only as hashes; the plaintext exists once,
in the message sent to the referee.

## Webhooks

Signatures are verified with HMAC-SHA512 over the **raw** request body, retained
by the JSON parser — re-serialising parsed JSON would change byte order, break
verification, and could hide a mismatch between the signed and parsed payloads.
An unsigned or wrongly signed delivery is recorded and refused; it never
influences payment state.

Deliveries are stored before they are acted on, and `UNIQUE (gateway, event_id)`
makes a redelivery detectable at insert. A duplicate is acknowledged with 200 and
creates nothing, which is what PRD §53 specifies and what stops the gateway
retrying forever.

## Transport and browser

HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy:
no-referrer`, a restrictive `Permissions-Policy`, and a CSP of `default-src
'none'` on the API (it serves only JSON and PDFs; nothing it returns should ever
execute). Both front-ends ship a CSP that forbids third-party script, style,
frame and connect origins — everything they need is bundled.

CORS is an explicit origin allowlist. Rate limits are keyed by user where known
so one shared NAT address in a rural LGA does not throttle every agent behind it.

## Documents

Stored privately; access is only ever through a signed, expiring URL whose
signature covers the document id and the expiry, so a link cannot be edited to
point at another document or to last longer than granted. Every download is
logged with the accessing user and IP.

## Audit

Every sensitive action writes an entry inside the same transaction as the action,
so an unaudited state change is impossible. Entries form a hash chain; the table
forbids UPDATE and DELETE outright. `GET /government/audit/verify` replays the
chain and reports the first broken link, so integrity is something government can
check rather than take on trust.

## Privacy

Data minimisation (hashed identifiers, masked display), explicit taxpayer consent
and declaration recorded with timestamps, RBAC scoping reads by role, document
access logging, and a public verification surface that deliberately exposes the
minimum needed to prove a receipt is genuine.

PRD §40's safeguard is enforced rather than documented: an incentive programme
whose benefit type is an essential public service (healthcare, education, water,
emergency relief, social welfare) cannot be created unless the legal or policy
authority for linking it to tax compliance is recorded on the programme. Nothing
in the incentive engine withdraws a service; programmes only add entitlement.

## Known gaps before production

These are integration and operations tasks, not design gaps:

1. Rate limiting is in-process; multi-instance deployment needs the Redis store.
2. The TIN, KYC, vehicle registry, bank verification and payment gateway adapters
   are development mocks. `config.ts` refuses to boot in production while any is
   still `mock`.
3. Object storage is local disk; production needs S3-compatible storage with
   server-side encryption. The `StorageDriver` interface is the swap point.
4. Backups, point-in-time recovery, monitoring and alerting are deployment
   concerns not covered by this repository.
5. Independent security testing and penetration testing (PRD §88.35) have not
   been performed.
