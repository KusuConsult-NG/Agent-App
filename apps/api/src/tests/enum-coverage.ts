/**
 * Which declared states are meant to be unreachable, and why.
 *
 * Shared by the two checks that ask the question from opposite ends.
 * `a-state-nothing-writes.test.ts` reads the source and asks what the platform
 * never mentions; `scripts/check-enum-coverage.ts` reads what the suite
 * actually wrote and asks what never happened. One list, so the two cannot
 * disagree about what was decided.
 *
 * No side effects and no test imports on purpose: the coverage checker runs in
 * its own process after the shards finish, and must be able to read this
 * without starting anything.
 */

/**
 * States nothing writes, on purpose, with the reason each one stays.
 *
 * Keyed `table.column: VALUE`. Adding a line here is a statement that the
 * platform is not meant to reach this state — not a way to silence the check.
 */
export const DELIBERATELY_UNREACHABLE: Record<string, string> = {
  /*
   * Reference data nobody can publish a second version of.
   *
   * All four tables are seeded once and never edited through an API: there is
   * no screen that writes an agreement, a commission policy or a training
   * module, so there is never an older version to retire. The day one is
   * added, retiring its predecessor is part of adding it, and this line goes.
   */
  'agreement_versions.status: RETIRED':
    'Agreement versions are seeded; no endpoint publishes a second one to supersede the first.',
  'commission_policies.status: RETIRED':
    'Commission policies are seeded; no endpoint publishes a replacement policy.',
  'training_modules.status: RETIRED':
    'Training modules are seeded; no endpoint publishes a replacement module.',

  /*
   * A column that describes rather than decides. Nothing reads
   * `settlement_schedule` — a payout is requested by the agent and approved by
   * an officer, not produced by a scheduler — so every one of its four values
   * is equally inert, and WEEKLY only appears because the seed writes it.
   */
  'commission_policies.settlement_schedule: FORTNIGHTLY':
    'No scheduler reads settlement_schedule; payouts are requested and approved, never timed.',

  /*
   * Public verification is logged, in a better place.
   *
   * `verification_attempts` records every lookup with its result, including —
   * and this is the reason it is the right table — the ones that resolve to no
   * document at all. Somebody typing receipt numbers until one answers is the
   * pattern worth seeing, and a log keyed on `document_id` cannot hold it.
   * Writing VERIFY here as well would duplicate the row that matters and lose
   * the ones that matter more.
   */
  'document_access_logs.access_type: VERIFY':
    'Public verification is recorded in verification_attempts, which also holds the lookups that find nothing.',

  /* Nothing shares a document. Access is download or public verification. */
  'document_access_logs.access_type: SHARE':
    'The platform has no document sharing; a taxpayer forwards the PDF itself, off-platform.',

  /*
   * Delivery receipts the providers do not send us. The SMS and email adapters
   * report acceptance, which is SENT; neither has a delivery-report callback
   * wired, and nothing in the platform can observe a person reading an SMS.
   * DELIVERED becomes reachable the day a provider callback lands; READ never
   * does through SMS or email.
   */
  'notifications.status: DELIVERED':
    'No provider delivery-report callback is wired; the adapters report acceptance only.',
  'notifications.status: READ':
    'Neither SMS nor email can tell us a message was read.',

  /*
   * Draft kinds the agent application does not queue. It captures a taxpayer
   * registration and a vehicle; a service request is made online against a
   * live catalogue, and a document is captured inside the registration it
   * belongs to rather than as a draft of its own.
   */
  'offline_drafts.draft_type: SERVICE_REQUEST':
    'The agent app queues registrations and vehicles; a service request needs the live catalogue.',
  'offline_drafts.draft_type: DOCUMENT_CAPTURE':
    'Documents are captured inside the registration draft that carries them, not as a draft.',

  /*
   * Refused deliberately, one pass ago. `recordReversal` requires the refund
   * to equal the payment exactly, because a partial refund against an
   * integer-kobo payment has no verified remainder — the gateway confirms the
   * whole reversal or none of it. The value stays in the constraint so that
   * enabling partial refunds is a schema-free change; the refusal is in code
   * and is tested by name.
   */
  'refunds.refund_type: PARTIAL':
    'Partial refunds are refused in recordReversal; a refund must equal its payment.',

  /* PSIRS collects state and local government revenue. Federal is the FIRS. */
  'revenue_authorities.tier: FEDERAL':
    'Federal revenue is the FIRS, not PSIRS; the tier exists for completeness of the taxonomy.',

  /*
   * Taxpayers and vehicles this platform did not create. There is no importer
   * and no PSIRS feed: every record here was captured by an agent. Both
   * columns exist for the migration that has not happened.
   */
  'taxpayers.source: MIGRATION':
    'No bulk importer exists; every taxpayer on the platform was captured by an agent.',
  'taxpayers.source: PSIRS_SYNC':
    'No PSIRS feed is connected; the integration is TIN issuance, not record sync.',
  'vehicles.source: MIGRATION':
    'No bulk importer exists; every vehicle was captured by an agent or an authority lookup.',

  /*
   * Merging duplicate taxpayers. `existing-tin.test.ts` covers refusing a
   * duplicate at the door, which is the control that matters; reconciling two
   * records that already exist means moving assessments, invoices, payments,
   * receipts and commission between them, and doing that safely is its own
   * piece of work rather than a line in this pass.
   */
  /*
   * Found by watching what the suite writes, not by reading the source.
   *
   * Every one of these is mentioned in the code — read by a query, named in a
   * type — which is why `a-state-nothing-writes.test.ts` is satisfied by them
   * and always was. Nothing produces any of them.
   */
  /*
   * Withdrawing a request one raised oneself.
   *
   * A pending approval is taken off the queue by a second officer rejecting
   * it with a reason, and that is the better record: it says who decided the
   * request should not stand, which "the requester changed their mind" does
   * not. It also keeps the unwinding in one place. Deciding a COMMISSION_PAYOUT
   * or a BANK_ACCOUNT_CHANGE carries out real work in the same transaction —
   * a rejected payout releases the commissions it had claimed — and a cancel
   * path that skipped those branches would leave exactly the orphaned rows
   * the rejection branch was written to prevent.
   */
  'approvals.status: CANCELLED':
    'A pending request is withdrawn by a second officer rejecting it, which keeps the unwinding in the one branch that does it.',

  /*
   * A module nobody opens, only sits.
   *
   * There is no "start the module" endpoint: the applicant reads the material
   * and submits a score, so a progress row is written for the first time when
   * an attempt is made and is already COMPLETED or FAILED when it lands.
   * `agents.training_status` derives its own IN_PROGRESS from the presence of
   * any progress row, which is the state an officer actually reads.
   */
  'agent_training_progress.status: IN_PROGRESS':
    'Nothing starts a module; a progress row is first written by an attempt, which is already passed or failed.',

  /*
   * A KYC outcome the provider contract does not have.
   *
   * `agents.kyc_status` is written straight from the verification result, and
   * `KycOutcome` is CLEARED, FAILED, UNDER_REVIEW, VERIFICATION_REQUIRED or
   * UNAVAILABLE — the last of which is deliberately never recorded, because it
   * is a statement about the provider rather than a verdict on the person.
   * There is nowhere for SUBMITTED to come from.
   */
  'agents.kyc_status: SUBMITTED':
    'kyc_status is written from the provider verdict, and the provider contract has no SUBMITTED outcome.',

  /*
   * Taking a copy of somebody's identity papers.
   *
   * Both routes that serve a KYC document send it inline under
   * `cache-control: private, no-store`, and neither offers it as a download.
   * That is the point: a reviewer needs to look at a citizen's identity card,
   * not to end up holding a copy of it on a laptop. The value stays in the
   * constraint because an export path, if one is ever built, must log it.
   */
  'kyc_document_access_logs.access_type: DOWNLOAD':
    'Identity documents are served inline and never offered as a download, so no read is recorded as one.',

  /*
   * An invitation that goes by email and not by telephone.
   *
   * A referee record cannot exist without a phone number — the column is NOT
   * NULL and the nomination form requires it — so every invitation goes out by
   * SMS, and by both when an email address is given as well. There is no
   * referee for EMAIL alone to describe.
   */
  'referee_invitations.channel: EMAIL':
    'Every referee has a phone number, so an invitation is SMS or BOTH; EMAIL would mean a referee with no telephone.',

  /*
   * Referee risk at a severity worth ignoring.
   *
   * The four rules are one person vouching for a crowd of applicants, a
   * referee using the applicant's own phone number, and one identity behind
   * several referees. Each of those is HIGH or CRITICAL by its nature; there
   * is no low-severity way to be a referee who is not who they say they are.
   * The two values stay in the constraint because the severity vocabulary is
   * shared with fraud_flags, which does use them.
   */
  'referee_risk_flags.severity: LOW':
    'None of the four referee rules is a minor observation; the shared severity vocabulary carries the value for fraud_flags.',
  'referee_risk_flags.severity: MEDIUM':
    'Same: every referee rule is HIGH or CRITICAL by what it detects.',

  /*
   * Assessment states the platform's own shape does not produce.
   *
   * An assessment and its invoice are created in one call, so the row is
   * INVOICED the moment it exists and there is no draft to leave behind.
   * Nothing cancels one — a lapsed invoice EXPIRES and a paid one is settled
   * on the invoice and the transaction, which are the rows every report reads.
   */
  'assessments.status: DRAFT':
    'An assessment is created together with its invoice, so it is INVOICED from the first instant and never a draft.',
  'assessments.status: CANCELLED':
    'An assessment lapses (EXPIRED) or is superseded by a reversal; nothing cancels one.',
  'assessments.status: SETTLED':
    'Settlement is recorded on the invoice and the transaction, which is what the reports read; the assessment keeps the figure it assessed.',

  /* Seeded once, like the agreement's own RETIRED above: nothing drafts a
   * second version because no endpoint publishes one. */
  'agreement_versions.status: DRAFT':
    'Agreement versions are seeded active; no endpoint drafts a replacement.',

  /* The other two inert members of the schedule vocabulary, for the reason
   * given against FORTNIGHTLY above: nothing reads settlement_schedule. */
  'commission_policies.settlement_schedule: DAILY':
    'No scheduler reads settlement_schedule; payouts are requested and approved, never timed.',
  'commission_policies.settlement_schedule: MONTHLY':
    'No scheduler reads settlement_schedule; payouts are requested and approved, never timed.',

  /*
   * A commission is reversed, held, approved or paid. Nothing cancels one:
   * the transition function names CANCELLED in one CASE arm and no caller has
   * ever passed it.
   */
  'commissions.status: CANCELLED':
    'A commission follows its transaction; when that is reversed the commission is REVERSED, and nothing else ends one.',

  /*
   * Documents the platform does not issue.
   *
   * It generates three: a receipt, an invoice and vehicle papers. An
   * assessment notice, a TIN confirmation letter and a separate piece of
   * payment evidence are named in the type because they are the obvious next
   * ones to produce, and none of them exists yet.
   */
  'documents.document_type: ASSESSMENT':
    'The platform issues receipts, invoices and vehicle papers; there is no assessment notice document.',
  'documents.document_type: PAYMENT_EVIDENCE':
    'The receipt is the evidence of payment; nothing issues a second document for it.',
  'documents.document_type: TIN_CONFIRMATION':
    'A TIN is shown on the citizen status page and the receipt; no confirmation letter is generated.',
  'documents.owner_type: AGENT':
    'Every document the platform issues belongs to a taxpayer; an agent’s agreement is a record, not an issued document.',

  /*
   * Fraud subjects with nothing that raises them.
   *
   * `raiseFlag` is called against a transaction, an agent, a device or a
   * taxpayer. Referee patterns have a table of their own — `referee_risk_flags`
   * — because they need the referee's own identity and phone alongside them,
   * and no rule looks at a commission on its own: commission risk is caught
   * through the agent it belongs to.
   */
  'fraud_flags.entity_type: REFEREE':
    'Referee patterns are raised in referee_risk_flags, which carries the referee’s own details.',
  'fraud_flags.entity_type: COMMISSION':
    'Commission risk is raised against the agent it belongs to; no rule flags a commission by itself.',

  /*
   * Part-payment.
   *
   * `POST /payments/initiate` takes a transaction, not an amount, so a payment
   * is always the whole of what is owed and the CASE that would write
   * PARTIALLY_PAID cannot take its other arm. Nothing cancels an invoice
   * either: an unpaid one EXPIRES at its deadline and a reversed one goes back
   * to UNPAID, because a demand notice that was wrongly paid is still owed.
   */
  'invoices.status: PARTIALLY_PAID':
    'A payment is initiated against a transaction, never an amount, so it always settles the invoice in full.',
  'invoices.status: CANCELLED':
    'An unpaid invoice expires at its deadline; a reversed one returns to UNPAID because the demand still stands.',

  /*
   * The whole payment came back, and every row that records it says REVERSED.
   *
   * `transactions.status` keeps the distinction — a FULL refund is REFUNDED
   * and a REVERSAL is REVERSED — because that is the row the reports count.
   * The payment and the receipt take REVERSED either way, and both readers of
   * those columns treat the two words as one thing.
   */
  'payments.status: REFUNDED':
    'The reversal cascade writes REVERSED on the payment whichever kind of refund it was; the transaction carries the distinction.',
  'receipts.status: REFUNDED':
    'Same: a returned payment voids its receipt as REVERSED, and public verification reads the two words identically.',

  /*
   * A webhook delivered twice.
   *
   * `payment_webhook_events` is unique on (gateway, event_id), so a
   * redelivery inserts nothing and there is no second row for DUPLICATE to
   * describe. Overwriting the first row with it would lose the outcome that
   * matters — that the payment was processed — and redeliveries are counted
   * in the webhook metric instead.
   */
  'payment_webhook_events.processing_status: DUPLICATE':
    'The (gateway, event_id) key means a redelivery inserts no row; the first row keeps its own outcome and the metric counts the repeat.',

  /*
   * Codes for flows that do not exist. `/auth/otp/request` accepts STEP_UP and
   * nothing else, on purpose and with the reasoning recorded on the route:
   * there is no self-registration, no password reset and no OTP sign-in, and a
   * referee is verified by the link they were sent rather than by a code. The
   * purposes stay in the column ready for the flows that would use them.
   */
  'otp_codes.purpose: PASSWORD_RESET':
    'There is no password reset flow; the route offers STEP_UP alone.',
  'otp_codes.purpose: REGISTRATION':
    'There is no self-registration; an agent applies and an officer creates every other account.',
  'otp_codes.purpose: REFEREE_VERIFY':
    'A referee is verified by the invitation link they were sent, not by a code.',

  /*
   * An obligation the platform worked out for itself. Every obligation on the
   * register was put there by an agent at onboarding or by an officer
   * reviewing the record; `obligations.ts` names AUTO_RECOMMENDATION for the
   * derivation that has not been built.
   */
  'taxpayer_tax_obligations.source: AUTO_RECOMMENDATION':
    'Nothing derives an obligation automatically; every one is recorded by an agent or an officer.',

  /*
   * Transaction states nothing reaches.
   *
   * The transaction row is created already INVOICE_GENERATED, because the
   * assessment and the invoice are made together — ASSESSMENT_CREATED is real
   * as an event in `transaction_events` and is written there, and is never a
   * resting state. And nothing cancels a transaction: it expires, fails,
   * is abandoned, or is reversed.
   */
  'transactions.status: ASSESSMENT_CREATED':
    'Recorded as an event in transaction_events; the row itself is INVOICE_GENERATED from creation.',
  'transactions.status: CANCELLED':
    'A transaction expires, fails, is abandoned or is reversed; nothing cancels one.',

  'bank_accounts.status: BLOCKED':
    'An account is ACTIVE, PROPOSED or SUPERSEDED. Nothing blocks one — an agent with a suspect account is suspended, which stops the money at the agent rather than at the account.',
  'commission_payouts.status: PROCESSING':
    'Same shape as a refund: the transfer is requested and answered, never observed mid-flight. Left in the constraint deliberately when the payout path was audited, with the reasoning recorded there.',
  'documents.status: SUPERSEDED':
    'A document is ISSUED or REVOKED. Reissuing writes a new row and revokes the old one rather than marking it superseded; the only SUPERSEDED in the platform is on bank_accounts.',
  'group_attestation_invitations.status: REVOKED':
    'An attestation link expires; nothing withdraws one. The leader who should not have it is dealt with by not sending another.',
  'mock_gateway_transactions.status: ABANDONED':
    'The development gateway stub, which only ever succeeds or fails on command. Production refuses to boot on it.',
  'referee_invitations.status: REVOKED':
    'Same: a referee invitation expires rather than being withdrawn.',
  'refunds.status: PROCESSING':
    'A refund is asked of the gateway and answered in one call, so it goes PENDING to COMPLETED or FAILED with nothing in between. reconciliation.ts queries for PROCESSING in two places and those branches have never matched a row.',
  'settlements.status: RECEIVED':
    'A settlement row is created by recordSettlement, which already knows whether the money matched — so it is written RECONCILED or DISPUTED. There is no moment at which one is merely received.',
  'taxpayer_duplicate_checks.decision: LINKED_EXISTING':
    'The duplicate check blocks or proceeds. Linking a new registration to an existing record is the merge tool that does not exist — taxpayers.status MERGED above says the same thing from the other end.',
  'taxpayer_tax_obligations.status: DISPUTED':
    'An obligation is ACTIVE or WAIVED. A taxpayer disputing one raises a support ticket, which is a different record with its own lifecycle.',
  'transactions.channel: API':
    'Every transaction is raised by an agent on the PWA or an officer in the portal. There is no machine-to-machine channel; the webhook path confirms payments, it does not raise transactions.',
  'vehicle_renewals.status: PROCESSING':
    'A renewal is PENDING until its payment is verified and COMPLETED when the document is issued. Nothing watches it in between.',

  'taxpayers.status: MERGED':
    'Duplicates are refused at registration; no merge tool exists to move money between records.',
};

