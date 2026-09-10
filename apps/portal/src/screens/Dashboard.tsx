/** Executive dashboard and revenue intelligence (PRD §37, §38, §59, §73). */

import { useEffect, useState } from 'react';
import { enumLabel, formatNaira, localName } from '@psirs/shared';
import { ApiRequestError, api, type ApiError } from '../lib/api';
import { Alert, BarList, Empty, ErrorAlert, Growth, KeyValue, Loading, Money, Sparkline, Stat, Table } from '../ui';
import { usePortalI18n } from '../lib/i18n';

interface Dashboard {
  collections: {
    today_kobo: string;
    yesterday_kobo: string;
    week_kobo: string;
    previous_week_kobo: string;
    month_kobo: string;
    previous_month_kobo: string;
    previous_month_whole_kobo: string;
    ytd_kobo: string;
    previous_ytd_kobo: string;
    total_kobo: string;
    /**
     * Basis points, or null.
     *
     * Null means the previous period collected nothing, which is not zero
     * growth — see `Growth` in `ui.tsx`. Typed as nullable here so a screen
     * cannot render it as a number without deciding what to do about that.
     */
    day_growth_bp: number | null;
    week_growth_bp: number | null;
    month_growth_bp: number | null;
    year_growth_bp: number | null;
  };
  counts: Record<string, string>;
  revenueByCategory: {
    category: string;
    category_ha: string | null;
    transactions: string;
    amount_kobo: string;
    month_kobo: string;
    previous_month_kobo: string;
    growth_bp: number | null;
    contribution_bp: number | null;
  }[];
  revenueByLga: { lga: string; zone: string; transactions: string; amount_kobo: string }[];
  revenueByAgent: { agent_code: string; full_name: string; transactions: string; amount_kobo: string }[];
  revenueByMda: { mda: string; mda_ha: string | null; amount_kobo: string }[];
  revenueByChannel: { channel: string; transactions: string; amount_kobo: string }[];
  revenueByTaxpayerType: {
    taxpayer_type: string;
    transactions: string;
    taxpayers: string;
    amount_kobo: string;
    average_kobo: string;
  }[];
  revenueByItem: {
    item: string;
    item_ha: string | null;
    code: string;
    category: string;
    category_ha: string | null;
    transactions: string;
    amount_kobo: string;
  }[];
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
    | { kind: 'TERRITORIES'; territories: { id: string; name: string; name_ha: string | null; code: string }[] };
}

