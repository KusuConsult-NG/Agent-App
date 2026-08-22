/**
 * Attributing a vehicle renewal to the person paying for it.
 *
 * The renewal screen asked for this with a text box labelled "Taxpayer
 * paying", hinted "Search for the taxpayer to get their ID", and expected the
 * agent to type one in. A taxpayer id is a thirty-six-character UUID, there
 * was no search anywhere on that screen, and the agent is standing beside a
 * vehicle holding a phone. The field was not merely awkward — it was
 * impassable, and the renewal flow behind it could not be completed by anyone
 * working the way agents actually work.
 *
 * The rule the screen exists to serve is the platform's own: every payment is
 * attributed to a taxpayer. A control that makes attribution impossible does
 * not enforce that rule, it just stops the work.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { TaxpayerPicker, taxpayerDisplayName } from '../components/TaxpayerPicker';
import { api } from '../lib/api';

const LADI = {
  id: '11111111-2222-3333-4444-555555555555',
  taxpayer_type: 'INDIVIDUAL',
  tin: '123456789',
  first_name: 'Ladi',
  last_name: 'Danjuma',
  business_name: null,
  phone: '+2348030000001',
};

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('choosing the taxpayer paying', () => {
  it('finds people by name, so no identifier has to be typed', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([LADI] as never);
    const onChoose = vi.fn();

    render(<TaxpayerPicker chosen={null} onChoose={onChoose} onClear={() => {}} />);

    fireEvent.change(document.querySelector('input')!, { target: { value: 'Ladi' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));

    await waitFor(() => expect(screen.getByText(/Ladi Danjuma/)).toBeTruthy());
    fireEvent.click(screen.getByText(/Ladi Danjuma/));
    expect(onChoose).toHaveBeenCalledWith(LADI);
  });

  it('never asks anybody to type a taxpayer id', () => {
    render(<TaxpayerPicker chosen={null} onChoose={() => {}} onClear={() => {}} />);
    const placeholders = [...document.querySelectorAll('input')].map((i) => i.placeholder ?? '');
    for (const placeholder of placeholders) {
      expect(/taxpayer id/i.test(placeholder)).toBe(false);
    }
  });

  it('will not search on one character, which matches everyone', () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([] as never);
    render(<TaxpayerPicker chosen={null} onChoose={() => {}} onClear={() => {}} />);

    fireEvent.change(document.querySelector('input')!, { target: { value: 'a' } });
    expect(screen.getByRole('button', { name: /^Search$/ })).toHaveProperty('disabled', true);
    expect(get).not.toHaveBeenCalled();
  });

  it('says so when the search matched nobody, and why it matters', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never);
    render(<TaxpayerPicker chosen={null} onChoose={() => {}} onClear={() => {}} />);

    // Before searching it must not claim anything was not found.
    expect(screen.queryByText(/No taxpayer matches/i)).toBeNull();

    fireEvent.change(document.querySelector('input')!, { target: { value: 'nobody at all' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));

    await waitFor(() => {
      const message = screen.getByText(/No taxpayer matches that search/i).textContent ?? '';
      expect(/registered/i.test(message)).toBe(true);
    });
  });

  it('shows who was chosen, and lets that be undone', () => {
    const onClear = vi.fn();
    render(<TaxpayerPicker chosen={LADI} onChoose={() => {}} onClear={onClear} />);

    expect(screen.getByText(/Ladi Danjuma/)).toBeTruthy();
    expect(screen.getByText(/TIN 123456789/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Choose someone else/i }));
    expect(onClear).toHaveBeenCalled();
  });

  it('names a business by its business name', () => {
    expect(
      taxpayerDisplayName({
        ...LADI,
        first_name: null,
        last_name: null,
        business_name: 'Jos Central Traders',
      }),
    ).toBe('Jos Central Traders');
  });
});
