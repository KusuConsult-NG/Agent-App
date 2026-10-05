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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { FORMULA_INPUTS, translations } from '@psirs/shared';
import { CollectScreen, inputLabel, measureLabel } from '../screens/Collect';
import { api } from '../lib/api';
import { setAppLanguage } from '../lib/i18n';

const en = translations.en;
const ha = translations.ha;

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

async function chooseTheShop(words: typeof en = en) {
  render(<CollectScreen navigate={() => {}} connection="ONLINE" />);
  const box = document.querySelector('input') as HTMLInputElement;
  fireEvent.change(box, { target: { value: 'Gyang' } });
  fireEvent.click(screen.getByRole('button', { name: words.actionSearch }));
  await waitFor(() => screen.getByText(/Gyang Provisions/));
  fireEvent.click(screen.getByText(/Gyang Provisions/));
  await waitFor(() => expect(document.querySelector('select')).toBeTruthy());
  fireEvent.change(document.querySelector('select') as HTMLSelectElement, {
    target: { value: SHOP.id },
  });
  return screen.findByText(words.colFiFloorAreaSqm);
}

describe('a formula item at the counter', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });
  afterEach(() => setAppLanguage('en'));

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
      expect(screen.getByText(en.colNeedMeasure.replace('{{name}}', en.colFiFloorAreaSqm))).toBeTruthy(),
    );
    expect(post).not.toHaveBeenCalled();
  });

  /*
   * The list itself, asked for this taxpayer rather than for their type alone,
   * so the server can leave out what cannot be charged where they are and show
   * their Council's rate. `the-items-a-taxpayer-can-be-charged` holds the
   * server half.
   */
  it('asks for the items this taxpayer can be charged', async () => {
    mockApi();
    await chooseTheShop();
    expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/^\/revenue\/items\?.*taxpayerId=tp-1/));
  });

  /*
   * The label is the dictionary's, in the reader's language.
   *
   * It was built from the name the officer typed into the formula, so a Hausa
   * reader was asked for "Floor area sqm" in English. A name on the list of
   * measurements has a label in both languages; the API refuses a formula
   * naming anything else.
   */
  it('asks a Hausa reader in Hausa', async () => {
    setAppLanguage('ha');
    mockApi();
    await chooseTheShop(ha);
    expect(screen.getByText(ha.colFiFloorAreaSqm)).toBeTruthy();
    expect(screen.queryByText('Floor area sqm')).toBeNull();
  });

  it('has both labels for every measurement a formula may read', () => {
    for (const [name, key] of Object.entries(FORMULA_INPUTS)) {
      for (const words of [en, ha]) {
        const label = (words as unknown as Record<string, string>)[key];
        expect(typeof label, `${name} has no label`).toBe('string');
        expect(label.trim().length, `${name} has an empty label`).toBeGreaterThan(0);
      }
      expect(ha[key], `${name} is not translated`).not.toBe(en[key]);
    }
  });

    it('reads an input name the way a person would', () => {
    // A rate written before the list existed still gets a readable box.
    expect(measureLabel('legacyThing', en)).toBe('Legacy thing');
    expect(measureLabel('rooms', ha)).toBe(ha.colFiRooms);
    expect(inputLabel('area')).toBe('Area');
    expect(inputLabel('floorAreaSqm')).toBe('Floor area sqm');
    expect(inputLabel('number_of_rooms')).toBe('Number of rooms');
  });
});
