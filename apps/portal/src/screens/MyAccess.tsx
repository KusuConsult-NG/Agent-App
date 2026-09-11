/**
 * Where this officer is signed in, and on what.
 *
 * `sessions` has held every sign-in since the platform's first migration --
 * device, address, when it was last used -- and no officer could look at their
 * own. The only control was "sign out everywhere", which is all-or-nothing and
 * belongs to the person who still has the password. An officer who left a
 * laptop signed in at a counter downstairs had no way to end that one session,
 * and no way to see it existed.
 *
 * WHY IT NEEDS NO PERMISSION
 *
 * The answer is about the person asking. Gating it would mean an officer whose
 * role somebody narrowed could no longer see their own open sessions, which is
 * exactly the officer most likely to need to look.
 *
 * WHAT AN ADMINISTRATOR SEES HERE
 *
 * The same screen, for somebody else, when they hold `user:manage` — and one
 * control an officer does not have: blocking a machine outright. That ends
 * every session it holds and stops it opening another, enforced at the
 * database rather than here, because the case it exists for is a laptop
 * already in somebody else's hands.
 *
 * That paragraph was false for as long as it had been written. This screen
 * fetched `/sessions/mine` and nothing else, so the only devices an
 * administrator could ever see were their own — and the only laptop they
 * could block was the one they were sitting at. `GET
 * /government/users/:id/sessions` existed, was permissioned on `user:manage`
 * and was listed in `API.md` the whole time, and no screen called it. It is
 * reached now from the officer list on `UserAccess`.
 *
 * Ended sessions stay listed and marked rather than disappearing. "I ended
 * that one on Tuesday" is what somebody checking their account needs to see,
 * and an administrator investigating needs it more.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, can, stepUp, type ApiError, type User } from '../lib/api';
import { Alert, Badge, ErrorAlert, Loading, ReasonRule, Table, formatDateTime } from '../ui';
import { usePortalI18n } from '../lib/i18n';

interface SessionRow {
  id: string;
  device_label: string | null;
  device_status: string | null;
  user_agent: string | null;
  ip_address: string | null;
  issued_at: string;
  last_used_at: string | null;
  expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  is_current: boolean;
}

interface DeviceRow {
  id: string;
  label: string | null;
  user_agent: string | null;
  first_seen_at: string;
  last_seen_at: string;
  status: string;
  blocked_at: string | null;
  block_reason: string | null;
  blocked_by_name: string | null;
  live_sessions: number;
}

export function MyAccessScreen({
  user,
  officer,
}: {
  user: User;
  /**
   * Somebody else's access, for an administrator looking at it.
   *
   * `GET /government/users/:id/sessions` has existed, been permissioned on
   * `user:manage` and been documented in `API.md` since this screen was
   * written, and no screen ever called it. This screen's own opening
   * paragraph says an administrator sees "the same screen, for somebody
   * else" — and it only ever fetched `/sessions/mine`.
   *
   * The consequence is not cosmetic. Blocking a machine is the one control
   * gated on `user:manage` here, and the case its own comment gives for it is
   * "a laptop already in somebody else's hands". With only the caller's own
   * devices ever loaded, the only machine an administrator could block was
   * their own.
   */
  officer?: { id: string; full_name: string } | null;
}) {
  const { t } = usePortalI18n();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /*
   * Kept apart from `error`, which belongs to the button somebody pressed.
   *
   * This read answered a failure with `setSessions([]); setDevices([])`, and
   * the two empty states are not blanks. They read:
   *
   *   "This account has never been signed in."
   *   "No machine has been recorded yet."
   *
   * On this screen, of all of them. Blocking a machine is the one control
   * gated on `user:manage` here, and the case for it — set down in the
   * comment above — is "a laptop already in somebody else's hands". So an
   * administrator opening somebody's access to revoke a machine, on a
   * connection that dropped, was told the account had never been used and no
   * machine existed. There is nothing to block, and nothing saying the
   * question had not been answered.
   */
  const [loadError, setLoadError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await api.get<{ sessions: SessionRow[]; devices: DeviceRow[] }>(
        officer ? `/government/users/${officer.id}/sessions` : '/government/sessions/mine',
      );
      setSessions(result.sessions);
      setDevices(result.devices);
    } catch (caught) {
      if (caught instanceof ApiRequestError) setLoadError(caught.error);
      else if (caught instanceof Error) {
        setLoadError({ code: 'CLIENT', message: caught.message, moneyStatus: 'NOT_APPLICABLE' });
      }
      // Unknown, not empty. An empty list here is a statement about somebody's
      // account that an administrator would act on.
      setSessions(null);
      setDevices(null);
    }
  }, [officer]);

  useEffect(() => {
    void load();
  }, [load]);

  const mayManage = can('user:manage');

  async function act(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
      setNotice(t.ofcCwSaved);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.error : null);
    }
  }

  return (
    <>
      <ErrorAlert error={error} />
      {notice && (
        <Alert kind="success">
          <p style={{ margin: 0 }}>{notice}</p>
        </Alert>
      )}

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <div className="card__header">
            <h2 className="card__title">
              {officer
                ? t.ofcUaAccessFor.replace('{{name}}', officer.full_name)
                : t.ofcAcSessions}
            </h2>
            <p className="card__hint">{t.ofcAcSessionsHint}</p>
          </div>
        </div>
        {loadError ? (
          <div style={{ padding: 18 }}>
            <ErrorAlert error={loadError} />
            <button type="button" className="secondary" onClick={() => void load()}>
              {t.actionTryAgain}
            </button>
          </div>
        ) : !sessions ? (
          <Loading />
        ) : (
          <Table
            columns={[
              {
                key: 'device_label',
                label: 'ofcAcDevice',
                render: (row: SessionRow) => (
                  <>
                    {row.device_label ?? t.ofcAcUnknownDevice}
                    {row.is_current && <> · <strong>{t.ofcAcThisOne}</strong></>}
                  </>
                ),
              },
              {
                key: 'ip_address',
                label: 'ofcAcAddress',
                render: (row: SessionRow) => row.ip_address ?? '—',
              },
              {
                key: 'issued_at',
                label: 'ofcAcSignedIn',
                render: (row: SessionRow) => formatDateTime(row.issued_at),
              },
              {
                key: 'last_used_at',
                label: 'ofcAcLastUsed',
                render: (row: SessionRow) =>
                  row.last_used_at ? formatDateTime(row.last_used_at) : '—',
              },
              {
                key: 'status',
                label: 'appStatus',
                render: (row: SessionRow) =>
                  row.revoked_at ? (
                    <span className="muted">
                      {t.ofcAcEnded} · {row.revoked_reason ?? ''}
                    </span>
                  ) : (
                    <Badge status="ACTIVE" />
                  ),
              },
              {
                key: 'actions',
                label: 'ofcWbActions',
                render: (row: SessionRow) =>
                  row.revoked_at ? null : (
                    <button
                      type="button"
                      className="small secondary"
                      onClick={() =>
                        act(async () => {
                          await api.post(`/government/sessions/${row.id}/end`, {
                            reason: 'Ended by the officer',
                          });
                        })
                      }
                    >
                      {/*
                        * Ending the session you are using is a legitimate
                        * thing to do — it is what "sign out of this browser"
                        * means — so it is offered, labelled for what it is.
                        */}
                      {row.is_current ? t.ofcAcEndThisOne : t.ofcAcEnd}
                    </button>
                  ),
              },
            ]}
            rows={sessions}
            empty="ofcAcNoSessions"
          />
        )}
      </div>

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <div className="card__header">
            <h2 className="card__title">{t.ofcAcDevices}</h2>
            <p className="card__hint">{t.ofcAcDevicesHint}</p>
          </div>
        </div>
        {loadError ? (
          <div style={{ padding: 18 }}>
            <ErrorAlert error={loadError} />
          </div>
        ) : !devices ? (
          <Loading />
        ) : (
          <Table
            columns={[
              {
                key: 'label',
                label: 'ofcAcDevice',
                render: (row: DeviceRow) => row.label ?? t.ofcAcUnknownDevice,
              },
              {
                key: 'first_seen_at',
                label: 'ofcAcFirstSeen',
                render: (row: DeviceRow) => formatDateTime(row.first_seen_at),
              },
              {
                key: 'last_seen_at',
                label: 'ofcAcLastSeen',
                render: (row: DeviceRow) => formatDateTime(row.last_seen_at),
              },
              { key: 'live_sessions', label: 'ofcAcLiveSessions', numeric: true },
              {
                key: 'status',
                label: 'appStatus',
                render: (row: DeviceRow) => <Badge status={row.status} />,
              },
              {
                key: 'actions',
                label: 'ofcWbActions',
                /*
                 * The control and the record, not one or the other.
                 *
                 * This was a ternary: an officer who could manage saw the
                 * button, and everybody else saw the reason. So the
                 * administrator with the authority to unblock a machine was
                 * the one person shown nothing about why it had been blocked —
                 * and neither of them ever saw who did it or when, though
                 * `blocked_at` and `blocked_by_name` are on the wire and
                 * declared on the row.
                 *
                 * Blocking ends every session and stops sign-in, which this
                 * screen's own comment calls a supervisory act. Reversing one
                 * is a decision, and a decision taken without the record is a
                 * guess.
                 *
                 * An officer still cannot set it on their own machines: that
                 * would let them lock themselves out of the only machine in
                 * the office.
                 */
                render: (row: DeviceRow) => (
                  <>
                    {mayManage && (
                      <BlockControl
                        device={row}
                        user={user}
                        onDone={async () => {
                          setNotice(t.ofcCwSaved);
                          await load();
                        }}
                      />
                    )}
                    {row.status === 'BLOCKED' && (
                      <p className="table__sub" style={{ margin: '4px 0 0' }}>
                        {row.block_reason}
                        {row.blocked_by_name && (
                          <>
                            {' · '}
                            {t.ofcAcBlockedBy}: {row.blocked_by_name}
                          </>
                        )}
                        {row.blocked_at && <> · {formatDateTime(row.blocked_at)}</>}
                      </p>
                    )}
                  </>
                ),
              },
            ]}
            rows={devices}
            empty="ofcAcNoDevices"
          />
        )}
      </div>
    </>
  );
}

// ===========================================================================
function BlockControl({
  device,
  user,
  onDone,
}: {
  device: DeviceRow;
  user: User;
  onDone: () => Promise<void>;
}) {
  const { t } = usePortalI18n();
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  if (!open) {
    return (
      <button type="button" className="small secondary" onClick={() => setOpen(true)}>
        {device.status === 'BLOCKED' ? t.ofcAcUnblock : t.ofcAcBlock}
      </button>
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
            await stepUp('user.role.change', user.phone);
            /*
             * Both paths spelled out. `officer-actions-reachable.test.ts` reads
             * this file to check every officer endpoint has a way in, and a
             * path assembled from a variable is one it cannot credit.
             */
            if (device.status === 'BLOCKED') {
              await api.post(`/government/devices/${device.id}/unblock`, { reason: reason.trim() });
            } else {
              await api.post(`/government/devices/${device.id}/block`, { reason: reason.trim() });
            }
            setOpen(false);
            setReason('');
            await onDone();
          } catch (caught) {
            setError(caught instanceof ApiRequestError ? caught.error : null);
          } finally {
            setBusy(false);
          }
        }}
      >
        {device.status === 'BLOCKED' ? t.ofcAcUnblock : t.ofcAcBlock}
      </button>
    </div>
  );
}
