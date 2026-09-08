/**
 * The screen an officer files a PAYE return from.
 *
 * One property carries this whole phase: the employer declares what people
 * were paid, and the platform works out the tax. The screen's job is to make
 * that structurally true rather than merely stated — there is no field for the
 * tax, so there is nothing to argue about at a counter, and the officer is
 * told as much in words they can repeat to the employer.
 *
 * The other thing tested here is the denominator. "Forty schools have never
 * filed" means something different against forty-two schools on the register
 * than against four hundred, and a screen that shows only the first number has
 * told the officer less than it appears to.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { PayrollScreen } from '../screens/Payroll';
import * as apiModule from '../lib/api';

const LEADS = {
  summary: { leads: 2, filing: 5 },
  rows: [
    {
      taxpayerId: 'tp-1',
      name: 'Highland Academy',
      tin: 'P9000001',
      phone: '+2348030000001',
      lgaId: 'lga-1',
      lgaName: 'Jos North',
      economicSector: 'EDUCATION',
      natureOfBusiness: 'Private secondary school',
      monthsSinceLastFiling: null,
      paidLastYearKobo: '0',
    },
    {
      taxpayerId: 'tp-2',
      name: 'Vom Clinic',
      tin: null,
      phone: '+2348030000002',
      lgaId: 'lga-1',
      lgaName: 'Jos South',
      economicSector: 'HEALTHCARE',
      natureOfBusiness: 'Private clinic',
      monthsSinceLastFiling: null,
      paidLastYearKobo: '250000',
    },
  ],
};

let asked: string[] = [];
let posted: { path: string; body: any }[] = [];
let history: any[] = [];

const FILED_RETURN = {
  scheduleId: 'sch-1',
  periodYear: 2026,
  periodMonth: 7,
  status: 'FILED',
  employeeCount: 2,
  grossEmolumentsKobo: '24000000',
  taxDueKobo: '1600000',
  filedAt: '2026-08-02T09:00:00.000Z',
  cancelledReason: null,
};

function stubApi() {
  asked = [];
  posted = [];
  history = [];
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    asked.push(path);
    if (path.startsWith('/reference/lgas')) return [{ id: 'lga-1', name: 'Jos North' }] as never;
    if (path.includes('/returns')) return history as never;
    return LEADS as never;
  });
  vi.spyOn(apiModule.api, 'post').mockImplementation(async (path: string, body?: unknown) => {
    posted.push({ path, body });
    return {
      employeeCount: 2,
      grossEmolumentsKobo: '24000000',
      taxDueKobo: '1600000',
      invoiceNumber: 'INV-2026-0042',
      employeesWithoutTin: 1,
    } as never;
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

async function openEmployer() {
  render(<PayrollScreen />);
  await waitFor(() => expect(screen.getByText('Highland Academy')).toBeTruthy());
  fireEvent.click(screen.getAllByRole('button', { name: /^Open$/i })[0]!);
  await waitFor(() => expect(screen.getByText(/File a return/i)).toBeTruthy());
}

describe('the return form', () => {
  it('has nowhere to type a tax figure', async () => {
    await openEmployer();

    /*
     * The property the whole phase rests on, asserted as an absence. If a tax
     * box existed the amount would be negotiable at a counter, which is the
     * entire failure mode of PAYE — and no amount of server-side validation
     * makes an argument in front of an employer go away.
     */
    expect(screen.getByLabelText(/Employee name 1/i)).toBeTruthy();
    expect(screen.getByLabelText(/Paid this month.*\b1$/i)).toBeTruthy();
    expect(screen.queryByLabelText(/^tax/i)).toBeNull();
    expect(screen.queryByLabelText(/tax due/i)).toBeNull();
  });

  it('tells the officer how the tax is worked out, in words they can repeat', async () => {
    await openEmployer();
    const note = screen.getByText(/works out the tax on each of them separately/i);
    expect(note.textContent).toMatch(/annual bands/i);
    expect(note.textContent).toMatch(/no box for the tax/i);
  });

  it('sends emoluments in kobo, from naira on the form', async () => {
    await openEmployer();

    fireEvent.change(screen.getByLabelText(/Employee name 1/i), { target: { value: 'Ada Okoro' } });
    fireEvent.change(screen.getByLabelText(/Paid this month.*\b1$/i), { target: { value: '120000' } });
    fireEvent.click(screen.getByRole('button', { name: /File this return/i }));

    await waitFor(() => {
      const call = posted.find((entry) => entry.path === '/government/paye/returns');
      expect(call).toBeTruthy();
      expect(call!.body.lines).toHaveLength(1);
      expect(call!.body.lines[0]).toMatchObject({
        employeeName: 'Ada Okoro',
        grossEmolumentKobo: '12000000',
      });
      expect(call!.body.lines[0].taxKobo).toBeUndefined();
    });
  });

  it('will not file an empty return', async () => {
    await openEmployer();
    const submit = screen.getByRole('button', { name: /File this return/i });
    expect(submit).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText(/Employee name 1/i), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText(/Paid this month.*\b1$/i), { target: { value: '120000' } });
    expect(screen.getByRole('button', { name: /File this return/i })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('drops a half-typed row rather than sending a nameless employee', async () => {
    await openEmployer();
    fireEvent.change(screen.getByLabelText(/Employee name 1/i), { target: { value: 'Ada Okoro' } });
    fireEvent.change(screen.getByLabelText(/Paid this month.*\b1$/i), { target: { value: '120000' } });
    fireEvent.click(screen.getByRole('button', { name: /Add another employee/i }));
    // Second row left blank on purpose.
    fireEvent.click(screen.getByRole('button', { name: /File this return/i }));

    await waitFor(() => {
      const call = posted.find((entry) => entry.path === '/government/paye/returns');
      expect(call!.body.lines).toHaveLength(1);
    });
  });

  it('reports the invoice and the employees with no TIN', async () => {
    await openEmployer();
    fireEvent.change(screen.getByLabelText(/Employee name 1/i), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText(/Paid this month.*\b1$/i), { target: { value: '120000' } });
    fireEvent.click(screen.getByRole('button', { name: /File this return/i }));

    await waitFor(() => expect(screen.getByText(/INV-2026-0042/)).toBeTruthy());
    expect(screen.getByText(/had no TIN/i).textContent).toMatch(/1 of them/);
  });
});

