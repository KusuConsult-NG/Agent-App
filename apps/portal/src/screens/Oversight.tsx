/** Fraud, leakage and audit oversight (PRD §32, §45, §67, §72). */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, can, downloadCsv, type ApiError } from '../lib/api';
import { Alert, Badge, ErrorAlert, Loading, Money, Stat, Table, formatDateTime } from '../ui';

export function FraudScreen() {
  const [leakage, setLeakage] = useState<any | null>(null);
  const [flags, setFlags] = useState<any[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('OPEN');

  const load = useCallback(() => {
    api
      .get('/government/leakage')
      .then(setLeakage)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });

    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    api
      .get<any[]>(`/government/fraud/flags?${params.toString()}`)
      .then(setFlags)
      .catch(() => setFlags([]));
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function review(id: string, decision: 'UNDER_REVIEW' | 'CONFIRMED' | 'DISMISSED') {
    const note = window.prompt('Record what you found (minimum 10 characters):');
    if (!note || note.trim().length < 10) return;
    try {
      await api.post(`/government/fraud/flags/${id}/review`, { decision, note });
      setMessage(
        decision === 'CONFIRMED'
          ? 'Flag confirmed. The agent’s commission has been placed on hold pending resolution.'
          : `Flag marked ${decision.toLowerCase().replace(/_/g, ' ')}.`,
      );
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    }
  }

  return (
    <>
      <div className="card">
        <h2 className="card__title">Revenue leakage monitoring</h2>
        <p className="card__hint">
          Signals are raised for review, never acted on automatically. No transaction is deleted or
          blocked by a heuristic.
        </p>
      </div>

      {leakage && (
        <div className="stat-grid">
          <Stat
            label="Unreconciled over 48h"
            value={<Money kobo={leakage.unreconciledOver48Hours.amount_kobo} />}
            hint={`${leakage.unreconciledOver48Hours.count} transaction(s)`}
            variant={Number(leakage.unreconciledOver48Hours.count) > 0 ? 'alert' : undefined}
          />
          <Stat
            label="Settlement shortfall"
            value={<Money kobo={leakage.settlementsOutstanding.variance_kobo} />}
            hint={`${leakage.settlementsOutstanding.count} settlement(s) outstanding`}
          />
          <Stat label="Duplicate payments" value={leakage.duplicatePayments.count} />
          <Stat
            label="Failed receipt verifications"
            value={leakage.failedReceiptVerifications.count}
            hint="Public checks that found no valid receipt"
          />
        </div>
      )}

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      {leakage && leakage.highRiskAgents.length > 0 && (
        <div className="card card--flush">
          <div style={{ padding: '18px 18px 0' }}>
            <h2 className="card__title">Agents with open flags</h2>
          </div>
          <Table
            columns={[
              { key: 'agent_code', label: 'Agent' },
              { key: 'full_name', label: 'Name' },
              { key: 'flag_count', label: 'Open flags', numeric: true },
              {
                key: 'highest_severity',
                label: 'Highest severity',
                render: (row) => <Badge status={row.highest_severity} />,
              },
            ]}
            rows={leakage.highRiskAgents}
          />
        </div>
      )}

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <div className="card__header">
            <div>
              <h2 className="card__title">Fraud signals</h2>
            </div>
            <div className="field" style={{ marginBottom: 0, minWidth: 160 }}>
              <label htmlFor="flag-status">Status</label>
              <select
                id="flag-status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="">All</option>
                <option value="OPEN">Open</option>
                <option value="UNDER_REVIEW">Under review</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="DISMISSED">Dismissed</option>
              </select>
            </div>
          </div>
        </div>
        {!flags ? (
          <div style={{ padding: 18 }}>
            <Loading rows={4} />
          </div>
        ) : (
          <Table
            columns={[
              { key: 'rule', label: 'Signal', render: (row) => <Badge status={row.rule} /> },
              { key: 'severity', label: 'Severity', render: (row) => <Badge status={row.severity} /> },
              { key: 'entity_type', label: 'Subject' },
              { key: 'agent_name', label: 'Agent', render: (row) => row.agent_name ?? '—' },
              {
                key: 'transaction_reference',
                label: 'Transaction',
                render: (row) => <span className="mono">{row.transaction_reference ?? '—'}</span>,
              },
              {
                key: 'detail',
                label: 'Detail',
                render: (row) => <span className="mono">{JSON.stringify(row.detail)}</span>,
              },
              { key: 'created_at', label: 'Raised', render: (row) => formatDateTime(row.created_at) },
              {
                key: 'action',
                label: '',
                render: (row) =>
                  can('fraud:manage') && ['OPEN', 'UNDER_REVIEW'].includes(row.status) ? (
                    <div className="button-row">
                      <button
                        type="button"
                        className="small danger"
                        onClick={() => review(row.id, 'CONFIRMED')}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        className="small secondary"
                        onClick={() => review(row.id, 'DISMISSED')}
                      >
                        Dismiss
                      </button>
                    </div>
                  ) : (
                    <Badge status={row.status} />
                  ),
              },
            ]}
            rows={flags}
            empty="No fraud signals match this filter."
          />
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

const AUDIT_QUERIES = [
  { key: 'reversed', label: 'Transactions reversed after successful payment', path: '/government/audit/queries/reversed-after-success' },
  { key: 'rates', label: 'All changes made to revenue rates', path: '/government/audit/queries/rate-changes' },
];

export function AuditScreen() {
  const [entries, setEntries] = useState<any[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [verification, setVerification] = useState<{ valid: boolean; message: string; entriesChecked: number } | null>(null);
  const [queryResult, setQueryResult] = useState<{ label: string; rows: any[] } | null>(null);
  const [filters, setFilters] = useState({ action: '', entityType: '' });

  useEffect(() => {
    const params = new URLSearchParams({ limit: '150' });
    if (filters.action) params.set('action', filters.action);
    if (filters.entityType) params.set('entityType', filters.entityType);

    setEntries(null);
    api
      .get<any[]>(`/government/audit?${params.toString()}`)
      .then(setEntries)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, [filters]);

  return (
    <>
      <div className="card">
        <div className="card__header">
          <div>
            <h2 className="card__title">Audit trail</h2>
            <p className="card__hint">
              Every entry is chained to the one before it. Editing or removing any historical entry
              breaks the chain and is detected by the check below.
            </p>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              const result = await api.get<{ valid: boolean; message: string; entriesChecked: number }>(
                '/government/audit/verify',
              );
              setVerification(result);
            }}
          >
            Verify chain integrity
          </button>
        </div>

        {verification && (
          <Alert
            kind={verification.valid ? 'success' : 'error'}
            title={verification.valid ? 'Audit trail intact' : 'Audit trail has been tampered with'}
          >
            <p style={{ margin: 0 }}>{verification.message}</p>
          </Alert>
        )}
      </div>

      <div className="card">
        <h2 className="card__title">Standard audit questions</h2>
        <p className="card__hint">
          Answerable without querying production tables directly.
        </p>
        <div className="button-row">
          {AUDIT_QUERIES.map((query) => (
            <button
              key={query.key}
              type="button"
              className="secondary"
              onClick={async () => {
                const rows = await api.get<any[]>(query.path);
                setQueryResult({ label: query.label, rows });
              }}
            >
              {query.label}
            </button>
          ))}
        </div>
      </div>

      {queryResult && (
        <div className="card card--flush">
          <div style={{ padding: '18px 18px 0' }}>
            <div className="card__header">
              <h2 className="card__title">{queryResult.label}</h2>
              <button type="button" className="small secondary" onClick={() => setQueryResult(null)}>
                Close
              </button>
            </div>
          </div>
          <Table
            columns={Object.keys(queryResult.rows[0] ?? { result: 'No rows' }).map((key) => ({
              key,
              label: key.replace(/_/g, ' '),
              render: (row: any) =>
                typeof row[key] === 'object' && row[key] !== null ? (
                  <span className="mono">{JSON.stringify(row[key])}</span>
                ) : (
                  String(row[key] ?? '—')
                ),
            }))}
            rows={queryResult.rows}
            empty="No records match this query."
          />
        </div>
      )}

      <ErrorAlert error={error} />

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <div className="filters">
            <div className="field">
              <label htmlFor="entity">Entity type</label>
              <input
                id="entity"
                value={filters.entityType}
                onChange={(event) => setFilters({ ...filters, entityType: event.target.value })}
                placeholder="payment, agent, taxpayer…"
              />
            </div>
            <div className="field">
              <label htmlFor="action">Action</label>
              <input
                id="action"
                value={filters.action}
                onChange={(event) => setFilters({ ...filters, action: event.target.value })}
                placeholder="payment.verified"
              />
            </div>
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                const params = new URLSearchParams({ limit: '500', format: 'csv' });
                if (filters.action) params.set('action', filters.action);
                if (filters.entityType) params.set('entityType', filters.entityType);
                const csv = await api.get<string>(`/government/audit?${params.toString()}`);
                downloadCsv(`plateau-audit-${new Date().toISOString().slice(0, 10)}.csv`, csv);
              }}
            >
              Export CSV
            </button>
          </div>
        </div>

        {!entries ? (
          <div style={{ padding: 18 }}>
            <Loading rows={6} />
          </div>
        ) : (
          <Table
            columns={[
              { key: 'sequence_no', label: '#', numeric: true },
              { key: 'created_at', label: 'When', render: (row) => formatDateTime(row.created_at) },
              { key: 'actor_name', label: 'Actor', render: (row) => row.actor_name ?? 'System' },
              { key: 'actor_role', label: 'Role' },
              { key: 'action', label: 'Action', render: (row) => <span className="mono">{row.action}</span> },
              { key: 'entity_type', label: 'Entity' },
              { key: 'result', label: 'Result', render: (row) => <Badge status={row.result} /> },
              { key: 'reason', label: 'Reason', render: (row) => row.reason ?? '—' },
              {
                key: 'hash',
                label: 'Hash',
                render: (row) => <span className="mono">{String(row.hash).slice(0, 10)}…</span>,
              },
            ]}
            rows={entries}
            empty="No audit entries match these filters."
          />
        )}
      </div>
    </>
  );
}
