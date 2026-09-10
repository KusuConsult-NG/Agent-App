/**
 * Departments, revenue offices, and where an officer is posted.
 *
 * The platform modelled the revenue service's work in detail and its structure
 * not at all. This is the structure: who works with whom, who answers for them,
 * and where they sit.
 *
 * WHY A DEPARTMENT AND A ROLE ARE BOTH HERE
 *
 * A role says what somebody may do; a department says who they work with and
 * who answers for them. PSIRS has two Assessment departments in different zones
 * whose officers hold identical permissions, and a case belonging to one should
 * not land in the other's queue — which is what routing by role could not
 * avoid. Both exist and neither replaces the other.
 *
 * The posting panel records each part that moved as its own dated transfer,
 * because "when did she move to Finance" and "when did he stop reporting to
 * Bala" are separate questions with separate answers, and a combined row makes
 * both a JSON dig.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, can, type ApiError, type User } from '../lib/api';
import { Alert, Badge, ErrorAlert, Loading, Table, formatDate } from '../ui';
import { usePortalI18n } from '../lib/i18n';
import { enumLabel, localName } from '@psirs/shared';

const FUNCTIONS = [
  'ASSESSMENT',
  'COLLECTION',
  'FINANCE',
  'AUDIT',
  'ENFORCEMENT',
  'TAXPAYER_SERVICES',
  'ADMINISTRATION',
  'TECHNOLOGY',
] as const;

interface Department {
  id: string;
  code: string;
  name: string;
  name_ha: string | null;
  description: string | null;
  function: string;
  status: string;
  parent_id: string | null;
  parent_name: string | null;
  head_name: string | null;
  head_user_id: string | null;
  officers: string;
  open_cases: string;
}

interface Office {
  id: string;
  code: string;
  name: string;
  name_ha: string | null;
  address: string | null;
  phone: string | null;
  status: string;
  lga_name: string;
  covers: string[];
  head_name: string | null;
  officers: string;
}

interface Officer {
  id: string;
  full_name: string;
  role: string;
  status: string;
  department_name?: string | null;
  job_title?: string | null;
}

export function OrganisationScreen({ user }: { user: User }) {
  const { t, lang } = usePortalI18n();
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [offices, setOffices] = useState<Office[] | null>(null);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState<'department' | 'office' | null>(null);

  /*
   * Declared before the effects that depend on it, and tested positively.
   *
   * `every-officer-can-work.test.ts` reads this file and asks whether every
   * role offered the screen can reach every endpoint it fetches. It recognises
   * a guard written as `if (flag)` — so an early `if (!can(...)) return` inside
   * the effect is invisible to it, and correctly so: a negated early return is
   * easy to delete later without anybody noticing the fetch became
   * unconditional.
   */
  const mayManage = can('user:manage');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [dept, office] = await Promise.all([
        api.get<Department[]>('/government/departments'),
        api.get<Office[]>('/government/offices'),
      ]);
      setDepartments(dept);
      setOffices(office);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.error : null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * The officer list, for naming a head and a supervisor.
   *
   * Only an administrator holds `user:manage`, and only an administrator can
   * change the structure — so the two gates line up and nobody else fetches a
   * staff list they cannot use. The other four roles open this screen to read
   * the chart, and ask for nothing they would be refused.
   */
  useEffect(() => {
    if (mayManage) {
      api
        .get<Officer[]>('/government/users')
        .then((rows) => setOfficers(rows.filter((row) => row.role !== 'agent')))
        .catch(() => setOfficers([]));
    }
  }, [mayManage]);

  return (
    <>
      <div className="card">
        <h2>{t.ofcOrTitle}</h2>
        <p className="muted">{t.ofcOrIntro}</p>
        <ErrorAlert error={error} />
        {notice && <Alert kind="success">{notice}</Alert>}
        {mayManage && (
          <div className="filters">
            <button type="button" onClick={() => setAdding(adding === 'department' ? null : 'department')}>
              {t.ofcOrNewDepartment}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setAdding(adding === 'office' ? null : 'office')}
            >
              {t.ofcOrNewOffice}
            </button>
          </div>
        )}
      </div>

      {adding === 'department' && (
        <DepartmentForm
          officers={officers}
          departments={departments ?? []}
          onDone={async (message) => {
            setAdding(null);
            setNotice(message);
            await load();
          }}
        />
      )}
      {adding === 'office' && (
        <OfficeForm
          officers={officers}
          onDone={async (message) => {
            setAdding(null);
            setNotice(message);
            await load();
          }}
        />
      )}

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <h3 className="card__title">{t.ofcOrDepartments}</h3>
        </div>
        {!departments ? (
          <div style={{ padding: '0 18px 18px' }}>
            <Loading />
          </div>
        ) : (
          <Table
            rows={departments}
            empty="ofcNoneDepartments"
            columns={[
              {
                key: 'name',
                label: 'ofcOrDepartments',
                render: (row: Department) => (
                  <>
                    <strong>{localName(lang, row.name, row.name_ha)}</strong>
                    <br />
                    <span className="muted">{row.code}</span>
                  </>
                ),
              },
              {
                key: 'function',
                label: 'ofcOrFunction',
                render: (row: Department) => enumLabel(row.function, t),
              },
              {
                key: 'head_name',
                label: 'ofcOrHead',
                render: (row: Department) =>
                  row.head_name ?? <span className="muted">{t.ofcOrNobody}</span>,
              },
              {
                key: 'parent_name',
                label: 'ofcOrParent',
                render: (row: Department) => row.parent_name ?? '—',
              },
              { key: 'officers', label: 'ofcOrOfficers', numeric: true },
              { key: 'open_cases', label: 'ofcOrOpenCases', numeric: true },
              {
                /*
                 * Closing is how a department ends.
                 *
                 * The server refuses while officers are still posted to it,
                 * because a closed department with people in it is a queue
                 * nobody reads that looks exactly like a working one.
                 */
                key: 'status',
                label: 'ofcCwStatus',
                render: (row: Department) =>
                  mayManage && row.status === 'ACTIVE' ? (
                    <CloseDepartmentButton
                      departmentId={row.id}
                      onDone={async (message) => {
                        setNotice(message);
                        await load();
                      }}
                    />
                  ) : (
                    <Badge status={row.status} />
                  ),
              },
            ]}
          />
        )}
      </div>

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <h3 className="card__title">{t.ofcOrOffices}</h3>
          <p className="card__hint">{t.ofcOrOfficesBody}</p>
        </div>
        {!offices ? (
          <div style={{ padding: '0 18px 18px' }}>
            <Loading />
          </div>
        ) : (
          <Table
            rows={offices}
            empty="ofcNoneOffices"
            columns={[
              {
                key: 'name',
                label: 'ofcOrOffices',
                render: (row: Office) => (
                  <>
                    <strong>{localName(lang, row.name, row.name_ha)}</strong>
                    <br />
                    <span className="muted">{row.code}</span>
                  </>
                ),
              },
              { key: 'lga_name', label: 'tpLgaShort' },
              {
                key: 'covers',
                label: 'ofcOrCovers',
                render: (row: Office) => row.covers.join(', ') || '—',
              },
              {
                key: 'head_name',
                label: 'ofcOrHead',
                render: (row: Office) =>
                  row.head_name ?? <span className="muted">{t.ofcOrNobody}</span>,
              },
              { key: 'officers', label: 'ofcOrOfficers', numeric: true },
            ]}
          />
        )}
      </div>
    </>
  );
}

