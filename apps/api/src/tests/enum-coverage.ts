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
  'agent_clearance.clearance_status: ACTION_REQUIRED':
    'Reachable from a path the suite does not walk.',
  'agent_clearance.clearance_status: REJECTED':
    'Reachable from a path the suite does not walk.',
  'agent_clearance_events.event_type: GOVERNMENT_REJECTED':
    'Reachable from a path the suite does not walk.',
  'agent_clearance_events.event_type: INFO_REQUESTED':
    'Reachable from a path the suite does not walk.',
  'agent_clearance_events.event_type: OVERRIDE_APPLIED':
    'Reachable from a path the suite does not walk.',
  'agent_clearance_events.event_type: REFEREE_FAILED':
    'Reachable from a path the suite does not walk.',
  'agent_kyc.identity_type: BVN':
    'The applicant chooses their document type and the suite always uses a NIN. Every value here is accepted input, validated by a shared enum.',
  'agent_kyc.identity_type: DRIVERS_LICENCE':
    'The applicant chooses their document type and the suite always uses a NIN. Every value here is accepted input, validated by a shared enum.',
  'agent_kyc.identity_type: OTHER':
    'The applicant chooses their document type and the suite always uses a NIN. Every value here is accepted input, validated by a shared enum.',
  'agent_kyc.identity_type: PASSPORT':
    'The applicant chooses their document type and the suite always uses a NIN. Every value here is accepted input, validated by a shared enum.',
  'agent_kyc.identity_type: VOTERS_CARD':
    'The applicant chooses their document type and the suite always uses a NIN. Every value here is accepted input, validated by a shared enum.',
  'agent_kyc.liveness_result: PASSED':
    'Reachable from a path the suite does not walk.',
  'agent_training_progress.status: FAILED':
    'Reachable from a path the suite does not walk.',
  'agent_training_progress.status: IN_PROGRESS':
    'Reachable from a path the suite does not walk.',
  'agents.account_status: CLOSED':
    'Reachable from a path the suite does not walk.',
  'agents.clearance_status: ACTION_REQUIRED':
    'Reachable from a path the suite does not walk.',
  'agents.clearance_status: REJECTED':
    'Reachable from a path the suite does not walk.',
  'agents.kyc_status: SUBMITTED':
    'Reachable from a path the suite does not walk.',
  'agents.kyc_status: SUSPENDED':
    'Reachable from a path the suite does not walk.',
  'agreement_versions.status: DRAFT':
    'Reachable from a path the suite does not walk.',
  'app_versions.app: AGENT_PWA':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'app_versions.app: PORTAL':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'approvals.approval_type: AGENT_ACTIVATION':
    'Every approval type is created by the same endpoint with a validated enum; the suite exercises the money-moving ones and leaves the rest.',
  'approvals.approval_type: AGENT_SUSPENSION':
    'Every approval type is created by the same endpoint with a validated enum; the suite exercises the money-moving ones and leaves the rest.',
  'approvals.approval_type: COMMISSION_ADJUSTMENT':
    'Every approval type is created by the same endpoint with a validated enum; the suite exercises the money-moving ones and leaves the rest.',
  'approvals.approval_type: MANUAL_CORRECTION':
    'Every approval type is created by the same endpoint with a validated enum; the suite exercises the money-moving ones and leaves the rest.',
  'approvals.approval_type: REFUND':
    'Every approval type is created by the same endpoint with a validated enum; the suite exercises the money-moving ones and leaves the rest.',
  'approvals.approval_type: REVENUE_RATE_CHANGE':
    'Every approval type is created by the same endpoint with a validated enum; the suite exercises the money-moving ones and leaves the rest.',
  'approvals.approval_type: TAXPAYER_ADJUSTMENT':
    'Every approval type is created by the same endpoint with a validated enum; the suite exercises the money-moving ones and leaves the rest.',
  'approvals.status: CANCELLED':
    'Reachable from a path the suite does not walk.',
  'approvals.status: REVIEWED':
    'Reachable from a path the suite does not walk.',
  'assessments.assessment_type: SELF_ASSESSMENT':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'assessments.status: CANCELLED':
    'Reachable from a path the suite does not walk.',
  'assessments.status: DRAFT':
    'Reachable from a path the suite does not walk.',
  'assessments.status: SETTLED':
    'Reachable from a path the suite does not walk.',
  'commission_policies.settlement_schedule: DAILY':
    'Reachable from a path the suite does not walk.',
  'commission_policies.settlement_schedule: MONTHLY':
    'Reachable from a path the suite does not walk.',
  'commissions.status: CANCELLED':
    'Reachable from a path the suite does not walk.',
  'documents.document_type: ASSESSMENT':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'documents.document_type: PAYMENT_EVIDENCE':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'documents.document_type: TIN_CONFIRMATION':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'documents.owner_type: AGENT':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'fraud_flags.entity_type: COMMISSION':
    'Reachable from a path the suite does not walk.',
  'fraud_flags.entity_type: REFEREE':
    'Reachable from a path the suite does not walk.',
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
  'invoices.status: CANCELLED':
    'Reachable from a path the suite does not walk.',
  'invoices.status: PARTIALLY_PAID':
    'Reachable from a path the suite does not walk.',
  'kyc_document_access_logs.access_type: DOWNLOAD':
    'Reachable from a path the suite does not walk.',
  'kyc_documents.capture_source: FILE':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'kyc_documents.document_type: ADDITIONAL_IDENTIFICATION':
    'The suite uploads the one document type the clearance checklist requires; the rest are optional captures no test exercises.',
  'kyc_documents.document_type: PASSPORT_PHOTOGRAPH':
    'The suite uploads the one document type the clearance checklist requires; the rest are optional captures no test exercises.',
  'kyc_documents.document_type: PROOF_OF_ADDRESS':
    'The suite uploads the one document type the clearance checklist requires; the rest are optional captures no test exercises.',
  'kyc_documents.document_type: SELFIE':
    'The suite uploads the one document type the clearance checklist requires; the rest are optional captures no test exercises.',
  'kyc_documents.document_type: SUPPORTING_DOCUMENT':
    'The suite uploads the one document type the clearance checklist requires; the rest are optional captures no test exercises.',
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
  'otp_codes.purpose: PASSWORD_RESET':
    'Reachable from a path the suite does not walk.',
  'otp_codes.purpose: REFEREE_VERIFY':
    'Reachable from a path the suite does not walk.',
  'otp_codes.purpose: REGISTRATION':
    'Reachable from a path the suite does not walk.',
  'payment_webhook_events.processing_status: DUPLICATE':
    'Reachable from a path the suite does not walk.',
  'payment_webhook_events.processing_status: IGNORED':
    'Reachable from a path the suite does not walk.',
  'payments.payment_method: ACCOUNT_TRANSFER':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'payments.payment_method: BANK_TRANSFER':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'payments.payment_method: USSD':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'payments.status: ABANDONED':
    'Reachable from a path the suite does not walk.',
  'payments.status: REFUNDED':
    'Reachable from a path the suite does not walk.',
  'receipts.status: REFUNDED':
    'Reachable from a path the suite does not walk.',
  'reconciliation_records.status: PENDING':
    'Reachable from a path the suite does not walk.',
  'reconciliation_records.status: REVERSED':
    'Reachable from a path the suite does not walk.',
  'reconciliation_runs.status: FAILED':
    'Reachable from a path the suite does not walk.',
  'referee_invitations.channel: EMAIL':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'referee_invitations.status: EXPIRED':
    'Reachable from a path the suite does not walk.',
  'referee_kyc.identity_type: BVN':
    'The applicant chooses their document type and the suite always uses a NIN. Every value here is accepted input, validated by a shared enum.',
  'referee_kyc.identity_type: DRIVERS_LICENCE':
    'The applicant chooses their document type and the suite always uses a NIN. Every value here is accepted input, validated by a shared enum.',
  'referee_kyc.identity_type: OTHER':
    'The applicant chooses their document type and the suite always uses a NIN. Every value here is accepted input, validated by a shared enum.',
  'referee_kyc.identity_type: PASSPORT':
    'The applicant chooses their document type and the suite always uses a NIN. Every value here is accepted input, validated by a shared enum.',
  'referee_kyc.identity_type: VOTERS_CARD':
    'The applicant chooses their document type and the suite always uses a NIN. Every value here is accepted input, validated by a shared enum.',
  'referee_kyc.verification_status: FAILED':
    'Reachable from a path the suite does not walk.',
  'referee_kyc.verification_status: UNDER_REVIEW':
    'Reachable from a path the suite does not walk.',
  'referee_risk_flags.severity: HIGH':
    'Referee risk flags are raised and read; no test drives one through review, so the severities and decisions below it are unexercised.',
  'referee_risk_flags.severity: LOW':
    'Referee risk flags are raised and read; no test drives one through review, so the severities and decisions below it are unexercised.',
  'referee_risk_flags.severity: MEDIUM':
    'Referee risk flags are raised and read; no test drives one through review, so the severities and decisions below it are unexercised.',
  'referee_risk_flags.status: CONFIRMED':
    'Referee risk flags are raised and read; no test drives one through review, so the severities and decisions below it are unexercised.',
  'referee_risk_flags.status: DISMISSED':
    'Referee risk flags are raised and read; no test drives one through review, so the severities and decisions below it are unexercised.',
  'referee_risk_flags.status: UNDER_REVIEW':
    'Referee risk flags are raised and read; no test drives one through review, so the severities and decisions below it are unexercised.',
  'referees.category: EMPLOYER':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'referees.category: RECOGNISED_PROFESSIONAL':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'referees.category: TRADITIONAL_AUTHORITY':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'referees.status: EXPIRED':
    'Reachable from a path the suite does not walk.',
  'referees.status: FAILED':
    'Reachable from a path the suite does not walk.',
  'referees.status: UNDER_REVIEW':
    'Reachable from a path the suite does not walk.',
  'refunds.attributable_to: GATEWAY':
    'Reachable from a path the suite does not walk.',
  'revenue_authorities.status: INACTIVE':
    'Reachable from a path the suite does not walk.',
  'revenue_categories.status: INACTIVE':
    'Reachable from a path the suite does not walk.',
  'revenue_items.frequency: QUARTERLY':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'revenue_items.status: DRAFT':
    'Reachable from a path the suite does not walk.',
  'support_tickets.category: INCORRECT_ASSESSMENT':
    'Support tickets are exercised on one category, one priority and the open-to-resolved path. The other values are reachable from the same screen and no test picks them.',
  'support_tickets.category: RECEIPT_ISSUE':
    'Support tickets are exercised on one category, one priority and the open-to-resolved path. The other values are reachable from the same screen and no test picks them.',
  'support_tickets.category: TAXPAYER_COMPLAINT':
    'Support tickets are exercised on one category, one priority and the open-to-resolved path. The other values are reachable from the same screen and no test picks them.',
  'support_tickets.category: TECHNICAL_ISSUE':
    'Support tickets are exercised on one category, one priority and the open-to-resolved path. The other values are reachable from the same screen and no test picks them.',
  'support_tickets.category: TIN_ISSUE':
    'Support tickets are exercised on one category, one priority and the open-to-resolved path. The other values are reachable from the same screen and no test picks them.',
  'support_tickets.category: VEHICLE_ISSUE':
    'Support tickets are exercised on one category, one priority and the open-to-resolved path. The other values are reachable from the same screen and no test picks them.',
  'support_tickets.priority: LOW':
    'Support tickets are exercised on one category, one priority and the open-to-resolved path. The other values are reachable from the same screen and no test picks them.',
  'support_tickets.priority: URGENT':
    'Support tickets are exercised on one category, one priority and the open-to-resolved path. The other values are reachable from the same screen and no test picks them.',
  'support_tickets.status: ASSIGNED':
    'Support tickets are exercised on one category, one priority and the open-to-resolved path. The other values are reachable from the same screen and no test picks them.',
  'taxpayer_groups.status: SUSPENDED':
    'Reachable from a path the suite does not walk.',
  'taxpayer_tax_obligations.source: AUTO_RECOMMENDATION':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'taxpayers.gender: FEMALE':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'taxpayers.gender: MALE':
    'Accepted input, validated where it enters. The suite exercises one value of the set and this is one of the others.',
  'taxpayers.status: CLOSED':
    'Reachable from a path the suite does not walk.',
  'taxpayers.status: DRAFT':
    'Reachable from a path the suite does not walk.',
  'taxpayers.status: SUSPENDED':
    'Reachable from a path the suite does not walk.',
  'territories.status: INACTIVE':
    'Reachable from a path the suite does not walk.',
  'transactions.status: ASSESSMENT_CREATED':
    'Reachable from a path the suite does not walk.',
  'transactions.status: CANCELLED':
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
