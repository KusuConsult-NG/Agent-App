/**
 * Every action button on the officer's home screen threw the moment it was
 * pressed, and said nothing.
 *
 * `useAction` is the helper the home screen runs its six buttons through:
 * re-ask a failed TIN, approve a payout, and four more. Its callback opened
 * with
 *
 *     const { t } = usePortalI18n();
 *
 * at the wrong indentation — dropped in by the i18n pass of 30 August, and
 * never used; nothing in that callback reads `t`. `usePortalI18n` calls
 * `useState` and `useEffect`, so calling it from inside an async callback
 * calls a React hook outside render. React's dispatcher is null there, and it
 * throws.
 *
 * The throw lands *before* the `try` two lines below it, so the helper's own
 * `catch` — the one that turns a failure into an `ErrorAlert` — never sees it.
 * `setBusy` has not run either. So the officer pressed the button, the label
 * did not change, no error appeared, and nothing was sent: the exact "watched
 * the button stop spinning and was told nothing at all" failure this portal
 * has already been through once, except that here the button never started.
 *
 * Tested through a real click on a real screen rather than on the helper,
 * because the helper is not exported and because "outside render" is a fact
 * about how it is called, which only a click can establish.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { RoleHomeScreen } from '../screens/RoleHome';
import { api } from '../lib/api';
import { permissionsForRole, translations } from '@psirs/shared';

const en = translations.en as unknown as Record<string, string>;

const REVENUE_HOME = {
  role: 'revenue_officer',
  revenue: {
    unpaid_kobo: '125000000',
    invoices_unpaid: 42,
    taxpayers: 1180,
    registered_this_week: 9,
    tins_outstanding: 3,
  },
  work: {
    failedTins: [
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        name: 'Jos Central Traders',
        phone: '+2348000000123',
        tin_reason: 'The register did not answer',
      },
    ],
  },
};

const USER = {
  id: 'u1',
  phone: '+2348000000002',
  fullName: 'Revenue Officer',
  role: 'revenue_officer',
  permissions: permissionsForRole('revenue_officer'),
};

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  sessionStorage.setItem('psirs.portal.user', JSON.stringify(USER));
  vi.spyOn(api, 'get').mockResolvedValue(REVENUE_HOME as never);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('an action button on the officer home screen', () => {
  it('reaches the server when it is pressed', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ retried: 1 } as never);

    render(<RoleHomeScreen user={USER as never} navigate={() => {}} />);

    const button = await waitFor(() =>
      screen.getByRole('button', { name: en.ofcRhAskTheRegisterAgain! }),
    );
    fireEvent.click(button);

    await waitFor(() => expect(post).toHaveBeenCalledWith('/taxpayers/tin-retry', {}));
  });

  it('says so when it worked, so the officer is not left guessing', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ retried: 1 } as never);

    render(<RoleHomeScreen user={USER as never} navigate={() => {}} />);

    fireEvent.click(
      await waitFor(() => screen.getByRole('button', { name: en.ofcRhAskTheRegisterAgain! })),
    );

    await waitFor(() => expect(screen.getByText(en.ofcRhReAskedTheTin!)).toBeTruthy());
  });
});

/*
 * The same screen's payout approval, which was broken twice over on top of
 * the hook.
 *
 * It is `CommissionsScreen`'s approve button moved to the home screen, and it
 * had drifted from it in both directions: it posted `{}` to a route that
 * requires a five-character reason, and it asked for a step-up code named
 * `commission.payout.approve`, which is not an action `POST /auth/step-up`
 * will issue. An officer got an SMS, typed the code, and was refused before
 * the approval was attempted.
 *
 * Asserted against the real dictionary and the real action list rather than
 * against literals, so that renaming either moves this test with it.
 */
const PAYOUT_HOME = {
  role: 'finance_officer',
  finance: {
    payouts_awaiting_approval: 1,
    unreconciled_settlements: 0,
    disputes_open: 0,
    reversals_awaiting: 0,
  },
  work: {
    payouts: [
      {
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        payout_reference: 'PO-2026-000123',
        agent_code: 'AGT-00001',
        full_name: 'Demo Field Agent',
        amount_kobo: '4500000',
        commissions: '12',
        requested: '2026-09-01',
      },
    ],
  },
};

const FINANCE = {
  id: 'u2',
  phone: '+2348000000003',
  fullName: 'Finance Officer',
  role: 'finance_officer',
  permissions: permissionsForRole('finance_officer'),
};

describe('approving a payout from the home screen', () => {
  beforeEach(() => {
    sessionStorage.setItem('psirs.portal.user', JSON.stringify(FINANCE));
    vi.spyOn(api, 'get').mockResolvedValue(PAYOUT_HOME as never);
  });

  it('sends the reason the route will not accept an approval without', async () => {
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('Checked against the settlement statement'));
    const post = vi.spyOn(api, 'post').mockResolvedValue({ approved: true } as never);

    render(<RoleHomeScreen user={FINANCE as never} navigate={() => {}} />);
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: en.ofcRhApprove! })));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/government/commissions/payouts/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/approve',
        { reason: 'Checked against the settlement statement' },
      ),
    );
  });

  it('asks for no step-up code, the way the screen it was copied from does not', async () => {
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('Checked against the settlement statement'));
    const post = vi.spyOn(api, 'post').mockResolvedValue({ approved: true } as never);

    render(<RoleHomeScreen user={FINANCE as never} navigate={() => {}} />);
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: en.ofcRhApprove! })));

    await waitFor(() => expect(post).toHaveBeenCalled());

    /*
     * Stated as "what was sent", not as "no /auth call was seen".
     *
     * The first draft of this filtered the recorded calls for `/auth/step-up`
     * and checked the ones it found. There are none, so it checked nothing and
     * passed on an empty loop -- a guard that would have gone on passing if the
     * button had been left exactly as broken as it was found.
     *
     * Approving from here is one request. Whether it should also need a code is
     * PSIRS's question; if the answer is yes it belongs on the route and in
     * `STEP_UP_ACTIONS`, and this test should then fail and be changed on
     * purpose rather than never having looked.
     */
    expect(post.mock.calls.map(([path]) => path)).toEqual([
      '/government/commissions/payouts/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/approve',
    ]);
  });
});
