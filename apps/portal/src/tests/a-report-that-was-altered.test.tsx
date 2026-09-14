/**
 * A signed audit report whose figures have changed underneath the signature.
 *
 * The workbench freezes a report at generation and records a checksum over
 * what it froze. `getReport` has recomputed that checksum since the column
 * existed, and an API test proves it goes false when a stored payload is
 * edited behind the immutability trigger — which is what somebody with
 * database access would do, and the case the checksum exists for.
 *
 * Nothing called it. This screen reads the list and only the list, and the
 * list returned `r.checksum`: the value written at generation, which is
 * precisely the value an edit to the rows does not disturb. So a tampered
 * report displayed its original hash, in a column headed "Checksum", beside
 * the name of the officer who signed it.
 *
 * A reader takes a checksum on a screen for a checked one. There is no other
 * reason to print a hash at a person. So the detection was real, tested, and
 * reached nobody — the shape that is worse than having no check at all,
 * because in review it reads as though the problem were solved.
 *
 * This file is the first test this screen has ever had.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { WorkbenchScreen } from '../screens/Workbench';
import * as apiModule from '../lib/api';
import { setPortalLanguage } from '../lib/i18n';

const en = translations.en as unknown as Record<string, string>;
const ha = translations.ha as unknown as Record<string, string>;

const USER = { id: 'u-1', phone: '+2348000000009', fullName: 'Ladi Dung', role: 'auditor' };

function report(over: Record<string, unknown>) {
  return {
    id: 'rp-1',
    report_number: 'PSIRS-AR-000012',
    report_type: 'TRANSACTION_AUDIT',
    title: 'March transactions, Jos North',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    row_count: 412,
    checksum: 'ab12cd34ef56aa00bb11',
    status: 'SIGNED',
    generated_at: '2026-04-01T09:00:00.000Z',
    signed_at: '2026-04-02T09:00:00.000Z',
    generated_by_name: 'Ladi Dung',
    signed_by_name: 'Musa Bello',
    withdrawn_reason: null,
    ...over,
  };
}

let reports: unknown[] = [];

beforeEach(() => {
  cleanup();
  setPortalLanguage('en');
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    if (path.includes('audit/reports')) return { reports } as never;
    return { samples: [] } as never;
  });
});

afterEach(() => {
  setPortalLanguage('en');
  vi.restoreAllMocks();
});

describe('a report that was altered', () => {
  it('says so, rather than printing the checksum it no longer matches', async () => {
    reports = [report({ checksumMatches: false })];
    render(<WorkbenchScreen user={USER as never} />);

    await waitFor(() => {
      expect(screen.getByText(en.ofcWbAltered)).toBeTruthy();
    });
  });

  /**
   * Said at the top of the card as well as in the row.
   *
   * A marker in a table cell is scrolled past, and the reader who most needs
   * this one is the reader skimming a list of forty reports for the one they
   * came to read. So the alert is not decoration — it is the difference
   * between a finding that is present and a finding that is noticed.
   */
  it('does not leave the finding to a cell somebody may not look at', async () => {
    reports = [report({ checksumMatches: false })];
    render(<WorkbenchScreen user={USER as never} />);

    await waitFor(() => {
      expect(screen.getByText(en.ofcWbAlteredTitle)).toBeTruthy();
    });
    expect(
      screen.getByText(en.ofcWbAlteredBody.replace('{{n}}', '1')),
    ).toBeTruthy();
  });

  it('counts them when more than one has been altered', async () => {
    reports = [
      report({ id: 'rp-1', checksumMatches: false }),
      report({ id: 'rp-2', report_number: 'PSIRS-AR-000013', checksumMatches: true }),
      report({ id: 'rp-3', report_number: 'PSIRS-AR-000014', checksumMatches: false }),
    ];
    render(<WorkbenchScreen user={USER as never} />);

    await waitFor(() => {
      expect(screen.getByText(en.ofcWbAlteredBody.replace('{{n}}', '2'))).toBeTruthy();
    });
  });

  /**
   * The quiet case, which has to stay quiet.
   *
   * An alert that appears on every report is an alert nobody reads by the
   * second week, and it would make the real one invisible in the way this
   * whole change exists to prevent.
   */
  it('says nothing at all when every report still matches', async () => {
    reports = [
      report({ checksumMatches: true }),
      report({ id: 'rp-2', report_number: 'PSIRS-AR-000013', checksumMatches: true }),
    ];
    render(<WorkbenchScreen user={USER as never} />);

    await waitFor(() => {
      expect(screen.getByText('PSIRS-AR-000012')).toBeTruthy();
    });
    expect(screen.queryByText(en.ofcWbAlteredTitle)).toBeNull();
    expect(screen.queryByText(en.ofcWbAltered)).toBeNull();
  });

  /**
   * An API that does not send the flag must not be read as an accusation.
   *
   * `checksumMatches` is optional on the row for exactly one reason: a portal
   * deployed ahead of its API would otherwise mark every report in the
   * Bureau's history as altered, which is a false alarm about tampering with
   * government audit records — worse, not better, than the silence it
   * replaced.
   */
  it('treats a missing flag as unknown, not as altered', async () => {
    reports = [report({})];
    render(<WorkbenchScreen user={USER as never} />);

    await waitFor(() => expect(screen.getByText('PSIRS-AR-000012')).toBeTruthy());
    expect(screen.queryByText(en.ofcWbAlteredTitle)).toBeNull();
  });

  it('tells an auditor reading Hausa the same thing', async () => {
    setPortalLanguage('ha');
    reports = [report({ checksumMatches: false })];
    render(<WorkbenchScreen user={USER as never} />);

    await waitFor(() => {
      expect(screen.getByText(ha.ofcWbAlteredTitle)).toBeTruthy();
    });
    expect(screen.queryByText(en.ofcWbAlteredTitle)).toBeNull();
    // The negative is the whole sentence here: it no longer matches.
    expect(ha.ofcWbAlteredTitle).toMatch(/\b(ba|bai|babu)\b/);
  });
});
