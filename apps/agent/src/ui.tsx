/** Shared presentation components and icons for the agent PWA. */

import type { ReactElement, ReactNode } from 'react';
import { Children, cloneElement, isValidElement, useId, useState } from 'react';
import { formatNaira } from '@psirs/shared';
import type { ApiError } from './lib/api';

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
export function ErrorAlert({ error }: { error: ApiError | null }) {
  if (!error) return null;

  const moneyLine =
    error.moneyStatus === 'NOT_DEBITED'
      ? 'No money has been taken from the taxpayer.'
      : error.moneyStatus === 'UNCONFIRMED'
        ? 'The payment has NOT been confirmed. Do not collect again.'
        : error.moneyStatus === 'RECEIVED'
          ? 'The money has been received.'
          : null;

  return (
    <div className={`alert alert--${error.moneyStatus === 'UNCONFIRMED' ? 'warning' : 'error'}`} role="alert">
      <strong>{error.message}</strong>
      {moneyLine && <p style={{ margin: '6px 0 0', fontWeight: 600 }}>{moneyLine}</p>}
      {error.nextStep && <p style={{ margin: '6px 0 0' }}>{error.nextStep}</p>}
      {error.details && error.details.length > 0 && (
        <ul>
          {error.details.map((detail, index) => (
            <li key={index}>
              {detail.field ? `${detail.field}: ` : ''}
              {detail.issue}
            </li>
          ))}
        </ul>
      )}
      {error.reference && (
        <p style={{ margin: '6px 0 0', fontSize: '0.78rem' }}>Reference: {error.reference}</p>
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
  const normalised = status.toUpperCase();
  const kind =
    ['CLEARED', 'ACTIVE', 'COMPLETED', 'PAID', 'VALID', 'SETTLED', 'VERIFIED', 'APPROVED', 'SYNCED'].some(
      (value) => normalised.includes(value),
    )
      ? 'success'
      : ['FAILED', 'REJECTED', 'REVERSED', 'SUSPENDED', 'REVOKED', 'EXPIRED', 'CANCELLED'].some((value) =>
            normalised.includes(value),
          )
        ? 'danger'
        : ['PENDING', 'REVIEW', 'SUBMITTED', 'INVITED', 'PROGRESS', 'AWAITING'].some((value) =>
              normalised.includes(value),
            )
          ? 'pending'
          : 'neutral';

  return <span className={`badge badge--${kind}`}>{status.replace(/_/g, ' ')}</span>;
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
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
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  required?: boolean;
  minLength?: number;
}) {
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
          aria-describedby={hint ? hintId : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="password__toggle"
          aria-pressed={shown}
          aria-label={shown ? 'Hide password' : 'Show password'}
          onClick={() => setShown((current) => !current)}
        >
          {shown ? 'Hide' : 'Show'}
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
