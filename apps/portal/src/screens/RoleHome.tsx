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
import { usePortalI18n } from '../lib/i18n';
import type { TranslationDictionary } from '@psirs/shared';

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
  /**
   * Dictionary keys, not text.
   *
   * These arrays are module-level and cannot reach a hook, so `QueueTable`
   * resolves them where it renders. Typing them as `keyof
   * TranslationDictionary` is what stops a queue being added with an English
   * label no dictionary could reach.
   */
  label: keyof TranslationDictionary;
  hint: keyof TranslationDictionary;
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
  const { t } = usePortalI18n();
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
    label: 'ofcRhAgentsAwaitingClearance',
    hint: 'ofcRhApplicationsComplete',
    path: '/agents',
    attentionWhen: nonZero,
  },
  {
    key: 'agents_needing_information',
    label: 'ofcRhAgentsAskedForMore',
    hint: 'ofcRhWaitingOnApplicant',
    path: '/agents',
  },
  {
    key: 'devices_awaiting_approval',
    label: 'ofcRhDevicesAwaitingApproval',
    hint: 'ofcRhAgentNeedsHandset',
    path: '/agents',
    attentionWhen: nonZero,
  },
  {
    key: 'supervisors_without_a_territory',
    label: 'ofcRhSupervisorsNoTerritory',
    hint: 'ofcRhNoFiguresUntilTerritory',
    path: '/users',
    attentionWhen: nonZero,
  },
  {
    key: 'revenue_items_awaiting_a_rate',
    label: 'ofcRhItemsNoRate',
    hint: 'ofcRhNotCollectableYet',
    path: '/catalogue',
  },
  {
    key: 'mdas_with_no_revenue_item',
    label: 'ofcRhMdasCollectingNothing',
    hint: 'ofcRhNoItemForMda',
    path: '/revenue',
  },
  { key: 'active_officers', label: 'ofcRhOfficersWithAccess', hint: 'ofcRhExcludingFieldAgents', path: '/users' },
  { key: 'open_tickets', label: 'ofcRhSupportTicketsOpen', hint: 'ofcRhRaisedByAgents', path: '/support' },
];

const REVENUE_QUEUES: Queue[] = [
  {
    key: 'tins_failed',
    label: 'ofcRhTinApplicationsFailed',
    hint: 'ofcRhRegisterRefusedThese',
    path: '/taxpayer-records',
    attentionWhen: nonZero,
  },
  {
    key: 'tins_outstanding',
    label: 'ofcRhTinsOutstanding',
    hint: 'ofcRhAppliedNotIssued',
    path: '/taxpayer-records',
  },
  {
    key: 'corrections_awaiting_review',
    label: 'ofcRhCorrectionsAwaiting',
    hint: 'ofcRhSomeoneAskedChange',
    path: '/approvals',
    attentionWhen: nonZero,
  },
  { key: 'invoices_unpaid', label: 'ofcRhInvoicesUnpaid', hint: 'ofcRhRaisedStillOpen', path: '/outstanding' },
  {
    key: 'invoices_expired',
    label: 'ofcRhInvoicesExpired',
    hint: 'ofcRhNeverPaidOutOfTime',
    path: '/outstanding',
  },
  { key: 'registered_this_week', label: 'ofcRhRegisteredThisWeek', hint: 'ofcRhNewTaxpayers' },
  { key: 'taxpayers', label: 'ofcRhTaxpayersOnRegister', hint: 'ofcRhActiveRecords' },
];

const FINANCE_QUEUES: Queue[] = [
  {
    key: 'reconciliation_exceptions',
    label: 'ofcRhReconciliationExceptions',
    hint: 'ofcRhDisagreeAboutThese',
    path: '/reconciliation',
    attentionWhen: nonZero,
  },
  {
    key: 'settlements_unreconciled',
    label: 'ofcRhSettlementsUnreconciled',
    hint: 'ofcRhReceivedNotMatched',
    path: '/reconciliation',
    attentionWhen: nonZero,
  },
  {
    key: 'payouts_awaiting_approval',
    label: 'ofcRhPayoutsToApprove',
    hint: 'ofcRhAgentsWaitingShort',
    path: '/commissions',
    attentionWhen: nonZero,
  },
  {
    key: 'refunds_outstanding',
    label: 'ofcRhRefundsOwed',
    hint: 'ofcRhMoneyStateShouldNotHave',
    path: '/outstanding',
    attentionWhen: nonZero,
  },
];

