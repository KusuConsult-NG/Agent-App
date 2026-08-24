/** Executive dashboard and revenue intelligence (PRD §37, §38, §59, §73). */

import { useEffect, useState } from 'react';
import { formatNaira } from '@psirs/shared';
import { ApiRequestError, api, type ApiError } from '../lib/api';
import { Alert, BarList, ErrorAlert, KeyValue, Loading, Money, Sparkline, Stat, Table } from '../ui';

interface Dashboard {
  collections: {
    today_kobo: string;
    week_kobo: string;
    month_kobo: string;
    ytd_kobo: string;
    total_kobo: string;
  };
  counts: Record<string, string>;
  revenueByCategory: { category: string; transactions: string; amount_kobo: string }[];
  revenueByLga: { lga: string; zone: string; transactions: string; amount_kobo: string }[];
  revenueByAgent: { agent_code: string; full_name: string; transactions: string; amount_kobo: string }[];
  revenueByMda: { mda: string; amount_kobo: string }[];
  dailyTrend: { day: string; amount_kobo: string; transactions: string }[];
  exceptions: Record<string, string>;
  /**
   * How much of the state these figures cover.
   *
   * A supervisor sees their territories and an administrator sees everything,
   * and the numbers look identical either way. Labelling it is not decoration:
   * "Collected today ₦0" from a supervisor with no territory assigned and
   * "Collected today ₦0" from a genuinely quiet Tuesday are the same screen,
   * and one of them is a configuration fault somebody has to fix.
   */
  scope?:
    | { kind: 'STATEWIDE' }
    | { kind: 'TERRITORIES'; territories: { id: string; name: string; code: string }[] };
}

