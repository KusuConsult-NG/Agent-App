/**
 * The money list, and the skeleton that never stopped.
 *
 * `TransactionsScreen` sets `rows` to null before each query and renders the
 * skeleton while it is null. The catch set the shared `error` and left `rows`
 * at null, so a refused or failed query showed the officer the refusal at the
 * top of the screen and a list still loading underneath it, for ever.
 *
 * That is the softer half of the pair this sweep keeps finding — the screen
 * says nothing untrue, it simply never finishes. An officer reading a filter
 * that returns nothing has to decide whether the answer is "no transactions
 * match" or "still working", and a skeleton answers neither.
 *
 * The remedy is only to stop showing a skeleton for a query that has already
 * failed. A query still in flight still shows one.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { TransactionsScreen } from '../screens/Transactions';
import { ApiRequestError, api } from '../lib/api';
import { permissionsForRole } from '@psirs/shared';

const ROW = {
  transaction_reference: 'PSIRS-TX-2026-000901',
  amount_kobo: '4500000',
  status: 'PAID',
  created_at: '2026-09-09T10:00:00Z',
  verified_at: '2026-09-09T10:05:00Z',
  revenue_item: 'Direct Assessment / Self-Assessment',
  revenue_item_ha: null,
  revenue_category: 'Personal Income Tax',
  revenue_category_ha: null,
  lga: 'Jos North',
  agent_code: 'AGT-00042',
  taxpayer_name: 'Ladi Dung',
  tin: null,
  receipt_number: 'RCP-2026-000123',
  gateway_reference: 'RMT-1',
  payment_method: 'CARD',
};

const REFUSED = new ApiRequestError(403, {
  code: 'FORBIDDEN',
  message: 'Transactions outside your Local Government Area are not visible to you.',
  moneyStatus: 'NOT_APPLICABLE',
});

function signIn() {
  sessionStorage.setItem(
    'psirs.portal.user',
    JSON.stringify({
      id: 'u1',
      phone: '+2348000000002',
      fullName: 'Revenue Officer',
      role: 'revenue_officer',
      permissions: permissionsForRole('revenue_officer'),
    }),
  );
}

const spinner = () => document.querySelector('[aria-busy="true"]');

function mockLoads(transactions: () => Promise<unknown>) {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/reference/lgas')) return [{ id: 'lga-1', name: 'Jos North' }] as never;
    return (await transactions()) as never;
  });
}

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  signIn();
});

afterEach(() => cleanup());

describe('a query that failed', () => {
  it('says so where the list would have been', async () => {
    mockLoads(() => Promise.reject(REFUSED));
    render(<TransactionsScreen />);

    await waitFor(() =>
      expect(screen.getByText(/outside your Local Government Area/i)).toBeTruthy(),
    );
  });

  it('stops pretending it is still loading', async () => {
    mockLoads(() => Promise.reject(REFUSED));
    render(<TransactionsScreen />);

    await waitFor(() =>
      expect(screen.getByText(/outside your Local Government Area/i)).toBeTruthy(),
    );
    expect(spinner()).toBeNull();
  });
});

describe('a query still in flight', () => {
  /*
   * The control. The skeleton is right for a request that has not answered,
   * and taking it away would make a slow query look like an empty one.
   */
  it('still shows the skeleton', async () => {
    mockLoads(() => new Promise(() => {}));
    render(<TransactionsScreen />);

    await waitFor(() => expect(spinner()).toBeTruthy());
    expect(screen.queryByText(/not visible to you/i)).toBeNull();
  });
});

describe('a query that answered', () => {
  it('lists what was collected', async () => {
    mockLoads(async () => [ROW]);
    render(<TransactionsScreen />);

    await waitFor(() => expect(screen.getByText('PSIRS-TX-2026-000901')).toBeTruthy());
    expect(document.body.textContent).toMatch(/Ladi Dung/);
  });

  it('says plainly when nothing matched the filters', async () => {
    mockLoads(async () => []);
    render(<TransactionsScreen />);

    await waitFor(() =>
      expect(screen.getByText(/No transactions match these filters/i)).toBeTruthy(),
    );
  });
});