export function DashboardScreen({ navigate }: { navigate: (path: string) => void }) {
  const { lang, t } = usePortalI18n();
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
              territories.map((territory) => localName(lang, territory.name, territory.name_ha)).join(', '),
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
            {t.ofcDbOr}{' '}
            <button type="button" className="link" onClick={() => navigate('/fraud')}>{t.ofcDbReviewFlags}</button>
            .
          </p>
        </Alert>
      )}

      {/*
        * Every figure with the period before it.
        *
        * A collections number alone is something an officer reads; the same
        * number against last month is something they can act on. The
        * comparisons are cut at the same point through the previous period —
        * eight days against eight days, never eight against thirty-one — which
        * is done on the server and is the only reason these are meaningful.
        */}
      <div className="stat-grid">
        <Stat
          label="homeCollectedToday"
          value={<Money kobo={data.collections.today_kobo} />}
          variant="accent"
          hint="ofcDbVerifiedOnly"
        />
        <Stat
          label="ofcDbYesterday"
          value={<Money kobo={data.collections.yesterday_kobo} />}
          hint={{ text: '' }}
        />
        <Stat label="ofcDbThisMonth" value={<Money kobo={data.collections.month_kobo} />} />
        <Stat label="ofcDbYearToDate" value={<Money kobo={data.collections.ytd_kobo} />} />
      </div>

      <div className="stat-grid">
        <Stat
          label="ofcDbChange"
          value={<Growth basisPoints={data.collections.day_growth_bp} />}
          hint="ofcDbVsYesterday"
        />
        <Stat
          label="ofcDbThisWeek"
          value={<Growth basisPoints={data.collections.week_growth_bp} />}
          hint="ofcDbVsLastWeek"
        />
        <Stat
          label="ofcDbThisMonth"
          value={<Growth basisPoints={data.collections.month_growth_bp} />}
          hint="ofcDbVsLastMonth"
        />
        <Stat
          label="ofcDbYearToDate"
          value={<Growth basisPoints={data.collections.year_growth_bp} />}
          hint="ofcDbVsLastYear"
        />
      </div>

      <div className="stat-grid">
        <Stat
          label="ofcDbLastMonthWhole"
          value={<Money kobo={data.collections.previous_month_whole_kobo} />}
        />
        <Stat
          label="ofcRhCommissionLiability"
          value={<Money kobo={data.counts.commission_liability_kobo} />}
          hint="ofcDbAccruedNotPaid"
        />
        {/*
          * Money already invoiced and owed — the floor under "expected
          * revenue", and deliberately not a projection. The forecast is a
          * separate figure that says out loud that it is arithmetic.
          */}
        <Stat
          label="ofcDbExpectedRevenue"
          value={<Money kobo={data.counts.expected_revenue_kobo} />}
          hint="ofcDbExpectedRevenueHint"
        />
      </div>

      {/*
        * Money the State took and gave back, and who is on the ground.
        *
        * Both were countable per agent and nowhere at the top, so an
        * administrator asking "how much did we reverse" had to add up a
        * performance table.
        */}
      <div className="stat-grid">
        <Stat
          label="ofcDbReversed"
          value={<Money kobo={data.counts.reversed_kobo} />}
          hint={{ text: `${data.counts.reversed_transactions}` }}
          variant={Number(data.counts.reversed_transactions) > 0 ? 'alert' : undefined}
        />
        <Stat
          label="ofcDbRefunded"
          value={<Money kobo={data.counts.refunded_kobo} />}
          hint={{ text: `${data.counts.refunded_transactions}` }}
        />
        <Stat
          label="ofcDbAgentsOnline"
          value={data.counts.agents_online}
          hint="ofcDbAgentsOnlineHint"
        />
        <Stat
          label="ofcDbAgentsSuspended"
          value={data.counts.agents_suspended}
          variant={Number(data.counts.agents_suspended) > 0 ? 'alert' : undefined}
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
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', margin: '8px 0 0' }}>
          {t.ofcDbDayRange
            .replace('{{from}}', data.dailyTrend[0]?.day ?? '')
            .replace('{{to}}', data.dailyTrend[data.dailyTrend.length - 1]?.day ?? '')}
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
              label: { text: localName(lang, row.category, row.category_ha) },
              sublabel: `${row.transactions} txn`,
              value: Number(row.amount_kobo),
            }))}
            formatValue={(value) => formatNaira(BigInt(Math.round(value)))}
          />
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2 className="card__title">{t.ofcDbByChannel}</h2>
          <p className="card__hint">{t.ofcDbByChannelBody}</p>
          <BarList
            items={data.revenueByChannel.map((row) => ({
              label: { text: enumLabel(row.channel, t) },
              sublabel: `${row.transactions} txn`,
              value: Number(row.amount_kobo),
            }))}
            formatValue={(value) => formatNaira(BigInt(Math.round(value)))}
          />
        </div>

        <div className="card">
          <h2 className="card__title">{t.ofcDbByTaxpayerType}</h2>
          <Table
            rows={data.revenueByTaxpayerType}
            columns={[
              {
                key: 'taxpayer_type',
                label: 'ofcDbByTaxpayerType',
                render: (row) => enumLabel(row.taxpayer_type, t),
              },
              { key: 'taxpayers', label: 'ofcRhTaxpayers', numeric: true },
              {
                key: 'amount_kobo',
                label: 'ofcPfCollected',
                numeric: true,
                render: (row) => <Money kobo={row.amount_kobo} />,
              },
              {
                key: 'average_kobo',
                label: 'ofcPfAverage',
                numeric: true,
                render: (row) => <Money kobo={row.average_kobo} />,
              },
            ]}
          />
        </div>
      </div>

      {/*
        * One level below the category, which is where an officer's work is.
        *
        * "Local Government Levies" is a heading; "Shops and Kiosks Levy" is the
        * thing somebody is responsible for, and the dashboard stopped at the
        * heading.
        */}
      <div className="card">
        <h2 className="card__title">{t.ofcDbByItem}</h2>
        <p className="card__hint">{t.ofcDbByItemBody}</p>
        <BarList
          items={data.revenueByItem.slice(0, 12).map((row) => ({
            label: { text: localName(lang, row.item, row.item_ha) },
            sublabel: localName(lang, row.category, row.category_ha),
            value: Number(row.amount_kobo),
          }))}
          formatValue={(value) => formatNaira(BigInt(Math.round(value)))}
        />
      </div>

      {/*
        * The same categories, ranked by direction instead of by size.
        *
        * A category that halved is still near the top of a list sorted by
        * amount and reads as healthy. This is the one an officer needs to see
        * and the only ordering that surfaces it.
        */}
      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <h2 className="card__title">{t.ofcDbDeclining}</h2>
          <p className="card__hint">{t.ofcDbDecliningBody}</p>
        </div>
        {(() => {
          const declining = data.revenueByCategory
            .filter((row) => row.growth_bp !== null && row.growth_bp < 0)
            .sort((left, right) => (left.growth_bp ?? 0) - (right.growth_bp ?? 0));
          return declining.length === 0 ? (
            <div style={{ padding: '0 18px 18px' }}>
              <Empty>{t.ofcDbNoneDeclining}</Empty>
            </div>
          ) : (
            <Table
              rows={declining}
              columns={[
                {
                  key: 'category',
                  label: 'ofcAgCategory',
                  render: (row) => localName(lang, row.category, row.category_ha),
                },
                {
                  key: 'previous_month_kobo',
                  label: 'ofcDbLastMonthWhole',
                  numeric: true,
                  render: (row) => <Money kobo={row.previous_month_kobo} />,
                },
                {
                  key: 'month_kobo',
                  label: 'ofcDbThisMonth',
                  numeric: true,
                  render: (row) => <Money kobo={row.month_kobo} />,
                },
                {
                  key: 'growth_bp',
                  label: 'ofcDbChange',
                  numeric: true,
                  render: (row) => <Growth basisPoints={row.growth_bp} />,
                },
                {
                  key: 'contribution_bp',
                  label: 'ofcDbShareOfMonth',
                  numeric: true,
                  render: (row) =>
                    row.contribution_bp === null
                      ? '—'
                      : `${(row.contribution_bp / 100).toFixed(1)}%`,
                },
              ]}
            />
          );
        })()}
      </div>

      {/*
        * Who collected and which ministry it was collected for, side by side.
        *
        * Two answers to the same question — where did the month's money come
        * from — and stacked full width they read as two unrelated screens, each
        * a four-column table on a canvas wide enough for twelve.
        */}
      <div className="grid-2">
      <div className="card card--flush">
        <div className="card__pad">
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
        <div className="card__pad">
          <h2 className="card__title">{t.ofcDbRevenueByMda}</h2>
        </div>
        <Table
          columns={[
            { key: 'mda', label: 'ofcDbMda', render: (row: Dashboard['revenueByMda'][number]) => localName(lang, row.mda, row.mda_ha) },
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
  /** The same length of window immediately before this one. */
  previous_amount_kobo: string;
  average_kobo: string;
  registered_taxpayers: string;
  /** Basis points, or null where the place has no history to compare against. */
  growth_bp: number | null;
  /**
   * The share of the register here that paid anything in the window.
   *
   * The figure behind "4,000 registered taxpayers but only 35% payment
   * activity" — the comparison an officer makes constantly and could make
   * nowhere.
   */
  compliance_bp: number | null;
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
        <p style={{ fontSize: 'var(--text-base)', marginTop: 12 }}>
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
              {
                key: 'growth_bp',
                label: 'ofcDbChange',
                numeric: true,
                render: (row: GeoRow) => <Growth basisPoints={row.growth_bp} />,
              },
              {
                key: 'average_kobo',
                label: 'ofcRvAverageTransaction',
                numeric: true,
                render: (row: GeoRow) => <Money kobo={row.average_kobo} />,
              },
              {
                /*
                 * Payment activity against the register.
                 *
                 * A place with four thousand registered taxpayers and a third
                 * of them paying is a different problem from one with forty,
                 * and the collection totals make them look the same.
                 */
                key: 'compliance_bp',
                label: 'ofcRvCompliance',
                numeric: true,
                render: (row: GeoRow) =>
                  row.compliance_bp === null ? (
                    '—'
                  ) : (
                    <>
                      {(row.compliance_bp / 100).toFixed(0)}%
                      <br />
                      <span className="muted">
                        {row.taxpayers} / {row.registered_taxpayers}
                      </span>
                    </>
                  ),
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
  const [kpis, setKpis] = useState<Record<string, string> | 'unreadable' | null>(null);

  useEffect(() => {
    api
      .get<Record<string, string>>('/government/kpis')
      .then(setKpis)
      .catch(() => setKpis('unreadable'));
  }, []);

  /*
   * A panel that failed says so, rather than not being there.
   *
   * `setKpis(null)` on failure and `if (!kpis) return null` made a request
   * that was refused indistinguishable from one still in flight, and both
   * indistinguishable from a page that simply does not have this section.
   * Two stat grids and a card disappeared — among them the reconciliation
   * rate and the count still awaiting it, which is the pair of numbers a
   * reader of this dashboard is most likely to have come for.
   *
   * Nothing here is a claim in the way Performance's zeros were. It is the
   * quieter version of the same fault: the page still looks complete.
   */
  if (kpis === 'unreadable') {
    return (
      <Alert kind="warning" title="ofcDbKpisUnreadable">
        <p style={{ margin: 0 }}>{t.ofcDbKpisUnreadableBody}</p>
      </Alert>
    );
  }
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
            [t.ofcDbTotalCollected, <Money key="c" kobo={kpis.total_collection_kobo} />],
            [t.ofcAgActiveAgents, Number(kpis.active_agents ?? 0).toLocaleString()],
            [t.ofcDbTaxpayersWithATin, Number(kpis.taxpayers_with_tin ?? 0).toLocaleString()],
            [t.ofcDbNewTaxpayersThisMonth, Number(kpis.new_taxpayers_this_month ?? 0).toLocaleString()],
            [t.ofcDbAverageTimeToConfirm, duration],
            [t.ofcDbReversalsAndRefunds, Number(kpis.reversals ?? 0).toLocaleString()],
            [t.ofcPfOpenFraudFlags, Number(kpis.suspicious_transactions ?? 0).toLocaleString()],
            [
              t.ofcDbDuplicateRegistrationsOverridden,
              Number(kpis.duplicate_registrations_overridden ?? 0).toLocaleString(),
            ],
            [
              t.ofcOvFailedVerifications,
              Number(kpis.receipt_verification_failures ?? 0).toLocaleString(),
            ],
          ]}
        />
      </div>
    </>
  );
}
