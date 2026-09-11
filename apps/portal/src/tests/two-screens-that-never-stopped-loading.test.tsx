/**
 * Two screens that answered a refused read with a skeleton for ever.
 *
 * `TaxpayerBaseScreen` is the register: how many taxpayers there are, how many
 * are active, how many have never paid. `OrganisationScreen` is the chart of
 * departments and offices. Both report the failure — the reason is in a card
 * at the top — and both then leave the body under grey bars that never
 * resolve, because their data stays null and null draws a skeleton.
 *
 * A skeleton means "still working". A read that has already failed is not
 * still working, and an officer who cannot tell a slow answer from no answer
 * waits for one that is never coming.
 *
 * The organisation screen fetches its two lists in one `Promise.all`, so one
 * refusal leaves both null and both spinning — which is also why the fix is
 * per list rather than one flag for the screen.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { TaxpayerBaseScreen } from '../screens/TaxpayerBase';
import { OrganisationScreen } from '../screens/Organisation';
import { ApiRequestError, api } from '../lib/api';
import * as apiModule from '../lib/api';
import { permissionsForRole } from '@psirs/shared';

const ANALYTICS = {
  cohorts: {
    total: '4210',
    individuals: '3900',
    businesses: '310',
    new_this_month: '40',
    new_last_month: '35',
    active: '2100',
    inactive: '2110',
    never_paid: '860',
    average_lifetime_kobo: '250000',
    average_payments_each: '3',
    lifetime_kobo: '1052500000',
  },
  byLga: [],
  byCategory: [],
  paymentFrequency: [],
};

const DEPARTMENTS = [{ id: 'd-1', name: 'Revenue', code: 'REV', head_name: null, office_count: 2 }];
const OFFICES = [
  {
    id: 'o-1',
    name: 'Jos North Office',
    code: 'JN',
    department_name: 'Revenue',
    lga_name: 'Jos North',
    supervisor_name: null,
    covers: ['Jos North'],
  },
];

const REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'The register could not be read.',
  moneyStatus: 'NOT_APPLICABLE',
});

const USER = { id: 'u-1', phone: '+2348000000001', fullName: 'Administrator', role: 'admin' };

function signIn() {
  apiModule.setSession(null);
  sessionStorage.setItem(
    'psirs.portal.user',
    JSON.stringify({ ...USER, permissions: permissionsForRole('admin') }),
  );
}

const spinner = () => document.querySelector('[aria-busy="true"]');

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  signIn();
});

afterEach(() => cleanup());

describe('the taxpayer register, when it could not be read', () => {
  it('stops pretending it is still loading', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.includes('/reference/lgas')) return [] as never;
      throw REFUSED;
    });

    render(<TaxpayerBaseScreen />);

    await waitFor(() => expect(screen.getByText(/register could not be read/i)).toBeTruthy());
    expect(spinner(), 'a failed read must not keep drawing a skeleton').toBeNull();
  });

  it('still shows the figures when it can be read', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.includes('/reference/lgas')) return [] as never;
      return ANALYTICS as never;
    });

    render(<TaxpayerBaseScreen />);

    await waitFor(() => expect(screen.getByText('4,210')).toBeTruthy());
  });
});

describe('the organisation chart, when it could not be read', () => {
  /*
   * `getAllByText`, because the screen now makes two independent reads.
   *
   * The chart and the service-wide posting history each say what they could
   * not read, in the place the missing thing would have been. That is the
   * intended behaviour and not a duplicate: one sentence covering two failed
   * reads leaves the officer unable to tell which of them came back.
   */
  const refusals = () => screen.getAllByText(/register could not be read/i);

  it('stops pretending either list is still loading', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(REFUSED);

    render(<OrganisationScreen user={USER as never} />);

    await waitFor(() => expect(refusals().length).toBeGreaterThan(0));
    expect(spinner()).toBeNull();
  });

  it('does not claim the departments list is empty', async () => {
    // A skeleton is one wrong answer; "No departments" would be the other.
    vi.spyOn(api, 'get').mockRejectedValue(REFUSED);

    render(<OrganisationScreen user={USER as never} />);

    await waitFor(() => expect(refusals().length).toBeGreaterThan(0));
    expect(screen.queryByText(/No departments/i)).toBeNull();
  });

  it('shows both lists when they can be read', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.includes('/departments')) return DEPARTMENTS as never;
      if (path.includes('/offices')) return OFFICES as never;
      return [] as never;
    });

    render(<OrganisationScreen user={USER as never} />);

    await waitFor(() => expect(screen.getByText('Jos North Office')).toBeTruthy());
    expect(screen.getByText('Revenue')).toBeTruthy();
  });

  it('still draws a skeleton while a read is genuinely in flight', async () => {
    vi.spyOn(api, 'get').mockImplementation(() => new Promise(() => {}) as never);

    render(<OrganisationScreen user={USER as never} />);

    await waitFor(() => expect(spinner()).toBeTruthy());
    expect(screen.queryByText(/could not be read/i)).toBeNull();
  });
});
