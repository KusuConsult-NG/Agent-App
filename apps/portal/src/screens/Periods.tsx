/**
 * Closing a month, so the figure PSIRS reported cannot move afterwards.
 *
 * A settled month was still writable. Everything the Service reported to the
 * Accountant-General for March could be changed in April by a reversal, a
 * backdated settlement or a commission adjustment, and nothing anywhere said it
 * had happened after the books were reported.
 *
 * THIS SCREEN OPERATES A CONTROL, NOT A REPORT
 *
 * After a close the *database* refuses to write into the month — the lock is a
 * trigger on the four tables that decide what a month collected, not a check in
 * this application. So the screen's job is to make the decision legible before
 * it is taken: what the month holds now, what is still unresolved, and what
 * gets frozen.
 *
 * TWO REFUSALS ARE SURFACED RATHER THAN HIDDEN
 *
 * Closing over an unresolved exception or a pending payment freezes a figure
 * already known to be wrong. The server refuses unless the officer says in
 * writing why — sometimes a statutory deadline is the answer — and the reason
 * goes on the record beside the figure.
 *
 * And reopening is the administrator's, not the closer's. The officer who
 * closes the books also being able to unclose them removes most of what a
 * period lock is for, so the two are separate permissions and the screen shows
 * each officer only the one they hold.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ApiRequestError,
  api,
  can,
  stepUp,
  type ApiError,
  type User,
} from '../lib/api';
import { Alert, Badge, ErrorAlert, Loading, Money, Stat, Table, formatDate } from '../ui';
import { usePortalI18n } from '../lib/i18n';

interface Period {
  id: string;
  label: string;
  period_start: string;
  period_end: string;
  status: string;
  closed_at: string | null;
  closing_note: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
  collected_kobo: string | null;
  settled_kobo: string | null;
  commission_kobo: string | null;
  transaction_count: number | null;
  closed_by_name: string | null;
  reopened_by_name: string | null;
}

interface Figures {
  collected_kobo: string;
  settled_kobo: string;
  commission_kobo: string;
  transaction_count: string;
  unreconciled: string;
  pending_payments: string;
}

export function PeriodsScreen({ user }: { user: User }) {
  const { t } = usePortalI18n();
  const [periods, setPeriods] = useState<Period[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState<Period | null>(null);

  const mayClose = can('period:close');
  const mayReopen = can('period:reopen');

  const load = useCallback(async () => {
    setError(null);
    try {
      setPeriods(await api.get<Period[]>('/government/periods'));
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.error : null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="card">
        <h2>{t.ofcPeTitle}</h2>
        <p className="muted">{t.ofcPeIntro}</p>
        <ErrorAlert error={error} />
        {notice && <Alert kind="success">{notice}</Alert>}
        {mayClose && (
          <OpenPeriodForm
            onDone={async (message) => {
              setNotice(message);
              await load();
            }}
          />
        )}
      </div>

      {working && (
        <CloseOrReopen
          period={working}
          user={user}
          onDone={async (message) => {
            setWorking(null);
            setNotice(message);
            await load();
          }}
          onCancel={() => setWorking(null)}
        />
      )}

      <div className="card card--flush">
        {!periods ? (
          <div style={{ padding: 18 }}>
            <Loading />
          </div>
        ) : (
          <Table
            rows={periods}
            empty="ofcNonePeriods"
            columns={[
              {
                key: 'label',
                label: 'ofcPePeriod',
                render: (row: Period) => (
                  <>
                    <strong>{row.label}</strong>
                    <br />
                    <span className="muted">
                      {formatDate(row.period_start)} – {formatDate(row.period_end)}
                    </span>
                  </>
                ),
              },
              {
                key: 'status',
                label: 'ofcCwStatus',
                render: (row: Period) => <Badge status={row.status} />,
              },
              {
                key: 'collected_kobo',
                label: 'ofcPeCollected',
                numeric: true,
                render: (row: Period) =>
                  row.collected_kobo === null ? (
                    <span className="muted">—</span>
                  ) : (
                    <>
                      <Money kobo={row.collected_kobo} />
                      <br />
                      <span className="muted">{t.ofcPeFrozen}</span>
                    </>
                  ),
              },
              {
                key: 'settled_kobo',
                label: 'ofcPeSettled',
                numeric: true,
                render: (row: Period) =>
                  row.settled_kobo === null ? '—' : <Money kobo={row.settled_kobo} />,
              },
              {
                key: 'closed_by_name',
                label: 'ofcPeClosedBy',
                /*
                 * The whole sentence, not a quarter of it.
                 *
                 * `reopenPeriod` says what this is for: "'March was reopened
                 * on the 9th of June by Bala, because the Kanam settlement
                 * was misposted' is a sentence the platform can produce."
                 * The query selects `closed_at`, `closing_note`,
                 * `reopened_at` and `reopen_reason` and this column rendered
                 * two names and dropped all four — so the sentence the
                 * service was built to produce could not be read by anybody,
                 * and an officer wanting to know why a closed month had been
                 * reopened had to go to the audit log to find out.
                 *
                 * The note and the reason are prose an officer typed for
                 * other officers, so they are shown as written.
                 */
                render: (row: Period) => (
                  <>
                    {row.closed_by_name ?? '—'}
                    {row.closed_at && (
                      <span className="muted"> · {formatDate(row.closed_at)}</span>
                    )}
                    {row.closing_note && (
                      <p className="table__sub" style={{ margin: '2px 0 0' }}>
                        {t.ofcPeClosingNote}: {row.closing_note}
                      </p>
                    )}
                    {row.reopened_by_name && (
                      <>
                        <br />
                        <span className="muted">
                          {t.ofcPeReopenedBy}: {row.reopened_by_name}
                          {row.reopened_at && ` · ${formatDate(row.reopened_at)}`}
                        </span>
                        {row.reopen_reason && (
                          <p className="table__sub" style={{ margin: '2px 0 0' }}>
                            {t.ofcPeReopenReason}: {row.reopen_reason}
                          </p>
                        )}
                      </>
                    )}
                  </>
                ),
              },
              {
                key: 'action',
                label: 'ofcOvAction',
                render: (row: Period) => {
                  const closable = row.status !== 'CLOSED' && mayClose;
                  const reopenable = row.status === 'CLOSED' && mayReopen;
                  if (!closable && !reopenable) return '—';
                  return (
                    <button type="button" onClick={() => setWorking(row)}>
                      {closable ? t.ofcPeClose : t.ofcPeReopen}
                    </button>
                  );
                },
              },
            ]}
          />
        )}
        {/*
          * Said once, on the screen, rather than only discovered on a 403.
          *
          * An officer who can close and cannot reopen should know that before
          * they close, not after they want to undo it.
          */}
        {mayClose && !mayReopen && (
          <div style={{ padding: '0 18px 18px' }}>
            <p className="muted">{t.ofcPeReopenSeparate}</p>
          </div>
        )}
      </div>
    </>
  );
}

