/** Shared presentation components for the government portal. */

import type { ReactNode } from 'react';
import { enumLabel, formatNaira, statusSeverity } from '@psirs/shared';
import type { ApiError } from './lib/api';
import { usePortalI18n } from './lib/i18n';
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

export function Badge({ status }: { status: string | null | undefined }) {
  const { t } = usePortalI18n();
  if (!status) return <>—</>;
  // `statusSeverity` lives in @psirs/shared because both front ends had their
  // own copy of it and both had the same bug: INACTIVE contains ACTIVE.
  //
  // The word inside the badge comes from the same package for the same
  // reason: it was the status as the database spells it, underscores taken
  // out, which is English on a screen an officer set to Hausa.
  return <span className={`badge badge--${statusSeverity(status)}`}>{enumLabel(status, t)}</span>;
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
      {children}
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

export function ErrorAlert({ error }: { error: ApiError | null }) {
  const { t } = usePortalI18n();
  if (!error) return null;
  return (
    <Alert kind="error" title={{ text: error.message }}>
      {error.nextStep && <p style={{ margin: '4px 0 0' }}>{error.nextStep}</p>}
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

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Table({
  columns,
  rows,
  empty,
}: {
  columns: { key: string; label: Label; numeric?: boolean; render?: (row: any) => ReactNode }[];
  rows: any[];
  empty?: Label;
}) {
  const text = useLabel();
  const { t } = usePortalI18n();
  if (rows.length === 0) return <Empty>{empty ? text(empty) : t.ofcNothingToShow}</Empty>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.numeric ? 'numeric' : undefined}>
                {text(column.label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id ?? index}>
              {columns.map((column) => (
                <td key={column.key} className={column.numeric ? 'numeric' : undefined}>
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

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
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