// ===========================================================================
function CloseDepartmentButton({
  departmentId,
  onDone,
}: {
  departmentId: string;
  onDone: (message: string) => Promise<void>;
}) {
  const { t } = usePortalI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  return (
    <>
      <ErrorAlert error={error} />
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api.post(`/government/departments/${departmentId}/update`, {
              status: 'CLOSED',
            });
            await onDone(t.ofcCwSaved);
          } catch (caught) {
            setError(caught instanceof ApiRequestError ? caught.error : null);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t.ofcOrClose}
      </button>
    </>
  );
}

// ===========================================================================
function DepartmentForm({
  officers,
  departments,
  onDone,
}: {
  officers: Officer[];
  departments: Department[];
  onDone: (message: string) => Promise<void>;
}) {
  const { t } = usePortalI18n();
  const [form, setForm] = useState({
    code: '',
    name: '',
    function: 'ASSESSMENT',
    headUserId: '',
    parentId: '',
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="card">
      <h3>{t.ofcOrNewDepartment}</h3>
      <ErrorAlert error={error} />
      <div className="filters">
        <label>
          {t.ofcOrCode}
          <input
            value={form.code}
            onChange={(event) => setForm({ ...form, code: event.target.value })}
          />
        </label>
        <label>
          {t.ofcOrDepartments}
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </label>
        <label>
          {t.ofcOrFunction}
          <select
            value={form.function}
            onChange={(event) => setForm({ ...form, function: event.target.value })}
          >
            {FUNCTIONS.map((option) => (
              <option key={option} value={option}>
                {enumLabel(option, t)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.ofcOrHead}
          <select
            value={form.headUserId}
            onChange={(event) => setForm({ ...form, headUserId: event.target.value })}
          >
            <option value="">{t.ofcOrNobody}</option>
            {officers.map((officer) => (
              <option key={officer.id} value={officer.id}>
                {officer.full_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.ofcOrParent}
          <select
            value={form.parentId}
            onChange={(event) => setForm({ ...form, parentId: event.target.value })}
          >
            <option value="">—</option>
            {departments
              .filter((row) => row.status === 'ACTIVE')
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <button
        type="button"
        disabled={busy || form.code.trim().length < 2 || form.name.trim().length < 2}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api.post('/government/departments', {
              code: form.code.trim(),
              name: form.name.trim(),
              function: form.function,
              headUserId: form.headUserId || null,
              parentId: form.parentId || null,
            });
            await onDone(t.ofcCwSaved);
          } catch (caught) {
            setError(caught instanceof ApiRequestError ? caught.error : null);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? '…' : t.ofcOrNewDepartment}
      </button>
    </div>
  );
}

// ===========================================================================
function OfficeForm({
  officers,
  onDone,
}: {
  officers: Officer[];
  onDone: (message: string) => Promise<void>;
}) {
  const { t } = usePortalI18n();
  const [form, setForm] = useState({
    code: '',
    name: '',
    lgaId: '',
    address: '',
    phone: '',
    headUserId: '',
  });
  const [covers, setCovers] = useState<string[]>([]);
  const [lgas, setLgas] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ id: string; name: string }[]>('/reference/lgas')
      .then(setLgas)
      .catch(() => setLgas([]));
  }, []);

  return (
    <div className="card">
      <h3>{t.ofcOrNewOffice}</h3>
      <ErrorAlert error={error} />
      <div className="filters">
        <label>
          {t.ofcOrCode}
          <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        </label>
        <label>
          {t.ofcOrOffices}
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>
          {t.tpLgaShort}
          <select value={form.lgaId} onChange={(e) => setForm({ ...form, lgaId: e.target.value })}>
            <option value="">—</option>
            {lgas.map((lga) => (
              <option key={lga.id} value={lga.id}>
                {lga.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {/*
            * The office's own LGA is added by the server whether or not it is
            * ticked here. Leaving it out is the mistake half of callers make,
            * and the failure is silent.
            */}
          {t.ofcOrCovers}
          <select
            multiple
            value={covers}
            onChange={(event) =>
              setCovers(Array.from(event.target.selectedOptions).map((option) => option.value))
            }
          >
            {lgas.map((lga) => (
              <option key={lga.id} value={lga.id}>
                {lga.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.ofcOrHead}
          <select
            value={form.headUserId}
            onChange={(e) => setForm({ ...form, headUserId: e.target.value })}
          >
            <option value="">{t.ofcOrNobody}</option>
            {officers.map((officer) => (
              <option key={officer.id} value={officer.id}>
                {officer.full_name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        type="button"
        disabled={busy || !form.lgaId || form.code.trim().length < 2 || form.name.trim().length < 2}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api.post('/government/offices', {
              code: form.code.trim(),
              name: form.name.trim(),
              lgaId: form.lgaId,
              address: form.address.trim() || null,
              phone: form.phone.trim() || null,
              coversLgaIds: covers,
              headUserId: form.headUserId || null,
            });
            await onDone(t.ofcCwSaved);
          } catch (caught) {
            setError(caught instanceof ApiRequestError ? caught.error : null);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? '…' : t.ofcOrNewOffice}
      </button>
    </div>
  );
}

// ===========================================================================
interface Transfer {
  id: string;
  kind: string;
  from_value: unknown;
  to_value: unknown;
  reason: string;
  effective_from: string;
  recorded_by_name: string;
}

/**
 * One officer's posting, and the dated record of every move.
 *
 * Rendered on the officer access screen rather than here, because that is where
 * an administrator is standing when they need it — but it lives in this file
 * with the rest of the organisation.
 */
export function PostingPanel({
  officerId,
  onChanged,
}: {
  officerId: string;
  onChanged?: () => void | Promise<void>;
}) {
  const { t } = usePortalI18n();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [history, setHistory] = useState<Transfer[] | null>(null);
  const [form, setForm] = useState({
    departmentId: '',
    revenueOfficeId: '',
    supervisorId: '',
    jobTitle: '',
    staffNumber: '',
    reason: '',
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const mayManage = can('user:manage');

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await api.get<Transfer[]>(`/government/users/${officerId}/transfers`));
    } catch {
      setHistory([]);
    }
  }, [officerId]);

  useEffect(() => {
    if (mayManage) {
      void loadHistory();
      api
        .get<Department[]>('/government/departments')
        .then(setDepartments)
        .catch(() => setDepartments([]));
      api.get<Office[]>('/government/offices').then(setOffices).catch(() => setOffices([]));
      api
        .get<Officer[]>('/government/users')
        .then((rows) =>
          setOfficers(rows.filter((row) => row.role !== 'agent' && row.id !== officerId)),
        )
        .catch(() => setOfficers([]));
    }
  }, [officerId, loadHistory, mayManage]);

  if (!mayManage) return null;

  return (
    <div className="card">
      <h3>{t.ofcOrPosting}</h3>
      <p className="muted">{t.ofcOrPostingBody}</p>
      <ErrorAlert error={error} />
      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="filters">
        <label>
          {t.ofcOrDepartment}
          <select
            value={form.departmentId}
            onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
          >
            <option value="">{t.ofcOrUnposted}</option>
            {departments
              .filter((row) => row.status === 'ACTIVE')
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          {t.ofcOrOffice}
          <select
            value={form.revenueOfficeId}
            onChange={(e) => setForm({ ...form, revenueOfficeId: e.target.value })}
          >
            <option value="">{t.ofcOrUnposted}</option>
            {offices
              .filter((row) => row.status === 'ACTIVE')
              .map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          {t.ofcOrSupervisor}
          <select
            value={form.supervisorId}
            onChange={(e) => setForm({ ...form, supervisorId: e.target.value })}
          >
            <option value="">{t.ofcOrNobody}</option>
            {officers.map((officer) => (
              <option key={officer.id} value={officer.id}>
                {officer.full_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.ofcOrJobTitle}
          <input
            value={form.jobTitle}
            onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
          />
        </label>
        <label>
          {t.ofcOrStaffNumber}
          <input
            value={form.staffNumber}
            onChange={(e) => setForm({ ...form, staffNumber: e.target.value })}
          />
        </label>
      </div>

      <label>
        {t.ofcOrWhyMoving}
        <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
      </label>

      <button
        type="button"
        disabled={busy || form.reason.trim().length < 10}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            /*
             * Only the parts the administrator actually named.
             *
             * `repost` distinguishes an absent field from a null one, with a
             * `CASE WHEN $n::boolean` guard per column: absent leaves the
             * column alone, null clears it. This form starts empty — it is
             * never populated from the officer's current posting — and it
             * sent every key on every submit as `value || null`.
             *
             * So an administrator moving somebody to a new supervisor also
             * sent `departmentId: null`, `revenueOfficeId: null`,
             * `jobTitle: null` and `staffNumber: null`. Every one of those
             * fired its CASE and cleared the column. Changing one thing wiped
             * the other four, wrote a dated transfer for each of them
             * recording the officer being removed from their department, and
             * said "Saved".
             *
             * Absent now means unchanged, which is what an empty control on a
             * blank form means to the person looking at it. Clearing a
             * posting deliberately has no control on this screen and never
             * did — it only ever happened by accident, as a side effect of
             * changing something else.
             */
            await api.post(`/government/users/${officerId}/posting`, {
              ...(form.departmentId ? { departmentId: form.departmentId } : {}),
              ...(form.revenueOfficeId ? { revenueOfficeId: form.revenueOfficeId } : {}),
              ...(form.supervisorId ? { supervisorId: form.supervisorId } : {}),
              ...(form.jobTitle.trim() ? { jobTitle: form.jobTitle.trim() } : {}),
              ...(form.staffNumber.trim() ? { staffNumber: form.staffNumber.trim() } : {}),
              reason: form.reason.trim(),
            });
            setNotice(t.ofcCwSaved);
            await loadHistory();
            await onChanged?.();
          } catch (caught) {
            setError(caught instanceof ApiRequestError ? caught.error : null);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t.ofcOrMoveOfficer}
      </button>

      <h3>{t.ofcOrHistory}</h3>
      <p className="muted">{t.ofcOrHistoryBody}</p>
      {!history ? (
        <Loading rows={2} />
      ) : (
        <Table
          rows={history}
          empty="ofcNoneTransfers"
          columns={[
            {
              key: 'effective_from',
              label: 'ofcOrEffectiveFrom',
              render: (row: Transfer) => formatDate(row.effective_from),
            },
            {
              key: 'kind',
              label: 'ofcOrPosting',
              render: (row: Transfer) => enumLabel(row.kind, t),
            },
            { key: 'reason', label: 'ofcCwWhy' },
            { key: 'recorded_by_name', label: 'ofcTrRecordedBy' },
          ]}
        />
      )}
    </div>
  );
}
