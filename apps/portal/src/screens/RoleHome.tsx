/**
 * A first screen built around the job, not around the platform.
 *
 * Every officer landed on the same executive dashboard: this morning's
 * collections, revenue by category, the daily trend. It is a good screen, and
 * it was the wrong first screen for four of the five roles that saw it. An
 * auditor opening the platform does not need today's takings; a finance
 * officer does not need the agent clearance queue; a revenue officer needs
 * neither and was shown both.
 *
 * A dashboard that shows every role everything is how a finance officer learns
 * to scroll past reconciliation exceptions.
 *
 * WHAT EACH SCREEN IS FOR
 *   Administrator   — the platform: who is waiting for clearance, what is
 *                     unconfigured, which accounts are not finished.
 *   Revenue officer — the register: taxpayers, TINs outstanding, invoices
 *                     nobody has paid.
 *   Finance officer — the money: exceptions, settlements, what is owed out and
 *                     what is being held for the Councils.
 *   Auditor         — what there is to examine, and nothing that changes a
 *                     record.
 *
 * Each is a queue rather than a report. A number here is something somebody
 * has to do, which is why the counts that are zero are still shown: an empty
 * queue is the answer, and hiding it makes the screen look broken.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, api, stepUp, type ApiError, type User } from '../lib/api';
import { Alert, ErrorAlert, Loading, Money, Stat, Table } from '../ui';

type Counts = Record<string, string>;

interface Home {
  role: string;
  admin?: Counts;
  revenue?: Counts;
  finance?: Counts;
  audit?: Counts;
  /** The work behind the counts, so the top of a queue can be worked here. */
  work?: Record<string, Record<string, string>[]>;
}

/** A queue: what it is, where it goes, and when it deserves attention. */
interface Queue {
  key: string;
  label: string;
  hint: string;
  path?: string;
  /** Non-zero is work. For some rows zero is the thing that is wrong. */
  attentionWhen?: (value: number) => boolean;
  money?: boolean;
}

const nonZero = (value: number) => value > 0;

/**
 * Doing the thing, rather than linking to where it is done.
 *
 * A home screen that only counts and links is an index. What makes it a place
 * of work is that the first item in each queue can be settled here — the same
 * endpoint the queue screen calls, the same permission, the same audit entry.
 * Anything needing more than a decision (choosing territories, writing a long
 * resolution note) still goes to its own screen, because a cramped version of
 * a considered decision is worse than a link to the room for it.
 */
