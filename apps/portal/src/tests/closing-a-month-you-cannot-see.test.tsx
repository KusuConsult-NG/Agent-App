/**
 * Freezing a month's figure when the platform cannot say what the month holds.
 *
 * Closing a period is the point after which what PSIRS reported to the
 * Accountant-General stops being able to move — the lock is a trigger on the
 * four tables that decide what a month collected, not a check in this
 * application. So the screen's whole job is to make the decision legible
 * before it is taken.
 *
 * It read an unknown as a zero. `figures` was `Figures | null`, and `null`
 * meant both "not fetched yet" and "the fetch failed"; `outstanding` turned
 * both into zero. A month whose unresolved exceptions could not be counted
 * rendered exactly like a month that had none — no warning, no override field,
 * and the Close button enabled on a note alone.
 *
 * No wrong month was closed by it. The server recomputes the figures inside
 * the closing transaction and refuses without an override reason, so the
 * money side holds regardless of what the screen believes. What the officer
 * got instead was a dead end: refused by the server, with the field the
 * refusal is asking them to fill nowhere on the screen. On a statutory
 * deadline — which is the reason overrides exist at all — that is the whole
 * task blocked, with no way through and nothing explaining why.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { PeriodsScreen } from '../screens/Periods';
import * as apiModule from '../lib/api';
import { setPortalLanguage } from '../lib/i18n';

const en = translations.en as unknown as Record<string, string>;
const ha = translations.ha as unknown as Record<string, string>;

const USER = { id: 'u-1', phone: '+2348000000003', fullName: 'Ladi Dung', role: 'finance_officer' };

const PERIOD = {
  id: 'pd-1',
  label: 'March 2026',
  period_start: '2026-03-01',
  period_end: '2026-03-31',
  status: 'OPEN',
  closed_at: null,
  closed_by_name: null,
  closing_note: null,
  collected_kobo: '0',
  settled_kobo: '0',
  commission_kobo: '0',
  transaction_count: 0,
};

const SETTLED = {
  collected_kobo: '120000000',
  settled_kobo: '120000000',
  commission_kobo: '6000000',
  transaction_count: 412,
  unreconciled: '0',
  pending_payments: '0',
};

/** How the figures request behaves for a given test. */
let figures: 'settled' | 'outstanding' | 'fails' = 'settled';

beforeEach(() => {
  cleanup();
  setPortalLanguage('en');
  figures = 'settled';
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    if (path.includes('periods/figures')) {
      if (figures === 'fails') throw new Error('gateway timeout');
      return (figures === 'outstanding'
        ? { ...SETTLED, unreconciled: '3', pending_payments: '2' }
        : SETTLED) as never;
    }
    return [PERIOD] as never;
  });
  vi.spyOn(apiModule.api, 'post').mockResolvedValue({} as never);
  vi.spyOn(apiModule, 'stepUp').mockResolvedValue(undefined as never);
});

afterEach(() => {
  setPortalLanguage('en');
  vi.restoreAllMocks();
});

/** Open the closing panel for the one month on the screen. */
async function openTheClosingPanel(): Promise<void> {
  render(<PeriodsScreen user={USER as never} />);
  fireEvent.click(await screen.findByText(en.ofcPeClose, { selector: 'button' }));
}

describe('closing a month you cannot see', () => {
  it('says the figures could not be read, rather than showing a settled month', async () => {
    figures = 'fails';
    await openTheClosingPanel();

    await waitFor(() => {
      expect(screen.getByText(en.ofcPeFiguresUnknown)).toBeTruthy();
    });
    // And emphatically not the confident reading it used to give.
    expect(screen.queryByText(en.ofcPeNotReady)).toBeNull();
  });

  /**
   * The field the server is going to ask for is on the screen.
   *
   * This is the dead end. Without it the officer types a note, presses Close,
   * is refused with PERIOD_NOT_SETTLED, and has nowhere to put the reason the
   * refusal is asking for.
   */
  it('asks for a reason when nobody can say what the month holds', async () => {
    figures = 'fails';
    await openTheClosingPanel();

    await waitFor(() => {
      expect(screen.getByLabelText(en.ofcPeOverride)).toBeTruthy();
    });
  });

  it('still asks for one when the month is known to hold unresolved items', async () => {
    figures = 'outstanding';
    await openTheClosingPanel();

    await waitFor(() => expect(screen.getByText(en.ofcPeNotReady)).toBeTruthy());
    expect(screen.getByLabelText(en.ofcPeOverride)).toBeTruthy();
  });

  /**
   * And does not ask when the month is settled.
   *
   * A field that appears every time is a field that gets a full stop typed
   * into it. The override is a written justification that goes on the record
   * beside the frozen figure, so it has to mean something.
   */
  it('asks for nothing extra when the month is settled and known to be', async () => {
    await openTheClosingPanel();

    await waitFor(() => expect(screen.getByLabelText(en.ofcPeClosingNote)).toBeTruthy());
    expect(screen.queryByLabelText(en.ofcPeOverride)).toBeNull();
    expect(screen.queryByText(en.ofcPeNotReady)).toBeNull();
    expect(screen.queryByText(en.ofcPeFiguresUnknown)).toBeNull();
  });

  /**
   * The button will not go until the reason is there.
   *
   * The server would refuse anyway. Refusing here means the officer finds out
   * before they have committed to the decision, rather than after.
   */
  it('will not close on a note alone when the figures are unknown', async () => {
    figures = 'fails';
    await openTheClosingPanel();

    await waitFor(() => expect(screen.getByLabelText(en.ofcPeOverride)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(en.ofcPeClosingNote), {
      target: { value: 'Certified for the statutory return.' },
    });

    /*
     * The panel's button, not the table row's.
     *
     * Both are labelled "Close the month", and the panel renders above the
     * table — so `.at(-1)` picked the row button, which opens the panel and is
     * never disabled. The test passed its own assertion against the wrong
     * element until this was scoped.
     */
    const close = document
      .querySelector('.button-row')!
      .querySelector<HTMLButtonElement>('button:not(.secondary)')!;
    expect(close.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(en.ofcPeOverride), {
      target: { value: 'Statutory deadline; the count could not be read.' },
    });
    expect(close.disabled).toBe(false);
  });

  it('tells a finance officer reading Hausa the same thing', async () => {
    setPortalLanguage('ha');
    figures = 'fails';
    render(<PeriodsScreen user={USER as never} />);
    fireEvent.click(await screen.findByText(ha.ofcPeClose, { selector: 'button' }));

    await waitFor(() => expect(screen.getByText(ha.ofcPeFiguresUnknown)).toBeTruthy());
    expect(screen.queryByText(en.ofcPeFiguresUnknown)).toBeNull();
    // "could not be read" is a negative, and has to stay one.
    expect(ha.ofcPeFiguresUnknown).toMatch(/\b(ba|bai|babu)\b/);
  });
});
