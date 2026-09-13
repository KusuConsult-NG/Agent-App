/**
 * A data-protection log that was written and never read.
 *
 * The connections screen calls itself "part of the control, not a window onto
 * it": the API refuses a read of somebody's record without a stated purpose,
 * so the officer must pick one, and every choice is written to
 * `taxpayer_connection_access_logs`.
 *
 * `GET /government/intelligence/taxpayers/:id/access-log` is what reads that
 * table back, and it had no caller in either front end — one of the reads
 * recorded in READ_WITHOUT_A_SCREEN. A safeguard whose entire value is that
 * somebody eventually looks at it, which nobody could look at, is a table
 * that costs disk and protects nobody: an officer running coverage queries
 * against a neighbour could pick whichever purpose from the dropdown, knowing
 * the record of it went somewhere nothing reads.
 *
 * Two things the panel must get right. It is behind `audit:read`, as the
 * endpoint is — the route's own comment says why: "the officers who look at
 * the graph should not be the ones who decide what the log of their looking
 * says". And it shows the ROLE, not the name, which is the service's decision
 * and not this screen's: "naming the individual invites reprisal in a small
 * LGA and adds nothing to the accountability the log provides."
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ConnectionsScreen } from '../screens/Connections';
import * as apiModule from '../lib/api';
import { ApiRequestError } from '../lib/api';

const LEADS = {
  summary: { leads: 1, vehicles: 3, unmatchedVehicles: 2 },
  rows: [
    {
      taxpayerId: 'tp-1',
      name: 'Musa Haruna',
      tin: 'P7654321',
      phone: '+2348030000001',
      lgaId: 'lga-1',
      lgaName: 'Jos North',
      commercialVehicles: 3,
      registrations: ['PL-101-AA'],
      lowestConfidence: 100,
      chargedCommercialRate: true,
      paidLastYearKobo: '0',
    },
  ],
};

const RECORD = {
  taxpayerId: 'tp-1',
  name: 'Musa Haruna',
  tin: 'P7654321',
  connections: [],
  liabilities: [],
  totalOwedKobo: '0',
};

const ACCESS = [
  {
    purpose: 'Assessment of undeclared commercial activity',
    at: '2026-08-14T09:30:00.000Z',
    officerRole: 'revenue_officer',
  },
  {
    purpose: 'Investigation of a fraud flag',
    at: '2026-08-02T15:05:00.000Z',
    officerRole: 'auditor',
  },
];

const REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'The access log could not be read.',
  moneyStatus: 'NOT_APPLICABLE',
});

const asked: string[] = [];
let accessLog: () => unknown;
let allowed: (permission: string) => boolean;

beforeEach(() => {
  cleanup();
  asked.length = 0;
  accessLog = () => ACCESS;
  allowed = () => true;
  vi.spyOn(apiModule, 'can').mockImplementation((...names: string[]) =>
    names.some((name) => allowed(name)),
  );
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    asked.push(path);
    if (path.startsWith('/reference/lgas')) return [{ id: 'lga-1', name: 'Jos North' }] as never;
    if (path.startsWith('/government/intelligence/leads')) return LEADS as never;
    if (path.includes('/access-log')) return accessLog() as never;
    if (path.startsWith('/government/intelligence/taxpayers/')) return RECORD as never;
    return [] as never;
  });
});

afterEach(() => vi.restoreAllMocks());

/** The panel exists only once a record has actually been opened. */
async function openRecord() {
  render(<ConnectionsScreen />);
  await waitFor(() => expect(screen.getByLabelText(/Why are you opening/i)).toBeTruthy());
  fireEvent.change(screen.getByLabelText(/Why are you opening/i), {
    target: { value: 'COVERAGE_LEAD' },
  });
  fireEvent.click(screen.getAllByRole('button', { name: /Open record/i })[0]!);
  await waitFor(() => expect(screen.getByText(/What the State claims about them/i)).toBeTruthy());
}

describe('the log of who has read a citizen’s record', () => {
  it('can be read at all, which took an endpoint nobody called', async () => {
    await openRecord();

    await screen.findByText(/Who has opened this record/i);
    expect(screen.getByText('Investigation of a fraud flag')).toBeTruthy();
    expect(screen.getAllByText(/Assessment of undeclared commercial activity/).length)
      .toBeGreaterThan(0);
  });

  it('names the role and not the officer, as the service decided', async () => {
    // Not this screen's call to make: the endpoint returns no name at all.
    await openRecord();

    await screen.findByText(/Who has opened this record/i);
    expect(screen.getByText(/Auditor/i)).toBeTruthy();
  });

  it('is not offered to an officer without audit:read', async () => {
    /*
     * The route's own reasoning: the officers who look at the graph must not
     * be the ones who decide what the log of their looking says.
     */
    allowed = (permission) => permission !== 'audit:read';
    await openRecord();

    await waitFor(() =>
      expect(asked.some((path) => path.startsWith('/government/intelligence/taxpayers/'))).toBe(
        true,
      ),
    );
    expect(asked.some((path) => path.includes('/access-log'))).toBe(false);
    expect(screen.queryByText(/Who has opened this record/i)).toBeNull();
  });

  it('does not report a refused read as a record nobody has opened', async () => {
    // "Nobody has opened this record" is where an investigation stops.
    accessLog = () => {
      throw REFUSED;
    };
    await openRecord();

    await waitFor(() => expect(screen.getByText(/access log could not be read/i)).toBeTruthy());
    expect(screen.queryByText(/Nobody has opened this record/i)).toBeNull();
  });

  it('keeps the record on screen when the log alone cannot be read', async () => {
    /*
     * The first version of this panel called `.map` on whatever came back,
     * and an unrecognised body took the connections, the liabilities and the
     * dispute controls down with it. A missing section is not a missing
     * screen.
     */
    accessLog = () => ({ not: 'an array' });
    await openRecord();

    await screen.findByText(/Who has opened this record/i);
    // The name appears in the lead row and again in the opened record; what
    // matters is that the record below the log is still drawn.
    expect(screen.getByText(/What the State claims about them/i)).toBeTruthy();
    expect(screen.getAllByText('Musa Haruna').length).toBeGreaterThan(1);
  });
});
