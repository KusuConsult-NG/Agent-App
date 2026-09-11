/**
 * A hundred people, and no way to know there were three thousand.
 *
 * The beneficiaries panel asks the API for a hundred rows and draws whatever
 * comes back. Nothing on the screen distinguished a programme with ninety
 * beneficiaries from a programme with nine thousand: both produced a table
 * that ended, and a table that ends reads as a table that is finished.
 *
 * This is the roll for a social programme — a tax amnesty, a health scheme,
 * fertiliser under PRD §40. An officer working down it hands out what the
 * programme gives, and beneficiary 101 was not merely further down the page.
 * They were not on the screen at all, and nothing said so.
 *
 * The server made this impossible to fix from here: its `total` was
 * `rows.length`, the size of the page under a name that means the opposite, so
 * even a screen that wanted to say "a hundred of three thousand" had nothing
 * true to say it with.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ProgrammesScreen } from '../screens/Configuration';
import * as apiModule from '../lib/api';
import { api } from '../lib/api';
import { translations } from '@psirs/shared';

const en = translations.en as unknown as Record<string, string>;

const PROGRAMME = {
  id: 'p-1',
  name: 'Plateau Tax Amnesty 2026',
  name_ha: null,
  code: 'AMN-2026',
  benefit_type: 'TAX_AMNESTY',
  minimum_score: 0,
  requires_no_arrears: false,
  eligible_taxpayers: '3412',
  status: 'ACTIVE',
};

/** As many as the panel asks for, which is what a truncated read looks like. */
function roll(count: number) {
  return Array.from({ length: count }, (_, n) => ({
    taxpayer_id: `tp-${n}`,
    tin: `PL8100${String(n).padStart(4, '0')}`,
    name: `Beneficiary Number${n}`,
    lga_name: 'Jos North',
    score: 40,
    eligible: true,
    reasons: [],
    evaluated_at: '2026-09-01T09:00:00Z',
  }));
}

/**
 * The sentence the panel should print, built from the dictionary.
 *
 * Not `getByRole('status')`: this screen already carries a standing status
 * banner about PRD §40 linkage authority, so the role alone matches a
 * paragraph that has nothing to do with the roll and the control passes for
 * the wrong reason. Asserting the actual sentence also catches an interpolation
 * that silently left `{{shown}}` on the screen.
 */
function truncationNotice(shown: number, total: number): string {
  return en
    .ofcCfShowingSomeBeneficiaries!.replace('{{shown}}', String(shown))
    .replace('{{total}}', String(total));
}

/** Open the panel for the one programme in the list. */
async function openBeneficiaries() {
  render(<ProgrammesScreen />);
  await waitFor(() => expect(screen.getByText('Plateau Tax Amnesty 2026')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: en.ofcCfBeneficiaries! }));
  await waitFor(() => expect(screen.getByText('Beneficiary Number0')).toBeTruthy());
}

beforeEach(() => {
  cleanup();
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a benefits roll longer than the panel', () => {
  it('says how many of them are actually on it', async () => {
    vi.spyOn(api, 'get').mockImplementation((async (path: string) =>
      path.includes('/beneficiaries')
        ? { beneficiaries: roll(100), total: 3412 }
        : [PROGRAMME]) as never);

    await openBeneficiaries();

    expect(await screen.findByText(truncationNotice(100, 3412))).toBeTruthy();
  });

  it('does not say it about a roll that fits', async () => {
    /*
     * The control, and the reason the notice means anything. A panel that
     * warns on every list is a panel nobody reads the warning on.
     */
    vi.spyOn(api, 'get').mockImplementation((async (path: string) =>
      path.includes('/beneficiaries')
        ? { beneficiaries: roll(7), total: 7 }
        : [PROGRAMME]) as never);

    await openBeneficiaries();

    expect(screen.getByText('Beneficiary Number6')).toBeTruthy();
    expect(screen.queryByText(truncationNotice(7, 7))).toBeNull();
    expect(screen.queryByText(/of 7 eligible beneficiaries/)).toBeNull();
  });

  it('still draws the roll it did receive', async () => {
    // The second control: warning about the rest must not cost the hundred.
    vi.spyOn(api, 'get').mockImplementation((async (path: string) =>
      path.includes('/beneficiaries')
        ? { beneficiaries: roll(100), total: 3412 }
        : [PROGRAMME]) as never);

    await openBeneficiaries();

    expect(screen.getByText('Beneficiary Number99')).toBeTruthy();
    expect(screen.getByText('PL81000099')).toBeTruthy();
  });

  it('asks for the page size it then reports against', async () => {
    /*
     * The two halves of the sentence come from different places — the count
     * shown is the array's length, the limit is in the URL — so a panel that
     * asked for 200 and said "100 of 3412" would be lying in a way no other
     * assertion here would catch.
     */
    const get = vi.spyOn(api, 'get').mockImplementation((async (path: string) =>
      path.includes('/beneficiaries')
        ? { beneficiaries: roll(100), total: 3412 }
        : [PROGRAMME]) as never);

    await openBeneficiaries();

    const asked = get.mock.calls.map(([path]) => String(path)).find((p) => p.includes('/beneficiaries'));
    expect(asked).toContain('limit=100');
  });
});
