/**
 * The support desk (PRD §77, §78).
 *
 * The tickets table, the three endpoints and the categories all existed; no
 * screen in the portal mentioned them, so a complaint raised by an agent went
 * into a table nobody could open. `ticket_messages` had never been written to,
 * which meant a ticket could change status but nobody could answer it — and a
 * status change is not an answer.
 *
 * Two things this screen is careful about:
 *
 *   * The queue is ordered by priority, not recency. UNAUTHORISED_CHARGE and
 *     AGENT_MISCONDUCT are complaints about the collection itself, and burying
 *     them under a week of technical issues is how they stop being answered.
 *
 *   * A reply and an internal note are different buttons, worded differently,
 *     because sending one as the other is the mistake with the worst
 *     consequences available here.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, can, type ApiError } from '../lib/api';
import { Alert, Badge, Empty, ErrorAlert, KeyValue, Loading, Table, formatDateTime } from '../ui';
import { usePortalI18n } from '../lib/i18n';

interface TicketSummary {
  id: string;
  ticket_number: string;
  category: string;
  subject: string;
  status: string;
  priority: string;
  created_at: string;
  raised_by_name: string;
  raiser_role: string;
  assigned_to_name: string | null;
  transaction_reference: string | null;
  message_count: number;
  last_message_at: string | null;
}

interface TicketDetail extends TicketSummary {
  description: string;
  resolution: string | null;
  raised_by_phone: string;
  total_amount_kobo: string | null;
  messages: {
    id: string;
    body: string;
    internal: boolean;
    created_at: string;
    author_name: string;
    author_role: string;
    mine: boolean;
  }[];
}

const humanise = (value: string) => value.replace(/_/g, ' ').toLowerCase();

/** Complaints about the collection itself, which need to be seen as such. */
const CONDUCT_CATEGORIES = new Set(['AGENT_MISCONDUCT', 'UNAUTHORISED_CHARGE']);

export function SupportScreen({ navigate }: { navigate: (path: string) => void }) {
  const { t } = usePortalI18n();
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(() => {
    setTickets(null);
    api
      .get<TicketSummary[]>(`/support/tickets${status ? `?status=${status}` : ''}`)
      .then(setTickets)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
        setTickets([]);
      });
  }, [status]);

  useEffect(load, [load]);

  const conduct = (tickets ?? []).filter(
    (ticket) => CONDUCT_CATEGORIES.has(ticket.category) && ticket.status !== 'CLOSED',
  );

  return (
    <>
      <ErrorAlert error={error} />

      {conduct.length > 0 && (
        <Alert kind="warning" title={{ text: t.ofcSpOpenComplaints.replace('{{n}}', String(conduct.length)) }}>
          <p style={{ margin: 0 }}>{t.ofcSpAboutRevenue}</p>
        </Alert>
      )}

      <div className="card">
        <div className="card__header">
          <h2 className="card__title">{t.ofcSpSupportQueue}</h2>
          <p className="card__hint">{t.ofcSpQueueIntro}</p>
        </div>

        <div className="filters">
          <label>{t.appStatus}<select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">{t.ofcAgAll}</option>
              <option value="OPEN">{t.ofcRhOpen}</option>
              <option value="ASSIGNED">{t.ofcSpAssigned}</option>
              <option value="IN_PROGRESS">{t.ofcSpInProgress}</option>
              <option value="RESOLVED">{t.ofcSpResolved}</option>
              <option value="CLOSED">{t.ofcSpClosed}</option>
            </select>
          </label>
        </div>

        {!tickets ? (
          <Loading />
        ) : (
          <Table
            columns={[
              { key: 'ticket_number', label: 'ofcSpTicket' },
              {
                key: 'subject',
                label: 'ofcSpSubject',
                render: (row) => (
                  <button type="button" className="link" onClick={() => navigate(`/support/${row.id}`)}>
                    {row.subject}
                  </button>
                ),
              },
              { key: 'category', label: 'supAbout', render: (row) => humanise(row.category) },
              { key: 'priority', label: 'ofcSpPriority', render: (row) => <Badge status={row.priority} /> },
              { key: 'status', label: 'appStatus', render: (row) => <Badge status={row.status} /> },
              {
                key: 'raised_by_name',
                label: 'ofcSpReportedBy',
                render: (row) => `${row.raised_by_name} (${humanise(row.raiser_role)})`,
              },
              { key: 'assigned_to_name', label: 'ofcSpAssigned', render: (row) => row.assigned_to_name ?? '—' },
              { key: 'message_count', label: 'ofcSpReplies', numeric: true },
              { key: 'created_at', label: 'ofcRhRaisedHeading', render: (row) => formatDateTime(row.created_at) },
            ]}
            rows={tickets}
            empty="ofcNoneTicketsMatchFilter"
          />
        )}
      </div>
    </>
  );
}

/**
 * One ticket, at its own address.
 *
 * Routed rather than held in the queue's state so an officer can send a
 * colleague the link to a complaint, and so a refresh in the middle of writing
 * a reply does not put them back at the top of the queue.
 */
