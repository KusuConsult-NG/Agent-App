/**
 * The screen that answers a question about a levy rather than a person.
 *
 * The three endpoints behind it were built and tested and had no screen, so
 * the answers existed and no officer could reach them. What this holds is the
 * part a passing API test cannot see: what the screen asks for, and when.
 *
 * The one that matters is the taxpayer list. `/taxpayers/search` refuses a
 * request with no criterion at all, and rightly — "every taxpayer in Plateau
 * State" is not a search, and a screen that opens by asking for it opens with
 * an error message in it. So the section stays empty until the officer has
 * named a levy, a category, an LGA, or arrears.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { LeviesScreen } from '../screens/Levies';
import * as apiModule from '../lib/api';

const EMPTY_REVENUE = {
  totalKobo: '500000',
  settledKobo: '300000',
  awaitingSettlementKobo: '200000',
  categories: [
    {
      category_id: 'cat-1',
      category: 'Market and trade levies',
      transactions: '4',
      amount_kobo: '500000',
      settled_kobo: '300000',
      taxpayers: '3',
    },
  ],
  items: [],
};

const EMPTY_DEFAULTERS = { outstandingKobo: '120000', defaulters: 1, rows: [] };

let asked: string[] = [];

function stubApi() {
  asked = [];
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    asked.push(path);
    if (path.startsWith('/revenue/categories')) {
      return [{ id: 'cat-1', name: 'Market and trade levies', code: 'MKT' }] as never;
    }
    if (path.startsWith('/revenue/items')) {
      return [
        { id: 'item-1', code: 'MARKET-LEVY', name: 'Daily market levy', category_name: 'Market and trade levies' },
        { id: 'item-2', code: 'SIGNAGE', name: 'Signage permit', category_name: 'Advertising' },
      ] as never;
    }
    if (path.startsWith('/reference/lgas')) return [{ id: 'lga-1', name: 'Jos North' }] as never;
    if (path.startsWith('/government/revenue/by-category')) return EMPTY_REVENUE as never;
    if (path.startsWith('/government/revenue/defaulters')) return EMPTY_DEFAULTERS as never;
    if (path.startsWith('/taxpayers/search')) return [] as never;
    return [] as never;
  });
}

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  stubApi();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('opening the levy screen', () => {
  it('does not ask for every taxpayer in the State', async () => {
    render(<LeviesScreen />);
    await waitFor(() => expect(asked.some((path) => path.startsWith('/government/revenue'))).toBe(true));

    expect(
      asked.filter((path) => path.startsWith('/taxpayers/search')),
      'the search endpoint refuses a request with no criterion; asking anyway renders an error',
    ).toHaveLength(0);
  });

  it('asks for the collections and the arrears straight away', async () => {
    render(<LeviesScreen />);
    await waitFor(() => {
      expect(asked.some((path) => path.startsWith('/government/revenue/by-category'))).toBe(true);
      expect(asked.some((path) => path.startsWith('/government/revenue/defaulters'))).toBe(true);
    });
  });

  it('reports what is still to be settled, not only what was collected', async () => {
    /*
     * The gap between money a gateway confirmed and money the State's account
     * holds is the number this platform exists to keep visible. A summary
     * showing only the first figure would be the old behaviour in a new place.
     */
    render(<LeviesScreen />);
    await waitFor(() => expect(screen.getByText(/Awaiting settlement/i)).toBeTruthy());
  });
});

