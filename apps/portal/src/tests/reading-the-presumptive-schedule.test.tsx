/**
 * The screen a trader is shown when they ask why their bill is that number.
 *
 * Phase 4's acceptance criterion is not that this renders — it is whether
 * somebody who does not trust PSIRS can follow it. So what the tests hold is
 * the explaining: the working is on the page, the nano construction is stated
 * in words rather than as a code, and the officer is told when the schedule is
 * only half published rather than quoting figures that do not apply.
 *
 * And the same absence as the payroll screen: no field for a turnover and none
 * for a band. Those come out of the observations, which is what stops the
 * figure being negotiable at the counter.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { PresumptiveScreen } from '../screens/Presumptive';
import * as apiModule from '../lib/api';

const READY = {
  readiness: {
    nanoPolicyAdopted: true,
    nanoConstruction: 'CONJUNCTIVE' as const,
    lgasClassified: 17,
    lgasTotal: 17,
    scheduleCells: 2,
  },
  classes: [
    {
      lgaId: 'lga-1',
      lgaName: 'Jos North',
      classCode: 'A' as const,
      indexSource: 'National Bureau of Statistics, 2024 living standards survey',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2029-01-01',
    },
    {
      lgaId: 'lga-2',
      lgaName: 'Wase',
      classCode: 'C' as const,
      indexSource: 'National Bureau of Statistics, 2024 living standards survey',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2029-01-01',
    },
  ],
  entries: [
    {
      id: 'e-1',
      economicSector: 'ARTISAN_CRAFT',
      sizeBand: 'SMALL' as const,
      lgaClass: 'A' as const,
      assumedAnnualTurnoverKobo: '480000000',
      instrumentReference: 'Plateau State Revenue (Presumptive Assessment) Regulation 2026',
      version: 1,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    },
    {
      id: 'e-2',
      economicSector: 'ARTISAN_CRAFT',
      sizeBand: 'SMALL' as const,
      lgaClass: 'C' as const,
      assumedAnnualTurnoverKobo: '288000000',
      instrumentReference: 'Plateau State Revenue (Presumptive Assessment) Regulation 2026',
      version: 1,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    },
  ],
};

const PREVIEW = {
  tier: 'PRESUMPTIVE' as const,
  sizeBand: 'SMALL' as const,
  lgaClass: 'A' as const,
  assumedAnnualTurnoverKobo: '480000000',
  annualTaxKobo: '4800000',
  monthlyTaxKobo: '400000',
  instrumentReference: 'Plateau State Revenue (Presumptive Assessment) Regulation 2026',
  trace: [
    { step: 'What was observed', detail: 'LOCK_UP_SHOP, 2 item(s) of equipment, 1 person(s) working' },
    { step: 'Size band', detail: 'Those observations put this trade in band SMALL' },
    { step: 'Where it is', detail: 'A — published class for this local government' },
    { step: 'Assumed annual turnover', detail: 'From the published schedule', amountKobo: '480000000' },
    { step: 'Presumptive tax at 1%', detail: 'One per cent', amountKobo: '4800000' },
    { step: 'Payable monthly', detail: 'Divided over twelve months', amountKobo: '400000' },
  ],
};

let asked: string[] = [];
let posted: { path: string; body: any }[] = [];
let schedule: any = READY;
let preview: any = PREVIEW;

function stubApi() {
  asked = [];
  posted = [];
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    asked.push(path);
    if (path.startsWith('/reference/lgas')) {
      return [
        { id: 'lga-1', name: 'Jos North' },
        { id: 'lga-2', name: 'Wase' },
      ] as never;
    }
    return schedule as never;
  });
  vi.spyOn(apiModule.api, 'post').mockImplementation(async (path: string, body?: unknown) => {
    posted.push({ path, body });
    return preview as never;
  });
}

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  schedule = READY;
  preview = PREVIEW;
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  stubApi();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what the page says about itself first', () => {
  it('states the adopted construction in words, not as a code', async () => {
    render(<PresumptiveScreen />);
    await waitFor(() => expect(screen.getByText(/The exemption as adopted/i)).toBeTruthy());

    expect(screen.getByText(/All three limbs must hold/i)).toBeTruthy();
    expect(
      screen.queryByText('CONJUNCTIVE'),
      'the code name tells nobody whether a trader with a shop is exempt',
    ).toBeNull();
  });

  it('says the other reading in words when that is the one in force', async () => {
    schedule = {
      ...READY,
      readiness: { ...READY.readiness, nanoConstruction: 'TURNOVER_GOVERNED' as const },
    };
    render(<PresumptiveScreen />);
    /*
     * `getAllByText`: the phrase is also an option in the publishing dropdown,
     * where an administrator picks a construction. The one that matters here
     * is the statement of what is currently in force.
     */
    await waitFor(() =>
      expect(
        screen.getAllByText(/Turnover governs alone/i).some((node) => node.closest('.alert')),
      ).toBe(true),
    );
  });

  it('warns loudly when no construction has been adopted at all', async () => {
    schedule = {
      ...READY,
      readiness: { ...READY.readiness, nanoPolicyAdopted: false, nanoConstruction: null },
    };
    render(<PresumptiveScreen />);
    await waitFor(() =>
      expect(screen.getByText(/No reading of the exemption has been adopted/i)).toBeTruthy(),
    );
    expect(screen.getByText(/not a question this platform may answer by default/i)).toBeTruthy();
  });

  it('says when the schedule is only half published, with both numbers', async () => {
    schedule = { ...READY, readiness: { ...READY.readiness, lgasClassified: 11 } };
    render(<PresumptiveScreen />);
    await waitFor(() => expect(screen.getByText(/only partly published/i)).toBeTruthy());

    const note = screen.getByText(/local governments have a published class/i);
    expect(note.textContent).toMatch(/11 of 17/);
    expect(note.textContent).toMatch(/quoting figures that do not apply/i);
  });

  it('says nothing about partial publication when it is complete', async () => {
    render(<PresumptiveScreen />);
    await waitFor(() => expect(screen.getByText(/The published figures/i)).toBeTruthy());
    expect(screen.queryByText(/only partly published/i)).toBeNull();
  });
});

