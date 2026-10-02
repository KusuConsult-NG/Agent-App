/** Shared presentation components and icons for the agent PWA. */

import type { ReactElement, ReactNode } from 'react';
import { Children, cloneElement, isValidElement, useId, useState } from 'react';
import { BLOCKER_TEXT, ENUM_LABELS, enumLabel, formatNaira, statusSeverity } from '@psirs/shared';
import type { AgentBlocker, TranslationDictionary } from '@psirs/shared';
import type { ApiError } from './lib/api';
import { useI18n } from './lib/i18n';

export function Money({ kobo, className }: { kobo: string | bigint | null | undefined; className?: string }) {
  if (kobo === null || kobo === undefined) return <span className={className}>—</span>;
  return <span className={className}>{formatNaira(typeof kobo === 'string' ? BigInt(kobo) : kobo)}</span>;
}

/**
 * Render a backend error faithfully.
 *
 * The money status is shown as its own line whenever the failure touched a
 * payment: PRD §60 requires the agent to know, without interpreting anything,
 * whether the taxpayer has been debited.
 */
/**
 * The name of a field as the person filling it in saw it.
 *
 * Validation details arrive keyed by the API's own identifiers —
 * `dateOfBirth`, `accountNumber`, `lgaId` — and those were printed straight
 * into the list of problems. Somebody reading "dateOfBirth: That date of
 * birth is in the future" has to work out which box on the form that was,
 * which is a small tax on every failed submission and a larger one on a long
 * form filled in on a phone.
 */
function fieldLabel(field: string): string {
  const spaced = field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._]/g, ' ')
    .trim();
  const readable = spaced.replace(/\bId\b$/i, '').trim() || spaced;
  return readable.charAt(0).toUpperCase() + readable.slice(1).toLowerCase();
}

/**
 * The errors whose meaning is fixed, and can therefore be translated.
 *
 * Keyed by code rather than matched on text: the server's wording changes, and
 * a translation that stopped applying when somebody improved an English
 * sentence would fail silently and in the language nobody testing it reads.
 *
 * Everything absent from this map falls back to what the server said. A
 * validation message names a field and is generated from the schema, so a
 * Hausa sentence guessed for a message nobody has seen would be worse than the
 * English one — the agent cannot tell a guess from a translation.
 */
