/**
 * One transaction, told whole.
 *
 * The screen the platform was missing. A collection is spread across eleven
 * tables by the time it is finished, every one of them reachable and none of
 * them together, so "did the money arrive and who touched it" meant opening
 * reconciliation, then payments, then commissions, then the audit log, and
 * holding the joins in your head.
 *
 * THE ORDER ON THE PAGE IS THE ORDER THE MONEY MOVED
 *
 *   taxpayer → agent → what was charged → assessment → invoice
 *     → payment → gateway → receipt → settlement → reconciliation → commission
 *
 * then the timeline, then anything anybody has opened about it. That sequence
 * is not decoration: an officer scrolling stops at the first thing that looks
 * wrong, and a page ordered by table name would scatter the four rows that
 * matter across it.
 *
 * WHAT IS WITHHELD IS PRINTED
 *
 * Each section is gated on the permission its own screen requires, so a
 * supervisor sees this page without the settlement and without the audit
 * history. An empty section and a hidden one look identical, and an
 * investigator who cannot tell them apart will conclude something false — so
 * the server names what it withheld and this prints the list.
 */

import { useEffect, useState } from 'react';
import { ApiRequestError, api, can, type ApiError } from '../lib/api';
import { Alert, Badge, Empty, ErrorAlert, Loading, Money, Stat, Table, formatDate, formatDateTime } from '../ui';
import { usePortalI18n } from '../lib/i18n';
import { enumLabel } from '@psirs/shared';

interface TimelineEntry {
  at: string;
  source: 'STATE' | 'AUDIT';
  label: string;
  detail: string | null;
  actor: string | null;
  actor_role: string | null;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  result?: string;
}

interface Full {
  transaction: Record<string, any>;
  payments: Record<string, any>[];
  receipt: Record<string, any> | null;
  refunds: Record<string, any>[];
  settlement: Record<string, any> | null;
  reconciliation: Record<string, any>[];
  commission: Record<string, any> | null;
  timeline: TimelineEntry[];
  cases: Record<string, any>[];
  flags: Record<string, any>[];
  withheld: string[];
}

