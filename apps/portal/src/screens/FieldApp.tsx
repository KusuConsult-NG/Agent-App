/**
 * The version gate — the one lever that stops a bad build collecting money.
 *
 * `requireSupportedAppVersion` refuses a collection from any handset below the
 * minimum version, answering 426 and saying the money did not move. That is
 * what a release found to be miscomputing a service charge is stopped with,
 * and until now it could not be moved: the minimum was written once on the
 * first deploy and no screen or endpoint could ever write a second one.
 *
 * The screen is built around the question an administrator actually has to
 * answer, which is not "what number should the minimum be" but "how many
 * agents does this stop from working this morning". So the fleet is shown
 * first, the count is recomputed as the number is typed, and it is recomputed
 * with the same comparison the API uses — a preview that disagreed with the
 * consequence would be worse than no preview at all.
 */

import { useCallback, useEffect, useState } from 'react';
import { compareVersions } from '@psirs/shared';
import { ApiRequestError, api, type ApiError } from '../lib/api';
import { Alert, Badge, ErrorAlert, Loading, Stat, Table, formatDateTime } from '../ui';
import { usePortalI18n } from '../lib/i18n';

interface PublishedVersion {
  minimumVersion: string;
  recommendedVersion: string;
  notes: string | null;
  effectiveFrom: string;
  inForce: boolean;
  publishedBy: string | null;
}

interface FleetRow {
  version: string | null;
  devices: number;
  belowMinimum: boolean;
}

interface History {
  minimumVersion: string;
  recommendedVersion: string;
  published: PublishedVersion[];
  fleet: FleetRow[];
  activeDevices: number;
}

const VERSION = /^\d+(\.\d+){0,3}$/;

/** How many active handsets a proposed minimum would stop, counted now. */
function wouldStop(fleet: FleetRow[], minimum: string): number {
  return fleet
    .filter((row) => !row.version || compareVersions(row.version, minimum) < 0)
    .reduce((total, row) => total + row.devices, 0);
}