function useAction(reload: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const act = useCallback(
    async (key: string, run: () => Promise<unknown>, said: string) => {
      setBusy(key);
      setError(null);
      setDone(null);
      try {
        await run();
        setDone(said);
        reload();
      } catch (caught) {
        if (caught instanceof ApiRequestError) setError(caught.error);
        else if (caught instanceof Error) {
          setError({ code: 'CLIENT', message: caught.message, moneyStatus: 'NOT_APPLICABLE' });
        }
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );

  return { act, busy, error, done };
}

function Worked({ error, done }: { error: ApiError | null; done: string | null }) {
  return (
    <>
      <ErrorAlert error={error} />
      {done && <Alert kind="success">{done}</Alert>}
    </>
  );
}

const ADMIN_QUEUES: Queue[] = [
  {
    key: 'agents_awaiting_review',
    label: 'Agents awaiting clearance',
    hint: 'Applications complete and waiting on a decision',
    path: '/agents',
    attentionWhen: nonZero,
  },
  {
    key: 'agents_needing_information',
    label: 'Agents asked for more',
    hint: 'Waiting on the applicant, not on you',
    path: '/agents',
  },
  {
    key: 'devices_awaiting_approval',
    label: 'Devices awaiting approval',
    hint: 'An agent cannot collect until their handset is approved',
    path: '/agents',
    attentionWhen: nonZero,
  },
  {
    key: 'supervisors_without_a_territory',
    label: 'Supervisors with no territory',
    hint: 'They see no revenue figures at all until one is assigned',
    path: '/users',
    attentionWhen: nonZero,
  },
  {
    key: 'revenue_items_awaiting_a_rate',
    label: 'Revenue items with no rate',
    hint: 'Catalogued and not collectable until government sets the amount',
    path: '/catalogue',
  },
  {
    key: 'mdas_with_no_revenue_item',
    label: 'MDAs collecting nothing',
    hint: 'No revenue item exists for them in this platform',
    path: '/revenue',
  },
  { key: 'active_officers', label: 'Officers with access', hint: 'Excluding field agents', path: '/users' },
  { key: 'open_tickets', label: 'Support tickets open', hint: 'Raised by agents in the field', path: '/support' },
];

const REVENUE_QUEUES: Queue[] = [
  {
    key: 'tins_failed',
    label: 'TIN applications failed',
    hint: 'The register refused these — they need a person',
    path: '/taxpayer-records',
    attentionWhen: nonZero,
  },
  {
    key: 'tins_outstanding',
    label: 'TINs outstanding',
    hint: 'Applied for and not yet issued',
    path: '/taxpayer-records',
  },
  {
    key: 'corrections_awaiting_review',
    label: 'Corrections awaiting review',
    hint: 'Someone has asked to change who a record says they are',
    path: '/approvals',
    attentionWhen: nonZero,
  },
  { key: 'invoices_unpaid', label: 'Invoices unpaid', hint: 'Raised and still open', path: '/outstanding' },
  {
    key: 'invoices_expired',
    label: 'Invoices expired',
    hint: 'Never paid and now out of time',
    path: '/outstanding',
  },
  { key: 'registered_this_week', label: 'Registered this week', hint: 'New taxpayers on the register' },
  { key: 'taxpayers', label: 'Taxpayers on the register', hint: 'Active records' },
];

const FINANCE_QUEUES: Queue[] = [
  {
    key: 'reconciliation_exceptions',
    label: 'Reconciliation exceptions',
    hint: 'The bank and the platform disagree about these',
    path: '/reconciliation',
    attentionWhen: nonZero,
  },
  {
    key: 'settlements_unreconciled',
    label: 'Settlements unreconciled',
    hint: 'Money received and not yet matched',
    path: '/reconciliation',
    attentionWhen: nonZero,
  },
  {
    key: 'payouts_awaiting_approval',
    label: 'Commission payouts to approve',
    hint: 'Agents are waiting on these',
    path: '/commissions',
    attentionWhen: nonZero,
  },
  {
    key: 'refunds_outstanding',
    label: 'Refunds a taxpayer is still owed',
    hint: 'Money the state has and should not',
    path: '/outstanding',
    attentionWhen: nonZero,
  },
];

const AUDIT_QUEUES: Queue[] = [
  {
    key: 'fraud_flags_open',
    label: 'Fraud flags open',
    hint: 'Raised and not yet reviewed',
    path: '/fraud',
    attentionWhen: nonZero,
  },
  {
    key: 'reversed_or_refunded',
    label: 'Reversed or refunded',
    hint: 'Money that came back out — the query worth running first',
    path: '/audit',
  },
  {
    key: 'refused_this_week',
    label: 'Actions refused this week',
    hint: 'Someone tried something their role does not permit',
    path: '/audit',
  },
  {
    key: 'rate_changes_this_month',
    label: 'Rate changes this month',
    hint: 'Every change to what a citizen is charged',
    path: '/audit',
  },
  { key: 'receipt_checks_this_week', label: 'Receipts checked by the public', hint: 'Verification page lookups' },
  { key: 'entries_today', label: 'Audit entries today', hint: 'Hash-chained and append-only' },
  { key: 'audit_entries', label: 'Audit entries in total', hint: 'Since the platform started' },
  { key: 'taxpayers_on_record', label: 'Taxpayers on record', hint: 'Active records' },
];

function QueueTable({
  counts,
  queues,
  navigate,
}: {
  counts: Counts;
  queues: Queue[];
  navigate: (path: string) => void;
}) {
  const rows = queues.map((queue) => ({ ...queue, value: counts[queue.key] ?? '0' }));
  return (
    <Table
      columns={[
        {
          key: 'label',
          label: 'Waiting',
          render: (row: (typeof rows)[number]) => (
            <>
              <strong>{row.label}</strong>
              <br />
              <span className="list__meta">{row.hint}</span>
            </>
          ),
        },
        {
          key: 'value',
          label: '',
          render: (row: (typeof rows)[number]) => {
            const needsAttention = row.attentionWhen?.(Number(row.value)) ?? false;
            return (
              <span
                style={{
                  fontWeight: 600,
                  fontSize: '1.15rem',
                  color: needsAttention ? 'var(--warning, #b45309)' : 'inherit',
                }}
              >
                {row.money ? <Money kobo={row.value} /> : row.value}
              </span>
            );
          },
        },
        {
          key: 'open',
          label: '',
          render: (row: (typeof rows)[number]) =>
            row.path ? (
              <button type="button" className="small secondary" onClick={() => navigate(row.path!)}>
                Open
              </button>
            ) : null,
        },
      ]}
      rows={rows}
      empty="Nothing is waiting."
    />
  );
}

export function RoleHomeScreen({
  user,
  navigate,
}: {
  user: User;
  navigate: (path: string) => void;
}) {
  const [data, setData] = useState<Home | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(() => {
    api
      .get<Home>('/government/home')
      .then(setData)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, []);

  useEffect(load, [load]);
  const action = useAction(load);

  if (error) return <ErrorAlert error={error} />;
  if (!data) return <Loading rows={5} />;

  const work = data.work ?? {};

  if (data.admin) {
    const c = data.admin;
    const blocked =
      Number(c.agents_awaiting_review) +
      Number(c.devices_awaiting_approval) +
      Number(c.supervisors_without_a_territory);
    return (
      <>
        <div className="card">
          <h2 className="card__title">Administration — {user.fullName ?? 'signed in'}</h2>
          <p className="card__hint">
            What is waiting on an administrator. Collections and revenue analysis are on the
            dashboard and the revenue summary; this screen is the platform itself.
          </p>
        </div>
        {blocked > 0 && (
          <Alert kind="warning" title={`${blocked} thing(s) are stopping somebody working`}>
            <p style={{ margin: 0 }}>
              An agent without clearance or an approved device cannot collect, and a supervisor
              with no territory sees no figures at all.
            </p>
          </Alert>
        )}
        <Worked error={action.error} done={action.done} />

        {(work.agents ?? []).length > 0 && (
          <div className="card card--flush">
            <h2 className="card__title" style={{ padding: '14px 18px 0' }}>
              Agents waiting on a decision
            </h2>
            <p className="card__hint" style={{ padding: '0 18px' }}>
              Approving here does what the clearance screen does — same endpoint, same audit
              entry. Asking for more information needs a reason, so that one opens the file.
            </p>
            <Table
              columns={[
                { key: 'agent_code', label: 'Agent' },
                { key: 'full_name', label: 'Name' },
                { key: 'lga', label: 'LGA' },
                { key: 'waiting_since', label: 'Waiting since' },
                {
                  key: 'act',
                  label: '',
                  render: (row: Record<string, string>) => (
                    <>
                      <button
                        type="button"
                        className="small"
                        disabled={action.busy !== null}
                        onClick={() =>
                          action.act(
                            row.id!,
                            () =>
                              api.post(`/agents/${row.id}/review`, {
                                decision: 'APPROVE',
                                note: 'Approved from the administrator home screen.',
                              }),
                            `${row.full_name} approved.`,
                          )
                        }
                      >
                        Approve
                      </button>{' '}
                      <button
                        type="button"
                        className="small secondary"
                        onClick={() => navigate('/agents')}
                      >
                        Open file
                      </button>
                    </>
                  ),
                },
              ]}
              rows={work.agents!}
              empty=""
            />
          </div>
        )}

        {(work.devices ?? []).length > 0 && (
          <div className="card card--flush">
            <h2 className="card__title" style={{ padding: '14px 18px 0' }}>
              Handsets waiting for approval
            </h2>
            <p className="card__hint" style={{ padding: '0 18px' }}>
              A cleared agent still cannot collect until the device in their hand is approved.
            </p>
            <Table
              columns={[
                { key: 'agent_code', label: 'Agent' },
                { key: 'full_name', label: 'Name' },
                { key: 'device_name', label: 'Device' },
                { key: 'registered', label: 'Registered' },
                {
                  key: 'act',
                  label: '',
                  render: (row: Record<string, string>) => (
                    <button
                      type="button"
                      className="small"
                      disabled={action.busy !== null}
                      onClick={() =>
                        action.act(
                          row.id!,
                          () => api.post(`/agents/devices/${row.id}/approve`, {}),
                          'Device approved.',
                        )
                      }
                    >
                      Approve
                    </button>
                  ),
                },
              ]}
              rows={work.devices!}
              empty=""
            />
          </div>
        )}

        {(work.supervisors ?? []).length > 0 && (
          <div className="card card--flush">
            <h2 className="card__title" style={{ padding: '14px 18px 0' }}>
              Supervisors covering nothing
            </h2>
            <p className="card__hint" style={{ padding: '0 18px' }}>
              They see no revenue figures at all until a territory is assigned. Choosing which
              needs the picker, so this one opens Officer access.
            </p>
            <Table
              columns={[
                { key: 'full_name', label: 'Officer' },
                { key: 'phone', label: 'Phone' },
                {
                  key: 'act',
                  label: '',
                  render: () => (
                    <button
                      type="button"
                      className="small secondary"
                      onClick={() => navigate('/users')}
                    >
                      Assign territories
                    </button>
                  ),
                },
              ]}
              rows={work.supervisors!}
              empty=""
            />
          </div>
        )}

        <div className="card card--flush">
          <QueueTable counts={c} queues={ADMIN_QUEUES} navigate={navigate} />
        </div>
      </>
    );
  }

  if (data.revenue) {
    const c = data.revenue;
    return (
      <>
        <div className="card">
          <h2 className="card__title">The taxpayer register</h2>
          <p className="card__hint">
            Who is on it, who is missing a TIN, and what has been assessed and not paid.
          </p>
        </div>
        <div className="stat-grid">
          <Stat
            label="Assessed and unpaid"
            value={<Money kobo={c.unpaid_kobo} />}
            variant="accent"
            hint={`${c.invoices_unpaid} invoice(s) still open`}
          />
          <Stat label="Taxpayers" value={c.taxpayers} hint="Active records" />
          <Stat label="New this week" value={c.registered_this_week} hint="Registered by agents and officers" />
          <Stat
            label="TINs outstanding"
            value={c.tins_outstanding}
            hint="A taxpayer without one cannot be tracked across years"
          />
        </div>
        <Worked error={action.error} done={action.done} />

        {(work.failedTins ?? []).length > 0 && (
          <div className="card card--flush">
            <h2 className="card__title" style={{ padding: '14px 18px 0' }}>
              TIN applications the register refused
            </h2>
            <p className="card__hint" style={{ padding: '0 18px' }}>
              These taxpayers exist and have no TIN, so nothing can follow them across years.
              Re-asking is safe: the platform sends the same application, and a TIN already
              issued comes back rather than a second one being made.
            </p>
            <Table
              columns={[
                { key: 'name', label: 'Taxpayer' },
                { key: 'phone', label: 'Phone' },
                { key: 'tin_reason', label: 'Why it failed' },
              ]}
              rows={work.failedTins!}
              empty=""
            />
            <div style={{ padding: '0 18px 16px' }}>
              <button
                type="button"
                disabled={action.busy !== null}
                onClick={() =>
                  action.act(
                    'tin-retry',
                    () => api.post('/taxpayers/tin-retry', {}),
                    'Re-asked the TIN register for everyone still waiting.',
                  )
                }
              >
                {action.busy === 'tin-retry' ? 'Asking…' : 'Ask the register again'}
              </button>
            </div>
          </div>
        )}

        {(work.expiring ?? []).length > 0 && (
          <div className="card card--flush">
            <h2 className="card__title" style={{ padding: '14px 18px 0' }}>
              Invoices about to expire
            </h2>
            <p className="card__hint" style={{ padding: '0 18px' }}>
              Raised, unpaid, and out of time within the week. After that the assessment has to
              be raised again.
            </p>
            <Table
              columns={[
                { key: 'invoice_number', label: 'Invoice' },
                { key: 'taxpayer', label: 'Taxpayer' },
                {
                  key: 'amount_kobo',
                  label: 'Amount',
                  render: (row: Record<string, string>) => <Money kobo={row.amount_kobo!} />,
                },
                { key: 'expires_on', label: 'Expires' },
              ]}
              rows={work.expiring!}
              empty=""
            />
            <div style={{ padding: '0 18px 16px' }}>
              <button
                type="button"
                disabled={action.busy !== null}
                onClick={() =>
                  action.act(
                    'remind',
                    () => api.post('/government/reminders/send-due', {}),
                    'Reminders sent to taxpayers with something due.',
                  )
                }
              >
                {action.busy === 'remind' ? 'Sending…' : 'Send payment reminders'}
              </button>
            </div>
          </div>
        )}

        <div className="card card--flush">
          <QueueTable counts={c} queues={REVENUE_QUEUES} navigate={navigate} />
        </div>
      </>
    );
  }

  if (data.finance) {
    const c = data.finance;
    return (
      <>
        <div className="card">
          <h2 className="card__title">Money in, money out, money held</h2>
          <p className="card__hint">
            Reconciliation, settlement and what the state owes — to its agents, to taxpayers owed
            a refund, and to the Councils it collects for.
          </p>
        </div>
        <div className="stat-grid">
          <Stat
            label="Owed to the Councils"
            value={<Money kobo={c.owed_to_councils_kobo} />}
            variant="accent"
            hint="Collected on their behalf, not the state's own"
          />
          <Stat
            label="Commission liability"
            value={<Money kobo={c.commission_liability_kobo} />}
            hint="Accrued and not yet paid"
          />
          <Stat
            label="Settlement variance"
            value={<Money kobo={c.settlement_variance_kobo} />}
            hint="Expected less received, on unreconciled settlements"
          />
          <Stat
            label="Exceptions"
            value={c.reconciliation_exceptions}
            hint="The bank and the platform disagree"
          />
        </div>
        {Number(c.reconciliation_exceptions) > 0 && (
          <Alert kind="warning" title="Reconciliation exceptions are open">
            <p style={{ margin: 0 }}>
              Until these are resolved the platform's figures and the bank's do not agree, and
              commission on the affected collections stays held.
            </p>
          </Alert>
        )}
        <Worked error={action.error} done={action.done} />

        {(work.exceptions ?? []).length > 0 && (
          <div className="card card--flush">
            <h2 className="card__title" style={{ padding: '14px 18px 0' }}>
              Where the bank and the platform disagree
            </h2>
            <p className="card__hint" style={{ padding: '0 18px' }}>
              Resolving an exception is a judgement with a note attached, so it happens on the
              reconciliation screen where there is room to write one. This is what is waiting.
            </p>
            <Table
              columns={[
                { key: 'status', label: 'Kind' },
                { key: 'gateway_reference', label: 'Gateway reference' },
                {
                  key: 'expected_kobo',
                  label: 'Expected',
                  render: (row: Record<string, string>) => <Money kobo={row.expected_kobo ?? '0'} />,
                },
                {
                  key: 'received_kobo',
                  label: 'Received',
                  render: (row: Record<string, string>) => <Money kobo={row.received_kobo ?? '0'} />,
                },
                { key: 'raised', label: 'Raised' },
              ]}
              rows={work.exceptions!}
              empty=""
            />
            <div style={{ padding: '0 18px 16px' }}>
              <button type="button" className="secondary" onClick={() => navigate('/reconciliation')}>
                Work the exception queue
              </button>
            </div>
          </div>
        )}

        {(work.payouts ?? []).length > 0 && (
          <div className="card card--flush">
            <h2 className="card__title" style={{ padding: '14px 18px 0' }}>
              Commission payouts requested
            </h2>
            <p className="card__hint" style={{ padding: '0 18px' }}>
              Agents are waiting on these. Approving needs a fresh code, because it is the
              action that moves money out.
            </p>
            <Table
              columns={[
                { key: 'agent', label: 'Agent' },
                { key: 'payout_reference', label: 'Reference' },
                {
                  key: 'amount_kobo',
                  label: 'Amount',
                  render: (row: Record<string, string>) => <Money kobo={row.amount_kobo!} />,
                },
                { key: 'commissions', label: 'Commissions' },
                { key: 'requested', label: 'Requested' },
                {
                  key: 'act',
                  label: '',
                  render: (row: Record<string, string>) => (
                    <button
                      type="button"
                      className="small"
                      disabled={action.busy !== null}
                      onClick={() =>
                        action.act(
                          row.id!,
                          async () => {
                            await stepUp('commission.payout.approve', user.phone);
                            await api.post(`/government/commissions/payouts/${row.id}/approve`, {});
                          },
                          `Payout ${row.payout_reference} approved.`,
                        )
                      }
                    >
                      Approve
                    </button>
                  ),
                },
              ]}
              rows={work.payouts!}
              empty=""
            />
          </div>
        )}

        <div className="card card--flush">
          <QueueTable counts={c} queues={FINANCE_QUEUES} navigate={navigate} />
        </div>
      </>
    );
  }

  if (data.audit) {
    const c = data.audit;
    return (
      <>
        <div className="card">
          <h2 className="card__title">What there is to examine</h2>
          <p className="card__hint">
            Read-only, by role and by design. Nothing on this screen changes a record — every
            figure is a starting point for a query, and the audit log itself is hash-chained and
            append-only.
          </p>
        </div>
        <div className="stat-grid">
          <Stat label="Audit entries" value={c.audit_entries} variant="accent" hint="Hash-chained, append-only" />
          <Stat label="Today" value={c.entries_today} hint="Entries since midnight" />
          <Stat label="Reversed or refunded" value={c.reversed_or_refunded} hint="Money that came back out" />
          <Stat label="Fraud flags open" value={c.fraud_flags_open} hint="Raised and not yet reviewed" />
        </div>
        {(work.refusals ?? []).length > 0 && (
          <div className="card card--flush">
            <h2 className="card__title" style={{ padding: '14px 18px 0' }}>
              Actions the platform refused
            </h2>
            <p className="card__hint" style={{ padding: '0 18px' }}>
              Somebody attempted something their role does not permit. Each is an audit entry
              in its own right.
            </p>
            <Table
              columns={[
                { key: 'at', label: 'When' },
                { key: 'actor_role', label: 'Role' },
                { key: 'action', label: 'Attempted' },
                { key: 'entity_type', label: 'Against' },
              ]}
              rows={work.refusals!}
              empty=""
            />
          </div>
        )}

        {(work.reversals ?? []).length > 0 && (
          <div className="card card--flush">
            <h2 className="card__title" style={{ padding: '14px 18px 0' }}>
              Money that came back out
            </h2>
            <p className="card__hint" style={{ padding: '0 18px' }}>
              Reversed or refunded after the fact. The first query worth running on any revenue
              platform.
            </p>
            <Table
              columns={[
                { key: 'at', label: 'When' },
                { key: 'transaction_reference', label: 'Transaction' },
                { key: 'taxpayer', label: 'Taxpayer' },
                {
                  key: 'amount_kobo',
                  label: 'Amount',
                  render: (row: Record<string, string>) => <Money kobo={row.amount_kobo!} />,
                },
                { key: 'status', label: 'Outcome' },
              ]}
              rows={work.reversals!}
              empty=""
            />
          </div>
        )}

        <div className="card card--flush">
          <QueueTable counts={c} queues={AUDIT_QUEUES} navigate={navigate} />
        </div>
      </>
    );
  }

  // A supervisor's home is their territory's figures, which the dashboard
  // already scopes for them — so they keep it rather than getting a queue
  // screen with nothing on it.
  return null;
}
