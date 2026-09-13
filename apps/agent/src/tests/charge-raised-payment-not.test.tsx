/**
 * The window where the charge exists and the payment does not.
 *
 * `createAndPay` is two requests. The first raises a real assessment — an
 * invoice, a transaction reference, a debt the taxpayer now owes. The second
 * hands that transaction to the payment gateway. Only the second one can fail
 * on its own, and when it does the first has already happened.
 *
 * What the agent saw was the payment error and nothing else: the same screen,
 * the same quote, the same "Confirm and proceed to payment" button. Pressing
 * it again is the obvious thing to do, and it raises a SECOND assessment —
 * a fresh idempotency key, a fresh invoice, a second debt for one obligation.
 *
 * Nothing downstream can tell those two apart. Several invoices against one
 * taxpayer and one revenue item is a legitimate shape in this platform — the
 * arrears worklist is built on it — so no guard is going to refuse the
 * duplicate, and no reconciliation is going to spot it. It simply becomes a
 * debt somebody has to argue their way out of later.
 *
 * So the screen has to say what it already knows: a charge was raised, here is
 * its reference, and here is the way to it. The transaction screen is a real
 * destination for this — it renders the invoice the taxpayer can pay at a
 * bank, which is precisely the fallback when the gateway handoff failed.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CollectScreen, TransactionScreen } from '../screens/Collect';
import { ApiRequestError, api } from '../lib/api';

const TRADER = {
  id: 'tp-1',
  taxpayer_type: 'INDIVIDUAL',
  first_name: 'Ladi',
  last_name: 'Dung',
  business_name: null,
  tin: null,
  phone: '08031234567',
  lga_name: 'Jos North',
};

const PIT = {
  id: 'item-pit',
  code: 'PIT-DIRECT',
  name: 'Direct Assessment / Self-Assessment',
  category_name: 'Personal Income Tax',
  rate_type: 'TIERED',
};

const QUOTE = {
  revenueItemName: PIT.name,
  revenueItemNameHa: null,
  categoryName: PIT.category_name,
  categoryNameHa: null,
  amountKobo: '4500000',
  serviceChargeKobo: '0',
  totalKobo: '4500000',
  trace: [{ step: 'Payable', detail: 'Amount payable to government', amount: '4500000' }],
};

/** The reference the assessment came back with, and the debt it names. */
const REFERENCE = 'PSIRS-TX-2026-000144';
const RAISED = { transactionId: 'tx-1', transactionReference: REFERENCE };

/** What the gateway handoff looks like when the gateway is down. */
function gatewayDown() {
  return Promise.reject(
    new ApiRequestError(500, {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side.',
      moneyStatus: 'NOT_DEBITED',
    }),
  );
}

const posted: string[] = [];

function mockApi(handlers: {
  assessment: () => Promise<unknown>;
  initiate: () => Promise<unknown>;
}) {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/taxpayers/search')) return [TRADER] as never;
    if (path.startsWith('/revenue/items')) return [PIT] as never;
    return [] as never;
  });
  vi.spyOn(api, 'post').mockImplementation(async (path: string) => {
    posted.push(path);
    if (path === '/revenue/quote') return QUOTE as never;
    if (path === '/revenue/assessments') return (await handlers.assessment()) as never;
    if (path === '/payments/initiate') return (await handlers.initiate()) as never;
    return {} as never;
  });
}

const navigations: string[] = [];