describe('working out one trade', () => {
  it('sends observations and nothing else', async () => {
    render(<PresumptiveScreen />);
    await waitFor(() => expect(screen.getByLabelText(/Premises/i)).toBeTruthy());

    /*
     * The property the regime turns on, asserted as an absence — and scoped to
     * the form that works out a bill. The publishing section further down does
     * have a turnover field, correctly: that is an administrator setting the
     * published figure, which is the opposite of a trader's assessment being
     * typed at a counter. Asserting across the whole page would conflate them.
     */
    const workOut = screen.getByText(/What a given trade would pay/i).closest('.card')!;
    expect(within(workOut as HTMLElement).queryByLabelText(/turnover/i)).toBeNull();
    expect(within(workOut as HTMLElement).queryByLabelText(/size band/i)).toBeNull();
    expect(within(workOut as HTMLElement).getByLabelText(/Premises/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Work it out/i }));
    await waitFor(() => {
      const call = posted.find((entry) => entry.path === '/government/presumptive/preview');
      expect(call).toBeTruthy();
      expect(Object.keys(call!.body)).toEqual(['economicSector', 'lgaId', 'observations']);
      expect(call!.body.observations).toMatchObject({
        premises: 'LOCK_UP_SHOP',
        equipmentCount: 2,
        peopleWorking: 1,
      });
    });
  });

  it('shows the working, not just the figure', async () => {
    render(<PresumptiveScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Work it out/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Work it out/i }));

    await waitFor(() => expect(screen.getByText(/How that figure was reached/i)).toBeTruthy());
    expect(screen.getByText('What was observed')).toBeTruthy();
    expect(screen.getByText('Presumptive tax at 1%')).toBeTruthy();
    expect(
      screen.getByText(/Those observations put this trade in band SMALL/),
      'an estimate nobody can follow is one nobody can contest',
    ).toBeTruthy();
  });

  it('says exempt rather than showing a bill of nothing', async () => {
    preview = { ...PREVIEW, tier: 'NANO', annualTaxKobo: '0', monthlyTaxKobo: '0' };
    render(<PresumptiveScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Work it out/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Work it out/i }));

    await waitFor(() => expect(screen.getByText(/nothing is payable/i)).toBeTruthy());
    expect(
      screen.getByText(/That is the law working, not a figure that came out small/i),
      'an officer looking at ₦0 cannot otherwise tell exempt from assessed-at-zero',
    ).toBeTruthy();
  });

  it('reports a refusal rather than a blank result', async () => {
    vi.spyOn(apiModule.api, 'post').mockRejectedValue(
      new apiModule.ApiRequestError(409, {
        code: 'LGA_NOT_CLASSIFIED',
        message: 'This local government has no published class in force.',
      } as never),
    );
    render(<PresumptiveScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Work it out/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Work it out/i }));

    await waitFor(() =>
      expect(screen.getByText(/no published class in force/i)).toBeTruthy(),
    );
  });
});