export const TRANSLATED_ERRORS: Record<string, keyof TranslationDictionary> = {
  /*
   * A capture PSIRS refused. These reach here rather than through `ApiError`
   * because they arrive one-per-draft inside a batch response, but they are
   * the same thing — a code and a sentence — and they want the same map.
   */
  DRAFT_INVALID: 'errDraftInvalid',
  DRAFT_TYPE_UNSUPPORTED: 'errDraftTypeUnsupported',
  DRAFT_NOT_PROCESSED: 'errDraftNotProcessed',
  DRAFT_NOT_PERMITTED: 'errDraftNotPermitted',
  PAYMENT_UNCONFIRMED: 'errPaymentUnconfirmed',
  PAYMENT_PENDING_RECONCILIATION: 'errPaymentPendingReconciliation',
  PAYMENT_FAILED: 'errPaymentFailed',
  AGENT_NOT_CLEARED: 'errAgentNotCleared',
  DEVICE_NOT_REGISTERED: 'errDeviceNotRegistered',
  RATE_LIMITED: 'errRateLimited',
  UPDATE_REQUIRED: 'errUpdateRequired',
  NETWORK: 'errNetwork',
  UPLOAD_FAILED: 'errUploadFailed',
  UNKNOWN: 'errRequestFailed',
  /*
   * BECOMING AN AGENT, AND BEING PAID
   *
   * The journey an agent has to complete before they can collect anything,
   * and the account the money then goes to. Every refusal on it reached them
   * in English — this map held thirteen codes and not one of them was on
   * this path, in an application that has offered Hausa since it was built.
   *
   * Each has one fixed meaning, which is the test the comment above sets.
   * Five of them had no code specific enough to key on at all and were
   * raised as INVALID_REQUEST or FORBIDDEN; they were given one first,
   * because a sentence nobody can name is a sentence nobody can translate.
   */
  TRAINING_SCORE_BELOW_PASS_MARK: 'errTrainingScoreBelowPassMark',
  PHONE_ALREADY_REGISTERED: 'errPhoneAlreadyRegistered',
  KYC_ALREADY_CLEARED: 'errKycAlreadyCleared',
  DEVICE_BEFORE_APPROVAL: 'errDeviceBeforeApproval',
  DEVICE_REVOKED_CANNOT_REREGISTER: 'errDeviceRevokedCannotReregister',
  NO_BANK_ACCOUNT_ON_RECORD: 'errNoBankAccountOnRecord',
  BANK_DETAILS_UNCHANGED: 'errBankDetailsUnchanged',
  BANK_CHANGE_ALREADY_PENDING: 'errBankChangeAlreadyPending',
  BANK_CHANGE_ALREADY_SETTLED: 'errBankChangeAlreadySettled',
  PAYOUT_IN_FLIGHT: 'errPayoutInFlight',

  /*
   * COLLECTING, WHICH IS WHAT THE APPLICATION IS FOR
   *
   * Every refusal `createAssessmentIn` raises reaches an agent from the screen
   * they collect on, and not one of them was in this map — in an application
   * that has offered Hausa since it was built, and after the same gap was
   * closed once already on the path to becoming an agent.
   *
   * Three had no code to key on and were raised as INVALID_REQUEST, the code a
   * malformed field gets. They were named first, in `services/revenue.ts`,
   * for the reason the comment above gives: a sentence nobody can name is a
   * sentence nobody can translate.
   *
   * Each has one fixed meaning, which is the test this map sets. None of them
   * carries a figure, so none needs a placeholder: the agent chose the levy
   * off a list a moment earlier and knows which one it was.
   */
  TAXPAYER_NOT_ACTIVE: 'errTaxpayerNotActive',
  REVENUE_ITEM_INACTIVE: 'errRevenueItemInactive',
  REVENUE_ITEM_NOT_FOR_TAXPAYER_TYPE: 'errRevenueItemNotForTaxpayerType',
  REVENUE_ITEM_NOT_IN_LGA: 'errRevenueItemNotInLga',
  NO_TAX_PAYABLE: 'errNoTaxPayable',
  ASSESSMENT_AMOUNT_ZERO: 'errAssessmentAmountZero',

  /*
   * THE SIX THE LAST PASS AT THIS MISSED, AND WHY IT MISSED THEM.
   *
   * The commit that added the block above was called "Every refusal on the
   * collect screen, in English" and it was not. I enumerated the refusals
   * `createAssessmentIn` raises, and all six of those are above. Doing it
   * mechanically instead — slicing out the functions the collect path actually
   * runs and extracting every code — finds what reading one function body
   * cannot:
   *
   *   NO_EFFECTIVE_RATE is raised one level down, by `resolveRate`, which
   *   `createAssessmentIn` and `quote` both call. It fires when government has
   *   ended a rate version without publishing a successor.
   *
   *   The five payment codes are raised by `initiatePayment`, reached from the
   *   same screen one tap later. The sentence that decides whether a citizen is
   *   asked to pay twice was already in Hausa — `ErrorAlert` renders the money
   *   status from the dictionary and `fe3ef17` saw to that — but the headline
   *   above it, which says *what* happened, was the server's English.
   *
   * `a-refusal-the-collect-screen-can-show.test.ts` now holds the whole path
   * rather than one function, so the next helper added below this one cannot
   * repeat it.
   */
  NO_EFFECTIVE_RATE: 'errNoEffectiveRate',
  INVOICE_ALREADY_PAID: 'errInvoiceAlreadyPaid',
  PAYMENT_ALREADY_VERIFIED: 'errPaymentAlreadyVerified',
  INVOICE_NOT_PAYABLE: 'errInvoiceNotPayable',
  INVOICE_EXPIRED: 'errInvoiceExpired',
  TRANSACTION_NOT_PAYABLE: 'errTransactionNotPayable',

  /*
   * PUTTING SOMEBODY ON THE REGISTER.
   *
   * The first thing an agent does for anybody, and the gate everything else
   * is behind: nothing can be assessed, collected or receipted against a
   * person who is not registered. All four refusals the screen can show were
   * the server's English.
   *
   * Two of them had their next step in Hausa already and their headline in
   * English — `nsTinServiceUnavailable` and `nsTinNotFound` were written when
   * the advice on those two branches was corrected, and the sentence they are
   * advice about was left behind. The agent read what to do in their own
   * language and what had happened in somebody else's.
   *
   * Found the same way the six above were: by slicing the functions the
   * screen's requests actually run and extracting every code, which is what
   * `a-refusal-a-screen-can-show.test.ts` now does for this path too.
   */
  TAXPAYER_ALREADY_EXISTS: 'errTaxpayerAlreadyExists',
  POSSIBLE_DUPLICATE_TAXPAYER: 'errPossibleDuplicateTaxpayer',
  TIN_SERVICE_UNAVAILABLE: 'errTinServiceUnavailable',
  TIN_NOT_FOUND: 'errTinNotFound',
};

