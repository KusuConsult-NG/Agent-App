/**
 * A formula item, at the stall.
 *
 * The screen asked for a base amount on PERCENTAGE and TIERED items and for
 * nothing otherwise, so a FORMULA item — `area * 50000` for a shop charged by
 * the square metre — was quoted with no area, refused by the engine, and could
 * not be collected at all. The screen now asks the server what the rate in
 * force for this taxpayer reads, and asks the agent for exactly that.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { CollectScreen, inputLabel } from '../screens/Collect';
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

const SHOP = {
  id: 'item-shop',
  code: 'SHOPS-KIOSKS',
  name: 'Shops and Kiosks',
  category_name: 'Local Government Levies',
  rate_type: 'FORMULA',
};

function mockApi() {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/taxpayers/search')) return [TRADER] as never;
    if (path.startsWith('/revenue/items/item-shop/inputs')) {
      return { rateType: 'FORMULA', inputs: ['floorAreaSqm'] } as never;
    }
    if (path.startsWith('/revenue/items')) return [SHOP] as never;
    return [] as never;
  });
  return vi.spyOn(api, 'post').mockResolvedValue({
    revenueItemId: SHOP.id,
    revenueItemName: SHOP.name,
    categoryName: SHOP.category_name,
    rateVersionId: 'rv-1',
    rateVersion: 1,
    amountKobo: '775000',
    serviceChargeKobo: '0',
    totalKobo: '775000',
    trace: [{ step: 'Formula', detail: 'floorAreaSqm * 50000', amount: '775000' }],
  } as never);
}

async function chooseTheShop() {
  render(<CollectScreen navigate={() => {}} connection="ONLINE" />);
  const box = document.querySelector('input') as HTMLInputElement;
  fireEvent.change(box, { target: { value: 'Gyang' } });
  fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));
  await waitFor(() => screen.getByText(/Gyang Provisions/));
  fireEvent.click(screen.getByText(/Gyang Provisions/));
  await waitFor(() => expect(document.querySelector('select')).toBeTruthy());
  fireEvent.change(document.querySelector('select') as HTMLSelectElement, {
    target: { value: SHOP.id },
  });
  return screen.findByText('Floor area sqm');
}

describe('a formula item at the counter', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('asks for what the formula reads, and quotes with it as typed', async () => {
    const post = mockApi();
    await chooseTheShop();

    // The base amount is not what this rate reads, so it is not asked for.
    expect(screen.queryByText(en.colBasisAmount)).toBeNull();

    const field = document.querySelector('input[placeholder="0"]') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '15.5' } });
    fireEvent.click(screen.getByRole('button', { name: /Calculate amount/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/revenue/quote', {
      revenueItemId: SHOP.id,
      inputs: { floorAreaSqm: '15.5' },
      taxpayerId: TRADER.id,
    });
  });

  it('says which box is wrong rather than sending a word', async () => {
    const post = mockApi();
    await chooseTheShop();

    const field = document.querySelector('input[placeholder="0"]') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'about fifteen' } });
    fireEvent.click(screen.getByRole('button', { name: /Calculate amount/i }));

    await waitFor(() =>
      expect(screen.getByText(en.colNeedMeasure.replace('{{name}}', 'Floor area sqm'))).toBeTruthy(),
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('reads an input name the way a person would', () => {
    expect(inputLabel('area')).toBe('Area');
    expect(inputLabel('floorAreaSqm')).toBe('Floor area sqm');
    expect(inputLabel('number_of_rooms')).toBe('Number of rooms');
  });
});
