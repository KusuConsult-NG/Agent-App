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
  /*
   * Null is "not known", and it has to be distinguishable from zero.
   *
   * This counter used to start at 0 and stay there when the read failed, so a
   * refused request put the figure `0` under "Not yet read" -- and under
   * "Needing attention now", from a `critical` list derived off rows the
   * screen did not have. Neither is a missing answer. Both are answers.
   */
  const [unread, setUnread] = useState<number | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  /*
   * Kept apart from `error`, which belongs to the button somebody just
   * pressed. A failed mark-read is about that row; a failed load is about the
   * whole list, and the two want to be said in different places.
   */
  const [loadError, setLoadError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await api.get<{ notifications: Notification[]; unread: number }>(
        `/government/inbox?unreadOnly=${unreadOnly}`,
      );
      setRows(result.notifications);
      setUnread(result.unread);
    } catch (caught) {
      if (caught instanceof ApiRequestError) setLoadError(caught.error);
      else if (caught instanceof Error) {
        setLoadError({ code: 'CLIENT', message: caught.message, moneyStatus: 'NOT_APPLICABLE' });
      }
      /*
       * `setRows([])` printed "Nothing has been raised for you." This is the
       * screen the platform's own alarms arrive on -- a stalled job, a
       * collection that has stopped -- and that sentence is the one answer
       * that ends the reading. A list that could not be read is not an empty
       * list, and switching the filter is not a reason to keep showing rows
       * fetched under the other one.
       */
      setRows(null);
      setUnread(null);
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

      {/*
        * A dash where a figure is not known. Both of these used to read `0`
        * from a failed read -- and zero unread, zero needing attention, is
        * precisely the state an officer closes the screen on.
        */}
      <div className="stat-grid">
        <Stat
          label="ofcInUnread"
          value={unread === null ? '—' : String(unread)}
          variant={unread !== null && unread > 0 ? 'alert' : undefined}
        />
        <Stat label="ofcInCritical" value={rows === null ? '—' : String(critical.length)} />
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
              disabled={unread === null || unread === 0}
              onClick={() => act(async () => { await api.post('/government/inbox/read-all', {}); })}
            >
              {t.ofcInReadAll}
            </button>
          </div>
        </div>

        {loadError ? (
          /*
            In the table's place, because that is where the list would have
            been. Reloading the page was the only way out of this before, and
            the screen did not say so.
          */
          <div style={{ padding: 18 }}>
            <ErrorAlert error={loadError} />
            <button type="button" className="secondary" onClick={() => void load()}>
              {t.actionTryAgain}
            </button>
          </div>
        ) : !rows ? (
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
