/**
 * The work queue, and the case an officer works on it.
 *
 * Two screens and one shape. `/cases` is every case anybody can see, filtered;
 * `/cases?case=<id>` is one case with its whole history. `/my-work` is the
 * same material narrowed to the officer reading it, and lives in the same file
 * because it is the same data and would otherwise drift.
 *
 * WHAT THE SCREEN IS TRYING TO SAY
 *
 * A case is not a form. It is a conversation with a decision at the end of it,
 * and the thing that makes it worth having is that every step is kept — so the
 * history is the largest part of the detail view rather than a tab behind it.
 * The controls that move the case sit under the history, in the order somebody
 * actually uses them: read what happened, say something, then move it.
 *
 * The append-only note is printed rather than implied. An officer typing an
 * internal note about an agent should know before they type it that there is
 * no edit and no delete.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiRequestError, api, can, type ApiError, type User } from '../lib/api';
import { Alert, Badge, Empty, ErrorAlert, Loading, Money, Stat, Table, formatDate, formatDateTime } from '../ui';
import { usePortalI18n } from '../lib/i18n';
import { enumLabel } from '@psirs/shared';
import { queryParams } from '../router';

const CATEGORIES = [
  'GENERAL',
  'REVENUE_ANOMALY',
  'RECONCILIATION_EXCEPTION',
  'FRAUD_INVESTIGATION',
  'AGENT_CONDUCT',
  'TAXPAYER_DISPUTE',
  'COMMISSION_QUERY',
  'DATA_CORRECTION',
  'SYSTEM_ISSUE',
] as const;

const STATUSES = [
  'OPEN',
  'INVESTIGATING',
  'AWAITING_INFORMATION',
  'ESCALATED',
  'RESOLVED',
  'CLOSED',
] as const;

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
const RISKS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const DEPARTMENTS = [
  'supervisor',
  'revenue_officer',
  'finance_officer',
  'auditor',
  'admin',
] as const;

interface CaseRow {
  id: string;
  case_number: string;
  subject: string;
  category: string;
  status: string;
  priority: string;
  risk_level: string;
  department: string | null;
  due_at: string | null;
  created_at: string;
  overdue: boolean;
  assignee_name: string | null;
  opened_by_name: string | null;
  transaction_reference: string | null;
  agent_code: string | null;
  taxpayer_name: string | null;
  comment_count: string;
  evidence_count: string;
}

// ===========================================================================
export function CasesScreen({
  user,
  route,
  navigate,
}: {
  user: User;
  route: string;
  navigate: (path: string) => void;
}) {
  const params = queryParams(route);
  const openCaseId = params.get('case');
  /*
   * Arriving from a transaction, with the transaction already attached.
   *
   * "Open a case about this" on the transaction file is the shortest path
   * between noticing something and handing it to somebody, and it only works
   * if the link survives the trip. The reference comes along so the form can
   * say what it is about without a second fetch.
   */
  const about = params.get('about');
  const aboutReference = params.get('reference');

  return openCaseId ? (
    <CaseDetail caseId={openCaseId} user={user} navigate={navigate} />
  ) : (
    <CaseQueue
      user={user}
      navigate={navigate}
      about={about ? { transactionId: about, reference: aboutReference } : null}
    />
  );
}

