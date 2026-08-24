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

import { useEffect, useState } from 'react';
import { ApiRequestError, api, type ApiError, type User } from '../lib/api';
import { Alert, ErrorAlert, Loading, Money, Stat, Table } from '../ui';

type Counts = Record<string, string>;

interface Home {
  role: string;
  admin?: Counts;
  revenue?: Counts;
  finance?: Counts;
  audit?: Counts;
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

  useEffect(() => {
    api
      .get<Home>('/government/home')
      .then(setData)
      .catch((caught) => {
        if (caught instanceof ApiRequestError) setError(caught.error);
      });
  }, []);

  if (error) return <ErrorAlert error={error} />;
  if (!data) return <Loading rows={5} />;

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
