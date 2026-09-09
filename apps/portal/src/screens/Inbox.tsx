/**
 * What this officer has been told, and what the platform is saying about
 * itself.
 *
 * `/my-work` answers "what is waiting for me" and answers it by asking, every
 * time. This is the other half: a record that somebody was told, which they
 * can mark read once they have dealt with it.
 *
 * The distinction matters on screen more than it does in the database. A work
 * queue that keeps showing an item until the underlying thing changes teaches
 * an officer to stop reading it; an inbox they can clear is one they will look
 * at tomorrow.
 *
 * TWO KINDS OF ROW
 *
 * Addressed to this officer, and addressed to their role. The second is how
 * the platform's own alarms arrive -- a background job that has stalled is a
 * fact about the platform rather than about anybody's case, and an alert with
 * one person's name on it goes unread exactly when that person is on leave.
 * Role rows are labelled as such, because "I read this" means something
 * different when a colleague is relying on you having done so.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, type ApiError } from '../lib/api';
import { Alert, Badge, ErrorAlert, Loading, Stat, Table, formatDateTime } from '../ui';
import { usePortalI18n } from '../lib/i18n';

interface Notification {
  id: string;
  kind: string;
  severity: string;
  subject: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
  read_at: string | null;
  read_by_name: string | null;
  addressed_to_role: string | null;
}

export function InboxScreen({ navigate }: { navigate: (path: string) => void }) {
  const { t } = usePortalI18n();
  const [rows, setRows] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.get<{ notifications: Notification[]; unread: number }>(
        `/government/inbox?unreadOnly=${unreadOnly}`,
      );
      setRows(result.notifications);
      setUnread(result.unread);
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
      setRows([]);
    }
  }, [unreadOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
      await load();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.error : null);
    }
  }

  const critical = (rows ?? []).filter(
    (row) => row.severity === 'CRITICAL' && !row.read_at,
  );

  return (
    <>
      <ErrorAlert error={error} />

      {/*
        * The platform's own alarms, said before the list rather than found in
        * it. An officer scanning a table of forty rows should not have to
        * notice that one of them says collection has stopped.
        */}
      {critical.length > 0 && (
        <Alert kind="error" title="ofcInCriticalTitle">
          <ul className="list">
            {critical.map((row) => (
              <li key={row.id}>{row.subject}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="stat-grid">
        <Stat label="ofcInUnread" value={String(unread)} variant={unread > 0 ? 'alert' : undefined} />
        <Stat label="ofcInCritical" value={String(critical.length)} />
      </div>

      <div className="card card--flush">
        <div style={{ padding: '18px 18px 0' }}>
          <div className="card__header">
            <h2 className="card__title">{t.ofcNavInbox}</h2>
            <p className="card__hint">{t.ofcInHint}</p>
          </div>
          <div>
            <button
              type="button"
              className="small secondary"
              onClick={() => setUnreadOnly((current) => !current)}
            >
              {unreadOnly ? t.ofcInShowAll : t.ofcInShowUnread}
            </button>{' '}
            <button
              type="button"
              className="small secondary"
              disabled={unread === 0}
              onClick={() => act(async () => { await api.post('/government/inbox/read-all', {}); })}
            >
              {t.ofcInReadAll}
            </button>
          </div>
        </div>

        {!rows ? (
          <Loading />
        ) : (
          <Table
            columns={[
              {
                key: 'severity',
                label: 'ofcInSeverity',
                render: (row: Notification) => <Badge status={row.severity} />,
              },
              {
                key: 'kind',
                label: 'ofcInKind',
                render: (row: Notification) => (
                  <>
                    <Badge status={row.kind} />
                    {row.addressed_to_role && (
                      <>
                        {' '}
                        <span className="muted">{t.ofcInToYourRole}</span>
                      </>
                    )}
                  </>
                ),
              },
              {
                key: 'subject',
                label: 'ofcInSubject',
                render: (row: Notification) =>
                  /*
                   * A notification about a case opens the case. One about a
                   * background job does not open anything: there is nowhere
                   * useful to send somebody, and a link that lands on a screen
                   * saying the same sentence again is worse than no link.
                   */
                  row.entity_type === 'case' ? (
                    <button
                      type="button"
                      className="link"
                      onClick={() => navigate(`/cases?open=${row.entity_id}`)}
                    >
                      {row.subject}
                    </button>
                  ) : (
                    <span>{row.subject}</span>
                  ),
              },
              {
                key: 'created_at',
                label: 'ofcInWhen',
                render: (row: Notification) => formatDateTime(row.created_at),
              },
              {
                key: 'read_at',
                label: 'ofcInRead',
                render: (row: Notification) =>
                  row.read_at ? (
                    <span className="muted">
                      {formatDateTime(row.read_at)} · {row.read_by_name ?? ''}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="small secondary"
                      onClick={() =>
                        act(async () => {
                          await api.post(`/government/inbox/${row.id}/read`, {});
                        })
                      }
                    >
                      {t.ofcInMarkRead}
                    </button>
                  ),
              },
            ]}
            rows={rows}
            empty="ofcInNothing"
          />
        )}
      </div>
    </>
  );
}
