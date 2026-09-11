/**
 * The report an officer is about to sign, and the part of the period that is
 * not in it.
 *
 * Six row-level report types stop at five thousand rows, newest first. The
 * report then records `row_count = 5000`, hashes those rows, and carries a
 * period that names the whole quarter. The workbench drew the row count in a
 * column headed "Rows" and said nothing else — so a report covering the last
 * three weeks of a quarter was indistinguishable, on this screen, from one
 * covering the quarter.
 *
 * That is the screen where somebody signs it.
 *
 * Note where the partial notice sits relative to the checksum alert: ABOVE it.
 * The checksum alert says the stored rows still hash to the value recorded at
 * generation, which is true, and is the more reassuring of the two statements
 * an officer reads before putting their name to the figures. It is about
 * whether the file was altered. It says nothing about whether the file is all
 * of it.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { WorkbenchScreen } from '../screens/Workbench';
import * as apiModule from '../lib/api';
import { setPortalLanguage } from '../lib/i18n';

const en = translations.en as unknown as Record<string, string>;

const USER = { id: 'u-1', phone: '+2348000000009', fullName: 'Ladi Dung', role: 'auditor' };

function report(over: Record<string, unknown>) {
  return {
    id: 'rp-1',
    report_number: 'PSIRS-AR-000012',
    report_type: 'TRANSACTION_AUDIT',
    title: 'March transactions, Jos North',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    row_count: 5000,
    coverage_complete: true,
    checksum: 'ab12cd34ef56aa00bb11',
    checksumMatches: true,
    status: 'GENERATED',
    generated_at: '2026-04-01T09:00:00.000Z',
    signed_at: null,
    generated_by_name: 'Ladi Dung',
    signed_by_name: null,
    withdrawn_reason: null,
    ...over,
  };
}

let reports: unknown[] = [];
let detail: Record<string, unknown> = {};

beforeEach(() => {
  cleanup();
  setPortalLanguage('en');
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    if (/audit\/reports\/[^/]+$/.test(path)) return detail as never;
    if (path.includes('audit/reports')) return { reports } as never;
    return { samples: [] } as never;
  });
});

afterEach(() => {
  setPortalLanguage('en');
  vi.restoreAllMocks();
});

/** The sentence the detail panel should carry, built from the dictionary. */
const partialSentence = (rows: number) =>
  en.ofcWbPartialReport!.replace(/\{\{n\}\}/g, String(rows));

describe('a report that stopped before the end of its period', () => {
  it('is marked in the list, beside the row count it qualifies', async () => {
    reports = [report({ coverage_complete: false })];
    render(<WorkbenchScreen user={USER as never} />);

    await waitFor(() => expect(screen.getByText('PSIRS-AR-000012')).toBeTruthy());
    expect(screen.getByText(en.ofcWbPartialBadge!)).toBeTruthy();
  });

  it('says what is missing when the report is opened to be signed', async () => {
    reports = [report({ coverage_complete: false })];
    detail = report({
      coverage_complete: false,
      parameters: { from: '2026-03-01', to: '2026-03-31' },
      payload: [{ transaction_reference: 'PSIRS-TX-2026-000901' }],
      signature_note: null,
      recomputedChecksum: 'ab12cd34ef56aa00bb11',
    });
    render(<WorkbenchScreen user={USER as never} />);

    await waitFor(() => expect(screen.getByText('PSIRS-AR-000012')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: en.ofcWbOpenReport! }));

    await waitFor(() => expect(screen.getByText(partialSentence(5000))).toBeTruthy());
  });

  it('says it above the checksum, which answers a different question', async () => {
    /*
     * Order matters here and nowhere else on this screen. "The rows still hash
     * to the recorded value" and "these are all the rows" are different
     * claims, and the reassuring one must not be the one read first.
     */
    reports = [report({ coverage_complete: false })];
    detail = report({
      coverage_complete: false,
      parameters: {},
      payload: [{ transaction_reference: 'PSIRS-TX-2026-000901' }],
      signature_note: null,
      recomputedChecksum: 'ab12cd34ef56aa00bb11',
    });
    render(<WorkbenchScreen user={USER as never} />);

    await waitFor(() => expect(screen.getByText('PSIRS-AR-000012')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: en.ofcWbOpenReport! }));

    const partial = await screen.findByText(partialSentence(5000));
    const checksum = screen.getByText(en.ofcWbChecksumAgrees!);
    expect(
      partial.compareDocumentPosition(checksum) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('a report that covered its whole period', () => {
  /*
   * The controls. Most audit reports on a normal period are complete, and a
   * warning printed on all of them is a warning read on none.
   */
  it('carries no badge', async () => {
    reports = [report({ coverage_complete: true })];
    render(<WorkbenchScreen user={USER as never} />);

    await waitFor(() => expect(screen.getByText('PSIRS-AR-000012')).toBeTruthy());
    expect(screen.queryByText(en.ofcWbPartialBadge!)).toBeNull();
  });

  it('carries none either when the platform never recorded coverage', async () => {
    /*
     * Reports generated before this existed have `coverage_complete: null`.
     * Unknown is not partial: stamping PARTIAL on a report that may well be
     * complete would be exactly the kind of false claim this change removes.
     */
    reports = [report({ coverage_complete: null })];
    render(<WorkbenchScreen user={USER as never} />);

    await waitFor(() => expect(screen.getByText('PSIRS-AR-000012')).toBeTruthy());
    expect(screen.queryByText(en.ofcWbPartialBadge!)).toBeNull();
  });

  it('still draws the row count, which the badge only qualifies', async () => {
    reports = [report({ coverage_complete: false, row_count: 5000 })];
    render(<WorkbenchScreen user={USER as never} />);

    await waitFor(() => expect(screen.getByText('PSIRS-AR-000012')).toBeTruthy());
    expect(screen.getByText('5000')).toBeTruthy();
  });
});
