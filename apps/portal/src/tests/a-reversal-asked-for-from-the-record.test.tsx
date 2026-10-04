/**
 * Asking for a payment to be reversed, from the payment's own record.
 *
 * The finance screen decided reversals and executed them; nothing in the
 * portal could ask for one, so the three-person path started with an API call
 * no officer could make. The form sits on the transaction, asks whose doing
 * it was rather than assuming, and appears where the server would accept it.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TransactionScreen } from '../screens/Transaction';
import * as apiModule from '../lib/api';
import { ApiRequestError, api } from '../lib/api';

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

let held: string[];
const posts: { path: string; body: unknown }[] = [];
let answer: () => Promise<unknown>;

beforeEach(() => {
  cleanup();
  held = ['approval:request', 'payment:reverse:request'];
  posts.length = 0;
  answer = async () => ({ approvalId: 'apr-9', status: 'REQUESTED' });
  vi.spyOn(apiModule, 'can').mockImplementation((permission: string) => held.includes(permission));
  vi.spyOn(api, 'post').mockImplementation(async (path: string, body?: unknown) => {
    posts.push({ path, body });
    return (await answer()) as never;
  });
});
afterEach(() => vi.restoreAllMocks());

function show(over: Record<string, unknown> = {}) {
  vi.spyOn(api, 'get').mockResolvedValue(full(over) as never);
  render(<TransactionScreen transactionKey={TX.id} navigate={vi.fn()} />);
}
const sendButton = () => screen.queryByRole('button', { name: /Send for a decision/i });

describe('a settled payment', () => {
  it('can be sent for reversal, with whose doing it was and why', async () => {
    show();
    await screen.findByText(/Ask for this payment to be reversed/i);
    expect(screen.getByText(/Amount returned: ₦50,000.00/)).toBeTruthy();
    expect((sendButton() as HTMLButtonElement).disabled, 'nothing chosen yet').toBe(true);

    fireEvent.change(screen.getByLabelText(/What happened/i), {
      target: { value: 'Charged twice for the same shop this quarter.' },
    });
    expect((sendButton() as HTMLButtonElement).disabled, 'whose doing is asked, not assumed').toBe(true);
    fireEvent.click(screen.getByLabelText(/The State's/i));
    fireEvent.click(sendButton()!);

    await screen.findByText(/a third carries it out/i);
    expect(posts).toEqual([
      {
        path: '/government/approvals',
        body: {
          approvalType: 'PAYMENT_REVERSAL',
          entityType: 'transaction',
          entityId: TX.id,
          payload: {
            amountKobo: '5000000',
            refundType: 'REVERSAL',
            attributableTo: 'GOVERNMENT',
            reason: 'Charged twice for the same shop this quarter.',
          },
          reason: 'Charged twice for the same shop this quarter.',
        },
      },
    ]);
  });

  it('records a payer’s recall as the payer’s', async () => {
    show();
    fireEvent.change(await screen.findByLabelText(/What happened/i), {
      target: { value: 'The payer’s bank recalled the transfer.' },
    });
    fireEvent.click(screen.getByLabelText(/The payer's/i));
    fireEvent.click(sendButton()!);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect((posts[0]!.body as { payload: { attributableTo: string } }).payload.attributableTo).toBe('TAXPAYER');
  });

  it('says why the server would not take it', async () => {
    answer = () =>
      Promise.reject(
        new ApiRequestError(403, {
          code: 'FORBIDDEN',
          message: 'Requesting a payment reversal needs the payment:reverse:request permission.',
          moneyStatus: 'NOT_APPLICABLE',
        }),
      );
    show();
    fireEvent.change(await screen.findByLabelText(/What happened/i), {
      target: { value: 'Charged twice for the same shop this quarter.' },
    });
    fireEvent.click(screen.getByLabelText(/The gateway's/i));
    fireEvent.click(sendButton()!);
    expect(await screen.findByText(/needs the payment:reverse:request permission/i)).toBeTruthy();
  });
});

describe('where it is not offered', () => {
  it('to an officer who may not ask for a reversal', async () => {
    held = ['approval:request'];
    show();
    await screen.findByText(TX.transaction_reference);
    expect(screen.queryByText(/Ask for this payment to be reversed/i)).toBeNull();
  });

  it('on a payment already reversed', async () => {
    show({ transaction: { ...TX, status: 'REVERSED' } });
    await screen.findByText(TX.transaction_reference);
    expect(screen.queryByText(/Ask for this payment to be reversed/i)).toBeNull();
  });

  it('on a collection whose payment was never verified', async () => {
    show({
      transaction: { ...TX, status: 'PAYMENT_PENDING' },
      payments: [{ ...full().payments[0], status: 'PENDING' }],
    });
    await screen.findByText(TX.transaction_reference);
    expect(screen.queryByText(/Ask for this payment to be reversed/i)).toBeNull();
  });
});
