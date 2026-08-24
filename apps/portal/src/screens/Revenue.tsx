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

interface Summary {
  byMda: MdaRow[];
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
              ? 'No territory has been assigned to you'
              : `Showing ${territories.map((t) => t.name).join(', ')}`
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
          label="Collected"
          value={<Money kobo={data.coverage.total_amount_kobo} />}
          variant="accent"
          hint="Verified revenue in the last year"
        />
        <Stat
          label="Generating areas"
          value={String(new Set(data.areas.map((a) => `${a.lga}/${a.ward}`)).size)}
          hint="Wards that produced revenue"
        />
        <Stat
          label="MDAs collecting nothing"
          value={String(emptyMdas.length)}
          hint="Arms of government with no catalogue item"
        />
        <Stat
          label="Placed on a map"
          value={total ? share(data.coverage.located, data.coverage.transactions) : '—'}
          hint="Collections with a recorded point"
        />
      </div>

      {total > 0 && mapped === 0 && (
        <Alert kind="warning" title="No collection has recorded where it happened">
          <p style={{ margin: 0 }}>
            Every figure below is grouped by the LGA and ward on the assessment, which is
            reliable. The map coordinates are separate and are captured by the agent
            application at the moment of collection — none has arrived yet, which usually means
            no version carrying that has been deployed, or agents have not granted location
            permission on their handsets.
          </p>
        </Alert>
      )}

      <div className="card card--flush">
        <h2 className="card__title" style={{ padding: '14px 18px 0' }}>
          Whose revenue this is
        </h2>
        <p className="card__hint" style={{ padding: '0 18px' }}>
          PSIRS collects the state's revenue; this is the arm of government each naira is
          collected <em>for</em>. An MDA with no revenue item is listed rather than hidden —
          it means nothing is being collected on its behalf through this platform, which is a
          finding rather than an absence.
        </p>
        <Table
          columns={[
            { key: 'mda', label: 'Ministry, Department or Agency' },
            { key: 'revenue_items', label: 'Revenue items' },
            { key: 'transactions', label: 'Collections' },
            {
              key: 'amount_kobo',
              label: 'Collected',
              render: (row: MdaRow) => <Money kobo={row.amount_kobo} />,
            },
            {
              key: 'share',
              label: 'Share',
              render: (row: MdaRow) => share(row.amount_kobo, data.coverage.total_amount_kobo),
            },
          ]}
          rows={data.byMda}
          empty="No MDA is configured."
        />
      </div>

      <div className="card card--flush">
        <h2 className="card__title" style={{ padding: '14px 18px 0' }}>
          Where the revenue is generated
        </h2>
        <p className="card__hint" style={{ padding: '0 18px' }}>
          By ward, with the agents working each one. "Mapped" counts the collections that
          recorded a point; a ward earning well with none mapped is unmapped, not suspicious.
        </p>
        <Table
          columns={[
            { key: 'lga', label: 'LGA' },
            { key: 'ward', label: 'Ward' },
            { key: 'zone', label: 'Zone' },
            {
              key: 'amount_kobo',
              label: 'Collected',
              render: (row: AreaRow) => <Money kobo={row.amount_kobo} />,
            },
            { key: 'transactions', label: 'Collections' },
            { key: 'taxpayers', label: 'Taxpayers' },
            { key: 'agents', label: 'Agents' },
            {
              key: 'located_transactions',
              label: 'Mapped',
              render: (row: AreaRow) => share(row.located_transactions, row.transactions),
            },
          ]}
          rows={data.areas}
          empty="No revenue has been collected in this period."
        />
      </div>

      <div className="card card--flush">
        <h2 className="card__title" style={{ padding: '14px 18px 0' }}>
          Each agent, and the ground they cover
        </h2>
        <p className="card__hint" style={{ padding: '0 18px' }}>
          Agent performance reports how much. This reports where — an agent working one market
          and an agent covering forty kilometres of road are doing different jobs on the same
          commission.
        </p>
        <Table
          columns={[
            { key: 'agent_code', label: 'Agent' },
            { key: 'full_name', label: 'Name' },
            { key: 'territory', label: 'Territory' },
            {
              key: 'amount_kobo',
              label: 'Collected',
              render: (row: AgentRow) => <Money kobo={row.amount_kobo} />,
            },
            { key: 'transactions', label: 'Collections' },
            { key: 'lgas_worked', label: 'LGAs' },
            { key: 'wards_worked', label: 'Wards' },
            {
              key: 'centre',
              label: 'Centre of collection',
              render: (row: AgentRow) =>
                row.centre_latitude && row.centre_longitude
                  ? `${row.centre_latitude}, ${row.centre_longitude}`
                  : 'Not mapped',
            },
          ]}
          rows={data.agents}
          empty="No agent has collected in this period."
        />
      </div>
    </>
  );
}
