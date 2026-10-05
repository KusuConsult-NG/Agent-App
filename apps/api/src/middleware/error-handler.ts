/**
 * Central error handling (PRD §60).
 *
 * Two jobs: never leak internals to a caller, and never leave a field agent
 * guessing about money. Database constraint violations — which on this platform
 * *are* the financial controls — are translated into the specific, actionable
 * message that explains which control fired.
 */

import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  IllegalTransitionError,
  MoneyError,
  REVENUE_RECOGNISED_STATES,
} from '@psirs/shared';
import { AppError, internal, validationFailed, type MoneyStatus } from '../lib/errors';
import { log } from '../lib/logger';
import { reportError } from '../services/error-reporting';

interface PostgresError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
  hint?: string;
  table?: string;
}

function isPostgresError(error: unknown): error is PostgresError {
  return error instanceof Error && typeof (error as PostgresError).code === 'string';
}

/**
 * Map unique-constraint names to language the caller can act on.
 *
 * Exported, with the overlap map below, only so a test can hold every key in
 * both to the names the live schema actually has. A key is a string matched
 * against `error.constraint`, so a renamed index or a mistyped name does not
 * fail anything — it silently returns the generic sentence, which is the
 * failure mode these messages exist to avoid.
 */
export const UNIQUE_CONSTRAINT_MESSAGES: Record<string, string> = {
  taxpayers_tin_key: 'A taxpayer with this TIN already exists.',
  approvals_one_open_invoice_withdrawal:
    'A request to withdraw this invoice is already waiting for a decision.',
  /*
   * 086. Registration absorbs this one — `registerTaxpayer` catches it by name
   * and raises TAXPAYER_ALREADY_EXISTS, which names the record and is said in
   * Hausa — so the path that reaches this message is the other one: putting a
   * closed record back on the register while a live record carries the same
   * identification number. That is two live records for one person, which is
   * what the index exists to prevent, and the officer doing it is the person
   * who can resolve which record should be the live one.
   */
  /*
   * 087. `nominateReferee` holds an advisory lock on the application, so its
   * own `REFEREE_ALREADY_NOMINATED` normally answers first and says what to do
   * — wait for a response, or request a replacement. This is the backstop for
   * a caller that does not come through that function, worded to say the same
   * thing, because somebody meeting one of the two has no way of knowing which.
   */
  idx_referees_one_active:
    'A referee request is already outstanding for this application. Wait for a response, ' +
    'or request a replacement.',
  idx_taxpayers_identity_live:
    'Another taxpayer on the register already has that identification number. Two live ' +
    'records for one person cannot both stand — resolve the duplicate before putting this ' +
    'record back on the register.',
  users_phone_key: 'This phone number is already registered.',
  users_email_key: 'This email address is already registered.',
  receipts_receipt_number_key: 'That receipt number has already been issued.',
  receipts_transaction_id_key: 'A receipt has already been issued for this transaction.',
  invoices_invoice_number_key: 'That invoice number has already been issued.',
  payments_gateway_reference_key:
    'This gateway payment has already been recorded. No duplicate has been created.',
  transactions_transaction_reference_key: 'That transaction reference already exists.',
  commissions_transaction_id_key: 'Commission has already been recorded for this transaction.',
  idx_payments_one_active:
    'A payment is already in progress for this invoice. Check its status before starting another.',
  payment_webhook_events_gateway_event_id_key:
    'This webhook event has already been processed.',
  vehicles_registration_number_key: 'A vehicle with this registration number already exists.',
  agents_user_id_key: 'This user already has an agent application.',

  /*
   * FIVE MORE THAT A PERSON CAN COLLIDE WITH.
   *
   * The fallback is "That record already exists. No duplicate has been
   * created." It is true, it is reassuring about the duplicate, and it names
   * nothing — so on a form with a dozen fields the person is not told which
   * one clashed.
   *
   * `users_staff_number_key` is the clearest of them. Phone and email are two
   * lines above, both with a message; a staff number is the third identifier on
   * the same table and had none, so an administrator creating an officer was
   * told a record existed without being told which of the three it was.
   *
   * The PAYE one already had its sentence — `filePayeSchedule` reads the month
   * first and refuses with it — but that read cannot see an uncommitted filing,
   * so two officers filing one month together leave the loser with the generic
   * line instead of the one that says what to do about it. The constraint is
   * where the rule actually holds, so the words belong here too.
   *
   * Every other unique index in the schema is now classified too, either with a
   * message below or in `UNIQUE_CONSTRAINT_NOT_SHOWN` with the reason it has
   * none. This paragraph used to say there were twelve of them. There were
   * seventy-one.
   *
   * And then there were eight more, because the check that counts them
   * excluded primary keys on a reason that did not hold: not all of them are a
   * uuid with a random default. Three of the eight are natural keys. Two
   * figures asserted off an impression in one file, which is why the check now
   * reads the column type and the default rather than the word "primary".
   *
   * AND A CLAIM FROM THE SAME PARAGRAPH THAT WAS ALSO WRONG.
   *
   * It said that because DUPLICATE_RECORD is not in the agent application's
   * translation map, "for the two bank account rules a Hausa-reading agent
   * still reads English". An agent does not reach either rule.
   * `requestBankAccountChange` opens its transaction with
   * `SELECT ... FROM agents ... FOR UPDATE OF a` and then looks for a PROPOSED
   * row, so two simultaneous requests are ordered by the lock and the second
   * one's pre-check refuses with `BANK_CHANGE_ALREADY_PENDING` — which the
   * agent application does translate.
   *
   * Measured rather than reasoned, in `concurrency/bank-change-race.test.ts`:
   * the agent's own route and an officer's route driven at once leave one
   * proposal, and the loser is refused by name. Remove the lock and the loser
   * gets the raw 23505 instead, which is how the claim above would have become
   * true. Both messages stay — a backstop that fires should still be legible —
   * but they are backstops, and saying an agent reads them was wrong.
   *
   * DUPLICATE_RECORD remains untranslated in the agent application, and that
   * remains worth fixing for the constraints an agent CAN reach. It is
   * recorded in `docs/HAUSA-REVIEW-QUESTIONS.md` with the rest of question 7.
   */
  users_staff_number_key: 'That staff number already belongs to another officer.',
  idx_paye_one_live_filing:
    'A return has already been filed for this employer and month. Cancel that one before ' +
    'filing again — a second filing would double what the employer appears to owe.',
  bank_accounts_one_active_per_owner:
    'This holder already has an account in use. A new one replaces it rather than joining it.',
  bank_accounts_one_proposal_per_owner:
    'A change to this account is already waiting for a decision. It has to be approved or ' +
    'refused before another can be proposed.',
  obligation_unique: 'This taxpayer already has that tax or levy on their record.',

  /*
   * A SECOND PASS, AFTER COUNTING WHAT WAS LEFT.
   *
   * The comment below this block used to say "twelve other named constraints
   * still fall back, deliberately". Counted against the live schema there are
   * seventy-one, which is wrong by a factor of six — the same mistake, on the
   * same kind of figure, as the "twenty-six refusals" this branch had to
   * correct in `71e4c7d`. Both came from reading rather than counting.
   *
   * So all seventy-one were classified, each against its own definition and
   * the code that writes the table. The ones a person can collide with by
   * doing their work are here; the rest are in
   * `UNIQUE_CONSTRAINT_NOT_SHOWN` with the reason each one is not. A new
   * unique index has to be in one or the other: `a-message-nobody-would-ever-
   * see.test.ts` reads the schema and refuses an unclassified one, which is
   * what would have stopped the figure above being written down wrong.
   */

  // Reference data an officer creates and names. The clash is always the code
  // or the label they typed, and the generic sentence names neither.
  departments_code_key: 'A department already uses that code. Give this one a different one.',
  revenue_items_code_key:
    'A revenue item already uses that code. Codes appear on receipts and in reports, so ' +
    'each one has to belong to a single charge.',
  revenue_offices_code_key: 'A revenue office already uses that code.',
  incentive_programmes_code_key: 'A programme already uses that code.',
  financial_periods_label_key:
    'A financial period is already called that. Period labels appear on every report, ' +
    'so two periods cannot share one.',

  /*
   * Doing the same thing twice. Each of these is a rule rather than an
   * accident of naming, and the sentence says what the rule is.
   */
  audit_sample_items_sample_id_transaction_id_key:
    'That transaction is already in this sample. A sample counts each one once.',
  audit_sample_items_sample_id_position_key:
    'That position in the sample is already taken.',
  incentive_awards_round_id_taxpayer_id_key:
    'This taxpayer has already been awarded in this round. A round pays each person once.',
  programme_eligibility_programme_id_taxpayer_id_key:
    'This taxpayer is already recorded against that programme.',
  officer_devices_user_id_fingerprint_key:
    'That computer is already registered to this officer.',

  /*
   * ONE LIVE THING AT A TIME.
   *
   * Partial unique indexes, each enforcing that a record has one current
   * version. The generic sentence is actively unhelpful here, because it
   * reassures the officer that nothing was duplicated and does not tell them
   * the thing to do: end the current one first.
   */
  idx_rates_current:
    'This revenue item already has a rate in force for that Local Government Area. ' +
    'Give the current rate an end date first, then publish the new one.',
  revenue_item_rates_item_lga_version_key:
    'That rate version number has already been used for this item. Somebody may have ' +
    'published a rate at the same moment — read the rate history before publishing again.',
  idx_settings_current:
    'That setting already has a current value. The existing one has to be superseded ' +
    'rather than added to.',
  idx_agent_kyc_current:
    "This agent already has a current identity check. Supersede it before recording another.",
  // Unreachable through `storeKycDocument`, which locks per owner and type and
  // supersedes first. The sentence is for anything that writes the table
  // without going through it, and says what the lock would have done.
  idx_kyc_docs_one_current_per_agent:
    'Another capture of this document arrived at the same moment. Capture it again; the newer one will replace it.',
  idx_kyc_docs_one_current_per_referee:
    'Another capture of this document arrived at the same moment. Capture it again; the newer one will replace it.',
  revenue_targets_one_live_per_scope:
    'A target is already running for that scope and period. Close it before setting another, ' +
    'or two figures will claim to be the target for the same work.',
  idx_connections_live:
    'That connection is already recorded against this taxpayer from the same source.',
  idx_one_assessment_per_observation:
    'That observation already has a presumptive assessment. Withdraw it before raising another.',
  documents_one_acknowledgement_per_transaction:
    'An acknowledgement has already been issued for this transaction.',
  idx_commissions_recovered_once:
    'That commission has already been recovered. It cannot be recovered twice.',
  /*
   * Added by migration 084, and required here by the check that reads the
   * schema — which is the check working: a new unique index is classified or
   * the build stops.
   *
   * `raiseObjection` answers `OBJECTION_ALREADY_OPEN` before reaching the
   * index, so this is the backstop for a caller that does not come through the
   * service. Worded to say the same thing, because somebody meeting one of
   * them has no way of knowing which they met.
   */
  idx_objections_open:
    'An objection to this estimate is already open and waiting for a decision.',
  receipts_payment_id_key:
    'A receipt has already been issued for this payment. No duplicate has been created.',

  /*
   * THREE PRIMARY KEYS THAT ARE NATURAL KEYS.
   *
   * The check that reads the schema used to exclude primary keys outright, on
   * the stated grounds that every one is a uuid with a random default so a
   * violation is a collision in a random number. Eight are not, and three of
   * those are on columns a person types or chooses — so a violation is
   * something somebody did, and "that record already exists" is as unhelpful
   * here as anywhere else.
   *
   * Each has a pre-check that answers better: `ROLE_EXISTS` names the role,
   * `ALREADY_GRANTED` names the role and the permission. These are the
   * backstops for when two administrators act at the same moment, which is
   * what the pre-checks cannot see.
   */
  roles_pkey: 'A role already uses that name. Role names appear on every officer’s account.',
  role_permissions_pkey: 'That permission is already granted to this role.',
  user_territories_pkey: 'That territory is already assigned to this officer.',
};

