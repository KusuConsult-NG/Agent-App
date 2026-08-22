/**
 * A search that matches nobody has to say so.
 *
 * `CollectScreen` held its results in `useState<TaxpayerSummary[]>([])` and
 * rendered them behind `results.length > 0`. Starting at `[]` collapses two
 * different states into one: "no search has been run" and "the search found
 * nobody" look identical, so the screen had no way to report the second.
 *
 * The consequence is felt at the counter. Finding the taxpayer is the first
 * step of every collection — "Every payment must be attributed", as the
 * screen itself says. An agent with a trader standing in front of them typed
 * a name, pressed Search, and the page did not change. Nothing told them
 * whether the search had run, whether the person was unregistered, or whether
 * the app had failed, and the one useful next step — registering the taxpayer
 * — was on screen but unconnected to what had just happened.
 *
 * `TaxpayersScreen` already had this right one file over: `null` until
 * searched, then an explicit empty state. This is the same treatment.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CollectScreen } from '../screens/Collect';
import { api } from '../lib/api';

describe('finding the taxpayer before taking a payment', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('says nobody matched, rather than leaving the screen unchanged', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never);

    render(<CollectScreen navigate={() => {}} connection="ONLINE" />);

    // Before searching, the screen must not claim anything was not found.
    expect(screen.queryByText(/No taxpayer matches/i)).toBeNull();

    const box = document.querySelector('input') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'nobody by this name' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));

    await waitFor(() => {
      expect(screen.getByText(/No taxpayer matches that search/i)).toBeTruthy();
    });
  });

  it('points at registering them, which is the next thing to do', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never);

    render(<CollectScreen navigate={() => {}} connection="ONLINE" />);
    const box = document.querySelector('input') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'nobody by this name' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));

    await waitFor(() => {
      const message = screen.getByText(/No taxpayer matches that search/i).textContent ?? '';
      expect(/register/i.test(message)).toBe(true);
    });
    expect(screen.getByRole('button', { name: /Register a new taxpayer/i })).toBeTruthy();
  });

  it('still lists the people it does find', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([
      { id: 'a1', first_name: 'Ladi', last_name: 'Danjuma', tin: '123456789', phone: '+2348030000001' },
    ] as never);

    render(<CollectScreen navigate={() => {}} connection="ONLINE" />);
    const box = document.querySelector('input') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'Ladi' } });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/ }));

    await waitFor(() => expect(screen.getByText(/Ladi Danjuma/)).toBeTruthy());
    expect(screen.queryByText(/No taxpayer matches/i)).toBeNull();
  });
});
