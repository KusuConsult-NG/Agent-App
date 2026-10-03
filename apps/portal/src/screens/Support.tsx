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
import { ApiRequestError, api, asApiError, can, type ApiError } from '../lib/api';
import { Alert, Badge, Empty, ErrorAlert, KeyValue, Loading, Table, formatDateTime } from '../ui';
import { usePortalI18n } from '../lib/i18n';
import { CONDUCT_CATEGORIES, enumLabel } from '@psirs/shared';

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


/** Complaints about the collection itself, which need to be seen as such. */
/*
 * The shared set, not a local one.
 *
 * This was a `Set` literal here while the count was done in the browser. It
 * is counted in SQL now — over every matching ticket rather than the fifty
 * this list carries — and the server needs the same definition. Two copies of
 * what counts as a complaint about conduct is how the banner and the figure
 * above it would come to disagree.
 */
const CONDUCT = new Set<string>(CONDUCT_CATEGORIES);

export function SupportScreen({ navigate }: { navigate: (path: string) => void }) {
  const { t } = usePortalI18n();
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  /**
   * The figures as the server counted them, over every matching ticket.
   *
   * `null` means an API that still answers with a bare array, and the count
   * falls back to the page. Never to a nought: a zero here removes the
   * conduct banner entirely, which is the failure
   * `a-complaint-nobody-saw` was written for.
   */
  const [size, setSize] = useState<{
    matched: number;
    conductOpen: number;
    cap: number;
  } | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);

  const load = useCallback(() => {
    setTickets(null);
    setLoadError(null);
    api
      .get<
        | TicketSummary[]
        | { tickets: TicketSummary[]; matched?: number; conductOpen?: number; cap?: number }
      >(`/support/tickets${status ? `?status=${status}` : ''}`)
      .then((answer) => {
        /*
         * An array or an envelope. This endpoint answered with a bare array
         * until the conduct count moved to the server, and a screen that read
         * only one of the two shapes would print an empty queue against the
         * other — which is the very failure the catch below exists to prevent.
         */
        const list = Array.isArray(answer) ? answer : answer.tickets;
        setTickets(list);
        setSize(
          Array.isArray(answer)
            ? null
            : {
                matched: answer.matched ?? list.length,
                conductOpen:
                  answer.conductOpen ??
                  list.filter((t) => CONDUCT.has(t.category) && t.status !== 'CLOSED').length,
                cap: answer.cap ?? 0,
              },
        );
      })
      /*
       * `setTickets([])` printed "No tickets match this filter." from a request
       * that failed — and took the conduct banner with it, which is the part
       * that matters. Complaints about how revenue staff treated somebody are
       * counted out of this same list, so a refused read did not merely show
       * an empty queue: it said there were no open complaints.
       */
      .catch((caught) => {
        setLoadError(asApiError(caught));
      });
  }, [status]);

  useEffect(load, [load]);

  /*
   * The complaints on this page, and how many there are altogether.
   *
   * `conduct` still drives the list of subjects in the banner — those can only
   * be the ones on the page, because the page is all the screen has. The
   * FIGURE is the server's, over every matching ticket: the list is capped at
   * fifty, and on sixty open tickets with twenty complaints among them this
   * banner said sixteen.
   *
   * So the banner now fires on the count rather than on the page, which is
   * what makes a complaint beyond the cap visible at all.
   */
  const conduct = (tickets ?? []).filter(
    (ticket) => CONDUCT.has(ticket.category) && ticket.status !== 'CLOSED',
  );
  const conductOpen = size?.conductOpen ?? conduct.length;
  const unseen = Math.max(0, conductOpen - conduct.length);

  return (
    <>
      <ErrorAlert error={error} />

      {conductOpen > 0 && (
        <Alert kind="warning" title={{ text: t.ofcSpOpenComplaints.replace('{{n}}', String(conductOpen)) }}>
          <p style={{ margin: 0 }}>{t.ofcSpAboutRevenue}</p>
          {/*
            * Where the rest of them are. Without this the banner counts
            * twenty and the table under it lists sixteen, and the reader is
            * left to decide which number to believe.
            */}
          {unseen > 0 && (
            <p style={{ margin: '6px 0 0' }}>
              {t.ofcSpComplaintsBeyondThisPage.replace('{{n}}', String(unseen))}
            </p>
          )}
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

        {loadError ? (
          <div style={{ padding: 18 }}>
            <ErrorAlert error={loadError} />
            <button type="button" className="secondary" onClick={load}>{t.actionTryAgain}</button>
          </div>
        ) : !tickets ? (
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
              { key: 'category', label: 'supAbout', render: (row) => enumLabel(row.category, t) },
              { key: 'priority', label: 'ofcSpPriority', render: (row) => <Badge status={row.priority} /> },
              { key: 'status', label: 'appStatus', render: (row) => <Badge status={row.status} /> },
              {
                key: 'raised_by_name',
                label: 'ofcSpReportedBy',
                render: (row) => `${row.raised_by_name} (${enumLabel(row.raiser_role, t)})`,
              },
              { key: 'assigned_to_name', label: 'ofcSpAssigned', render: (row) => row.assigned_to_name ?? '—' },
              { key: 'message_count', label: 'ofcSpReplies', numeric: true },
              { key: 'created_at', label: 'ofcRhRaisedHeading', render: (row) => formatDateTime(row.created_at) },
              {
                /*
                 * When it was last touched, which is what triage runs on.
                 *
                 * The queue showed when a ticket was raised and not when
                 * anybody last answered it, so a complaint opened three weeks
                 * ago and replied to this morning looked exactly like one
                 * opened three weeks ago and left alone since. The reply count
                 * beside it does not separate them either: both may say 4.
                 *
                 * Null is a ticket nobody has answered at all, which is the
                 * row to open first and says so in its own words.
                 */
                key: 'last_message_at',
                label: 'ofcSpLastReply',
                render: (row) =>
                  row.last_message_at ? formatDateTime(row.last_message_at) : t.ofcSpNoReplyYet,
              },
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
        // A failure that is not a refusal with a body set nothing at all, so
        // the screen said nothing and went on loading. See `Revenue.tsx`.
        setError(asApiError(caught));
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
      setMessage(internal ? t.ofcSpInternalNoteSavedThe : t.ofcSpReplySent);
      setInternal(false);
      load();
    } catch (caught) {
      setError(asApiError(caught));
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
      setMessage(t.ofcSpTicketMoved.replace('{{status}}', enumLabel(status, t)));
      load();
    } catch (caught) {
      setError(asApiError(caught));
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
            [t.appStatus, <Badge status={ticket.status} key="s" />],
            [t.ofcSpPriority, <Badge status={ticket.priority} key="p" />],
            [t.supAbout, enumLabel(ticket.category, t)],
            [t.ofcSpReportedBy, `${ticket.raised_by_name} (${enumLabel(ticket.raiser_role, t)})`],
            [t.ofcSpContact, ticket.raised_by_phone],
            [t.supTransactionLabel, ticket.transaction_reference ?? '—'],
            [t.ofcRhRaisedHeading, formatDateTime(ticket.created_at)],
            [t.ofcSpAssignedTo, ticket.assigned_to_name ?? t.ofcSpNobodyYet],
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
                  {entry.author_name} · {enumLabel(entry.author_role, t)} ·{' '}
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
          <h2 className="card__title">{internal ? t.ofcSpAddAnInternalNote : t.ofcSpReplyToTheReporter}</h2>
          <p className="card__hint">
            {internal
              ? t.ofcSpOnlyStaffWithSupport
              : t.ofcSpThisGoesToThe}
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
            {busy ? t.agEnSaving : internal ? t.ofcSpSaveInternalNote : t.ofcSpSendReply}
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