/**
 * Map overlap-constraint names to language the caller can act on.
 *
 * The same idea as the unique map above, for exclusion constraints. Five carry
 * one, and each is a rule about something not being covered twice: two
 * financial months, two classes for one LGA, two readings of the nano
 * exemption, two figures for one cell of the presumptive schedule, and two
 * live bills for one assessment.
 *
 * Each carries its own next step, because the remedy differs and the shared
 * one was wrong for all five. It said "close the existing record by giving it
 * an end date", which no screen could do for the three presumptive tables,
 * which a financial period already has, and which means nothing for a bill.
 * And the sentence under `presumptive_no_overlap` described a taxpayer's
 * assessment, where the constraint is on the schedule: an officer publishing a
 * figure was told about somebody's bill.
 *
 * A new presumptive record now replaces the one in force on its start date
 * (`endWhatThisReplaces`), so these three fire only when the new record would
 * run into one already published from a later date.
 */
export const OVERLAP_CONSTRAINT_MESSAGES: Record<string, { message: string; nextStep: string }> = {
  financial_periods_do_not_overlap: {
    message: 'A financial period already covers part of those dates. Periods cannot overlap.',
    nextStep: 'Choose dates that begin after the existing period ends, or end before it begins.',
  },
  lga_class_no_overlap: {
    message:
      'This LGA already has a class published from a later date, and the new class would ' +
      'run into it.',
    nextStep:
      'Give the new class an end date on or before the later one begins, or publish it ' +
      'from that date.',
  },
  nano_policy_no_overlap: {
    message:
      'A reading of the nano exemption has already been adopted from a later date, and the ' +
      'new one would run into it.',
    nextStep: 'Adopt the new reading from the date the later one takes effect, or after it.',
  },
  presumptive_no_overlap: {
    message:
      'This cell of the presumptive schedule already has a figure published from a later ' +
      'date, and the new figure would run into it.',
    nextStep:
      'Give the new figure an end date on or before the later one begins, or publish it ' +
      'from that date.',
  },
  invoices_one_live_per_assessment: {
    message:
      'This bill has already been issued again. Open the bill that replaced it rather than ' +
      'issuing another.',
    nextStep: "Open the replacement bill from the taxpayer's record.",
  },
};

