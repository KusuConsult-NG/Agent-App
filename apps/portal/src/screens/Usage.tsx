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

import { useCallback, useEffect, useState } from 'react';
import { USAGE_MIN_GROUP_SIZE } from '@psirs/shared';
import { ApiRequestError, api, type ApiError } from '../lib/api';
import { Alert, ErrorAlert, Loading, Stat, Table } from '../ui';
import { usePortalI18n } from '../lib/i18n';
import type { TranslationDictionary } from '@psirs/shared';

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

/** Keys rather than words, because this table is built before there is a reader. */
const FLOW_LABEL: Record<string, keyof TranslationDictionary> = {
  'taxpayer.registration': 'ofcUsRegisteringATaxpayer',
  collection: 'ofcUsTakingACollection',
  'agent.application': 'ofcUsApplyingToBecomeAn',
  'vehicle.capture': 'ofcUsCapturingAVehicle',
};

/** The event's own name where the platform has no friendlier one for it. */
function flowLabel(event: string, t: TranslationDictionary): string {
  const key = FLOW_LABEL[event];
  return key ? t[key] : event;
}

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
  const { t } = usePortalI18n();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .get<Overview>('/usage/overview')
      .then(setData)
      .catch((caught) => {
        // A failure that is not a refusal with a body set nothing at all, so
        // the screen said nothing and went on loading. See `Revenue.tsx`.
        if (caught instanceof ApiRequestError) setError(caught.error);
        else if (caught instanceof Error) {
          setError({ code: 'CLIENT', message: caught.message, moneyStatus: 'NOT_APPLICABLE' });
        }
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /*
   * A refusal with nothing to press is a screen an officer leaves.
   *
   * This returned the alert alone, so the only way to ask again was reloading
   * the page — and nothing said so. See `Revenue.tsx`.
   */
  if (error) {
    return (
      <div className="card">
        <ErrorAlert error={error} />
        <button type="button" className="secondary" onClick={load}>
          {t.actionTryAgain}
        </button>
      </div>
    );
  }
  if (!data) return <Loading rows={6} />;

  const registration = data.funnels.find((f) => f.event === 'taxpayer.registration');
  const collection = data.funnels.find((f) => f.event === 'collection');
  const nothingYet = data.funnels.length === 0 && data.screens.length === 0;

  return (
    <>
      <div className="card">
        <h2 className="card__title">{t.ofcUsTitle}</h2>
        <p className="card__hint">
          {t.ofcUsPrivacyBody.replace('{{n}}', String(USAGE_MIN_GROUP_SIZE))}{' '}
          <strong>{t.ofcNavPerformance}</strong>{t.ofcUsReportsCollections}</p>
      </div>

      {nothingYet && (
        <Alert kind="info" title="ofcUsNothingReported">
          <p style={{ margin: 0 }}>{t.ofcUsIntro}</p>
        </Alert>
      )}

      <div className="stat-grid">
        <Stat
          label="ofcUsRegistrationsCompleted"
          value={registration ? percent(registration.completed, registration.started) : '—'}
          variant="accent"
          hint={
            registration
              ? { text: t.ofcUsStartedCount.replace('{{n}}', String(registration.started)) }
              : 'ofcUsNoAttempts'
          }
        />
        <Stat
          label="ofcUsCollectionsCompleted"
          value={collection ? percent(collection.completed, collection.started) : '—'}
          hint={
            collection
              ? { text: t.ofcUsStartedCount.replace('{{n}}', String(collection.started)) }
              : 'ofcUsNoAttempts'
          }
        />
        <Stat
          label="ofcUsMedianRegistration"
          value={registration ? seconds(registration.median_completion_ms) : '—'}
          hint="ofcUsStartToFinish"
        />
        <Stat
          label="ofcUsMedianCollection"
          value={collection ? seconds(collection.median_completion_ms) : '—'}
          hint="ofcUsUntilHandedOff"
        />
      </div>

      <div className="card card--flush">
        <h2 className="card__title card__pad--tight">{t.ofcUsEveryFlow}</h2>
        <Table
          columns={[
            {
              key: 'event',
              label: 'ofcUsFlow',
              render: (row: Funnel) => flowLabel(row.event, t),
            },
            { key: 'started', label: 'ofcUsStarted' },
            { key: 'completed', label: 'ofcUsCompleted' },
            {
              key: 'rate',
              label: 'ofcUsCompletion',
              render: (row: Funnel) => percent(row.completed, row.started),
            },
            { key: 'abandoned', label: 'ofcUsGivenUp' },
            { key: 'failed', label: 'ofcPfFailed' },
            {
              key: 'median_completion_ms',
              label: 'ofcUsMedianTime',
              render: (row: Funnel) => seconds(row.median_completion_ms),
            },
          ]}
          rows={data.funnels}
          empty="ofcNoneFlowsAttemptedPeriod"
        />
      </div>

      {/*
        * Where people stop, and where they are not starting at all. Two
        * readings of the same reach question, and each is a short table — side
        * by side they compare, stacked they read as separate reports.
        */}
      <div className="grid-2">
      <div className="card card--flush">
        <h2 className="card__title card__pad--tight">{t.ofcUsWhereGiveUp}</h2>
        <p className="card__hint card__pad--sides">{t.ofcUsWhereGiveUpBody}</p>
        <Table
          columns={[
            {
              key: 'event',
              label: 'ofcUsFlow',
              render: (row: { event: string }) => flowLabel(row.event, t),
            },
            { key: 'step', label: 'ofcUsLastStepReached' },
            { key: 'abandoned_here', label: 'ofcOsAttempts' },
          ]}
          rows={data.abandonment}
          empty={{ text: t.ofcUsNoAbandonment.replace('{{n}}', String(USAGE_MIN_GROUP_SIZE)) }}
        />
      </div>

      <div className="card card--flush">
        <h2 className="card__title card__pad--tight">{t.ofcUsReachBeyondJos}</h2>
        <p className="card__hint card__pad--sides">{t.ofcUsReachBody}</p>
        <Table
          columns={[
            { key: 'lga', label: 'tpLgaShort' },
            { key: 'zone', label: 'ofcUsZone' },
            { key: 'started', label: 'ofcUsStarted' },
            { key: 'completed', label: 'ofcUsCompleted' },
            {
              key: 'rate',
              label: 'ofcUsCompletion',
              render: (row: { completed: string; started: string }) =>
                percent(row.completed, row.started),
            },
          ]}
          rows={data.reach}
          empty="ofcNoneLgaEnoughActivityReport"
        />
      </div>
      </div>

      {/*
        * `two-column` was never a class. It is not in the stylesheet and never
        * was, so these two cards have been stacking full width while reading
        * as though somebody had put them side by side. `grid-2` is the one the
        * portal actually has.
        */}
      <div className="grid-2">
        <div className="card card--flush">
          <h2 className="card__title card__pad--tight">{t.ofcUsOfflineQueue}</h2>
          <Table
            columns={[
              { key: 'event', label: 'ofcAgEvent' },
              { key: 'events', label: 'ofcUsCount' },
              {
                key: 'median_delay_seconds',
                label: 'ofcUsMedianDelay',
                render: (row: { median_delay_seconds: string }) =>
                  seconds(String(Number(row.median_delay_seconds) * 1000)),
              },
            ]}
            rows={data.offline}
            empty="ofcNoneOfflineQueueUsedPeriod"
          />
        </div>

        <div className="card card--flush">
          <h2 className="card__title card__pad--tight">{t.pubLanguage}</h2>
          <Table
            columns={[
              { key: 'language', label: 'pubLanguage' },
              { key: 'events', label: 'ofcUsEvents' },
            ]}
            rows={data.language}
            empty="ofcNoneLanguageUseReported"
          />
        </div>
      </div>

      <div className="card card--flush">
        <h2 className="card__title card__pad--tight">{t.ofcUsScreensReached}</h2>
        <Table
          columns={[
            { key: 'surface', label: 'ofcAgApplication' },
            { key: 'screen', label: 'ofcUsScreen' },
            { key: 'views', label: 'ofcUsViews' },
          ]}
          rows={data.screens}
          empty="ofcNoneScreensReported"
        />
      </div>
    </>
  );
}
