/**
 * The screen an officer works coverage leads from.
 *
 * The API refuses a read of somebody's record without a stated purpose. What a
 * screen test can hold is whether the interface makes that a real choice or
 * quietly satisfies it — a dropdown with a default would put a reason on the
 * record the officer never picked, and the purpose log would then record the
 * shape of the form rather than anybody's intention.
 *
 * The other property here is how confidence reaches the officer. The service
 * carries 100 for "the register names them" and 85 for "two records share a
 * phone number". Those are different grounds for going to somebody's premises,
 * and a screen that printed the number would be telling the officer only what
 * they already had to know to read it.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ConnectionsScreen } from '../screens/Connections';
import * as apiModule from '../lib/api';

const LEADS = {
  summary: { leads: 2, vehicles: 4, unmatchedVehicles: 7 },
  rows: [
    {
      taxpayerId: 'tp-1',
      name: 'Musa Haruna',
      tin: 'P7654321',
      phone: '+2348030000001',
      lgaId: 'lga-1',
      lgaName: 'Jos North',
      commercialVehicles: 3,
      registrations: ['PL-101-AA', 'PL-102-AB', 'PL-103-AC'],
      lowestConfidence: 100,
      chargedCommercialRate: true,
      paidLastYearKobo: '0',
    },
    {
      taxpayerId: 'tp-2',
      name: 'Grace Bitrus',
      tin: null,
      phone: '+2348030000002',
      lgaId: 'lga-1',
      lgaName: 'Jos North',
      commercialVehicles: 1,
      registrations: ['PL-204-BD'],
      lowestConfidence: 85,
      chargedCommercialRate: false,
      paidLastYearKobo: '450000',
    },
  ],
};

const RECORD = {
  taxpayerId: 'tp-1',
  name: 'Musa Haruna',
  tin: 'P7654321',
  connections: [
    {
      id: 'edge-1',
      kind: 'OWNS',
      subjectType: 'VEHICLE',
      subjectLabel: 'PL-101-AA — Toyota Hiace',
      source: 'VEHICLE_REGISTRY',
      confidence: 100,
      matchBasis: 'TAXPAYER_ID',
      lawfulBasis: 'Plateau State revenue administration — assessment and collection',
      state: 'ASSERTED',
      stateReason: null,
      obtainedAt: '2026-08-01T10:00:00.000Z',
      obtainedByJob: 'connection-graph',
    },
  ],
  liabilities: [
    {
      kind: 'INVOICE',
      reference: 'INV-2026-0001',
      description: 'Shops and kiosks levy',
      amountKobo: '750000',
      since: '2026-07-01T10:00:00.000Z',
      payable: true,
    },
    {
      kind: 'INVOICE',
      reference: 'INV-2026-0002',
      description: 'Daily market levy',
      amountKobo: '120000',
      since: '2026-02-01T10:00:00.000Z',
      payable: false,
    },
  ],
  totalOwedKobo: '870000',
};

let asked: string[] = [];
let posted: { path: string; body: unknown }[] = [];

function stubApi() {
  asked = [];
  posted = [];
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    asked.push(path);
    if (path.startsWith('/reference/lgas')) return [{ id: 'lga-1', name: 'Jos North' }] as never;
    if (path.startsWith('/government/intelligence/leads')) return LEADS as never;
    if (path.startsWith('/government/intelligence/taxpayers/')) return RECORD as never;
    return [] as never;
  });
  vi.spyOn(apiModule.api, 'post').mockImplementation(async (path: string, body?: unknown) => {
    posted.push({ path, body });
    return { asserted: 3, fromRegistry: 2, fromPhone: 1, ambiguous: 0 } as never;
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

describe('opening somebody’s record', () => {
  it('will not open one until the officer has said why', async () => {
    render(<ConnectionsScreen />);
    await waitFor(() => expect(screen.getByText('Musa Haruna')).toBeTruthy());

    const open = screen.getAllByRole('button', { name: /Open record/i })[0]!;
    expect(open).toHaveProperty('disabled', true);

    fireEvent.click(open);
    expect(
      asked.filter((path) => path.startsWith('/government/intelligence/taxpayers/')),
      'the read is logged against a citizen, so it must not happen by accident',
    ).toHaveLength(0);
  });

  it('offers no purpose by default, so the stated reason is a real choice', async () => {
    render(<ConnectionsScreen />);
    await waitFor(() => expect(screen.getByLabelText(/Why are you opening/i)).toBeTruthy());

    const select = screen.getByLabelText(/Why are you opening/i) as HTMLSelectElement;
    expect(
      select.value,
      'a default purpose would log the shape of the form rather than anybody’s intention',
    ).toBe('');
  });

  it('sends the chosen purpose with the read', async () => {
    render(<ConnectionsScreen />);
    await waitFor(() => expect(screen.getByLabelText(/Why are you opening/i)).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/Why are you opening/i), {
      target: { value: 'CONSISTENCY_CHECK' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: /Open record/i })[0]!);

    await waitFor(() => {
      const read = asked.find((path) => path.startsWith('/government/intelligence/taxpayers/'));
      expect(read).toBeTruthy();
      expect(new URL(read!, 'http://x').searchParams.get('purpose')).toBe('CONSISTENCY_CHECK');
    });
  });
});

describe('what the lead list says', () => {
  it('says how it knows, in words rather than a score', async () => {
    render(<ConnectionsScreen />);
    await waitFor(() => expect(screen.getByText('Musa Haruna')).toBeTruthy());

    expect(screen.getByText('The register names them')).toBeTruthy();
    expect(screen.getByText('Matched on a shared phone number')).toBeTruthy();
    expect(
      screen.queryByText('85'),
      'a bare confidence number tells an officer nothing they did not already need to know',
    ).toBeNull();
  });

  it('states the vehicles it could not connect to anybody', async () => {
    render(<ConnectionsScreen />);
    await waitFor(() => expect(screen.getByText(/connected to nobody/i)).toBeTruthy());
    expect(screen.getByText(/connected to nobody/i).textContent).toMatch(/7 vehicle/);
  });

  it('warns that a line is a claim and not a finding', async () => {
    render(<ConnectionsScreen />);
    await waitFor(() => expect(screen.getByText(/What this list is/i)).toBeTruthy());
    expect(screen.getByText(/a reason to ask, never a reason to assess/i)).toBeTruthy();
  });
});

describe('the record itself', () => {
  async function openRecord() {
    render(<ConnectionsScreen />);
    await waitFor(() => expect(screen.getByLabelText(/Why are you opening/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Why are you opening/i), {
      target: { value: 'COVERAGE_LEAD' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: /Open record/i })[0]!);
    await waitFor(() => expect(screen.getByText(/What the State claims about them/i)).toBeTruthy());
  }

  it('shows the power relied on for each claim', async () => {
    await openRecord();
    expect(
      screen.getByText(/Plateau State revenue administration/),
      'a claim that cannot say what power it rests on cannot be defended to the person it is about',
    ).toBeTruthy();
  });

  it('shows what they owe and which part cannot be paid as it stands', async () => {
    await openRecord();
    expect(screen.getByText('INV-2026-0001')).toBeTruthy();
    expect(screen.getByText(/needs a fresh assessment/i)).toBeTruthy();
  });

  it('records a dispute against the claim, with the reason', async () => {
    await openRecord();

    fireEvent.change(screen.getByLabelText(/Why are you changing this claim/i), {
      target: { value: 'Taxpayer says the bus is his brother’s' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Taxpayer disputes/i }));

    await waitFor(() => {
      const decision = posted.find((call) => call.path.includes('/decision'));
      expect(decision).toBeTruthy();
      expect(decision!.body).toMatchObject({
        state: 'DISPUTED',
        reason: 'Taxpayer says the bus is his brother’s',
      });
    });
  });

  it('will not change a claim until a reason has been written', async () => {
    await openRecord();

    const withdraw = screen.getByRole('button', { name: /Withdraw claim/i });
    expect(withdraw).toHaveProperty('disabled', true);
    fireEvent.click(withdraw);

    expect(
      posted.filter((call) => call.path.includes('/decision')),
      'an unexplained change to a record about a person is not a change worth making',
    ).toHaveLength(0);

    // And it becomes possible once one is written — so the assertion is about
    // the missing reason rather than a button that never works.
    fireEvent.change(screen.getByLabelText(/Why are you changing this claim/i), {
      target: { value: 'Vehicle sold before this record was made' },
    });
    expect(screen.getByRole('button', { name: /Withdraw claim/i })).toHaveProperty('disabled', false);
  });

  it('clears the reason after it has been used, so it is not reused by accident', async () => {
    await openRecord();
    fireEvent.change(screen.getByLabelText(/Why are you changing this claim/i), {
      target: { value: 'Confirmed on the telephone' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Taxpayer confirms/i }));

    await waitFor(() =>
      expect((screen.getByLabelText(/Why are you changing this claim/i) as HTMLTextAreaElement).value).toBe(''),
    );
  });
});
