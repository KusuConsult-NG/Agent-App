/**
 * The screen where a person decides what enumeration could not.
 *
 * Two properties carry it. When an agent and an association leader describe
 * the same trader differently, both versions are shown with the effect on the
 * band — a supervisor needs to know whether the disagreement changes the bill
 * before deciding whether it is worth a visit.
 *
 * And an officer may not decide an objection to their own assessment. The
 * database refuses it; this screen says so before they write anything, because
 * being stopped by a constraint after composing a decision teaches an officer
 * that the system is broken rather than that the case is somebody else's.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { EnumerationScreen } from '../screens/Enumeration';
import * as apiModule from '../lib/api';

const ME = 'officer-me';

const DISAGREEMENTS = [
  {
    observationId: 'obs-1',
    taxpayerId: 'tp-1',
    taxpayerName: 'Amina Danladi',
    groupName: 'Terminus Tailors Guild',
    attestedByName: 'Guild Leader',
    observedAt: '2026-08-01T09:00:00.000Z',
    agentSaw: { premises: 'LOCK_UP_SHOP', equipmentCount: 4, peopleWorking: 2 },
    leaderSays: { premises: 'STALL', equipmentCount: null, peopleWorking: null },
    agentBand: 'SMALL',
    leaderBand: 'SMALL',
  },
  {
    observationId: 'obs-2',
    taxpayerId: 'tp-2',
    taxpayerName: 'Sule Mohammed',
    groupName: 'Terminus Tailors Guild',
    attestedByName: 'Guild Leader',
    observedAt: '2026-08-02T09:00:00.000Z',
    agentSaw: { premises: 'BUILDING', equipmentCount: 12, peopleWorking: 8 },
    leaderSays: { premises: 'KIOSK', equipmentCount: 1, peopleWorking: 0 },
    agentBand: 'MEDIUM',
    leaderBand: 'MICRO',
  },
];

const OBJECTIONS = [
  {
    objectionId: 'obj-1',
    presumptiveAssessmentId: 'pa-1',
    taxpayerId: 'tp-3',
    taxpayerName: 'Grace Bitrus',
    ground: 'FACTS_WRONG',
    statement: 'The stall is half the size recorded.',
    raisedAt: '2026-08-03T09:00:00.000Z',
    annualTaxKobo: '4800000',
    assessedBy: 'officer-other',
  },
  {
    objectionId: 'obj-2',
    presumptiveAssessmentId: 'pa-2',
    taxpayerId: 'tp-4',
    taxpayerName: 'Musa Haruna',
    ground: 'HAS_RECORDS',
    statement: 'Audited accounts are available for 2025.',
    raisedAt: '2026-08-04T09:00:00.000Z',
    annualTaxKobo: '2880000',
    assessedBy: ME,
  },
];

let asked: string[] = [];
let posted: { path: string; body: any }[] = [];
const RECORDED = [
  {
    observationId: 'obs-9',
    taxpayerId: 'tp-9',
    taxpayerName: 'Hauwa Yakubu',
    economicSector: 'ARTISAN_CRAFT',
    premises: 'LOCK_UP_SHOP',
    equipmentCount: 2,
    peopleWorking: 1,
    sizeBand: 'SMALL',
    attestationState: 'PENDING',
    groupName: 'Terminus Tailors Guild',
    observedAt: '2026-08-05T09:00:00.000Z',
    presumptiveAssessmentId: null,
    taxTier: null,
    annualTaxKobo: null,
    underObjection: false,
  },
  {
    observationId: 'obs-10',
    taxpayerId: 'tp-10',
    taxpayerName: 'Ibrahim Sani',
    economicSector: 'ARTISAN_CRAFT',
    premises: 'STALL',
    equipmentCount: 1,
    peopleWorking: 0,
    sizeBand: 'MICRO',
    attestationState: 'DISAGREED',
    groupName: 'Terminus Tailors Guild',
    observedAt: '2026-08-06T09:00:00.000Z',
    presumptiveAssessmentId: null,
    taxTier: null,
    annualTaxKobo: null,
    underObjection: false,
  },
  {
    observationId: 'obs-11',
    taxpayerId: 'tp-11',
    taxpayerName: 'Ladi Pam',
    economicSector: 'ARTISAN_CRAFT',
    premises: 'LOCK_UP_SHOP',
    equipmentCount: 3,
    peopleWorking: 2,
    sizeBand: 'SMALL',
    attestationState: 'AGREED',
    groupName: null,
    observedAt: '2026-08-07T09:00:00.000Z',
    presumptiveAssessmentId: 'pa-11',
    taxTier: 'PRESUMPTIVE',
    annualTaxKobo: '4800000',
    underObjection: false,
  },
  {
    /*
     * Attested but not yet assessed. Without this row the "no second
     * attestation" test would have been asking about a row that is already
     * assessed, where the attestation controls are out of reach for a
     * different reason entirely.
     */
    observationId: 'obs-12',
    taxpayerId: 'tp-12',
    taxpayerName: 'Ruth Longpet',
    economicSector: 'ARTISAN_CRAFT',
    premises: 'KIOSK',
    equipmentCount: 1,
    peopleWorking: 1,
    sizeBand: 'SMALL',
    attestationState: 'AGREED',
    groupName: 'Terminus Tailors Guild',
    observedAt: '2026-08-08T09:00:00.000Z',
    presumptiveAssessmentId: null,
    taxTier: null,
    annualTaxKobo: null,
    underObjection: false,
  },
  {
    // Assessed, and the taxpayer has already disputed it.
    observationId: 'obs-13',
    taxpayerId: 'tp-13',
    taxpayerName: 'Danjuma Bot',
    economicSector: 'ARTISAN_CRAFT',
    premises: 'BUILDING',
    equipmentCount: 6,
    peopleWorking: 4,
    sizeBand: 'MEDIUM',
    attestationState: 'AGREED',
    groupName: null,
    observedAt: '2026-08-09T09:00:00.000Z',
    presumptiveAssessmentId: 'pa-13',
    taxTier: 'PRESUMPTIVE',
    annualTaxKobo: '9600000',
    underObjection: true,
  },
  {
    // Assessed as exempt: nothing was charged, so there is no bill to dispute.
    observationId: 'obs-14',
    taxpayerId: 'tp-14',
    taxpayerName: 'Talatu Gyang',
    economicSector: 'RETAIL_TRADE',
    premises: 'NONE',
    equipmentCount: 0,
    peopleWorking: 0,
    sizeBand: 'MICRO',
    attestationState: 'AGREED',
    groupName: null,
    observedAt: '2026-08-10T09:00:00.000Z',
    presumptiveAssessmentId: 'pa-14',
    taxTier: 'NANO',
    annualTaxKobo: '0',
    underObjection: false,
  },
];

