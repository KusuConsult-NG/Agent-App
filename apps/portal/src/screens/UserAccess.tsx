/**
 * What each officer is allowed to do.
 *
 * `STEP_UP_ACTIONS` has always named `user.role.change` and nothing performed
 * it: roles were set when a user was created and never moved, so an officer
 * promoted, transferred, or found to be doing something they should not could
 * be changed only by an UPDATE against the database.
 *
 * The screen is built around the two things an administrator has to see
 * before deciding. The role somebody holds, in the words the platform uses
 * for it — not a code — and what that role can actually do, because "auditor"
 * and "finance officer" are not self-explanatory to somebody choosing between
 * them at speed. An access decision made from a label alone is a guess.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, stepUp, type ApiError, type User } from '../lib/api';
import { Alert, Badge, ErrorAlert, Loading, Table, formatDateTime } from '../ui';

interface PortalUser {
  id: string;
  full_name: string;
  phone: string;
  role: string;
  status: string;
  last_login_at: string | null;
  isSelf: boolean;
}

/**
 * What each role is for, in one line.
 *
 * Deliberately about responsibilities rather than permission names: the
 * administrator choosing a role is deciding what somebody's job is, and
 * `approval:authorise` is not a job.
 */
const ROLE_SUMMARY: Record<string, string> = {
  admin: 'Administers agents, users and the revenue catalogue. Cannot authorise payouts.',
  supervisor: 'Authorises approvals and oversees agents in their territory.',
  revenue_officer: 'Registers and corrects taxpayer records, and reviews approvals.',
  finance_officer: 'Reconciles settlements and authorises commission payouts.',
  auditor: 'Reads everything and changes nothing.',
};

const ASSIGNABLE = ['admin', 'supervisor', 'revenue_officer', 'finance_officer', 'auditor'];

const readable = (role: string) => role.replace(/_/g, ' ');

type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

interface Territory {
  id: string;
  name: string;
  code: string;
  lga_name: string;
}

/**
 * The roles whose reports are narrowed to territories rather than the state.
 *
 * Everybody else holds `report:read:all` and sees everything, so offering them
 * a territory picker would imply a limit that does not apply. A supervisor is
 * currently the only such role; the list is here rather than inline so adding
 * the next one is a single edit.
 */
const TERRITORY_SCOPED_ROLES = ['supervisor'];