// ===========================================================================
function CaseQueue({
  user,
  navigate,
  about,
}: {
  user: User;
  navigate: (path: string) => void;
  about: { transactionId: string; reference: string | null } | null;
}) {
  const { t } = usePortalI18n();
  const [rows, setRows] = useState<CaseRow[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [filters, setFilters] = useState({
    open: true,
    overdue: false,
    department: '',
    status: '',
    category: '',
  });
  const [opening, setOpening] = useState(about !== null);

  const load = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams();
    if (filters.open) params.set('open', 'true');
    if (filters.overdue) params.set('overdue', 'true');
    if (filters.department) params.set('department', filters.department);
    if (filters.status) params.set('status', filters.status);
    if (filters.category) params.set('category', filters.category);
    try {
      setRows(await api.get<CaseRow[]>(`/government/cases?${params.toString()}`));
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.error : null);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const list = rows ?? [];
    return {
      total: list.length,
      overdue: list.filter((row) => row.overdue).length,
      urgent: list.filter((row) => row.priority === 'URGENT').length,
      unassigned: list.filter((row) => !row.assignee_name).length,
    };
  }, [rows]);

  return (
    <>
      <div className="card">
        <h2>{t.ofcCwTitle}</h2>
        <p className="muted">{t.ofcCwIntro}</p>

        <div className="stat-grid">
          <Stat label="ofcCwCaseNumber" value={counts.total} />
          <Stat label="ofcMwOverdue" value={counts.overdue} variant={counts.overdue ? 'alert' : undefined} />
          <Stat label="ofcCwPriority" value={counts.urgent} />
          <Stat label="ofcCwNobody" value={counts.unassigned} />
        </div>

        <div className="filters">
          <label>
            {t.ofcCwDepartment}
            <select
              value={filters.department}
              onChange={(event) => setFilters({ ...filters, department: event.target.value })}
            >
              <option value="">{t.ofcAllStatuses}</option>
              {DEPARTMENTS.map((department) => (
                <option key={department} value={department}>
                  {t[`ofcUaRole${roleKey(department)}` as 'ofcUaRoleAdmin']}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.ofcCwStatus}
            <select
              value={filters.status}
              onChange={(event) => setFilters({ ...filters, status: event.target.value })}
            >
              <option value="">{t.ofcAllStatuses}</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {enumLabel(status, t)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t.ofcCwCategory}
            <select
              value={filters.category}
              onChange={(event) => setFilters({ ...filters, category: event.target.value })}
            >
              <option value="">{t.ofcAllStatuses}</option>
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {enumLabel(category, t)}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={filters.open}
              onChange={(event) => setFilters({ ...filters, open: event.target.checked })}
            />
            {t.ofcCwOnlyOpen}
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={filters.overdue}
              onChange={(event) => setFilters({ ...filters, overdue: event.target.checked })}
            />
            {t.ofcCwOnlyOverdue}
          </label>
          {can('case:create') && (
            <button type="button" onClick={() => setOpening((value) => !value)}>
              {t.ofcCwOpenCase}
            </button>
          )}
        </div>
      </div>

      {opening && (
        <OpenCaseForm
          user={user}
          about={about}
          onOpened={(id) => {
            setOpening(false);
            navigate(`/cases?case=${id}`);
          }}
        />
      )}

      <div className="card">
        <ErrorAlert error={error} />
        {!rows ? (
          <Loading />
        ) : (
          <Table
            rows={rows}
            empty="ofcNoneCasesMatchFilter"
            columns={[
              {
                key: 'case_number',
                label: 'ofcCwCaseNumber',
                render: (row: CaseRow) => (
                  <a href={`#/cases?case=${row.id}`}>
                    <strong>{row.case_number}</strong>
                    <br />
                    <span className="muted">{row.subject}</span>
                  </a>
                ),
              },
              {
                key: 'status',
                label: 'ofcSpTicket',
                render: (row: CaseRow) => <Badge status={row.status} />,
              },
              {
                key: 'priority',
                label: 'ofcCwPriority',
                render: (row: CaseRow) => (
                  <>
                    <Badge status={row.priority} />{' '}
                    <span className="muted">{enumLabel(row.risk_level, t)}</span>
                  </>
                ),
              },
              {
                key: 'assignee_name',
                label: 'ofcCwAssignee',
                render: (row: CaseRow) => row.assignee_name ?? <span className="muted">{t.ofcCwNobody}</span>,
              },
              {
                key: 'about',
                label: 'ofcCwAbout',
                render: (row: CaseRow) =>
                  row.transaction_reference ?? row.agent_code ?? row.taxpayer_name ?? '—',
              },
              {
                key: 'due_at',
                label: 'ofcCwDue',
                render: (row: CaseRow) =>
                  row.due_at ? (
                    <span className={row.overdue ? 'danger-text' : undefined}>
                      {formatDate(row.due_at)}
                    </span>
                  ) : (
                    '—'
                  ),
              },
            ]}
          />
        )}
      </div>
    </>
  );
}

/** `revenue_officer` → `RevenueOfficer`, to reach the dictionary's role keys. */
function roleKey(role: string): string {
  return role
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

// ===========================================================================
function OpenCaseForm({
  user,
  about,
  onOpened,
}: {
  user: User;
  about: { transactionId: string; reference: string | null } | null;
  onOpened: (id: string) => void;
}) {
  const { t } = usePortalI18n();
  const [form, setForm] = useState({
    subject: '',
    description: '',
    // A case raised from a transaction is almost always a query about one, so
    // the category starts there rather than at "general".
    category: about ? 'REVENUE_ANOMALY' : 'GENERAL',
    riskLevel: 'MEDIUM',
    priority: 'NORMAL',
    department: '',
    dueAt: '',
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const created = await api.post<{ id: string }>('/government/cases', {
        subject: form.subject.trim(),
        description: form.description.trim() || undefined,
        category: form.category,
        riskLevel: form.riskLevel,
        priority: form.priority,
        department: form.department || null,
        transactionId: about?.transactionId ?? null,
        dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null,
      });
      onOpened(created.id);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.error : null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>{t.ofcCwOpenCase}</h3>
      {about?.reference && (
        <p className="muted">
          {t.ofcCwAbout} <strong>{about.reference}</strong>
        </p>
      )}
      <ErrorAlert error={error} />
      <div className="filters">
        <label>
          {t.ofcCwSubject}
          <input
            value={form.subject}
            placeholder={t.ofcCwSampleSubject}
            onChange={(event) => setForm({ ...form, subject: event.target.value })}
          />
        </label>
        <label>
          {t.ofcCwDepartment}
          <select
            value={form.department}
            onChange={(event) => setForm({ ...form, department: event.target.value })}
          >
            <option value="">{t.ofcCwAnyDepartment}</option>
            {DEPARTMENTS.filter((department) => department !== user.role).map((department) => (
              <option key={department} value={department}>
                {t[`ofcUaRole${roleKey(department)}` as 'ofcUaRoleAdmin']}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.ofcCwCategory}
          <select
            value={form.category}
            onChange={(event) => setForm({ ...form, category: event.target.value })}
          >
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {enumLabel(category, t)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.ofcCwPriority}
          <select
            value={form.priority}
            onChange={(event) => setForm({ ...form, priority: event.target.value })}
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {enumLabel(priority, t)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.ofcCwRisk}
          <select
            value={form.riskLevel}
            onChange={(event) => setForm({ ...form, riskLevel: event.target.value })}
          >
            {RISKS.map((risk) => (
              <option key={risk} value={risk}>
                {enumLabel(risk, t)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.ofcCwDue}
          <input
            type="date"
            value={form.dueAt}
            onChange={(event) => setForm({ ...form, dueAt: event.target.value })}
          />
        </label>
      </div>
      <label>
        {t.ofcCwDescription}
        <textarea
          rows={4}
          value={form.description}
          placeholder={t.ofcCwSampleDescription}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
        />
      </label>
      <button type="button" disabled={busy || form.subject.trim().length < 5} onClick={submit}>
        {busy ? '…' : t.ofcCwOpenCase}
      </button>
      {form.subject.trim().length > 0 && form.subject.trim().length < 5 && (
        <p className="muted">{t.ofcCwSubjectTooShort}</p>
      )}
    </div>
  );
}

// ===========================================================================
interface CaseEvent {
  id: string;
  sequence_no: string;
  kind: string;
  body: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  document_number: string | null;
  document_type: string | null;
  created_at: string;
  actor_name: string;
  actor_role: string;
  mention_names: string[];
}

interface CaseDetailBody extends CaseRow {
  description: string;
  resolution: string | null;
  resolved_by_name: string | null;
  tin: string | null;
  lga_name: string | null;
  agent_name: string | null;
  subject_user_name: string | null;
  transaction_id: string | null;
  transaction_amount_kobo: string | null;
  transaction_status: string | null;
  may_work: boolean;
  events: CaseEvent[];
  /** Documents already on file for what this case is about; see the service. */
  attachable: { id: string; document_number: string; document_type: string; issued_at: string }[];
}

function CaseDetail({
  caseId,
  user,
  navigate,
}: {
  caseId: string;
  user: User;
  navigate: (path: string) => void;
}) {
  const { t } = usePortalI18n();
  const [detail, setDetail] = useState<CaseDetailBody | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [officers, setOfficers] = useState<{ id: string; full_name: string; role: string }[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await api.get<CaseDetailBody>(`/government/cases/${caseId}`));
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.error : null);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * The officer list, for assigning and for mentions.
   *
   * Only administrators hold `user:manage`, so everybody else works with the
   * names already on the case. That is a real limitation and it is better than
   * publishing the staff list to every role to make a dropdown nicer.
   */
  useEffect(() => {
    if (!can('user:manage')) return;
    api
      .get<{ id: string; full_name: string; role: string }[]>('/government/users')
      .then(setOfficers)
      .catch(() => setOfficers([]));
  }, []);

  if (error) return <div className="card"><ErrorAlert error={error} /></div>;
  if (!detail) return <div className="card"><Loading /></div>;

  return (
    <>
      <div className="card">
        <p>
          <a href="#/cases">← {t.ofcCwBackToQueue}</a>
        </p>
        <h2>
          {detail.case_number} · {detail.subject}
        </h2>
        <p className="muted">
          {t.ofcCwOpenedBy} {detail.opened_by_name} · {formatDateTime(detail.created_at)}
        </p>

        <div className="stat-grid">
          <Stat label="ofcCwStatus" value={<Badge status={detail.status} />} />
          <Stat label="ofcCwPriority" value={<Badge status={detail.priority} />} />
          <Stat label="ofcCwRisk" value={<Badge status={detail.risk_level} />} />
          <Stat
            label="ofcCwDue"
            value={detail.due_at ? formatDate(detail.due_at) : '—'}
            variant={detail.overdue ? 'alert' : undefined}
          />
        </div>

        {detail.description && <p>{detail.description}</p>}

        <dl className="kv-list">
          <dt>{t.ofcCwAssignee}</dt>
          <dd>{detail.assignee_name ?? t.ofcCwNobody}</dd>
          <dt>{t.ofcCwDepartment}</dt>
          <dd>
            {detail.department
              ? t[`ofcUaRole${roleKey(detail.department)}` as 'ofcUaRoleAdmin']
              : t.ofcCwAnyDepartment}
          </dd>
          <dt>{t.ofcCwCategory}</dt>
          <dd>{enumLabel(detail.category, t)}</dd>
          {detail.transaction_reference && (
            <>
              <dt>{t.ofcSearchTransaction}</dt>
              <dd>
                <a href={`#/transaction/${detail.transaction_id}`}>{detail.transaction_reference}</a>{' '}
                <Money kobo={detail.transaction_amount_kobo} />
              </dd>
            </>
          )}
          {detail.agent_code && (
            <>
              <dt>{t.ofcSearchAgent}</dt>
              <dd>
                {detail.agent_code} · {detail.agent_name}
              </dd>
            </>
          )}
          {detail.taxpayer_name && (
            <>
              <dt>{t.ofcSearchTaxpayer}</dt>
              <dd>
                {detail.taxpayer_name}
                {detail.tin ? ` · ${detail.tin}` : ''}
              </dd>
            </>
          )}
        </dl>

        {detail.resolution && (
          <Alert kind="success" title="ofcCwResolution">
            <p>{detail.resolution}</p>
            <p className="muted">{detail.resolved_by_name}</p>
          </Alert>
        )}
      </div>

      <div className="card">
        <h3>{t.ofcCwHistory}</h3>
        <p className="muted">{t.ofcCwAppendOnly}</p>
        <ol className="thread">
          {detail.events.map((event) => (
            <li key={event.id} className={`thread__item thread__item--${event.kind.toLowerCase()}`}>
              <p className="thread__meta">
                <strong>{event.actor_name}</strong>{' '}
                <span className="muted">{enumLabel(event.actor_role, t)}</span>{' '}
                <span className="muted">{formatDateTime(event.created_at)}</span>{' '}
                <Badge status={event.kind} />
              </p>
              {event.body && <p className="thread__body">{event.body}</p>}
              {event.document_number && (
                <p className="muted">
                  {t.ofcCwEvidence}: {event.document_number} ·{' '}
                  {enumLabel(event.document_type, t)}
                </p>
              )}
              {event.mention_names.length > 0 && (
                <p className="muted">@ {event.mention_names.join(', ')}</p>
              )}
              {(event.old_value || event.new_value) && (
                <p className="muted">
                  {t.ofcT3Before}: {describe(event.old_value)} → {t.ofcT3After}:{' '}
                  {describe(event.new_value)}
                </p>
              )}
            </li>
          ))}
        </ol>
      </div>

      {notice && (
        <div className="card">
          <Alert kind="success">{notice}</Alert>
        </div>
      )}

      {!['RESOLVED', 'CLOSED'].includes(detail.status) && can('case:contribute') && (
        <CaseControls
          detail={detail}
          officers={officers}
          onDone={async (message) => {
            setNotice(message);
            await load();
          }}
        />
      )}
    </>
  );
}

/** A before/after value, printed as the words an officer would say. */
function describe(value: Record<string, unknown> | null): string {
  if (!value) return '—';
  return Object.entries(value)
    .map(([key, entry]) => `${key.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${entry ?? '—'}`)
    .join(', ');
}

// ===========================================================================
function CaseControls({
  detail,
  officers,
  onDone,
}: {
  detail: CaseDetailBody;
  officers: { id: string; full_name: string; role: string }[];
  onDone: (message: string) => Promise<void>;
}) {
  const { t } = usePortalI18n();
  const [comment, setComment] = useState('');
  const [internal, setInternal] = useState(false);
  const [mentions, setMentions] = useState<string[]>([]);
  const [status, setStatus] = useState(detail.status);
  const [priority, setPriority] = useState(detail.priority);
  const [dueAt, setDueAt] = useState(detail.due_at ? detail.due_at.slice(0, 10) : '');
  const [evidence, setEvidence] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [resolution, setResolution] = useState('');
  const [assignee, setAssignee] = useState(detail.assignee_name ? '' : '');
  const [department, setDepartment] = useState(detail.department ?? '');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>, message: string) {
    setError(null);
    setBusy(true);
    try {
      await action();
      await onDone(message);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.error : null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <ErrorAlert error={error} />
      {!detail.may_work && <Alert kind="info">{t.ofcCwNotYours}</Alert>}

      <h3>{t.ofcCwAddComment}</h3>
      <textarea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} />
      <label className="checkbox">
        <input
          type="checkbox"
          checked={internal}
          onChange={(event) => setInternal(event.target.checked)}
        />
        {t.ofcCwInternalNote}
      </label>
      {officers.length > 0 && (
        <label>
          {t.ofcCwMention}
          <select
            multiple
            value={mentions}
            onChange={(event) =>
              setMentions(Array.from(event.target.selectedOptions).map((option) => option.value))
            }
          >
            {officers.map((officer) => (
              <option key={officer.id} value={officer.id}>
                {officer.full_name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        disabled={busy || comment.trim().length === 0}
        onClick={() =>
          run(async () => {
            await api.post(`/government/cases/${detail.id}/comments`, {
              body: comment.trim(),
              internal,
              mentions,
            });
            setComment('');
            setMentions([]);
          }, t.ofcCwSaved)
        }
      >
        {t.ofcCwPost}
      </button>

      {/*
        * Evidence, drawn from what is already on file.
        *
        * There is no officer upload path on this platform — every document is
        * minted by the service that issued it — so attaching evidence means
        * pointing at a receipt, an invoice or a vehicle's papers that already
        * belong to what the case is about. The list comes from the
        * server for that reason: an officer working a case does not get a
        * search across every document the State holds.
        */}
      {(detail.attachable ?? []).length > 0 && (
        <>
          <h3>{t.ofcCwEvidence}</h3>
          <div className="filters">
            <label>
              {t.ofcCwEvidence}
              <select value={evidence} onChange={(event) => setEvidence(event.target.value)}>
                <option value="">—</option>
                {detail.attachable.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.document_number} ·{' '}
                    {enumLabel(document.document_type, t)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.ofcCwWhy}
              <input
                value={evidenceNote}
                onChange={(event) => setEvidenceNote(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy || !evidence}
              onClick={() =>
                run(async () => {
                  await api.post(`/government/cases/${detail.id}/evidence`, {
                    documentId: evidence,
                    body: evidenceNote.trim() || undefined,
                  });
                  setEvidence('');
                  setEvidenceNote('');
                }, t.ofcCwSaved)
              }
            >
              {t.ofcCwEvidence}
            </button>
          </div>
        </>
      )}

      {detail.may_work && (
        <>
          <h3>{t.ofcCwPriority}</h3>
          <div className="filters">
            <label>
              {t.ofcCwPriority}
              <select value={priority} onChange={(event) => setPriority(event.target.value)}>
                {PRIORITIES.map((option) => (
                  <option key={option} value={option}>
                    {enumLabel(option, t)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.ofcCwDue}
              <input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.post(`/government/cases/${detail.id}/priority`, {
                    priority,
                    dueAt: dueAt ? new Date(dueAt).toISOString() : null,
                  });
                }, t.ofcCwSaved)
              }
            >
              {t.ofcCwPriority}
            </button>
          </div>

          <h3>{t.ofcCwChangeStatus}</h3>
          <div className="filters">
            <label>
              {t.ofcCwStatus}
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                {STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {enumLabel(option, t)}
                  </option>
                ))}
              </select>
            </label>
            {status === 'RESOLVED' && (
              <label>
                {t.ofcCwResolution}
                <textarea
                  rows={3}
                  value={resolution}
                  onChange={(event) => setResolution(event.target.value)}
                />
              </label>
            )}
          </div>
          {status === 'RESOLVED' && resolution.trim().length === 0 && (
            <p className="muted">{t.ofcCwResolutionRequired}</p>
          )}
          <button
            type="button"
            disabled={
              busy || status === detail.status || (status === 'RESOLVED' && !resolution.trim())
            }
            onClick={() =>
              run(async () => {
                await api.post(`/government/cases/${detail.id}/status`, {
                  status,
                  resolution: status === 'RESOLVED' ? resolution.trim() : undefined,
                });
              }, t.ofcCwSaved)
            }
          >
            {t.ofcCwChangeStatus}
          </button>

          <h3>{t.ofcCwMoveCase}</h3>
          <div className="filters">
            {officers.length > 0 && (
              <label>
                {t.ofcCwAssignee}
                <select value={assignee} onChange={(event) => setAssignee(event.target.value)}>
                  <option value="">{t.ofcCwNobody}</option>
                  {officers.map((officer) => (
                    <option key={officer.id} value={officer.id}>
                      {officer.full_name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              {t.ofcCwDepartment}
              <select value={department} onChange={(event) => setDepartment(event.target.value)}>
                <option value="">{t.ofcCwAnyDepartment}</option>
                {DEPARTMENTS.map((option) => (
                  <option key={option} value={option}>
                    {t[`ofcUaRole${roleKey(option)}` as 'ofcUaRoleAdmin']}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.post(`/government/cases/${detail.id}/assign`, {
                  assigneeId: assignee || null,
                  department: department || null,
                });
              }, t.ofcCwSaved)
            }
          >
            {t.ofcCwMoveCase}
          </button>
        </>
      )}
    </div>
  );
}

// ===========================================================================
interface MyWork {
  counts: Record<string, string>;
  assigned: CaseRow[];
  opened: CaseRow[];
  mentions: { case_id: string; case_number: string; subject: string; body: string; actor_name: string; created_at: string }[];
  unassigned: CaseRow[];
  approvals: { id: string; approval_type: string; status: string; requested_at: string; requested_by_name: string | null }[];
  exceptions: { id: string; status: string; variance_kobo: string; transaction_reference: string | null }[];
  flags: { id: string; rule: string; severity: string; agent_code: string | null; agent_name: string | null }[];
}

/**
 * One screen instead of six.
 *
 * The queues below already existed and each lived somewhere else — cases here,
 * approvals on the approvals screen, exceptions on reconciliation, flags on
 * fraud. An officer had to visit all of them to find out whether any of them
 * wanted something, which is how a reconciliation exception sits for a week.
 *
 * Each block keeps the gate its own screen has; the server decides which ones
 * to send, and a role that holds nothing for a block gets an empty array and no
 * heading.
 */
export function MyWorkScreen({ user }: { user: User }) {
  const { t } = usePortalI18n();
  const [work, setWork] = useState<MyWork | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    api
      .get<MyWork>('/government/my-work')
      .then(setWork)
      .catch((caught) =>
        setError(caught instanceof ApiRequestError ? caught.error : null),
      );
  }, []);

  if (error) return <div className="card"><ErrorAlert error={error} /></div>;
  if (!work) return <div className="card"><Loading /></div>;

  const nothing =
    work.assigned.length === 0 &&
    work.opened.length === 0 &&
    work.mentions.length === 0 &&
    work.unassigned.length === 0 &&
    work.approvals.length === 0 &&
    work.exceptions.length === 0 &&
    work.flags.length === 0;

  return (
    <>
      <div className="card">
        <h2>{t.ofcNavMyWork}</h2>
        <p className="muted">{t.ofcMwIntro}</p>
        <div className="stat-grid">
          <Stat label="ofcMwAssigned" value={work.counts.assigned_open ?? '0'} />
          <Stat
            label="ofcMwOverdue"
            value={work.counts.assigned_overdue ?? '0'}
            variant={Number(work.counts.assigned_overdue ?? 0) > 0 ? 'alert' : undefined}
          />
          <Stat label="ofcMwDepartment" value={work.counts.department_unassigned ?? '0'} />
          <Stat label="ofcMwMentions" value={work.counts.mentions ?? '0'} />
        </div>
        {nothing && <Alert kind="success">{t.ofcMwNothing}</Alert>}
        <p>
          <a href="#/cases">{t.ofcMwOpenQueue} →</a>
        </p>
      </div>

      {work.assigned.length > 0 && (
        <CaseBlock title={t.ofcMwAssigned} body={t.ofcMwAssignedBody} rows={work.assigned} />
      )}
      {work.unassigned.length > 0 && (
        <CaseBlock title={t.ofcMwDepartment} body={t.ofcMwDepartmentBody} rows={work.unassigned} />
      )}

      {work.mentions.length > 0 && (
        <div className="card">
          <h3>{t.ofcMwMentions}</h3>
          <p className="muted">{t.ofcMwMentionsBody}</p>
          <ul className="list">
            {work.mentions.map((mention) => (
              <li key={mention.case_id}>
                <a href={`#/cases?case=${mention.case_id}`}>
                  <strong>{mention.case_number}</strong> {mention.subject}
                </a>
                <p className="muted">
                  {mention.actor_name} · {formatDateTime(mention.created_at)}
                </p>
                <p>{mention.body}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {work.opened.length > 0 && (
        <CaseBlock title={t.ofcMwOpened} body={t.ofcMwOpenedBody} rows={work.opened} />
      )}

      {work.approvals.length > 0 && (
        <div className="card">
          <h3>{t.ofcMwApprovals}</h3>
          <Table
            rows={work.approvals}
            columns={[
              { key: 'approval_type', label: 'ofcOvAction' },
              { key: 'requested_by_name', label: 'ofcFnRequestedBy' },
              {
                key: 'requested_at',
                label: 'ofcRhWhen',
                render: (row) => formatDateTime(row.requested_at),
              },
              { key: 'status', label: 'ofcSpTicket', render: (row) => <Badge status={row.status} /> },
            ]}
          />
          <p>
            <a href="#/approvals">{t.ofcNavApprovals} →</a>
          </p>
        </div>
      )}

      {work.exceptions.length > 0 && (
        <div className="card">
          <h3>{t.ofcMwExceptions}</h3>
          <Table
            rows={work.exceptions}
            columns={[
              {
                key: 'transaction_reference',
                label: 'ofcSearchTransaction',
                render: (row) =>
                  row.transaction_reference ? (
                    <a href={`#/transaction/${row.transaction_reference}`}>
                      {row.transaction_reference}
                    </a>
                  ) : (
                    '—'
                  ),
              },
              { key: 'status', label: 'ofcSpTicket', render: (row) => <Badge status={row.status} /> },
              {
                key: 'variance_kobo',
                label: 'ofcFnVariance',
                numeric: true,
                render: (row) => <Money kobo={row.variance_kobo} />,
              },
            ]}
          />
          <p>
            <a href="#/reconciliation">{t.ofcNavReconciliation} →</a>
          </p>
        </div>
      )}

      {work.flags.length > 0 && (
        <div className="card">
          <h3>{t.ofcMwFlags}</h3>
          <Table
            rows={work.flags}
            columns={[
              { key: 'rule', label: 'ofcAgSignal' },
              {
                key: 'severity',
                label: 'ofcAgSeverity',
                render: (row) => <Badge status={row.severity} />,
              },
              {
                key: 'agent_code',
                label: 'ofcSearchAgent',
                render: (row) => (row.agent_code ? `${row.agent_code} · ${row.agent_name}` : '—'),
              },
            ]}
          />
          <p>
            <a href="#/fraud">{t.ofcNavFraud} →</a>
          </p>
        </div>
      )}
    </>
  );
}

function CaseBlock({ title, body, rows }: { title: string; body: string; rows: CaseRow[] }) {
  const { t } = usePortalI18n();
  return (
    <div className="card">
      <h3>{title}</h3>
      <p className="muted">{body}</p>
      {rows.length === 0 ? (
        <Empty>{t.ofcNoneCasesMatchFilter}</Empty>
      ) : (
        <Table
          rows={rows}
          columns={[
            {
              key: 'case_number',
              label: 'ofcCwCaseNumber',
              render: (row: CaseRow) => (
                <a href={`#/cases?case=${row.id}`}>
                  <strong>{row.case_number}</strong>
                  <br />
                  <span className="muted">{row.subject}</span>
                </a>
              ),
            },
            {
              key: 'status',
              label: 'ofcSpTicket',
              render: (row: CaseRow) => <Badge status={row.status} />,
            },
            {
              key: 'priority',
              label: 'ofcCwPriority',
              render: (row: CaseRow) => <Badge status={row.priority} />,
            },
            {
              key: 'due_at',
              label: 'ofcCwDue',
              render: (row: CaseRow) =>
                row.due_at ? (
                  <span className={row.overdue ? 'danger-text' : undefined}>
                    {formatDate(row.due_at)}
                  </span>
                ) : (
                  '—'
                ),
            },
          ]}
        />
      )}
    </div>
  );
}
