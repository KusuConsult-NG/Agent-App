/**
 * How the applications are actually used.
 *
 * The platform reported, in detail, what money had moved. It reported nothing
 * about the software: which screens agents reach, where a registration is
 * abandoned, how long a collection takes on a handset in a market, whether
 * anybody has ever switched to Hausa. A team building for the grassroots could
 * not tell whether the grassroots could use the thing.
 *
 * This screen is deliberately about the interface and not about people. There
 * is no per-agent view here and there should not be: agents are already paid
 * on commission and screened for fraud, and `Agent performance` answers
 * questions about their work from collections. Adding a per-person view of
 * their keystrokes on top of that would be a different product.
 */

import { useEffect, useState } from 'react';
import { USAGE_MIN_GROUP_SIZE } from '@psirs/shared';
import { ApiRequestError, api, type ApiError } from '../lib/api';
import { Alert, ErrorAlert, Loading, Stat, Table } from '../ui';

interface Funnel {
  event: string;
  started: string;
  completed: string;
  abandoned: string;
  failed: string;
  median_completion_ms: string;
}

interface Overview {
  funnels: Funnel[];
  abandonment: { event: string; step: string; abandoned_here: string }[];
  offline: { event: string; events: string; median_delay_seconds: string }[];
  language: { language: string; events: string }[];
  reach: { lga: string; zone: string; started: string; completed: string; events: string }[];
  screens: { surface: string; screen: string; views: string }[];
}

const FLOW_LABEL: Record<string, string> = {
  'taxpayer.registration': 'Registering a taxpayer',
  collection: 'Taking a collection',
  'agent.application': 'Applying to become an agent',
  'vehicle.capture': 'Capturing a vehicle',
};

const percent = (part: string, whole: string) => {
  const total = Number(whole);
  if (!total) return '—';
  return `${Math.round((Number(part) / total) * 100)}%`;
};

const seconds = (ms: string) => {
  const value = Number(ms);
  if (!value) return '—';
  return value >= 60_000 ? `${(value / 60_000).toFixed(1)} min` : `${Math.round(value / 1000)}s`;
};

