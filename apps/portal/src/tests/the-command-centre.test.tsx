/**
 * The three screens an officer could not reach before.
 *
 * These are UI properties, not data properties — the API suite proves the
 * queries are right and that permissions are enforced. What can only be checked
 * here is whether the officer holding the tablet can actually see it, which is
 * the failure this codebase has found repeatedly: a control that exists in the
 * API and is invisible in the portal.
 *
 * Three things in particular:
 *
 *   * A withheld section says it is withheld. The server names what it did not
 *     send precisely so an investigator is never shown an empty commission and
 *     left to conclude the agent earned nothing. That is worth nothing if the
 *     screen renders the list into a variable and drops it.
 *   * The before and after of a change is rendered. `audit_logs` has carried
 *     `old_value` and `new_value` since the platform started, and no screen
 *     had ever printed them.
 *   * A case that is not yours offers no button that would 403.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { TransactionScreen } from '../screens/Transaction';
import { CasesScreen, MyWorkScreen } from '../screens/Cases';
import { GlobalSearch } from '../screens/Search';
import { TargetsScreen } from '../screens/Targets';
import { api } from '../lib/api';
import { Growth } from '../ui';
import * as apiModule from '../lib/api';
import { permissionsForRole, type Role } from '@psirs/shared';

function signInAs(role: Role) {
  // `getUser` memoises, so the cache has to be cleared or the previous role
  // stays in force. Same note as the agent approval suite.
  apiModule.setSession(null);
  sessionStorage.setItem(
    'psirs.portal.user',
    JSON.stringify({
      id: 'u1',
      phone: '+2348000000001',
      fullName: 'Command Officer',
      role,
      permissions: permissionsForRole(role),
    }),
  );
}

const user = (role: Role) =>
  ({
    id: 'u1',
    phone: '+2348000000001',
    fullName: 'Command Officer',
    email: null,
    role,
    permissions: permissionsForRole(role),
  }) as never;

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

// ===========================================================================
const TX = {
  id: 'aa000000-0000-4000-8000-000000000001',
  transaction_reference: 'TXN-2026-000182',
  status: 'SETTLED',
  channel: 'AGENT_PWA',
  amount_kobo: '5000000',
  service_charge_kobo: '0',
  total_amount_kobo: '5000000',
  created_at: '2026-09-01T10:02:11.000Z',
  taxpayer_name: 'Ladi Pamdegu',
  tin: 'PL0012345',
  taxpayer_phone: '+2348129900001',
  agent_code: 'AGT-0001',
  agent_name: 'Musa Danjuma',
  agent_status: 'ACTIVE',
  created_by_name: 'Musa Danjuma',
  created_by_role: 'agent',
  revenue_item: 'Shops and Kiosks Levy',
  revenue_category: 'Local Government Levies',
  mda: null,
  lga: 'Jos North',
  ward: 'Naraguta',
  territory: 'Jos North Central',
  assessment_number: 'ASM-2026-000182',
  base_amount_kobo: '5000000',
  period_label: '2026',
  assessed_at: '2026-09-01T10:02:11.000Z',
  invoice_number: 'INV/2026/000182',
  invoice_total_kobo: '5000000',
  invoice_status: 'PAID',
  invoiced_at: '2026-09-01T10:02:42.000Z',
};

function full(over: Record<string, unknown> = {}) {
  return {
    transaction: TX,
    payments: [
      {
        payment_reference: 'PAY-182',
        gateway: 'PAYSTACK',
        gateway_reference: 'ps_ref_182',
        amount_kobo: '5000000',
        status: 'VERIFIED',
        failure_reason: null,
        verified_at: '2026-09-01T10:04:56.000Z',
        verified_by_source: 'WEBHOOK',
      },
    ],
    receipt: {
      receipt_number: 'PSIRS/2026/000182',
      verification_code: 'ABC123',
      status: 'VALID',
      issued_at: '2026-09-01T10:04:58.000Z',
      void_reason: null,
    },
    refunds: [],
    settlement: {
      settlement_reference: 'STL-0001',
      status: 'RECONCILED',
      bank_reference: 'CREDIT-1',
      settlement_date: '2026-09-02',
      received_amount_kobo: '5000000',
      government_account: 'PSIRS Collections',
      reconciled_by_name: 'Finance Bala',
      reconciled_at: '2026-09-02T09:00:00.000Z',
    },
    reconciliation: [],
    commission: {
      amount_kobo: '250000',
      status: 'PAID',
      rate_basis_points: 500,
      policy_name: 'Standard',
      hold_reason: null,
      payout_reference: 'PO-0001',
      payout_status: 'PAID',
      payout_bank_reference: 'BNK-1',
      payout_failure: null,
    },
    timeline: [
      {
        at: '2026-09-01T10:02:11.000Z',
        source: 'STATE',
        label: 'ASSESSMENT_CREATED',
        detail: null,
        actor: 'AGENT',
        actor_role: null,
      },
      {
        at: '2026-09-03T14:00:00.000Z',
        source: 'AUDIT',
        label: 'catalogue.rate.change',
        detail: 'Council resolution 2026/14',
        actor: 'Admin Dung',
        actor_role: 'admin',
        result: 'SUCCESS',
        old_value: { amountKobo: '2500000' },
        new_value: { amountKobo: '3000000' },
      },
    ],
    cases: [],
    flags: [],
    withheld: [],
    ...over,
  };
}

describe('the transaction file', () => {
  it('shows the chain from the taxpayer to the government account', async () => {
    signInAs('admin');
    vi.spyOn(api, 'get').mockResolvedValue(full() as never);

    render(<TransactionScreen transactionKey={TX.transaction_reference} navigate={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('TXN-2026-000182')).toBeTruthy());
    for (const shown of [
      /Ladi Pamdegu/,
      /AGT-0001/,
      /Shops and Kiosks Levy/,
      /ASM-2026-000182/,
      /INV\/2026\/000182/,
      /ps_ref_182/,
      /PSIRS\/2026\/000182/,
      /STL-0001/,
      /PO-0001/,
    ]) {
      expect(screen.getAllByText(shown).length, `${shown} is missing`).toBeGreaterThan(0);
    }
  });

  /*
   * The property the `withheld` list exists for.
   *
   * A supervisor sees this page without the settlement. If the screen simply
   * rendered nothing there, an officer would read "no settlement" — that the
   * money never arrived — from a section they are not allowed to see.
   */
  it('says which sections its reader is not allowed to see', async () => {
    signInAs('supervisor');
    vi.spyOn(api, 'get').mockResolvedValue(
      full({ settlement: null, commission: null, withheld: ['settlement', 'audit'] }) as never,
    );

    render(<TransactionScreen transactionKey={TX.id} navigate={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('TXN-2026-000182')).toBeTruthy());
    expect(screen.getAllByText(/Not shown to your role/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/settlement, audit/)).toBeTruthy();
    // And never the sentence that would be a false statement about the money.
    expect(screen.queryByText(/has not reached the government account/i)).toBeNull();
  });

  /*
   * Before and after, rendered.
   *
   * These columns have been written on every change since the platform started
   * and no screen had ever printed them, so "who changed this, and what did it
   * say before" was answerable only by exporting the audit log as CSV and
   * reading JSON out of a spreadsheet cell.
   */
  it('prints what a change was before and what it became', async () => {
    signInAs('auditor');
    vi.spyOn(api, 'get').mockResolvedValue(full() as never);

    render(<TransactionScreen transactionKey={TX.id} navigate={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/catalogue.rate.change/)).toBeTruthy());
    /*
     * The diff, not both sides in full. Both screens now share one renderer,
     * and it prints only the fields that moved: a reader asked to spot which
     * of fourteen fields changed does not spot it.
     */
    expect(screen.getByText('amountKobo')).toBeTruthy();
    expect(screen.getByText('2500000')).toBeTruthy();
    expect(screen.getByText('3000000')).toBeTruthy();
  });

  it('tells the platform’s record apart from an officer’s action', async () => {
    signInAs('auditor');
    vi.spyOn(api, 'get').mockResolvedValue(full() as never);

    render(<TransactionScreen transactionKey={TX.id} navigate={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/ASSESSMENT_CREATED/)).toBeTruthy());
    expect(screen.getAllByText(/^Platform$/).length).toBe(1);
    expect(screen.getAllByText(/^Officer action$/).length).toBe(1);
  });
});

