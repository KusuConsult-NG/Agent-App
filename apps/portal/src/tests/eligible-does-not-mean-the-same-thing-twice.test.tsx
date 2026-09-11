/**
 * "Eligible" was one word covering three different answers.
 *
 * `GET /taxpayers/:id/incentives` was built, permission-guarded and seeded,
 * and no screen in either front end called it. What it returns per programme
 * is not a yes or a no but one of three states, and the officer sitting with
 * the taxpayer is the person who gets asked about all three:
 *
 *   eligible === null   nobody has evaluated this taxpayer against it
 *   eligible === false  evaluated and refused, with the reasons recorded
 *   eligible === true   entitled — at BASE or at FULL
 *
 * The last distinction is the one the service's own comment is about.
 * `benefit_tier` has been "computed, stored and unit-tested since the
 * additive mode was added, and returned to nobody: a citizen on an additive
 * programme was told eligible, which is what a gated programme says too, and
 * the difference between them is the entire PRD 40 safeguard."
 *
 * The null is the one that does harm if it is collapsed. A screen that draws
 * "not evaluated" the same as "not eligible" has an officer telling somebody
 * they were turned down for a programme nobody has yet considered them for —
 * and there is no appeal against a decision that was never made.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { TaxpayerRecordsScreen } from '../screens/TaxpayerRecords';
import * as apiModule from '../lib/api';
import { ApiRequestError } from '../lib/api';

const USER = {
  id: 'user-1',
  fullName: 'Revenue Officer',
  phone: '+2348000000001',
  email: null,
  role: 'admin',
  permissions: ['taxpayer:read:all', 'incentive:read:all'],
} as never;

const TAXPAYER = {
  id: 'tp-1',
  taxpayer_type: 'INDIVIDUAL',
  tin: 'PL-0000001',
  first_name: 'Ladi',
  last_name: 'Dung',
  business_name: null,
  phone: '+2348030000001',
};

/** One of each of the three states, plus the tier split inside the third. */
const PROGRAMMES = [
  {
    id: 'prog-gated',
    name: 'Small trader relief',
    name_ha: null,
    benefit_type: 'RATE_DISCOUNT',
    benefit_description: '15% off the market levy',
    eligible: true,
    reasons: [],
    benefit_tier: 'FULL',
  },
  {
    id: 'prog-additive',
    name: 'Youth enterprise scheme',
    name_ha: null,
    benefit_type: 'GRANT',
    benefit_description: null,
    eligible: true,
    reasons: [],
    benefit_tier: 'BASE',
  },
  {
    id: 'prog-refused',
    name: 'Agricultural input support',
    name_ha: null,
    benefit_type: 'WAIVER',
    benefit_description: null,
    eligible: false,
    reasons: ['Arrears outstanding on two periods'],
    benefit_tier: null,
  },
  {
    id: 'prog-unseen',
    name: 'Transport operator rebate',
    name_ha: null,
    benefit_type: 'RATE_DISCOUNT',
    benefit_description: null,
    eligible: null,
    reasons: null,
    benefit_tier: null,
  },
];

const REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'The programme register could not be read.',
  moneyStatus: 'NOT_APPLICABLE',
});

let incentives: () => unknown;

beforeEach(() => {
  cleanup();
  incentives = () => ({ programmes: PROGRAMMES });
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/taxpayers/search')) return [TAXPAYER] as never;
    if (path.includes('/incentives')) return incentives() as never;
    if (path.includes('/payments')) {
      return {
        summary: { payments: 0, totalKobo: '0', returnedKobo: '0', byItem: [] },
        rows: [],
      } as never;
    }
    return [] as never;
  });
});

afterEach(() => vi.restoreAllMocks());

/** The panel only exists once a taxpayer has been chosen. */
async function openTaxpayer() {
  render(<TaxpayerRecordsScreen user={USER} />);
  fireEvent.change(screen.getByLabelText(/Find the taxpayer/i), {
    target: { value: 'Ladi' },
  });
  fireEvent.click(screen.getByRole('button', { name: /^Search$/i }));
  fireEvent.click(await screen.findByRole('button', { name: /Ladi Dung/i }));
  await screen.findByText('Small trader relief');
}

describe('an officer asked what a taxpayer is entitled to', () => {
  it('can see it at all, which took an endpoint nobody called', async () => {
    await openTaxpayer();

    expect(screen.getByText(/What this taxpayer is entitled to/i)).toBeTruthy();
    for (const name of [
      'Small trader relief',
      'Youth enterprise scheme',
      'Agricultural input support',
      'Transport operator rebate',
    ]) {
      expect(screen.getByText(name)).toBeTruthy();
    }
  });

  it('separates the full benefit from the base one', async () => {
    // The PRD 40 safeguard. Both rows say `eligible: true`; only the tier
    // says how much of the programme the taxpayer actually gets.
    await openTaxpayer();

    expect(screen.getByText('Full benefit')).toBeTruthy();
    expect(screen.getByText('Base only')).toBeTruthy();
  });

  it('does not report an unevaluated programme as a refusal', async () => {
    await openTaxpayer();

    expect(screen.getByText('Not evaluated')).toBeTruthy();
    // Exactly one refusal, and it is the row that was actually refused.
    expect(screen.getAllByText('Not eligible')).toHaveLength(1);
  });

  it('gives the reasons a refusal was recorded with', async () => {
    // What an officer repeats to the person in front of them. Without it the
    // answer is "no" and nothing they can do about it.
    await openTaxpayer();

    expect(screen.getByText(/Arrears outstanding on two periods/i)).toBeTruthy();
  });
});

describe('when the programme register cannot be read', () => {
  it('says so, rather than drawing a taxpayer with no entitlements', async () => {
    incentives = () => {
      throw REFUSED;
    };
    render(<TaxpayerRecordsScreen user={USER} />);
    fireEvent.change(screen.getByLabelText(/Find the taxpayer/i), {
      target: { value: 'Ladi' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Ladi Dung/i }));

    await waitFor(() =>
      expect(screen.getByText(/programme register could not be read/i)).toBeTruthy(),
    );
    // The sentence for a taxpayer on no programmes is a different answer, and
    // must not be the one shown to somebody whose read failed.
    expect(screen.queryByText(/No programme is running at the moment/i)).toBeNull();
  });

  it('offers a way to ask again', async () => {
    let attempt = 0;
    incentives = () => {
      attempt += 1;
      if (attempt === 1) throw REFUSED;
      return { programmes: PROGRAMMES };
    };
    render(<TaxpayerRecordsScreen user={USER} />);
    fireEvent.change(screen.getByLabelText(/Find the taxpayer/i), {
      target: { value: 'Ladi' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Search$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Ladi Dung/i }));
    await waitFor(() =>
      expect(screen.getByText(/programme register could not be read/i)).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));

    await waitFor(() => expect(screen.getByText('Small trader relief')).toBeTruthy());
  });
});
