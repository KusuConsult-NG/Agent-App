/**
 * The revenue summary: what was collected, whose it is, and where it came from.
 *
 * The portal reported revenue in two places and neither answered the questions
 * an administrator actually asks. The dashboard gave totals and a few
 * breakdowns; "Revenue catalogue" was a configuration list of items and prices
 * with no figures against it at all. Between them there was no view of the
 * state's revenue by generating area, and none by the arm of government the
 * money belongs to.
 *
 * Both had a cause rather than being an oversight. Every catalogue item was
 * mapped to PSIRS-HQ, so "revenue by MDA" was one row saying the Revenue
 * Service collects all of the state's revenue — true of who collects it and
 * useless for whose it is. And no collection had ever recorded where it
 * happened: the column, the endpoint and the service all existed, and no
 * client had ever sent a coordinate.
 */

import { useEffect, useState } from 'react';
import { ApiRequestError, api, type ApiError } from '../lib/api';
import { Alert, ErrorAlert, Loading, Money, Stat, Table } from '../ui';
import { usePortalI18n } from '../lib/i18n';

interface MdaRow {
  mda: string;
  code: string;
  revenue_items: string;
  transactions: string;
  amount_kobo: string;
}

interface AreaRow {
  lga: string;
  zone: string;
  ward: string;
  transactions: string;
  amount_kobo: string;
  agents: string;
  taxpayers: string;
  located_transactions: string;
}

interface AgentRow {
  agent_code: string;
  full_name: string;
  territory: string;
  transactions: string;
  amount_kobo: string;
  lgas_worked: string;
  wards_worked: string;
  located_transactions: string;
  centre_latitude: string | null;
  centre_longitude: string | null;
}

interface CouncilRow {
  lga: string;
  zone: string;
  transactions: string;
  amount_kobo: string;
  items: { code: string; name: string; transactions: string; amount_kobo: string }[];
}

interface Summary {
  byMda: MdaRow[];
  localGovernment: CouncilRow[];
  areas: AreaRow[];
  agents: AgentRow[];
  coverage: {
    transactions: string;
    located: string;
    ward_known: string;
    located_amount_kobo: string;
    total_amount_kobo: string;
  };
  scope?:
    | { kind: 'STATEWIDE' }
    | { kind: 'TERRITORIES'; territories: { id: string; name: string }[] };
}

const share = (part: string, whole: string) => {
  const total = Number(whole);
  if (!total) return '—';
  return `${Math.round((Number(part) / total) * 100)}%`;
};