// ===========================================================================
const CASE = {
  id: 'cc000000-0000-4000-8000-000000000001',
  case_number: 'CASE-2026-000001',
  subject: 'Unusual collection pattern',
  description: 'Collections trebled in one week.',
  category: 'REVENUE_ANOMALY',
  status: 'INVESTIGATING',
  priority: 'HIGH',
  risk_level: 'HIGH',
  department: 'auditor',
  due_at: null,
  created_at: '2026-09-01T09:00:00.000Z',
  overdue: false,
  assignee_name: 'Auditor Ngo',
  opened_by_name: 'Revenue Ladi',
  transaction_reference: null,
  transaction_id: null,
  transaction_amount_kobo: null,
  transaction_status: null,
  agent_code: null,
  agent_name: null,
  taxpayer_name: null,
  tin: null,
  lga_name: null,
  subject_user_name: null,
  resolution: null,
  resolved_by_name: null,
  comment_count: '1',
  evidence_count: '0',
  may_work: true,
  attachable: [
    {
      id: 'd1',
      document_number: 'PSIRS/2026/000182',
      document_type: 'RECEIPT',
      issued_at: '2026-09-01T10:04:58.000Z',
    },
  ],
  events: [
    {
      id: 'e1',
      sequence_no: '1',
      kind: 'OPENED',
      body: 'Collections trebled in one week.',
      old_value: null,
      new_value: null,
      created_at: '2026-09-01T09:00:00.000Z',
      actor_name: 'Revenue Ladi',
      actor_role: 'revenue_officer',
      mention_names: [],
    },
    {
      id: 'e2',
      sequence_no: '2',
      kind: 'ASSIGNMENT',
      body: 'Taking this one.',
      old_value: { assigneeId: null },
      new_value: { assigneeId: 'u9' },
      created_at: '2026-09-01T09:30:00.000Z',
      actor_name: 'Auditor Ngo',
      actor_role: 'auditor',
      mention_names: ['Finance Bala'],
    },
  ],
};