export function TicketDetailScreen({
  ticketId,
  navigate,
}: {
  ticketId: string;
  navigate: (path: string) => void;
}) {
  const { t } = usePortalI18n();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const manage = can('support:manage');

  const load = useCallback(() => {
    api
      .get<TicketDetail>(`/support/tickets/${ticketId}`)
      .then(setTicket)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, [ticketId]);

  useEffect(load, [load]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.post(`/support/tickets/${ticketId}/messages`, { body: reply, internal });
      setReply('');
      setMessage(internal ? 'Internal note saved. The reporter cannot see it.' : 'Reply sent.');
      setInternal(false);
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  async function update(status: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.post(`/support/tickets/${ticketId}/update`, {
        status,
        ...(status === 'RESOLVED' ? { resolution } : {}),
      });
      setResolution('');
      setMessage(`Ticket moved to ${humanise(status)}.`);
      load();
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  if (!ticket) {
    return (
      <div className="card">
        <button type="button" className="secondary" onClick={() => navigate('/support')}>{t.ofcSpBackToQueue}</button>
        <ErrorAlert error={error} />
        {!error && <Loading />}
      </div>
    );
  }

  return (
    <>
      <button type="button" className="secondary" onClick={() => navigate('/support')}>{t.ofcSpBackToQueue}</button>

      <div className="card">
        <div className="card__header">
          <h2 className="card__title">{ticket.subject}</h2>
          <p className="card__hint">{ticket.ticket_number}</p>
        </div>
        <KeyValue
          items={[
            ['Status', <Badge status={ticket.status} key="s" />],
            ['Priority', <Badge status={ticket.priority} key="p" />],
            ['About', humanise(ticket.category)],
            ['Reported by', `${ticket.raised_by_name} (${humanise(ticket.raiser_role)})`],
            ['Contact', ticket.raised_by_phone],
            ['Transaction', ticket.transaction_reference ?? '—'],
            ['Raised', formatDateTime(ticket.created_at)],
            ['Assigned to', ticket.assigned_to_name ?? 'Nobody yet'],
          ]}
        />
        {ticket.resolution && (
          <Alert kind="success" title="ofcSpResolutionRecorded">
            <p style={{ margin: 0 }}>{ticket.resolution}</p>
          </Alert>
        )}
      </div>

      <div className="card">
        <h2 className="card__title">{t.supConversation}</h2>
        <ol className="thread">
          <li className="thread__item">
            <p className="thread__meta">
              {ticket.raised_by_name} · {formatDateTime(ticket.created_at)}
            </p>
            <p className="thread__body">{ticket.description}</p>
          </li>
          {ticket.messages.length === 0 ? (
            <Empty>{t.ofcSpNobodyReplied}</Empty>
          ) : (
            ticket.messages.map((entry) => (
              <li
                key={entry.id}
                className={`thread__item${entry.internal ? ' thread__item--internal' : ''}`}
              >
                <p className="thread__meta">
                  {entry.author_name} · {humanise(entry.author_role)} ·{' '}
                  {formatDateTime(entry.created_at)}
                  {entry.internal && ' · internal note, not visible to the reporter'}
                </p>
                <p className="thread__body">{entry.body}</p>
              </li>
            ))
          )}
        </ol>
      </div>

      {message && (
        <Alert kind="success" title="ofcSpDone">
          <p style={{ margin: 0 }}>{message}</p>
        </Alert>
      )}
      <ErrorAlert error={error} />

      {!manage ? (
        <Alert kind="info" title="ofcSpReadAccess">
          <p style={{ margin: 0 }}>{t.ofcSpReadOnlyNote}</p>
        </Alert>
      ) : ticket.status === 'CLOSED' ? (
        <Alert kind="info" title="ofcSpTicketClosed">
          <p style={{ margin: 0 }}>{t.ofcSpClosedKeepsHistory}</p>
        </Alert>
      ) : (
        <form className="card" onSubmit={send}>
          <h2 className="card__title">{internal ? 'Add an internal note' : 'Reply to the reporter'}</h2>
          <p className="card__hint">
            {internal
              ? 'Only staff with support access can read this. The reporter never sees it.'
              : 'This goes to the person who raised the ticket, and they are notified.'}
          </p>
          <textarea
            value={reply}
            rows={4}
            minLength={2}
            maxLength={4000}
            required
            onChange={(event) => setReply(event.target.value)}
          />
          {manage && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={internal}
                onChange={(event) => setInternal(event.target.checked)}
              />{t.ofcSpKeepInternal}</label>
          )}
          <button type="submit" disabled={busy || reply.trim().length < 2}>
            {busy ? 'Saving…' : internal ? 'Save internal note' : 'Send reply'}
          </button>
        </form>
      )}

      {manage && ticket.status !== 'CLOSED' && (
        <div className="card">
          <h2 className="card__title">{t.ofcSpMoveTicket}</h2>
          <div className="button-row">
            <button type="button" className="secondary" disabled={busy} onClick={() => update('ASSIGNED')}>{t.ofcSpAssigned}</button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => update('IN_PROGRESS')}
            >{t.ofcSpInProgress}</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => update('CLOSED')}>{t.ofcKycClose}</button>
          </div>

          <label className="field">{t.ofcSpHowResolved}<textarea
              value={resolution}
              rows={3}
              maxLength={2000}
              onChange={(event) => setResolution(event.target.value)}
            />
          </label>
          <p className="card__hint">{t.ofcSpResolutionRequired}</p>
          <button
            type="button"
            disabled={busy || resolution.trim().length === 0}
            onClick={() => update('RESOLVED')}
          >{t.ofcSpMarkResolved}</button>
        </div>
      )}
    </>
  );
}
