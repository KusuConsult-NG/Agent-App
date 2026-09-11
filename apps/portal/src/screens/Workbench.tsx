/**
 * The auditor's workbench: drawing a sample, and signing a report.
 *
 * Two things an examiner needs that the platform could show them and could not
 * let them record.
 *
 * A SAMPLE IS A DRAW, NOT A FILTER
 *
 * Every other screen here narrows a list and shows what is left. This one
 * commits: the criteria, the method, the seed and the selected transactions
 * are written down and cannot be changed afterwards. That is deliberately
 * heavier than a filter, because a selection an auditor can quietly redo until
 * it looks interesting is not evidence of anything.
 *
 * So the form says what is about to be fixed before it fixes it, and the drawn
 * sample shows its seed on the page rather than hiding it — a reviewer who
 * cannot see the seed cannot reproduce the draw, which is the only thing that
 * makes "randomly selected" a claim rather than an assertion.
 *
 * A REPORT IS A MOMENT
 *
 * Generating freezes the rows; signing puts a name on them. They are separate
 * buttons because they are separate acts and often separate people, and the
 * list shows a report's checksum state so a reader is told when stored figures
 * no longer match what was signed instead of being shown them regardless.
 *
 * That last clause was false for as long as it had been written. The list
 * showed the checksum recorded at generation — the one value an edit to the
 * stored rows leaves untouched — so an altered report printed its original
 * hash beside a signature, and a reader takes a checksum on a screen for a
 * checked one. The recomputation existed in `getReport`, with an API test
 * proving it caught a tampered payload, and nothing on any screen ever called
 * it. `listReports` now recomputes per row, and an altered report is marked
 * where it sits and named again above the table, because a marker in a cell
 * is scrolled past by the reader who most needs it.
 *
 * WHAT THIS SCREEN DOES NOT DO
 *
 * It does not score anything. No pass mark, no risk rating on a sample, no
 * traffic light on a report. An audit conclusion is a person's judgement with
 * their name against it, and a number with a formula behind it would quietly
 * become the thing people manage to.
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
import {
  Alert,
  Badge,
  ErrorAlert,
  ExportButtons,
  Loading,
  Money,
  ReasonRule,
  Stat,
  Table,
  formatDate,
} from '../ui';
import { usePortalI18n } from '../lib/i18n';

interface SampleRow {
  id: string;
  sample_number: string;
  title: string;
  method: string;
  seed: string;
  population_size: number;
  sample_size: number;
  status: string;
  drawn_at: string;
  completed_at: string | null;
  drawn_by_name: string | null;
  exceptions: number;
  pending: number;
}

interface SampleItem {
  id: string;
  position: number;
  outcome: string;
  finding: string | null;
  reviewed_at: string | null;
  case_number: string | null;
  transaction_id: string;
  transaction_reference: string;
  total_amount_kobo: string;
  transaction_status: string;
  transaction_at: string;
  lga_name: string;
  agent_code: string | null;
  taxpayer_name: string;
  reviewed_by_name: string | null;
}

interface SampleDetail extends SampleRow {
  note: string | null;
  criteria: Record<string, unknown>;
  items: SampleItem[];
}

interface ReportRow {
  id: string;
  report_number: string;
  report_type: string;
  title: string;
  period_start: string | null;
  period_end: string | null;
  row_count: number;
  checksum: string;
  status: string;
  generated_at: string;
  signed_at: string | null;
  generated_by_name: string | null;
  signed_by_name: string | null;
  withdrawn_reason: string | null;
  /**
   * Whether the stored rows still hash to the checksum beside them.
   *
   * Optional only so an older API answering this screen degrades to the
   * behaviour it had before rather than marking every report altered.
   */
  checksumMatches?: boolean;
}

const REPORT_TYPES = [
  'TRANSACTION_AUDIT',
  'AGENT_ACTIVITY',
  'REVENUE_COLLECTION',
  'LGA_PERFORMANCE',
  'PAYMENT_RECONCILIATION',
  'COMMISSION',
  'USER_ACTIVITY',
  'ANOMALY',
  'AUDIT_SAMPLE',
  'FRAUD_FLAG',
  'REVENUE_TARGET',
  'PERIOD_CLOSING',
  'DATA_CHANGE',
] as const;

