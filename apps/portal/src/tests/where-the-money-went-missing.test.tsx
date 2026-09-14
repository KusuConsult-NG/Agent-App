/**
 * The screen an officer decides a fraud flag on, and what it showed when it
 * could not read one.
 *
 * `FraudScreen` loads two things: the leakage figures — how much money is
 * unaccounted for — and the queue of flags naming who is suspected. Both
 * failures landed on the same `error` the review and sweep buttons use, so
 * an officer could not tell which of the two they were missing.
 *
 * Worse than that, neither failure was visible where it mattered. The flags
 * catch had already been fixed once, for the half that counts most — it leaves
 * the list unknown rather than writing `[]`, so an unread queue cannot read as
 * a queue with nothing in it. But `!flags` renders the skeleton, so what an
 * officer saw was a refusal at the top of the screen and four grey bars where
 * the queue belongs. The leakage figures were worse still: their section was
 * simply not drawn, and a screen missing a section looks like a screen with
 * nothing to report.
 *
 * Nothing had ever rendered this screen in a test.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { FraudScreen } from '../screens/Oversight';
import { ApiRequestError, api } from '../lib/api';
import * as apiModule from '../lib/api';
import { permissionsForRole, type Role } from '@psirs/shared';

const LEAKAGE = {
  unreconciledOver48Hours: { amount_kobo: '4500000', count: 3 },
  settlementsOutstanding: { variance_kobo: '850000', count: 1 },
  duplicatePayments: { count: 2 },
  failedReceiptVerifications: { count: 0 },
  highRiskAgents: [],
};

const FLAG = {
  id: 'flag-1',
  rule: 'REVERSAL_PATTERN',
  severity: 'HIGH',
  entity_type: 'AGENT',
  entity_id: 'ag-1',
  agent_name: 'Ladi Dung',
  transaction_reference: null,
  detail: { reversalRatePercent: 41.2, sample: 34 },
  status: 'OPEN',
  created_at: '2026-09-10T09:00:00Z',
};

function signInAs(role: Role) {
  apiModule.setSession(null);
  sessionStorage.setItem(
    'psirs.portal.user',
    JSON.stringify({
      id: 'u1',
      phone: '+2348000000001',
      fullName: 'Revenue Officer',
      role,
      permissions: permissionsForRole(role),
    }),
  );
}

const refusal = (what: string) =>
  new ApiRequestError(503, {
    code: 'UPSTREAM_UNAVAILABLE',
    message: `The ${what} could not be read.`,
    moneyStatus: 'NOT_APPLICABLE',
  });

function mockLoads(handlers: { leakage?: () => Promise<unknown>; flags?: () => Promise<unknown> }) {
  const leakage = handlers.leakage ?? (async () => LEAKAGE);
  const flags = handlers.flags ?? (async () => [FLAG]);
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.includes('/leakage')) return (await leakage()) as never;
    return (await flags()) as never;
  });
}

const spinner = () => document.querySelector('[aria-busy="true"]');

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  signInAs('revenue_officer');
});

afterEach(() => cleanup());

describe('a fraud queue that could not be read', () => {
  it('says so where the queue belongs, not only at the top', async () => {
    mockLoads({ flags: () => Promise.reject(refusal('flag queue')) });
    render(<FraudScreen />);

    await waitFor(() => expect(screen.getByText(/flag queue could not be read/i)).toBeTruthy());
    expect(spinner(), 'a failed read must stop looking like a loading one').toBeNull();
  });

  it('does not read as a queue with no flags in it', async () => {
    mockLoads({ flags: () => Promise.reject(refusal('flag queue')) });
    render(<FraudScreen />);

    await waitFor(() => expect(screen.getByText(/flag queue could not be read/i)).toBeTruthy());
    expect(screen.queryByText(/No fraud signals match this filter/i)).toBeNull();
  });

  /*
   * The discriminating assertion, and the reason the others are not.
   *
   * The refusal always reached the screen — it was set on the shared `error`
   * and rendered at the top — so "is the message somewhere on the page" was
   * true before this change as well. What was missing is anything to DO about
   * it where the queue should have been. A retry beside the gap is the thing
   * that only exists now.
   */
  it('offers the officer a way to ask again, where the queue belongs', async () => {
    mockLoads({ flags: () => Promise.reject(refusal('flag queue')) });
    render(<FraudScreen />);

    const again = await screen.findByRole('button', { name: /Try again/i });
    expect(again).toBeTruthy();
    expect(spinner()).toBeNull();
  });

  it('leaves the leakage figures readable', async () => {
    // One failed request must not cost an officer the other answer.
    mockLoads({ flags: () => Promise.reject(refusal('flag queue')) });
    render(<FraudScreen />);

    await waitFor(() => expect(screen.getByText(/Unreconciled over 48h/i)).toBeTruthy());
  });
});

describe('leakage figures that could not be read', () => {
  it('says so where the figures belong, rather than drawing nothing', async () => {
    mockLoads({ leakage: () => Promise.reject(refusal('leakage figures')) });
    render(<FraudScreen />);

    await waitFor(() => expect(screen.getByText(/leakage figures could not be read/i)).toBeTruthy());
    expect(screen.queryByText(/Unreconciled over 48h/i)).toBeNull();
    // Something to do about it, where the grid would have been. Before this
    // the section was simply absent and there was nothing to press.
    expect(screen.getByRole('button', { name: /Try again/i })).toBeTruthy();
  });

  it('leaves the flag queue readable', async () => {
    mockLoads({ leakage: () => Promise.reject(refusal('leakage figures')) });
    render(<FraudScreen />);

    await waitFor(() => expect(screen.getByText('Ladi Dung')).toBeTruthy());
  });
});

describe('when both answer', () => {
  it('names who is flagged and what it is about', async () => {
    mockLoads({});
    render(<FraudScreen />);

    await waitFor(() => expect(screen.getByText('Ladi Dung')).toBeTruthy());
    expect(document.body.textContent).toMatch(/Unreconciled over 48h/i);
  });

  it('still shows a skeleton while a read is genuinely in flight', async () => {
    // The remedy is to stop showing one for a request that has already
    // failed, not to stop showing one at all.
    mockLoads({ flags: () => new Promise(() => {}) });
    render(<FraudScreen />);

    await waitFor(() => expect(spinner()).toBeTruthy());
    expect(screen.queryByText(/could not be read/i)).toBeNull();
  });
});

describe('who may raise a sweep', () => {
  /*
   * `fraud:manage` is administrators and revenue officers. An auditor and a
   * supervisor hold `fraud:read` — they look at flags, they do not raise them
   * — so the control is not offered rather than being offered and refused.
   */
  it('offers it to a revenue officer', async () => {
    mockLoads({});
    render(<FraudScreen />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Run a fraud sweep now/i })).toBeTruthy(),
    );
  });

  it('does not offer it to an auditor', async () => {
    signInAs('auditor');
    mockLoads({});
    render(<FraudScreen />);

    await waitFor(() => expect(screen.getByText(/Revenue leakage monitoring/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Run a fraud sweep now/i })).toBeNull();
  });
});
