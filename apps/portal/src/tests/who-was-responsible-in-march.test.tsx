/**
 * A dispute that starts from a place, and a history filed under a name.
 *
 * `GET /government/transfers` was written with its purpose in its own
 * comment — "the question a revenue dispute asks: who was responsible for Jos
 * North in March, and the reason postings are a table rather than a log" —
 * and had no caller in either front end. One of the reads recorded in
 * READ_WITHOUT_A_SCREEN.
 *
 * The officer access screen already answers the same question for ONE
 * officer. That only helps somebody who already knows whose record to open,
 * and a dispute does not: it starts from an area and a date, which is the
 * whole difficulty.
 *
 * The permission is the other half. `/government/transfers` is guarded on
 * `user:manage` OR `audit:read`, and the auditor holds only the second —
 * which is the role that asks the question.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { OrganisationScreen } from '../screens/Organisation';
import * as apiModule from '../lib/api';
import { ApiRequestError } from '../lib/api';

const USER = {
  id: 'user-1',
  fullName: 'Auditor',
  phone: '+2348000000001',
  email: null,
  role: 'auditor',
  permissions: ['audit:read'],
} as never;

const TRANSFERS = [
  {
    id: 'tr-1',
    kind: 'OFFICE',
    from_value: null,
    to_value: null,
    reason: 'Rotation after the Jos North audit',
    effective_from: '2026-03-04',
    recorded_by_name: 'Administrator',
    full_name: 'Ladi Bature',
    role: 'revenue_officer',
    staff_number: 'PS-0412',
  },
];

const REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'The posting history could not be read.',
  moneyStatus: 'NOT_APPLICABLE',
});

const asked: string[] = [];
let transfers: () => unknown;
let allowed: (permission: string) => boolean;

beforeEach(() => {
  cleanup();
  asked.length = 0;
  transfers = () => TRANSFERS;
  allowed = () => true;
  vi.spyOn(apiModule, 'can').mockImplementation((...names: string[]) =>
    names.some((name) => allowed(name)),
  );
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    asked.push(path);
    if (path.startsWith('/government/transfers')) return transfers() as never;
    return [] as never;
  });
});

afterEach(() => vi.restoreAllMocks());

describe('an auditor asking who was responsible', () => {
  it('can read the whole service, not one officer at a time', async () => {
    render(<OrganisationScreen user={USER} />);

    await screen.findByText('Ladi Bature');
    expect(screen.getByText(/Rotation after the Jos North audit/)).toBeTruthy();
    expect(screen.getByText(/PS-0412/)).toBeTruthy();
  });

  it('gets it on audit:read alone, which is the permission the role holds', async () => {
    // `user:manage` is the administrator's. An auditor who could not open this
    // is an auditor who cannot start the investigation it exists for.
    allowed = (permission) => permission === 'audit:read';
    render(<OrganisationScreen user={USER} />);

    await waitFor(() =>
      expect(asked.some((path) => path.startsWith('/government/transfers'))).toBe(true),
    );
  });

  it('asks nothing of the endpoint when the officer holds neither permission', async () => {
    allowed = () => false;
    render(<OrganisationScreen user={USER} />);

    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(asked.some((path) => path.startsWith('/government/transfers'))).toBe(false);
  });

  it('narrows to a kind of move and a period', async () => {
    render(<OrganisationScreen user={USER} />);
    await screen.findByText('Ladi Bature');

    fireEvent.change(screen.getByLabelText(/What moved/i), { target: { value: 'OFFICE' } });
    fireEvent.change(screen.getByLabelText(/^From$/i), { target: { value: '2026-03-01' } });

    await waitFor(() =>
      expect(
        asked.some((path) => path.includes('kind=OFFICE') && path.includes('from=2026-03-01')),
      ).toBe(true),
    );
  });

  it('does not report a refused read as a service where nobody has moved', async () => {
    /*
     * "No posting was recorded in this period" is a finding, and the finding a
     * dispute would read as exonerating. A refused request must not be able to
     * say it.
     */
    transfers = () => {
      throw REFUSED;
    };
    render(<OrganisationScreen user={USER} />);

    await waitFor(() =>
      expect(screen.getByText(/posting history could not be read/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/No posting was recorded in this period/i)).toBeNull();
  });
});