/** Drive the screen from a search to a calculated amount, as an agent does. */
async function calculate() {
  render(<CollectScreen navigate={(path) => navigations.push(path)} connection="ONLINE" />);

  const box = document.querySelector('input') as HTMLInputElement;
  fireEvent.change(box, { target: { value: 'Ladi' } });
  fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
  await waitFor(() => screen.getByText(/Ladi Dung/));

  fireEvent.click(screen.getByText(/Ladi Dung/));
  await waitFor(() => expect(document.querySelector('select')).toBeTruthy());
  fireEvent.change(document.querySelector('select') as HTMLSelectElement, {
    target: { value: PIT.id },
  });

  await waitFor(() => {
    const inputs = [...document.querySelectorAll('input')];
    expect(inputs.some((i) => i.getAttribute('inputmode') === 'decimal')).toBe(true);
  });
  const amountBox = [...document.querySelectorAll('input')].find(
    (i) => i.getAttribute('inputmode') === 'decimal',
  ) as HTMLInputElement;
  fireEvent.change(amountBox, { target: { value: '1500000' } });
  fireEvent.click(screen.getByRole('button', { name: /Calculate amount/i }));
  await waitFor(() => screen.getByText(/You are about to collect/i));
}

function confirm() {
  fireEvent.click(screen.getByRole('button', { name: /Confirm and proceed to payment/i }));
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  posted.length = 0;
  navigations.length = 0;
  // No satellite in a test, and `whereAmI` must not sit on its timeout.
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (_ok: unknown, fail?: (e: unknown) => void) => fail?.({ code: 2 }),
    },
  });
});

describe('the gateway refuses after the charge is raised', () => {
  it('tells the agent a charge exists, and names it', async () => {
    mockApi({ assessment: async () => RAISED, initiate: gatewayDown });
    await calculate();
    confirm();

    await waitFor(() => expect(screen.getByText(new RegExp(REFERENCE))).toBeTruthy());
  });

  it('does not leave the button that raises another one', async () => {
    mockApi({ assessment: async () => RAISED, initiate: gatewayDown });
    await calculate();
    confirm();

    await waitFor(() => expect(screen.getByText(new RegExp(REFERENCE))).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Confirm and proceed to payment/i })).toBeNull();
  });

  it('offers the transaction as the way out of it', async () => {
    mockApi({ assessment: async () => RAISED, initiate: gatewayDown });
    await calculate();
    confirm();

    await waitFor(() => expect(screen.getByText(new RegExp(REFERENCE))).toBeTruthy());
    const open = screen
      .getAllByRole('button')
      .find((button) => /open|invoice|transaction/i.test(button.textContent ?? ''));
    expect(open, 'no button leads to the raised charge').toBeTruthy();
    fireEvent.click(open!);
    expect(navigations).toContain(`/transactions/${REFERENCE}`);
  });

  it('still says what went wrong with the payment', async () => {
    mockApi({ assessment: async () => RAISED, initiate: gatewayDown });
    await calculate();
    confirm();

    await waitFor(() => expect(screen.getByText(new RegExp(REFERENCE))).toBeTruthy());
    expect(screen.getByText(/Something went wrong on our side\./)).toBeTruthy();
  });
});

describe('a refusal before anything is raised', () => {
  /*
   * The other half of the branch, and the reason this cannot simply be "stop
   * offering the button after a failure". If the assessment itself is refused
   * there is no charge, no reference and nothing to open — pressing again is
   * the correct thing for the agent to do, and taking that away would strand
   * a trader over a momentary refusal.
   */
  it('leaves the agent able to try again', async () => {
    mockApi({
      assessment: () =>
        Promise.reject(
          new ApiRequestError(503, {
            code: 'NOT_CONFIGURED',
            message: 'This service is not available right now.',
            moneyStatus: 'NOT_APPLICABLE',
          }),
        ),
      initiate: async () => ({ authorisationUrl: 'https://pay.example/x' }),
    });
    await calculate();
    confirm();

    await waitFor(() =>
      expect(screen.getByText(/This service is not available right now\./)).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: /Confirm and proceed to payment/i })).toBeTruthy();
    expect(posted).not.toContain('/payments/initiate');
  });
});

describe('when both requests succeed', () => {
  it('goes to the transaction, exactly as before', async () => {
    mockApi({
      assessment: async () => RAISED,
      initiate: async () => ({ authorisationUrl: 'https://pay.example/x' }),
    });
    await calculate();
    confirm();

    await waitFor(() => expect(navigations).toContain(`/transactions/${REFERENCE}`));
  });
});