/**
 * What an error says, in the reader's language.
 *
 * Lifted out of `ErrorAlert` so a screen that renders a refusal in its own
 * frame can still get the translation. `App.tsx` was the case: the sync
 * banner destructured `message` and `nextStep` off the `ApiError` and printed
 * them raw, walking past this map entirely — the Hausa existed and the screen
 * simply did not go through the component that applies it.
 *
 * Everything absent from the map falls back to the server's sentence, for the
 * reason given above it: a guessed translation of a message nobody has seen
 * is worse than the English, because the reader cannot tell the two apart.
 */
export function errorText(
  error: { code: string; message: string; details?: { field?: string; issue: string }[] },
  t: TranslationDictionary,
): string {
  const translated = TRANSLATED_ERRORS[error.code];
  if (!translated) return error.message;
  /*
   * Figures come out of `details`, not out of the English sentence.
   *
   * The training refusal names a score and a pass mark, and those are the
   * numbers the agent is actually looking for. Parsing them back out of the
   * server's prose would break the moment somebody improved the wording —
   * silently, and in the language nobody testing it reads — so the server
   * sends them as fields and the placeholder names match.
   *
   * A translation with no placeholders is unaffected, and a placeholder the
   * server did not send is left alone rather than replaced with a blank: a
   * sentence with a visible gap in it is a bug somebody reports, and one
   * reading "You scored % on" is a bug they cannot describe.
   */
  const sentence = t[translated] as string;
  if (!error.details?.length || !sentence.includes('{{')) return sentence;
  return error.details.reduce(
    (text, detail) =>
      detail.field ? text.replace(`{{${detail.field}}}`, substituted(detail, t)) : text,
    sentence,
  );
}

/**
 * What a detail puts into the hole.
 *
 * `issue` is prose composed by the server, and prose composed there is prose in
 * English — so a figure goes in as it is and a STATE goes in through the
 * dictionary. Two of the payment refusals name a state: "This invoice is
 * cancelled and can no longer be paid" became, with the sentence translated and
 * the value not, Hausa with `CANCELLED` sitting in the middle of it.
 *
 * Two conditions, and both are deliberate. The detail has to be marked
 * `STATE`, and the value has to be one the dictionary holds.
 *
 * The second is the one that stops damage: `enumLabel` always returns
 * something — its fallback takes the underscores out and lowercases — so
 * calling it on a figure would turn an amount or a reference into something
 * subtly different, and calling it on an unknown state would damage the state
 * rather than translate it. The same rule is applied on the officer portal's
 * audit table, for the same reason.
 *
 * The first is narrowness rather than safety, and it was nearly dropped for
 * being untestable: a mutation that removed it failed nothing, because the
 * details in flight today carry scores and pass marks and none of those is a
 * dictionary key. It is kept because the alternative rule — translate any
 * detail whose value happens to match a key — would quietly take in every
 * detail added later, and `ACTIVE` or `PENDING` is an entirely plausible thing
 * for some future field to carry as a datum. The test below holds it, so it is
 * now a property rather than a hopeful line.
 */
function substituted(
  detail: { field?: string; issue: string; code?: string },
  t: TranslationDictionary,
): string {
  if (detail.code !== 'STATE') return detail.issue;
  return detail.issue in ENUM_LABELS ? enumLabel(detail.issue, t) : detail.issue;
}