let disagreements: unknown[] = DISAGREEMENTS;
let objections: unknown[] = OBJECTIONS;
let recorded: unknown[] = RECORDED;

function stubApi() {
  asked = [];
  posted = [];
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    asked.push(path);
    if (path.includes('/disagreements')) return disagreements as never;
    if (path.includes('/objections')) return objections as never;
    return recorded as never;
  });
  vi.spyOn(apiModule.api, 'post').mockImplementation(async (path: string, body?: unknown) => {
    posted.push({ path, body });
    return undefined as never;
  });
}

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  disagreements = DISAGREEMENTS;
  objections = OBJECTIONS;
  recorded = RECORDED;
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule, 'getUser').mockReturnValue({ id: ME, role: 'admin' } as never);
  stubApi();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('where the agent and the leader differ', () => {
  it('shows both versions rather than a flag saying disputed', async () => {
    render(<EnumerationScreen />);
    await waitFor(() => expect(screen.getByText('Amina Danladi')).toBeTruthy());

    expect(screen.getByText(/Lock-up shop, 4, 2/)).toBeTruthy();
    expect(screen.getByText(/Market stall or table$/)).toBeTruthy();
  });

  it('says when the disagreement does not change the band', async () => {
    /*
     * The thing a supervisor decides on. Two versions that land in the same
     * band disagree about nothing that reaches the bill, and that is a phone
     * call rather than a journey.
     */
    render(<EnumerationScreen />);
    await waitFor(() => expect(screen.getByText('Same band either way')).toBeTruthy());
  });

  it('shows the band it would move to when it does', async () => {
    render(<EnumerationScreen />);
    await waitFor(() => expect(screen.getByText(/Medium → Micro/)).toBeTruthy());
  });

  it('does not fill in what the leader never disputed', async () => {
    /*
     * The leader questioned the premises and said nothing about the staff.
     * Showing the agent's figures in the blanks would read as agreement they
     * never gave.
     */
    render(<EnumerationScreen />);
    await waitFor(() => expect(screen.getByText('Amina Danladi')).toBeTruthy());
    const row = screen.getByText('Amina Danladi').closest('tr')!;
    expect(row.textContent).not.toMatch(/Market stall or table, 4/);
  });
});