/*
 * The other half of the exit: where it leads.
 *
 * Sending the agent to the transaction is only an answer if the transaction
 * screen can do something about it. In the state it is reached in — an invoice
 * raised, no payment against it — its one action was `confirmPayment`, which
 * returns immediately when there is no `payment_id`. A button that did nothing
 * at all, and said nothing about doing nothing, on the screen an agent lands
 * on after a failed handoff.
 *
 * The hint beside the invoice already told them what they needed: "Start the
 * payment first if they want to pay at a bank: the reference a bank asks for
 * is issued then". There was no control that did that.
 */

const TRANSACTION = {
  id: 'tx-1',
  transaction_reference: REFERENCE,
  status: 'INVOICE_GENERATED',
  amount_kobo: '4500000',
  total_amount_kobo: '4500000',
  invoice_id: 'inv-1',
  invoice_number: 'INV-000144',
  expires_at: null,
  revenue_item: PIT.name,
  revenue_item_ha: null,
  revenue_category: PIT.category_name,
  revenue_category_ha: null,
  first_name: 'Ladi',
  last_name: 'Dung',
  business_name: null,
  tin: null,
  preferred_language: 'en',
  payment_id: null as string | null,
  payment_status: null as string | null,
  payment_reference: null,
  gateway_reference: null as string | null,
  failure_reason: null,
  receipt_id: null,
  receipt_number: null,
  receipt_code: null,
  document_id: null,
  acknowledgement_id: null,
  acknowledgement_number: null,
  acknowledgement_code: null,
};

function mockTransaction(overrides: Partial<typeof TRANSACTION>) {
  vi.spyOn(api, 'get').mockImplementation(
    async () =>
      ({
        transaction: { ...TRANSACTION, ...overrides },
        events: [{ to_status: 'INVOICE_GENERATED', reason: null, created_at: '2026-09-10T09:00:00Z' }],
      }) as never,
  );
  vi.spyOn(api, 'post').mockImplementation(async (path: string) => {
    posted.push(path);
    return { authorisationUrl: 'https://pay.example/x' } as never;
  });
}

describe('the transaction an agent is sent to, with no payment on it', () => {
  it('offers to start the payment', async () => {
    mockTransaction({});
    render(<TransactionScreen reference={REFERENCE} navigate={() => {}} />);

    const button = await screen.findByRole('button', { name: /Start the payment/i });
    fireEvent.click(button);

    await waitFor(() => expect(posted).toContain('/payments/initiate'));
  });

  it('does not offer to check a payment that was never made', async () => {
    mockTransaction({});
    render(<TransactionScreen reference={REFERENCE} navigate={() => {}} />);

    await screen.findByRole('button', { name: /Start the payment/i });
    expect(screen.queryByRole('button', { name: /Check payment status/i })).toBeNull();
  });

  it('sends the gateway the transaction it is being asked to collect on', async () => {
    mockTransaction({});
    render(<TransactionScreen reference={REFERENCE} navigate={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: /Start the payment/i }));

    await waitFor(() => expect(posted).toContain('/payments/initiate'));
    const call = vi
      .mocked(api.post)
      .mock.calls.find(([path]) => path === '/payments/initiate');
    expect(call?.[1]).toEqual({ transactionId: TRANSACTION.id });
  });
});

describe('the same screen once a payment exists', () => {
  /*
   * The control. Checking with the gateway is the right action once there is
   * something to check on, and the swap must not cost the screen that.
   */
  it('checks the payment rather than starting a second one', async () => {
    mockTransaction({ payment_id: 'pay-1', payment_status: 'PENDING', gateway_reference: 'RMT-1' });
    render(<TransactionScreen reference={REFERENCE} navigate={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: /Check payment status/i }));

    await waitFor(() => expect(posted).toContain('/payments/pay-1/confirm'));
    expect(posted).not.toContain('/payments/initiate');
  });
});
