/**
 * Which purse a levy is paid into, and a dropdown that would not say.
 *
 * `GET /revenue/authorities` lists the arms of government revenue is
 * collected for, and had no caller anywhere in either front end — one of the
 * reads recorded in READ_WITHOUT_A_SCREEN. The catalogue screen is where it
 * was missing, and the absence is not cosmetic.
 *
 * State revenue and Local Government revenue are separate purses. A revenue
 * item belongs to a category, the category belongs to an authority, and the
 * authority is which government the money is for. The catalogue table showed
 * the category and nothing above it — `listItems` has returned
 * `authority_name`, `tier` and `mda_name` on every row since the MDA mapping
 * was done, and this screen declared none of them.
 *
 * Worse is the form. An officer implementing a new bye-law chooses a category
 * from a dropdown, and that choice decides which government collects the
 * levy. The list was flat and alphabetical, with nothing saying which entries
 * were state and which were Council. Choosing wrongly does not fail: it
 * collects real money into the wrong government's revenue, and nothing
 * downstream would ever question it.
 *
 * And the catch under it read `setCategories([])`, so a refused request left
 * an empty dropdown and a dead submit button with nothing said — the same
 * shape as the LGA list that stopped an agent registering somebody in a
 * market.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CatalogueScreen } from '../screens/Configuration';
import * as apiModule from '../lib/api';
import { ApiRequestError } from '../lib/api';

const USER = {
  id: 'user-1',
  fullName: 'Catalogue Admin',
  phone: '+2348000000001',
  email: null,
  role: 'admin',
  permissions: ['catalogue:read', 'catalogue:configure'],
} as never;

const AUTHORITIES = [
  { id: 'auth-state', name: 'Plateau State Internal Revenue Service', name_ha: null, code: 'PSIRS', tier: 'STATE' },
  { id: 'auth-lg', name: 'Plateau State Local Governments', name_ha: null, code: 'PLG', tier: 'LOCAL_GOVERNMENT' },
];

/* The collision the flat list could not show: one name, two governments. */
const CATEGORIES = [
  {
    id: 'cat-state-permits',
    name: 'Licences and permits',
    name_ha: null,
    authority_name: 'Plateau State Internal Revenue Service',
    authority_name_ha: null,
    tier: 'STATE',
  },
  {
    id: 'cat-lg-permits',
    name: 'Licences and permits',
    name_ha: null,
    authority_name: 'Plateau State Local Governments',
    authority_name_ha: null,
    tier: 'LOCAL_GOVERNMENT',
  },
];

const ITEMS = [
  {
    id: 'item-1',
    code: 'MARKET-LEVY',
    name: 'Market stall levy',
    name_ha: null,
    category_name: 'Market and trade levies',
    category_name_ha: null,
    category_id: 'cat-lg-permits',
    authority_name: 'Plateau State Local Governments',
    authority_name_ha: null,
    tier: 'LOCAL_GOVERNMENT',
    mda_name: 'Local Government Councils',
    mda_name_ha: null,
    frequency: 'ANNUAL',
    rate_type: 'FIXED',
    fixed_amount_kobo: '500000',
    rate_basis_points: null,
    minimum_amount_kobo: null,
    version: 1,
    self_assessable: false,
    commission_eligible: true,
    status: 'ACTIVE',
    status_reason: null,
  },
];

const REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'The catalogue could not be read.',
  moneyStatus: 'NOT_APPLICABLE',
});

const asked: string[] = [];
let categories: () => unknown;
let authorities: () => unknown;
let items: () => unknown;

beforeEach(() => {
  cleanup();
  asked.length = 0;
  categories = () => CATEGORIES;
  authorities = () => AUTHORITIES;
  items = () => ITEMS;
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    asked.push(path);
    if (path.startsWith('/revenue/authorities')) return authorities() as never;
    if (path.startsWith('/revenue/categories')) return categories() as never;
    if (path.startsWith('/revenue/items')) return items() as never;
    return [] as never;
  });
});

afterEach(() => vi.restoreAllMocks());

describe('an officer reading the catalogue', () => {
  it('is told which government each levy is collected for', async () => {
    render(<CatalogueScreen user={USER} />);

    await screen.findByText('Market stall levy');
    expect(screen.getAllByText(/Plateau State Local Governments/).length).toBeGreaterThan(0);
    // And the MDA beneath it, which is the other half of the mapping.
    expect(screen.getByText('Local Government Councils')).toBeTruthy();
  });

  it('can narrow the catalogue to one arm of government', async () => {
    render(<CatalogueScreen user={USER} />);
    await screen.findByText('Market stall levy');

    fireEvent.change(await screen.findByLabelText(/Arm of government/i), {
      target: { value: 'auth-lg' },
    });

    await waitFor(() =>
      expect(asked.some((path) => path.includes('authorityId=auth-lg'))).toBe(true),
    );
  });

  it('does not report a refused read as an empty catalogue', async () => {
    // "No revenue item matches" is a sentence about the state's catalogue. An
    // officer told it when the request was refused concludes something false
    // about the state.
    items = () => {
      throw REFUSED;
    };
    render(<CatalogueScreen user={USER} />);

    await waitFor(() => expect(screen.getByText(/catalogue could not be read/i)).toBeTruthy());
    expect(screen.getByRole('button', { name: /Try again/i })).toBeTruthy();
  });
});

describe('an officer adding a levy under a new bye-law', () => {
  async function openTheForm() {
    render(<CatalogueScreen user={USER} />);
    fireEvent.click(await screen.findByRole('button', { name: /Add a revenue item/i }));
    return screen.findByLabelText(/Category/i);
  }

  it('can tell the state category from the Council one', async () => {
    /*
     * Both are called "Licences and permits". Flat, the officer has a coin
     * toss over which government collects the levy they are creating.
     */
    const select = await openTheForm();

    const groups = [...select.querySelectorAll('optgroup')].map((node) => node.label);
    expect(groups).toEqual([
      'Plateau State Internal Revenue Service',
      'Plateau State Local Governments',
    ]);
    for (const group of select.querySelectorAll('optgroup')) {
      expect(group.querySelectorAll('option')).toHaveLength(1);
    }
  });

  it('says the list could not be read, instead of offering an empty one', async () => {
    categories = () => {
      throw REFUSED;
    };
    const select = await openTheForm();

    expect(select.querySelectorAll('optgroup')).toHaveLength(0);
    await waitFor(() =>
      expect(screen.getAllByText(/categories could not be read/i).length).toBeGreaterThan(0),
    );
  });

  it('offers the officer a way to ask for the categories again', async () => {
    let attempt = 0;
    categories = () => {
      attempt += 1;
      if (attempt === 1) throw REFUSED;
      return CATEGORIES;
    };
    const select = await openTheForm();
    await screen.findAllByText(/categories could not be read/i);

    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));

    await waitFor(() => expect(select.querySelectorAll('optgroup')).toHaveLength(2));
  });
});