/**
 * Unique constraints whose violation no person is shown, and why each one.
 *
 * The companion to the map above, and the reason a figure in this file can no
 * longer be guessed. Seventy-one constraints had no message; these are the ones
 * that should not have one, each checked against its own definition and against
 * the code that writes its table rather than against an impression.
 *
 * Four kinds, and the difference between them matters more than the list:
 *
 *   ABSORBED       the write is an upsert, so the constraint never raises.
 *   SEEDED         nothing inserts into the table outside `db/seed.ts`, so no
 *                  request can reach the constraint at all.
 *   GENERATED      the column is a reference the platform composes. A clash is
 *                  a fault in a generator, not something the person did. These
 *                  no longer answer with the duplicate sentence: see
 *                  `GENERATED_REFERENCE_CONSTRAINTS` below, which is the commit
 *                  this entry used to say it was waiting for.
 *   INTERNAL       the row belongs to the platform talking to itself.
 */
export const UNIQUE_CONSTRAINT_NOT_SHOWN: Record<string, string> = {
  // ABSORBED — `ON CONFLICT ... DO NOTHING` or `DO UPDATE` on every writer.
  agent_devices_agent_id_device_identifier_key:
    'ABSORBED. `registerDevice` upserts on exactly this key; the 500 that used to come ' +
    'from two simultaneous taps was fixed in 9cdc684 by making the insert an upsert.',
  agent_clearance_agent_id_key: 'ABSORBED. Every writer upserts on the agent.',
  taxpayer_compliance_taxpayer_id_key: 'ABSORBED. The compliance sweep upserts.',
  agent_training_progress_agent_id_module_id_key: 'ABSORBED. An attempt upserts.',
  agent_agreements_agent_id_agreement_version_id_key: 'ABSORBED. Acceptance upserts.',
  taxpayer_group_members_group_id_taxpayer_id_key: 'ABSORBED. Recording a member upserts.',
  officer_notifications_one_unread_per_subject:
    'ABSORBED. The point of the index is to collapse repeat notifications, and the insert ' +
    'upserts on it rather than raising.',
  idempotency_keys_scope_idempotency_key_key:
    'ABSORBED. The middleware upserts on it; that is how a replay is recognised.',
  offline_drafts_agent_id_client_reference_key:
    'ABSORBED. `/drafts/sync` upserts and answers DUPLICATE per draft, which is a ' +
    'per-draft status in the batch response rather than a refusal of the request.',

  // SEEDED — no insert outside `db/seed.ts`, so no request reaches these.
  lgas_code_key: 'SEEDED. Geography is reference data; no endpoint creates an LGA.',
  lgas_name_key: 'SEEDED. Same.',
  wards_lga_id_name_key: 'SEEDED. Wards are seeded with their LGA.',
  mdas_code_key: 'SEEDED. The ministry list is reference data.',
  mdas_authority_id_name_key: 'SEEDED. Same.',
  revenue_authorities_code_key: 'SEEDED. The authority tree is reference data.',
  revenue_authorities_name_key: 'SEEDED. Same.',
  revenue_categories_code_key: 'SEEDED. Categories are seeded with the catalogue.',
  revenue_categories_authority_id_name_key: 'SEEDED. Same.',
  training_modules_code_key: 'SEEDED. The modules are reference data.',
  notification_templates_code_key: 'SEEDED. The templates are reference data.',
  notification_templates_event_channel_language_key: 'SEEDED. Same.',
  commission_policies_code_key: 'SEEDED. The policy is reference data.',
  agreement_versions_version_key: 'SEEDED. Agreement versions are seeded active.',
  territories_code_key:
    'SEEDED. A territory is reassigned between agents by UPDATE; nothing inserts one ' +
    'outside the seed.',

  // GENERATED — a clash is a generator fault, not the person's.
  agents_agent_code_key: 'GENERATED. `AGT-00042`, composed on clearance.',
  agents_application_number_key: 'GENERATED. Composed on application.',
  assessments_assessment_number_key: 'GENERATED.',
  audit_reports_report_number_key: 'GENERATED.',
  audit_samples_sample_number_key: 'GENERATED.',
  cases_case_number_key: 'GENERATED.',
  commission_payouts_payout_reference_key: 'GENERATED.',
  documents_document_number_key: 'GENERATED.',
  documents_verification_code_key: 'GENERATED. A public verification code.',
  invoices_verification_code_key: 'GENERATED. Same.',
  receipts_verification_code_key: 'GENERATED. Same.',
  payments_payment_reference_key: 'GENERATED.',
  refunds_refund_reference_key: 'GENERATED.',
  settlements_settlement_reference_key: 'GENERATED.',
  support_tickets_ticket_number_key: 'GENERATED.',
  vehicle_renewals_document_number_key: 'GENERATED.',
  taxpayer_groups_code_key: 'GENERATED. `GRP/2026/000001`.',
  referees_reference_code_key: 'GENERATED.',
  incentive_awards_collection_code_key: 'GENERATED. The code a winner collects against.',

  // ABSORBED — the three primary keys on a name or a key that every writer
  // upserts on. Each is a single row per subject, kept up to date rather than
  // inserted again.
  background_jobs_pkey: 'ABSORBED. The scheduler upserts on the job name.',
  integration_health_pkey:
    'ABSORBED. Every call upserts on the integration name — `ON CONFLICT (name) DO UPDATE`, ' +
    'which is how the counters accumulate.',
  rate_limit_buckets_pkey: 'ABSORBED. The limiter upserts on the bucket key.',

  // INTERNAL — the platform talking to itself.
  schema_migrations_pkey: 'INTERNAL. A sequence, in the migration runner.',
  usage_events_pkey: 'INTERNAL. A sequence.',
  audit_logs_sequence_no_key: 'INTERNAL. The audit chain numbers its own entries.',
  schema_migrations_filename_key: 'INTERNAL. The migration runner.',
  sessions_refresh_token_hash_key: 'INTERNAL. A token hash; a clash is a generator fault.',
  push_subscriptions_endpoint_key:
    'INTERNAL. Re-subscribing the same browser endpoint is handled where it is stored.',
  mock_gateway_transactions_gateway_reference_key: 'INTERNAL. The demonstration gateway.',
  gateway_statement_lines_gateway_gateway_reference_key:
    'INTERNAL. A statement line the reconciliation sweep reads; a redelivered statement ' +
    'is the sweep\u2019s business and not a caller\u2019s.',
  group_attestation_invitations_invitation_token_hash_key:
    'INTERNAL. A token hash, generated.',
  referee_invitations_invitation_token_hash_key: 'INTERNAL. Same.',
};

