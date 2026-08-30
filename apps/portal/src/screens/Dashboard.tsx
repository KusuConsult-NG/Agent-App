/** Executive dashboard and revenue intelligence (PRD §37, §38, §59, §73). */

import { useEffect, useState } from 'react';
import { formatNaira } from '@psirs/shared';
import { ApiRequestError, api, type ApiError } from '../lib/api';
import { Alert, BarList, ErrorAlert, KeyValue, Loading, Money, Sparkline, Stat, Table } from '../ui';
import { usePortalI18n } from '../lib/i18n';

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
  const { t } = usePortalI18n();
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
        <Alert kind="warning" title="ofcDbNoTerritoryTitle">
          <p style={{ margin: 0 }}>{t.ofcDbNoTerritoryBody}</p>
        </Alert>
      )}

      {territories && territories.length > 0 && (
        <Alert
          kind="info"
          title={{
            text: t.ofcDbShowing.replace(
              '{{territories}}',
              territories.map((territory) => territory.name).join(', '),
            ),
          }}
        >
          <p style={{ margin: 0 }}>
            {territories.length === 1 ? t.ofcDbCoversYourTerritory : t.ofcDbCoversYourTerritories}
          </p>
        </Alert>
      )}

      {openExceptions > 0 && (
        <Alert
          kind="warning"
          title={{ text: t.ofcDbNeedAttention.replace('{{n}}', String(openExceptions)) }}
        >
          <p style={{ margin: 0 }}>
            {t.ofcDbExceptionsAnd
              .replace('{{exceptions}}', String(data.exceptions.reconciliation_exceptions))
              .replace('{{flags}}', String(data.exceptions.open_fraud_flags))}{' '}
            <button type="button" className="link" onClick={() => navigate('/reconciliation')}>{t.ofcDbReviewReconciliation}</button>{' '}
            or{' '}
            <button type="button" className="link" onClick={() => navigate('/fraud')}>{t.ofcDbReviewFlags}</button>
            .
          </p>
        </Alert>
      )}

      <div className="stat-grid">
        <Stat
          label="homeCollectedToday"
          value={<Money kobo={data.collections.today_kobo} />}
          variant="accent"
          hint="ofcDbVerifiedOnly"
        />
        <Stat label="ofcDbThisMonth" value={<Money kobo={data.collections.month_kobo} />} />
        <Stat label="ofcDbYearToDate" value={<Money kobo={data.collections.ytd_kobo} />} />
        <Stat
          label="ofcRhCommissionLiability"
          value={<Money kobo={data.counts.commission_liability_kobo} />}
          hint="ofcDbAccruedNotPaid"
        />
      </div>

      <div className="stat-grid">
        <Stat label="ofcDbRegisteredTaxpayers" value={Number(data.counts.taxpayers).toLocaleString()} hint={{ text: t.ofcDbNewThisMonth.replace('{{n}}', String(data.counts.new_taxpayers_this_month)) }} />
        <Stat label="ofcAgActiveAgents" value={data.counts.active_agents} hint={{ text: t.ofcDbAwaitingReview.replace('{{n}}', String(data.counts.agents_awaiting_review)) }} />
        <Stat label="ofcDbSuccessfulTransactions" value={Number(data.counts.successful_transactions).toLocaleString()} hint={{ text: t.ofcDbFailedCount.replace('{{n}}', String(data.counts.failed_transactions)) }} />
        <Stat
          label="ofcDbAwaitingReconciliation"
          value={data.counts.pending_reconciliation}
          variant={Number(data.counts.pending_reconciliation) > 0 ? 'alert' : undefined}
        />
      </div>

      <div className="card">
        <div className="card__header">
          <div>
            <h2 className="card__title">{t.ofcDbCollectionsLast30}</h2>
            <p className="card__hint">{t.ofcDbOnlyConfirmed}</p>
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
          <h2 className="card__title">{t.ofcDbRevenueByLga}</h2>
          <p className="card__hint">{t.ofcDbBelowPotential}</p>
          <BarList
            items={data.revenueByLga.slice(0, 10).map((row) => ({
              label: { text: row.lga },
              sublabel: row.zone,
              value: Number(row.amount_kobo),
            }))}
            formatValue={(value) => formatNaira(BigInt(Math.round(value)))}
          />
        </div>

        <div className="card">
          <h2 className="card__title">{t.ofcDbRevenueByCategory}</h2>
          <p className="card__hint">{t.ofcDbWhichHeads}</p>
          <BarList
            items={data.revenueByCategory.slice(0, 10).map((row) => ({
              label: { text: row.category },
              sublabel: `${row.transactions} txn`,
              value: Number(row.amount_kobo),
            }))}
            formatValue={(value) => formatNaira(BigInt(Math.round(value)))}
          />
        </div>
      </div>

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <h2 className="card__title">{t.ofcDbTopAgents}</h2>
          <p className="card__hint">{t.ofcDbTopAgentsBody}</p>
        </div>
        <Table
          columns={[
            { key: 'agent_code', label: 'ofcRhAgent' },
            { key: 'full_name', label: 'tpName' },
            { key: 'transactions', label: 'ofcNavTransactions', numeric: true },
            {
              key: 'amount_kobo',
              label: 'ofcPfCollected',
              numeric: true,
              render: (row) => <Money kobo={row.amount_kobo} />,
            },
          ]}
          rows={data.revenueByAgent}
          empty="ofcNoneAgentCollectionsRecorded"
        />
      </div>

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <h2 className="card__title">{t.ofcDbRevenueByMda}</h2>
        </div>
        <Table
          columns={[
            { key: 'mda', label: 'ofcDbMda' },
            {
              key: 'amount_kobo',
              label: 'ofcPfCollected',
              numeric: true,
              render: (row) => <Money kobo={row.amount_kobo} />,
            },
          ]}
          rows={data.revenueByMda}
          empty="ofcNoneMdaCollectionsRecorded"
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
  const { t } = usePortalI18n();
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
        <h2 className="card__title">{t.ofcDbIntelligenceTitle}</h2>
        <p className="card__hint">{t.ofcDbDrill}</p>
        <p style={{ fontSize: '0.85rem', marginTop: 12 }}>
          <button type="button" className="link" onClick={() => setDrill({})}>{t.ofcDbPlateauState}</button>
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
                label: { text: rows[0]?.level_type ?? t.ofcRvArea },
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
              { key: 'zone', label: 'ofcUsZone' },
              { key: 'taxpayers', label: 'ofcRhTaxpayers', numeric: true },
              { key: 'transactions', label: 'ofcNavTransactions', numeric: true },
              {
                key: 'amount_kobo',
                label: 'ofcPfCollected',
                numeric: true,
                render: (row: GeoRow) => <Money kobo={row.amount_kobo} />,
              },
            ]}
            rows={rows}
            empty="ofcNoneCollectionsRecordedArea"
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
  const { t } = usePortalI18n();
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
          label="ofcDbPaymentsVerified"
          value={percent(kpis.payment_success_rate_percent)}
          hint="ofcDbOfEveryAttempted"
        />
        <Stat
          label="ofcDbReconciled"
          value={percent(kpis.reconciliation_rate_percent)}
          hint="ofcDbMatchedAcross"
        />
        <Stat
          label="ofcDbAwaitingReconciliation"
          value={unreconciled.toLocaleString()}
          variant={unreconciled > 0 ? 'alert' : undefined}
        />
        <Stat
          label="ofcDbReceiptsIssued"
          value={percent(kpis.receipt_generation_rate_percent)}
          hint="ofcDbOfTransactions"
        />
      </div>

      <div className="card">
        <div className="card__header">
          <h2 className="card__title">{t.ofcDbPlatformKpis}</h2>
          <p className="card__hint">{t.ofcDbSinceBegan}</p>
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
