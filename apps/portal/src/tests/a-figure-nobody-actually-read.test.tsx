/**
 * Zero as a fact, and zero as a request that failed.
 *
 * Both screens here answer a failed read with something that looks like an
 * answer. They differ in how loudly.
 *
 * `Performance` was the loud one. Its catch called `setRows([])`, and
 * everything downstream folded an unread page into four confident stat
 * tiles: nought collected, nought onboarded, "0 of 0 agents worked", and
 * nought open fraud flags — that last one rendered without the alert
 * styling, which is to say rendered as good news. A supervisor's whole use
 * of this screen is finding the agent who needs attention, and
 * manufacturing "no flags are open" out of a request nobody answered is
 * the one result that stops them looking. The warning banner naming
 * flagged agents was suppressed by the same empty list.
 *
 * `Dashboard`'s platform KPIs were the quiet one. `.catch(() =>
 * setKpis(null))` with `if (!kpis) return null` made a refusal
 * indistinguishable from a request still in flight, and both
 * indistinguishable from a page that never had the section — two stat
 * grids and a card simply absent, among them the reconciliation rate and
 * the count still awaiting it.
 *
 * Neither is caught by looking at the screen when things work, which is why
 * both survived. These render them refused.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { getTranslation, permissionsForRole, type Role } from '@psirs/shared';
import { PerformanceScreen } from '../screens/Performance';
import { DashboardScreen } from '../screens/Dashboard';
import { ApiRequestError, api } from '../lib/api';
import * as apiModule from '../lib/api';

const en = getTranslation('en');

function signInAs(role: Role) {
  apiModule.setSession(null);
  sessionStorage.setItem(
    'psirs.portal.user',
    JSON.stringify({
      id: 'u1',
      phone: '+2348000000001',
      fullName: 'Supervisor Pam',
      role,
      permissions: permissionsForRole(role),
    }),
  );
}

const user = (role: Role) =>
  ({
    id: 'u1',
    phone: '+2348000000001',
    fullName: 'Supervisor Pam',
    email: null,
    role,
    permissions: permissionsForRole(role),
  }) as never;

const refused = () =>
  new ApiRequestError(
    403,
    {
      code: 'FORBIDDEN',
      message: 'Out of scope for this officer.',
      moneyStatus: 'NOT_APPLICABLE',
    },
    null,
  );

const AGENT = {
  agent_id: 'a1',
  agent_code: 'AGT-001',
  full_name: 'Field Danjuma',
  lga: 'Jos North',
  operational_status: 'ACTIVE',
  successful_transactions: '40',
  failed_transactions: '1',
  reversed_transactions: '0',
  collected_kobo: '250000',
  average_transaction_kobo: '6250',
  taxpayers_onboarded: '7',
  tins_registered: '5',
  vehicle_renewals: '2',
  commission_earned_kobo: '12500',
  open_fraud_flags: '2',
  active_days: '18',
  month_kobo: '250000',
  previous_month_kobo: '200000',
  growth_bp: 2500,
  categories_processed: '3',
};

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

// ===========================================================================
describe('agent performance, when the figures could not be read', () => {
  it('says so instead of showing four zeros', async () => {
    signInAs('supervisor');
    vi.spyOn(api, 'get').mockRejectedValue(refused());

    const { container } = render(<PerformanceScreen navigate={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(en.ofcPfFiguresUnreadable)).toBeTruthy());
    // Not one of the four tiles is on the page, because not one of them was read.
    expect(screen.queryByText(en.ofcPfCollectedByAgents)).toBeNull();
    expect(screen.queryByText(en.ofcPfOpenFraudFlags)).toBeNull();
    expect(container.textContent).not.toContain(
      en.ofcPfWorkedOf.replace('{{worked}}', '0').replace('{{total}}', '0'),
    );
  });

  it('still shows the figures when they were actually read', async () => {
    signInAs('supervisor');
    vi.spyOn(api, 'get').mockResolvedValue([AGENT] as never);

    render(<PerformanceScreen navigate={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(en.ofcPfOpenFraudFlags)).toBeTruthy());
    expect(screen.queryByText(en.ofcPfFiguresUnreadable)).toBeNull();
    expect(screen.getByText(en.ofcPfWorkedOf.replace('{{worked}}', '1').replace('{{total}}', '1'))).toBeTruthy();
    // The agent has two flags, so the warning that names them is on screen —
    // by its own title, since the name itself also appears in the table row.
    expect(
      screen.getByText(en.ofcPfAgentsWithFlag.replace('{{n}}', '1')),
    ).toBeTruthy();
    expect(screen.getAllByText(/Field Danjuma/).length).toBeGreaterThan(1);
  });

  /*
   * The state that must keep working: a real, read, empty agency. Zero is a
   * fine thing to show — it just has to have been read first.
   */
  it('shows honest zeros when there genuinely are no agents', async () => {
    signInAs('supervisor');
    vi.spyOn(api, 'get').mockResolvedValue([] as never);

    render(<PerformanceScreen navigate={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(en.ofcPfOpenFraudFlags)).toBeTruthy());
    expect(screen.queryByText(en.ofcPfFiguresUnreadable)).toBeNull();
    expect(screen.getByText(en.ofcPfWorkedOf.replace('{{worked}}', '0').replace('{{total}}', '0'))).toBeTruthy();
  });
});

