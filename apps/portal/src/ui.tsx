/** Shared presentation components for the government portal. */

import type { ReactNode } from 'react';
import { formatNaira } from '@psirs/shared';
import type { ApiError } from './lib/api';

export function Money({ kobo }: { kobo: string | number | bigint | null | undefined }) {
  if (kobo === null || kobo === undefined || kobo === '') return <>—</>;
  try {
    return <>{formatNaira(BigInt(String(kobo)))}</>;
  } catch {
    return <>—</>;
  }
}

export function Stat({
  label,
  value,
  hint,
  variant,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  variant?: 'accent' | 'alert';
}) {
  return (
    <div className={`stat ${variant ? `stat--${variant}` : ''}`}>
      <p className="stat__label">{label}</p>
      <p className="stat__value">{value}</p>
      {hint && <p className="stat__hint">{hint}</p>}
    </div>
  );
}

export function Badge({ status }: { status: string | null | undefined }) {
  if (!status) return <>—</>;
  const value = status.toUpperCase();
  const kind = [
    'CLEARED', 'ACTIVE', 'COMPLETED', 'PAID', 'VALID', 'SETTLED', 'VERIFIED',
    'APPROVED', 'MATCHED', 'RESOLVED', 'SUCCESS',
  ].some((token) => value.includes(token))
    ? 'success'
    : ['FAILED', 'REJECTED', 'REVERSED', 'SUSPENDED', 'REVOKED', 'EXPIRED', 'CANCELLED',
       'MISSING', 'MISMATCH', 'DUPLICATE', 'DISPUTED', 'CRITICAL', 'HIGH'].some((token) =>
        value.includes(token),
      )
      ? 'danger'
      : ['PENDING', 'REVIEW', 'SUBMITTED', 'INVITED', 'PROGRESS', 'REQUESTED', 'OPEN',
         'MEDIUM', 'AWAITING'].some((token) => value.includes(token))
        ? 'pending'
        : 'neutral';

  return <span className={`badge badge--${kind}`}>{status.replace(/_/g, ' ')}</span>;
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

export function ErrorAlert({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return (
    <Alert kind="error" title={error.message}>
      {error.nextStep && <p style={{ margin: '4px 0 0' }}>{error.nextStep}</p>}
      {error.details && error.details.length > 0 && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {error.details.map((detail, index) => (
            <li key={index}>
              {detail.field ? `${detail.field}: ` : ''}
              {detail.issue}
            </li>
          ))}
        </ul>
      )}
      {error.reference && (
        <p style={{ margin: '6px 0 0', fontSize: '0.75rem' }}>Reference: {error.reference}</p>
      )}
    </Alert>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
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
  columns: { key: string; label: string; numeric?: boolean; render?: (row: any) => ReactNode }[];
  rows: any[];
  empty?: string;
}) {
  if (rows.length === 0) return <Empty>{empty ?? 'Nothing to show.'}</Empty>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.numeric ? 'numeric' : undefined}>
                {column.label}
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
  items: { label: string; value: number; sublabel?: string }[];
  formatValue: (value: number) => ReactNode;
}) {
  const max = Math.max(...items.map((item) => item.value), 1);
  if (items.length === 0) return <Empty>No data for this period.</Empty>;

  return (
    <div>
      {items.map((item) => (
        <div className="bar-row" key={item.label}>
          <span title={item.label}>
            {item.label}
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
  const max = Math.max(...points.map((point) => point.value), 1);
  return (
    <div className="spark" role="img" aria-label="Daily collection trend">
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
