/**
 * "Exceptions found: 2", on a screen that had looked at fifty of sixty
 * samples.
 *
 * The workbench prints four figures above its tables — samples drawn, items
 * still to examine, exceptions found, reports on file. All four were added up
 * in this component over the rows the list endpoints returned, and both of
 * those endpoints answer with the fifty newest and nothing else.
 *
 * Measured against the API before anything changed: three samples holding
 * three exceptions and nine unexamined items, read at a cap of two, produced
 * a body of two rows carrying two exceptions and six pending. The arithmetic
 * was right and its subject was the page.
 *
 * Of the four, "exceptions found" is the one that does damage. It is what
 * this screen is for, and an auditor reading a low one concludes the sampling
 * programme is clean. A partial count is the single kind of evidence that
 * must never be able to support that conclusion — and nothing on the screen
 * said the count was partial, because nothing in the response said so either.
 *
 * The figures now come from the server, over everything that matched. What
 * these cases pin is that the screen prints those and not its own sums, that
 * it says which tables stopped short, and that it still degrades to the old
 * arithmetic rather than to a nought when the totals are absent — a false
 * zero here reads as "nothing was found", which is the same lie pointing the
 * other way.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { WorkbenchScreen } from '../screens/Workbench';
import * as apiModule from '../lib/api';
import { setPortalLanguage } from '../lib/i18n';

const en = translations.en as unknown as Record<string, string>;

const USER = { id: 'u-1', phone: '+2348000000009', fullName: 'Ladi Dung', role: 'auditor' };

function sample(over: Record<string, unknown> = {}) {
  return {
    id: 's-1',
    sample_number: 'PSIRS-AS-000003',
    title: 'March collections, materiality pass',
    method: 'RANDOM',
    seed: 'audit-2026-march',
    population_size: 412,
    sample_size: 20,
    status: 'IN_REVIEW',
    drawn_at: '2026-04-01T09:00:00.000Z',
    completed_at: null,
    drawn_by_name: 'Ladi Dung',
    exceptions: 1,
    pending: 3,
    ...over,
  };
}

function report(over: Record<string, unknown> = {}) {
  return {
    id: 'rp-1',
    report_number: 'PSIRS-AR-000012',
    report_type: 'TRANSACTION_AUDIT',
    title: 'March transactions, Jos North',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    row_count: 412,
    checksum: 'ab12cd34ef56aa00bb11',
    coverage_complete: true,
    status: 'SIGNED',
    generated_at: '2026-04-01T09:00:00.000Z',
    signed_at: '2026-04-02T09:00:00.000Z',
    generated_by_name: 'Ladi Dung',
    signed_by_name: 'Musa Bello',
    withdrawn_reason: null,
    checksumMatches: true,
    ...over,
  };
}

let samplesBody: Record<string, unknown> = {};
let reportsBody: Record<string, unknown> = {};

beforeEach(() => {
  cleanup();
  setPortalLanguage('en');
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    if (path.includes('audit/reports')) return reportsBody as never;
    return samplesBody as never;
  });
});

afterEach(() => {
  setPortalLanguage('en');
  vi.restoreAllMocks();
});

/**
 * The figure printed in the tile under a given label.
 *
 * Read from `.stat__value` rather than from the tile's text, because the
 * first version of this helper took `closest` from the label element — which
 * matched the label itself — and returned an empty string for every tile. It
 * failed loudly, which is the only reason it is worth a note: a helper that
 * had returned the whole tile's text would have matched '60' inside '160' and
 * passed.
 */
function statValue(label: string): string {
  const tile = screen.getByText(label).closest('.stat');
  return tile?.querySelector('.stat__value')?.textContent?.trim() ?? '';
}

