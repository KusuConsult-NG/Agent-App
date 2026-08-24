/** Fraud, leakage and audit oversight (PRD §32, §45, §67, §72). */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, can, downloadCsv, type ApiError } from '../lib/api';
import { Alert, Badge, ErrorAlert, Loading, Money, Stat, Table, formatDateTime } from '../ui';
import { withJustification } from '../lib/justify';

/**
 * The evidence behind a signal, in a form an officer can act on.
 *
 * This was `JSON.stringify(detail)`, so the reason an "out of territory" flag
 * had been raised arrived as a pair of UUIDs — the reviewer could see that two
 * territories differed but not which, which is the entire content of the
 * signal. Every flag here is raised for a person to judge before anything
 * happens to a transaction, and evidence they have to query the database to
 * read is evidence that does not get read.
 *
 * Identifiers are still shown, last and dimmed: they are what an officer quotes
 * when escalating, but they are not what they reason with.
 */
function SignalDetail({ detail }: { detail: Record<string, unknown> | null }) {
  if (!detail || typeof detail !== 'object') return <span>—</span>;

  const entries = Object.entries(detail);
  if (entries.length === 0) return <span>—</span>;

  const readable = entries.filter(([key]) => !key.endsWith('Id'));
  const identifiers = entries.filter(([key]) => key.endsWith('Id'));

  return (
    <div className="signal-detail">
      {(readable.length > 0 ? readable : identifiers).map(([key, value]) => (
        <div key={key}>
          <span className="signal-detail__key">{humanise(key)}</span>{' '}
          <span className="signal-detail__value">{formatValue(value)}</span>
        </div>
      ))}
      {readable.length > 0 && identifiers.length > 0 && (
        <details className="signal-detail__ids">
          <summary>identifiers</summary>
          {identifiers.map(([key, value]) => (
            <div key={key} className="mono">
              {humanise(key)} {formatValue(value)}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

/** `agentAssignedTo` → `Agent assigned to`. */
function humanise(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function FraudScreen() {
  const [leakage, setLeakage] = useState<any | null>(null);
  const [flags, setFlags] = useState<any[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('OPEN');
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<string | null>(null);

  /*
   * `fraud:manage` is held by administrators and revenue officers only. A
   * finance officer, an auditor and a supervisor all hold `fraud:read` — they
   * look at flags, they do not raise them — so the control is not offered to
   * them rather than being offered and refused.
   */
  const canSweep = can('fraud:manage');

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
    await withJustification({
      question: 'Record what you found (at least 10 characters):',
      minimum: 10,
      tooShort:
        'Record what you found, in at least 10 characters. It is the only account of why this flag was settled the way it was.',
      run: async (note) => {
        await api.post(`/government/fraud/flags/${id}/review`, { decision, note });
        load();
      },
      onSuccess:
        decision === 'CONFIRMED'
          ? 'Flag confirmed. The agent\u2019s commission has been placed on hold pending resolution.'
          : `Flag marked ${decision.toLowerCase().replace(/_/g, ' ')}.`,
      setError,
      setMessage,
    });
  }

  return (
    <>
      <div className="card">
        <h2 className="card__title">Revenue leakage monitoring</h2>
        <p className="card__hint">
          Signals are raised for review, never acted on automatically. No transaction is deleted or
          blocked by a heuristic.
        </p>
        {canSweep && (
          <>
            <p className="card__hint" style={{ marginTop: 12 }}>
              The sweep re-runs every heuristic over the current data and raises what it finds. It
              raises flags for a person to judge and changes no transaction, so running it is
              safe — but it is a deliberate act rather than something that happens quietly, which
              is why it is a button.
            </p>
            <div className="button-row">
              <button
                type="button"
                disabled={sweeping}
                onClick={async () => {
                  setSweeping(true);
                  setSweepResult(null);
                  setError(null);
                  try {
                    const result = await api.post<{ flagsRaised?: number; raised?: number }>(
                      '/government/fraud/sweep',
                      {},
                    );
                    const raised = result.flagsRaised ?? result.raised ?? 0;
                    setSweepResult(
                      raised === 0
                        ? 'Sweep complete. Nothing new was flagged.'
                        : `Sweep complete. ${raised} flag(s) raised for review.`,
                    );
                    load();
                  } catch (caught) {
                    if (caught instanceof ApiRequestError) setError(caught.error);
                  } finally {
                    setSweeping(false);
                  }
                }}
              >
                {sweeping ? 'Sweeping…' : 'Run a fraud sweep now'}
              </button>
            </div>
            {sweepResult && <Alert kind="success">{sweepResult}</Alert>}
          </>
        )}
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
                render: (row) => <SignalDetail detail={row.detail} />,
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

/**
 * The audit questions, and what each needs before it can be asked.
 *
 * Three of the five took a parameter and had no caller anywhere, because this
 * list only modelled the ones that take none: transactions by a named agent,
 * receipts under a named revenue item, and who has looked at a named
 * taxpayer's record. The last of those is the question a data-protection
 * enquiry actually asks, and it was answerable only by querying the database
 * directly — which is the thing this screen says it exists to avoid.
 *
 * Each parameter is chosen from a list rather than typed. An auditor knows the
 * agent's name and the taxpayer's phone number; nobody knows a UUID.
 */
interface AuditQuery {
  key: string;
  label: string;
  path: string;
  /** What must be picked first. Absent means the question can be asked as it is. */
  parameter?: {
    name: string;
    prompt: string;
    /** Where the options come from, and how to label them. */
    source: 'agents' | 'revenueItems' | 'taxpayerSearch';
  };
  /** Whether the query also wants a period. */
  period?: boolean;
}

const AUDIT_QUERIES: AuditQuery[] = [
  {
    key: 'reversed',
    label: 'Transactions reversed after successful payment',
    path: '/government/audit/queries/reversed-after-success',
  },
  {
    key: 'rates',
    label: 'All changes made to revenue rates',
    path: '/government/audit/queries/rate-changes',
  },
  {
    key: 'agent-transactions',
    label: 'Everything one agent collected',
    path: '/government/audit/queries/agent-transactions',
    parameter: { name: 'agentId', prompt: 'Which agent?', source: 'agents' },
    period: true,
  },
  {
    key: 'receipts-by-item',
    label: 'Receipts issued under one revenue item',
    path: '/government/audit/queries/receipts-by-item',
    parameter: { name: 'revenueItemCode', prompt: 'Which revenue item?', source: 'revenueItems' },
  },
  {
    key: 'taxpayer-access',
    label: 'Who has looked at one taxpayer’s record',
    path: '/government/audit/queries/taxpayer-access',
    parameter: { name: 'taxpayerId', prompt: 'Which taxpayer?', source: 'taxpayerSearch' },
  },
];

export function AuditScreen() {
  const [entries, setEntries] = useState<any[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [verification, setVerification] = useState<{ valid: boolean; message: string; entriesChecked: number } | null>(null);
  const [queryResult, setQueryResult] = useState<{ label: string; rows: any[] } | null>(null);
  const [pending, setPending] = useState<AuditQuery | null>(null);
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
                if (query.parameter) {
                  setPending(query);
                  setQueryResult(null);
                  return;
                }
                setPending(null);
                try {
                  const rows = await api.get<any[]>(query.path);
                  setQueryResult({ label: query.label, rows });
                } catch (caught) {
                  if (caught instanceof ApiRequestError) setError(caught.error);
                }
              }}
            >
              {query.label}
            </button>
          ))}
        </div>
      </div>

      {pending && (
        <AuditQueryParameters
          query={pending}
          onCancel={() => setPending(null)}
          onRan={(rows) => {
            setQueryResult({ label: pending.label, rows });
            setPending(null);
          }}
          onError={setError}
        />
      )}

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

/**
 * Choose what a query is about, then run it.
 *
 * The options are fetched from the lists an auditor already has access to —
 * every role holding audit:read also holds agent:read:all, catalogue:read and
 * taxpayer:read:all, so none of these selects can present a choice the query
 * would then refuse.
 */
function AuditQueryParameters({
  query,
  onCancel,
  onRan,
  onError,
}: {
  query: AuditQuery;
  onCancel: () => void;
  onRan: (rows: any[]) => void;
  onError: (error: ApiError) => void;
}) {
  const [options, setOptions] = useState<{ value: string; label: string }[] | null>(null);
  const [value, setValue] = useState('');
  const [search, setSearch] = useState('');
  /**
   * Whether a taxpayer search has been run, as distinct from whether it found
   * anything. Taxpayers are searched rather than listed, so an empty option
   * list means one of two opposite things: nobody has searched yet, or the
   * search came back with nobody. Without this flag the select said "Search
   * for a taxpayer first" in both cases, which tells an auditor who has just
   * searched to do the thing they have already done.
   */
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86_400_000);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  });

  const source = query.parameter!.source;

  useEffect(() => {
    setOptions(null);
    setValue('');
    setSearched(false);
    if (source === 'agents') {
      api
        .get<{ agents: any[] } | any[]>('/agents?limit=200')
        .then((data) => {
          const list = Array.isArray(data) ? data : data.agents;
          setOptions(
            list.map((agent: any) => ({
              value: agent.id,
              label: `${agent.full_name} (${agent.agent_code})`,
            })),
          );
        })
        .catch(() => setOptions([]));
    } else if (source === 'revenueItems') {
      api
        .get<any[]>('/revenue/items')
        .then((list) =>
          setOptions(
            (Array.isArray(list) ? list : []).map((item: any) => ({
              value: item.code,
              label: `${item.name} (${item.code})`,
            })),
          ),
        )
        .catch(() => setOptions([]));
    } else {
      // Taxpayers are searched rather than listed: there are more of them than
      // any select should hold, and an auditor arrives knowing a name or number.
      setOptions([]);
    }
  }, [source]);

  async function runSearch() {
    if (!search.trim()) return;
    setBusy(true);
    try {
      const found = await api.get<any[] | { taxpayers: any[] }>(
        `/taxpayers/search?q=${encodeURIComponent(search.trim())}&limit=25`,
      );
      const list = Array.isArray(found) ? found : found.taxpayers;
      setOptions(
        list.map((taxpayer: any) => ({
          value: taxpayer.id ?? taxpayer.taxpayer_id,
          label: `${taxpayer.display_name ?? taxpayer.business_name ?? [taxpayer.first_name, taxpayer.last_name].filter(Boolean).join(' ')} · ${taxpayer.phone ?? ''}`,
        })),
      );
      setSearched(true);
    } catch (caught) {
      if (caught instanceof ApiRequestError) onError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    try {
      const params = new URLSearchParams({ [query.parameter!.name]: value });
      if (query.period) {
        params.set('from', new Date(`${range.from}T00:00:00`).toISOString());
        params.set('to', new Date(`${range.to}T23:59:59`).toISOString());
      }
      onRan(await api.get<any[]>(`${query.path}?${params.toString()}`));
    } catch (caught) {
      if (caught instanceof ApiRequestError) onError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card__header">
        <h2 className="card__title">{query.label}</h2>
        <button type="button" className="small secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {source === 'taxpayerSearch' && (
        <div className="filters">
          <div className="field">
            <label htmlFor="taxpayer-search">Find the taxpayer</label>
            <input
              id="taxpayer-search"
              value={search}
              placeholder="Name, phone or TIN"
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void runSearch();
              }}
            />
          </div>
          <button type="button" className="secondary" disabled={busy} onClick={() => void runSearch()}>
            Search
          </button>
        </div>
      )}

      <div className="field">
        <label htmlFor="audit-parameter">{query.parameter!.prompt}</label>
        <select
          id="audit-parameter"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={!options || options.length === 0}
        >
          <option value="">
            {!options
              ? 'Loading…'
              : options.length === 0
                ? source === 'taxpayerSearch'
                  ? searched
                    ? 'No taxpayer matched that search'
                    : 'Search for a taxpayer first'
                  : 'Nothing to choose from'
                : 'Select one'}
          </option>
          {(options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {query.period && (
        <div className="filters">
          <div className="field">
            <label htmlFor="audit-from">From</label>
            <input
              id="audit-from"
              type="date"
              value={range.from}
              onChange={(event) => setRange({ ...range, from: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="audit-to">To</label>
            <input
              id="audit-to"
              type="date"
              value={range.to}
              onChange={(event) => setRange({ ...range, to: event.target.value })}
            />
          </div>
        </div>
      )}

      <button type="button" disabled={busy || !value} onClick={() => void run()}>
        {busy ? 'Running…' : 'Run this query'}
      </button>
    </div>
  );
}