/**
 * States the platform can write and the suite never does.
 *
 * Kept apart from the list above, and the distinction is the whole point.
 * "Nothing writes this" is a statement about the platform. "No test covers
 * this" is a statement about the tests, and it is a gap of a different kind —
 * one that a runtime check would otherwise quietly launder into the first
 * list, where it would read as a decision somebody made.
 *
 * An entry here is an admission, not a justification. It says the code has a
 * path to this state and no test walks it.
 */
export const NOT_EXERCISED_BY_TESTS: Record<string, string> = {
  'agent_clearance_events.event_type: OVERRIDE_APPLIED':
    'Reachable from a path the suite does not walk.',
  'agents.account_status: CLOSED':
    'Reachable from a path the suite does not walk.',
  'agents.kyc_status: SUSPENDED':
    'Reachable from a path the suite does not walk.',
  'app_versions.app: AGENT_PWA':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'app_versions.app: PORTAL':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'fraud_flags.severity: LOW':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'group_attestation_invitations.status: EXPIRED':
    'Reachable from a path the suite does not walk.',
  'incentive_allocation_rounds.status: CLOSED':
    'Reachable from a path the suite does not walk.',
  'incentive_allocation_rounds.unit: BAG_25KG':
    'An officer picks the unit when opening a distribution round. The suite opens rounds in bags of 50kg.',
  'incentive_allocation_rounds.unit: KILOGRAM':
    'An officer picks the unit when opening a distribution round. The suite opens rounds in bags of 50kg.',
  'incentive_allocation_rounds.unit: LITRE':
    'An officer picks the unit when opening a distribution round. The suite opens rounds in bags of 50kg.',
  'incentive_allocation_rounds.unit: SEEDLING':
    'An officer picks the unit when opening a distribution round. The suite opens rounds in bags of 50kg.',
  'incentive_allocation_rounds.unit: TRACTOR_DAY':
    'An officer picks the unit when opening a distribution round. The suite opens rounds in bags of 50kg.',
  'incentive_allocation_rounds.unit: UNIT':
    'An officer picks the unit when opening a distribution round. The suite opens rounds in bags of 50kg.',
  'lgas.status: INACTIVE':
    'Reachable from a path the suite does not walk.',
  'mdas.status: INACTIVE':
    'Reachable from a path the suite does not walk.',
  'notification_templates.channel: PUSH':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'notifications.channel: EMAIL':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'offline_drafts.status: DUPLICATE':
    'Reachable from a path the suite does not walk.',
  'revenue_authorities.status: INACTIVE':
    'Reachable from a path the suite does not walk.',
  'revenue_categories.status: INACTIVE':
    'Reachable from a path the suite does not walk.',
  'revenue_items.frequency: QUARTERLY':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'revenue_items.status: DRAFT':
    'Reachable from a path the suite does not walk.',
  'taxpayer_groups.status: SUSPENDED':
    'Reachable from a path the suite does not walk.',
  'taxpayers.status: CLOSED':
    'Reachable from a path the suite does not walk.',
  'taxpayers.status: DRAFT':
    'Reachable from a path the suite does not walk.',
  'taxpayers.status: SUSPENDED':
    'Reachable from a path the suite does not walk.',
  'territories.status: INACTIVE':
    'Reachable from a path the suite does not walk.',
  'usage_events.connection: LIMITED':
    'Usage analytics are posted by the agent PWA with whatever connection it had. The suite posts from one shape of session.',
  'usage_events.connection: OFFLINE':
    'Usage analytics are posted by the agent PWA with whatever connection it had. The suite posts from one shape of session.',
  'usage_events.connection: ONLINE':
    'Usage analytics are posted by the agent PWA with whatever connection it had. The suite posts from one shape of session.',
  'usage_events.outcome: FAILED':
    'Usage analytics are posted by the agent PWA with whatever connection it had. The suite posts from one shape of session.',
  'users.status: CLOSED':
    'Reachable from a path the suite does not walk.',
  'vehicle_renewals.status: FAILED':
    'Reachable from a path the suite does not walk.',
  'vehicle_renewals.status: PAID':
    'Reachable from a path the suite does not walk.',
  'verification_attempts.lookup_type: INVOICE':
    'Reachable from a path the suite does not walk.',
  'wards.status: INACTIVE':
    'Reachable from a path the suite does not walk.',
};
