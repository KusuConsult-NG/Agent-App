/**
 * Maker-checker, and the row that decides who may press the button.
 *
 * Every consequential money decision in this portal goes through an approval
 * request that somebody other than the requester has to answer. The server
 * enforces that on `requested_by` and always has. What the screen decides is
 * only what an officer is SHOWN — and it used to decide it by comparing the
 * requester's NAME to the signed-in officer's name.
 *
 * That is wrong in both directions, and both were real:
 *
 *   - Two officers who share a name — which is ordinary in Plateau State —
 *     meant the second was shown "Your request" and no buttons at all, and
 *     was blocked from a review they were entitled to do.
 *   - A difference of casing or a trailing space meant the requester WAS
 *     offered Approve on their own request, pressed it, and got a 403.
 *
 * It compares ids now. Nothing rendered this screen, so the fix had nothing
 * holding it; these do, and the same-name case is the one that would go
 * unnoticed longest, because it looks like a permissions problem rather than
 * a bug.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ApprovalsScreen } from '../screens/Finance';
import { api } from '../lib/api';
import { permissionsForRole } from '@psirs/shared';

const ME = {
  id: 'u-finance-1',
  phone: '+2348000000003',
  fullName: 'Musa Bello',
  role: 'finance_officer',
  permissions: permissionsForRole('finance_officer'),
};

/** A reversal request raised by somebody else who happens to share my name. */
const NAMESAKE_REQUEST = {
  id: 'ap-1',
  approval_type: 'PAYMENT_REVERSAL',
  entity_type: 'payment',
  requested_by_user_id: 'u-finance-2',
  requested_by_name: 'Musa Bello',
  requested_reason: 'Taxpayer paid twice for the same invoice.',
  requested_at: '2026-09-09T10:00:00Z',
  status: 'REQUESTED',
};

const MY_OWN_REQUEST = {
  ...NAMESAKE_REQUEST,
  id: 'ap-2',
  requested_by_user_id: ME.id,
  requested_by_name: 'Musa Bello',
};

function signIn() {
  sessionStorage.setItem('psirs.portal.user', JSON.stringify(ME));
}

function mockApprovals(rows: unknown[]) {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    // The bank-change card above the queue loads on mount as well.
    if (path.startsWith('/agents/bank-changes')) return { changes: [] } as never;
    return rows as never;
  });
}

let prompt: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  signIn();
  prompt = vi.fn();
  vi.stubGlobal('prompt', prompt);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a request raised by somebody with the same name', () => {
  it('can still be approved', async () => {
    mockApprovals([NAMESAKE_REQUEST]);
    render(<ApprovalsScreen user={ME as never} />);

    await waitFor(() => expect(screen.getByText(/paid twice/i)).toBeTruthy());
    expect(screen.getByRole('button', { name: /^Approve$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Reject$/ })).toBeTruthy();
    expect(screen.queryByText(/Your request/i)).toBeNull();
  });
});

describe('a request I raised myself', () => {
  it('offers me nothing to press, and says why', async () => {
    mockApprovals([MY_OWN_REQUEST]);
    render(<ApprovalsScreen user={ME as never} />);

    await waitFor(() => expect(screen.getByText(/Your request/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /^Approve$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Reject$/ })).toBeNull();
  });
});

describe('answering a request', () => {
  it('sends the decision with the reason that was typed', async () => {
    mockApprovals([NAMESAKE_REQUEST]);
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never);
    prompt.mockReturnValue('Confirmed against the gateway statement for 8 September.');

    render(<ApprovalsScreen user={ME as never} />);
    await waitFor(() => expect(screen.getByText(/paid twice/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Approve$/ }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/government/approvals/ap-1/decide', {
        decision: 'APPROVE',
        reason: 'Confirmed against the gateway statement for 8 September.',
      }),
    );
  });

  /*
   * The helper's rule, on this screen: a reason too short to be a record is
   * refused out loud, and the server is never asked.
   */
  it('will not send a reason too short to be a record', async () => {
    mockApprovals([NAMESAKE_REQUEST]);
    const post = vi.spyOn(api, 'post').mockResolvedValue({} as never);
    prompt.mockReturnValue('ok');

    render(<ApprovalsScreen user={ME as never} />);
    await waitFor(() => expect(screen.getByText(/paid twice/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Approve$/ }));

    await waitFor(() => expect(screen.getByText(/at least 10 characters/i)).toBeTruthy());
    expect(post).not.toHaveBeenCalled();
  });
});

describe('executing an approved reversal', () => {
  /*
   * Moving money back is guarded by a one-time code as well as by the
   * approval, and the code has to be asked for BEFORE the reversal is sent —
   * a reversal that goes out and is then step-upped is not guarded at all.
   */
  it('asks for the one-time code before it sends anything', async () => {
    mockApprovals([{ ...NAMESAKE_REQUEST, status: 'APPROVED' }]);
    const calls: string[] = [];
    vi.spyOn(api, 'post').mockImplementation(async (path: string) => {
      calls.push(path);
      if (path === '/auth/otp/request') return { developmentCode: '123456' } as never;
      return { refundReference: 'RFD-2026-000012', commissionReversed: 3 } as never;
    });

    render(<ApprovalsScreen user={ME as never} />);
    await waitFor(() => expect(screen.getByText(/paid twice/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Execute reversal/i }));

    await waitFor(() =>
      expect(calls).toContain('/government/approvals/ap-1/execute-reversal'),
    );
    expect(calls.indexOf('/auth/step-up')).toBeGreaterThan(-1);
    expect(calls.indexOf('/auth/step-up')).toBeLessThan(
      calls.indexOf('/government/approvals/ap-1/execute-reversal'),
    );
  });

  it('names the refund it created and what it undid', async () => {
    mockApprovals([{ ...NAMESAKE_REQUEST, status: 'APPROVED' }]);
    vi.spyOn(api, 'post').mockImplementation(async (path: string) => {
      if (path === '/auth/otp/request') return { developmentCode: '123456' } as never;
      return { refundReference: 'RFD-2026-000012', commissionReversed: 3 } as never;
    });

    render(<ApprovalsScreen user={ME as never} />);
    await waitFor(() => expect(screen.getByText(/paid twice/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Execute reversal/i }));

    await waitFor(() => {
      const body = document.body.textContent ?? '';
      expect(body).toMatch(/RFD-2026-000012/);
      expect(body).toMatch(/3 commission/);
    });
  });
});
