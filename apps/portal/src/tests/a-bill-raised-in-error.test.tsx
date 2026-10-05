/**
 * Asking for a bill raised in error to be withdrawn, from the bill itself.
 *
 * The approvals route now takes INVOICE_WITHDRAWAL (see the API test of the
 * same name); this is where an officer looking at the duplicate asks for it.
 * Nothing changes on asking — another officer decides in the approvals queue —
 * and the form says so, and appears only where the server would accept it.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InvoiceScreen } from '../screens/Charge';
import * as apiModule from '../lib/api';
import { ApiRequestError } from '../lib/api';

const INVOICE = {
  id: 'inv-9',
  invoice_number: 'INV/2026/000909',
  assessment_id: 'asm-9',
  amount_kobo: '300000',
  service_charge_kobo: '0',
  total_amount_kobo: '300000',
  amount_paid_kobo: '0',
  verification_code: 'PL-9W3D2X',
  issued_at: '2026-10-01T09:00:00.000Z',
  expires_at: new Date(Date.now() + 20 * 86_400_000).toISOString() as string | null,
  status: 'UNPAID',
  assessment_number: 'ASM/2026/000908',
  period_label: null,
  computation_trace: [],
  revenue_item: 'Shops and Kiosks Rates',
  revenue_item_ha: null,
  revenue_category: 'Local Government Rates',
  revenue_category_ha: null,
  transaction_reference: 'TXN-2026-000909',
  transaction_status: 'INVOICE_GENERATED' as string | null,
  reissued_as: null as string | null,
  reissued_as_number: null as string | null,
};

let invoice: typeof INVOICE;
let held: string[];
const posts: { path: string; body: unknown }[] = [];
let answer: () => Promise<unknown>;

beforeEach(() => {
  cleanup();
  invoice = { ...INVOICE };
  held = ['approval:request', 'invoice:create'];
  posts.length = 0;
  answer = async () => ({ approvalId: 'apr-1', status: 'REQUESTED' });
  vi.spyOn(apiModule, 'can').mockImplementation((permission: string) => held.includes(permission));
  vi.spyOn(apiModule.api, 'get').mockImplementation(async () => invoice as never);
  vi.spyOn(apiModule.api, 'post').mockImplementation(async (path: string, body?: unknown) => {
    posts.push({ path, body });
    return (await answer()) as never;
  });
});
afterEach(() => vi.restoreAllMocks());

const open = () => render(<InvoiceScreen id="inv-9" navigate={() => {}} />);
const askButton = () => screen.queryByRole('button', { name: /Ask for it to be withdrawn/i });

describe('an unpaid bill raised in error', () => {
  it('is sent for a decision with the reason, and nothing more is claimed', async () => {
    open();
    await screen.findByText(/Raised in error\?/i);
    expect((askButton() as HTMLButtonElement).disabled, 'a reason is required').toBe(true);

    fireEvent.change(screen.getByLabelText(/What was wrong with it/i), {
      target: { value: 'Charged twice; the first press timed out.' },
    });
    fireEvent.click(askButton()!);

    await screen.findByText(/Another officer must approve it/i);
    expect(posts).toEqual([
      {
        path: '/government/approvals',
        body: {
          approvalType: 'INVOICE_WITHDRAWAL',
          entityType: 'invoice',
          entityId: 'inv-9',
          payload: {},
          reason: 'Charged twice; the first press timed out.',
        },
      },
    ]);
  });

  it('says why the server would not take it', async () => {
    answer = () =>
      Promise.reject(
        new ApiRequestError(409, {
          code: 'CONFLICT',
          message: 'A request to withdraw this invoice is already waiting for a decision.',
          moneyStatus: 'NOT_APPLICABLE',
        }),
      );
    open();
    fireEvent.change(await screen.findByLabelText(/What was wrong with it/i), {
      target: { value: 'Charged twice; the first press timed out.' },
    });
    fireEvent.click(askButton()!);
    expect(await screen.findByText(/already waiting for a decision/i)).toBeTruthy();
  });
});

describe('where it is not offered', () => {
  it('on a paid bill', async () => {
    invoice = { ...INVOICE, status: 'PAID', amount_paid_kobo: '300000' };
    open();
    await screen.findByText('INV/2026/000909');
    expect(askButton()).toBeNull();
  });

  it('on a bill already replaced by another', async () => {
    invoice = { ...INVOICE, status: 'CANCELLED', reissued_as: 'inv-10', reissued_as_number: 'INV/2026/000910' };
    open();
    await screen.findByText('INV/2026/000909');
    expect(askButton()).toBeNull();
  });

  it('to an officer who does not issue bills', async () => {
    held = ['approval:request'];
    open();
    await screen.findByText('INV/2026/000909');
    expect(askButton()).toBeNull();
  });

  it('to an officer who cannot ask for approvals', async () => {
    held = ['invoice:create'];
    open();
    await screen.findByText('INV/2026/000909');
    expect(askButton()).toBeNull();
  });
});
