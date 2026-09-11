/**
 * A distribution round, and two failures the screen used to swallow whole.
 *
 * `AllocationRoundScreen` loads the round's figures and the list of people
 * awarded from it. Neither failure reached the officer, in two different ways:
 *
 *   - The round: the catch stored the server's sentence in `error`, and then
 *     `if (!round) return <Loading rows={5} />` returned before the
 *     `<ErrorAlert>` that would have shown it. The screen was holding the
 *     answer behind a skeleton that never resolves.
 *   - The awards: `.catch(() => undefined)`, which kept nothing at all, and
 *     `awards === null` renders the skeleton too.
 *
 * `ReconciliationScreen` was fixed for this class already — "a list that could
 * not be read is not a list with nothing in it" — and this is a step worse
 * than the case it was fixed for: there the officer at least sees an empty
 * table and can wonder about it. Three grey bars invite waiting, and an
 * officer chasing a round of fertiliser nobody has collected will wait.
 *
 * The two are kept apart, because which one failed is the difference between
 * "this round could not be read" and "who was awarded could not be read".
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { AllocationRoundScreen } from '../screens/Groups';
import { ApiRequestError, api } from '../lib/api';
import { permissionsForRole } from '@psirs/shared';

const ROUND = {
  id: 'r1',
  name: 'Fertiliser, Jos North, September',
  unit: 'BAG',
  total_quantity: '500',
  quantity_per_beneficiary: '2',
  status: 'OPEN',
  collection_point: 'Farin Gada store',
  awardedCount: 10,
  awardedQuantity: '20',
  collectedCount: 2,
  collectedQuantity: '4',
  remainingQuantity: '480',
  beneficiariesRemaining: 240,
};

const AWARD = {
  id: 'a1',
  status: 'AWARDED',
  quantity: '2',
  compliance_score: 71,
  awarded_at: '2026-09-01T09:00:00Z',
  collected_at: null,
  taxpayer_name: 'Ladi Dung',
  tin: null,
  group_name: 'Farin Gada Traders',
};

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

const REFUSED = new ApiRequestError(403, {
  code: 'FORBIDDEN',
  message: 'This round belongs to another Local Government Area.',
  moneyStatus: 'NOT_APPLICABLE',
});

/** `api.get`, answering each of the two requests however the test wants. */
function mockLoads(handlers: { round: () => Promise<unknown>; awards: () => Promise<unknown> }) {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
    (path.endsWith('/awards') ? await handlers.awards() : await handlers.round()) as never,
  );
}

const roundOk = async () => ROUND;
const awardsOk = async () => ({ awards: [AWARD] });
const spinner = () => document.querySelector('[aria-busy="true"]');

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  signInAsRevenueOfficer();
});

afterEach(() => cleanup());

describe('a round that could not be read', () => {
  it('says why', async () => {
    mockLoads({ round: () => Promise.reject(REFUSED), awards: awardsOk });
    render(<AllocationRoundScreen roundId="r1" />);

    await waitFor(() =>
      expect(screen.getByText(/belongs to another Local Government Area/i)).toBeTruthy(),
    );
  });

  it('stops pretending it is still loading', async () => {
    mockLoads({ round: () => Promise.reject(REFUSED), awards: awardsOk });
    render(<AllocationRoundScreen roundId="r1" />);

    await waitFor(() =>
      expect(screen.getByText(/belongs to another Local Government Area/i)).toBeTruthy(),
    );
    expect(spinner()).toBeNull();
  });
});

describe('a round whose award list could not be read', () => {
  it('shows the round anyway', async () => {
    mockLoads({ round: roundOk, awards: () => Promise.reject(REFUSED) });
    render(<AllocationRoundScreen roundId="r1" />);

    // The figures are a separate request and a separate answer: losing the
    // names must not cost the officer the totals.
    await waitFor(() => expect(screen.getByText(/Fertiliser, Jos North/)).toBeTruthy());
  });

  it('says why the names are missing, instead of a skeleton', async () => {
    mockLoads({ round: roundOk, awards: () => Promise.reject(REFUSED) });
    render(<AllocationRoundScreen roundId="r1" />);

    await waitFor(() =>
      expect(screen.getByText(/belongs to another Local Government Area/i)).toBeTruthy(),
    );
    expect(spinner()).toBeNull();
  });
});

describe('while it is genuinely still loading', () => {
  /*
   * The control. The remedy is to stop showing a skeleton for a request that
   * has ALREADY failed, not to stop showing one for a request in flight.
   */
  it('still shows the skeleton', async () => {
    mockLoads({ round: () => new Promise(() => {}), awards: () => new Promise(() => {}) });
    render(<AllocationRoundScreen roundId="r1" />);

    await waitFor(() => expect(spinner()).toBeTruthy());
    expect(screen.queryByText(/belongs to another/i)).toBeNull();
  });
});

describe('a round that loads', () => {
  it('names who was awarded from it', async () => {
    mockLoads({ round: roundOk, awards: awardsOk });
    render(<AllocationRoundScreen roundId="r1" />);

    await waitFor(() => expect(screen.getByText('Ladi Dung')).toBeTruthy());
    expect(screen.getByText('Farin Gada Traders')).toBeTruthy();
  });

  /*
   * Two of ten collected is the shape that matters here: goods awarded to
   * people who never turned up are either a distribution that is not reaching
   * anybody, or names on a list that do not correspond to people.
   */
  it('warns when most of the round has not been collected', async () => {
    mockLoads({ round: roundOk, awards: awardsOk });
    render(<AllocationRoundScreen roundId="r1" />);

    await waitFor(() => expect(screen.getByText(/has not been collected/i)).toBeTruthy());
    expect(document.body.textContent).toMatch(/8 beneficiaries were awarded and have not turned up/);
  });

  it('does not warn when nearly all of it has been', async () => {
    mockLoads({
      round: async () => ({ ...ROUND, collectedCount: 9, collectedQuantity: '18' }),
      awards: awardsOk,
    });
    render(<AllocationRoundScreen roundId="r1" />);

    await waitFor(() => expect(screen.getByText('Ladi Dung')).toBeTruthy());
    expect(screen.queryByText(/has not been collected/i)).toBeNull();
  });
});