const AUDIT_QUEUES: Queue[] = [
  {
    key: 'fraud_flags_open',
    label: 'ofcRhFraudOpen',
    hint: 'ofcRhRaisedNotReviewed',
    path: '/fraud',
    attentionWhen: nonZero,
  },
  {
    key: 'reversed_or_refunded',
    label: 'ofcRhReversedRefunded',
    hint: 'ofcRhMoneyBackOutQuery',
    path: '/audit',
  },
  {
    key: 'refused_this_week',
    label: 'ofcRhActionsRefusedWeek',
    hint: 'ofcRhSomeoneTriedNotPermitted',
    path: '/audit',
  },
  {
    key: 'rate_changes_this_month',
    label: 'ofcRhRateChangesMonth',
    hint: 'ofcRhEveryChangeCharged',
    path: '/audit',
  },
  { key: 'receipt_checks_this_week', label: 'ofcRhReceiptsCheckedPublic', hint: 'ofcRhVerificationLookups' },
  { key: 'entries_today', label: 'ofcRhAuditEntriesToday', hint: 'ofcRhHashChainedLong' },
  { key: 'audit_entries', label: 'ofcRhAuditEntriesTotal', hint: 'ofcRhSincePlatformStarted' },
  { key: 'taxpayers_on_record', label: 'ofcRhTaxpayersOnRecord', hint: 'ofcRhActiveRecords' },
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
  const { t } = usePortalI18n();
  const rows = queues.map((queue) => ({ ...queue, value: counts[queue.key] ?? '0' }));
  return (
    <Table
      columns={[
        {
          key: 'label',
          label: 'ofcRhWaiting',
          render: (row: (typeof rows)[number]) => (
            <>
              <strong>{t[row.label]}</strong>
              <br />
              <span className="list__meta">{t[row.hint]}</span>
            </>
          ),
        },
        {
          key: 'value',
          label: { text: '' },
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
          label: { text: '' },
          render: (row: (typeof rows)[number]) =>
            row.path ? (
              <button type="button" className="small secondary" onClick={() => navigate(row.path!)}>{t.ofcRhOpen}</button>
            ) : null,
        },
      ]}
      rows={rows}
      empty="ofcRhNothingWaiting"
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
  const { t } = usePortalI18n();
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
          <p className="card__hint">{t.ofcRhAdminIntro}</p>
        </div>
        {blocked > 0 && (
          <Alert kind="warning" title={{ text: t.ofcRhBlockedCount.replace('{{n}}', String(blocked)) }}>
            <p style={{ margin: 0 }}>{t.ofcRhAdminBody}</p>
          </Alert>
        )}
        <Worked error={action.error} done={action.done} />

        {(work.agents ?? []).length > 0 && (
          <div className="card card--flush">
            <h2 className="card__title" style={{ padding: '14px 18px 0' }}>{t.ofcRhAgentsWaiting}</h2>
            <p className="card__hint" style={{ padding: '0 18px' }}>{t.ofcRhClearanceBody}</p>
            <Table
              columns={[
                { key: 'agent_code', label: 'ofcRhAgent' },
                { key: 'full_name', label: 'tpName' },
                { key: 'lga', label: 'tpLgaShort' },
                { key: 'waiting_since', label: 'ofcRhWaitingSince' },
                {
                  key: 'act',
                  label: { text: '' },
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
                                note: 'ofcRhApprovedFromHome',
                              }),
                            `${row.full_name} approved.`,
                          )
                        }
                      >{t.ofcRhApprove}</button>{' '}
                      <button
                        type="button"
                        className="small secondary"
                        onClick={() => navigate('/agents')}
                      >{t.ofcRhOpenFile}</button>
                    </>
                  ),
                },
              ]}
              rows={work.agents!}
              empty={{ text: '' }}
            />
          </div>
        )}

        {(work.devices ?? []).length > 0 && (
          <div className="card card--flush">
            <h2 className="card__title" style={{ padding: '14px 18px 0' }}>{t.ofcRhHandsetsWaiting}</h2>
            <p className="card__hint" style={{ padding: '0 18px' }}>{t.ofcRhHandsetsBody}</p>
            <Table
              columns={[
                { key: 'agent_code', label: 'ofcRhAgent' },
                { key: 'full_name', label: 'tpName' },
                { key: 'device_name', label: 'appDeviceLabel' },
                { key: 'registered', label: 'ofcRhRegistered' },
                {
                  key: 'act',
                  label: { text: '' },
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
                    >{t.ofcRhApprove}</button>
                  ),
                },
              ]}
              rows={work.devices!}
              empty={{ text: '' }}
            />
          </div>
        )}

        {(work.supervisors ?? []).length > 0 && (
          <div className="card card--flush">
            <h2 className="card__title" style={{ padding: '14px 18px 0' }}>{t.ofcRhSupervisorsNothing}</h2>
            <p className="card__hint" style={{ padding: '0 18px' }}>{t.ofcRhSupervisorsBody}</p>
            <Table
              columns={[
                { key: 'full_name', label: 'ofcRhOfficer' },
                { key: 'phone', label: 'tpPhone' },
                {
                  key: 'act',
                  label: { text: '' },
                  render: () => (
                    <button
                      type="button"
                      className="small secondary"
                      onClick={() => navigate('/users')}
                    >{t.ofcRhAssignTerritories}</button>
                  ),
                },
              ]}
              rows={work.supervisors!}
              empty={{ text: '' }}
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
          <h2 className="card__title">{t.ofcRhTheRegister}</h2>
          <p className="card__hint">{t.ofcRhRegisterBody}</p>
        </div>
        <div className="stat-grid">
          <Stat
            label="ofcRhAssessedUnpaid"
            value={<Money kobo={c.unpaid_kobo} />}
            variant="accent"
            hint={{ text: t.ofcRhInvoicesStillOpen.replace('{{n}}', String(c.invoices_unpaid)) }}
          />
          <Stat label="ofcRhTaxpayers" value={c.taxpayers} hint="ofcRhActiveRecords" />
          <Stat label="ofcRhNewThisWeek" value={c.registered_this_week} hint="ofcRhRegisteredByBoth" />
          <Stat
            label="ofcRhTinsOutstanding"
            value={c.tins_outstanding}
            hint="ofcRhTinNoTracking"
          />
        </div>
        <Worked error={action.error} done={action.done} />

        {(work.failedTins ?? []).length > 0 && (
          <div className="card card--flush">
            <h2 className="card__title" style={{ padding: '14px 18px 0' }}>{t.ofcRhTinRefused}</h2>
            <p className="card__hint" style={{ padding: '0 18px' }}>{t.ofcRhTinsBody}</p>
            <Table
              columns={[
                { key: 'name', label: 'colTaxpayerLabel' },
                { key: 'phone', label: 'tpPhone' },
                { key: 'tin_reason', label: 'ofcRhWhyFailed' },
              ]}
              rows={work.failedTins!}
              empty={{ text: '' }}
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
            <h2 className="card__title" style={{ padding: '14px 18px 0' }}>{t.ofcRhInvoicesExpiring}</h2>
            <p className="card__hint" style={{ padding: '0 18px' }}>{t.ofcRhInvoicesBody}</p>
            <Table
              columns={[
                { key: 'invoice_number', label: 'colInvoiceLabel' },
                { key: 'taxpayer', label: 'colTaxpayerLabel' },
                {
                  key: 'amount_kobo',
                  label: 'pubVerifyAmount',
                  render: (row: Record<string, string>) => <Money kobo={row.amount_kobo!} />,
                },
                { key: 'expires_on', label: 'ofcRhExpires' },
                {
                  key: 'doc',
                  label: { text: '' },
                  render: (row: Record<string, string>) => (
                    <button
                      type="button"
                      className="small secondary"
                      disabled={action.busy !== null}
                      onClick={() =>
                        action.act(
                          `doc-${row.id}`,
                          () => api.post(`/revenue/invoices/${row.id}/document`, {}),
                          `Invoice document ready for ${row.invoice_number}.`,
                        )
                      }
                    >
                      {action.busy === `doc-${row.id}` ? 'Preparing…' : 'Invoice document'}
                    </button>
                  ),
                },
              ]}
              rows={work.expiring!}
              empty={{ text: '' }}
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
          <h2 className="card__title">{t.ofcRhMoneyInOut}</h2>
          <p className="card__hint">{t.ofcRhMoneyBody}</p>
        </div>
        <div className="stat-grid">
          <Stat
            label="ofcRhOwedToCouncils"
            value={<Money kobo={c.owed_to_councils_kobo} />}
            variant="accent"
            hint="ofcRhCollectedForCouncils"
          />
          <Stat
            label="ofcRhCommissionLiability"
            value={<Money kobo={c.commission_liability_kobo} />}
            hint="ofcRhAccruedNotPaid"
          />
          <Stat
            label="ofcRhSettlementVariance"
            value={<Money kobo={c.settlement_variance_kobo} />}
            hint="ofcRhExpectedLessReceived"
          />
          <Stat
            label="ofcRhExceptions"
            value={c.reconciliation_exceptions}
            hint="ofcRhBankPlatformDisagree"
          />
        </div>
        {Number(c.reconciliation_exceptions) > 0 && (
          <Alert kind="warning" title="ofcRhReconciliationOpen">
            <p style={{ margin: 0 }}>{t.ofcRhReconciliationBody}</p>
          </Alert>
        )}
        <Worked error={action.error} done={action.done} />

        {(work.exceptions ?? []).length > 0 && (
          <div className="card card--flush">
            <h2 className="card__title" style={{ padding: '14px 18px 0' }}>{t.ofcRhBankDisagree}</h2>
            <p className="card__hint" style={{ padding: '0 18px' }}>{t.ofcRhExceptionQueueBody}</p>
            <Table
              columns={[
                { key: 'status', label: 'ofcRhKind' },
                { key: 'gateway_reference', label: 'colGatewayReference' },
                {
                  key: 'expected_kobo',
                  label: 'ofcRhExpected',
                  render: (row: Record<string, string>) => <Money kobo={row.expected_kobo ?? '0'} />,
                },
                {
                  key: 'received_kobo',
                  label: 'ofcRhReceived',
                  render: (row: Record<string, string>) => <Money kobo={row.received_kobo ?? '0'} />,
                },
                { key: 'raised', label: 'ofcRhRaisedHeading' },
              ]}
              rows={work.exceptions!}
              empty={{ text: '' }}
            />
            <div style={{ padding: '0 18px 16px' }}>
              <button type="button" className="secondary" onClick={() => navigate('/reconciliation')}>{t.ofcRhWorkExceptionQueue}</button>
            </div>
          </div>
        )}

        {(work.payouts ?? []).length > 0 && (
          <div className="card card--flush">
            <h2 className="card__title" style={{ padding: '14px 18px 0' }}>{t.ofcRhCommissionPayouts}</h2>
            <p className="card__hint" style={{ padding: '0 18px' }}>{t.ofcRhAgentsWaitingBody}</p>
            <Table
              columns={[
                { key: 'agent', label: 'ofcRhAgent' },
                { key: 'payout_reference', label: 'errReference' },
                {
                  key: 'amount_kobo',
                  label: 'pubVerifyAmount',
                  render: (row: Record<string, string>) => <Money kobo={row.amount_kobo!} />,
                },
                { key: 'commissions', label: 'ofcNavCommissions' },
                { key: 'requested', label: 'ofcRhRequested' },
                {
                  key: 'act',
                  label: { text: '' },
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
                    >{t.ofcRhApprove}</button>
                  ),
                },
              ]}
              rows={work.payouts!}
              empty={{ text: '' }}
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
          <h2 className="card__title">{t.ofcRhWhatToExamine}</h2>
          <p className="card__hint">{t.ofcRhReadOnlyBody}</p>
        </div>
        <div className="stat-grid">
          <Stat label="ofcRhAuditEntries" value={c.audit_entries} variant="accent" hint="ofcRhHashChainedShort" />
          <Stat label="ofcRhToday" value={c.entries_today} hint="ofcRhEntriesSinceMidnight" />
          <Stat label="ofcRhReversedRefunded" value={c.reversed_or_refunded} hint="ofcRhMoneyBackOut" />
          <Stat label="ofcRhFraudOpen" value={c.fraud_flags_open} hint="ofcRhRaisedNotReviewed" />
        </div>
        {(work.refusals ?? []).length > 0 && (
          <div className="card card--flush">
            <h2 className="card__title" style={{ padding: '14px 18px 0' }}>{t.ofcRhRefusedActions}</h2>
            <p className="card__hint" style={{ padding: '0 18px' }}>{t.ofcRhRefusedBody}</p>
            <Table
              columns={[
                { key: 'at', label: 'ofcRhWhen' },
                { key: 'actor_role', label: 'ofcRhRole' },
                { key: 'action', label: 'ofcRhAttempted' },
                { key: 'entity_type', label: 'ofcRhAgainst' },
              ]}
              rows={work.refusals!}
              empty={{ text: '' }}
            />
          </div>
        )}

        {(work.reversals ?? []).length > 0 && (
          <div className="card card--flush">
            <h2 className="card__title" style={{ padding: '14px 18px 0' }}>{t.ofcRhMoneyBackOut}</h2>
            <p className="card__hint" style={{ padding: '0 18px' }}>{t.ofcRhReversedBody}</p>
            <Table
              columns={[
                { key: 'at', label: 'ofcRhWhen' },
                { key: 'transaction_reference', label: 'supTransactionLabel' },
                { key: 'taxpayer', label: 'colTaxpayerLabel' },
                {
                  key: 'amount_kobo',
                  label: 'pubVerifyAmount',
                  render: (row: Record<string, string>) => <Money kobo={row.amount_kobo!} />,
                },
                { key: 'status', label: 'ofcRhOutcome' },
              ]}
              rows={work.reversals!}
              empty={{ text: '' }}
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