describe('a case', () => {
  it('shows its whole history, and says the history cannot be edited', async () => {
    signInAs('auditor');
    vi.spyOn(api, 'get').mockResolvedValue(CASE as never);

    render(
      <CasesScreen
        user={user('auditor')}
        route={`/cases?case=${CASE.id}`}
        navigate={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(/CASE-2026-000001/)).toBeTruthy());
    /*
     * Twice: once as the case's description, once as the OPENED event.
     *
     * That is deliberate. The header is the case as it stands and the history
     * is what produced it, and a history that leaves out the opening text is
     * one that cannot be replayed into the header — which is the property the
     * append-only table exists to have.
     */
    expect(screen.getAllByText(/Collections trebled in one week\./).length).toBe(2);
    expect(screen.getByText(/Taking this one\./)).toBeTruthy();
    expect(screen.getByText(/@ Finance Bala/)).toBeTruthy();
    expect(screen.getByText(/Nothing here can be edited or removed/i)).toBeTruthy();
  });

  /*
   * A specialist answering a question on somebody else's case can comment and
   * cannot move it. Offering the buttons anyway would put a 403 behind each
   * one, which is how an officer learns the platform is unreliable rather than
   * that they lack authority.
   */
  it('offers no control an officer would be refused', async () => {
    signInAs('finance_officer');
    vi.spyOn(api, 'get').mockResolvedValue({ ...CASE, may_work: false } as never);

    render(
      <CasesScreen
        user={user('finance_officer')}
        route={`/cases?case=${CASE.id}`}
        navigate={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(/CASE-2026-000001/)).toBeTruthy());
    // They may say something.
    expect(screen.getByRole('button', { name: /Post/i })).toBeTruthy();
    // And are told why they may do nothing else.
    expect(screen.getByText(/not assigned to you and you did not open it/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Change the status/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Move this case/i })).toBeNull();
  });

  it('will not let an officer resolve a case without saying what it concluded', async () => {
    signInAs('auditor');
    vi.spyOn(api, 'get').mockResolvedValue(CASE as never);

    render(
      <CasesScreen user={user('auditor')} route={`/cases?case=${CASE.id}`} navigate={vi.fn()} />,
    );

    await waitFor(() => expect(screen.getByText(/CASE-2026-000001/)).toBeTruthy());
    // By its label, not its position: the controls above it grew once already,
    // and an index would have made this test pass while pointing at the
    // evidence picker.
    const status = screen.getByLabelText('Status');
    fireEvent.change(status, { target: { value: 'RESOLVED' } });

    expect(screen.getByText(/Say what the case concluded/i)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /Change the status/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

// ===========================================================================
describe('my work', () => {
  const work = {
    counts: { assigned_open: '2', assigned_overdue: '1', opened_open: '1', department_unassigned: '3', mentions: '1' },
    assigned: [{ ...CASE, id: 'c1', case_number: 'CASE-2026-000002', due_at: '2026-08-01T00:00:00.000Z', overdue: true }],
    opened: [],
    mentions: [
      {
        case_id: 'c9',
        case_number: 'CASE-2026-000009',
        subject: 'Settlement short',
        body: 'Can you confirm what arrived?',
        actor_name: 'Auditor Ngo',
        created_at: '2026-09-02T11:00:00.000Z',
      },
    ],
    unassigned: [],
    approvals: [],
    exceptions: [],
    flags: [],
  };

  it('gathers the queues an officer would otherwise go looking for', async () => {
    signInAs('finance_officer');
    vi.spyOn(api, 'get').mockResolvedValue(work as never);

    render(<MyWorkScreen user={user('finance_officer')} />);

    await waitFor(() => expect(screen.getByText(/CASE-2026-000002/)).toBeTruthy());
    expect(screen.getByText(/Can you confirm what arrived\?/)).toBeTruthy();
    expect(screen.getByText(/Auditor Ngo/)).toBeTruthy();
  });

  it('says so plainly when nothing is waiting', async () => {
    signInAs('auditor');
    vi.spyOn(api, 'get').mockResolvedValue({
      counts: {},
      assigned: [],
      opened: [],
      mentions: [],
      unassigned: [],
      approvals: [],
      exceptions: [],
      flags: [],
    } as never);

    render(<MyWorkScreen user={user('auditor')} />);

    await waitFor(() => expect(screen.getByText(/Nothing is waiting for you/i)).toBeTruthy());
  });
});

// ===========================================================================
describe('the search box', () => {
  it('takes a reference and offers what it could be', async () => {
    signInAs('admin');
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      term: 'TXN-2026-000182',
      hits: [
        {
          kind: 'transaction',
          id: TX.id,
          reference: 'TXN-2026-000182',
          title: 'TXN-2026-000182',
          subtitle: 'Ladi Pamdegu · Shops and Kiosks Levy',
          path: `/transaction/${TX.id}`,
          amount_kobo: '5000000',
          status: 'SETTLED',
          occurred_at: null,
        },
      ],
    } as never);

    const navigate = vi.fn();
    render(<GlobalSearch navigate={navigate} />);

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'TXN-2026-000182' } });

    await waitFor(() => expect(get).toHaveBeenCalled(), { timeout: 2000 });
    await waitFor(() => expect(screen.getByRole('option')).toBeTruthy());
    expect(screen.getByText(/Ladi Pamdegu · Shops and Kiosks Levy/)).toBeTruthy();

    fireEvent.click(screen.getByRole('option'));
    expect(navigate).toHaveBeenCalledWith(`/transaction/${TX.id}`);
  });

  /*
   * One character is not a search.
   *
   * Firing on every keystroke from the first would make this the busiest
   * endpoint on the platform, and `q=a` is not a question anybody is asking.
   */
  it('does not search until there is something to search for', async () => {
    signInAs('admin');
    const get = vi.spyOn(api, 'get').mockResolvedValue({ term: 'a', hits: [] } as never);

    render(<GlobalSearch navigate={vi.fn()} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'a' } });

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(get).not.toHaveBeenCalled();
  });
});

