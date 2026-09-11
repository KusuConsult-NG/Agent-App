/** Shared presentation components for the government portal. */

import { useState, type ReactNode } from 'react';
import {
  enumLabel,
  formatDateIn,
  formatDateTimeIn,
  formatNaira,
  getTranslation,
  statusSeverity,
} from '@psirs/shared';
import { ApiRequestError, downloadExport, type ApiError } from './lib/api';
import { getPortalLanguage, usePortalI18n } from './lib/i18n';
import type { TranslationDictionary } from '@psirs/shared';

export function Money({ kobo }: { kobo: string | number | bigint | null | undefined }) {
  if (kobo === null || kobo === undefined || kobo === '') return <>—</>;
  try {
    return <>{formatNaira(BigInt(String(kobo)))}</>;
  } catch {
    return <>—</>;
  }
}

/**
 * Labels are dictionary keys throughout this file.
 *
 * `Stat`, `Table` and `BarList` are what the twenty officer screens are built
 * out of, and most of the portal's visible English used to sit in the props
 * passed to them. Taking keys rather than strings translates all of it in one
 * place — and, because the type is `keyof TranslationDictionary`, makes a new
 * screen with an English label a compile error rather than a thing an officer
 * reads.
 *
 * Where a label is genuinely data — an LGA's name, a revenue item, a column
 * headed by something the server sent — the prop takes `{ text: string }`
 * instead, which says "this is not translatable and is not meant to be".
 */
export type Label = keyof TranslationDictionary | { text: string };

export function useLabel(): (label: Label) => string {
  const { t } = usePortalI18n();
  return (label: Label) => (typeof label === 'object' ? label.text : t[label]);
}

export function Stat({
  label,
  value,
  hint,
  variant,
}: {
  label: Label;
  value: ReactNode;
  hint?: Label;
  variant?: 'accent' | 'alert';
}) {
  const text = useLabel();
  return (
    <div className={`stat ${variant ? `stat--${variant}` : ''}`}>
      <p className="stat__label">{text(label)}</p>
      <p className="stat__value">{value}</p>
      {hint && <p className="stat__hint">{text(hint)}</p>}
    </div>
  );
}

/**
 * A change against the period before, or an honest silence.
 *
 * `null` basis points is not zero growth. A ward deployed this month, or a levy
 * introduced last week, has nothing to compare against — and rendering that as
 * "0%" is a claim the data does not support, on exactly the rows an officer is
 * most likely to be looking at.
 *
 * The arrow and the sign both carry the direction, because colour alone fails
 * for a reviewer who cannot distinguish red from green and prints badly.
 */
export function Growth({
  basisPoints,
  hint,
}: {
  basisPoints: number | string | null | undefined;
  hint?: Label;
}) {
  const text = useLabel();
  const { t } = usePortalI18n();
  if (basisPoints === null || basisPoints === undefined || basisPoints === '') {
    return <span className="muted">{t.ofcDbNoComparison}</span>;
  }
  const bp = Number(basisPoints);
  if (!Number.isFinite(bp)) return <span className="muted">{t.ofcDbNoComparison}</span>;

  const percent = bp / 100;
  const rising = bp > 0;
  const flat = bp === 0;
  return (
    <span className={flat ? 'muted' : rising ? 'growth growth--up' : 'growth growth--down'}>
      {flat ? '' : rising ? '▲ ' : '▼ '}
      {rising ? '+' : ''}
      {percent.toFixed(1)}%
      {hint && <span className="muted"> {text(hint)}</span>}
    </span>
  );
}

export function Badge({
  status,
  column,
}: {
  status: string | null | undefined;
  /**
   * Where the value came from, as `table.column`.
   *
   * Only for the handful of values that mean different things in different
   * places — `ENUM_LABEL_EXCEPTIONS` in @psirs/shared is the list, and it is
   * short on purpose. Everywhere else the shared word is the right word and
   * this stays off.
   */
  column?: string;
}) {
  const { t } = usePortalI18n();
  if (!status) return <>—</>;
  // `statusSeverity` lives in @psirs/shared because both front ends had their
  // own copy of it and both had the same bug: INACTIVE contains ACTIVE.
  //
  // The word inside the badge comes from the same package for the same
  // reason: it was the status as the database spells it, underscores taken
  // out, which is English on a screen an officer set to Hausa.
  return <span className={`badge badge--${statusSeverity(status)}`}>{enumLabel(status, t, column)}</span>;
}

