/**
 * The screen an officer works Phase 1 from.
 *
 * The API decides who is on the list; what a screen test can hold is whether
 * the person working it is told the things that make the list safe to use.
 * Two of those matter more than the rest, and both are facts about who is
 * *absent*:
 *
 * That somebody part-way through paying has been left off. An officer who
 * does not know that will assume the page is a nightly snapshot and ring
 * anyway — and ringing a citizen holding a receipt is the harm the exclusion
 * was built to prevent, undone at the last step by a screen that failed to
 * mention it.
 *
 * That lapsed debt is counted but not listed. It cannot be paid as it stands,
 * so it needs a fresh assessment rather than a phone call. A figure with no
 * explanation would have officers hunting the table for names deliberately
 * not in it.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { ArrearsScreen } from '../screens/Arrears';
import * as apiModule from '../lib/api';

const WORKLIST = {
  summary: {
    taxpayers: 2,
    totalKobo: '4500000',
    endedElsewhereKobo: '150000',
    lapsedKobo: '900000',
    lapsedInvoices: 3,
    inFlightInvoices: 2,
  },
  rows: [
    {
      taxpayerId: 'tp-1',
      taxpayerType: 'INDIVIDUAL',
      tin: 'P1234567',
      name: 'Amina Danladi',
      phone: '+2348030000001',
      preferredLanguage: 'ha',
      lgaId: 'lga-1',
      lgaName: 'Jos North',
      ward: 'Gangare',
      outstandingKobo: '3000000',
      invoiceCount: 2,
      oldestDaysOutstanding: 24,
      daysUntilLapse: 6,
      owedFor: ['Shops and kiosks levy', 'Daily market levy'],
      lastPaymentAt: '2026-05-02T09:00:00.000Z',
      partiallyPaid: true,
    },
    {
      taxpayerId: 'tp-2',
      taxpayerType: 'BUSINESS',
      tin: null,
      name: 'Plateau Motors Ltd',
      phone: '+2348030000002',
      preferredLanguage: 'en',
      lgaId: 'lga-1',
      lgaName: 'Jos North',
      ward: null,
      outstandingKobo: '1500000',
      invoiceCount: 1,
      oldestDaysOutstanding: 9,
      daysUntilLapse: null,
      owedFor: ['Signage permit'],
      lastPaymentAt: null,
      partiallyPaid: false,
    },
  ],
};

let asked: string[] = [];

function stubApi(worklist: unknown = WORKLIST) {
  asked = [];
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    asked.push(path);
    if (path.startsWith('/reference/lgas')) return [{ id: 'lga-1', name: 'Jos North' }] as never;
    if (path.startsWith('/government/arrears')) return worklist as never;
    return [] as never;
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

describe('what the officer is told before they start ringing', () => {
  it('says that anyone part-way through paying has been left off, and how many', async () => {
    render(<ArrearsScreen />);
    await waitFor(() => expect(screen.getByText(/Who is not on this list/i)).toBeTruthy());

    const note = screen.getByText(/part-way through paying/i);
    expect(note.textContent).toMatch(/2 invoice/);
    expect(note.textContent).toMatch(/receipt/i);
  });

  it('explains the lapsed money rather than only showing the figure', async () => {
    render(<ArrearsScreen />);
    await waitFor(() => expect(screen.getByText(/cannot be paid as it stands/i)).toBeTruthy());

    const note = screen.getByText(/passed their payment deadline/i);
    expect(note.textContent).toMatch(/3 invoice/);
    expect(
      note.textContent,
      'an officer told only that money is missing will go looking for it on this page',
    ).toMatch(/fresh assessment/i);
  });

  it('says nothing about lapsed debt when there is none', async () => {
    stubApi({ ...WORKLIST, summary: { ...WORKLIST.summary, lapsedKobo: '0', lapsedInvoices: 0 } });
    render(<ArrearsScreen />);
    await waitFor(() => expect(screen.getByText(/Who to call/i)).toBeTruthy());

    expect(screen.queryByText(/passed their payment deadline/i)).toBeNull();
  });
});

describe('the call list itself', () => {
  it('carries the phone number, because that is what the screen is for', async () => {
    render(<ArrearsScreen />);
    await waitFor(() => expect(screen.getByText('Amina Danladi')).toBeTruthy());

    expect(screen.getByText('+2348030000001')).toBeTruthy();
    expect(screen.getByText('+2348030000002')).toBeTruthy();
  });

  it('names what each debt is for, so the call can open with it', async () => {
    render(<ArrearsScreen />);
    await waitFor(() =>
      expect(screen.getByText(/Shops and kiosks levy, Daily market levy/)).toBeTruthy(),
    );
  });

  it('shows the ward alongside the LGA when there is one', async () => {
    render(<ArrearsScreen />);
    await waitFor(() => expect(screen.getByText('Jos North — Gangare')).toBeTruthy());
    // The bare LGA also appears in the filter dropdown, so pick the table cell.
    expect(
      screen.getAllByText('Jos North').some((node) => node.tagName === 'TD'),
      'a taxpayer with no ward recorded still shows the LGA',
    ).toBe(true);
  });

  it('says a debt with no deadline has none, rather than leaving a blank to read as zero', async () => {
    render(<ArrearsScreen />);
    await waitFor(() => expect(screen.getByText('Plateau Motors Ltd')).toBeTruthy());

    expect(screen.getByText('No deadline')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
  });

  it('says when somebody has never paid at all', async () => {
    render(<ArrearsScreen />);
    await waitFor(() => expect(screen.getByText('Never')).toBeTruthy());
  });
});

describe('narrowing the list', () => {
  it('asks the API for the narrower list rather than filtering the page', async () => {
    /*
     * Filtering in the browser would silently answer a different question:
     * the API returns the largest hundred debts, so a client-side filter
     * narrows that hundred rather than the whole territory, and the officer
     * would never see the largest debt in the LGA they picked.
     */
    render(<ArrearsScreen />);
    await waitFor(() => expect(screen.getByLabelText(/Local government/i)).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/Local government/i), { target: { value: 'lga-1' } });
    await waitFor(() =>
      expect(asked.some((path) => path.includes('/government/arrears?') && path.includes('lgaId=lga-1'))).toBe(true),
    );
  });

  it('passes the deadline filter through', async () => {
    render(<ArrearsScreen />);
    await waitFor(() => expect(screen.getByLabelText(/Deadline closing within/i)).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/Deadline closing within/i), { target: { value: '7' } });
    await waitFor(() =>
      expect(asked.some((path) => path.includes('lapsingWithinDays=7'))).toBe(true),
    );
  });

  it('sends the floor in naira, the unit on the label', async () => {
    render(<ArrearsScreen />);
    await waitFor(() => expect(screen.getByLabelText(/Owing at least/i)).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/Owing at least/i), { target: { value: '5000' } });

    /*
     * Read the parameter rather than looking for the substring. `5000` is a
     * prefix of `500000`, so a screen that quietly converted to kobo would
     * satisfy a `path.includes` check while asking for a hundredfold larger
     * floor — the assertion would pass and the officer would see an empty
     * page.
     */
    await waitFor(() => {
      const asks = asked.filter((path) => path.startsWith('/government/arrears?'));
      const latest = new URLSearchParams(asks[asks.length - 1]!.split('?')[1]);
      expect(latest.get('minimumNaira')).toBe('5000');
    });
  });
});

