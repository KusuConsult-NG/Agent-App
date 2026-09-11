/**
 * Whether the services this platform depends on are answering.
 *
 * `integrationHealth` has existed, tested, recording every outbound call and
 * raising an alarm into the officer inbox when three in a row go unanswered.
 * `/government/platform/integrations` has served it. Nothing has ever asked.
 *
 * So the one question an operator has during an outage — is it us, or is it
 * Remita? — had no screen behind it, and PSIRS learned that the payment
 * gateway had stopped answering by noticing that a queue had stopped moving.
 * By then agents in markets have been taking money against a gateway that
 * cannot confirm it.
 *
 * WHAT IS AND IS NOT MEASURED
 *
 * The platform's own traffic, not a probe. Every adapter already answers
 * `UNAVAILABLE` rather than throwing, so recording that outcome is all this
 * needs — and a synthetic lookup against a government identity service every
 * five minutes would be a real query about a real person asked for no reason.
 *
 * An answer nobody likes is still an answer: "this taxpayer has no TIN" is the
 * service working, and only `UNAVAILABLE` counts against it.
 *
 * THE SENTENCE IS COMPOSED HERE, NOT SENT
 *
 * The endpoint also returns a `message` per integration, built server-side in
 * English. Every input to it — the state, the count, the last error — is on
 * the row already, so this composes it from the dictionary instead. An
 * operations screen read at seven in the morning is exactly where a Hausa
 * reader should not meet five English sentences.
 *
 * The one thing still shown in the server's own words is `lastError`, which is
 * whatever the far end said. That is evidence rather than prose, and
 * translating a gateway's own refusal would be inventing it.
 */

import { useCallback, useEffect, useState } from 'react';
import { enumLabel, type TranslationDictionary } from '@psirs/shared';
import { ApiRequestError, api, asApiError, type ApiError } from '../lib/api';
import { Alert, Badge, ErrorAlert, Loading, Stat, Table, formatDateTime } from '../ui';
import { usePortalI18n } from '../lib/i18n';

type IntegrationName = 'tin' | 'kyc' | 'vehicles' | 'banks' | 'gateway';

interface IntegrationReport {
  name: IntegrationName;
  describes: string;
  provider: string | null;
  state: 'NEVER_CALLED' | 'HEALTHY' | 'DEGRADED' | 'DOWN';
  lastCalledAt: string | null;
  lastSucceededAt: string | null;
  lastUnavailableAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  callsTotal: number;
  unavailableTotal: number;
  message: string;
}

interface Platform {
  integrations: IntegrationReport[];
  healthy: boolean;
  needingAttention: number;
  tinService?: string;
  vehicleRegistry?: string;
  kycProvider?: string;
}

/** Keys rather than the server's `describes`, which is English. */
const SERVICE_LABEL: Record<IntegrationName, keyof TranslationDictionary> = {
  tin: 'ofcPlTin',
  kyc: 'ofcPlKyc',
  vehicles: 'ofcPlVehicles',
  banks: 'ofcPlBanks',
  gateway: 'ofcPlGateway',
};

/** The same four sentences the server composes, in the reader's language. */
function explain(row: IntegrationReport, t: TranslationDictionary): string {
  switch (row.state) {
    case 'NEVER_CALLED':
      return t.ofcPlNeverCalledBody;
    case 'DOWN':
      return t.ofcPlDownBody.replace('{{n}}', String(row.consecutiveFailures));
    case 'DEGRADED':
      return t.ofcPlDegradedBody;
    default:
      return t.ofcPlAnsweringBody;
  }
}

export function PlatformScreen() {
  const { t } = usePortalI18n();
  const [data, setData] = useState<Platform | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .get<Platform>('/government/platform/integrations')
      .then(setData)
      .catch((caught) => {
        setError(asApiError(caught));
        /*
         * Left unknown rather than emptied. "All answering" is the single most
         * dangerous thing this screen could say from a read that failed, and
         * an empty integrations array would say exactly that.
         */
        setData(null);
      });
  }, []);

  useEffect(load, [load]);

  return (
    <>
      <div className="card">
        <h2 className="card__title">{t.ofcPlTitle}</h2>
        <p className="card__hint">{t.ofcPlHint}</p>
      </div>

      {/*
        * The counts are drawn only when they were read. A dash rather than a
        * nought, for the reason this screen exists at all.
        */}
      <div className="stat-grid">
        <Stat
          label="ofcPlNeedingAttention"
          value={data ? String(data.needingAttention) : '—'}
          variant={data && data.needingAttention > 0 ? 'alert' : undefined}
        />
        <Stat
          label="ofcPlAllAnswering"
          value={data ? String(data.integrations.filter((row) => row.state === 'HEALTHY').length) : '—'}
          hint="ofcPlOutageHint"
        />
      </div>

      {data && data.needingAttention > 0 && (
        <Alert kind="error" title="enumIntegrationAlert">
          <ul className="list">
            {data.integrations
              .filter((row) => row.state === 'DOWN')
              .map((row) => (
                <li key={row.name}>
                  {t[SERVICE_LABEL[row.name]]} — {explain(row, t)}
                </li>
              ))}
          </ul>
        </Alert>
      )}

      <div className="card card--flush">
        {error ? (
          <div style={{ padding: 18 }}>
            <ErrorAlert error={error} />
            <button type="button" className="secondary" onClick={load}>
              {t.actionTryAgain}
            </button>
          </div>
        ) : !data ? (
          <div style={{ padding: 18 }}>
            <Loading rows={5} />
          </div>
        ) : (
          <Table
            columns={[
              {
                key: 'name',
                label: 'ofcPlService',
                render: (row: IntegrationReport) => (
                  <>
                    <div>{t[SERVICE_LABEL[row.name]]}</div>
                    <div className="muted" style={{ fontSize: '0.78rem' }}>
                      {explain(row, t)}
                    </div>
                  </>
                ),
              },
              {
                key: 'state',
                label: 'ofcPlState',
                render: (row: IntegrationReport) => <Badge status={row.state} />,
              },
              {
                key: 'provider',
                label: 'ofcPlAdapter',
                render: (row: IntegrationReport) => row.provider ?? '—',
              },
              {
                key: 'lastSucceededAt',
                label: 'ofcPlLastAnswered',
                render: (row: IntegrationReport) =>
                  row.lastSucceededAt ? formatDateTime(row.lastSucceededAt) : t.ofcPlNeverAnswered,
              },
              {
                key: 'consecutiveFailures',
                label: 'ofcPlInARow',
                render: (row: IntegrationReport) => String(row.consecutiveFailures),
              },
              {
                key: 'callsTotal',
                label: 'ofcPlCalls',
                render: (row: IntegrationReport) =>
                  `${row.callsTotal - row.unavailableTotal}/${row.callsTotal}`,
              },
            ]}
            rows={data.integrations}
            empty="ofcNothingToShow"
          />
        )}
      </div>

      {/*
        * The far end's own words, kept apart from the platform's. Shown only
        * where there is one, and only as evidence.
        */}
      {data?.integrations
        .filter((row) => row.lastError)
        .map((row) => (
          <div className="card" key={`err-${row.name}`}>
            <p className="card__hint" style={{ margin: 0 }}>
              <strong>{t[SERVICE_LABEL[row.name]]}</strong>
              {row.lastUnavailableAt ? ` · ${formatDateTime(row.lastUnavailableAt)}` : ''}
            </p>
            <p style={{ margin: '6px 0 0', fontSize: '0.85rem' }}>{row.lastError}</p>
          </div>
        ))}
    </>
  );
}