/**
 * What to do about an error, in the reader's language.
 *
 * `nextStep` is the actionable half — it names the screen to open or the
 * thing to check — and it sat directly under a message this very component
 * had just translated, printed exactly as the API composed it. A Hausa
 * reader got the heading in Hausa, the explanation in Hausa, and the
 * instruction in English.
 *
 * Keyed by the error's own code, which has always travelled beside it, so
 * nothing new is sent. Only codes specific enough to imply one next step are
 * here. `VALIDATION_FAILED` and `FORBIDDEN` mean something different every
 * time they are raised and keep the server's words.
 *
 * That sentence used to say the same of anything passed to `conflict()`, which
 * was never true of the map above it — half its entries are conflict codes —
 * and it was the reason the one next step on the collect path stayed in
 * English. `NO_TAX_PAYABLE` always means one thing and its next step is the
 * only instruction on that path that costs a trader money if it is not read:
 * it tells the agent not to raise the figure to force the assessment through.
 */
const TRANSLATED_NEXT_STEPS: Record<string, keyof TranslationDictionary> = {
  STEP_UP_REQUIRED: 'nsStepUpRequired',
  DEVICE_NOT_REGISTERED: 'nsDeviceNotRegistered',
  DEVICE_REVOKED: 'nsDeviceRevoked',
  DEVICE_SUSPENDED: 'nsDeviceSuspended',
  UPDATE_REQUIRED: 'nsUpdateRequired',
  UPDATE_REQUIRED_TO_ENUMERATE: 'nsUpdateRequiredToEnumerate',
  TIN_SERVICE_UNAVAILABLE: 'nsTinServiceUnavailable',
  TIN_NOT_FOUND: 'nsTinNotFound',
  KYC_PROVIDER_UNAVAILABLE: 'nsKycProviderUnavailable',
  PAYMENT_UNCONFIRMED: 'nsPaymentUnconfirmed',
  PAYMENT_FAILED: 'nsPaymentFailed',
  AGENT_NOT_CLEARED: 'nsAgentNotCleared',
  NO_TAX_PAYABLE: 'nsNoTaxPayable',
  // The two of the six that carry a next step. The other four say everything
  // they have to say in one sentence, and an invented instruction would be
  // worse than none.
  NO_EFFECTIVE_RATE: 'nsNoEffectiveRate',
  INVOICE_ALREADY_PAID: 'nsInvoiceAlreadyPaid',
  /*
   * The registration screen's two. The other two already had theirs, which is
   * how the split was noticed at all.
   *
   * `POSSIBLE_DUPLICATE_TAXPAYER` is the one place this map does not translate
   * the API's sentence so much as answer the same question for a different
   * reader. The API says to resubmit with `acknowledgeDuplicates` set, which
   * is correct for a client and useless to a person; the screen under this
   * alert lists the matches and carries the button. So the next step points
   * there, and the API keeps its own words for the callers they are for.
   */
  TAXPAYER_ALREADY_EXISTS: 'nsTaxpayerAlreadyExists',
  POSSIBLE_DUPLICATE_TAXPAYER: 'nsPossibleDuplicateTaxpayer',
};

/** The next step for an error, or the server's own words when it has none. */
export function nextStepText(
  error: { code: string; nextStep?: string },
  t: TranslationDictionary,
): string | null {
  const translated = TRANSLATED_NEXT_STEPS[error.code];
  if (translated) return t[translated] as string;
  return error.nextStep ?? null;
}

