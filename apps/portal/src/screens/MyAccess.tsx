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
 * Ended sessions stay listed and marked rather than disappearing. "I ended
 * that one on Tuesday" is what somebody checking their account needs to see,
 * and an administrator investigating needs it more.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, can, stepUp, type ApiError, type User } from '../lib/api';
import { Alert, Badge, ErrorAlert, Loading, Table, formatDateTime } from '../ui';
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

export function MyAccessScreen({ user }: { user: User }) {
  const { t } = usePortalI18n();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.get<{ sessions: SessionRow[]; devices: DeviceRow[] }>(
        '/government/sessions/mine',
      );
      setSessions(result.sessions);
      setDevices(result.devices);
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
      setSessions([]);
      setDevices([]);
    }
  }, []);

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
            <h2 className="card__title">{t.ofcAcSessions}</h2>
            <p className="card__hint">{t.ofcAcSessionsHint}</p>
          </div>
        </div>
        {!sessions ? (
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
        {!devices ? (
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
                render: (row: DeviceRow) =>
                  mayManage ? (
                    <BlockControl
                      device={row}
                      user={user}
                      onDone={async () => {
                        setNotice(t.ofcCwSaved);
                        await load();
                      }}
                    />
                  ) : (
                    /*
                     * An officer sees the block state on their own machines and
                     * cannot set it. Blocking ends sessions and stops sign-in,
                     * which is a supervisory act — and an officer who could
                     * block their own device could lock themselves out of the
                     * only machine in the office.
                     */
                    <span className="muted">
                      {row.status === 'BLOCKED' ? row.block_reason : ''}
                    </span>
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
