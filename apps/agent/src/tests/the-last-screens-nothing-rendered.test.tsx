/**
 * The agent's own three screens that no test had drawn, and a blank page.
 *
 * Same finding as the portal's four: the sweep that gave handlers a branch
 * for a failure that is not an API refusal never reached the screens no test
 * rendered, so each still set nothing at all when the connection dropped.
 *
 * On an agent's handset that is not the unusual case. It is a market with one
 * bar of signal, which is where this application is meant to work.
 *
 *   * The search said nothing. The agent pressed Search, `busy` cleared, and
 *     the screen was exactly as before — no results, no error, nothing to
 *     read. They press it again.
 *
 *   * The taxpayer record drew an EMPTY PAGE. `if (!profile) return null`
 *     sits under a catch that only handled `ApiRequestError`, so a dropped
 *     request rendered nothing whatsoever: not a message, not a spinner, not
 *     a button. There is no way to report that, and no way to tell it from
 *     the application having crashed.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { TaxpayersScreen, TaxpayerScreen } from '../screens/Taxpayers';
import { TicketScreen } from '../screens/Support';
import { ApiRequestError, api } from '../lib/api';

/** Not an `ApiRequestError`: the case all three dropped. */
const DROPPED = new Error('Failed to fetch');

let answer: () => unknown;

beforeEach(() => {
  cleanup();
  answer = () => [];
  vi.spyOn(api, 'get').mockImplementation(async () => answer() as never);
});

afterEach(() => vi.restoreAllMocks());

describe('searching for a taxpayer with one bar of signal', () => {
  it('says the search failed, rather than looking like nothing happened', async () => {
    answer = () => {
      throw DROPPED;
    };
    render(<TaxpayersScreen navigate={() => {}} />);

    fireEvent.change(document.querySelector('input') as HTMLInputElement, {
      target: { value: 'Ladi' },
    });
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);

    await waitFor(() => expect(screen.getByText(/Failed to fetch/)).toBeTruthy());
  });

  it('still finds somebody when the connection holds', async () => {
    // The control. A screen that says "failed" whatever happens is no better
    // than one that says nothing.
    answer = () => [
      {
        id: 'tp-1',
        taxpayer_type: 'INDIVIDUAL',
        first_name: 'Ladi',
        last_name: 'Dung',
        business_name: null,
        tin: null,
        phone: '08031234567',
        lga_name: 'Jos North',
      },
    ];
    render(<TaxpayersScreen navigate={() => {}} />);

    fireEvent.change(document.querySelector('input') as HTMLInputElement, {
      target: { value: 'Ladi' },
    });
    fireEvent.submit(document.querySelector('form') as HTMLFormElement);

    await waitFor(() => expect(screen.getByText(/Ladi Dung/)).toBeTruthy());
    expect(screen.queryByText(/Failed to fetch/)).toBeNull();
  });
});

describe('opening a taxpayer record that will not load', () => {
  it('draws something, where it used to draw an empty page', async () => {
    answer = () => {
      throw DROPPED;
    };
    render(<TaxpayerScreen taxpayerId="tp-1" navigate={() => {}} />);

    await waitFor(() => expect(screen.getByText(/Failed to fetch/)).toBeTruthy());
    expect(
      document.body.textContent?.trim(),
      'an empty page is not something an agent can report',
    ).not.toBe('');
  });
});

describe('opening a support ticket that will not load', () => {
  it('says so instead of loading for ever', async () => {
    answer = () => {
      throw DROPPED;
    };
    render(<TicketScreen ticketId="tk-1" />);

    await waitFor(() => expect(screen.getByText(/Failed to fetch/)).toBeTruthy());
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