export function UsageScreen() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    api
      .get<Overview>('/usage/overview')
      .then(setData)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, []);

  if (error) return <ErrorAlert error={error} />;
  if (!data) return <Loading rows={6} />;

  const registration = data.funnels.find((f) => f.event === 'taxpayer.registration');
  const collection = data.funnels.find((f) => f.event === 'collection');
  const nothingYet = data.funnels.length === 0 && data.screens.length === 0;

  return (
    <>
      <div className="card">
        <h2 className="card__title">Product usage — last 30 days</h2>
        <p className="card__hint">
          How the software is being used, not who is using it. These figures carry no identity:
          no officer, agent or taxpayer is named in them, and groups smaller than{' '}
          {USAGE_MIN_GROUP_SIZE} are withheld rather than shown, because a small enough count
          singles somebody out even without a name. For an individual agent's work, see{' '}
          <strong>Agent performance</strong>, which reports collections.
        </p>
      </div>

      {nothingYet && (
        <Alert kind="info" title="Nothing has been reported yet">
          <p style={{ margin: 0 }}>
            Usage is reported by the agent application and this portal as they are used. An empty
            page here means no version carrying the reporting has been deployed yet, or nobody has
            opened one since it was.
          </p>
        </Alert>
      )}

      <div className="stat-grid">
        <Stat
          label="Registrations completed"
          value={registration ? percent(registration.completed, registration.started) : '—'}
          variant="accent"
          hint={registration ? `${registration.started} started` : 'No attempts recorded'}
        />
        <Stat
          label="Collections completed"
          value={collection ? percent(collection.completed, collection.started) : '—'}
          hint={collection ? `${collection.started} started` : 'No attempts recorded'}
        />
        <Stat
          label="Median registration"
          value={registration ? seconds(registration.median_completion_ms) : '—'}
          hint="Start to finish, on the device"
        />
        <Stat
          label="Median collection"
          value={collection ? seconds(collection.median_completion_ms) : '—'}
          hint="Until payment is handed off"
        />
      </div>

      <div className="card card--flush">
        <h2 className="card__title" style={{ padding: '14px 18px 0' }}>
          Every flow
        </h2>
        <Table
          columns={[
            {
              key: 'event',
              label: 'Flow',
              render: (row: Funnel) => FLOW_LABEL[row.event] ?? row.event,
            },
            { key: 'started', label: 'Started' },
            { key: 'completed', label: 'Completed' },
            {
              key: 'rate',
              label: 'Completion',
              render: (row: Funnel) => percent(row.completed, row.started),
            },
            { key: 'abandoned', label: 'Given up' },
            { key: 'failed', label: 'Failed' },
            {
              key: 'median_completion_ms',
              label: 'Median time',
              render: (row: Funnel) => seconds(row.median_completion_ms),
            },
          ]}
          rows={data.funnels}
          empty="No flows have been attempted in this period."
        />
      </div>

      <div className="card card--flush">
        <h2 className="card__title" style={{ padding: '14px 18px 0' }}>
          Where people give up
        </h2>
        <p className="card__hint" style={{ padding: '0 18px' }}>
          The last step an abandoned attempt reached. This is the screen to go and look at — an
          abandoned registration creates no taxpayer, so nothing else in the platform records that
          it happened.
        </p>
        <Table
          columns={[
            {
              key: 'event',
              label: 'Flow',
              render: (row: { event: string }) => FLOW_LABEL[row.event] ?? row.event,
            },
            { key: 'step', label: 'Last step reached' },
            { key: 'abandoned_here', label: 'Attempts' },
          ]}
          rows={data.abandonment}
          empty={`No abandonment point reached ${USAGE_MIN_GROUP_SIZE} attempts.`}
        />
      </div>

      <div className="card card--flush">
        <h2 className="card__title" style={{ padding: '14px 18px 0' }}>
          Reach beyond Jos
        </h2>
        <p className="card__hint" style={{ padding: '0 18px' }}>
          Whether the platform works as well in the rural LGAs as in the capital. A completion rate
          that is fine statewide and poor here is the difference between serving the grassroots and
          serving Jos.
        </p>
        <Table
          columns={[
            { key: 'lga', label: 'LGA' },
            { key: 'zone', label: 'Zone' },
            { key: 'started', label: 'Started' },
            { key: 'completed', label: 'Completed' },
            {
              key: 'rate',
              label: 'Completion',
              render: (row: { completed: string; started: string }) =>
                percent(row.completed, row.started),
            },
          ]}
          rows={data.reach}
          empty="No LGA has enough activity to report without singling somebody out."
        />
      </div>

      <div className="two-column">
        <div className="card card--flush">
          <h2 className="card__title" style={{ padding: '14px 18px 0' }}>
            The offline queue
          </h2>
          <Table
            columns={[
              { key: 'event', label: 'Event' },
              { key: 'events', label: 'Count' },
              {
                key: 'median_delay_seconds',
                label: 'Median delay',
                render: (row: { median_delay_seconds: string }) =>
                  seconds(String(Number(row.median_delay_seconds) * 1000)),
              },
            ]}
            rows={data.offline}
            empty="The offline queue has not been used in this period."
          />
        </div>

        <div className="card card--flush">
          <h2 className="card__title" style={{ padding: '14px 18px 0' }}>
            Language
          </h2>
          <Table
            columns={[
              { key: 'language', label: 'Language' },
              { key: 'events', label: 'Events' },
            ]}
            rows={data.language}
            empty="No language use has been reported."
          />
        </div>
      </div>

      <div className="card card--flush">
        <h2 className="card__title" style={{ padding: '14px 18px 0' }}>
          Screens reached
        </h2>
        <Table
          columns={[
            { key: 'surface', label: 'Application' },
            { key: 'screen', label: 'Screen' },
            { key: 'views', label: 'Views' },
          ]}
          rows={data.screens}
          empty="No screens have been reported."
        />
      </div>
    </>
  );
}