/**
 * How long they have owed it.
 *
 * The worklist drew `daysUntilLapse` — "do I ring this one today" — and not
 * `oldestDaysOutstanding`, which says how long this has been going on. They
 * are different questions, and for a debt with no expiry the first has no
 * answer at all: the column reads "No deadline" and the table then said
 * nothing about age whatsoever.
 *
 * So a taxpayer who has owed money for four hundred days on an invoice that
 * never lapses sat in the list looking exactly like one billed last week. The
 * ordering is `SUM(owed_kobo) DESC, MIN(expires_at) ASC NULLS LAST`, so
 * nothing else surfaced them either — a small ancient debt sinks below a large
 * fresh one and has no visible reason to be picked out.
 *
 * The fixture above has carried `oldestDaysOutstanding: 24` and `9` all along,
 * for a value nothing rendered.
 */
describe('how long the debt has been running', () => {
  beforeEach(() => cleanup());
  afterEach(() => vi.restoreAllMocks());

  it('says how long each taxpayer has owed it', async () => {
    stubApi();
    render(<ArrearsScreen />);

    await waitFor(() => expect(screen.getByText('Amina Danladi')).toBeTruthy());
    expect(screen.getByText('24 day(s)')).toBeTruthy();
    expect(screen.getByText('9 day(s)')).toBeTruthy();
  });

  it('says it for the debt that has no deadline, which had no age at all', async () => {
    /*
     * The row that mattered. `Plateau Motors Ltd` has `daysUntilLapse: null`,
     * so its urgency column reads "No deadline" — and that was the whole of
     * what the table said about time for that row.
     */
    stubApi();
    render(<ArrearsScreen />);

    await waitFor(() => expect(screen.getByText('Plateau Motors Ltd')).toBeTruthy());
    const row = screen.getByText('Plateau Motors Ltd').closest('tr')!;
    expect(within(row).getByText(/No deadline/i)).toBeTruthy();
    expect(within(row).getByText('9 day(s)')).toBeTruthy();
  });

  it('still answers the deadline question, which is a different one', async () => {
    // The control: the urgency column must not have been replaced by the age.
    stubApi();
    render(<ArrearsScreen />);

    await waitFor(() => expect(screen.getByText('Amina Danladi')).toBeTruthy());
    const row = screen.getByText('Amina Danladi').closest('tr')!;
    expect(within(row).getByText('6')).toBeTruthy();
    expect(within(row).getByText('24 day(s)')).toBeTruthy();
  });
});