export function ErrorAlert({ error }: { error: ApiError | null }) {
  const { t } = useI18n();
  if (!error) return null;

  /*
   * The sentence that decides whether a citizen is asked to pay twice.
   *
   * It was three English literals here, unreachable by any dictionary and by
   * the Hausa review — in an application that has offered Hausa since it was
   * built. It has only three possible values, so it is always in the agent's
   * language whatever the error was.
   */
  const moneyLine =
    error.moneyStatus === 'NOT_DEBITED'
      ? t.moneyNotDebited
      : error.moneyStatus === 'UNCONFIRMED'
        ? t.moneyUnconfirmed
        : error.moneyStatus === 'RECEIVED'
          ? t.moneyReceived
          : null;

  const message = errorText(error, t);

  return (
    <div className={`alert alert--${error.moneyStatus === 'UNCONFIRMED' ? 'warning' : 'error'}`} role="alert">
      <strong>{message}</strong>
      {moneyLine && <p style={{ margin: '6px 0 0', fontWeight: 600 }}>{moneyLine}</p>}
      {nextStepText(error, t) && (
        <p style={{ margin: '6px 0 0' }}>{nextStepText(error, t)}</p>
      )}
      {error.details && error.details.length > 0 && (
        <ul>
          {error.details.map((detail, index) => (
            <li key={index}>
              {detail.field ? `${fieldLabel(detail.field)}: ` : ''}
              {/*
                * The code first, where the server sent one.
                *
                * `issue` is a sentence the API composed, so it is a sentence in
                * English. The clearance blockers are the case that matters:
                * an applicant refused at the counter was shown a translated
                * headline and then seven English lines saying what to do about
                * it. Anything without a code, or with one this build does not
                * know, still shows what the server said rather than nothing.
                */}
              {detail.code && detail.code in BLOCKER_TEXT
                ? t[BLOCKER_TEXT[detail.code as AgentBlocker]]
                : detail.issue}
            </li>
          ))}
        </ul>
      )}
      {error.reference && (
        <p style={{ margin: '6px 0 0', fontSize: '0.78rem' }}>
          {t.errReference}: {error.reference}
        </p>
      )}
    </div>
  );
}