describe('publishing', () => {
  it('will not publish a class without its source and indicators', async () => {
    render(<PresumptiveScreen />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Publish a local government class/i })).toBeTruthy(),
    );

    const button = screen.getByRole('button', { name: /Publish a local government class/i });
    expect(button).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText(/Local government/i, { selector: '#ps-new-lga' }), {
      target: { value: 'lga-2' },
    });
    fireEvent.change(screen.getByLabelText(/Whose data/i), {
      target: { value: 'National Bureau of Statistics' },
    });
    fireEvent.change(screen.getByLabelText(/Indicators behind this class/i), {
      target: { value: 'road access, electrification' },
    });
    fireEvent.change(screen.getByLabelText(/^From$/i, { selector: '#ps-new-from' }), {
      target: { value: '2026-01-01' },
    });

    expect(
      screen.getByRole('button', { name: /Publish a local government class/i }),
    ).toHaveProperty('disabled', false);
  });

  it('sends the indicators it was given', async () => {
    render(<PresumptiveScreen />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Publish a local government class/i })).toBeTruthy(),
    );

    fireEvent.change(screen.getByLabelText(/Local government/i, { selector: '#ps-new-lga' }), {
      target: { value: 'lga-2' },
    });
    fireEvent.change(screen.getByLabelText(/Whose data/i), { target: { value: 'NBS 2024' } });
    fireEvent.change(screen.getByLabelText(/Indicators behind this class/i), {
      target: { value: 'poverty headcount 0.44' },
    });
    fireEvent.change(screen.getByLabelText(/^From$/i, { selector: '#ps-new-from' }), {
      target: { value: '2026-01-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Publish a local government class/i }));

    await waitFor(() => {
      const call = posted.find((entry) => entry.path === '/government/presumptive/lga-classes');
      expect(call).toBeTruthy();
      expect(call!.body.indexSource).toBe('NBS 2024');
      expect(call!.body.indexInputs).toMatchObject({ note: 'poverty headcount 0.44' });
    });
  });

  it('will not publish a figure with no instrument named', async () => {
    render(<PresumptiveScreen />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Publish a schedule figure/i })).toBeTruthy(),
    );

    fireEvent.change(screen.getByLabelText(/Assumed annual turnover/i), {
      target: { value: '2880000' },
    });
    fireEvent.change(screen.getByLabelText(/^From$/i, { selector: '#ps-fig-from' }), {
      target: { value: '2026-01-01' },
    });

    const button = screen.getByRole('button', { name: /Publish a schedule figure/i });
    expect(
      button,
      'a schedule nobody adopted will not survive its first challenge',
    ).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText(/Adopted under/i), {
      target: { value: 'Presumptive Assessment Regulation 2026' },
    });
    expect(screen.getByRole('button', { name: /Publish a schedule figure/i })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('sends the turnover in kobo, from naira on the form', async () => {
    render(<PresumptiveScreen />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Publish a schedule figure/i })).toBeTruthy(),
    );

    fireEvent.change(screen.getByLabelText(/Assumed annual turnover/i), {
      target: { value: '2880000' },
    });
    fireEvent.change(screen.getByLabelText(/Adopted under/i), { target: { value: 'Reg 2026' } });
    fireEvent.change(screen.getByLabelText(/^From$/i, { selector: '#ps-fig-from' }), {
      target: { value: '2026-01-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Publish a schedule figure/i }));

    await waitFor(() => {
      const call = posted.find((entry) => entry.path === '/government/presumptive/schedule');
      expect(call!.body.assumedAnnualTurnoverKobo).toBe('288000000');
    });
  });

  it('warns before adopting a construction, because it decides who is taxed', async () => {
    render(<PresumptiveScreen />);
    await waitFor(() => expect(screen.getByText(/This decides who is taxed at all/i)).toBeTruthy());
    expect(screen.getByText(/only on a written opinion/i)).toBeTruthy();
  });

  it('will not adopt a construction without citing an opinion', async () => {
    render(<PresumptiveScreen />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Adopt a reading of the exemption/i })).toBeTruthy(),
    );

    const button = screen.getByRole('button', { name: /Adopt a reading of the exemption/i });
    expect(button).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText(/Opinion or instrument relied on/i), {
      target: { value: 'Attorney-General opinion of 12 January 2026' },
    });
    fireEvent.change(screen.getByLabelText(/^From$/i, { selector: '#ps-nano-from' }), {
      target: { value: '2026-01-01' },
    });
    expect(
      screen.getByRole('button', { name: /Adopt a reading of the exemption/i }),
    ).toHaveProperty('disabled', false);
  });

  it('hides publishing entirely from an officer who may not configure', async () => {
    vi.spyOn(apiModule, 'can').mockImplementation(
      (permission: string) => permission !== 'catalogue:configure',
    );
    render(<PresumptiveScreen />);
    await waitFor(() => expect(screen.getByText(/The published figures/i)).toBeTruthy());
    expect(screen.queryAllByText(/Publish a schedule figure/i)).toHaveLength(0);
  });

  it('hides adopting the exemption from an officer who may not configure the system', async () => {
    vi.spyOn(apiModule, 'can').mockImplementation(
      (permission: string) => permission !== 'system:configure',
    );
    render(<PresumptiveScreen />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Publish a schedule figure/i })).toBeTruthy(),
    );
    expect(
      screen.queryAllByText(/Adopt a reading of the exemption/i),
      'deciding who is inside the net is not the same job as maintaining a rate table',
    ).toHaveLength(0);
  });
});

