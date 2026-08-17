/** Reconciliation, settlement, commission and maker-checker approvals. */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, can, stepUp, type ApiError, type User } from '../lib/api';
import { Alert, Badge, ErrorAlert, Loading, Money, Stat, Table, formatDate, formatDateTime } from '../ui';

// ------------------------------------------------------------ reconciliation

export function ReconciliationScreen() {
  const [settlements, setSettlements] = useState<any | null>(null);
  const [exceptions, setExceptions] = useState<any[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState({
    from: new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  });

  const load = useCallback(() => {
    api
      .get('/government/settlements')
      .then(setSettlements)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
    api
      .get<any[]>('/government/reconciliation/exceptions')
      .then(setExceptions)
      .catch(() => setExceptions([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.post<{
        matched: number;
        exceptions: number;
        byStatus: Record<string, number>;
        totalPlatformKobo: string;
        totalGatewayKobo: string;
      }>('/government/reconciliation/run', {
        from: new Date(range.from).toISOString(),
        to: new Date(`${range.to}T23:59:59`).toISOString(),
      });
      setMessage(
        `Reconciliation complete: ${result.matched} matched, ${result.exceptions} exception(s). ` +
          `Platform total and gateway total ${
            result.totalPlatformKobo === result.totalGatewayKobo ? 'agree' : 'DO NOT agree'
          }.`,
      );
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  async function recover() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.post<{ attempted: number; verified: number }>(
        '/government/reconciliation/recover',
        {
          from: new Date(range.from).toISOString(),
          to: new Date(`${range.to}T23:59:59`).toISOString(),
        },
      );
      setMessage(
        `Checked ${result.attempted} unconfirmed payment(s) against the gateway; ` +
          `${result.verified} were confirmed and have now been receipted.`,
      );
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <div className="card__header">
          <div>
            <h2 className="card__title">Three-way reconciliation</h2>
            <p className="card__hint">
              Platform transaction against gateway transaction against government settlement.
              Anything that does not match becomes an exception below.
            </p>
          </div>
        </div>

        <div className="filters">
          <div className="field">
            <label htmlFor="from">From</label>
            <input
              id="from"
              type="date"
              value={range.from}
              onChange={(event) => setRange({ ...range, from: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="to">To</label>
            <input
              id="to"
              type="date"
              value={range.to}
              onChange={(event) => setRange({ ...range, to: event.target.value })}
            />
          </div>
          {can('payment:reconcile') && (
            <>
              <button type="button" disabled={busy} onClick={run}>
                Run reconciliation
              </button>
              <button type="button" className="secondary" disabled={busy} onClick={recover}>
                Recover missed confirmations
              </button>
            </>
          )}
        </div>

        <p className="field__hint">
          "Recover missed confirmations" re-checks payments the gateway completed but the platform
          never confirmed — normally a webhook that never arrived — and issues the receipts owed.
        </p>
      </div>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      {settlements && (
        <div className="stat-grid">
          <Stat label="Total expected" value={<Money kobo={settlements.totals.total_expected_kobo} />} />
          <Stat label="Total received" value={<Money kobo={settlements.totals.total_received_kobo} />} />
          <Stat
            label="Variance"
            value={<Money kobo={settlements.totals.total_variance_kobo} />}
            variant={settlements.totals.total_variance_kobo !== '0' ? 'alert' : undefined}
          />
          <Stat
            label="Awaiting settlement"
            value={<Money kobo={settlements.awaitingSettlement.amount_kobo} />}
            hint={`${settlements.awaitingSettlement.count} transaction(s)`}
          />
        </div>
      )}

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <h2 className="card__title">Exception queue</h2>
          <p className="card__hint">
            Every exception is a finance officer's task. Nothing here is written off automatically.
          </p>
        </div>
        {!exceptions ? (
          <div style={{ padding: 18 }}>
            <Loading rows={4} />
          </div>
        ) : (
          <Table
            columns={[
              { key: 'status', label: 'Exception', render: (row) => <Badge status={row.status} /> },
              {
                key: 'transaction_reference',
                label: 'Transaction',
                render: (row) => <span className="mono">{row.transaction_reference ?? '—'}</span>,
              },
              {
                key: 'gateway_reference',
                label: 'Gateway reference',
                render: (row) => <span className="mono">{row.gateway_reference ?? '—'}</span>,
              },
              {
                key: 'expected_amount_kobo',
                label: 'Expected',
                numeric: true,
                render: (row) => <Money kobo={row.expected_amount_kobo} />,
              },
              {
                key: 'received_amount_kobo',
                label: 'Received',
                numeric: true,
                render: (row) => <Money kobo={row.received_amount_kobo} />,
              },
              {
                key: 'variance_kobo',
                label: 'Variance',
                numeric: true,
                render: (row) => <Money kobo={row.variance_kobo} />,
              },
              { key: 'agent_code', label: 'Agent', render: (row) => row.agent_code ?? '—' },
              {
                key: 'action',
                label: '',
                render: (row) =>
                  can('payment:reconcile') ? (
                    <button
                      type="button"
                      className="small secondary"
                      onClick={async () => {
                        const resolution = window.prompt(
                          'Record how this exception was resolved (minimum 10 characters):',
                        );
                        if (!resolution || resolution.trim().length < 10) return;
                        await api.post(`/government/reconciliation/exceptions/${row.id}/resolve`, {
                          resolution,
                        });
                        load();
                      }}
                    >
                      Resolve
                    </button>
                  ) : null,
              },
            ]}
            rows={exceptions}
            empty="No open reconciliation exceptions."
          />
        )}
      </div>

      {settlements && (
        <div className="card card--flush">
          <div style={{ padding: '18px 18px 0' }}>
            <h2 className="card__title">Settlements to government accounts</h2>
          </div>
          <Table
            columns={[
              {
                key: 'settlement_reference',
                label: 'Reference',
                render: (row) => <span className="mono">{row.settlement_reference}</span>,
              },
              { key: 'settlement_date', label: 'Date', render: (row) => formatDate(row.settlement_date) },
              { key: 'bank_reference', label: 'Bank reference' },
              { key: 'transaction_count', label: 'Transactions', numeric: true },
              {
                key: 'expected_amount_kobo',
                label: 'Expected',
                numeric: true,
                render: (row) => <Money kobo={row.expected_amount_kobo} />,
              },
              {
                key: 'received_amount_kobo',
                label: 'Received',
                numeric: true,
                render: (row) => <Money kobo={row.received_amount_kobo} />,
              },
              { key: 'status', label: 'Status', render: (row) => <Badge status={row.status} /> },
            ]}
            rows={settlements.recentSettlements}
            empty="No settlements recorded."
          />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- commissions

export function CommissionsScreen() {
  const [payouts, setPayouts] = useState<any[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<any[]>('/government/commissions/payouts')
      .then(setPayouts)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div className="card">
        <h2 className="card__title">Commission payouts</h2>
        <p className="card__hint">
          Commission is calculated by the platform from verified government revenue. It is never
          deducted from what a taxpayer pays, and never payable on a reversed transaction.
        </p>
        {can('commission:manage') && (
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              const result = await api.post<{ promoted: number; message: string }>(
                '/government/commissions/promote',
              );
              setMessage(result.message);
              load();
            }}
          >
            Promote eligible commission
          </button>
        )}
      </div>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      <div className="card card--flush">
        {!payouts ? (
          <div style={{ padding: 18 }}>
            <Loading rows={4} />
          </div>
        ) : (
          <Table
            columns={[
              {
                key: 'payout_reference',
                label: 'Payout',
                render: (row) => <span className="mono">{row.payout_reference}</span>,
              },
              { key: 'agent_code', label: 'Agent' },
              { key: 'full_name', label: 'Name' },
              {
                key: 'amount_kobo',
                label: 'Amount',
                numeric: true,
                render: (row) => <Money kobo={row.amount_kobo} />,
              },
              { key: 'commission_count', label: 'Entries', numeric: true },
              {
                key: 'bank',
                label: 'Bank account',
                render: (row) => (
                  <>
                    {row.bank_name} ····{String(row.account_number).slice(-4)}{' '}
                    <Badge status={row.verification_status} />
                  </>
                ),
              },
              { key: 'status', label: 'Status', render: (row) => <Badge status={row.status} /> },
              {
                key: 'action',
                label: '',
                render: (row) => (
                  <div className="button-row">
                    {row.status === 'REQUESTED' && can('commission:payout:approve') && (
                      <button
                        type="button"
                        className="small"
                        onClick={async () => {
                          const reason = window.prompt('Reason for approving this payout:');
                          if (!reason || reason.trim().length < 5) return;
                          await api.post(`/government/commissions/payouts/${row.id}/approve`, {
                            reason,
                          });
                          setMessage('Payout approved.');
                          load();
                        }}
                      >
                        Approve
                      </button>
                    )}
                    {row.status === 'APPROVED' && can('commission:manage') && (
                      <button
                        type="button"
                        className="small secondary"
                        onClick={async () => {
                          const bankReference = window.prompt('Bank transfer reference:');
                          if (!bankReference || bankReference.trim().length < 3) return;
                          await api.post(`/government/commissions/payouts/${row.id}/complete`, {
                            bankReference,
                          });
                          setMessage('Payout recorded as paid.');
                          load();
                        }}
                      >
                        Record payment
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
            rows={payouts}
            empty="No payout requests."
          />
        )}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ approvals

export function ApprovalsScreen({ user }: { user: User }) {
  const [approvals, setApprovals] = useState<any[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('REQUESTED');

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    api
      .get<any[]>(`/government/approvals?${params.toString()}`)
      .then(setApprovals)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(id: string, decision: 'REVIEW' | 'APPROVE' | 'REJECT') {
    const reason = window.prompt(`Reason for this decision (minimum 10 characters):`);
    if (!reason || reason.trim().length < 10) return;
    setError(null);
    try {
      await api.post(`/government/approvals/${id}/decide`, { decision, reason });
      setMessage(`Request ${decision.toLowerCase()}d.`);
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    }
  }

  async function executeReversal(id: string) {
    setError(null);
    try {
      await stepUp('payment.reversal.approve', user.phone);
      const result = await api.post<{ refundReference: string; commissionReversed: number }>(
        `/government/approvals/${id}/execute-reversal`,
      );
      setMessage(
        `Reversal executed as ${result.refundReference}. ` +
          `${result.commissionReversed} commission record(s) reversed.`,
      );
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
      else if (caught instanceof Error) {
        setError({ code: 'CLIENT', message: caught.message, moneyStatus: 'NOT_APPLICABLE' });
      }
    }
  }

  return (
    <>
      <div className="card">
        <div className="card__header">
          <div>
            <h2 className="card__title">Maker-checker approvals</h2>
            <p className="card__hint">
              The officer who raises a request can never review or authorise it. Reversals need a
              third officer to execute, with step-up authentication.
            </p>
          </div>
          <div className="field" style={{ marginBottom: 0, minWidth: 170 }}>
            <label htmlFor="approval-status">Status</label>
            <select
              id="approval-status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">All</option>
              <option value="REQUESTED">Requested</option>
              <option value="REVIEWED">Reviewed</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="EXECUTED">Executed</option>
            </select>
          </div>
        </div>
      </div>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      <div className="card card--flush">
        {!approvals ? (
          <div style={{ padding: 18 }}>
            <Loading rows={4} />
          </div>
        ) : (
          <Table
            columns={[
              {
                key: 'approval_type',
                label: 'Type',
                render: (row) => <Badge status={row.approval_type} />,
              },
              { key: 'entity_type', label: 'Subject' },
              { key: 'requested_by_name', label: 'Requested by' },
              { key: 'requested_reason', label: 'Reason' },
              {
                key: 'requested_at',
                label: 'Requested',
                render: (row) => formatDateTime(row.requested_at),
              },
              { key: 'status', label: 'Status', render: (row) => <Badge status={row.status} /> },
              {
                key: 'action',
                label: '',
                render: (row) => {
                  const isRequester = row.requested_by_name === user.fullName;
                  if (isRequester) {
                    return <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Your request</span>;
                  }
                  return (
                    <div className="button-row">
                      {['REQUESTED', 'REVIEWED'].includes(row.status) && can('approval:review') && (
                        <>
                          <button type="button" className="small" onClick={() => decide(row.id, 'APPROVE')}>
                            Approve
                          </button>
                          <button
                            type="button"
                            className="small danger"
                            onClick={() => decide(row.id, 'REJECT')}
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {row.status === 'APPROVED' &&
                        ['PAYMENT_REVERSAL', 'REFUND'].includes(row.approval_type) &&
                        can('payment:reverse:approve') && (
                          <button
                            type="button"
                            className="small secondary"
                            onClick={() => executeReversal(row.id)}
                          >
                            Execute reversal
                          </button>
                        )}
                    </div>
                  );
                },
              },
            ]}
            rows={approvals}
            empty="No approval requests match this filter."
          />
        )}
      </div>
    </>
  );
}
