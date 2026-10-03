/**
 * "0.09999999999999998 left", printed into the column an officer closes a
 * round on.
 *
 * Allocation quantities are NUMERIC(14,2) — litres of herbicide, bags of
 * fertiliser. This screen had the total and the awarded total and did the
 * subtraction itself, through `String(Number(a) - Number(b))`, with no
 * rounding anywhere. And the create form divided the same way to preview how
 * many farmers a round would reach.
 *
 * `allocations.ts` had already met this and fixed it for a single round,
 * counting in whole hundredths, with the measurement recorded beside it:
 * 12,231 disagreements against the integer answer over every two-decimal
 * combination a round plausibly holds, every one reporting fewer
 * beneficiaries than the goods can serve. "It never over-promises. It turns
 * people away, which is the direction nobody checks, because a queue that
 * ends early looks like a queue that is finished."
 *
 * So these cases are about the two things a reader of this screen is told:
 * what is left, and how many people that reaches. The figure now comes from
 * SQL, where NUMERIC arithmetic is exact; the preview, which has no saved
 * round to ask about, counts hundredths.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { AllocationsScreen } from '../screens/Allocations';
import * as apiModule from '../lib/api';
import { setPortalLanguage } from '../lib/i18n';

const en = translations.en as unknown as Record<string, string>;

/*
 * No `user` prop. `AllocationsScreen` takes none — it reads permissions from
 * `can()`, which is mocked below. Passing one compiled nowhere and the six
 * cases here passed anyway, because vitest does not typecheck; only
 * `npm run typecheck` does, and it has to be re-run after a test file is
 * written and not only after the source is.
 */

function round(over: Record<string, unknown> = {}) {
  return {
    id: 'rd-1',
    name: '2026 wet season herbicide',
    unit: 'LITRE',
    total_quantity: '1.00',
    quantity_per_beneficiary: '0.10',
    status: 'OPEN',
    collection_point: 'Bokkos LGA agricultural store',
    opens_at: '2026-04-01T09:00:00.000Z',
    closes_at: null,
    programme_name: 'Herbicide Support',
    programme_name_ha: null,
    awarded_quantity: '0.90',
    awarded_count: '9',
    collected_count: '0',
    remaining_quantity: '0.10',
    beneficiaries_remaining: '1',
    ...over,
  };
}

let rounds: Record<string, unknown>[] = [];

beforeEach(() => {
  cleanup();
  setPortalLanguage('en');
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    if (path.includes('/allocations/rounds')) return { rounds } as never;
    // `/government/programmes` answers with a bare array, which the screen
    // maps over — an object here throws inside `load` instead.
    return [] as never;
  });
});

afterEach(() => {
  setPortalLanguage('en');
  vi.restoreAllMocks();
});

describe('what is left in a round', () => {
  it('is printed as the server computed it, not subtracted here', async () => {
    rounds = [round()];
    render(<AllocationsScreen />);

    await waitFor(() => {
      expect(screen.getByText(/0\.10 left/)).toBeTruthy();
    });
  });

  it('never prints the float subtraction, which is what a reader was shown', async () => {
    // 1.00 - 0.90 is 0.09999999999999998. The screen must not be capable of
    // showing that again, whatever else changes about this column.
    rounds = [round()];
    render(<AllocationsScreen />);

    await waitFor(() => {
      expect(screen.getByText(/0\.10 left/)).toBeTruthy();
    });
    expect(screen.queryByText(/0\.0999999/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/\d\.\d{6,}/);
  });

  it('falls back to exact hundredths when an older API sends no figure', async () => {
    // Not to a blank, and not to a float. `remaining_quantity` is the only
    // field this depends on, so a server that predates it must still render a
    // quantity a person can read.
    rounds = [round({ remaining_quantity: undefined, beneficiaries_remaining: undefined })];
    render(<AllocationsScreen />);

    await waitFor(() => {
      expect(screen.getByText(/0\.90 awarded/)).toBeTruthy();
    });
    expect(screen.getByText(/0\.10 left/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\d\.\d{6,}/);
  });
});

describe('the preview under the quantity field', () => {
  /** The form is behind a toggle; the preview lives inside it. */
  async function openTheForm() {
    await waitFor(() => {
      expect(screen.getByText(en.ofcAlCreateARound)).toBeTruthy();
    });
    fireEvent.click(screen.getByText(en.ofcAlCreateARound));
    await waitFor(() => {
      expect(screen.getByLabelText(en.ofcAlTotalToDistribute)).toBeTruthy();
    });
  }

  /*
   * Fill the two quantity inputs the preview reads.
   *
   * The labels are asserted present before being used. The first version of
   * this helper named two keys that do not exist, so `new RegExp(undefined)`
   * became `/(?:)/` — a pattern matching every label on the screen — and the
   * failure was "unable to find a label with the text of: /(?:)/". It failed
   * loudly, which is luck: a helper that had fallen back to the first input on
   * the form would have typed into the round's name and passed.
   */
  function sizeRound(total: string, each: string) {
    expect(en.ofcAlTotalToDistribute, 'the label this helper looks for').toBeTruthy();
    expect(en.ofcAlEachReceives, 'the label this helper looks for').toBeTruthy();
    fireEvent.change(screen.getByLabelText(en.ofcAlTotalToDistribute), {
      target: { value: total },
    });
    fireEvent.change(screen.getByLabelText(en.ofcAlEachReceives), { target: { value: each } });
  }

  it('counts every farmer the round reaches, not one fewer', async () => {
    // 2.90 litres at a tenth each is twenty-nine farmers.
    // Math.floor(2.90 / 0.10) is 28, and this is the number an officer sizes
    // the round by.
    rounds = [];
    render(<AllocationsScreen />);
    await openTheForm();

    sizeRound('2.90', '0.10');

    await waitFor(() => {
      expect(screen.getByText('29')).toBeTruthy();
    });
    expect(screen.queryByText('28')).toBeNull();
  });

  it('is right for the whole-number case too', async () => {
    // The bound: 100 at 2 each is 50, and was already right.
    rounds = [];
    render(<AllocationsScreen />);
    await openTheForm();

    sizeRound('100', '2');

    await waitFor(() => {
      expect(screen.getByText('50')).toBeTruthy();
    });
  });

  it('says nothing until both quantities are given', async () => {
    rounds = [];
    render(<AllocationsScreen />);
    await openTheForm();

    sizeRound('2.90', '');

    expect(screen.queryByText(en.ofcAlBeneficiariesWord)).toBeNull();
  });
});