describe('the published table', () => {
  it('shows the bill beside the assumed turnover', async () => {
    render(<PresumptiveScreen />);
    await waitFor(() => expect(screen.getByText(/The published figures/i)).toBeTruthy());

    /*
     * One per cent of ₦4,800,000 is not a sum every trader does in their head,
     * and the figure they care about is the bill.
     */
    expect(screen.getByText(/₦48,000/)).toBeTruthy();
    expect(screen.getByText(/₦28,800/)).toBeTruthy();
  });

  it('names the instrument each figure was adopted under', async () => {
    render(<PresumptiveScreen />);
    await waitFor(() =>
      expect(
        screen.getAllByText(/Presumptive Assessment\) Regulation 2026/).length,
      ).toBeGreaterThan(0),
    );
  });

  it('shows whose data each class came from', async () => {
    render(<PresumptiveScreen />);
    // 'Jos North' is also an option in the LGA dropdown, so pick the cell.
    await waitFor(() =>
      expect(screen.getAllByText('Jos North').some((node) => node.tagName === 'TD')).toBe(true),
    );
    expect(
      screen.getAllByText(/National Bureau of Statistics/).length,
      'a class an LGA cannot trace is one they cannot argue with',
    ).toBeGreaterThan(0);
  });

  it('says when a class has no end date rather than leaving a blank', async () => {
    schedule = {
      ...READY,
      classes: [{ ...READY.classes[0]!, effectiveTo: null }],
    };
    render(<PresumptiveScreen />);
    await waitFor(() => expect(screen.getByText('No end date set')).toBeTruthy());
  });
});