export function TransactionScreen({
  transactionKey,
  navigate,
}: {
  transactionKey: string;
  navigate: (path: string) => void;
}) {
  const { t } = usePortalI18n();
  const [full, setFull] = useState<Full | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    setFull(null);
    setError(null);
    api
      .get<Full>(`/government/transactions/${encodeURIComponent(transactionKey)}/full`)
      .then(setFull)
      .catch((caught) => setError(caught instanceof ApiRequestError ? caught.error : null));
  }, [transactionKey]);

  if (error) return <div className="card"><ErrorAlert error={error} /></div>;
  if (!full) return <div className="card"><Loading rows={8} /></div>;

  const tx = full.transaction;
  const payment = full.payments[full.payments.length - 1] ?? null;

  return (
    <>
      <div className="card">
        <h2>{tx.transaction_reference}</h2>
        <p className="muted">{t.ofcT3Intro}</p>

        <div className="stat-grid">
          <Stat label="ofcAgOutstanding" value={<Money kobo={tx.amount_kobo} />} />
          <Stat label="ofcT3ServiceCharge" value={<Money kobo={tx.service_charge_kobo} />} />
          <Stat label="ofcCwStatus" value={<Badge status={tx.status} />} />
          <Stat label="ofcT3Channel" value={tx.channel} />
        </div>

        {full.withheld.length > 0 && (
          <Alert kind="info" title="ofcT3Withheld">
            <p>{t.ofcT3WithheldBody}</p>
            <p>
              <strong>{full.withheld.join(', ')}</strong>
            </p>
          </Alert>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      <div className="card">
        <h3>{t.ofcT3Chain}</h3>
        <dl className="kv-list">
          <dt>{t.ofcSearchTaxpayer}</dt>
          <dd>
            {tx.taxpayer_name}
            {tx.tin ? ` · ${tx.tin}` : ''} · {tx.taxpayer_phone}
          </dd>

          <dt>{t.ofcSearchAgent}</dt>
          <dd>
            {tx.agent_code ? (
              <>
                {tx.agent_code} · {tx.agent_name} · <Badge status={tx.agent_status} />
              </>
            ) : (
              `${tx.created_by_name} (${enumLabel(tx.created_by_role, t)})`
            )}
          </dd>

          <dt>{t.ofcSearchRevenueItem}</dt>
          <dd>
            {tx.revenue_item} · {tx.revenue_category}
            {tx.mda ? ` · ${tx.mda}` : ''}
          </dd>

          <dt>{t.ofcT3Where}</dt>
          <dd>
            {tx.lga}
            {tx.ward ? ` · ${tx.ward}` : ''}
            {tx.territory ? ` · ${tx.territory}` : ''}
          </dd>

          <dt>{t.ofcT3Assessment}</dt>
          <dd>
            {tx.assessment_number} · <Money kobo={tx.base_amount_kobo} />
            {tx.period_label ? ` · ${tx.period_label}` : ''} · {formatDateTime(tx.assessed_at)}
          </dd>

          <dt>{t.ofcT3Invoice}</dt>
          <dd>
            {tx.invoice_number} · <Money kobo={tx.invoice_total_kobo} /> ·{' '}
            <Badge status={tx.invoice_status} /> · {formatDateTime(tx.invoiced_at)}
          </dd>
        </dl>
      </div>

      {/* ------------------------------------------------------------------ */}
      <div className="card">
        <h3>{t.ofcT3Payment}</h3>
        {full.withheld.includes('payments') ? (
          <Empty>{t.ofcT3Withheld}</Empty>
        ) : full.payments.length === 0 ? (
          <Empty>{t.ofcT3NoPayment}</Empty>
        ) : (
          <Table
            rows={full.payments}
            columns={[
              { key: 'payment_reference', label: 'ofcSearchPayment' },
              {
                key: 'gateway',
                label: 'ofcT3Gateway',
                render: (row) => (
                  <>
                    {row.gateway}
                    {row.gateway_reference && (
                      <>
                        <br />
                        <span className="muted">{row.gateway_reference}</span>
                      </>
                    )}
                  </>
                ),
              },
              {
                key: 'amount_kobo',
                label: 'ofcAgOutstanding',
                numeric: true,
                render: (row) => <Money kobo={row.amount_kobo} />,
              },
              {
                key: 'status',
                label: 'ofcSpTicket',
                render: (row) => (
                  <>
                    <Badge status={row.status} />
                    {row.failure_reason && (
                      <>
                        <br />
                        <span className="muted">{row.failure_reason}</span>
                      </>
                    )}
                  </>
                ),
              },
              {
                key: 'verified_at',
                label: 'ofcT3Verified',
                render: (row) =>
                  row.verified_at
                    ? `${formatDateTime(row.verified_at)} · ${row.verified_by_source}`
                    : '—',
              },
            ]}
          />
        )}

        <h3>{t.ofcTxReceipt}</h3>
        {!full.receipt ? (
          <Empty>{t.ofcT3NoReceipt}</Empty>
        ) : (
          <dl className="kv-list">
            <dt>{t.ofcSearchReceipt}</dt>
            <dd>
              {full.receipt.receipt_number} · <Badge status={full.receipt.status} />
            </dd>
            <dt>{t.verificationCode}</dt>
            <dd>{full.receipt.verification_code}</dd>
            <dt>{t.ofcRhWhen}</dt>
            <dd>{formatDateTime(full.receipt.issued_at)}</dd>
            {full.receipt.void_reason && (
              <>
                <dt>{t.ofcCwWhy}</dt>
                <dd>
                  {full.receipt.void_reason} · {full.receipt.voided_by_name}
                </dd>
              </>
            )}
          </dl>
        )}

        {full.refunds.length > 0 && (
          <>
            <h3>{t.ofcT3Refunds}</h3>
            <Table
              rows={full.refunds}
              columns={[
                { key: 'refund_reference', label: 'ofcOsRefund' },
                {
                  key: 'amount_kobo',
                  label: 'ofcAgOutstanding',
                  numeric: true,
                  render: (row) => <Money kobo={row.amount_kobo} />,
                },
                { key: 'reason', label: 'ofcCwWhy' },
                {
                  key: 'status',
                  label: 'ofcSpTicket',
                  render: (row) => <Badge status={row.status} />,
                },
                { key: 'approved_by_name', label: 'ofcFnApproved' },
              ]}
            />
          </>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      <div className="card">
        <h3>{t.ofcT3Settlement}</h3>
        {full.withheld.includes('settlement') ? (
          <Empty>{t.ofcT3Withheld}</Empty>
        ) : !full.settlement ? (
          <Empty>{t.ofcT3NoSettlement}</Empty>
        ) : (
          <dl className="kv-list">
            <dt>{t.ofcFnSettlements}</dt>
            <dd>
              {full.settlement.settlement_reference} · <Badge status={full.settlement.status} />
            </dd>
            <dt>{t.ofcFnBankReference}</dt>
            <dd>{full.settlement.bank_reference ?? '—'}</dd>
            <dt>{t.ofcFnCredited}</dt>
            <dd>
              <Money kobo={full.settlement.received_amount_kobo} /> {t.ofcFnAsOnStatement}{' '}
              {formatDate(full.settlement.settlement_date)}
            </dd>
            <dt>{t.ofcFnBankAccount}</dt>
            <dd>{full.settlement.government_account ?? '—'}</dd>
            {full.settlement.reconciled_by_name && (
              <>
                <dt>{t.ofcFnResolve}</dt>
                <dd>
                  {full.settlement.reconciled_by_name} ·{' '}
                  {formatDateTime(full.settlement.reconciled_at)}
                </dd>
              </>
            )}
          </dl>
        )}

        <h3>{t.ofcT3Reconciliation}</h3>
        {full.withheld.includes('settlement') ? (
          <Empty>{t.ofcT3Withheld}</Empty>
        ) : (
          <Table
            rows={full.reconciliation}
            empty="ofcT3NoReconciliation"
            columns={[
              { key: 'status', label: 'ofcSpTicket', render: (row) => <Badge status={row.status} /> },
              {
                key: 'expected_amount_kobo',
                label: 'ofcFnTotalExpected',
                numeric: true,
                render: (row) => <Money kobo={row.expected_amount_kobo} />,
              },
              {
                key: 'received_amount_kobo',
                label: 'ofcFnTotalReceived',
                numeric: true,
                render: (row) => <Money kobo={row.received_amount_kobo} />,
              },
              {
                key: 'variance_kobo',
                label: 'ofcFnVariance',
                numeric: true,
                render: (row) => <Money kobo={row.variance_kobo} />,
              },
              {
                key: 'reconciled_at',
                label: 'ofcRhWhen',
                render: (row) =>
                  row.reconciled_at
                    ? `${formatDateTime(row.reconciled_at)} · ${row.reconciled_by_name ?? ''}`
                    : formatDateTime(row.created_at),
              },
            ]}
          />
        )}

        <h3>{t.ofcT3Commission}</h3>
        {full.withheld.includes('commission') ? (
          <Empty>{t.ofcT3Withheld}</Empty>
        ) : !full.commission ? (
          <Empty>{t.ofcT3NoCommission}</Empty>
        ) : (
          <dl className="kv-list">
            <dt>{t.ofcNavCommissions}</dt>
            <dd>
              <Money kobo={full.commission.amount_kobo} /> ·{' '}
              <Badge status={full.commission.status} /> ·{' '}
              {(full.commission.rate_basis_points / 100).toFixed(2)}%
              {full.commission.policy_name ? ` · ${full.commission.policy_name}` : ''}
            </dd>
            {full.commission.hold_reason && (
              <>
                <dt>{t.ofcCwWhy}</dt>
                <dd>{full.commission.hold_reason}</dd>
              </>
            )}
            <dt>{t.ofcFnPayout}</dt>
            <dd>
              {full.commission.payout_reference ? (
                <>
                  {full.commission.payout_reference} ·{' '}
                  <Badge status={full.commission.payout_status} />
                  {full.commission.payout_bank_reference
                    ? ` · ${full.commission.payout_bank_reference}`
                    : ''}
                  {full.commission.payout_failure ? ` · ${full.commission.payout_failure}` : ''}
                </>
              ) : (
                '—'
              )}
            </dd>
          </dl>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      <div className="card">
        <h3>{t.ofcT3Timeline}</h3>
        <p className="muted">{t.ofcT3TimelineBody}</p>
        <ol className="thread">
          {full.timeline.map((entry, index) => (
            <li
              key={`${entry.at}-${index}`}
              className={`thread__item thread__item--${entry.source.toLowerCase()}`}
            >
              <p className="thread__meta">
                <span className="muted">{formatDateTime(entry.at)}</span>{' '}
                <strong>{entry.label}</strong>{' '}
                <span className="badge badge--neutral">
                  {entry.source === 'STATE' ? t.ofcT3Platform : t.ofcT3OfficerAction}
                </span>
                {entry.result && entry.result !== 'SUCCESS' && <Badge status={entry.result} />}
              </p>
              {(entry.actor || entry.detail) && (
                <p className="thread__body">
                  {entry.actor}
                  {entry.actor_role ? ` (${enumLabel(entry.actor_role, t)})` : ''}
                  {entry.detail ? ` — ${entry.detail}` : ''}
                </p>
              )}
              {/*
                * Before and after, where a record was changed.
                *
                * `audit_logs` has carried these since the platform started and
                * nothing rendered them, so an auditor asking "what did that
                * change actually do" had to read JSON out of a CSV export.
                */}
              {(entry.old_value || entry.new_value) && (
                <p className="muted">
                  {t.ofcT3Before}: {stringify(entry.old_value)} → {t.ofcT3After}:{' '}
                  {stringify(entry.new_value)}
                </p>
              )}
            </li>
          ))}
        </ol>
      </div>

      {/* ------------------------------------------------------------------ */}
      <div className="card">
        <h3>{t.ofcT3CasesAndFlags}</h3>
        {full.cases.length === 0 && full.flags.length === 0 ? (
          <Empty>{t.ofcT3NothingLinked}</Empty>
        ) : (
          <>
            {full.cases.length > 0 && (
              <Table
                rows={full.cases}
                columns={[
                  {
                    key: 'case_number',
                    label: 'ofcCwCaseNumber',
                    render: (row) => (
                      <a href={`#/cases?case=${row.id}`}>
                        <strong>{row.case_number}</strong>
                        <br />
                        <span className="muted">{row.subject}</span>
                      </a>
                    ),
                  },
                  {
                    key: 'status',
                    label: 'ofcSpTicket',
                    render: (row) => <Badge status={row.status} />,
                  },
                  { key: 'assignee_name', label: 'ofcCwAssignee' },
                ]}
              />
            )}
            {full.flags.length > 0 && (
              <Table
                rows={full.flags}
                columns={[
                  { key: 'rule', label: 'ofcAgSignal' },
                  {
                    key: 'severity',
                    label: 'ofcAgSeverity',
                    render: (row) => <Badge status={row.severity} />,
                  },
                  {
                    key: 'status',
                    label: 'ofcSpTicket',
                    render: (row) => <Badge status={row.status} />,
                  },
                ]}
              />
            )}
          </>
        )}

        {can('case:create') && (
          <button
            type="button"
            onClick={() => navigate(`/cases?about=${tx.id}&reference=${tx.transaction_reference}`)}
          >
            {t.ofcT3OpenCaseAbout}
          </button>
        )}
      </div>
    </>
  );
}

function stringify(value: Record<string, unknown> | null | undefined): string {
  if (!value) return '—';
  if (typeof value !== 'object') return String(value);
  return Object.entries(value)
    .map(([key, entry]) => `${key}: ${entry === null ? '—' : String(entry)}`)
    .join(', ');
}