export function DashboardScreen({ navigate }: { navigate: (path: string) => void }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    api
      .get<Dashboard>('/government/dashboard')
      .then(setData)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, []);

  if (error) return <ErrorAlert error={error} />;
  if (!data) return <Loading rows={6} />;

  const scope = data.scope;
  const territories = scope?.kind === 'TERRITORIES' ? scope.territories : null;

  const openExceptions =
    Number(data.exceptions.reconciliation_exceptions ?? 0) +
    Number(data.exceptions.open_fraud_flags ?? 0);

  return (
    <>
      {territories && territories.length === 0 && (
        <Alert kind="warning" title="No territory has been assigned to you">
          <p style={{ margin: 0 }}>
            These figures are empty because your account covers no territory yet, not because
            nothing was collected. Ask an administrator to assign yours.
          </p>
        </Alert>
      )}

      {territories && territories.length > 0 && (
        <Alert kind="info" title={`Showing ${territories.map((t) => t.name).join(', ')}`}>
          <p style={{ margin: 0 }}>
            Every figure on this page covers your {territories.length === 1 ? 'territory' : 'territories'} only,
            not the whole state.
          </p>
        </Alert>
      )}

      {openExceptions > 0 && (
        <Alert kind="warning" title={`${openExceptions} item(s) need attention`}>
          <p style={{ margin: 0 }}>
            {data.exceptions.reconciliation_exceptions} reconciliation exception(s) and{' '}
            {data.exceptions.open_fraud_flags} open fraud flag(s).{' '}
            <button type="button" className="link" onClick={() => navigate('/reconciliation')}>
              Review reconciliation
            </button>{' '}
            or{' '}
            <button type="button" className="link" onClick={() => navigate('/fraud')}>
              review flags
            </button>
            .
          </p>
        </Alert>
      )}

      <div className="stat-grid">
        <Stat
          label="Collected today"
          value={<Money kobo={data.collections.today_kobo} />}
          variant="accent"
          hint="Verified revenue only"
        />
        <Stat label="This month" value={<Money kobo={data.collections.month_kobo} />} />
        <Stat label="Year to date" value={<Money kobo={data.collections.ytd_kobo} />} />
        <Stat
          label="Commission liability"
          value={<Money kobo={data.counts.commission_liability_kobo} />}
          hint="Accrued but not yet paid"
        />
      </div>

      <div className="stat-grid">
        <Stat label="Registered taxpayers" value={Number(data.counts.taxpayers).toLocaleString()} hint={`${data.counts.new_taxpayers_this_month} new this month`} />
        <Stat label="Active agents" value={data.counts.active_agents} hint={`${data.counts.agents_awaiting_review} awaiting review`} />
        <Stat label="Successful transactions" value={Number(data.counts.successful_transactions).toLocaleString()} hint={`${data.counts.failed_transactions} failed`} />
        <Stat
          label="Awaiting reconciliation"
          value={data.counts.pending_reconciliation}
          variant={Number(data.counts.pending_reconciliation) > 0 ? 'alert' : undefined}
        />
      </div>

      <div className="card">
        <div className="card__header">
          <div>
            <h2 className="card__title">Collections over the last 30 days</h2>
            <p className="card__hint">Only payments confirmed by the payment gateway are counted.</p>
          </div>
        </div>
        <Sparkline
          points={data.dailyTrend.map((point) => ({
            label: point.day,
            value: Number(point.amount_kobo),
          }))}
        />
        <p style={{ fontSize: '0.75rem', color: 'var(--muted)', margin: '8px 0 0' }}>
          {data.dailyTrend[0]?.day} to {data.dailyTrend[data.dailyTrend.length - 1]?.day}
        </p>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2 className="card__title">Revenue by Local Government Area</h2>
          <p className="card__hint">Identifies areas where collection is below potential.</p>
          <BarList
            items={data.revenueByLga.slice(0, 10).map((row) => ({
              label: row.lga,
              sublabel: row.zone,
              value: Number(row.amount_kobo),
            }))}
            formatValue={(value) => formatNaira(BigInt(Math.round(value)))}
          />
        </div>

        <div className="card">
          <h2 className="card__title">Revenue by category</h2>
          <p className="card__hint">Which heads of revenue are actually producing.</p>
          <BarList
            items={data.revenueByCategory.slice(0, 10).map((row) => ({
              label: row.category,
              sublabel: `${row.transactions} txn`,
              value: Number(row.amount_kobo),
            }))}
            formatValue={(value) => formatNaira(BigInt(Math.round(value)))}
          />
        </div>
      </div>

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <h2 className="card__title">Top performing agents</h2>
          <p className="card__hint">
            Ranked by verified collections. Personal details beyond name and code are not shown here.
          </p>
        </div>
        <Table
          columns={[
            { key: 'agent_code', label: 'Agent' },
            { key: 'full_name', label: 'Name' },
            { key: 'transactions', label: 'Transactions', numeric: true },
            {
              key: 'amount_kobo',
              label: 'Collected',
              numeric: true,
              render: (row) => <Money kobo={row.amount_kobo} />,
            },
          ]}
          rows={data.revenueByAgent}
          empty="No agent collections recorded yet."
        />
      </div>

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <h2 className="card__title">Revenue by MDA</h2>
        </div>
        <Table
          columns={[
            { key: 'mda', label: 'MDA' },
            {
              key: 'amount_kobo',
              label: 'Collected',
              numeric: true,
              render: (row) => <Money kobo={row.amount_kobo} />,
            },
          ]}
          rows={data.revenueByMda}
          empty="No MDA collections recorded yet."
        />
      </div>

      <PlatformKpis />
    </>
  );
}

// ---------------------------------------------------------------------------

interface GeoRow {
  level: string;
  level_type: string;
  level_id?: string;
  zone?: string;
  transactions: string;
  amount_kobo: string;
  taxpayers: string;
  agents?: string;
}

