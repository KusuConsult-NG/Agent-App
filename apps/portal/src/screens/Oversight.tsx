/** Fraud, leakage and audit oversight (PRD §32, §45, §67, §72). */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, asApiError, can, type ApiError } from '../lib/api';
import { Alert, Badge, BeforeAfter, ErrorAlert, ExportButtons, Loading, Money, Stat, Table, formatDateTime } from '../ui';
import { withJustification } from '../lib/justify';
import { usePortalI18n } from '../lib/i18n';
import { useFilters } from '../lib/filters';
import { CHAIN_TEXT, enumLabel, localName } from '@psirs/shared';
import type { ChainVerdict, TranslationDictionary } from '@psirs/shared';

/**
 * The evidence behind a signal, in a form an officer can act on.
 *
 * This was `JSON.stringify(detail)`, so the reason an "out of territory" flag
 * had been raised arrived as a pair of UUIDs — the reviewer could see that two
 * territories differed but not which, which is the entire content of the
 * signal. Every flag here is raised for a person to judge before anything
 * happens to a transaction, and evidence they have to query the database to
 * read is evidence that does not get read.
 *
 * Identifiers are still shown, last and dimmed: they are what an officer quotes
 * when escalating, but they are not what they reason with.
 */
function SignalDetail({ detail }: { detail: Record<string, unknown> | null }) {
  const { t } = usePortalI18n();
  if (!detail || typeof detail !== 'object') return <span>—</span>;

  const entries = Object.entries(detail);
  if (entries.length === 0) return <span>—</span>;

  const readable = entries.filter(([key]) => !key.endsWith(t.ofcOvId));
  const identifiers = entries.filter(([key]) => key.endsWith(t.ofcOvId));

  return (
    <div className="signal-detail">
      {(readable.length > 0 ? readable : identifiers).map(([key, value]) => (
        <div key={key}>
          <span className="signal-detail__key">{humanise(key, t)}</span>{' '}
          <span className="signal-detail__value">{formatValue(value)}</span>
        </div>
      ))}
      {readable.length > 0 && identifiers.length > 0 && (
        <details className="signal-detail__ids">
          <summary>{t.ofcOvIdentifiers}</summary>
          {identifiers.map(([key, value]) => (
            <div key={key} className="mono">
              {humanise(key, t)} {formatValue(value)}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

/**
 * What a fraud signal's evidence is called, in the language being read.
 *
 * The keys come from the detection code's own `detail` object, so this is a
 * map rather than an enumeration: a new signal can attach a new key without a
 * migration, and the fallback below — the key spaced out — is what it will
 * show until somebody names it. That is the right trade for diagnostic
 * evidence and the wrong one for a status, which is why statuses go through
 * `enumLabel` and are checked against the schema.
 */
const SIGNAL_KEYS: Record<string, keyof TranslationDictionary> = {
  count: 'ofcOvSignalCount',
  windowSeconds: 'ofcOvSignalWindowSeconds',
  threshold: 'ofcOvSignalThreshold',
  reason: 'ofcOvSignalReason',
  agentsSupported: 'ofcOvSignalAgentsSupported',
  agentAssignedTo: 'ofcOvSignalAgentAssignedTo',
  collectedIn: 'ofcOvSignalCollectedIn',
  agentTerritoryLgaId: 'ofcOvSignalAgentTerritory',
  transactionLgaId: 'ofcOvSignalTransactionArea',
};

/** `agentAssignedTo` → `Agent assigned to`, when nothing has named it. */
function humanise(key: string, t: TranslationDictionary): string {
  const named = SIGNAL_KEYS[key];
  if (named) return t[named];
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function FraudScreen() {
  const { t } = usePortalI18n();
  const [leakage, setLeakage] = useState<any | null>(null);
  const [flags, setFlags] = useState<any[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('OPEN');
  /*
   * Two reads, two failures, both kept away from the action error.
   *
   * The flags catch was already fixed once, for the half of this that
   * mattered most: it leaves `flags` at null rather than writing `[]`, so an
   * unread queue cannot read as a queue with nothing in it. But `!flags`
   * renders the skeleton, so what an officer actually saw was a refusal at the
   * top of the screen and four grey bars where the queue belongs — and the
   * leakage figures, on the same shared `error`, simply were not drawn at all.
   *
   * Separately, because they answer different questions: the figures say how
   * much money is unaccounted for, the queue says who is suspected of taking
   * it, and an officer needs to know which of the two they are missing.
   */
  const [flagsError, setFlagsError] = useState<ApiError | null>(null);
  const [leakageError, setLeakageError] = useState<ApiError | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<string | null>(null);

  /*
   * `fraud:manage` is held by administrators and revenue officers only. A
   * finance officer, an auditor and a supervisor all hold `fraud:read` — they
   * look at flags, they do not raise them — so the control is not offered to
   * them rather than being offered and refused.
   */
  const canSweep = can('fraud:manage');

  const load = useCallback(() => {
    api
      .get('/government/leakage')
      .then((loaded) => {
        setLeakage(loaded);
        setLeakageError(null);
      })
      .catch((caught) => {
        setLeakageError(asApiError(caught));
      });

    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    api
      .get<any[]>(`/government/fraud/flags?${params.toString()}`)
      .then((loaded) => {
        setFlags(loaded);
        setFlagsError(null);
      })
      // A fraud queue that could not be read is not a queue with no flags in
      // it, and "no flags" is the reading an officer will take from an empty
      // table. The refusal reaches the screen instead — in the queue's own
      // place, rather than above a skeleton that never resolves.
      .catch((caught) => {
        setFlagsError(asApiError(caught));
      });
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function review(id: string, decision: 'UNDER_REVIEW' | 'CONFIRMED' | 'DISMISSED') {
    await withJustification({
      question: t.ofcOvRecordWhatYouFound,
      minimum: 10,
      tooShort: t.ofcOvFlagNoteTooShort,
      run: async (note) => {
        await api.post(`/government/fraud/flags/${id}/review`, { decision, note });
        load();
      },
      onSuccess:
        decision === 'CONFIRMED'
          ? t.ofcOvFlagConfirmed
          : t.ofcOvFlagMarked.replace('{{decision}}', enumLabel(decision, t)),
      setError,
      setMessage,
    });
  }

  return (
    <>
      <div className="card">
        <h2 className="card__title">{t.ofcOvLeakageTitle}</h2>
        <p className="card__hint">{t.ofcOvSignalsBody}</p>
        {canSweep && (
          <>
            <p className="card__hint" style={{ marginTop: 12 }}>{t.ofcOvSweepBody}</p>
            <div className="button-row">
              <button
                type="button"
                disabled={sweeping}
                onClick={async () => {
                  setSweeping(true);
                  setSweepResult(null);
                  setError(null);
                  try {
                    const result = await api.post<{ flagsRaised?: number; raised?: number }>(
                      '/government/fraud/sweep',
                      {},
                    );
                    const raised = result.flagsRaised ?? result.raised ?? 0;
                    setSweepResult(
                      raised === 0
                        ? t.ofcOvSweepCompleteNothingNew
                        : t.ofcOvSweepRaised.replace('{{count}}', String(raised)),
                    );
                    load();
                  } catch (caught) {
                    setError(asApiError(caught));
                  } finally {
                    setSweeping(false);
                  }
                }}
              >
                {sweeping ? t.ofcOvSweeping : t.ofcOvRunAFraudSweep}
              </button>
            </div>
            {sweepResult && <Alert kind="success">{sweepResult}</Alert>}
          </>
        )}
      </div>

      {/*
        Where the figures would have been. Without this the grid is simply
        absent, and a screen that is missing a section looks like a screen
        that has nothing to report.
      */}
      {leakageError && (
        <div className="card">
          <ErrorAlert error={leakageError} />
          <button type="button" className="secondary" onClick={load}>{t.actionTryAgain}</button>
        </div>
      )}

      {leakage && (
        <div className="stat-grid">
          <Stat
            label="ofcOvUnreconciled48h"
            value={<Money kobo={leakage.unreconciledOver48Hours.amount_kobo} />}
            hint={{
              text: t.ofcOvTransactionCount.replace(
                '{{n}}',
                String(leakage.unreconciledOver48Hours.count),
              ),
            }}
            variant={Number(leakage.unreconciledOver48Hours.count) > 0 ? 'alert' : undefined}
          />
          <Stat
            label="ofcOvSettlementShortfall"
            value={<Money kobo={leakage.settlementsOutstanding.variance_kobo} />}
            hint={{
              text: t.ofcOvSettlementsOutstanding.replace(
                '{{n}}',
                String(leakage.settlementsOutstanding.count),
              ),
            }}
          />
          <Stat label="ofcOvDuplicatePayments" value={leakage.duplicatePayments.count} />
          <Stat
            label="ofcOvFailedVerifications"
            value={leakage.failedReceiptVerifications.count}
            hint="ofcOvNoValidReceipt"
          />
        </div>
      )}

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      {leakage && leakage.highRiskAgents.length > 0 && (
        <div className="card card--flush">
          <div className="card__pad">
            <h2 className="card__title">{t.ofcOvAgentsWithFlags}</h2>
          </div>
          <Table
            columns={[
              { key: 'agent_code', label: 'ofcRhAgent' },
              { key: 'full_name', label: 'tpName' },
              { key: 'flag_count', label: 'ofcOvOpenFlags', numeric: true },
              {
                key: 'highest_severity',
                label: 'ofcOvHighestSeverity',
                render: (row) => <Badge status={row.highest_severity} />,
              },
            ]}
            rows={leakage.highRiskAgents}
          />
        </div>
      )}

      <div className="card card--flush">
        <div className="card__pad">
          <div className="card__header">
            <div>
              <h2 className="card__title">{t.ofcOvFraudSignals}</h2>
            </div>
            <div className="field" style={{ marginBottom: 0, minWidth: 160 }}>
              <label htmlFor="flag-status">{t.appStatus}</label>
              <select
                id="flag-status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="">{t.ofcAgAll}</option>
                <option value="OPEN">{t.ofcRhOpen}</option>
                <option value="UNDER_REVIEW">{t.ofcOvUnderReview}</option>
                <option value="CONFIRMED">{t.moreBankCheckConfirmed}</option>
                <option value="DISMISSED">{t.ofcOvDismissed}</option>
              </select>
            </div>
          </div>
        </div>
        {flagsError ? (
          <div style={{ padding: 18 }}>
            <ErrorAlert error={flagsError} />
            <button type="button" className="secondary" onClick={load}>{t.actionTryAgain}</button>
          </div>
        ) : !flags ? (
          <div style={{ padding: 18 }}>
            <Loading rows={4} />
          </div>
        ) : (
          <Table
            columns={[
              { key: 'rule', label: 'ofcAgSignal', render: (row) => <Badge status={row.rule} /> },
              { key: 'severity', label: 'ofcAgSeverity', render: (row) => <Badge status={row.severity} /> },
              { key: 'entity_type', label: 'ofcSpSubject' },
              { key: 'agent_name', label: 'ofcRhAgent', render: (row) => row.agent_name ?? '—' },
              {
                key: 'transaction_reference',
                label: 'supTransactionLabel',
                render: (row) => <span className="mono">{row.transaction_reference ?? '—'}</span>,
              },
              {
                key: 'detail',
                label: 'ofcAgDetail',
                render: (row) => <SignalDetail detail={row.detail} />,
              },
              { key: 'created_at', label: 'ofcRhRaisedHeading', render: (row) => formatDateTime(row.created_at) },
              {
                key: 'action',
                label: { text: '' },
                render: (row) =>
                  can('fraud:manage') && ['OPEN', 'UNDER_REVIEW'].includes(row.status) ? (
                    <div className="button-row">
                      <button
                        type="button"
                        className="small danger"
                        onClick={() => review(row.id, 'CONFIRMED')}
                      >{t.ofcOvConfirm}</button>
                      <button
                        type="button"
                        className="small secondary"
                        onClick={() => review(row.id, 'DISMISSED')}
                      >{t.ofcOvDismiss}</button>
                    </div>
                  ) : (
                    <Badge status={row.status} />
                  ),
              },
            ]}
            rows={flags}
            empty="ofcNoneFraudSignalsMatchFilter"
          />
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * The audit questions, and what each needs before it can be asked.
 *
 * Three of the five took a parameter and had no caller anywhere, because this
 * list only modelled the ones that take none: transactions by a named agent,
 * receipts under a named revenue item, and who has looked at a named
 * taxpayer's record. The last of those is the question a data-protection
 * enquiry actually asks, and it was answerable only by querying the database
 * directly — which is the thing this screen says it exists to avoid.
 *
 * Each parameter is chosen from a list rather than typed. An auditor knows the
 * agent's name and the taxpayer's phone number; nobody knows a UUID.
 */
interface AuditQuery {
  key: string;
  label: string;
  path: string;
  /** What must be picked first. Absent means the question can be asked as it is. */
  parameter?: {
    name: string;
    prompt: keyof TranslationDictionary;
    /** Where the options come from, and how to label them. */
    source: 'agents' | 'revenueItems' | 'taxpayerSearch';
  };
  /** Whether the query also wants a period. */
  period?: boolean;
}

const AUDIT_QUERIES: AuditQuery[] = [
  {
    key: 'reversed',
    label: 'ofcOvReversedAfterPayment',
    path: '/government/audit/queries/reversed-after-success',
  },
  {
    key: 'rates',
    label: 'ofcOvAllRateChanges',
    path: '/government/audit/queries/rate-changes',
  },
  {
    key: 'agent-transactions',
    label: 'ofcOvOneAgentCollected',
    path: '/government/audit/queries/agent-transactions',
    parameter: { name: 'agentId', prompt: 'ofcOvWhichAgent', source: 'agents' },
    period: true,
  },
  {
    key: 'receipts-by-item',
    label: 'ofcOvReceiptsOneItem',
    path: '/government/audit/queries/receipts-by-item',
    parameter: { name: 'revenueItemCode', prompt: 'ofcOvWhichRevenueItem', source: 'revenueItems' },
  },
  {
    key: 'taxpayer-access',
    label: 'ofcOvWhoLookedAtRecord',
    path: '/government/audit/queries/taxpayer-access',
    parameter: { name: 'taxpayerId', prompt: 'ofcOvWhichTaxpayer', source: 'taxpayerSearch' },
  },
];

/**
 * Whether the unattended work is actually running.
 *
 * Nine jobs run on timers with nobody watching them, and until this existed
 * eight of them left no trace at all — a sweep that ran and found nothing to do
 * wrote exactly as many rows as a sweep that never ran. That absence is the
 * thing this panel exists to remove, so it is deliberately loudest about the
 * states that have no other evidence anywhere: a job that has never run once,
 * and a job whose timer has stopped. Both look like silence everywhere else in
 * the platform.
 *
 * It sits on the audit screen rather than a settings page because whether the
 * reconciliation sweep operated is an audit fact — the auditor checking that
 * the State's money was proved against the gateway statement should not have to
 * take the platform's word for it that the check ran.
 */
interface JobReport {
  name: string;
  purpose: string;
  intervalMs: number;
  state: 'NEVER_RUN' | 'HEALTHY' | 'RUNNING' | 'OVERDUE' | 'FAILING' | 'STALLED';
  lastStartedAt: string | null;
  lastSucceededAt: string | null;
  lastDetail: string | null;
  /**
   * Why the last run failed.
   *
   * `jobHealth()` has always sent this; the interface here simply never
   * declared it, so the one detail that makes a FAILING row actionable was
   * arriving and being dropped on the floor.
   */
  lastError: string | null;
  consecutiveFailures: number;
  runsTotal: number;
  failuresTotal: number;
  message: string;
}

/**
 * How the six states read to somebody deciding what to do about them.
 *
 * `describeState` composed these in `apps/api` and this column printed them,
 * while the column beside it rendered the same `state` as a translated badge.
 * Every value they are built from was already here: the enum, the count of
 * consecutive failures, and the error from the last run.
 *
 * OVERDUE and STALLED are the pair worth keeping apart. A job that has not
 * started means the schedule may have stopped; a job that started and never
 * returned means an instance died holding it. Both show as "not working" and
 * they are looked into differently.
 */
function jobState(row: JobReport, t: TranslationDictionary): string {
  switch (row.state) {
    case 'HEALTHY':
      return t.ofcOvJobHealthy;
    case 'RUNNING':
      return t.ofcOvJobRunning;
    case 'OVERDUE':
      return t.ofcOvJobOverdue;
    case 'STALLED':
      return t.ofcOvJobStalled;
    case 'FAILING':
      return t.ofcOvJobFailing
        .replace('{{count}}', String(row.consecutiveFailures))
        .replace('{{error}}', row.lastError ?? t.ofcOvJobNoReason);
    case 'NEVER_RUN':
      return t.ofcOvJobNeverRun;
    default:
      return row.message;
  }
}

/** Every-30-seconds and every-6-hours both have to read at a glance. */
function readInterval(ms: number, t: TranslationDictionary): string {
  if (ms < 60_000)
    return t.ofcOvEverySeconds.replace('{{n}}', String(Math.round(ms / 1000)));
  if (ms < 60 * 60_000)
    return t.ofcOvEveryMinutes.replace('{{n}}', String(Math.round(ms / 60_000)));
  return t.ofcOvEveryHours.replace('{{n}}', String(Math.round(ms / (60 * 60_000))));
}

export function BackgroundWorkPanel() {
  const { t } = usePortalI18n();
  const [health, setHealth] = useState<{
    jobs: JobReport[];
    healthy: boolean;
    needingAttention: number;
  } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    api
      .get<{ jobs: JobReport[]; healthy: boolean; needingAttention: number }>('/government/workers')
      .then(setHealth)
      .catch((caught) => {
        setError(asApiError(caught));
      });
  }, []);

  if (error) return <ErrorAlert error={error} />;
  if (!health) return <Loading rows={3} />;

  return (
    <div className="card">
      <h2 className="card__title">{t.ofcOvUnattendedWork}</h2>
      <p className="card__hint">
        {health.healthy
          ? t.ofcOvEveryScheduledJobHas
          : t.ofcOvJobsNeedAttention
              .replace('{{count}}', String(health.needingAttention))
              .replace('{{total}}', String(health.jobs.length))}
      </p>
      <Table
        columns={[
          {
            key: 'name',
            label: 'ofcOvJob',
            render: (row: JobReport) => (
              <>
                <strong>{row.name.replace(/-/g, ' ')}</strong>
                <br />
                <span className="table__sub">{row.purpose}</span>
              </>
            ),
          },
          {
            key: 'intervalMs',
            label: 'ofcOvRuns',
            render: (row: JobReport) => readInterval(row.intervalMs, t),
          },
          {
            key: 'state',
            label: 'ofcOsState',
            render: (row: JobReport) => <Badge status={row.state} />,
          },
          {
            key: 'lastSucceededAt',
            // Not "last run". A job throwing since Tuesday has a recent run and
            // no recent success, and that is the distinction worth a column.
            label: 'ofcOvLastSucceeded',
            render: (row: JobReport) =>
              row.lastSucceededAt ? formatDateTime(row.lastSucceededAt) : t.ofcArNeverPaid,
          },
          {
            /*
             * What the last run actually did, which was arriving and being
             * dropped.
             *
             * `jobHealth` has always sent `lastDetail` — "4 reminder(s)
             * sent", "promoted 12 commission(s) to eligible" — and this
             * interface declared it and no column drew it. So a HEALTHY row
             * said the job ran and nothing about whether it found anything,
             * which is the difference between a reminder sweep working and a
             * reminder sweep running over an empty queue because the query
             * behind it broke.
             *
             * The server's words are kept, as `nextStep` on a `conflict()` is:
             * this sentence carries different counts every run, so there is no
             * code to key a translation on.
             *
             * The three cases are kept apart. A succeeded run with no detail
             * is "nothing needed doing", which is an answer; a job that has
             * never succeeded gets a dash, and the state column says why.
             */
            key: 'whatItDid',
            label: 'ofcOvWhatItDid',
            render: (row: JobReport) =>
              row.lastDetail ??
              (row.lastSucceededAt ? t.ofcOvNothingNeededDoing : '\u2014'),
          },
          {
            /*
             * Named for what the column shows, not for the field it used to
             * print. `Table` reads `key` for data only when there is no
             * `render`, so if this render is ever dropped the column shows a
             * dash rather than quietly going back to the API's English.
             */
            key: 'whatThatMeans',
            label: 'ofcOvWhatThatMeans',
            render: (row: JobReport) => jobState(row, t),
          },
        ]}
        rows={health.jobs}
        empty="ofcNoneBackgroundJobsDeclared"
      />
    </div>
  );
}

/** Exactly what `GET /government/audit/verify` answers with. */
interface ChainAnswer {
  valid: boolean;
  entriesChecked: number;
  brokenAtSequence?: number;
  verdict: ChainVerdict;
  /** The server's English, kept for a build that meets an outcome it does not know. */
  message: string;
}

/**
 * The verdict as a sentence, with its number filled in.
 *
 * A verdict this build has never met keeps the server's English rather than
 * showing nothing: an auditor told the chain is broken and given no reason is
 * worse off than one given a reason in the wrong language.
 */
function chainAnswer(answer: ChainAnswer, t: TranslationDictionary): string {
  const key = CHAIN_TEXT[answer.verdict];
  if (!key) return answer.message;
  return (t[key] as string)
    .replace('{{count}}', String(answer.entriesChecked))
    .replace('{{sequence}}', String(answer.brokenAtSequence ?? 0));
}

export function AuditScreen() {
  const { t } = usePortalI18n();
  const [entries, setEntries] = useState<any[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [verification, setVerification] = useState<ChainAnswer | null>(null);
  const [queryResult, setQueryResult] = useState<{ label: string; rows: any[] } | null>(null);
  const [pending, setPending] = useState<AuditQuery | null>(null);
  /*
   * Kept in the URL and in this session. An auditor who filtered to one action,
   * opened the transaction it named and came back used to get the whole log.
   */
  const [filters, setFilters] = useFilters('audit', '/audit', { action: '', entityType: '' });

  /*
   * One builder for the screen and the export.
   *
   * They were separate, and drifted: the screen read 150 entries and the
   * export sent 500 with the same two filters written out again. An officer
   * exporting what they were looking at should get what they were looking at,
   * filtered the same way -- so the only difference is how many rows, which is
   * the one difference that is deliberate.
   */
  const auditQuery = useCallback(
    (limit: number) => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (filters.action) params.set('action', filters.action);
      if (filters.entityType) params.set('entityType', filters.entityType);
      return params;
    },
    [filters],
  );

  useEffect(() => {
    const params = auditQuery(150);

    setEntries(null);
    api
      .get<any[]>(`/government/audit?${params.toString()}`)
      .then(setEntries)
      .catch((caught) => {
        setError(asApiError(caught));
      });
  }, [auditQuery]);

  return (
    <>
      <div className="card">
        <div className="card__header">
          <div>
            <h2 className="card__title">{t.ofcOvAuditTrail}</h2>
            <p className="card__hint">{t.ofcOvChainBody}</p>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              // The one control this role exists to operate. It was the only
              // request on this screen with nothing to catch it: a refusal or
              // an outage left the auditor pressing a button that did nothing
              // and saying nothing — which reads exactly like a trail that has
              // no answer, rather than a check that did not run.
              setError(null);
              setVerification(null);
              try {
                setVerification(await api.get<ChainAnswer>('/government/audit/verify'));
              } catch (caught) {
                if (caught instanceof ApiRequestError) setError(caught.error);
                else
                  setError({
                    code: 'VERIFICATION_UNAVAILABLE',
                    message:
                      t.ofcOvTheAuditTrailCould,
                  } as ApiError);
              }
            }}
          >{t.ofcOvVerifyChain}</button>
        </div>

        {verification && (
          <Alert
            kind={verification.valid ? 'success' : 'error'}
            title={verification.valid ? 'ofcOvIntact' : 'ofcOvTampered'}
          >
            {/*
              * Which of the four, in the language the heading above is in.
              *
              * The heading was already translated and the sentence under it
              * was the API's English, so an officer reading Hausa was told
              * "An taba rajistar bincike" and then, in English, what had
              * actually been done to it. That sentence is the whole answer:
              * a log whose head was cut off, an entry missing from the
              * middle, and a row edited after the fact are three different
              * events, and which one it is decides what the auditor does
              * next.
              */}
            <p style={{ margin: 0 }}>{chainAnswer(verification, t)}</p>
          </Alert>
        )}
      </div>

      <BackgroundWorkPanel />

      <div className="card">
        <h2 className="card__title">{t.ofcOvStandardQuestions}</h2>
        <p className="card__hint">{t.ofcOvStandardQuestionsBody}</p>
        <div className="button-row">
          {AUDIT_QUERIES.map((query) => (
            <button
              key={query.key}
              type="button"
              className="secondary"
              onClick={async () => {
                if (query.parameter) {
                  setPending(query);
                  setQueryResult(null);
                  return;
                }
                setPending(null);
                try {
                  const rows = await api.get<any[]>(query.path);
                  setQueryResult({ label: query.label, rows });
                } catch (caught) {
                  setError(asApiError(caught));
                }
              }}
            >
              {query.label}
            </button>
          ))}
        </div>
      </div>

      {pending && (
        <AuditQueryParameters
          query={pending}
          onCancel={() => setPending(null)}
          onRan={(rows) => {
            setQueryResult({ label: pending.label, rows });
            setPending(null);
          }}
          onError={setError}
        />
      )}

      {queryResult && (
        <div className="card card--flush">
          <div className="card__pad">
            <div className="card__header">
              <h2 className="card__title">{queryResult.label}</h2>
              <button type="button" className="small secondary" onClick={() => setQueryResult(null)}>{t.ofcKycClose}</button>
            </div>
          </div>
          <Table
            columns={Object.keys(queryResult.rows[0] ?? { result: t.ofcOvNoRows }).map((key) => ({
              key,
              // A column named by whatever the query returned: data, not a label.
              label: { text: key.replace(/_/g, ' ') },
              render: (row: any) =>
                typeof row[key] === 'object' && row[key] !== null ? (
                  <span className="mono">{JSON.stringify(row[key])}</span>
                ) : (
                  String(row[key] ?? '—')
                ),
            }))}
            rows={queryResult.rows}
            empty="ofcNoneRecordsMatchQuery"
          />
        </div>
      )}

      <ErrorAlert error={error} />

      <div className="card card--flush">
        <div className="card__pad">
          <div className="filters">
            <div className="field">
              <label htmlFor="entity">{t.ofcOvEntityType}</label>
              <input
                id="entity"
                value={filters.entityType}
                onChange={(event) => setFilters({ entityType: event.target.value })}
                placeholder={t.ofcOvEntityPlaceholder}
              />
            </div>
            <div className="field">
              <label htmlFor="action">{t.ofcOvAction}</label>
              <input
                id="action"
                value={filters.action}
                onChange={(event) => setFilters({ action: event.target.value })}
                placeholder={t.ofcOvActionPlaceholder}
              />
            </div>
            <ExportButtons
              path={`/government/audit?${auditQuery(500).toString()}`}
              filename={`plateau-audit-${new Date().toISOString().slice(0, 10)}`}
            />
          </div>
        </div>

        {!entries ? (
          <div style={{ padding: 18 }}>
            <Loading rows={6} />
          </div>
        ) : (
          <Table
            columns={[
              { key: 'sequence_no', label: { text: '#' }, numeric: true },
              { key: 'created_at', label: 'ofcRhWhen', render: (row) => formatDateTime(row.created_at) },
              { key: 'actor_name', label: 'ofcOvActor', render: (row) => row.actor_name ?? t.ofcOvSystem },
              { key: 'actor_role', label: 'ofcRhRole' },
              { key: 'action', label: 'ofcOvAction', render: (row) => <span className="mono">{row.action}</span> },
              { key: 'entity_type', label: 'ofcOvEntity' },
              { key: 'result', label: 'ofcOvResult', render: (row) => <Badge status={row.result} /> },
              { key: 'reason', label: 'ofcAgReason', render: (row) => row.reason ?? '—' },
              {
                /*
                 * What the action actually changed.
                 *
                 * The columns to the left say who did what, and until now that
                 * was the whole of this screen: an auditor who wanted to know
                 * what an action *did* opened Transaction 360, which only
                 * helps if you already know which transaction. The diff is
                 * rendered here rather than both sides in full, because a
                 * reader asked to spot which of fourteen fields moved does not
                 * spot it.
                 */
                key: 'change',
                label: 'ofcOvChange',
                render: (row) => <BeforeAfter before={row.old_value} after={row.new_value} />,
              },
              {
                key: 'hash',
                label: 'ofcOvHash',
                render: (row) => <span className="mono">{String(row.hash).slice(0, 10)}…</span>,
              },
            ]}
            rows={entries}
            empty="ofcNoneAuditEntriesMatchThese"
          />
        )}
      </div>
    </>
  );
}

/**
 * Choose what a query is about, then run it.
 *
 * The options are fetched from the lists an auditor already has access to —
 * every role holding audit:read also holds agent:read:all, catalogue:read and
 * taxpayer:read:all, so none of these selects can present a choice the query
 * would then refuse.
 */
function AuditQueryParameters({
  query,
  onCancel,
  onRan,
  onError,
}: {
  query: AuditQuery;
  onCancel: () => void;
  onRan: (rows: any[]) => void;
  onError: (error: ApiError) => void;
}) {
  const { lang, t } = usePortalI18n();
  const [options, setOptions] = useState<{ value: string; label: string }[] | null>(null);
  const [value, setValue] = useState('');
  const [search, setSearch] = useState('');
  /**
   * Whether a taxpayer search has been run, as distinct from whether it found
   * anything. Taxpayers are searched rather than listed, so an empty option
   * list means one of two opposite things: nobody has searched yet, or the
   * search came back with nobody. Without this flag the select said "Search
   * for a taxpayer first" in both cases, which tells an auditor who has just
   * searched to do the thing they have already done.
   */
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86_400_000);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  });

  const source = query.parameter!.source;

  useEffect(() => {
    setOptions(null);
    setValue('');
    setSearched(false);
    if (source === 'agents') {
      api
        .get<{ agents: any[] } | any[]>('/agents?limit=200')
        .then((data) => {
          const list = Array.isArray(data) ? data : data.agents;
          setOptions(
            list.map((agent: any) => ({
              value: agent.id,
              label: `${agent.full_name} (${agent.agent_code})`,
            })),
          );
        })
        .catch(() => setOptions([]));
    } else if (source === 'revenueItems') {
      api
        .get<any[]>('/revenue/items')
        .then((list) =>
          setOptions(
            (Array.isArray(list) ? list : []).map((item: any) => ({
              value: item.code,
              label: `${localName(lang, item.name, item.name_ha)} (${item.code})`,
            })),
          ),
        )
        .catch(() => setOptions([]));
    } else {
      // Taxpayers are searched rather than listed: there are more of them than
      // any select should hold, and an auditor arrives knowing a name or number.
      setOptions([]);
    }
  }, [source]);

  async function runSearch() {
    if (!search.trim()) return;
    setBusy(true);
    try {
      const found = await api.get<any[] | { taxpayers: any[] }>(
        `/taxpayers/search?q=${encodeURIComponent(search.trim())}&limit=25`,
      );
      const list = Array.isArray(found) ? found : found.taxpayers;
      setOptions(
        list.map((taxpayer: any) => ({
          value: taxpayer.id ?? taxpayer.taxpayer_id,
          label: `${taxpayer.display_name ?? taxpayer.business_name ?? [taxpayer.first_name, taxpayer.last_name].filter(Boolean).join(' ')} · ${taxpayer.phone ?? ''}`,
        })),
      );
      setSearched(true);
    } catch (caught) {
      onError(asApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    try {
      const params = new URLSearchParams({ [query.parameter!.name]: value });
      if (query.period) {
        params.set('from', new Date(`${range.from}T00:00:00`).toISOString());
        params.set('to', new Date(`${range.to}T23:59:59`).toISOString());
      }
      onRan(await api.get<any[]>(`${query.path}?${params.toString()}`));
    } catch (caught) {
      onError(asApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card__header">
        <h2 className="card__title">{query.label}</h2>
        <button type="button" className="small secondary" onClick={onCancel}>{t.camCancel}</button>
      </div>

      {source === 'taxpayerSearch' && (
        <div className="filters">
          <div className="field">
            <label htmlFor="taxpayer-search">{t.ofcOvFindTheTaxpayer}</label>
            <input
              id="taxpayer-search"
              value={search}
              placeholder={t.colNamePhoneTin}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void runSearch();
              }}
            />
          </div>
          <button type="button" className="secondary" disabled={busy} onClick={() => void runSearch()}>{t.search}</button>
        </div>
      )}

      <div className="field">
        <label htmlFor="audit-parameter">{t[query.parameter!.prompt]}</label>
        <select
          id="audit-parameter"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={!options || options.length === 0}
        >
          <option value="">
            {!options
              ? t.ofcOvLoading
              : options.length === 0
                ? source === 'taxpayerSearch'
                  ? searched
                    ? t.ofcOvNoTaxpayerMatchedThat
                    : t.ofcOvSearchForATaxpayer
                  : t.ofcOvNothingToChooseFrom
                : t.ofcOvSelectOne}
          </option>
          {(options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {query.period && (
        <div className="filters">
          <div className="field">
            <label htmlFor="audit-from">{t.ofcFrom}</label>
            <input
              id="audit-from"
              type="date"
              value={range.from}
              onChange={(event) => setRange({ ...range, from: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="audit-to">{t.ofcTo}</label>
            <input
              id="audit-to"
              type="date"
              value={range.to}
              onChange={(event) => setRange({ ...range, to: event.target.value })}
            />
          </div>
        </div>
      )}

      <button type="button" disabled={busy || !value} onClick={() => void run()}>
        {busy ? t.ofcOvRunning : t.ofcOvRunThisQuery}
      </button>
    </div>
  );
}