export function UserAccessScreen({ user }: { user: User }) {
  const [users, setUsers] = useState<PortalUser[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<PortalUser | null>(null);
  const [chosenRole, setChosenRole] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [coverage, setCoverage] = useState<PortalUser | null>(null);
  const [territories, setTerritories] = useState<{
    assigned: Territory[];
    available: Territory[];
  } | null>(null);
  const [chosenTerritories, setChosenTerritories] = useState<string[]>([]);
  const [coverageReason, setCoverageReason] = useState('');
  const [closing, setClosing] = useState<PortalUser | null>(null);
  const [chosenStatus, setChosenStatus] = useState<AccountStatus>('SUSPENDED');
  const [statusReason, setStatusReason] = useState('');

  const load = useCallback(() => {
    api
      .get<{ users: PortalUser[] }>('/government/users')
      .then((data) => setUsers(data.users))
      .catch((caught) => {
        setUsers([]);
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, []);

  useEffect(load, [load]);

  const blockedBecause = ((): string | null => {
    if (!chosenRole) return 'Choose the role this officer should hold.';
    if (editing && chosenRole === editing.role) {
      return `${editing.full_name} already holds the ${readable(chosenRole)} role.`;
    }
    if (reason.trim().length < 10) {
      return 'Say why this access is changing, in at least 10 characters. It is the only record of why.';
    }
    return null;
  })();

  async function submit() {
    if (!editing || blockedBecause) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      // A change of access is the action that turns one compromised session
      // into any level of access at all, so it needs a fresh code and not
      // merely a live session.
      await stepUp('user.role.change', user.phone);
      const result = await api.post<{ message: string }>(
        `/government/users/${editing.id}/role`,
        { role: chosenRole, reason: reason.trim() },
      );
      setMessage(result.message);
      setEditing(null);
      setChosenRole('');
      setReason('');
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

  /**
   * Closing an account, which is the half a role change could never cover.
   *
   * Every role can still sign in, so moving a departed officer to auditor left
   * them reading taxpayer records for as long as they kept the password. This
   * is the control that stops the sign-in itself, and it asks for the same
   * fresh code a role change does.
   */
  async function submitStatus() {
    if (!closing || statusReason.trim().length < 10) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await stepUp('user.role.change', user.phone);
      const result = await api.post<{ message: string }>(
        `/government/users/${closing.id}/status`,
        { status: chosenStatus, reason: statusReason.trim() },
      );
      setMessage(result.message);
      setClosing(null);
      setStatusReason('');
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

  function openCoverage(row: PortalUser) {
    setCoverage(row);
    setTerritories(null);
    setCoverageReason('');
    setMessage(null);
    api
      .get<{ assigned: Territory[]; available: Territory[] }>(
        `/government/users/${row.id}/territories`,
      )
      .then((data) => {
        setTerritories(data);
        setChosenTerritories(data.assigned.map((t) => t.id));
      })
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }

  async function submitCoverage() {
    if (!coverage || coverageReason.trim().length < 10) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.post<{ message: string }>(
        `/government/users/${coverage.id}/territories`,
        { territoryIds: chosenTerritories, reason: coverageReason.trim() },
      );
      setMessage(result.message);
      setCoverage(null);
      setTerritories(null);
      setCoverageReason('');
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  if (!users) return <Loading rows={5} />;

  return (
    <>
      <div className="card">
        <h2 className="card__title">Officer access</h2>
        <p className="card__hint">
          Changing a role signs the officer out of every device immediately, because their
          current access travels in the session they are holding. They sign in again with the
          new role. Agents are not listed: their access follows the clearance pipeline, not a
          role.
        </p>
      </div>

      <ErrorAlert error={error} />
      {message && <Alert kind="success">{message}</Alert>}

      {editing && (
        <div className="card">
          <h2 className="card__title">Change access — {editing.full_name}</h2>
          <p className="card__hint">
            Currently {readable(editing.role)}. {ROLE_SUMMARY[editing.role] ?? ''}
          </p>

          <div className="field">
            <label htmlFor="new-role">New role</label>
            <select
              id="new-role"
              value={chosenRole}
              onChange={(event) => setChosenRole(event.target.value)}
            >
              <option value="">Select a role</option>
              {ASSIGNABLE.map((role) => (
                <option key={role} value={role}>
                  {readable(role)}
                </option>
              ))}
            </select>
            {chosenRole && (
              <p className="field__hint">{ROLE_SUMMARY[chosenRole] ?? ''}</p>
            )}
          </div>

          <div className="field">
            <label htmlFor="role-reason">Why this is changing</label>
            <textarea
              id="role-reason"
              value={reason}
              rows={3}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Transferred to the audit office from 1 September."
            />
          </div>

          {blockedBecause && (
            <p className="card__hint" role="status" style={{ marginBottom: 0 }}>
              {blockedBecause}
            </p>
          )}

          <div className="button-row">
            <button type="button" disabled={busy || blockedBecause !== null} onClick={submit}>
              {busy ? 'Changing…' : 'Change access and sign them out'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setEditing(null);
                setChosenRole('');
                setReason('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {closing && (
        <div className="card">
          <h2 className="card__title">Account — {closing.full_name}</h2>
          <p className="card__hint">
            Suspending or closing an account signs the officer out everywhere and stops them
            signing in again. Suspension is a pause pending an answer; closing is the end of the
            appointment and cannot be undone — create a new account if they return.
          </p>

          <div className="field">
            <label htmlFor="new-status">New account status</label>
            <select
              id="new-status"
              value={chosenStatus}
              onChange={(event) => setChosenStatus(event.target.value as AccountStatus)}
            >
              <option value="SUSPENDED">Suspended — pending an enquiry</option>
              <option value="CLOSED">Closed — they have left the service</option>
              <option value="ACTIVE">Active — lift a suspension</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="status-reason">Why this is changing</label>
            <textarea
              id="status-reason"
              value={statusReason}
              rows={3}
              onChange={(event) => setStatusReason(event.target.value)}
              placeholder="Left the service at the end of the quarter."
            />
          </div>

          {chosenStatus === 'CLOSED' && (
            <Alert kind="warning" title="This cannot be undone">
              <p style={{ margin: 0 }}>
                A closed account can never be reopened. If {closing.full_name} returns to the
                service they will need a new account.
              </p>
            </Alert>
          )}

          <div className="button-row">
            <button
              type="button"
              disabled={busy || statusReason.trim().length < 10}
              onClick={submitStatus}
            >
              {busy
                ? 'Saving…'
                : chosenStatus === 'ACTIVE'
                  ? 'Let them sign in again'
                  : 'Sign them out and stop the account'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setClosing(null);
                setStatusReason('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {coverage && (
        <div className="card">
          <h2 className="card__title">Territories — {coverage.full_name}</h2>
          <p className="card__hint">
            A supervisor sees revenue for the territories assigned here and no others. With none
            assigned they see nothing at all — which is deliberate, so an account nobody has
            finished setting up is the least revealing one rather than the most.
          </p>

          {!territories ? (
            <Loading rows={3} />
          ) : (
            <>
              <div className="field">
                <span className="field__label">Territories covered</span>
                {territories.available.length === 0 ? (
                  <p className="field__hint">No active territory has been created yet.</p>
                ) : (
                  <ul className="list" style={{ maxHeight: 260, overflowY: 'auto' }}>
                    {territories.available.map((territory) => (
                      <li key={territory.id}>
                        <label className="list__item" style={{ cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={chosenTerritories.includes(territory.id)}
                            onChange={(event) =>
                              setChosenTerritories((current) =>
                                event.target.checked
                                  ? [...current, territory.id]
                                  : current.filter((id) => id !== territory.id),
                              )
                            }
                          />
                          <div className="list__body">
                            <p className="list__title">{territory.name}</p>
                            <p className="list__meta">
                              {territory.lga_name} · {territory.code}
                            </p>
                          </div>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="field">
                <label htmlFor="coverage-reason">Why this is changing</label>
                <textarea
                  id="coverage-reason"
                  value={coverageReason}
                  rows={3}
                  onChange={(event) => setCoverageReason(event.target.value)}
                  placeholder="Taking over the Jos North market round from 1 September."
                />
              </div>

              {chosenTerritories.length === 0 && (
                <Alert kind="warning" title="This will leave them covering nothing">
                  <p style={{ margin: 0 }}>
                    {coverage.full_name} will see no revenue figures at all until a territory is
                    assigned.
                  </p>
                </Alert>
              )}

              <div className="button-row">
                <button
                  type="button"
                  disabled={busy || coverageReason.trim().length < 10}
                  onClick={submitCoverage}
                >
                  {busy ? 'Saving…' : 'Save territories'}
                </button>
                <button type="button" className="secondary" onClick={() => setCoverage(null)}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="card card--flush">
        <Table
          columns={[
            { key: 'full_name', label: 'Officer' },
            { key: 'phone', label: 'Phone' },
            {
              key: 'role',
              label: 'Role',
              render: (row) => (
                <>
                  <Badge status={row.role.toUpperCase()} />{' '}
                  <span className="list__meta">{ROLE_SUMMARY[row.role] ?? ''}</span>
                </>
              ),
            },
            { key: 'status', label: 'Status', render: (row) => <Badge status={row.status} /> },
            {
              key: 'last_login_at',
              label: 'Last signed in',
              render: (row) => (row.last_login_at ? formatDateTime(row.last_login_at) : 'Never'),
            },
            {
              key: 'action',
              label: '',
              render: (row) =>
                row.isSelf ? (
                  // Greyed rather than hidden: an administrator looking for
                  // their own row should find it and see why it cannot be
                  // changed, instead of wondering where it went.
                  <span className="list__meta">Your own access</span>
                ) : (
                  <>
                    <button
                      type="button"
                      className="small secondary"
                      onClick={() => {
                        setEditing(row as PortalUser);
                        setChosenRole('');
                        setReason('');
                        setMessage(null);
                      }}
                    >
                      Change access
                    </button>{' '}
                    {TERRITORY_SCOPED_ROLES.includes(row.role) && (
                      <button
                        type="button"
                        className="small secondary"
                        onClick={() => openCoverage(row as PortalUser)}
                      >
                        Territories
                      </button>
                    )}{' '}
                    {row.status !== 'CLOSED' && (
                      <button
                        type="button"
                        className="small secondary"
                        onClick={() => {
                          setClosing(row as PortalUser);
                          setChosenStatus(row.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED');
                          setStatusReason('');
                          setMessage(null);
                        }}
                      >
                        Account
                      </button>
                    )}
                  </>
                ),
            },
          ]}
          rows={users}
          empty="No officers are recorded."
        />
      </div>
    </>
  );
}
