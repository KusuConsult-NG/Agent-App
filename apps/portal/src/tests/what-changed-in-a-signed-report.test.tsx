/**
 * "Something changed" is not a finding an auditor can act on.
 *
 * The workbench's reports table already carries `checksumMatches` per row, so
 * an auditor is told when the stored rows no longer hash to the checksum
 * recorded with them. That is the fact. It is not the evidence.
 *
 * `/government/audit/reports/:id` has returned the evidence since it was
 * written — the rows as they were frozen, and the checksum recomputed now
 * beside the one stored when the report was signed — and nothing had ever
 * asked for it. One of the reads recorded in READ_WITHOUT_A_SCREEN.
 *
 * So a reviewer looking at a report marked altered could see that it was
 * altered and not what the alteration was. Opening one is itself recorded
 * against their name, which is why the panel says so.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { getTranslation, permissionsForRole, type Role } from '@psirs/shared';
import { WorkbenchScreen } from '../screens/Workbench';
import { ApiRequestError, api } from '../lib/api';
import * as apiModule from '../lib/api';

const en = getTranslation('en');

const STORED = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
const RECOMPUTED = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

const REPORT_ROW = {
  id: 'rep-1',
  report_number: 'AR/2026/00007',
  report_type: 'RATE_CHANGES',
  title: 'Every rate change in the period',
  period_start: '2026-08-01',
  period_end: '2026-08-31',
  row_count: 2,
  checksum: STORED,
  status: 'SIGNED',
  generated_at: '2026-09-01T09:00:00.000Z',
  signed_at: '2026-09-02T09:00:00.000Z',
  generated_by_name: 'Auditor Ngo',
  signed_by_name: 'Auditor Ngo',
  withdrawn_reason: null,
  checksumMatches: false,
};

const REPORT_DETAIL = {
  ...REPORT_ROW,
  parameters: { from: '2026-08-01' },
  signature_note: 'Checked against the catalogue.',
  recomputedChecksum: RECOMPUTED,
  payload: [
    { revenue_item: 'Market stall levy', old_amount_kobo: '250000', new_amount_kobo: '400000' },
    { revenue_item: 'Hawker permit', old_amount_kobo: '100000', new_amount_kobo: '100000' },
  ],
};

const REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'That report could not be opened just now.',
  moneyStatus: 'NOT_APPLICABLE',
});

function signInAs(role: Role) {
  apiModule.setSession(null);
  sessionStorage.setItem(
    'psirs.portal.user',
    JSON.stringify({
      id: 'u1',
      phone: '+2348000000001',
      fullName: 'Auditor Ngo',
      role,
      permissions: permissionsForRole(role),
    }),
  );
}

const user = (role: Role) =>
  ({
    id: 'u1',
    phone: '+2348000000001',
    fullName: 'Auditor Ngo',
    email: null,
    role,
    permissions: permissionsForRole(role),
  }) as never;

function serve(options: { detail?: 'ok' | 'fail'; matches?: boolean } = {}) {
  return vi.spyOn(api, 'get').mockImplementation((async (path: string) => {
    if (/\/audit\/reports\/[^/]+$/.test(path)) {
      if (options.detail === 'fail') throw REFUSED;
      return options.matches
        ? { ...REPORT_DETAIL, checksumMatches: true, recomputedChecksum: STORED }
        : REPORT_DETAIL;
    }
    if (path.startsWith('/government/audit/reports')) return { reports: [REPORT_ROW] };
    return { samples: [] };
  }) as never);
}

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  signInAs('auditor');
});

afterEach(() => cleanup());

describe('opening a report the workbench has marked altered', () => {
  it('shows the rows as they were frozen', async () => {
    // The evidence. Without it "altered" is a word with nothing behind it.
    serve();
    render(<WorkbenchScreen user={user('auditor')} />);

    fireEvent.click(await screen.findByRole('button', { name: en.ofcWbOpenReport }));

    await screen.findByText('Market stall levy');
    expect(screen.getByText('Hawker permit')).toBeTruthy();
  });

  it('puts the recomputed checksum beside the stored one, in full', async () => {
    // The list shows twelve characters. A reviewer comparing a printed copy
    // needs the whole value, and needs to see that the two genuinely differ
    // rather than take the badge on trust.
    serve();
    render(<WorkbenchScreen user={user('auditor')} />);

    fireEvent.click(await screen.findByRole('button', { name: en.ofcWbOpenReport }));

    await waitFor(() => expect(screen.getByText(STORED)).toBeTruthy());
    expect(screen.getByText(RECOMPUTED)).toBeTruthy();
    expect(screen.getByText(en.ofcWbChecksumDiffers)).toBeTruthy();
  });

  it('says that opening it is recorded against the reader', async () => {
    // The endpoint writes a report-view entry. A reader should know that
    // before they open somebody's signed work, not afterwards.
    serve();
    render(<WorkbenchScreen user={user('auditor')} />);

    fireEvent.click(await screen.findByRole('button', { name: en.ofcWbOpenReport }));

    await screen.findByText(en.ofcWbViewIsRecorded);
  });
});

describe('opening one that is intact', () => {
  it('says the rows still hash to what was recorded', async () => {
    serve({ matches: true });
    render(<WorkbenchScreen user={user('auditor')} />);

    fireEvent.click(await screen.findByRole('button', { name: en.ofcWbOpenReport }));

    await screen.findByText(en.ofcWbChecksumAgrees);
    expect(screen.queryByText(en.ofcWbChecksumDiffers)).toBeNull();
  });
});

describe('what this must not have changed', () => {
  it('reports a failed open without disturbing the list behind it', async () => {
    serve({ detail: 'fail' });
    render(<WorkbenchScreen user={user('auditor')} />);

    fireEvent.click(await screen.findByRole('button', { name: en.ofcWbOpenReport }));

    await screen.findByText('That report could not be opened just now.');
    // The reports table is still there, and still says what it knew.
    expect(screen.getByText('AR/2026/00007')).toBeTruthy();
  });

  it('draws no panel until a report is opened', async () => {
    serve();
    render(<WorkbenchScreen user={user('auditor')} />);

    await screen.findByText('AR/2026/00007');
    expect(screen.queryByText(en.ofcWbViewIsRecorded)).toBeNull();
    expect(screen.queryByText('Market stall levy')).toBeNull();
  });
});