export function IntelligenceScreen() {
  const [rows, setRows] = useState<GeoRow[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [drill, setDrill] = useState<{ lgaId?: string; lgaName?: string; wardId?: string; wardName?: string }>({});

  useEffect(() => {
    const params = new URLSearchParams();
    if (drill.wardId) params.set('wardId', drill.wardId);
    else if (drill.lgaId) params.set('lgaId', drill.lgaId);

    setRows(null);
    api
      .get<GeoRow[]>(`/government/intelligence/geography?${params.toString()}`)
      .then(setRows)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, [drill]);

  if (error) return <ErrorAlert error={error} />;

  return (
    <>
      <div className="card">
        <h2 className="card__title">Geographic revenue intelligence</h2>
        <p className="card__hint">
          Drill from State to LGA to Ward to Community to see where revenue is and is not being
          collected.
        </p>
        <p style={{ fontSize: '0.85rem', marginTop: 12 }}>
          <button type="button" className="link" onClick={() => setDrill({})}>
            Plateau State
          </button>
          {drill.lgaName && (
            <>
              {' › '}
              <button
                type="button"
                className="link"
                onClick={() => setDrill({ lgaId: drill.lgaId, lgaName: drill.lgaName })}
              >
                {drill.lgaName}
              </button>
            </>
          )}
          {drill.wardName && <> › {drill.wardName}</>}
        </p>
      </div>

      <div className="card card--flush">
        {!rows ? (
          <div style={{ padding: 18 }}>
            <Loading rows={5} />
          </div>
        ) : (
          <Table
            columns={[
              {
                key: 'level',
                label: rows[0]?.level_type ?? 'Area',
                render: (row: GeoRow) =>
                  row.level_id && row.level_type !== 'COMMUNITY' ? (
                    <button
                      type="button"
                      className="link"
                      onClick={() =>
                        row.level_type === 'LGA'
                          ? setDrill({ lgaId: row.level_id, lgaName: row.level })
                          : setDrill({ ...drill, wardId: row.level_id, wardName: row.level })
                      }
                    >
                      {row.level}
                    </button>
                  ) : (
                    row.level
                  ),
              },
              { key: 'zone', label: 'Zone' },
              { key: 'taxpayers', label: 'Taxpayers', numeric: true },
              { key: 'transactions', label: 'Transactions', numeric: true },
              {
                key: 'amount_kobo',
                label: 'Collected',
                numeric: true,
                render: (row: GeoRow) => <Money kobo={row.amount_kobo} />,
              },
            ]}
            rows={rows}
            empty="No collections recorded for this area."
          />
        )}
      </div>
    </>
  );
}

/**
 * The platform's own numbers (PRD §72).
 *
 * `GET /government/kpis` computed thirteen of these and nothing had ever asked
 * for it. Three of them are the ones this whole platform is built around —
 * how much was verified rather than claimed, how much reconciled, and how many
 * transactions are still waiting on it — so they are pulled out of the list
 * and given their own line rather than sitting in alphabetical order among
 * counts of taxpayers.
 */
function PlatformKpis() {
  const [kpis, setKpis] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    api
      .get<Record<string, string>>('/government/kpis')
      .then(setKpis)
      .catch(() => setKpis(null));
  }, []);

  if (!kpis) return null;

  const percent = (value: string | undefined) => `${Number(value ?? 0).toFixed(2)}%`;
  const seconds = Number(kpis.average_completion_seconds ?? 0);
  const duration =
    seconds < 60 ? `${Math.round(seconds)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;

  const unreconciled = Number(kpis.unreconciled_transactions ?? 0);

  return (
    <>
      <div className="stat-grid">
        <Stat
          label="Payments verified"
          value={percent(kpis.payment_success_rate_percent)}
          hint="Of every payment attempted"
        />
        <Stat
          label="Reconciled"
          value={percent(kpis.reconciliation_rate_percent)}
          hint="Matched across platform, gateway and settlement"
        />
        <Stat
          label="Awaiting reconciliation"
          value={unreconciled.toLocaleString()}
          variant={unreconciled > 0 ? 'alert' : undefined}
        />
        <Stat
          label="Receipts issued"
          value={percent(kpis.receipt_generation_rate_percent)}
          hint="Of transactions that counted as revenue"
        />
      </div>

      <div className="card">
        <div className="card__header">
          <h2 className="card__title">Platform KPIs</h2>
          <p className="card__hint">Since the platform began collecting.</p>
        </div>
        <KeyValue
          items={[
            ['Total collected', <Money key="c" kobo={kpis.total_collection_kobo} />],
            ['Active agents', Number(kpis.active_agents ?? 0).toLocaleString()],
            ['Taxpayers with a TIN', Number(kpis.taxpayers_with_tin ?? 0).toLocaleString()],
            ['New taxpayers this month', Number(kpis.new_taxpayers_this_month ?? 0).toLocaleString()],
            ['Average time to confirm a payment', duration],
            ['Reversals and refunds', Number(kpis.reversals ?? 0).toLocaleString()],
            ['Open fraud flags', Number(kpis.suspicious_transactions ?? 0).toLocaleString()],
            [
              'Duplicate registrations overridden',
              Number(kpis.duplicate_registrations_overridden ?? 0).toLocaleString(),
            ],
            [
              'Failed receipt verifications',
              Number(kpis.receipt_verification_failures ?? 0).toLocaleString(),
            ],
          ]}
        />
      </div>
    </>
  );
}
