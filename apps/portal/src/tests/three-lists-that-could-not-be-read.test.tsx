/**
 * Three lists, and what the screen said when it could not read them.
 *
 * `AllocationsScreen` answered every refusal by writing `[]` into the state it
 * renders from, and each of the three then stated as fact something it did not
 * know:
 *
 *   - the programme list: "No programme exists yet. One has to be created
 *     under Social incentives before a round can distribute under it."
 *   - the awards drawer: "Nobody has been awarded under this round yet."
 *   - the rounds table: "No distribution round has been created."
 *
 * The programme one is the one that costs an officer their afternoon. It is
 * not merely uninformative — it is an instruction, and it sends somebody to
 * create a programme that may already exist while blocking the round they came
 * to make. Nothing on the screen said a request had failed.
 *
 * This is the inverse of what the round detail screen was doing next door: one
 * showed a skeleton for ever and said nothing, the other says something untrue.
 * Same cause, opposite symptom, and the untrue one is worse — an officer can
 * see that a spinner is not progress.
 *
 * `null` is "not known yet", `[]` is "read, and empty", and an error is
 * "asked, and refused".
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AllocationsScreen } from '../screens/Allocations';
import { ApiRequestError, api } from '../lib/api';
import { permissionsForRole } from '@psirs/shared';

const ROUND = {
  id: 'r1',
  name: 'Fertiliser, Jos North, September',
  unit: 'BAG_50KG',
  total_quantity: '500',
  quantity_per_beneficiary: '2',
  collection_point: 'Farin Gada store',
  status: 'OPEN',
  opens_at: '2026-09-01T08:00:00Z',
  closes_at: null,
  programme_name: 'Dry season inputs',
  programme_name_ha: null,
  awarded_count: '10',
  awarded_quantity: '20',
};

const PROGRAMME = { id: 'p1', name: 'Dry season inputs', name_ha: null };

const AWARD = {
  id: 'a1',
  status: 'AWARDED',
  quantity: '2',
  taxpayer_name: 'Ladi Dung',
  collected_at: null,
};

const REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'The programme register could not be reached.',
  moneyStatus: 'NOT_APPLICABLE',
});

function signInAsRevenueOfficer() {
  sessionStorage.setItem(
    'psirs.portal.user',
    JSON.stringify({
      id: 'u1',
      phone: '+2348000000002',
      fullName: 'Revenue Officer',
      role: 'revenue_officer',
      permissions: permissionsForRole('revenue_officer'),
    }),
  );
}

/** Each of the three reads, answered however the test wants. */
function mockLoads(handlers: {
  rounds?: () => Promise<unknown>;
  programmes?: () => Promise<unknown>;
  awards?: () => Promise<unknown>;
}) {
  const rounds = handlers.rounds ?? (async () => ({ rounds: [ROUND] }));
  const programmes = handlers.programmes ?? (async () => [PROGRAMME]);
  const awards = handlers.awards ?? (async () => ({ awards: [AWARD] }));
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.endsWith('/awards')) return (await awards()) as never;
    if (path.startsWith('/government/programmes')) return (await programmes()) as never;
    return (await rounds()) as never;
  });
}

const openCreateForm = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Create a round/i }));
};

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  signInAsRevenueOfficer();
});

afterEach(() => cleanup());

describe('the programme list', () => {
  it('does not claim no programme exists when it could not be read', async () => {
    mockLoads({ programmes: () => Promise.reject(REFUSED) });
    render(<AllocationsScreen />);
    await openCreateForm();

    await waitFor(() =>
      expect(screen.getByText(/programme register could not be reached/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/No programme exists yet/i)).toBeNull();
  });

  /*
   * The control, and the reason this cannot simply be "stop saying it". When
   * the register really is empty that sentence is the most useful thing on
   * the screen: it names the thing to go and create.
   */
  it('still says so when there genuinely is no programme', async () => {
    mockLoads({ programmes: async () => [] });
    render(<AllocationsScreen />);
    await openCreateForm();

    await waitFor(() => expect(screen.getByText(/No programme exists yet/i)).toBeTruthy());
  });

  it('says nothing either way until the answer arrives', async () => {
    mockLoads({ programmes: () => new Promise(() => {}) });
    render(<AllocationsScreen />);
    await openCreateForm();

    await waitFor(() => expect(screen.getByText(/Select a programme/i)).toBeTruthy());
    expect(screen.queryByText(/No programme exists yet/i)).toBeNull();
  });
});

describe('the rounds table', () => {
  it('does not report a refused read as no rounds existing', async () => {
    mockLoads({ rounds: () => Promise.reject(REFUSED) });
    render(<AllocationsScreen />);

    await waitFor(() =>
      expect(screen.getByText(/programme register could not be reached/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/No distribution round has been created/i)).toBeNull();
  });

  it('leaves the officer able to create one anyway', async () => {
    // Making a round does not depend on being able to list them, so a failed
    // list must not take the form away.
    mockLoads({ rounds: () => Promise.reject(REFUSED) });
    render(<AllocationsScreen />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Create a round/i })).toBeTruthy(),
    );
  });

  it('still says so when there genuinely are none', async () => {
    mockLoads({ rounds: async () => ({ rounds: [] }) });
    render(<AllocationsScreen />);

    await waitFor(() =>
      expect(screen.getByText(/No distribution round has been created/i)).toBeTruthy(),
    );
  });
});

describe('the awards drawer', () => {
  const openAwards = async () => {
    await waitFor(() => expect(screen.getByText(/Fertiliser, Jos North/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Awards$/ }));
  };

  it('does not claim nobody was awarded when the list could not be read', async () => {
    mockLoads({ awards: () => Promise.reject(REFUSED) });
    render(<AllocationsScreen />);
    await openAwards();

    await waitFor(() =>
      expect(screen.getByText(/programme register could not be reached/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/Nobody has been awarded/i)).toBeNull();
  });

  it('still says so when nobody has been', async () => {
    mockLoads({ awards: async () => ({ awards: [] }) });
    render(<AllocationsScreen />);
    await openAwards();

    await waitFor(() => expect(screen.getByText(/Nobody has been awarded/i)).toBeTruthy());
  });

  it('lists the beneficiaries when it can be read', async () => {
    mockLoads({});
    render(<AllocationsScreen />);
    await openAwards();

    await waitFor(() => expect(screen.getByText('Ladi Dung')).toBeTruthy());
  });
});