export function Alert({
  kind,
  title,
  children,
}: {
  kind: 'success' | 'warning' | 'error' | 'info';
  title?: Label;
  children: ReactNode;
}) {
  const text = useLabel();
  return (
    <div className={`alert alert--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {title && <strong>{text(title)}</strong>}
      {/*
        * Wrapped so the words can be given a reading measure without the box
        * shrinking with them. An alert is a coloured band across the card;
        * capping the band itself leaves it floating half-width and reading as
        * a layout fault rather than as a notice.
        */}
      <div className="alert__body">{children}</div>
    </div>
  );
}

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
 * The refusals this portal writes itself, and only those.
 *
 * The agent app has carried this map since it was translated; the portal had
 * none, so `ErrorAlert` rendered `error.message` exactly as it arrived. For a
 * message the server composed that is the honest answer — a validation
 * refusal names a field and is generated from the schema, and a Hausa
 * sentence guessed for one nobody has seen would be worse than the English,
 * because an officer cannot tell a guess from a translation.
 *
 * For the four codes below it was not, because the portal composes those
 * itself, in `lib/api.ts`, where until now they were English literals in a
 * module this check did not read. Every one of them is a sentence the officer
 * sees when something has gone wrong on their own screen.
 *
 * That the *server's* codes are still rendered in English is a real gap and a
 * larger one. It is recorded rather than guessed at here.
 */
const TRANSLATED_ERRORS: Record<string, keyof TranslationDictionary> = {
  UNKNOWN: 'errRequestFailed',
  // Raised by the api client, not the server: a request that never arrived.
  NETWORK: 'ofcLgCouldNotReachThe',
  UPLOAD_FAILED: 'errUploadFailed',
  DOCUMENT_FAILED: 'errUploadFailed',
  STEP_UP_ABANDONED: 'stepUpCodeRequired',
};

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
 * here: `VALIDATION_FAILED`, and anything a caller passed to `forbidden()` or
 * `conflict()`, means something different every time it is raised and keeps
 * the server's words.
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
  const { t } = usePortalI18n();
  if (!error) return null;
  const translated = TRANSLATED_ERRORS[error.code];
  return (
    <Alert kind="error" title={{ text: translated ? t[translated] : error.message }}>
      {nextStepText(error, t) && (
        <p style={{ margin: '4px 0 0' }}>{nextStepText(error, t)}</p>
      )}
      {error.details && error.details.length > 0 && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {error.details.map((detail, index) => (
            <li key={index}>
              {detail.field ? `${fieldLabel(detail.field)}: ` : ''}
              {detail.issue}
            </li>
          ))}
        </ul>
      )}
      {error.reference && (
        <p style={{ margin: '6px 0 0', fontSize: '0.75rem' }}>
          {t.errReference}: {error.reference}
        </p>
      )}
    </Alert>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  const { t } = usePortalI18n();
  return (
    <div aria-busy="true" aria-label={t.uiLoading}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton" style={{ width: `${100 - index * 9}%` }} />
      ))}
    </div>
  );
}

/**
 * The rule a reason box is holding a button to.
 *
 * Forty-odd buttons across this portal go dead until a typed reason reaches a
 * minimum — suspending an agent, revoking somebody's access, reopening a
 * closed period, rejecting an identity document. Two boxes said so in their
 * label ("Reason (minimum 10 characters)"). The rest left the button grey and
 * the rule unstated, so an officer who typed "Fraud" had nothing telling them
 * what was wrong with it. Nothing was: it was five characters long.
 *
 * This sits with the BOX rather than with the button, because the rule belongs
 * to what is typed and several buttons usually read the same box. It names the
 * minimum while the box is short and disappears the moment the rule is met,
 * which is also the only confirmation that the button has come alive.
 */
export function ReasonRule({ value, minimum }: { value: string; minimum: number }) {
  const { t } = usePortalI18n();
  if (value.trim().length >= minimum) return null;
  return (
    <p className="field__hint" role="status">
      {t.ofcReasonAtLeastChars.replace('{{n}}', String(minimum))}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** One place deciding how a cell is drawn, so the head and body cannot drift. */
function cellClass(column: { numeric?: boolean; meta?: boolean }): string | undefined {
  const names = [column.numeric ? 'numeric' : '', column.meta ? 'meta' : ''].filter(Boolean);
  return names.length ? names.join(' ') : undefined;
}

export function Table({
  columns,
  rows,
  empty,
  tall,
}: {
  columns: {
    key: string;
    label: Label;
    numeric?: boolean;
    /** Quiet and narrow, for a value that is context rather than the point. */
    meta?: boolean;
    render?: (row: any) => ReactNode;
  }[];
  rows: any[];
  empty?: Label;
  /**
   * Scroll the rows rather than the page, and keep the headings in view.
   *
   * Decided by the table's own length rather than by each screen remembering
   * to ask for it, because the screens did not: the audit log rendered 163
   * rows into a page 21,593 pixels tall — twenty-four screenfuls, with the
   * column headings off the top for twenty-three of them. Pass it explicitly
   * to force it on or off.
   */
  tall?: boolean;
}) {
  const text = useLabel();
  const { t } = usePortalI18n();
  if (rows.length === 0) return <Empty>{empty ? text(empty) : t.ofcNothingToShow}</Empty>;

  /*
   * Eighteen rows is about a screenful at this density. Below it a scroll
   * container inside a page that already scrolls is just in the way; above it
   * the headings are gone before the reader is halfway down.
   */
  const scrolls = tall ?? rows.length > 18;

  return (
    <div className={scrolls ? 'table-wrap table-wrap--tall' : 'table-wrap'}>
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={cellClass(column)}>
                {text(column.label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? index}>
              {columns.map((column) => (
                <td key={column.key} className={cellClass(column)}>
                  {column.render ? column.render(row) : (row[column.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Horizontal bar comparison.
 *
 * Deliberately plain bars rather than a charting library: PRD §38's purpose is
 * to let an officer see which LGA is under-collecting, and a labelled bar with
 * the figure printed next to it does that without a 200KB dependency.
 */
export function BarList({
  items,
  formatValue,
}: {
  items: { label: Label; value: number; sublabel?: string }[];
  formatValue: (value: number) => ReactNode;
}) {
  const { t } = usePortalI18n();
  const text = useLabel();
  const max = Math.max(...items.map((item) => item.value), 1);
  if (items.length === 0) return <Empty>{t.ofcNoDataForPeriod}</Empty>;

  return (
    <div>
      {items.map((item) => (
        <div className="bar-row" key={text(item.label)}>
          <span title={text(item.label)}>
            {text(item.label)}
            {item.sublabel && (
              <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}> · {item.sublabel}</span>
            )}
          </span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} />
          </span>
          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatValue(item.value)}</strong>
        </div>
      ))}
    </div>
  );
}

export function Sparkline({ points }: { points: { label: string; value: number }[] }) {
  const { t } = usePortalI18n();
  const max = Math.max(...points.map((point) => point.value), 1);
  return (
    <div className="spark" role="img" aria-label={t.ofcDailyTrend}>
      {points.map((point) => (
        <span
          key={point.label}
          className="spark__bar"
          style={{ height: `${Math.max(2, (point.value / max) * 100)}%` }}
          title={`${point.label}: ${point.value}`}
        />
      ))}
    </div>
  );
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

export function Checklist({ items }: { items: [string, boolean][] }) {
  return (
    <ul className="checklist">
      {items.map(([label, done]) => (
        <li key={label}>
          <span className={`checklist__mark checklist__mark--${done ? 'yes' : 'no'}`}>
            {done ? '✓' : '×'}
          </span>
          {label}
        </li>
      ))}
    </ul>
  );
}

/*
 * The reader's language, read here rather than passed in.
 *
 * These two are called from seventy-two places across the screens, almost
 * always inside a table column's `render`, where there is no hook and often no
 * component. Threading `t` through all of them would be a diff about nothing
 * and would miss one. The language lives in a module the same way it does for
 * the toggle, and changing it re-renders every screen through `usePortalI18n`,
 * so a date drawn on the next render is drawn in the new language.
 */
export function formatDateTime(value: string | null | undefined): string {
  return formatDateTimeIn(value, getTranslation(getPortalLanguage()));
}

export function formatDate(value: string | null | undefined): string {
  return formatDateIn(value, getTranslation(getPortalLanguage()));
}

/**
 * The language toggle, on both halves of the portal.
 *
 * It lived in `Public.tsx`, where the reasoning was that the people who need
 * it have no account, no settings page and no second visit. That is still
 * true of a referee following one link; it turned out to be true of an
 * officer too, once the officer screens were translated — a supervisor in
 * Bokkos has an account, but nothing on it holds a language, and burying the
 * choice behind a settings page nobody opens is the same failure in a
 * different building.
 *
 * So one control, rendered before anything else on the surface that carries
 * it, so somebody who cannot read the heading can still change the heading.
 */
export function LanguageToggle({ align = 'flex-end' }: { align?: 'flex-end' | 'flex-start' }) {
  const { lang, t, setLanguage } = usePortalI18n();
  return (
    <div
      className="public__lang"
      role="group"
      aria-label={t.pubLanguage}
      style={{ display: 'flex', justifyContent: align, gap: 6, marginBottom: 10 }}
    >
      {(['en', 'ha'] as const).map((option) => (
        <button
          key={option}
          type="button"
          className={lang === option ? '' : 'secondary'}
          aria-pressed={lang === option}
          onClick={() => setLanguage(option)}
          style={{ padding: '4px 12px', fontSize: '0.76rem' }}
        >
          {option === 'en' ? t.pubEnglish : t.pubHausa}
        </button>
      ))}
    </div>
  );
}

/**
 * The three ways a report leaves, offered together.
 *
 * Every screen that exported had its own button, its own filename convention
 * and its own idea of what the file was for. Two more formats each would have
 * been six buttons per screen and six chances to forget that the server, not
 * the browser, is what writes them -- and a file the browser writes is a file
 * that never appears in the export record.
 *
 * The formats are labelled by what they are for rather than by their
 * extension, because that is the choice the officer is actually making: a
 * spreadsheet to work in, a document to file, or the raw rows for another
 * system.
 *
 * Refusals are shown here rather than thrown away. The commonest one by far is
 * the row limit for the officer's role, which is a sentence they can act on --
 * narrow the period, or ask for the limit to be raised -- and which a silent
 * failure would turn into "the button does nothing".
 */
export function ExportButtons({
  path,
  filename,
  disabled,
}: {
  /** The API path, with its filters already in the query string. */
  path: string;
  filename: string;
  disabled?: boolean;
}) {
  const { t } = usePortalI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const formats: { format: 'xlsx' | 'pdf' | 'csv'; label: keyof TranslationDictionary }[] = [
    { format: 'xlsx', label: 'ofcExportExcel' },
    { format: 'pdf', label: 'ofcExportPdf' },
    { format: 'csv', label: 'ofcExportCsv' },
  ];

  return (
    <div className="export-buttons">
      <ErrorAlert error={error} />
      {formats.map(({ format, label }) => (
        <button
          key={format}
          type="button"
          className="small secondary"
          disabled={disabled || busy !== null}
          onClick={async () => {
            setBusy(format);
            setError(null);
            try {
              await downloadExport(path, format, filename);
            } catch (caught) {
              setError(caught instanceof ApiRequestError ? caught.error : null);
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === format ? t.ofcExportWorking : t[label]}
        </button>
      ))}
    </div>
  );
}

/**
 * What a change actually changed.
 *
 * `audit_logs.old_value` and `new_value` have been captured on every write
 * since the platform started, and for most of that time nothing rendered them:
 * an auditor asking "what did that action actually do" read JSON out of a CSV
 * export. The Transaction 360 timeline started showing them; the general audit
 * screen, which is where somebody goes when they do not already know which
 * transaction to look at, still did not.
 *
 * IT SHOWS THE DIFFERENCE, NOT BOTH SIDES
 *
 * A row whose before and after are printed in full asks the reader to spot
 * which of fourteen fields moved. Only the keys that differ are listed, as
 * `field: was → now`, which is the question being asked. A key present on one
 * side and not the other is shown with a dash for the missing side rather than
 * omitted -- a field that appeared or disappeared is a change.
 *
 * WHERE IT SAYS NOTHING
 *
 * An action with neither side is a creation or a read, and renders as nothing
 * at all rather than as "no changes": an empty diff on a row that never had
 * one is noise on every line of the busiest screen in the portal.
 */
export function BeforeAfter({
  before,
  after,
}: {
  before: unknown;
  after: unknown;
}) {
  const { t } = usePortalI18n();

  const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;

  const oldRecord = asRecord(before);
  const newRecord = asRecord(after);
  if (!oldRecord && !newRecord) {
    /*
     * A value that is not an object at all -- a bare string or number in
     * `new_value` -- still deserves to be shown rather than swallowed.
     */
    if (before === null || before === undefined) {
      if (after === null || after === undefined) return null;
    }
    return (
      <span className="before-after">
        {t.ofcT3Before}: {String(before ?? '—')} → {t.ofcT3After}: {String(after ?? '—')}
      </span>
    );
  }

  const show = (value: unknown): string => {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  const keys = [...new Set([...Object.keys(oldRecord ?? {}), ...Object.keys(newRecord ?? {})])];
  const changed = keys.filter((key) => show(oldRecord?.[key]) !== show(newRecord?.[key]));

  if (changed.length === 0) return null;

  return (
    <ul className="before-after">
      {changed.map((key) => (
        <li key={key}>
          <span className="before-after__field">{key}</span>{' '}
          <span className="before-after__was">{show(oldRecord?.[key])}</span>
          {' → '}
          <span className="before-after__now">{show(newRecord?.[key])}</span>
        </li>
      ))}
    </ul>
  );
}
