/**
 * The queue where an agent's commission is redirected, and the sentence that
 * said there was nothing in it.
 *
 * `BankChangesCard` answered a failed read with `setChanges([])`, and an empty
 * queue prints "No bank account changes are waiting." So an officer whose
 * request was refused — a scoped permission, an expired session, a dropped
 * connection — was told, in plain words, that nobody was waiting.
 *
 * Of all the queues to say that about, this is the one. An agent asks to move
 * their commission off an account for a reason: they have lost the card, the
 * account is frozen, somebody else has access to it. Until an officer
 * approves, the money keeps going where it was going. A queue that reports
 * itself empty is not a queue anybody comes back to.
 *
 * The refusal did reach the officer — it was set on the same `error` the
 * decision buttons use, and shown at the top of the card. Two contradictory
 * statements, and the false one is the one under the heading they came to read.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { BankChangesCard } from '../screens/Agents';
import { ApiRequestError, api } from '../lib/api';
import { permissionsForRole } from '@psirs/shared';

const CHANGE = {
  approvalId: 'ap-1',
  agentId: 'ag-1',
  agentName: 'Ladi Dung',
  agentCode: 'AGT-00042',
  bankName: 'Zenith Bank',
  accountNumberMasked: '······6789',
  accountName: 'LADI DUNG',
  verificationStatus: 'VERIFIED',
  verificationResolvedName: 'LADI DUNG',
  verificationReason: null,
  requestedReason: 'My old account was closed by the bank.',
  requestedAt: '2026-09-09T10:00:00Z',
  requestedByRole: 'agent',
  current: { bankName: 'First Bank', accountNumberMasked: '······1234', accountName: 'LADI DUNG' },
};

const REFUSED = new ApiRequestError(403, {
  code: 'FORBIDDEN',
  message: 'Bank account changes are visible to agent managers only.',
  moneyStatus: 'NOT_APPLICABLE',
});

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
});

afterEach(() => cleanup());

describe('a queue that could not be read', () => {
  it('does not report itself as empty', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(REFUSED);
    render(<BankChangesCard />);

    await waitFor(() =>
      expect(screen.getByText(/visible to agent managers only/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/No bank account changes are waiting/i)).toBeNull();
  });

  it('offers the officer a way to ask again', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockRejectedValueOnce(REFUSED)
      .mockResolvedValueOnce({ changes: [CHANGE] } as never);
    render(<BankChangesCard />);

    fireEvent.click(await screen.findByRole('button', { name: /Try again/i }));

    await waitFor(() => expect(screen.getByText(/Ladi Dung/)).toBeTruthy());
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('a queue that really is empty', () => {
  /*
   * The control. "Nothing is waiting" is the right and useful thing to say
   * when it is true — an officer needs to be able to close the tab.
   */
  it('still says so', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ changes: [] } as never);
    render(<BankChangesCard />);

    await waitFor(() =>
      expect(screen.getByText(/No bank account changes are waiting/i)).toBeTruthy(),
    );
  });
});

describe('a queue with somebody in it', () => {
  it('shows where the money goes now and where it would go', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ changes: [CHANGE] } as never);
    render(<BankChangesCard />);

    await waitFor(() => expect(screen.getByText(/Ladi Dung/)).toBeTruthy());
    const body = document.body.textContent ?? '';
    expect(body).toMatch(/First Bank/);
    expect(body).toMatch(/Zenith Bank/);
    // Masked on both sides: an officer decides on the last four, not the number.
    expect(body).toMatch(/······6789/);
  });
});