describe('choosing a levy', () => {
  it('asks who is registered under it, now that there is something to ask about', async () => {
    render(<LeviesScreen />);
    await waitFor(() => expect(screen.getByLabelText(/Tax category/i)).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/Tax category/i), { target: { value: 'cat-1' } });

    await waitFor(() => {
      const search = asked.find((path) => path.startsWith('/taxpayers/search'));
      expect(search, 'choosing a category is a criterion the search accepts').toBeTruthy();
      expect(search).toContain('categoryId=cat-1');
    });
  });

  it('narrows the item list to that category', async () => {
    render(<LeviesScreen />);
    await waitFor(() => expect(screen.getByLabelText(/Levy or tax item/i)).toBeTruthy());

    // Both items before the category is chosen.
    expect(screen.getByRole('option', { name: /Signage permit/i })).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Tax category/i), { target: { value: 'cat-1' } });

    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /Signage permit/i })).toBeNull();
      expect(screen.getByRole('option', { name: /Daily market levy/i })).toBeTruthy();
    });
  });

  it('carries the levy into the collections query as well as the taxpayer one', async () => {
    render(<LeviesScreen />);
    await waitFor(() => expect(screen.getByLabelText(/Tax category/i)).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/Tax category/i), { target: { value: 'cat-1' } });

    await waitFor(() => {
      const money = asked.filter((path) => path.startsWith('/government/revenue/by-category'));
      expect(
        money.some((path) => path.includes('categoryId=cat-1')),
        'one filter bar drives all three sections, or an officer reads one and believes it is all three',
      ).toBe(true);
    });
  });

  it('asks for arrears on that levy alone', async () => {
    render(<LeviesScreen />);
    await waitFor(() => expect(screen.getByLabelText(/Levy or tax item/i)).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/Levy or tax item/i), { target: { value: 'item-1' } });

    await waitFor(() => {
      const owed = asked.filter((path) => path.startsWith('/government/revenue/defaulters'));
      expect(owed.some((path) => path.includes('revenueItemId=item-1'))).toBe(true);
    });
  });
});

describe('asking only about people who owe something', () => {
  it('counts as a criterion on its own', async () => {
    /*
     * "Everyone with anything unpaid" is a legitimate question and was refused
     * by a guard that tested for a non-empty string. A boolean is not one.
     */
    render(<LeviesScreen />);
    await waitFor(() => expect(screen.getByLabelText(/something unpaid/i)).toBeTruthy());

    fireEvent.click(screen.getByLabelText(/something unpaid/i));

    await waitFor(() => {
      const search = asked.find((path) => path.startsWith('/taxpayers/search'));
      expect(search).toBeTruthy();
      expect(search).toContain('outstandingOnly=true');
    });
  });
});

describe('a supervisor, who may read reports but not the whole register', () => {
  /*
   * The section that lists citizens by levy is an enumeration, and the API
   * refuses it to a caller holding only `taxpayer:read:assigned` — which is
   * what a supervisor holds. Offering the panel anyway would put a permission
   * error inside a screen their own menu handed them.
   *
   * The two report sections are territory-scoped server-side and do reach
   * them, so the screen is still worth opening.
   */
  const supervisor = (permission: string) =>
    ['report:read:territory', 'taxpayer:read:assigned'].includes(permission);

  it('is not shown the taxpayer list, because the API would refuse it', async () => {
    vi.spyOn(apiModule, 'can').mockImplementation(supervisor);
    render(<LeviesScreen />);

    await waitFor(() => expect(screen.getByText(/Awaiting settlement/i)).toBeTruthy());
    expect(screen.queryByText(/Who is registered under/i)).toBeNull();
    // And the page does not promise them a section they will not get.
    expect(screen.queryByText(/who is registered under it/i)).toBeNull();
  });

  it('never asks for it either', async () => {
    vi.spyOn(apiModule, 'can').mockImplementation(supervisor);
    render(<LeviesScreen />);

    await waitFor(() => expect(asked.some((path) => path.startsWith('/government/revenue'))).toBe(true));
    fireEvent.change(screen.getByLabelText(/Tax category/i), { target: { value: 'cat-1' } });

    await waitFor(() => {
      const money = asked.filter((path) => path.includes('categoryId=cat-1'));
      expect(money.length, 'the filter still drives the sections they do get').toBeGreaterThan(0);
    });
    expect(asked.filter((path) => path.startsWith('/taxpayers/search'))).toHaveLength(0);
  });

  it('still gets the collections and the arrears, which are scoped for them', async () => {
    vi.spyOn(apiModule, 'can').mockImplementation(supervisor);
    render(<LeviesScreen />);

    await waitFor(() => {
      expect(asked.some((path) => path.startsWith('/government/revenue/by-category'))).toBe(true);
      expect(asked.some((path) => path.startsWith('/government/revenue/defaulters'))).toBe(true);
    });
  });
});