export function Alert({
  kind,
  title,
  children,
}: {
  kind: 'success' | 'warning' | 'error' | 'info';
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`alert alert--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {title && <strong>{title}</strong>}
      {children}
    </div>
  );
}

/**
 * A labelled form control.
 *
 * The label is tied to its input with `htmlFor`, and the hint with
 * `aria-describedby`. Neither used to be: the label sat beside the input as a
 * plain sibling with nothing connecting them, so a screen reader announced
 * every field on the registration wizard as an unlabelled edit box — no name,
 * no indication of what was being asked. Tapping a label did not focus its
 * input either, which on a phone is the difference between a form that is
 * usable one-handed and one that is not.
 *
 * The id is attached by cloning rather than by asking every caller to pass one,
 * so the association cannot be forgotten at a call site. A `Field` given
 * anything other than a single element is left alone — the label keeps its
 * text, and nothing is silently mislabelled.
 */
export function Field({
  label,
  hint,
  children,
  required,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
}) {
  const generatedId = useId();
  const hintId = `${generatedId}-hint`;

  const items = Children.toArray(children);
  const only = items.length === 1 && isValidElement(items[0]) ? items[0] : null;
  const existingId = only ? (only.props as { id?: string }).id : undefined;
  const controlId = only ? (existingId ?? generatedId) : undefined;

  const control = only
    ? cloneElement(only as ReactElement<Record<string, unknown>>, {
        id: controlId,
        ...(hint ? { 'aria-describedby': hintId } : {}),
      })
    : children;

  return (
    <div className="field">
      <label htmlFor={controlId}>
        {label}
        {required && <span aria-hidden="true" style={{ color: 'var(--danger)' }}> *</span>}
      </label>
      {control}
      {hint && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function Badge({ status }: { status: string }) {
  const { t } = useI18n();
  /*
   * The classification is in @psirs/shared, and it used to be here.
   *
   * This app and the portal each carried their own copy of the same fifteen
   * lines, and both had the same bug: they asked whether the status
   * *contained* a good-news word, so INACTIVE contained ACTIVE and an UNPAID
   * invoice was rendered in the colour of a paid one — on the handset of the
   * person collecting the money.
   */
  /*
   * And the word itself comes from the dictionary. A badge is what somebody
   * looks at when they are in a hurry, and it was the one part of the screen
   * that stayed in English however the app was set.
   */
  return <span className={`badge badge--${statusSeverity(status)}`}>{enumLabel(status, t)}</span>;
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function Loading({ rows = 3 }: { rows?: number }) {
  const { t } = useI18n();
  return (
    <div aria-busy="true" aria-label={t.uiLoading}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton" style={{ width: `${100 - index * 12}%` }} />
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl style={{ margin: 0 }}>
      {items.map(([key, value]) => (
        <div className="kv" key={key}>
          <dt>{key}</dt>
          <dd>{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

// ------------------------------------------------------------------ icons

const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const Icons = {
  home: () => (
    <svg {...iconProps}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  ),
  collect: () => (
    <svg {...iconProps}>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  ),
  people: () => (
    <svg {...iconProps}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <path d="M16 11.5a3 3 0 1 0-1.6-5.5M17 20c0-2.2-.8-3.9-2-5" />
    </svg>
  ),
  vehicle: () => (
    <svg {...iconProps}>
      <path d="M4 16v2.5M20 16v2.5" />
      <path d="M3 16h18v-3.2l-1.7-4.3A2 2 0 0 0 17.4 7H6.6a2 2 0 0 0-1.9 1.5L3 12.8Z" />
      <circle cx="7.5" cy="16" r="1.6" />
      <circle cx="16.5" cy="16" r="1.6" />
    </svg>
  ),
  receipt: () => (
    <svg {...iconProps}>
      <path d="M6 2.5h12v19l-2.5-1.7L13 21.5l-2.5-1.7L8 21.5 6 20V2.5Z" />
      <path d="M9.5 8h5M9.5 12h5" />
    </svg>
  ),
  wallet: () => (
    <svg {...iconProps}>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1" />
      <rect x="3" y="7.5" width="18" height="12" rx="2.5" />
      <circle cx="16.5" cy="13.5" r="1.2" />
    </svg>
  ),
  profile: () => (
    <svg {...iconProps}>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M4.5 20c0-3.8 3.4-6.2 7.5-6.2s7.5 2.4 7.5 6.2" />
    </svg>
  ),
  search: () => (
    <svg {...iconProps}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  ),
  add: () => (
    <svg {...iconProps}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  check: () => (
    <svg {...iconProps}>
      <path d="m4.5 12.5 5 5 10-11" />
    </svg>
  ),
  back: () => (
    <svg {...iconProps}>
      <path d="M15 5 8 12l7 7" />
    </svg>
  ),
  shield: () => (
    <svg {...iconProps}>
      <path d="M12 3 5 6v6c0 4.5 3 8 7 9 4-1 7-4.5 7-9V6l-7-3Z" />
      <path d="m9 12 2 2 4-4.5" />
    </svg>
  ),
  print: () => (
    <svg {...iconProps}>
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  ),
  camera: () => (
    <svg {...iconProps}>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  ),
};

/**
 * A password field that can be shown.
 *
 * Typing a password blind is hard on a desk and harder on a phone held one
 * handed in a market, and it is worst on the application form, where the rule
 * is at least eight characters with a letter and a number — a rejection an
 * applicant cannot see the cause of. A reveal control turns "wrong password"
 * into something a person can check for themselves.
 *
 * It is written out here rather than passed through `Field` on purpose. `Field`
 * attaches the label to its single child by cloning it, so wrapping the input
 * with a button would put the id on the wrapper and leave the label pointing at
 * a div — undoing the association that makes these forms usable with a screen
 * reader at all.
 *
 * Hidden by default, always. Revealing is a deliberate act, and the state does
 * not survive leaving the screen.
 */
export function PasswordField({
  label,
  hint,
  value,
  onChange,
  autoComplete,
  required,
  minLength,
  pattern,
  patternHint,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  required?: boolean;
  minLength?: number;
  /**
   * The rule the API will apply, so the browser applies it first.
   *
   * The application form told applicants a password needs "a letter and a
   * number" and then only checked the length, so one without a digit passed
   * the browser and was refused by the server — after twenty-seven fields had
   * been filled in on a phone. Stating a rule and not enforcing it is the
   * worst of the three options.
   */
  pattern?: string;
  /** Shown in the browser's own refusal, which otherwise says only "match the requested format". */
  patternHint?: string;
}) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true" style={{ color: 'var(--danger)' }}> *</span>}
      </label>
      <div className="password">
        <input
          id={id}
          className="password__input"
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          required={required}
          minLength={minLength}
          pattern={pattern}
          title={patternHint}
          aria-describedby={hint ? hintId : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="password__toggle"
          aria-pressed={shown}
          aria-label={shown ? t.uiHidePassword : t.uiShowPassword}
          onClick={() => setShown((current) => !current)}
        >
          {shown ? t.uiHide : t.uiShow}
        </button>
      </div>
      {hint && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}
