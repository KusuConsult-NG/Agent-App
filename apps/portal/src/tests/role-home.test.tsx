/**
 * Four officers, four first screens.
 *
 * Every role landed on the same executive dashboard — this morning's
 * collections, revenue by category, the daily trend. It is a good screen and
 * it was the wrong first screen for four of the five roles that saw it. An
 * auditor opening the platform does not need today's takings; a finance
 * officer does not need the agent clearance queue; a revenue officer needed
 * neither and was shown both.
 *
 * These assert that each role gets its own, and — the part that would rot
 * quietest — that no role is shown another's work.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { RoleHomeScreen } from '../screens/RoleHome';
import { api } from '../lib/api';

const user = (role: string) =>
  ({ id: 'u1', role, fullName: 'Test Officer', phone: '+2348000000001' }) as never;

function serve(payload: Record<string, unknown>) {
  vi.spyOn(api, 'get').mockResolvedValue(payload as never);
}

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the administrator’s first screen', () => {
  beforeEach(() => {
    serve({
      role: 'admin',
      admin: {
        agents_awaiting_review: '3',
        agents_needing_information: '1',
        devices_awaiting_approval: '2',
        active_officers: '5',
        supervisors_without_a_territory: '1',
        revenue_items_awaiting_a_rate: '7',
        mdas_with_no_revenue_item: '1',
        open_tickets: '0',
      },
    });
  });

  it('shows the clearance queue', async () => {
    render(<RoleHomeScreen user={user('admin')} navigate={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Agents awaiting clearance/i)).toBeTruthy());
  });

  it('warns when somebody is blocked from working', async () => {
    // An agent without clearance or an approved device cannot collect, and a
    // supervisor with no territory sees nothing. Those are not statistics.
    render(<RoleHomeScreen user={user('admin')} navigate={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/stopping somebody working/i)).toBeTruthy(),
    );
  });

  it('does not show them the day’s collections', async () => {
    render(<RoleHomeScreen user={user('admin')} navigate={() => {}} />);
    await waitFor(() => screen.getByText(/Agents awaiting clearance/i));
    expect(screen.queryByText(/Collected today/i)).toBeNull();
  });
});

describe('the revenue officer’s first screen', () => {
  beforeEach(() => {
    serve({
      role: 'revenue_officer',
      revenue: {
        taxpayers: '412',
        registered_this_week: '19',
        tins_outstanding: '4',
        tins_failed: '2',
        corrections_awaiting_review: '1',
        invoices_unpaid: '23',
        invoices_expired: '5',
        unpaid_kobo: '4500000',
      },
    });
  });

  it('leads with what has been assessed and not paid', async () => {
    render(<RoleHomeScreen user={user('revenue_officer')} navigate={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Assessed and unpaid/i)).toBeTruthy());
  });

  it('surfaces TIN applications the register refused', async () => {
    render(<RoleHomeScreen user={user('revenue_officer')} navigate={() => {}} />);
    await waitFor(() => expect(screen.getByText(/TIN applications failed/i)).toBeTruthy());
  });

  it('does not show them the agent clearance queue', async () => {
    render(<RoleHomeScreen user={user('revenue_officer')} navigate={() => {}} />);
    await waitFor(() => screen.getByText(/Assessed and unpaid/i));
    expect(screen.queryByText(/Agents awaiting clearance/i)).toBeNull();
  });
});

describe('the finance officer’s first screen', () => {
  beforeEach(() => {
    serve({
      role: 'finance_officer',
      finance: {
        reconciliation_exceptions: '2',
        settlements_unreconciled: '1',
        settlement_variance_kobo: '150000',
        commission_liability_kobo: '890000',
        payouts_awaiting_approval: '3',
        refunds_outstanding: '1',
        owed_to_councils_kobo: '2400000',
      },
    });
  });

  it('leads with what the state is holding for the Councils', async () => {
    // PSIRS collects for them. It is the only figure on any screen that is
    // somebody else's money.
    render(<RoleHomeScreen user={user('finance_officer')} navigate={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Owed to the Councils/i)).toBeTruthy());
  });

  it('says plainly when reconciliation exceptions are open', async () => {
    render(<RoleHomeScreen user={user('finance_officer')} navigate={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/Reconciliation exceptions are open/i)).toBeTruthy(),
    );
  });

  it('does not show them the taxpayer register', async () => {
    render(<RoleHomeScreen user={user('finance_officer')} navigate={() => {}} />);
    await waitFor(() => screen.getByText(/Owed to the Councils/i));
    expect(screen.queryByText(/Taxpayers on the register/i)).toBeNull();
  });
});

describe('the auditor’s first screen', () => {
  beforeEach(() => {
    serve({
      role: 'auditor',
      audit: {
        audit_entries: '10432',
        entries_today: '87',
        refused_this_week: '4',
        reversed_or_refunded: '2',
        fraud_flags_open: '1',
        rate_changes_this_month: '3',
        receipt_checks_this_week: '55',
        taxpayers_on_record: '412',
      },
    });
  });

  it('leads with the audit trail', async () => {
    render(<RoleHomeScreen user={user('auditor')} navigate={() => {}} />);
    // "Audit entries" appears twice — the headline stat and the queue row for
    // the running total — so match the count rather than the label.
    await waitFor(() => expect(screen.getAllByText('10432').length).toBeGreaterThan(0));
    expect(screen.getByText(/Hash-chained, append-only/i)).toBeTruthy();
  });

  it('says it changes nothing, because that is the role', async () => {
    render(<RoleHomeScreen user={user('auditor')} navigate={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/Nothing on this screen changes a record/i)).toBeTruthy(),
    );
  });

  it('offers no action that would change a record', async () => {
    // An auditor holds no mutating permission. A button here that led to one
    // would be a screen promising something the API refuses.
    render(<RoleHomeScreen user={user('auditor')} navigate={() => {}} />);
    await waitFor(() => screen.getByText(/What there is to examine/i));
    const labels = [...document.querySelectorAll('button')].map((b) => b.textContent ?? '');
    for (const label of labels) {
      expect(label).toMatch(/^(Open)?$/);
    }
  });
});

describe('the four screens are actually different', () => {
  const homes = [
    ['admin', { admin: { agents_awaiting_review: '1' } }, /Agents awaiting clearance/i],
    ['revenue_officer', { revenue: { unpaid_kobo: '0' } }, /taxpayer register/i],
    ['finance_officer', { finance: { owed_to_councils_kobo: '0' } }, /Owed to the Councils/i],
    ['auditor', { audit: { audit_entries: '0' } }, /What there is to examine/i],
  ] as const;

  it('gives each role a heading no other role sees', async () => {
    for (const [role, payload, heading] of homes) {
      cleanup();
      vi.restoreAllMocks();
      serve({ role, ...payload });
      render(<RoleHomeScreen user={user(role)} navigate={() => {}} />);
      await waitFor(() => expect(screen.getByText(heading)).toBeTruthy());

      for (const [, , otherHeading] of homes) {
        if (otherHeading === heading) continue;
        expect(
          screen.queryByText(otherHeading),
          `${role} is being shown another role's screen`,
        ).toBeNull();
      }
    }
  });
});
