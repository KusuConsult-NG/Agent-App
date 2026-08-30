/**
 * How each agent is doing (PRD §72).
 *
 * `GET /agents/performance` computes fifteen figures per agent — collections,
 * failures, reversals, taxpayers onboarded, TINs, renewals, commission, open
 * fraud flags, days worked — and nothing in the portal had ever called it. A
 * supervisor's whole job is knowing which of their agents needs help, and the
 * only view they had was the clearance checklist of one agent at a time.
 *
 * Two things this screen tries not to do.
 *
 * It does not rank agents by collections alone. The largest collector in a
 * commercial ward will out-earn the best agent in a rural one every week, and
 * a table sorted by naira presents that as a performance difference. Volume,
 * reach and trouble are shown side by side so the comparison is at least
 * visibly incomplete.
 *
 * And it does not compute a score. A number with a formula behind it becomes
 * the thing people manage to, and this platform suspends people; a supervisor
 * reading rows and forming a judgement is slower and answerable in a way a
 * ranking is not.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, downloadCsv, type ApiError } from '../lib/api';
import { Alert, Badge, ErrorAlert, Loading, Money, Stat, Table } from '../ui';

interface AgentRow {
  agent_id: string;
  agent_code: string;
  full_name: string;
  lga: string | null;
  operational_status: string;
  successful_transactions: string;
  failed_transactions: string;
  reversed_transactions: string;
  collected_kobo: string;
  average_transaction_kobo: string;
  taxpayers_onboarded: string;
  tins_registered: string;
  vehicle_renewals: string;
  commission_earned_kobo: string;
  open_fraud_flags: string;
  active_days: string;
}

export function PerformanceScreen({ navigate }: { navigate: (path: string) => void }) {
  const [rows, setRows] = useState<AgentRow[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(() => {
    api
      .get<AgentRow[]>('/agents/performance?limit=200')
      .then(setRows)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
        setRows([]);
      });
  }, []);

  useEffect(load, [load]);

  const totals = (rows ?? []).reduce(
    (acc, row) => ({
      collected: acc.collected + BigInt(row.collected_kobo),
      onboarded: acc.onboarded + Number(row.taxpayers_onboarded),
      flags: acc.flags + Number(row.open_fraud_flags),
      working: acc.working + (Number(row.active_days) > 0 ? 1 : 0),
    }),
    { collected: 0n, onboarded: 0, flags: 0, working: 0 },
  );

  const flagged = (rows ?? []).filter((row) => Number(row.open_fraud_flags) > 0);

  return (
    <>
      <ErrorAlert error={error} />

      {flagged.length > 0 && (
        <Alert kind="warning" title={`${flagged.length} agent(s) with an open fraud flag`}>
          <p style={{ margin: 0 }}>
            A flag is a question, not a finding. Their figures are shown here unchanged —{' '}
            {flagged.map((row) => row.full_name).join(', ')}.
          </p>
        </Alert>
      )}

      <div className="stat-grid">
        <Stat label="Collected by agents" value={<Money kobo={totals.collected.toString()} />} />
        <Stat label="Taxpayers onboarded" value={totals.onboarded.toLocaleString()} />
        <Stat label="Agents who worked" value={`${totals.working} of ${rows?.length ?? 0}`} />
        <Stat
          label="Open fraud flags"
          value={String(totals.flags)}
          variant={totals.flags > 0 ? 'alert' : undefined}
        />
      </div>

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <div className="card__header">
            <h2 className="card__title">{t.ofcNavPerformance}</h2>
            <p className="card__hint">
              Collections, reach and trouble side by side. An agent in a commercial ward will
              out-collect the best agent in a rural one, so read the columns together rather than
              sorting by naira.
            </p>
          </div>
          {rows && rows.length > 0 && (
            <button
              type="button"
              className="small secondary"
              onClick={() => downloadCsv('agent-performance.csv', toCsv(rows))}
            >
              Download CSV
            </button>
          )}
        </div>

        {!rows ? (
          <Loading />
        ) : (
          <Table
            columns={[
              {
                key: 'full_name',
                label: 'ofcRhAgent',
                render: (row) => (
                  <button
                    type="button"
                    className="link"
                    onClick={() => navigate(`/agents/${row.agent_id}`)}
                  >
                    {row.full_name}
                  </button>
                ),
              },
              { key: 'agent_code', label: 'ofcAgCode' },
              { key: 'lga', label: 'tpLgaShort', render: (row) => row.lga ?? '—' },
              {
                key: 'operational_status',
                label: 'appStatus',
                render: (row) => <Badge status={row.operational_status} />,
              },
              {
                key: 'collected_kobo',
                label: 'Collected',
                numeric: true,
                render: (row) => <Money kobo={row.collected_kobo} />,
              },
              { key: 'successful_transactions', label: 'ofcNavTransactions', numeric: true },
              {
                key: 'average_transaction_kobo',
                label: 'Average',
                numeric: true,
                render: (row) => <Money kobo={row.average_transaction_kobo} />,
              },
              { key: 'taxpayers_onboarded', label: 'Onboarded', numeric: true },
              { key: 'tins_registered', label: 'TINs', numeric: true },
              { key: 'vehicle_renewals', label: 'Renewals', numeric: true },
              {
                key: 'commission_earned_kobo',
                label: 'navCommission',
                numeric: true,
                render: (row) => <Money kobo={row.commission_earned_kobo} />,
              },
              { key: 'failed_transactions', label: 'Failed', numeric: true },
              { key: 'reversed_transactions', label: 'Reversed', numeric: true },
              {
                key: 'open_fraud_flags',
                label: 'Flags',
                numeric: true,
                render: (row) =>
                  Number(row.open_fraud_flags) > 0 ? (
                    <strong className="danger-text">{row.open_fraud_flags}</strong>
                  ) : (
                    '0'
                  ),
              },
              { key: 'active_days', label: 'Days worked', numeric: true },
            ]}
            rows={rows}
            empty="ofcNoneAgentsCleared"
          />
        )}
      </div>
    </>
  );
}

/** Flatten the rows for export, keeping kobo as kobo so a spreadsheet can sum them. */
function toCsv(rows: AgentRow[]): string {
  const keys = Object.keys(rows[0] ?? {});
  const escape = (value: unknown) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    keys.join(','),
    ...rows.map((row) => keys.map((key) => escape((row as unknown as Record<string, unknown>)[key])).join(',')),
  ].join('\n');
}