describe('the lead list', () => {
  it('shows how many are already filing, not only how many are not', async () => {
    render(<PayrollScreen />);
    await waitFor(() => expect(screen.getByText('Highland Academy')).toBeTruthy());

    expect(screen.getByText('Not filing')).toBeTruthy();
    expect(screen.getByText('Already filing')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('switches to the consumption tax list on a different endpoint', async () => {
    render(<PayrollScreen />);
    await waitFor(() => expect(screen.getByLabelText(/Which list/i)).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/Which list/i), { target: { value: 'CONSUMPTION' } });
    await waitFor(() =>
      expect(asked.some((path) => path.startsWith('/government/consumption-tax/not-paying'))).toBe(
        true,
      ),
    );
  });

  it('asks the API for a narrower list rather than filtering the page', async () => {
    render(<PayrollScreen />);
    await waitFor(() => expect(screen.getByLabelText(/Local government/i)).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/Local government/i), { target: { value: 'lga-1' } });
    await waitFor(() =>
      expect(asked.some((path) => path.includes('not-filing?') && path.includes('lgaId=lga-1'))).toBe(
        true,
      ),
    );
  });

  it('names the sector, so an officer knows what they are walking into', async () => {
    render(<PayrollScreen />);
    await waitFor(() => expect(screen.getByText('Private secondary school')).toBeTruthy());
    expect(screen.getByText(/Education/i)).toBeTruthy();
  });
});

describe('withdrawing a return', () => {
  it('will not withdraw one until a reason is written', async () => {
    history = [FILED_RETURN];
    await openEmployer();

    const button = screen.getByRole('button', { name: /^Withdraw$/i });
    expect(button).toHaveProperty('disabled', true);
    fireEvent.click(button);
    expect(
      posted.filter((entry) => entry.path.includes('/cancel')),
      'retracting the State’s position on what an employer declared is not done silently',
    ).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/Why is this return being withdrawn/i), {
      target: { value: 'Two staff listed who had already left' },
    });
    expect(screen.getByRole('button', { name: /^Withdraw$/i })).toHaveProperty('disabled', false);
  });

  it('sends the reason with the withdrawal', async () => {
    history = [FILED_RETURN];
    await openEmployer();

    fireEvent.change(screen.getByLabelText(/Why is this return being withdrawn/i), {
      target: { value: 'Filed against the wrong school' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Withdraw$/i }));

    await waitFor(() => {
      const call = posted.find((entry) => entry.path.includes('/cancel'));
      expect(call).toBeTruthy();
      expect(call!.path).toBe('/government/paye/returns/sch-1/cancel');
      expect(call!.body).toMatchObject({ reason: 'Filed against the wrong school' });
    });
  });

  it('offers no withdrawal on a return already withdrawn', async () => {
    history = [{ ...FILED_RETURN, status: 'CANCELLED', cancelledReason: 'Already done' }];
    await openEmployer();
    expect(screen.queryByRole('button', { name: /^Withdraw$/i })).toBeNull();
  });
});

describe('when the officer may not file', () => {
  it('shows the list but not the form', async () => {
    vi.spyOn(apiModule, 'can').mockImplementation((permission: string) => permission !== 'paye:file');
    render(<PayrollScreen />);
    await waitFor(() => expect(screen.getByText('Highland Academy')).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button', { name: /^Open$/i })[0]!);

    await waitFor(() => expect(screen.getByText(/Returns already filed/i)).toBeTruthy());
    expect(
      screen.queryByText(/File a return/i),
      'offering a form the API would refuse is worse than not offering it',
    ).toBeNull();
  });
});
