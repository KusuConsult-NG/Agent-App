/**
 * Two translated sentences on the bank-change queue, with English inside them.
 *
 * Both are `.replace('{{…}}', raw)` into a string the dictionary holds:
 *
 *   `ofcAgBankStillNotConfirmed` — "Banki bai tabbatar da shi ba har yanzu
 *   ({{outcome}})" — was filled with `result.outcome.toLowerCase()`, so the
 *   provider's verdict arrived as "(mismatch)".
 *
 *   `ofcAgAnOfficer` — "Wani jami'i ({{role}})" — was filled with
 *   `change.requestedByRole`, which is stored as `finance_officer`, so it read
 *   "Wani jami'i (finance_officer)".
 *
 * The second was found by `a-state-in-the-middle-of-a-sentence.test.ts` and not
 * by me: I had grepped for this exact mistake and found two instances, and that
 * substitution is spread over four lines in a shape my pattern did not match.
 * Which is the argument for the guard rather than the fix.
 *
 * `MISMATCH` had no dictionary entry at all. It is a TypeScript union inside the
 * API — `'VERIFIED' | 'MISMATCH' | 'NOT_FOUND' | 'UNAVAILABLE'` — rather than a
 * CHECK constraint or a list exported from `@psirs/shared`, so neither half of
 * `every-state-has-a-name.test.ts` could see it: not the schema half, because
 * there is no constraint, and not the in-code half, because that walks the
 * lists shared with the front ends.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { permissionsForRole, translations } from '@psirs/shared';
import { BankChangesCard } from '../screens/Agents';
import { api } from '../lib/api';
import { setPortalLanguage } from '../lib/i18n';

const ha = translations.ha;

const CHANGE = {
  approvalId: 'ap-1',
  agentId: 'ag-1',
  agentName: 'Ladi Dung',
  agentCode: 'AGT-00042',
  bankName: 'Zenith Bank',
  accountNumberMasked: '······6789',
  accountName: 'LADI DUNG',
  verificationStatus: 'PENDING',
  verificationResolvedName: null,
  verificationReason: null,
  requestedReason: 'My old account was closed by the bank.',
  requestedAt: '2026-09-09T10:00:00Z',
  requestedByRole: 'finance_officer',
  current: { bankName: 'First Bank', accountNumberMasked: '······1234', accountName: 'LADI DUNG' },
};

function signInAsAdmin() {
  sessionStorage.setItem(
    'psirs.portal.user',
    JSON.stringify({
      id: 'u1',
      phone: '+2348000000001',
      fullName: 'Administrator',
      role: 'admin',
      permissions: permissionsForRole('admin'),
    }),
  );
}

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  signInAsAdmin();
  setPortalLanguage('ha');
});

afterEach(() => {
  cleanup();
  setPortalLanguage('en');
});

describe('two states an officer read in English', () => {
  it('names who asked for the change by their role, in Hausa', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ changes: [CHANGE] } as never);
    render(<BankChangesCard />);

    const expected = ha.ofcAgAnOfficer.replace('{{role}}', ha.enumFinanceOfficer);
    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
    expect(screen.queryByText(/finance_officer/)).toBeNull();
  });

  it("says the bank's verdict in Hausa when it does not match", async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ changes: [CHANGE] } as never);
    vi.spyOn(api, 'post').mockResolvedValue({ verified: false, outcome: 'MISMATCH' } as never);
    render(<BankChangesCard />);

    fireEvent.click(await screen.findByRole('button', { name: ha.ofcAgAskBankAgain }));

    const expected = ha.ofcAgBankStillNotConfirmed.replace('{{outcome}}', ha.enumMismatch);
    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
    expect(screen.queryByText(/mismatch/i)).toBeNull();
  });

  /*
   * The other two verdicts this branch can show. They had labels already, so
   * they were right before this change and must stay right after it — the
   * failure being fixed is one value missing from a map, and the repair should
   * not have moved the others.
   */
  for (const [outcome, label] of [
    ['NOT_FOUND', 'enumNotFound'],
    ['UNAVAILABLE', 'enumUnavailable'],
  ] as const) {
    it(`says ${outcome} in Hausa too`, async () => {
      vi.spyOn(api, 'get').mockResolvedValue({ changes: [CHANGE] } as never);
      vi.spyOn(api, 'post').mockResolvedValue({ verified: false, outcome } as never);
      render(<BankChangesCard />);

      fireEvent.click(await screen.findByRole('button', { name: ha.ofcAgAskBankAgain }));

      const expected = ha.ofcAgBankStillNotConfirmed.replace('{{outcome}}', ha[label]);
      await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
    });
  }
});
