/**
 * The amount a tax is worked out on, as an agent types it.
 *
 * The box went through `Number.parseFloat`, which stops at the first character
 * it does not understand and keeps whatever came before it. Measured on this
 * screen:
 *
 *   "12.500.000"  sent as ₦12.50
 *   "15000 0"     sent as ₦15,000
 *   "1e6"         sent as ₦1,000,000
 *
 * Each was quoted without a word, on the figure that decides the bill. The
 * measures a formula reads were already held to a plain number; this box,
 * which matters more, was not. It now reads amounts the way the portal does,
 * and says which amount it could not read.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { CollectScreen } from '../screens/Collect';
import { api } from '../lib/api';

const en = translations.en;

const TRADER = {
  id: 'tp-1',
  taxpayer_type: 'BUSINESS',
  first_name: null,
  last_name: null,
  business_name: 'Gyang Provisions',
  tin: null,
  phone: '08031234567',
  lga_name: 'Jos North',
};

const LEVY = {
  id: 'item-levy',
  code: 'TURNOVER-LEVY',
  name: 'Turnover Levy',
  category_name: 'Levies',
  rate_type: 'PERCENTAGE',
};

const QUOTE = {
  revenueItemName: LEVY.name,
  revenueItemNameHa: null,
  categoryName: LEVY.category_name,
  categoryNameHa: null,
  amountKobo: '750000',
  serviceChargeKobo: '0',
  totalKobo: '750000',
  trace: [{ step: 'Payable', detail: 'Amount payable to government', amount: '750000' }],
};

let post: ReturnType<typeof vi.spyOn>;

function mockApi() {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/taxpayers/search')) return [TRADER] as never;
    if (path.startsWith('/revenue/items/item-levy/inputs')) {
      return { rateType: 'PERCENTAGE', inputs: ['baseAmountKobo'] } as never;
    }
    if (path.startsWith('/revenue/items')) return [LEVY] as never;
    return [] as never;
  });
  post = vi.spyOn(api, 'post').mockImplementation(async (path: string) => {
    if (path === '/revenue/quote') return QUOTE as never;
    if (path === '/revenue/assessments') {
      return { transactionId: 'tx-1', transactionReference: 'PSIRS-TX-2026-000201' } as never;
    }
    return {} as never;
  });
}

async function typeTheBase(typed: string) {
  render(<CollectScreen navigate={() => {}} connection="ONLINE" />);
  fireEvent.change(document.querySelector('input') as HTMLInputElement, {
    target: { value: 'Gyang' },
  });
  fireEvent.click(screen.getByRole('button', { name: en.actionSearch }));
  await waitFor(() => screen.getByText(/Gyang Provisions/));
  fireEvent.click(screen.getByText(/Gyang Provisions/));
  await waitFor(() => expect(document.querySelector('select')).toBeTruthy());
  fireEvent.change(document.querySelector('select') as HTMLSelectElement, {
    target: { value: LEVY.id },
  });
  await screen.findByText(en.colBasisAmount);
  fireEvent.change(document.querySelector('input[placeholder="0.00"]') as HTMLInputElement, {
    target: { value: typed },
  });
  fireEvent.click(screen.getByRole('button', { name: /Calculate amount/i }));
}

const quoteCalls = () => post.mock.calls.filter(([path]: unknown[]) => path === '/revenue/quote');

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (_ok: unknown, fail?: (e: unknown) => void) => fail?.({ code: 2 }),
    },
  });
});

describe('the amount an assessment is based on', () => {
  for (const typed of ['12.500.000', '15000 0', '1e6', '15000abc']) {
    it(`is not guessed from "${typed}"`, async () => {
      mockApi();
      await typeTheBase(typed);

      await waitFor(() =>
        expect(screen.getByText(en.ofcCfNotAnAmount.replace('{{amount}}', typed))).toBeTruthy(),
      );
      expect(quoteCalls()).toHaveLength(0);
    });
  }

  for (const [typed, kobo] of [
    ['150,000', '15000000'],
    ['1500.5', '150050'],
    ['250000.75', '25000075'],
  ] as const) {
    it(`reads "${typed}" as written`, async () => {
      mockApi();
      await typeTheBase(typed);

      await waitFor(() => expect(quoteCalls()).toHaveLength(1));
      expect(quoteCalls()[0]![1]).toMatchObject({ inputs: { baseAmountKobo: kobo } });
    });
  }

  it('asks for an amount when the box is empty or zero', async () => {
    for (const typed of ['', '0']) {
      cleanup();
      mockApi();
      await typeTheBase(typed);
      await waitFor(() => expect(screen.getByText(en.colNeedBaseAmount)).toBeTruthy());
      expect(quoteCalls()).toHaveLength(0);
    }
  });

  it('raises the charge on the amount it quoted', async () => {
    mockApi();
    await typeTheBase('150,000');
    await waitFor(() => screen.getByText(/You are about to collect/i));
    fireEvent.click(screen.getByRole('button', { name: /Confirm and proceed to payment/i }));

    await waitFor(() =>
      expect(post.mock.calls.some(([path]: unknown[]) => path === '/revenue/assessments')).toBe(true),
    );
    const raised = post.mock.calls.find(([path]: unknown[]) => path === '/revenue/assessments')!;
    expect(raised[1]).toMatchObject({ inputs: { baseAmountKobo: '15000000' } });
  });
});