// ===========================================================================
function OpenPeriodForm({ onDone }: { onDone: (message: string) => Promise<void> }) {
  const { t } = usePortalI18n();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  return (
    <div className="filters">
      <ErrorAlert error={error} />
      <label>
        {t.ofcFrom}
        <input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
      </label>
      <label>
        {t.ofcTo}
        <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
      </label>
      <button
        type="button"
        disabled={busy || !start || !end}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api.post('/government/periods', { periodStart: start, periodEnd: end });
            setStart('');
            setEnd('');
            await onDone(t.ofcCwSaved);
          } catch (caught) {
            setError(caught instanceof ApiRequestError ? caught.error : null);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t.ofcPeOpenPeriod}
      </button>
    </div>
  );
}

// ===========================================================================
/**
 * The decision panel: what the month holds, and what closing would freeze.
 *
 * The figures come from the same query the close writes down, so the preview
 * and the stored figure cannot disagree — which they would if closing
 * recomputed with slightly different predicates, and nobody would notice until
 * an auditor compared the two.
 */
function CloseOrReopen({
  period,
  user,
  onDone,
  onCancel,
}: {
  period: Period;
  user: User;
  onDone: (message: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = usePortalI18n();
  /**
   * Three states, because two of them were being read as a third.
   *
   * `null` meant both "not fetched yet" and "the fetch failed", and
   * `outstanding` turned both into zero — so a month whose unresolved
   * exceptions could not be counted looked exactly like a month that had
   * none. The warning vanished, the override field was never rendered, and
   * the Close button enabled itself on a note alone.
   *
   * The server recomputes the figures inside the closing transaction and
   * refuses without an override reason, so no wrong month was ever closed.
   * What happened instead is a dead end: the officer is refused, and the
   * field the refusal is asking them to fill is not on the screen.
   */
  const [figures, setFigures] = useState<Figures | 'unavailable' | null>(null);
  const [note, setNote] = useState('');
  const [override, setOverride] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const reopening = period.status === 'CLOSED';

  useEffect(() => {
    if (reopening) return;
    api
      .get<Figures>(
        `/government/periods/figures?periodStart=${period.period_start.slice(0, 10)}` +
          `&periodEnd=${period.period_end.slice(0, 10)}`,
      )
      .then(setFigures)
      .catch(() => setFigures('unavailable'));
  }, [period, reopening]);

  /** How many unresolved items the month holds, or that nobody can say. */
  const outstanding: number | 'unknown' =
    figures === null || figures === 'unavailable'
      ? 'unknown'
      : Number(figures.unreconciled) + Number(figures.pending_payments);

  /*
   * A reason is needed whenever the server might ask for one.
   *
   * It asks when the month holds unresolved items. Not knowing whether it
   * does is not the same as knowing it does not, and the safe reading of an
   * unknown is the one that keeps the officer able to act: show the field, so
   * a close that the server refuses can be completed rather than looped on.
   */
  const needsReason = outstanding !== 0;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onDone(t.ofcCwSaved);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.error : null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>
        {reopening ? t.ofcPeReopen : t.ofcPeClose} · {period.label}
      </h3>
      <ErrorAlert error={error} />

      {reopening ? (
        <>
          <label>
            {t.ofcPeReopenReason}
            <textarea
              rows={3}
              value={reopenReason}
              onChange={(event) => setReopenReason(event.target.value)}
            />
          </label>
          <div className="button-row">
            <button
              type="button"
              disabled={busy || reopenReason.trim().length < 10}
              onClick={() =>
                run(async () => {
                  // Reopening unfreezes a figure that has already been
                  // reported. Step-up is the platform's existing marker for
                  // that size of decision.
                  await stepUp('financial.period.reopen', user.phone);
                  await api.post(`/government/periods/${period.id}/reopen`, {
                    reason: reopenReason.trim(),
                  });
                })
              }
            >
              {t.ofcPeReopen}
            </button>
            <button type="button" className="secondary" onClick={onCancel}>
              {t.camCancel}
            </button>
          </div>
        </>
      ) : (
        <>
          <h4>{t.ofcPeFiguresNow}</h4>
          {figures === null ? (
            <Loading rows={2} />
          ) : figures === 'unavailable' ? (
            /*
             * Said, rather than shown as an empty month.
             *
             * This branch used to fall through to `outstanding === 0`, which
             * rendered the screen as though the month were settled and clean.
             * An officer deciding whether to freeze a reported figure was
             * being shown a confident answer the platform did not have.
             */
            <Alert kind="warning" title="ofcPeFiguresUnknown">
              <p style={{ margin: 0 }}>{t.ofcPeFiguresUnknownBody}</p>
            </Alert>
          ) : (
            <>
              <div className="stat-grid">
                <Stat label="ofcPeCollected" value={<Money kobo={figures.collected_kobo} />} />
                <Stat label="ofcPeSettled" value={<Money kobo={figures.settled_kobo} />} />
                <Stat label="ofcPeCommission" value={<Money kobo={figures.commission_kobo} />} />
                <Stat label="ofcPeTransactions" value={figures.transaction_count} />
              </div>

              {outstanding !== 'unknown' && outstanding > 0 && (
                <Alert kind="warning" title="ofcPeNotReady">
                  <p>{t.ofcPeNotReadyBody}</p>
                  <p>
                    {t.ofcPeUnreconciled}: <strong>{figures.unreconciled}</strong> ·{' '}
                    {t.ofcPePendingPayments}: <strong>{figures.pending_payments}</strong>
                  </p>
                </Alert>
              )}
            </>
          )}

          <label>
            {t.ofcPeClosingNote}
            <textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>

          {needsReason && (
            <label>
              {t.ofcPeOverride}
              <textarea
                rows={2}
                value={override}
                onChange={(event) => setOverride(event.target.value)}
              />
            </label>
          )}

          <div className="button-row">
            {period.status === 'OPEN' && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.post(`/government/periods/${period.id}/begin-closing`, {});
                  })
                }
              >
                {t.ofcPeBeginClosing}
              </button>
            )}
            <button
              type="button"
              disabled={
                busy ||
                note.trim().length < 10 ||
                (needsReason && override.trim().length < 10)
              }
              onClick={() =>
                run(async () => {
                  await stepUp('financial.period.close', user.phone);
                  await api.post(`/government/periods/${period.id}/close`, {
                    note: note.trim(),
                    overrideReason: override.trim() || undefined,
                  });
                })
              }
            >
              {t.ofcPeClose}
            </button>
            <button type="button" className="secondary" onClick={onCancel}>
              {t.camCancel}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
