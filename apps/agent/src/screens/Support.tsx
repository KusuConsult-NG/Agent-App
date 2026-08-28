/**
 * Report a problem, and read the answer (PRD §77, §78).
 *
 * An agent works alone. There is no supervisor to walk to when a payment has
 * not confirmed and a taxpayer is standing there, and the categories PRD §78
 * asks for — AGENT_MISCONDUCT, UNAUTHORISED_CHARGE — describe complaints
 * about the collection itself, which cannot travel through the person
 * collecting. The API for this existed and nothing in the application
 * mentioned it, so the channel was reachable only by hand-written HTTP.
 *
 * The screen is written for someone on a phone, in a market, who is already
 * having a bad day: plain category names rather than the enum, a transaction
 * reference field that explains why it helps, and a thread that shows what
 * PSIRS said rather than only that the status changed.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, type ApiError } from '../lib/api';
import { Alert, Badge, ErrorAlert, Empty, Field, KeyValue, Loading } from '../ui';
import { useI18n } from '../lib/i18n';

/** The categories the API accepts, in the words an agent would use. */
const CATEGORIES: { value: string; label: string; hint?: string }[] = [
  { value: 'PAYMENT_ISSUE', label: 'A payment has not gone through' },
  { value: 'RECEIPT_ISSUE', label: 'A receipt is wrong or missing' },
  { value: 'INCORRECT_ASSESSMENT', label: 'The amount charged looks wrong' },
  { value: 'TIN_ISSUE', label: 'A taxpayer has no TIN yet' },
  { value: 'VEHICLE_ISSUE', label: 'A vehicle renewal problem' },
  { value: 'TECHNICAL_ISSUE', label: 'The app is not working' },
  { value: 'TAXPAYER_COMPLAINT', label: 'A taxpayer has a complaint' },
  {
    value: 'UNAUTHORISED_CHARGE',
    label: 'Someone was charged money they should not have been',
    hint: 'Use this if a taxpayer was asked for money outside an official assessment.',
  },
  {
    value: 'AGENT_MISCONDUCT',
    label: 'Report the conduct of an agent',
    hint: 'This goes to PSIRS oversight, not to the agent concerned.',
  },
];

const categoryLabel = (value: string) =>
  CATEGORIES.find((entry) => entry.value === value)?.label ??
  value.replace(/_/g, ' ').toLowerCase();

interface TicketSummary {
  id: string;
  ticket_number: string;
  category: string;
  subject: string;
  status: string;
  priority: string;
  created_at: string;
  message_count: number;
  last_message_at: string | null;
  transaction_reference: string | null;
}

