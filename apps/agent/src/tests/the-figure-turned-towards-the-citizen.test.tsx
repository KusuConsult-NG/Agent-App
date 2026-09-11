/**
 * "Payment successful", and a number with nothing saying what it is a number of.
 *
 * A transaction carries two money columns and the difference between them is
 * the whole of PRD §6: `amount_kobo` is what government is owed, full stop;
 * `total_amount_kobo` is what the citizen hands over; and
 * `service_charge_kobo` is the gap, which is never netted into the first and
 * is why `commission.ts` computes commission on `amount_kobo` alone.
 *
 * Every other place the platform prints money says which of the two it is
 * printing. The thermal slip heads its figure TOTAL PAID. The official receipt
 * heads its figure AMOUNT PAID TO GOVERNMENT and, when there is a charge,
 * discloses it beneath in a sentence that names it "not government revenue".
 * The detail row on this very screen is labelled "Amount".
 *
 * The confirmation was the exception. A bare figure under "Payment
 * successful", drawn from `amount_kobo`, with no label — on the half of the
 * screen an agent turns towards the person who has just paid, three lines
 * above a row labelled "Amount" showing a different number.
 *
 * The server has been sending `service_charge_kobo` to this screen all along
 * (`payments.ts` selects it); the screen's own row type did not declare it and
 * nothing drew it.
 *
 * LATENT, AND SAID SO PLAINLY: no catalogue item configures a service charge
 * today, so the two columns are equal in every live transaction and these
 * tests are the only thing that pulls them apart. It is one administrator
 * setting away from being a citizen and an agent looking at two numbers.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { formatNaira, translations } from '@psirs/shared';
import { TransactionScreen } from '../screens/Collect';
import { api } from '../lib/api';

const en = translations.en as unknown as Record<string, string>;
const REFERENCE = 'PSIRS-TX-2026-000901';

/** Paid, with a charge: ₦20,000 to government and ₦500 on top. */
const PAID = {
  id: 'tx-1',
  transaction_reference: REFERENCE,
  status: 'RECEIPT_GENERATED',
  amount_kobo: '2000000',
  service_charge_kobo: '50000',
  total_amount_kobo: '2050000',
  invoice_id: 'inv-1',
  invoice_number: 'INV-000144',
  expires_at: null,
  revenue_item: 'Market Levy',
  revenue_item_ha: null,
  revenue_category: 'Market',
  revenue_category_ha: null,
  first_name: 'Ladi',
  last_name: 'Dung',
  business_name: null,
  tin: 'PL81000001',
  preferred_language: 'en',
  payment_id: 'pay-1',
  payment_status: 'PAID',
  payment_reference: 'PSIRS-PAY-1',
  gateway_reference: 'RM-1',
  failure_reason: null,
  receipt_id: 'rc-1',
  receipt_number: 'PSIRS-RCP-2026-000441',
  receipt_code: 'ABC123',
  document_id: 'doc-1',
  acknowledgement_id: null,
  acknowledgement_number: null,
  acknowledgement_code: null,
};

function show(overrides: Partial<typeof PAID> = {}) {
  vi.spyOn(api, 'get').mockImplementation(
    async () =>
      ({
        transaction: { ...PAID, ...overrides },
        events: [{ to_status: 'RECEIPT_GENERATED', reason: null, created_at: '2026-09-10T09:00:00Z' }],
      }) as never,
  );
  render(<TransactionScreen reference={REFERENCE} navigate={() => {}} />);
}

/** The confirmation block, not the detail table further down the page. */
function confirmation(): HTMLElement {
  const node = document.querySelector('.amount-confirm');
  if (!node) throw new Error('the payment confirmation was not drawn');
  return node as HTMLElement;
}

beforeEach(() => cleanup());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the confirmation a citizen is shown', () => {
  it('is what they paid, not the part of it government keeps', async () => {
    show();

    await waitFor(() => expect(screen.getByText(en.paymentSuccess!)).toBeTruthy());
    /*
     * Scoped to the confirmation block. `₦20,000.00` also appears further down
     * inside the detail table, so a search over the whole document would find
     * the government figure and pass whichever number the confirmation drew.
     */
    expect(confirmation().textContent).toContain(formatNaira('2050000'));
    expect(confirmation().textContent).not.toContain(formatNaira('2000000'));
  });

  it('says what the difference is, the way the receipt says it', async () => {
    show();

    await waitFor(() => expect(screen.getByText(en.paymentSuccess!)).toBeTruthy());
    expect(
      confirmation().textContent,
    ).toContain(en.colIncludesServiceCharge!.replace('{{charge}}', formatNaira('50000')));
  });

  it('still names the receipt, which is what the citizen leaves with', async () => {
    // The control: disclosing the charge must not displace the receipt number.
    show();

    await waitFor(() => expect(screen.getByText(en.paymentSuccess!)).toBeTruthy());
    expect(confirmation().textContent).toContain('PSIRS-RCP-2026-000441');
  });
});

describe('the ordinary transaction, which is every transaction today', () => {
  /*
   * The control that matters most. No revenue item carries a service charge,
   * so `service_charge_kobo` is '0' and the two columns are equal — and a
   * disclosure printed on every receipt in the state would be noise that
   * teaches an agent to stop reading this block.
   */
  it('shows the figure once and says nothing about a charge', async () => {
    show({ amount_kobo: '2000000', service_charge_kobo: '0', total_amount_kobo: '2000000' });

    await waitFor(() => expect(screen.getByText(en.paymentSuccess!)).toBeTruthy());
    expect(confirmation().textContent).toContain(formatNaira('2000000'));
    expect(confirmation().textContent).not.toContain('service charge');
  });

  it('does not fall over when the server omits the charge entirely', async () => {
    /*
     * An older cached response, or a shape this screen has not seen. `BigInt()`
     * of undefined throws, and a throw here white-screens the confirmation an
     * agent needs in order to know the payment went through at all.
     */
    show({ service_charge_kobo: undefined as never, total_amount_kobo: '2000000' });

    await waitFor(() => expect(screen.getByText(en.paymentSuccess!)).toBeTruthy());
    expect(confirmation().textContent).toContain(formatNaira('2000000'));
  });
});