describe('objections', () => {
  it('says the debt is not chased while the objection is open', async () => {
    render(<EnumerationScreen />);
    await waitFor(() => expect(screen.getByText(/While an objection is open/i)).toBeTruthy());
    expect(screen.getByText(/off the arrears worklist until this is decided/i)).toBeTruthy();
  });

  it('will not offer a decision on the officer’s own assessment', async () => {
    render(<EnumerationScreen />);
    await waitFor(() => expect(screen.getByText('Musa Haruna')).toBeTruthy());

    const mine = screen.getByText('Musa Haruna').closest('tr')!;
    expect(mine.textContent).toMatch(/another officer must decide/i);
    expect(
      mine.querySelector('button'),
      'being stopped by a constraint after composing a decision teaches the wrong lesson',
    ).toBeNull();
  });

  it('offers a decision on somebody else’s', async () => {
    render(<EnumerationScreen />);
    await waitFor(() => expect(screen.getByText('Grace Bitrus')).toBeTruthy());
    const theirs = screen.getByText('Grace Bitrus').closest('tr')!;
    expect(theirs.querySelector('button')).toBeTruthy();
  });

  it('will not decide until a reason has been written', async () => {
    render(<EnumerationScreen />);
    await waitFor(() => expect(screen.getByText('Grace Bitrus')).toBeTruthy());

    const uphold = screen.getByRole('button', { name: /Uphold the objection/i });
    expect(uphold).toHaveProperty('disabled', true);
    fireEvent.click(uphold);
    expect(posted.filter((entry) => entry.path.includes('/decide'))).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/Why are you deciding this way/i), {
      target: { value: 'Confirmed with the association that the stall is smaller.' },
    });
    expect(screen.getByRole('button', { name: /Uphold the objection/i })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('sends the decision and its reason', async () => {
    render(<EnumerationScreen />);
    await waitFor(() => expect(screen.getByText('Grace Bitrus')).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/Why are you deciding this way/i), {
      target: { value: 'Re-measured on site; the record is correct.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Reject the objection/i }));

    await waitFor(() => {
      const call = posted.find((entry) => entry.path.includes('/decide'));
      expect(call!.path).toBe('/government/enumeration/objections/obj-1/decide');
      expect(call!.body).toMatchObject({
        uphold: false,
        reason: 'Re-measured on site; the record is correct.',
      });
    });
  });

  it('totals what is under objection, so the suspended amount is visible', async () => {
    render(<EnumerationScreen />);
    await waitFor(() => expect(screen.getByText('Open objections')).toBeTruthy());
    expect(screen.getByText(/₦76,800/)).toBeTruthy();
  });

  it('hides the decision controls from an officer who may not review', async () => {
    vi.spyOn(apiModule, 'can').mockImplementation(
      (permission: string) => permission !== 'approval:review',
    );
    render(<EnumerationScreen />);
    await waitFor(() => expect(screen.getByText('Grace Bitrus')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Uphold the objection/i })).toBeNull();
    expect(screen.queryByLabelText(/Why are you deciding this way/i)).toBeNull();
  });
});

describe('what has been recorded', () => {
  it('offers to assess an observation that is not disputed', async () => {
    render(<EnumerationScreen />);
    await waitFor(() => expect(screen.getByText('Hauwa Yakubu')).toBeTruthy());

    const row = screen.getByText('Hauwa Yakubu').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: /^Assess$/i }));

    await waitFor(() => {
      const call = posted.find((entry) => entry.path.includes('/assess'));
      expect(call!.path).toBe('/government/enumeration/observations/obs-9/assess');
    });
  });

  it('will not offer to assess one the association disputed', async () => {
    /*
     * Assessing on facts the association has already said are wrong produces
     * an estimate the taxpayer will contest and PSIRS will lose. The service
     * refuses it; the screen does not offer it, so the officer is pointed at
     * the thing that actually needs doing.
     */
    render(<EnumerationScreen />);
    await waitFor(() => expect(screen.getByText('Ibrahim Sani')).toBeTruthy());

    const row = screen.getByText('Ibrahim Sani').closest('tr')!;
    expect(row.textContent).toMatch(/settle it first/i);
    expect(within(row).queryByRole('button', { name: /^Assess$/i })).toBeNull();
  });

  it('records a leader confirming an observation', async () => {
    render(<EnumerationScreen />);
    await waitFor(() => expect(screen.getByText('Hauwa Yakubu')).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/Attesting leader’s name/i), {
      target: { value: 'Guild Leader' },
    });
    const row = screen.getByText('Hauwa Yakubu').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: /Leader confirms/i }));

    await waitFor(() => {
      const call = posted.find((entry) => entry.path.includes('/attest'));
      expect(call!.body).toMatchObject({ agrees: true, attestedByName: 'Guild Leader' });
    });
  });

  it('offers no attestation on one already attested', async () => {
    render(<EnumerationScreen />);
    await waitFor(() => expect(screen.getByText('Ruth Longpet')).toBeTruthy());
    const row = screen.getByText('Ruth Longpet').closest('tr')!;
    expect(within(row).queryByRole('button', { name: /Leader confirms/i })).toBeNull();
    expect(
      within(row).getByRole('button', { name: /^Assess$/i }),
      'an attested observation is exactly the one that should be assessed',
    ).toBeTruthy();
  });

  it('records an objection against an assessed one, with what the taxpayer said', async () => {
    render(<EnumerationScreen />);
    await waitFor(() => expect(screen.getByText('Ladi Pam')).toBeTruthy());

    const row = screen.getByText('Ladi Pam').closest('tr')!;
    const button = within(row).getByRole('button', { name: /Record an objection/i });
    expect(button, 'an objection with no grounds cannot be decided').toHaveProperty(
      'disabled',
      true,
    );

    fireEvent.change(screen.getByLabelText(/What the taxpayer says/i), {
      target: { value: 'The apprentice left in June.' },
    });
    fireEvent.click(within(row).getByRole('button', { name: /Record an objection/i }));

    await waitFor(() => {
      const call = posted.find((entry) => entry.path.includes('/object'));
      expect(call!.path).toBe('/government/enumeration/assessments/pa-11/object');
      expect(call!.body).toMatchObject({
        ground: 'FACTS_WRONG',
        statement: 'The apprentice left in June.',
      });
    });
  });

  it('says an exempt operator is exempt, not that they owe nothing', async () => {
    render(<EnumerationScreen />);
    await waitFor(() => expect(screen.getByText('Talatu Gyang')).toBeTruthy());
    const row = screen.getByText('Talatu Gyang').closest('tr')!;
    expect(row.textContent).toMatch(/Exempt/);
    expect(row.textContent).not.toMatch(/₦0/);
  });

  it('offers no objection against an exemption', async () => {
    /*
     * Nothing was charged, so there is nothing to dispute — and an objection
     * upheld here would withdraw the record of the exemption itself, putting
     * the observation back in the queue to be assessed again. The service
     * refuses it; the screen does not put the button there.
     */
    render(<EnumerationScreen />);
    await waitFor(() => expect(screen.getByText('Talatu Gyang')).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/What the taxpayer says/i), {
      target: { value: 'He says he stopped hawking in June.' },
    });
    const row = screen.getByText('Talatu Gyang').closest('tr')!;
    expect(within(row).queryByRole('button', { name: /Record an objection/i })).toBeNull();
  });

  it('will not raise a second objection on one already disputed', async () => {
    render(<EnumerationScreen />);
    await waitFor(() => expect(screen.getByText('Danjuma Bot')).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/What the taxpayer says/i), {
      target: { value: 'Raised again at the counter.' },
    });
    const row = screen.getByText('Danjuma Bot').closest('tr')!;
    expect(row.textContent).toMatch(/Objection open/i);
    expect(within(row).queryByRole('button', { name: /Record an objection/i })).toBeNull();
  });
});