/**
 * The GENERATED entries above, as a set the handler can read.
 *
 * A clash on one of these is a fault in a generator — two composed references
 * meeting — and until now it was answered with the duplicate sentence: 409,
 * "That record already exists. No duplicate has been created.", and
 * `moneyStatus: NOT_DEBITED`.
 *
 * All three parts are wrong here, and the third is the one that matters.
 * NOT_DEBITED means "no payment was attempted", and the agent application
 * renders it as "No money has been taken from the taxpayer" — in Hausa too.
 * `receipts_verification_code_key` and `documents_verification_code_key` are
 * reached while issuing a receipt, which happens after the money has arrived;
 * `payments_payment_reference_key` is reached inside `initiatePayment`, which
 * may already have called the gateway. So the sentence was a reassurance
 * offered at the one moment the platform could not support it, to the person
 * standing in front of somebody who has just handed over cash. `internal()`
 * carries the identical correction in its own header, for the identical
 * reason; this branch had not had it.
 *
 * So these answer as what they are: a fault on our side, with a reference to
 * quote, and the money state `internal()` derives from the request — which is
 * UNCONFIRMED for a write under `/payments` and NOT_APPLICABLE elsewhere.
 *
 * Derived from the map rather than typed twice:
 * `a-message-nobody-would-ever-see.test.ts` asserts this set is exactly the
 * entries whose reason begins GENERATED, so a new one cannot be classified in
 * the comment and missed here.
 */