// ===========================================================================
describe('targets and the forecast beside them', () => {
  const period = { periodStart: '2026-09-01', periodEnd: '2026-09-30' };

  const target = {
    id: 't1',
    scope: 'LGA',
    period_kind: 'MONTHLY',
    period_start: '2026-09-01',
    period_end: '2026-09-30',
    target_kobo: '10000000',
    collected_kobo: '2000000',
    days_elapsed: 24,
    days_in_period: 30,
    status: 'ACTIVE',
    note: null,
    lga_name: 'Jos North',
    category_name: null,
    item_name: null,
    agent_code: null,
    agent_name: null,
    set_by_name: 'Revenue Ladi',
  };

  const rollup = {
    state_target_kobo: '100000000',
    lga_targets_kobo: '30000000',
    lgas_with_a_target: '3',
    lgas_total: '17',
    category_targets_kobo: '0',
    agent_targets_kobo: '0',
  };

  function mock(forecast: Record<string, unknown>) {
    return vi.spyOn(api, 'get').mockImplementation((path: string) => {
      if (path.includes('/targets/period')) return Promise.resolve(period) as never;
      if (path.includes('/targets/rollup')) return Promise.resolve(rollup) as never;
      if (path.includes('/forecast')) return Promise.resolve(forecast) as never;
      if (path.includes('/government/targets')) return Promise.resolve([target]) as never;
      return Promise.resolve([]) as never;
    });
  }

  const seasonal = {
    is_forecast: true,
    basis: 'SEASONAL',
    confidence: 'HIGH',
    period_start: '2026-09-01',
    period_end: '2026-09-30',
    days_elapsed: 24,
    days_in_period: 30,
    collected_kobo: '2000000',
    projected_kobo: '2666666',
    seasonal_share_bp: 7500,
    comparable_periods: 3,
    target_kobo: '10000000',
    projected_achievement_bp: 2666,
    explanation_key: 'forecastSeasonal',
  };

  /*
   * The property the brief asks for by name: a forecast is labelled a forecast.
   *
   * There is no code path that renders `projected_kobo` without the warning,
   * the basis and the confidence beside it. A projection shown as a bare figure
   * is how an estimate becomes a number a Council budgets against.
   */
  it('never shows a projection without saying it is one', async () => {
    signInAs('revenue_officer');
    mock(seasonal);

    render(<TargetsScreen user={user('revenue_officer')} />);

    await waitFor(() => expect(screen.getByText(/Forecast/)).toBeTruthy());
    expect(screen.getByText(/not a target and not guaranteed revenue/i)).toBeTruthy();
    expect(screen.getByText(/Collection curve/)).toBeTruthy();
    expect(screen.getByText(/previous years are used/i)).toBeTruthy();
    expect(screen.getByText(/75\.0%/)).toBeTruthy();
  });

  it('explains a run rate as the weaker estimate it is', async () => {
    signInAs('admin');
    mock({
      ...seasonal,
      basis: 'RUN_RATE',
      confidence: 'LOW',
      seasonal_share_bp: null,
      comparable_periods: 0,
      explanation_key: 'forecastRunRate',
    });

    render(<TargetsScreen user={user('admin')} />);

    await waitFor(() => expect(screen.getByText(/Run rate/)).toBeTruthy());
    expect(screen.getByText(/not enough history to know the collection curve/i)).toBeTruthy();
  });

  /*
   * 20% of a monthly target is excellent on the 6th and alarming on the 24th.
   *
   * A bare achievement percentage says neither, so the elapsed share of the
   * period is printed beside it and the figure is marked when it is behind.
   */
  it('shows achievement against how far through the period it is', async () => {
    signInAs('admin');
    mock(seasonal);

    render(<TargetsScreen user={user('admin')} />);

    await waitFor(() => expect(screen.getByText('20.0%')).toBeTruthy());
    expect(screen.getByText(/80% Through the period/)).toBeTruthy();
    expect(screen.getByText('20.0%').className).toContain('danger-text');
  });

  it('counts the LGAs with no target rather than complaining about the gap', async () => {
    signInAs('admin');
    mock(seasonal);

    render(<TargetsScreen user={user('admin')} />);

    await waitFor(() => expect(screen.getByText(/apportioned below it/i)).toBeTruthy());
    // 17 LGAs, three with a target.
    expect(screen.getByText('14')).toBeTruthy();
    expect(screen.getByText(/These do not have to agree/i)).toBeTruthy();
  });

  it('offers no target controls to a role that cannot set one', async () => {
    signInAs('auditor');
    mock(seasonal);

    render(<TargetsScreen user={user('auditor')} />);

    await waitFor(() => expect(screen.getByText(/Revenue targets/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Set a target/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Withdraw/i })).toBeNull();
  });
});

// ===========================================================================
describe('a change against the period before', () => {
  /*
   * The property that decides whether the second column is honest.
   *
   * A ward deployed this month, or a levy introduced last week, collected
   * nothing in the previous period. That is not zero growth, and rendering it
   * as "0.0%" is a claim the data does not support — on exactly the rows an
   * officer is most likely to be looking at.
   */
  it('says there is nothing to compare rather than showing zero', () => {
    render(<Growth basisPoints={null} />);
    expect(screen.getByText(/nothing collected then/i)).toBeTruthy();
    expect(screen.queryByText(/0\.0%/)).toBeNull();
  });

  it('carries direction in the sign and the arrow, not only in colour', () => {
    const { unmount } = render(<Growth basisPoints={4823} />);
    expect(screen.getByText(/▲ \+48\.2%/)).toBeTruthy();
    unmount();

    render(<Growth basisPoints={-5000} />);
    expect(screen.getByText(/▼ -50\.0%/)).toBeTruthy();
  });

  it('treats a flat period as flat, not as a rise', () => {
    render(<Growth basisPoints={0} />);
    const rendered = screen.getByText(/0\.0%/);
    expect(rendered.className).toContain('muted');
    expect(rendered.textContent).not.toContain('▲');
  });
});