export function WorkbenchScreen({ user }: { user: User }) {
  const { t } = usePortalI18n();
  const [samples, setSamples] = useState<SampleRow[] | null>(null);
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [open, setOpen] = useState<SampleDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [drawn, generated] = await Promise.all([
        api.get<{ samples: SampleRow[] }>('/government/audit/samples'),
        api.get<{ reports: ReportRow[] }>('/government/audit/reports'),
      ]);
      setSamples(drawn.samples);
      setReports(generated.reports);
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
      setSamples([]);
      setReports([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openSample = useCallback(async (id: string) => {
    setError(null);
    try {
      setOpen(await api.get<SampleDetail>(`/government/audit/samples/${id}`));
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    }
  }, []);

  const maySign = can('audit:sign');
  // Reports on this page whose stored rows no longer hash to their checksum.
  const altered = (reports ?? []).filter((row) => row.checksumMatches === false);

  return (
    <>
      <ErrorAlert error={error} />
      {notice && (
        <Alert kind="success">
          <p style={{ margin: 0 }}>{notice}</p>
        </Alert>
      )}

      <div className="stat-grid">
        <Stat label="ofcWbSamplesDrawn" value={String(samples?.length ?? 0)} />
        <Stat
          label="ofcWbItemsOutstanding"
          value={String((samples ?? []).reduce((total, row) => total + Number(row.pending), 0))}
        />
        <Stat
          label="ofcWbExceptionsFound"
          value={String((samples ?? []).reduce((total, row) => total + Number(row.exceptions), 0))}
          variant={
            (samples ?? []).some((row) => Number(row.exceptions) > 0) ? 'alert' : undefined
          }
        />
        <Stat label="ofcWbReportsHeld" value={String(reports?.length ?? 0)} />
      </div>

      <DrawForm
        onDrawn={async (message) => {
          setNotice(message);
          await load();
        }}
      />

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <div className="card__header">
            <h2 className="card__title">{t.ofcWbSamples}</h2>
            <p className="card__hint">{t.ofcWbSamplesHint}</p>
          </div>
        </div>
        {!samples ? (
          <Loading />
        ) : (
          <Table
            columns={[
              {
                key: 'sample_number',
                label: 'ofcWbSampleNumber',
                render: (row: SampleRow) => (
                  <button type="button" className="link" onClick={() => void openSample(row.id)}>
                    {row.sample_number}
                  </button>
                ),
              },
              { key: 'title', label: 'ofcWbTitle' },
              {
                key: 'method',
                label: 'ofcWbMethod',
                render: (row: SampleRow) => <Badge status={row.method} />,
              },
              {
                key: 'sample_size',
                label: 'ofcWbDrawn',
                numeric: true,
                render: (row: SampleRow) => `${row.sample_size} / ${row.population_size}`,
              },
              { key: 'pending', label: 'ofcWbPending', numeric: true },
              {
                key: 'exceptions',
                label: 'ofcWbExceptions',
                numeric: true,
                render: (row: SampleRow) =>
                  Number(row.exceptions) > 0 ? (
                    <strong className="danger-text">{row.exceptions}</strong>
                  ) : (
                    '0'
                  ),
              },
              {
                key: 'status',
                label: 'appStatus',
                render: (row: SampleRow) => <Badge status={row.status} />,
              },
              {
                key: 'drawn_at',
                label: 'ofcWbDrawnAt',
                render: (row: SampleRow) => formatDate(row.drawn_at),
              },
              { key: 'drawn_by_name', label: 'ofcWbDrawnBy' },
            ]}
            rows={samples}
            empty="ofcWbNoSamples"
          />
        )}
      </div>

      {open && (
        <SampleDetailPanel
          sample={open}
          onClose={() => setOpen(null)}
          onChanged={async (message) => {
            setNotice(message);
            await openSample(open.id);
            await load();
          }}
        />
      )}

      <GenerateForm
        onGenerated={async (message) => {
          setNotice(message);
          await load();
        }}
      />

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <div className="card__header">
            <h2 className="card__title">{t.ofcWbReports}</h2>
            <p className="card__hint">{t.ofcWbReportsHint}</p>
          </div>
        </div>
        {/*
          * Said once at the top, as well as marked in the row.
          *
          * A marker in a table cell is scrolled past, and this is the one thing
          * on the screen a reader must not miss: a signed government report
          * whose figures have been changed underneath the signature. If it is
          * only in the cell, the reader who most needs it is the one skimming.
          */}
        {altered.length > 0 && (
          <div style={{ padding: '0 18px 12px' }}>
            <Alert kind="error" title="ofcWbAlteredTitle">
              <p style={{ margin: 0 }}>
                {t.ofcWbAlteredBody.replace('{{n}}', String(altered.length))}
              </p>
            </Alert>
          </div>
        )}
        {!reports ? (
          <Loading />
        ) : (
          <Table
            columns={[
              { key: 'report_number', label: 'ofcWbReportNumber' },
              { key: 'title', label: 'ofcWbTitle' },
              {
                key: 'report_type',
                label: 'ofcWbReportType',
                render: (row: ReportRow) => <Badge status={row.report_type} />,
              },
              { key: 'row_count', label: 'ofcWbRows', numeric: true },
              {
                key: 'period',
                label: 'ofcWbPeriod',
                render: (row: ReportRow) =>
                  row.period_start
                    ? `${formatDate(row.period_start)} – ${formatDate(row.period_end)}`
                    : '—',
              },
              {
                key: 'status',
                label: 'appStatus',
                render: (row: ReportRow) => <Badge status={row.status} />,
              },
              {
                key: 'generated_at',
                label: 'ofcWbGeneratedAt',
                render: (row: ReportRow) => formatDate(row.generated_at),
              },
              { key: 'signed_by_name', label: 'ofcWbSignedBy', render: (row: ReportRow) => row.signed_by_name ?? '—' },
              {
                /*
                 * The checksum, shortened but shown.
                 *
                 * A reader needs to be able to compare it against the one on a
                 * printed copy; hiding it entirely would make the freeze an
                 * assertion the screen makes about itself.
                 */
                key: 'checksum',
                label: 'ofcWbChecksum',
                render: (row: ReportRow) =>
                  row.checksumMatches === false ? (
                    <span className="badge badge--danger">
                      <code>{row.checksum.slice(0, 12)}</code> {t.ofcWbAltered}
                    </span>
                  ) : (
                    <code>{row.checksum.slice(0, 12)}</code>
                  ),
              },
              {
                key: 'actions',
                label: 'ofcWbActions',
                render: (row: ReportRow) => (
                  <ReportActions
                    report={row}
                    user={user}
                    maySign={maySign}
                    onDone={async (message) => {
                      setNotice(message);
                      await load();
                    }}
                  />
                ),
              },
            ]}
            rows={reports}
            empty="ofcWbNoReports"
          />
        )}
      </div>
    </>
  );
}

// ===========================================================================
function DrawForm({ onDrawn }: { onDrawn: (message: string) => Promise<void> }) {
  const { t } = usePortalI18n();
  const [title, setTitle] = useState('');
  const [method, setMethod] = useState('RANDOM');
  const [size, setSize] = useState('40');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [minimum, setMinimum] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  return (
    <div className="card">
      <div className="card__header">
        <h2 className="card__title">{t.ofcWbDraw}</h2>
        <p className="card__hint">{t.ofcWbDrawHint}</p>
      </div>
      <ErrorAlert error={error} />
      <div className="form-grid">
        <label>
          {t.ofcWbTitle}
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          {t.ofcWbMethod}
          <select value={method} onChange={(event) => setMethod(event.target.value)}>
            <option value="RANDOM">{t.ofcWbMethodRandom}</option>
            <option value="SYSTEMATIC">{t.ofcWbMethodSystematic}</option>
            <option value="HIGHEST_VALUE">{t.ofcWbMethodHighestValue}</option>
          </select>
        </label>
        <label>
          {t.ofcWbSize}
          <input
            type="number"
            min={1}
            max={500}
            value={size}
            onChange={(event) => setSize(event.target.value)}
          />
        </label>
        <label>
          {t.ofcWbFrom}
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          {t.ofcWbTo}
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <label>
          {t.ofcWbMinimumNaira}
          <input
            type="number"
            min={0}
            value={minimum}
            onChange={(event) => setMinimum(event.target.value)}
          />
        </label>
      </div>
      {/*
        * Said before it is done, not after.
        *
        * The draw cannot be taken back, so the sentence that explains that
        * belongs beside the button rather than in a message once it is too
        * late to matter.
        */}
      <p className="muted">{t.ofcWbDrawIsFinal}</p>
      <button
        type="button"
        disabled={busy || title.trim().length < 5}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const result = await api.post<{ sampleNumber: string; sampleSize: number }>(
              '/government/audit/samples',
              {
                title: title.trim(),
                method,
                size: Number(size),
                criteria: {
                  from: from || null,
                  to: to || null,
                  minimumKobo: minimum ? String(Math.round(Number(minimum) * 100)) : null,
                },
              },
            );
            setTitle('');
            await onDrawn(
              t.ofcWbDrawnNotice
                .replace('{{number}}', result.sampleNumber)
                .replace('{{n}}', String(result.sampleSize)),
            );
          } catch (caught) {
            setError(caught instanceof ApiRequestError ? caught.error : null);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t.ofcWbDraw}
      </button>
    </div>
  );
}

// ===========================================================================
function SampleDetailPanel({
  sample,
  onClose,
  onChanged,
}: {
  sample: SampleDetail;
  onClose: () => void;
  onChanged: (message: string) => Promise<void>;
}) {
  const { t } = usePortalI18n();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  return (
    <div className="card card--flush">
      <div style={{ padding: '18px 18px 0' }}>
        <div className="card__header">
          <h2 className="card__title">
            {sample.sample_number} — {sample.title}
          </h2>
          <button type="button" className="small secondary" onClick={onClose}>
            {t.ofcWbClose}
          </button>
        </div>
        <ErrorAlert error={error} />
        {/*
          * The seed, on the page.
          *
          * This is what a reviewer needs to reproduce the draw, and a sample
          * whose seed is hidden is one nobody outside this screen can check.
          */}
        <dl className="kv-list">
          <dt>{t.ofcWbMethod}</dt>
          <dd>{sample.method}</dd>
          <dt>{t.ofcWbSeed}</dt>
          <dd><code>{sample.seed}</code></dd>
          <dt>{t.ofcWbPopulation}</dt>
          <dd>{sample.population_size.toLocaleString()}</dd>
          <dt>{t.ofcWbDrawnBy}</dt>
          <dd>{sample.drawn_by_name ?? '—'}</dd>
        </dl>
      </div>

      <Table
        columns={[
          { key: 'position', label: 'ofcWbPosition', numeric: true },
          { key: 'transaction_reference', label: 'ofcWbReference' },
          {
            key: 'transaction_at',
            label: 'ofcRhWhen',
            render: (row: SampleItem) => formatDate(row.transaction_at),
          },
          { key: 'taxpayer_name', label: 'ofcWbTaxpayer' },
          { key: 'lga_name', label: 'tpLgaShort' },
          { key: 'agent_code', label: 'ofcAgCode', render: (row: SampleItem) => row.agent_code ?? '—' },
          {
            key: 'total_amount_kobo',
            label: 'ofcWbAmount',
            numeric: true,
            render: (row: SampleItem) => <Money kobo={row.total_amount_kobo} />,
          },
          {
            key: 'outcome',
            label: 'ofcWbOutcome',
            render: (row: SampleItem) => <Badge status={row.outcome} />,
          },
          {
            key: 'finding',
            label: 'ofcWbFinding',
            render: (row: SampleItem) =>
              row.outcome === 'PENDING' ? (
                <FindingControl
                  itemId={row.id}
                  onDone={onChanged}
                />
              ) : (
                <span>{row.finding ?? '—'}</span>
              ),
          },
        ]}
        rows={sample.items}
        empty="ofcWbNoItems"
      />

      {sample.status !== 'COMPLETED' && (
        <div style={{ padding: '0 18px 18px' }}>
          <p className="muted">{t.ofcWbCompleteHint}</p>
          <input
            value={note}
            placeholder={t.ofcCwWhy}
            onChange={(event) => setNote(event.target.value)}
          />{' '}
          <ReasonRule value={note} minimum={10} />
          <button
            type="button"
            disabled={busy || note.trim().length < 10 || sample.pending > 0}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await api.post(`/government/audit/samples/${sample.id}/complete`, {
                  note: note.trim(),
                });
                await onChanged(t.ofcCwSaved);
              } catch (caught) {
                setError(caught instanceof ApiRequestError ? caught.error : null);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t.ofcWbComplete}
          </button>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
function FindingControl({
  itemId,
  onDone,
}: {
  itemId: string;
  onDone: (message: string) => Promise<void>;
}) {
  const { t } = usePortalI18n();
  const [outcome, setOutcome] = useState('CLEAN');
  const [finding, setFinding] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  return (
    <div>
      <ErrorAlert error={error} />
      <select value={outcome} onChange={(event) => setOutcome(event.target.value)}>
        <option value="CLEAN">{t.enumClean}</option>
        <option value="EXCEPTION">{t.enumException}</option>
        <option value="NOT_AVAILABLE">{t.enumNotAvailable}</option>
      </select>{' '}
      <input
        value={finding}
        placeholder={t.ofcWbFinding}
        onChange={(event) => setFinding(event.target.value)}
      />{' '}
      <button
        type="button"
        className="small"
        disabled={busy || (outcome === 'EXCEPTION' && finding.trim().length === 0)}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api.post(`/government/audit/samples/items/${itemId}/finding`, {
              outcome,
              finding: finding.trim() || null,
            });
            await onDone(t.ofcCwSaved);
          } catch (caught) {
            setError(caught instanceof ApiRequestError ? caught.error : null);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t.ofcWbRecord}
      </button>
    </div>
  );
}

// ===========================================================================
function GenerateForm({ onGenerated }: { onGenerated: (message: string) => Promise<void> }) {
  const { t } = usePortalI18n();
  const [reportType, setReportType] = useState<string>('TRANSACTION_AUDIT');
  const [title, setTitle] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  return (
    <div className="card">
      <div className="card__header">
        <h2 className="card__title">{t.ofcWbGenerate}</h2>
        <p className="card__hint">{t.ofcWbGenerateHint}</p>
      </div>
      <ErrorAlert error={error} />
      <div className="form-grid">
        <label>
          {t.ofcWbReportType}
          <select value={reportType} onChange={(event) => setReportType(event.target.value)}>
            {REPORT_TYPES.map((kind) => (
              <option key={kind} value={kind}>
                {kind.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.ofcWbTitle}
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          {t.ofcWbFrom}
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          {t.ofcWbTo}
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
      </div>
      <button
        type="button"
        disabled={busy || title.trim().length < 5}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const result = await api.post<{ reportNumber: string; rowCount: number }>(
              '/government/audit/reports',
              {
                reportType,
                title: title.trim(),
                parameters: { from: from || null, to: to || null },
              },
            );
            setTitle('');
            await onGenerated(
              t.ofcWbGenerated
                .replace('{{number}}', result.reportNumber)
                .replace('{{n}}', String(result.rowCount)),
            );
          } catch (caught) {
            setError(caught instanceof ApiRequestError ? caught.error : null);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t.ofcWbGenerate}
      </button>
    </div>
  );
}

// ===========================================================================
function ReportActions({
  report,
  user,
  maySign,
  onDone,
}: {
  report: ReportRow;
  user: User;
  maySign: boolean;
  onDone: (message: string) => Promise<void>;
}) {
  const { t } = usePortalI18n();
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState<'sign' | 'withdraw' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  if (report.status === 'WITHDRAWN') return <span className="muted">{report.withdrawn_reason}</span>;

  if (!open) {
    return (
      <>
        {maySign && report.status === 'GENERATED' && (
          <button type="button" className="small" onClick={() => setOpen('sign')}>
            {t.ofcWbSign}
          </button>
        )}{' '}
        <button type="button" className="small secondary" onClick={() => setOpen('withdraw')}>
          {t.ofcWbWithdraw}
        </button>
        {/*
          * The file comes from the frozen payload, not from a fresh query --
          * which is the whole point of the report being an object. The
          * reviewer who opens it in June gets the figures signed in March.
          */}
        <ExportButtons
          path={`/government/audit/reports/${report.id}/export`}
          filename={report.report_number.replace(/\//g, '-')}
        />
      </>
    );
  }

  return (
    <div>
      <ErrorAlert error={error} />
      <input
        value={reason}
        placeholder={t.ofcCwWhy}
        onChange={(event) => setReason(event.target.value)}
      />{' '}
      <ReasonRule value={reason} minimum={10} />
      <button
        type="button"
        className="small"
        disabled={busy || reason.trim().length < 10}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await stepUp('audit.report.sign', user.phone);
            /*
             * Both paths spelled out. `officer-actions-reachable.test.ts` reads
             * this file to check every officer endpoint has a way in, and a
             * path assembled from a variable is one it cannot credit.
             */
            if (open === 'sign') {
              await api.post(`/government/audit/reports/${report.id}/sign`, { note: reason.trim() });
            } else {
              await api.post(`/government/audit/reports/${report.id}/withdraw`, {
                reason: reason.trim(),
              });
            }
            setOpen(null);
            setReason('');
            await onDone(t.ofcCwSaved);
          } catch (caught) {
            setError(caught instanceof ApiRequestError ? caught.error : null);
          } finally {
            setBusy(false);
          }
        }}
      >
        {open === 'sign' ? t.ofcWbSign : t.ofcWbWithdraw}
      </button>
    </div>
  );
}
