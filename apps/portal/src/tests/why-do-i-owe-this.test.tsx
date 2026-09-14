/**
 * An officer with an invoice number, and nothing to open.
 *
 * `GET /revenue/invoices/:id` and `GET /revenue/assessments/:id` were built,
 * permissioned on two tiers each, and called from nowhere. The global search
 * already found both by number — the gap was where it sent the officer:
 *
 *   COALESCE('/transaction/' || t.id, '/outstanding')
 *
 * An invoice with no transaction is one nobody has paid, which is exactly the
 * invoice somebody rings up about. That hit landed on the outstanding
 * worklist: everybody's unpaid invoices, with no mention of the one searched
 * for.
 *
 * The screens exist now, and the thing they carry that no list could is the
 * frozen `computation_trace` — the steps the platform took to reach the
 * figure, kept, in the schema's own words, "so an auditor can re-run the
 * calculation years later". A citizen disputing an amount at a counter is
 * disputing those steps, and until now nobody without a database client could
 * read them out.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AssessmentScreen, InvoiceScreen } from '../screens/Charge';
import * as apiModule from '../lib/api';
import { ApiRequestError } from '../lib/api';

const TRACE = [
  { step: 'Rate applied', detail: 'Market stall levy, Jos North, 2026 rate', amount: '500000' },
  { step: 'Early payment discount', detail: 'Paid within the first month', amount: '50000' },
  { step: 'Payable', detail: 'Amount payable to government', amount: '450000' },
];

const INVOICE = {
  id: 'inv-1',
  invoice_number: 'INV-2026-000412',
  assessment_id: 'asm-1',
  amount_kobo: '450000',
  service_charge_kobo: '10000',
  total_amount_kobo: '460000',
  amount_paid_kobo: '0',
  verification_code: 'PL-9K4TQ2',
  issued_at: '2026-03-02T09:15:00.000Z',
  expires_at: '2026-04-02T00:00:00.000Z',
  status: 'UNPAID',
  assessment_number: 'ASM-2026-000411',
  period_label: 'March 2026',
  computation_trace: TRACE,
  revenue_item: 'Market stall levy',
  revenue_item_ha: null,
  revenue_category: 'Market and trade levies',
  revenue_category_ha: null,
  transaction_reference: null,
  transaction_status: null,
};

const ASSESSMENT = {
  id: 'asm-1',
  assessment_number: 'ASM-2026-000411',
  assessment_type: 'AGENT_ASSISTED',
  base_amount_kobo: '500000',
  discount_kobo: '50000',
  service_charge_kobo: '10000',
  amount_kobo: '460000',
  period_start: '2026-03-01',
  period_end: '2026-03-31',
  period_label: 'March 2026',
  status: 'INVOICED',
  created_at: '2026-03-02T09:10:00.000Z',
  computation_trace: TRACE,
  computation_inputs: {},
  revenue_item: 'Market stall levy',
  revenue_item_ha: null,
  revenue_category: 'Market and trade levies',
  revenue_category_ha: null,
  invoice_number: 'INV-2026-000412',
  invoice_status: 'UNPAID',
  expires_at: '2026-04-02T00:00:00.000Z',
};

const REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'The invoice could not be read.',
  moneyStatus: 'NOT_APPLICABLE',
});

let answer: (path: string) => unknown;
const navigated: string[] = [];

beforeEach(() => {
  cleanup();
  navigated.length = 0;
  answer = (path) => (path.includes('/invoices/') ? INVOICE : ASSESSMENT);
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => answer(path) as never);
});

afterEach(() => vi.restoreAllMocks());

const openInvoice = () =>
  render(<InvoiceScreen id="inv-1" navigate={(path) => navigated.push(path)} />);

describe('an officer holding an invoice number', () => {
  it('can open the invoice itself', async () => {
    expect(await (openInvoice(), screen.findByText('INV-2026-000412'))).toBeTruthy();
    expect(screen.getByText(/PL-9K4TQ2/)).toBeTruthy();
  });

  it('reads the calculation that produced the figure', async () => {
    // The answer to "why do I owe this". Nothing else in either front end
    // shows a step of it.
    openInvoice();

    await screen.findByText('Rate applied');
    expect(screen.getByText(/Market stall levy, Jos North, 2026 rate/)).toBeTruthy();
    expect(screen.getByText('Early payment discount')).toBeTruthy();
    expect(screen.getByText(/Amount payable to government/)).toBeTruthy();
  });

  it('says nobody has tried to pay it, rather than leaving the question open', async () => {
    openInvoice();

    await waitFor(() =>
      expect(screen.getByText(/Nobody has started a payment against this invoice/i)).toBeTruthy(),
    );
  });

  it('offers the transaction when there is one', async () => {
    answer = () => ({ ...INVOICE, transaction_reference: 'TXN-2026-000182', transaction_status: 'PAID' });
    openInvoice();

    fireEvent.click(await screen.findByRole('button', { name: /TXN-2026-000182/ }));
    expect(navigated).toEqual(['/transaction/TXN-2026-000182']);
  });

  it('opens the assessment behind it', async () => {
    openInvoice();

    fireEvent.click(await screen.findByRole('button', { name: /ASM-2026-000411/ }));
    expect(navigated).toEqual(['/assessment/asm-1']);
  });

  it('warns when the deadline has passed, because the platform will refuse the money', async () => {
    answer = () => ({ ...INVOICE, status: 'EXPIRED' });
    openInvoice();

    await waitFor(() => expect(screen.getByText(/deadline has passed/i)).toBeTruthy());
    expect(screen.getByText(/raising a fresh assessment first/i)).toBeTruthy();
  });
});

describe('the assessment behind it', () => {
  it('separates what was computed from what was demanded', async () => {
    render(<AssessmentScreen id="asm-1" />);
    await screen.findByText('ASM-2026-000411');

    /*
     * Read off the tile rather than off the page: the same figures appear
     * again in the calculation below, which is the point of the screen, so
     * `getByText` on an amount finds two nodes and proves neither. The step
     * named "Payable" collides with the tile of the same name for the same
     * reason, so the labels are matched inside the grid too.
     */
    const tile = (label: string) =>
      [...document.querySelectorAll('.stat')]
        .find((node) => node.querySelector('.stat__label')?.textContent === label)
        ?.querySelector('.stat__value')?.textContent;

    expect(tile('Before discount')).toBe('₦5,000.00');
    expect(tile('Discount')).toBe('₦500.00');
    expect(tile('Service charge')).toBe('₦100.00');
    expect(tile('Payable')).toBe('₦4,600.00');
  });

  it('says when nothing has been demanded, which is not the same as unpaid', async () => {
    // An assessment with no invoice has been computed and never billed. Drawn
    // the same as an unpaid one, it would read as a debt that is being ignored.
    answer = () => ({ ...ASSESSMENT, invoice_number: null, invoice_status: null, status: 'ACTIVE' });
    render(<AssessmentScreen id="asm-1" />);

    await waitFor(() =>
      expect(screen.getByText(/No invoice has been raised from this assessment/i)).toBeTruthy(),
    );
  });

  it('does not fall over when no calculation was recorded', async () => {
    /*
     * The column default is `'{}'`, and what gets written is an array. A row
     * from before a trace was kept arrives as an object, and `.map` on it
     * throws — taking the whole screen down over a field that is merely
     * absent. That is the crash this sweep has spent the day removing, so it
     * is held here rather than assumed.
     */
    answer = () => ({ ...ASSESSMENT, computation_trace: {} });
    render(<AssessmentScreen id="asm-1" />);

    await waitFor(() =>
      expect(screen.getByText(/No calculation was recorded/i)).toBeTruthy(),
    );
    expect(screen.getByText('ASM-2026-000411')).toBeTruthy();
  });
});

describe('when the read fails', () => {
  it('says so and offers the officer a way to ask again', async () => {
    let attempt = 0;
    answer = () => {
      attempt += 1;
      if (attempt === 1) throw REFUSED;
      return INVOICE;
    };
    openInvoice();

    await waitFor(() => expect(screen.getByText(/invoice could not be read/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));

    await waitFor(() => expect(screen.getByText('INV-2026-000412')).toBeTruthy());
  });
});