export const GENERATED_REFERENCE_CONSTRAINTS: ReadonlySet<string> = new Set(
  Object.entries(UNIQUE_CONSTRAINT_NOT_SHOWN)
    .filter(([, reason]) => reason.startsWith('GENERATED'))
    .map(([name]) => name),
);

/**
 * What a refused transition may say about the taxpayer's money.
 *
 * This answered `NOT_DEBITED` for every one of them, which `MoneyStatus`
 * defines as "No payment was attempted" and the agent application renders as
 * "No money has been taken from the taxpayer" — in Hausa too, in plain
 * styling rather than the warning styling it reserves for "do not collect
 * again".
 *
 * A refused transition means this request changed nothing: the state machine
 * would not move the record. So the honest answer is what the record already
 * said, and the error carries it. A re-receipt attempt against a SETTLED
 * transaction was being refused *because* the money had arrived, and answered
 * with the one sentence that contradicts the state it was refused by.
 *
 * The entity matters as much as the state. A commission is the agent's fee;
 * telling them nothing was taken from the taxpayer answers a question nobody
 * asked, and `requestPayout` transitions commissions, so an agent could reach
 * it. Only the two machines that track a citizen's payment say anything here.
 *
 * REVERSED, REFUNDED, FAILED, CANCELLED and EXPIRED fall to NOT_DEBITED with
 * the pre-payment states, which reads oddly for the first two and is right
 * about the thing the sentence is for: whether the taxpayer is out of pocket
 * now. They are not.
 */