export function FieldAppScreen() {
  const { t } = usePortalI18n();
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [minimum, setMinimum] = useState('');
  const [recommended, setRecommended] = useState('');
  const [notes, setNotes] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<History>('/agents/app-version/history')
      .then(setHistory)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, []);

  useEffect(load, [load]);

  const blockedBecause = ((): string | null => {
    if (!VERSION.test(minimum.trim())) return 'Enter the minimum version as digits and dots, like 1.4.0.';
    if (!VERSION.test(recommended.trim())) return 'Enter the recommended version as digits and dots, like 1.4.0.';
    if (compareVersions(minimum.trim(), recommended.trim()) > 0) {
      return `A minimum of ${minimum.trim()} is above the recommended ${recommended.trim()}, so even a handset on the newest build would be refused.`;
    }
    if (notes.trim().length < 10) {
      return 'Say why the minimum is moving, in at least 10 characters. It is what an agent who is locked out will be shown.';
    }
    return null;
  })();

  // The consequence, in handsets, before the button is pressed. Only shown once
  // the number typed is actually a version, because a count against a half-typed
  // "1.4." would be arithmetic on something that is not a version yet.
  const stopping =
    history && VERSION.test(minimum.trim()) ? wouldStop(history.fleet, minimum.trim()) : null;

  async function submit() {
    if (blockedBecause) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.post<{ message: string }>('/agents/app-version', {
        minimumVersion: minimum.trim(),
        recommendedVersion: recommended.trim(),
        notes: notes.trim(),
        ...(effectiveFrom ? { effectiveFrom: new Date(effectiveFrom).toISOString() } : {}),
      });
      setMessage(result.message);
      setMinimum('');
      setRecommended('');
      setNotes('');
      setEffectiveFrom('');
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
      else if (caught instanceof Error) {
        setError({ code: 'CLIENT', message: caught.message, moneyStatus: 'NOT_APPLICABLE' });
      }
    } finally {
      setBusy(false);
    }
  }

  if (!history) return <Loading rows={5} />;

  const belowNow = history.fleet
    .filter((row) => row.belowMinimum)
    .reduce((total, row) => total + row.devices, 0);

  return (
    <>
      <div className="card">
        <h2 className="card__title">{t.ofcNavFieldApp}</h2>
        <p className="card__hint">{t.ofcFaIntro}</p>
      </div>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      <div className="stat-grid">
        <Stat label="ofcFaMinimumInForce" value={history.minimumVersion} />
        <Stat label="ofcFaRecommended" value={history.recommendedVersion} />
        <Stat label="ofcFaActiveHandsets" value={history.activeDevices} />
        <Stat
          label="ofcFaBelowMinimum"
          value={belowNow}
          variant={belowNow > 0 ? 'alert' : undefined}
          hint={belowNow > 0 ? 'ofcFaSomeCannotCollect' : 'ofcFaEveryHandsetCan'}
        />
      </div>

      <div className="card">
        <h2 className="card__title">{t.ofcFaHandsetsInField}</h2>
        <Table
          columns={[
            {
              key: 'version',
              label: 'ofcFaBuild',
              render: (row: FleetRow) => row.version ?? 'Never reported a version',
            },
            { key: 'devices', label: 'ofcFaHandsets', numeric: true },
            {
              key: 'belowMinimum',
              label: 'ofcFaAgainstMinimum',
              render: (row: FleetRow) => <Badge status={row.belowMinimum ? 'BLOCKED' : 'ACTIVE'} />,
            },
          ]}
          rows={history.fleet}
          empty="ofcNoneHandsetRegistered"
        />
      </div>

      <div className="card">
        <h2 className="card__title">{t.ofcFaPublishNewMinimum}</h2>
        <p className="card__hint">{t.ofcFaAppendsRecord}</p>

        <div className="field">
          <label htmlFor="minimum-version">{t.ofcFaMinimumVersion}</label>
          <input
            id="minimum-version"
            value={minimum}
            onChange={(event) => setMinimum(event.target.value)}
            placeholder="1.4.0"
          />
          {stopping !== null && (
            <p className="field__hint">
              {stopping === 0
                ? `No active handset is below ${minimum.trim()}.`
                : `${stopping} of ${history.activeDevices} active handset${
                    history.activeDevices === 1 ? '' : 's'
                  } would stop collecting until they update.`}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="recommended-version">{t.ofcFaRecommendedVersion}</label>
          <input
            id="recommended-version"
            value={recommended}
            onChange={(event) => setRecommended(event.target.value)}
            placeholder="1.4.0"
          />
          <p className="field__hint">{t.ofcFaRecommendedHint}</p>
        </div>

        <div className="field">
          <label htmlFor="version-notes">{t.ofcFaWhyMoving}</label>
          <textarea
            id="version-notes"
            value={notes}
            rows={3}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t.ofcFaSampleReason}
          />
        </div>

        <div className="field">
          <label htmlFor="version-effective">{t.ofcFaTakesEffectOptional}</label>
          <input
            id="version-effective"
            type="datetime-local"
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
          <p className="field__hint">{t.ofcFaTakesEffectHint}</p>
        </div>

        {blockedBecause && (
          <p className="card__hint" role="status" style={{ marginBottom: 0 }}>
            {blockedBecause}
          </p>
        )}

        <div className="button-row">
          <button type="button" disabled={busy || blockedBecause !== null} onClick={submit}>
            {busy ? 'Publishing…' : 'Publish this minimum'}
          </button>
        </div>
      </div>

      <div className="card">
        <h2 className="card__title">{t.ofcFaHistory}</h2>
        <Table
          columns={[
            {
              key: 'effectiveFrom',
              label: 'ofcFaTakesEffect',
              render: (row: PublishedVersion) => formatDateTime(row.effectiveFrom),
            },
            { key: 'minimumVersion', label: 'ofcFaMinimum' },
            { key: 'recommendedVersion', label: 'ofcFaRecommended' },
            {
              key: 'inForce',
              label: 'appStatus',
              render: (row: PublishedVersion) => (
                <Badge
                  status={
                    row.inForce
                      ? 'IN_FORCE'
                      : new Date(row.effectiveFrom) > new Date()
                        ? 'SCHEDULED'
                        : 'SUPERSEDED'
                  }
                />
              ),
            },
            {
              key: 'publishedBy',
              label: 'ofcFaPublishedBy',
              // The seeded row that shipped with the platform has no author,
              // and saying so is more honest than leaving a dash to be read as
              // missing data.
              render: (row: PublishedVersion) => row.publishedBy ?? 'Shipped with the platform',
            },
            { key: 'notes', label: 'ofcFaWhy' },
          ]}
          rows={history.published}
          empty="ofcNoneNothingPublished"
        />
      </div>
    </>
  );
}