export function SupportScreen({ navigate }: { navigate: (path: string) => void }) {
  const { t } = useI18n();
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    api
      .get<TicketSummary[]>('/support/tickets')
      .then(setTickets)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
        setTickets([]);
      });
  }, []);

  return (
    <>
      <div className="card">
        <h2 className="card__title">{t.supGetHelp}</h2>
        <p className="card__hint">
          Report a problem to PSIRS. You will get a reply here, and a message when there is
          something to read.
        </p>
        <a className="button" href="#/support/new">{t.supReportProblem}</a>
      </div>

      <ErrorAlert error={error} />

      <div className="card">
        <h2 className="card__title">{t.supMyReports}</h2>
        {!tickets ? (
          <Loading />
        ) : tickets.length === 0 ? (
          <Empty>{t.supNothingReported}</Empty>
        ) : (
          <ul className="list">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <button
                  type="button"
                  className="list__item"
                  onClick={() => navigate(`/support/${ticket.id}`)}
                >
                  <div className="list__body">
                    <p className="list__title">{ticket.subject}</p>
                    <p className="list__meta">
                      {ticket.ticket_number} · {categoryLabel(ticket.category)}
                      {ticket.message_count > 0 && ` · ${ticket.message_count} reply(s)`}
                    </p>
                  </div>
                  <Badge status={ticket.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

export function RaiseTicketScreen({ navigate }: { navigate: (path: string) => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    category: '',
    subject: '',
    description: '',
    transactionReference: '',
    priority: 'NORMAL',
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const chosen = CATEGORIES.find((entry) => entry.value === form.category);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<{ id: string; ticketNumber: string }>('/support/tickets', {
        category: form.category,
        subject: form.subject,
        description: form.description,
        priority: form.priority,
        ...(form.transactionReference ? { transactionReference: form.transactionReference } : {}),
      });
      navigate(`/support/${created.id}`);
    } catch (caught) {
      if (caught instanceof ApiRequestError) setError(caught.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2 className="card__title">{t.supReportProblem}</h2>

      <ErrorAlert error={error} />

      <Field label={t.supWhatProblem} required>
        <select
          value={form.category}
          onChange={(event) => set('category', event.target.value)}
          required
        >
          <option value="">{t.supChooseOne}</option>
          {CATEGORIES.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </Field>

      {chosen?.hint && (
        <Alert kind="info" title={t.supBeforeYouSend}>
          <p style={{ margin: 0 }}>{chosen.hint}</p>
        </Alert>
      )}

      <Field label={t.supShortSummary} required>
        <input
          value={form.subject}
          minLength={5}
          maxLength={200}
          required
          onChange={(event) => set('subject', event.target.value)}
        />
      </Field>

      <Field label={t.supWhatHappened} hint="Include anything PSIRS would need to look it up." required>
        <textarea
          value={form.description}
          rows={5}
          minLength={10}
          maxLength={4000}
          required
          onChange={(event) => set('description', event.target.value)}
        />
      </Field>

      <Field
        label={t.supTransactionRef}
        hint="If this is about one payment, the reference lets PSIRS find it without asking you."
      >
        <input
          value={form.transactionReference}
          maxLength={40}
          onChange={(event) => set('transactionReference', event.target.value)}
        />
      </Field>

      <Field label={t.supHowUrgent}>
        <select value={form.priority} onChange={(event) => set('priority', event.target.value)}>
          <option value="LOW">{t.supNotUrgent}</option>
          <option value="NORMAL">Normal</option>
          <option value="HIGH">{t.supUrgent}</option>
          <option value="URGENT">{t.supVeryUrgent}</option>
        </select>
      </Field>

      <button type="submit" disabled={busy || !form.category}>
        {busy ? 'Sending…' : 'Send to PSIRS'}
      </button>
    </form>
  );
}

interface TicketDetail {
  id: string;
  ticket_number: string;
  category: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  resolution: string | null;
  created_at: string;
  transaction_reference: string | null;
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

export function TicketScreen({ ticketId }: { ticketId: string }) {
  const { t } = useI18n();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
    setNotice(null);
    try {
      const result = await api.post<{ reopened: boolean }>(
        `/support/tickets/${ticketId}/messages`,
        { body: reply },
      );
      setReply('');
      if (result.reopened) setNotice('This report has been opened again for PSIRS to look at.');
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
        <ErrorAlert error={error} />
        {!error && <Loading />}
      </div>
    );
  }

  const closed = ticket.status === 'CLOSED';

  return (
    <>
      <div className="card">
        <h2 className="card__title">{ticket.subject}</h2>
        <KeyValue
          items={[
            ['Reference', ticket.ticket_number],
            ['Status', <Badge status={ticket.status} key="s" />],
            ['About', categoryLabel(ticket.category)],
            ...(ticket.transaction_reference
              ? ([['Transaction', ticket.transaction_reference]] as [string, React.ReactNode][])
              : []),
            ['Reported', new Date(ticket.created_at).toLocaleString('en-NG')],
          ]}
        />
      </div>

      <div className="card">
        <h2 className="card__title">{t.supConversation}</h2>
        <ol className="thread">
          <li className="thread__item thread__item--mine">
            <p className="thread__meta">You · {new Date(ticket.created_at).toLocaleString('en-NG')}</p>
            <p className="thread__body">{ticket.description}</p>
          </li>
          {ticket.messages.map((message) => (
            <li
              key={message.id}
              className={`thread__item${message.mine ? ' thread__item--mine' : ''}`}
            >
              <p className="thread__meta">
                {message.mine ? 'You' : `${message.author_name} · PSIRS`} ·{' '}
                {new Date(message.created_at).toLocaleString('en-NG')}
              </p>
              <p className="thread__body">{message.body}</p>
            </li>
          ))}
        </ol>
      </div>

      {notice && (
        <Alert kind="success" title={t.supReopened}>
          <p style={{ margin: 0 }}>{notice}</p>
        </Alert>
      )}

      <ErrorAlert error={error} />

      {closed ? (
        <Alert kind="info" title={t.supReportClosed}>
          <p style={{ margin: 0 }}>
            If the problem has come back, <a href="#/support/new">report it again</a> so it keeps its
            own history.
          </p>
        </Alert>
      ) : (
        <form className="card" onSubmit={send}>
          <Field label={t.supAddToReport}>
            <textarea
              value={reply}
              rows={4}
              minLength={2}
              maxLength={4000}
              required
              onChange={(event) => setReply(event.target.value)}
            />
          </Field>
          <button type="submit" disabled={busy || reply.trim().length < 2}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </form>
      )}
    </>
  );
}
