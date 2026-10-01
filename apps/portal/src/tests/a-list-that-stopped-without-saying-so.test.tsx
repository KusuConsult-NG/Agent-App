/**
 * The officer's payment panel, reading out a list that stopped.
 *
 * `GET /government/taxpayers/:id/payments` computes its totals over the whole
 * window and caps the lines at two hundred. The panel prints the total, the
 * per-levy breakdown and then the lines, and is introduced to the officer as
 * "an answer they can check against their receipts".
 *
 * Four items in the catalogue are charged DAILY — market levy, abattoir fees,
 * slaughter slab, motor park levy — so a trader paying one of them crosses two
 * hundred payments inside seven months, against a panel that defaults to a
 * year. The officer was then reading out a complete-looking list that was
 * missing the oldest five months of it, to somebody holding the receipts for
 * those months.
 *
 * The cap itself is reasonable. Reading a capped list as a whole one is not,
 * and the officer cannot tell the difference by eye: two hundred rows is not a
 * number anybody notices.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import { TaxpayerRecordsScreen } from '../screens/TaxpayerRecords';
import * as apiModule from '../lib/api';

const USER = {
  id: 'user-1',
  fullName: 'Revenue Officer',
  phone: '+2348000000001',
  email: null,
  role: 'admin',
  permissions: ['taxpayer:read:all', 'report:read:all'],
} as never;

const TAXPAYER = {
  id: 'tp-1',
  taxpayer_type: 'INDIVIDUAL',
  tin: 'PL-0000001',
  first_name: 'Ladi',
  last_name: 'Dung',
  business_name: null,
  phone: '+2348030000001',
};

/** Two lines standing in for the two hundred: the flag is what is under test. */
const ROWS = [
  {
    transactionReference: 'TXN-1',
    paidAt: '2026-09-30T09:00:00.000Z',
    revenueItem: 'Market Tax and Levy',
    revenueItemHa: null,
    periodLabel: '2026-09-30',
    amountKobo: '20000',
    status: 'SETTLED',
    returned: false,
    receiptNumber: 'PSIRS/2026/000123',
  },
  {
    transactionReference: 'TXN-2',
    paidAt: '2026-09-29T09:00:00.000Z',
    revenueItem: 'Market Tax and Levy',
    revenueItemHa: null,
    periodLabel: '2026-09-29',
    amountKobo: '20000',
    status: 'SETTLED',
    returned: false,
    receiptNumber: 'PSIRS/2026/000122',
  },
];

/**
 * A year of a daily levy: the summary counts all of it, the list carries two.
 * The figures are the ones that make the gap arithmetic rather than rhetoric.
 */
const CAPPED = {
  truncated: true,
  summary: {
    payments: 365,
    totalKobo: '7300000',
    returnedKobo: '0',
    byItem: [{ revenueItem: 'Market Tax and Levy', payments: 365, totalKobo: '7300000' }],
  },
  rows: ROWS,
};

const WHOLE = { ...CAPPED, truncated: false, summary: { ...CAPPED.summary, payments: 2, totalKobo: '40000' } };

let payments: unknown = CAPPED;

beforeEach(() => {
  cleanup();
  payments = CAPPED;
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/taxpayers/search')) return [TAXPAYER] as never;
    if (path.includes('/payments')) return payments as never;
    if (path.includes('/incentives')) return { programmes: [] } as never;
    return [] as never;
  });
});

afterEach(() => vi.restoreAllMocks());

/** The panel only exists once a taxpayer has been chosen. */
async function openTaxpayer() {
  render(<TaxpayerRecordsScreen user={USER} />);
  fireEvent.change(screen.getByLabelText(/Find the taxpayer/i), { target: { value: 'Ladi' } });
  fireEvent.click(screen.getByRole('button', { name: /^Search$/i }));
  fireEvent.click(await screen.findByRole('button', { name: /Ladi Dung/i }));
  await screen.findByText(/Each payment/i);
}

describe('an officer reading a payment list that stopped', () => {
  it('is told the list is not the whole period, and how many lines it has', async () => {
    await openTaxpayer();

    expect(screen.getByText(/this list stopped at 2 payments/i)).toBeTruthy();
    // And the half that matters at a counter: the totals above are not wrong,
    // they are over a wider set than the lines.
    expect(screen.getByText(/totals above cover the whole period/i)).toBeTruthy();
    expect(screen.getByText(/Narrow the dates/i)).toBeTruthy();
  });

  it('does not warn about a list that holds everything', async () => {
    /*
     * The guard. A notice on every panel would pass the check above and would
     * teach every officer to treat a complete list as suspect, which is the
     * same failure in the other direction.
     */
    payments = WHOLE;
    await openTaxpayer();

    expect(screen.queryByText(/stopped at/i)).toBeNull();
    expect(screen.queryByText(/totals above cover the whole period/i)).toBeNull();
  });
});