function refusedTransitionMoney(error: IllegalTransitionError): MoneyStatus {
  const received: Record<string, readonly string[]> = {
    // "States in which government money is considered actually received."
    Transaction: REVENUE_RECOGNISED_STATES,
    Payment: ['SUCCESSFUL', 'VERIFIED'],
  };
  const inFlight: Record<string, readonly string[]> = {
    Transaction: ['PAYMENT_INITIATED', 'PAYMENT_PENDING', 'PAYMENT_SUCCESSFUL'],
    Payment: ['INITIATED', 'PENDING'],
  };

  if (!(error.entity in received)) return 'NOT_APPLICABLE';
  if (received[error.entity]!.includes(error.from)) return 'RECEIVED';
  if (inFlight[error.entity]!.includes(error.from)) return 'UNCONFIRMED';
  return 'NOT_DEBITED';
}

/**
 * What a refusal the database raised may claim about the taxpayer's money.
 *
 * These five branches answered `NOT_DEBITED` whatever the request was, and on
 * a write under `/payments` that claim cannot be supported. 40001 and 40P01
 * are the database saying this transaction lost a race — and the one that beat
 * it may have been the confirmation that verified the payment. A duplicate met
 * while confirming is the same: an acknowledgement exists because the money
 * arrived, so the row that caused the refusal refutes the sentence.
 *
 * The rule is `internal()`'s, which `lib/errors.ts` calls "the client's own,
 * mirrored" — a write under `/payments` whose outcome is unknown says
 * UNCONFIRMED, and that carries the right instruction with it: "A payment is
 * in flight and its outcome is not yet known. Do not retry."
 *
 * Narrow on purpose. Away from the payment path NOT_DEBITED is both true and
 * unread: two officers colliding over a department code have moved nobody's
 * money, and the portal renders no money sentence at all. The reader this
 * matters to is the agent standing in front of somebody who has handed over
 * cash.
 */
