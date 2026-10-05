/**
 * What a reversal request asks the approver to decide.
 *
 * The queue showed a reversal by its kind, its subject, who asked and why.
 * The two facts the decision turns on — how much goes back, and whose doing
 * the requester says it was — were in the request's payload, and the queue
 * never printed them. Whose doing decides whether the bill is withdrawn or
 * owed again, and whether the citizen's compliance score is touched; an
 * approver who cannot see it is approving something they have not read.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ApprovalsScreen } from '../screens/Finance';
import { api } from '../lib/api';
import { permissionsForRole } from '@psirs/shared';

const ME = {
  id: 'u-finance-1',
  phone: '+2348000000003',
  fullName: 'Hauwa Gyang',
  role: 'finance_officer',
  permissions: permissionsForRole('finance_officer'),
};

const REVERSAL = {
  id: 'ap-1',
  approval_type: 'PAYMENT_REVERSAL',
  entity_type: 'transaction',
  entity_id: 'tx-1',
  payload: { amountKobo: '5000000', refundType: 'REVERSAL', attributableTo: 'TAXPAYER' },
  requested_by_user_id: 'u-officer-1',
  requested_by_name: 'Danjuma Pam',
  requested_reason: 'The payer’s bank recalled the transfer.',
  requested_at: '2026-10-01T10:00:00Z',
  status: 'REQUESTED',
};

function show(rows: unknown[]) {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/agents/bank-changes')) return { changes: [] } as never;
    return { approvals: rows, matched: rows.length, cap: 200 } as never;
  });
  render(<ApprovalsScreen user={ME as never} />);
}

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  sessionStorage.setItem('psirs.portal.user', JSON.stringify(ME));
});
afterEach(() => vi.restoreAllMocks());

describe('a reversal waiting for a decision', () => {
  it('shows how much goes back and whose doing it was said to be', async () => {
    show([REVERSAL]);
    await screen.findByText(/recalled the transfer/);
    expect(screen.getByText(/₦50,000.00/)).toBeTruthy();
    expect(screen.getByText(/Whose doing was it: Taxpayer/i)).toBeTruthy();
  });

  it('shows one that did not say as the State’s, which is how it would be carried out', async () => {
    show([{ ...REVERSAL, payload: { amountKobo: '5000000' } }]);
    await screen.findByText(/recalled the transfer/);
    expect(screen.getByText(/Whose doing was it: Government/i)).toBeTruthy();
  });

  it('adds nothing to a request that is not money going back', async () => {
    show([
      {
        ...REVERSAL,
        approval_type: 'INVOICE_WITHDRAWAL',
        entity_type: 'invoice',
        payload: {},
        requested_reason: 'Raised twice for the same kiosk.',
      },
    ]);
    await screen.findByText(/Raised twice for the same kiosk/);
    expect(screen.queryByText(/Whose doing was it/i)).toBeNull();
  });
});