export function RevenueScreen() {
  const { t } = usePortalI18n();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    api
      .get<Summary>('/government/revenue/summary')
      .then(setData)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, []);

  if (error) return <ErrorAlert error={error} />;
  if (!data) return <Loading rows={6} />;

  const territories = data.scope?.kind === 'TERRITORIES' ? data.scope.territories : null;
  const emptyMdas = data.byMda.filter((row) => row.revenue_items === '0');
  const mapped = Number(data.coverage.located);
  const total = Number(data.coverage.transactions);

  return (
    <>
      {territories && (
        <Alert
          kind="info"
          title={
            territories.length === 0
              ? 'ofcDbNoTerritoryTitle'
              : {
                  text: t.ofcDbShowing.replace(
                    '{{territories}}',
                    territories.map((territory) => territory.name).join(', '),
                  ),
                }
          }
        >
          <p style={{ margin: 0 }}>
            {territories.length === 0
              ? 'These figures are empty because your account covers no territory yet.'
              : 'Every figure here covers your territories only, not the whole state.'}
          </p>
        </Alert>
      )}

      <div className="stat-grid">
        <Stat
          label="ofcPfCollected"
          value={<Money kobo={data.coverage.total_amount_kobo} />}
          variant="accent"
          hint="ofcRvVerifiedLastYear"
        />
        <Stat
          label="ofcRvGeneratingAreas"
          value={String(new Set(data.areas.map((a) => `${a.lga}/${a.ward}`)).size)}
          hint="ofcRvWardsProduced"
        />
        <Stat
          label="ofcRhMdasCollectingNothing"
          value={String(emptyMdas.length)}
          hint="ofcRvArmsNoItem"
        />
        <Stat
          label="ofcRvOwedCouncils"
          value={
            <Money
              kobo={String(
                (data.localGovernment ?? []).reduce(
                  (sum, row) => sum + BigInt(row.amount_kobo),
                  0n,
                ),
              )}
            />
          }
          hint="ofcRvCollectedOnBehalf"
        />
        <Stat
          label="ofcRvPlacedOnMap"
          value={total ? share(data.coverage.located, data.coverage.transactions) : '—'}
          hint="ofcRvWithRecordedPoint"
        />
      </div>

      {total > 0 && mapped === 0 && (
        <Alert kind="warning" title="ofcRvNoPointRecorded">
          <p style={{ margin: 0 }}>{t.ofcRvGroupedByAssessment}</p>
        </Alert>
      )}

      <div className="card card--flush">
        <h2 className="card__title" style={{ padding: '14px 18px 0' }}>{t.ofcRvWhoseRevenue}</h2>
        <p className="card__hint" style={{ padding: '0 18px' }}>{t.ofcRvWhoseRevenueBody}<em>for</em>{t.ofcRvMdaNoItem}</p>
        <Table
          columns={[
            { key: 'mda', label: 'ofcRvMinistryDepartment' },
            { key: 'revenue_items', label: 'ofcRvRevenueItems' },
            { key: 'transactions', label: 'ofcLvCollections' },
            {
              key: 'amount_kobo',
              label: 'ofcPfCollected',
              render: (row: MdaRow) => <Money kobo={row.amount_kobo} />,
            },
            {
              key: 'share',
              label: 'ofcRvShare',
              render: (row: MdaRow) => share(row.amount_kobo, data.coverage.total_amount_kobo),
            },
          ]}
          rows={data.byMda}
          empty="ofcNoneMdaConfigured"
        />
      </div>

      <div className="card card--flush">
        <h2 className="card__title" style={{ padding: '14px 18px 0' }}>{t.ofcRvOwedToCouncils}</h2>
        <p className="card__hint" style={{ padding: '0 18px' }}>{t.ofcRvCouncilsBody}</p>
        <Table
          columns={[
            { key: 'lga', label: 'ofcRvCouncil' },
            { key: 'zone', label: 'ofcUsZone' },
            {
              key: 'amount_kobo',
              label: 'ofcOsOwed',
              render: (row: CouncilRow) => <Money kobo={row.amount_kobo} />,
            },
            { key: 'transactions', label: 'ofcLvCollections' },
            {
              key: 'items',
              label: 'ofcFrom',
              render: (row: CouncilRow) =>
                row.items.length === 0
                  ? '—'
                  : row.items.map((item) => item.name).join(', '),
            },
          ]}
          rows={data.localGovernment ?? []}
          empty="ofcNoneLocalGovernmentRevenueCollected"
        />
      </div>

      <div className="card card--flush">
        <h2 className="card__title" style={{ padding: '14px 18px 0' }}>{t.ofcRvWhereGenerated}</h2>
        <p className="card__hint" style={{ padding: '0 18px' }}>{t.ofcRvWhereGeneratedBody}</p>
        <Table
          columns={[
            { key: 'lga', label: 'tpLgaShort' },
            { key: 'ward', label: 'tpWard' },
            { key: 'zone', label: 'ofcUsZone' },
            {
              key: 'amount_kobo',
              label: 'ofcPfCollected',
              render: (row: AreaRow) => <Money kobo={row.amount_kobo} />,
            },
            { key: 'transactions', label: 'ofcLvCollections' },
            { key: 'taxpayers', label: 'ofcRhTaxpayers' },
            { key: 'agents', label: 'ofcRvAgents' },
            {
              key: 'located_transactions',
              label: 'ofcRvMapped',
              render: (row: AreaRow) => share(row.located_transactions, row.transactions),
            },
          ]}
          rows={data.areas}
          empty="ofcNoneRevenueCollectedPeriod"
        />
      </div>

      <div className="card card--flush">
        <h2 className="card__title" style={{ padding: '14px 18px 0' }}>{t.ofcRvEachAgentGround}</h2>
        <p className="card__hint" style={{ padding: '0 18px' }}>{t.ofcRvGroundBody}</p>
        <Table
          columns={[
            { key: 'agent_code', label: 'ofcRhAgent' },
            { key: 'full_name', label: 'tpName' },
            { key: 'territory', label: 'ofcRvTerritory' },
            {
              key: 'amount_kobo',
              label: 'ofcPfCollected',
              render: (row: AgentRow) => <Money kobo={row.amount_kobo} />,
            },
            { key: 'transactions', label: 'ofcLvCollections' },
            { key: 'lgas_worked', label: 'ofcRvLgas' },
            { key: 'wards_worked', label: 'ofcRvWards' },
            {
              key: 'centre',
              label: 'ofcRvCentreOfCollection',
              render: (row: AgentRow) =>
                row.centre_latitude && row.centre_longitude
                  ? `${row.centre_latitude}, ${row.centre_longitude}`
                  : 'Not mapped',
            },
          ]}
          rows={data.agents}
          empty="ofcNoneAgentCollectedPeriod"
        />
      </div>
    </>
  );
}