describe('the figures above a capped table', () => {
  it('says what the whole programme holds, not what fitted on the page', async () => {
    // Fifty rows on the page; sixty samples, thirty-one exceptions and a
    // hundred and four items behind them.
    samplesBody = {
      samples: Array.from({ length: 50 }, (_, index) =>
        sample({ id: `s-${index}`, exceptions: 1, pending: 2 }),
      ),
      matched: 60,
      exceptionsTotal: 31,
      pendingTotal: 104,
      cap: 50,
    };
    reportsBody = { reports: [report()], matched: 1, cap: 50 };

    render(<WorkbenchScreen user={USER as never} />);

    await waitFor(() => {
      expect(statValue(en.ofcWbSamplesDrawn)).toBe('60');
    });
    expect(statValue(en.ofcWbExceptionsFound)).toBe(
      '31',
      // The page holds fifty exceptions of its own. Reading 50 here would mean
      // the component is still summing the rows; reading 31 means it is not.
    );
    expect(statValue(en.ofcWbItemsOutstanding)).toBe('104');
  });

  it('names the table that stopped short, and the number it stopped at', async () => {
    samplesBody = {
      samples: Array.from({ length: 50 }, (_, index) => sample({ id: `s-${index}` })),
      matched: 60,
      exceptionsTotal: 31,
      pendingTotal: 104,
      cap: 50,
    };
    reportsBody = { reports: [report()], matched: 1, cap: 50 };

    render(<WorkbenchScreen user={USER as never} />);

    await waitFor(() => {
      expect(screen.getByText(en.ofcWbListsStopShort)).toBeTruthy();
    });
    const body = screen.getByText(
      en.ofcWbListsStopShortBody
        .replace('{{lists}}', en.ofcWbSamplesDrawn)
        .replace('{{cap}}', '50'),
    );
    expect(body).toBeTruthy();
  });

  it('says nothing about caps when both tables are whole', async () => {
    // The bound. A notice printed whenever the screen loads would pass the
    // case above and tell every auditor their complete lists are partial.
    samplesBody = { samples: [sample()], matched: 1, exceptionsTotal: 1, pendingTotal: 3, cap: 50 };
    reportsBody = { reports: [report()], matched: 1, cap: 50 };

    render(<WorkbenchScreen user={USER as never} />);

    await waitFor(() => {
      expect(statValue(en.ofcWbSamplesDrawn)).toBe('1');
    });
    expect(screen.queryByText(en.ofcWbListsStopShort)).toBeNull();
  });

  it('falls back to the rows when an older API sends no totals', async () => {
    // Not to a nought. "Exceptions found: 0" from a body this screen does not
    // recognise reads as a clean audit programme.
    samplesBody = { samples: [sample({ exceptions: 2, pending: 5 })] };
    reportsBody = { reports: [report(), report({ id: 'rp-2' })] };

    render(<WorkbenchScreen user={USER as never} />);

    await waitFor(() => {
      expect(statValue(en.ofcWbSamplesDrawn)).toBe('1');
    });
    expect(statValue(en.ofcWbExceptionsFound)).toBe('2');
    expect(statValue(en.ofcWbItemsOutstanding)).toBe('5');
    expect(statValue(en.ofcWbReportsHeld)).toBe('2');
    expect(screen.queryByText(en.ofcWbListsStopShort)).toBeNull();
  });

  it('shows a dash rather than a nought when the read was refused', async () => {
    vi.spyOn(apiModule.api, 'get').mockRejectedValue(new Error('network'));

    render(<WorkbenchScreen user={USER as never} />);

    await waitFor(() => {
      expect(statValue(en.ofcWbExceptionsFound)).toBe('—');
    });
    expect(statValue(en.ofcWbSamplesDrawn)).toBe('—');
    expect(statValue(en.ofcWbReportsHeld)).toBe('—');
  });
});

describe('how far the checksum alarm can see', () => {
  it('says how many reports it did not examine, beside the ones it found altered', async () => {
    samplesBody = { samples: [sample()], matched: 1, exceptionsTotal: 1, pendingTotal: 3, cap: 50 };
    reportsBody = {
      reports: [report({ checksumMatches: false })],
      matched: 61,
      cap: 50,
    };

    render(<WorkbenchScreen user={USER as never} />);

    await waitFor(() => {
      expect(screen.getByText(en.ofcWbAlteredTitle)).toBeTruthy();
    });
    expect(screen.getByText(en.ofcWbChecksumReach.replace('{{n}}', '60'))).toBeTruthy();
  });

  it('says it when nothing was found, because a clean page is not a clean set', async () => {
    samplesBody = { samples: [sample()], matched: 1, exceptionsTotal: 1, pendingTotal: 3, cap: 50 };
    reportsBody = { reports: [report({ checksumMatches: true })], matched: 61, cap: 50 };

    render(<WorkbenchScreen user={USER as never} />);

    await waitFor(() => {
      expect(screen.getByText(en.ofcWbChecksumReachTitle)).toBeTruthy();
    });
    expect(screen.queryByText(en.ofcWbAlteredTitle)).toBeNull();
    expect(screen.getByText(en.ofcWbChecksumReach.replace('{{n}}', '60'))).toBeTruthy();
  });

  it('stays quiet when every report was examined', async () => {
    samplesBody = { samples: [sample()], matched: 1, exceptionsTotal: 1, pendingTotal: 3, cap: 50 };
    reportsBody = { reports: [report()], matched: 1, cap: 50 };

    render(<WorkbenchScreen user={USER as never} />);

    await waitFor(() => {
      expect(statValue(en.ofcWbReportsHeld)).toBe('1');
    });
    expect(screen.queryByText(en.ofcWbChecksumReachTitle)).toBeNull();
  });
});