// ===========================================================================
const DASHBOARD = {
  collections: {
    today_kobo: '100000', yesterday_kobo: '90000',
    week_kobo: '500000', previous_week_kobo: '400000',
    month_kobo: '2000000', previous_month_kobo: '1800000', previous_month_whole_kobo: '1900000',
    ytd_kobo: '9000000', previous_ytd_kobo: '8000000', total_kobo: '20000000',
    day_growth_bp: 1111, week_growth_bp: 2500, month_growth_bp: 1111, year_growth_bp: 1250,
  },
  counts: {},
  revenueByCategory: [],
  revenueByLga: [],
  revenueByAgent: [],
  revenueByMda: [],
  revenueByChannel: [],
  revenueByTaxpayerType: [],
  revenueByItem: [],
  dailyTrend: [],
  exceptions: { reconciliation_exceptions: '0', open_fraud_flags: '0' },
  scope: { kind: 'STATEWIDE' as const },
};

describe('the dashboard’s own numbers, when they could not be read', () => {
  /*
   * The dashboard itself must load, or this proves nothing: the panel being
   * absent is exactly the failure, so a test where the whole page is absent
   * would pass over it.
   */
  function serve(kpis: 'refused' | Record<string, string>) {
    return vi.spyOn(api, 'get').mockImplementation((async (path: string) => {
      if (path.startsWith('/government/kpis')) {
        if (kpis === 'refused') throw refused();
        return kpis;
      }
      return DASHBOARD;
    }) as never);
  }

  it('says the panel is missing rather than leaving a gap', async () => {
    signInAs('admin');
    serve('refused');

    render(<DashboardScreen navigate={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(en.ofcDbKpisUnreadable)).toBeTruthy());
    // And the rest of the dashboard is still there, which is what made the
    // absence so easy to miss.
    expect(screen.queryByText(en.ofcDbPlatformKpis)).toBeNull();
  });

  it('renders the panel when the numbers arrived', async () => {
    signInAs('admin');
    serve({
      payment_success_rate_percent: '98.5',
      reconciliation_rate_percent: '99.1',
      unreconciled_transactions: '4',
      receipt_generation_rate_percent: '100',
      total_collection_kobo: '20000000',
      active_agents: '12',
      taxpayers_with_tin: '900',
      new_taxpayers_this_month: '30',
      average_completion_seconds: '42',
      reversals: '1',
      suspicious_transactions: '0',
      duplicate_registrations_overridden: '0',
      receipt_verification_failures: '0',
    });

    render(<DashboardScreen navigate={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(en.ofcDbPlatformKpis)).toBeTruthy());
    expect(screen.queryByText(en.ofcDbKpisUnreadable)).toBeNull();
    expect(screen.getByText('99.10%')).toBeTruthy();
  });
});