function refusalMoney(req: Request): MoneyStatus {
  const write = req.method.toUpperCase() !== 'GET';
  return write && req.path.startsWith('/payments') ? 'UNCONFIRMED' : 'NOT_DEBITED';
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) return;

  if (error instanceof AppError) {
    if (!error.expose) {
      log.error('request failed', {
        requestId: req.requestId,
        component: 'http',
        // `errorCode`, not `code`: the redactor catches any key containing
        // "code" so that a collection code cannot be logged, and this field —
        // the one an operator filters on — was being removed by it.
        errorCode: error.code,
        path: req.path,
        error,
      });
    }
    res.status(error.statusCode).json(error.toJSON());
    return;
  }

  /*
   * A body that is not JSON.
   *
   * body-parser raises a SyntaxError before any handler runs, and it arrived
   * here as an unrecognised error — so a client sending malformed bytes was
   * told "a problem on our side. No financial record has been changed", with
   * a 500 behind it.
   *
   * Untrue, and expensively so. Nothing on our side went wrong, and a 500 on
   * a government revenue platform is an alert: one handset with a broken
   * request could page an on-call engineer repeatedly for its own typo, which
   * is how a team learns to ignore its alerts. The money status was right by
   * luck — nothing was debited because nothing was read — and is now stated
   * on purpose.
   */
  if (
    error instanceof SyntaxError &&
    'body' in error &&
    typeof (error as { status?: number }).status === 'number'
  ) {
    res.status(400).json(
      new AppError({
        statusCode: 400,
        code: 'MALFORMED_BODY',
        message: 'The request body could not be read. It is not valid JSON.',
        moneyStatus: 'NOT_DEBITED',
        nextStep: 'Check the request and send it again.',
      }).toJSON(),
    );
    return;
  }

  if (error instanceof ZodError) {
    res.status(422).json(
      validationFailed(
        error.issues.map((issue) => ({
          field: issue.path.join('.') || undefined,
          issue: issue.message,
        })),
      ).toJSON(),
    );
    return;
  }

  if (error instanceof MoneyError) {
    res.status(422).json(
      new AppError({
        statusCode: 422,
        code: 'INVALID_AMOUNT',
        message: error.message,
        moneyStatus: 'NOT_DEBITED',
      }).toJSON(),
    );
    return;
  }

  if (error instanceof IllegalTransitionError) {
    res.status(409).json(
      new AppError({
        statusCode: 409,
        code: 'ILLEGAL_STATE_TRANSITION',
        message: `${error.message}. The record's current state does not allow this action.`,
        moneyStatus: refusedTransitionMoney(error),
      }).toJSON(),
    );
    return;
  }

  if (isPostgresError(error)) {
    // 23505 unique_violation
    if (error.code === '23505') {
      /*
       * A composed reference met another, which is ours to answer for.
       *
       * Nobody did anything twice: the generator produced a value the table
       * already held. Answering 409 "That record already exists" blames the
       * caller for a fault they cannot see, offers them no action, and — the
       * part that matters — says NOT_DEBITED on paths where money has already
       * moved. `internal()` says the true thing instead and derives the money
       * state from the request.
       *
       * Logged and reported as well, because this is the one branch here whose
       * firing means a generator wants looking at, and a 500 nobody is told
       * about is the hole the rest of this file exists to close.
       */
      if (error.constraint && GENERATED_REFERENCE_CONSTRAINTS.has(error.constraint)) {
        log.error('generated reference collided', {
          requestId: req.requestId,
          component: 'http',
          method: req.method,
          path: req.path,
          constraint: error.constraint,
          error,
        });
        reportError({
          message: `Generated reference collided on ${error.constraint}`,
          error,
          requestId: req.requestId,
          component: 'http',
          context: { method: req.method, path: req.path, constraint: error.constraint },
        });
        res
          .status(500)
          .json(internal(req.requestId, { method: req.method, path: req.path }).toJSON());
        return;
      }

      const message =
        (error.constraint && UNIQUE_CONSTRAINT_MESSAGES[error.constraint]) ??
        'That record already exists. No duplicate has been created.';
      res.status(409).json(
        new AppError({
          statusCode: 409,
          code: 'DUPLICATE_RECORD',
          message,
          moneyStatus: refusalMoney(req),
        }).toJSON(),
      );
      return;
    }

    /*
     * 23P01 exclusion_violation.
     *
     * Without this the request fell past every branch below to the 500 at the
     * bottom of this function, whose comment reads: "Nothing above recognised
     * this, which means it is a bug rather than a rule firing." An overlap
     * constraint IS a rule firing, and it fired correctly. The officer got an
     * internal error and a reference number for an action the platform had
     * decided, on purpose, to refuse — and `reportError` woke somebody about
     * it, so the same mistake also spent an alert.
     *
     * It survived because nothing had ever called the two routes that reach
     * it: `POST /presumptive/lga-classes` and `POST /presumptive/nano-policy`
     * are both on the never-exercised list. Neither service pre-checks the
     * overlap the way `openPeriod` does for financial periods, so the database
     * is the only thing refusing, and the refusal had nowhere to go.
     */
    if (error.code === '23P01') {
      const words = (error.constraint && OVERLAP_CONSTRAINT_MESSAGES[error.constraint]) || null;
      log.warn('an overlap rule blocked the request', {
        requestId: req.requestId,
        component: 'http',
        constraint: error.constraint,
        detail: error.detail,
        path: req.path,
      });
      res.status(409).json(
        new AppError({
          statusCode: 409,
          code: 'OVERLAPPING_PERIOD',
          message:
            words?.message ?? 'That period overlaps one that already exists. Nothing has been changed.',
          moneyStatus: refusalMoney(req),
          nextStep: words?.nextStep ?? 'Choose dates that do not overlap the existing record.',
        }).toJSON(),
      );
      return;
    }

    // 23514 check_violation / 23503 foreign_key_violation
    if (error.code === '23514' || error.code === '23503') {
      log.warn('a financial integrity rule blocked the request', {
        requestId: req.requestId,
        component: 'http',
        constraint: error.constraint,
        detail: error.detail,
        path: req.path,
      });
      res.status(409).json(
        new AppError({
          statusCode: 409,
          code: 'INTEGRITY_RULE_VIOLATED',
          message:
            'This action was blocked by a financial integrity rule. ' +
            'Nothing has been changed. Contact support with the reference below if you believe this is wrong.',
          moneyStatus: refusalMoney(req),
          reference: req.requestId,
        }).toJSON(),
      );
      return;
    }

    // 2F003/38003/P0001 — our own RAISE EXCEPTION from the integrity triggers.
    // These messages are written for humans and are safe to surface: they say
    // exactly which control refused the action.
    if (error.code === 'P0001' || error.code === '2BP01') {
      res.status(409).json(
        new AppError({
          statusCode: 409,
          code: 'FINANCIAL_CONTROL_BLOCKED',
          message: error.message,
          moneyStatus: refusalMoney(req),
          reference: req.requestId,
          nextStep: error.hint,
        }).toJSON(),
      );
      return;
    }

    // 40001 serialization_failure — a genuine concurrency retry case.
    if (error.code === '40001' || error.code === '40P01') {
      res.status(409).json(
        new AppError({
          statusCode: 409,
          code: 'CONCURRENT_UPDATE',
          message:
            'Another update to this record happened at the same time. Nothing was changed. Try again.',
          moneyStatus: refusalMoney(req),
        }).toJSON(),
      );
      return;
    }
  }

  // Nothing above recognised this, which means it is a bug rather than a rule
  // firing. Somebody has to find out now: on a revenue platform an unhandled
  // exception is a taxpayer who paid and has no receipt.
  log.error('unhandled error', {
    requestId: req.requestId,
    component: 'http',
    method: req.method,
    path: req.path,
    error,
  });
  reportError({
    message: `Unhandled error on ${req.method} ${req.path}`,
    error,
    requestId: req.requestId,
    component: 'http',
    context: { method: req.method, path: req.path, role: req.auth?.role ?? null },
  });
  /*
   * The path and method decide what this may claim about money. See
   * `internal` — an exception nobody anticipated cannot assert that nothing
   * happened, and on a write under /payments it must say so out loud.
   */
  res.status(500).json(internal(req.requestId, { method: req.method, path: req.path }).toJSON());
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json(
    new AppError({
      statusCode: 404,
      code: 'ROUTE_NOT_FOUND',
      message: `No endpoint matches ${req.method} ${req.path}.`,
    }).toJSON(),
  );
}
