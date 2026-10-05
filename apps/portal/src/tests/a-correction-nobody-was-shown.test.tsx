/**
 * The corrections tile, and where it sends the officer.
 *
 * It opened the approvals queue, where no correction has ever been, for a
 * count of an approval type the database refuses — so it read 0 and went
 * nowhere useful. The count is now of correction requests, which are cases
 * (see the API test of the same name), and the tile opens the case list
 * already narrowed to them, so the number and the list are one set.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { permissionsForRole } from '@psirs/shared';
import { RoleHomeScreen } from '../screens/RoleHome';
import { CasesScreen } from '../screens/Cases';
import { api } from '../lib/api';

const user = (role: string) =>
  ({
    id: 'u1',
    phone: '+2348000000001',
    fullName: 'Records Officer',
    email: null,
    role,
    permissions: permissionsForRole(role as never),
  }) as never;

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('the corrections tile', () => {
  it('opens the correction requests, not the approvals queue', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      role: 'revenue_officer',
      revenue: {
        taxpayers: '10',
        registered_this_week: '1',
        tins_outstanding: '0',
        tins_failed: '0',
        corrections_awaiting_review: '2',
        invoices_unpaid: '0',
        invoices_expired: '0',
        unpaid_kobo: '0',
      },
    } as never);
    const navigated: string[] = [];
    render(<RoleHomeScreen user={user('revenue_officer')} navigate={(path) => navigated.push(path)} />);

    const label = await screen.findByText(/Corrections awaiting review/i);
    const row = label.closest('tr, li, .card, div')!;
    const open = [...row.parentElement!.querySelectorAll('button')].find((button) =>
      (button.closest('tr, li') ?? button.parentElement)?.textContent?.includes('Corrections awaiting review'),
    );
    expect(open, 'the tile has an open control').toBeTruthy();
    fireEvent.click(open!);
    expect(navigated).toEqual(['/cases?category=DATA_CORRECTION']);
  });
});

describe('the case list, arriving with a category', () => {
  const asked: string[] = [];
  beforeEach(() => {
    asked.length = 0;
    vi.spyOn(api, 'get').mockImplementation((async (path: string) => {
      asked.push(path);
      return [];
    }) as never);
  });

  it('asks only for that category', async () => {
    render(
      <CasesScreen user={user('revenue_officer')} route="/cases?category=DATA_CORRECTION" navigate={vi.fn()} />,
    );
    await waitFor(() => expect(asked.some((path) => path.startsWith('/government/cases'))).toBe(true));
    expect(asked.find((path) => path.startsWith('/government/cases'))).toMatch(/category=DATA_CORRECTION/);
  });

  it('ignores a category it does not know rather than filtering to nothing', async () => {
    render(<CasesScreen user={user('revenue_officer')} route="/cases?category=NONSENSE" navigate={vi.fn()} />);
    await waitFor(() => expect(asked.some((path) => path.startsWith('/government/cases'))).toBe(true));
    expect(asked.find((path) => path.startsWith('/government/cases'))).not.toMatch(/category=/);
  });
});
