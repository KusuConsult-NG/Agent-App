/**
 * The per-officer view of the audit log, which nothing had ever opened.
 *
 * `/government/users/:id/activity` has existed and been permissioned with
 * some care: an officer may read their own record with no permission at all,
 * and somebody else's on `audit:read`. Nothing called it — one of the reads
 * recorded in READ_WITHOUT_A_SCREEN. So an administrator investigating an
 * officer had the audit log, which is searchable across everybody, and no way
 * to open one person's.
 *
 * It sits on the access screen because that screen already answers the other
 * half of the same question — where this account is signed in, and on what —
 * and already takes an `officer` for looking at somebody else's. Both of the
 * endpoint's access paths have a caller now.
 *
 * WHAT THE REFUSALS ARE FOR
 *
 * The list keeps entries whose result was not SUCCESS, with the reason
 * attached. What somebody was stopped from doing is the part of an
 * investigation that a list of successes cannot supply, and the refused count
 * is the figure that makes an administrator look twice.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { getTranslation, permissionsForRole, type Role } from '@psirs/shared';
import { MyAccessScreen } from '../screens/MyAccess';
import { ApiRequestError, api } from '../lib/api';
import * as apiModule from '../lib/api';

const en = getTranslation('en');

const OFFICER = { id: 'u-9', full_name: 'Ngo Dalyop' };

const ACCESS = { sessions: [], devices: [] };

const ACTIVITY = {
  officer: { id: 'u-9', full_name: 'Ngo Dalyop', role: 'revenue_officer', status: 'ACTIVE' },
  windowDays: 7,
  byDay: [
    { day: '2026-09-11', times: '40', refused: '3' },
    { day: '2026-09-10', times: '22', refused: '0' },
  ],
  mostRecent: [
    {
      created_at: '2026-09-11T07:30:00.000Z',
      action: 'payment.reversed',
      entity_type: 'transaction',
      entity_id: 'tx-1',
      result: 'SUCCESS',
      reason: null,
    },
    {
      created_at: '2026-09-11T07:10:00.000Z',
      action: 'commission.payout_approved',
      entity_type: 'commission_payout',
      entity_id: 'p-1',
      result: 'FORBIDDEN',
      reason: 'You cannot approve a payout you requested yourself.',
    },
  ],
};

const REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'That record could not be read just now.',
  moneyStatus: 'NOT_APPLICABLE',
});

function signInAs(role: Role) {
  apiModule.setSession(null);
  sessionStorage.setItem(
    'psirs.portal.user',
    JSON.stringify({
      id: 'u1',
      phone: '+2348000000001',
      fullName: 'Admin Dung',
      role,
      permissions: permissionsForRole(role),
    }),
  );
}

const user = (role: Role) =>
  ({
    id: 'u1',
    phone: '+2348000000001',
    fullName: 'Admin Dung',
    email: null,
    role,
    permissions: permissionsForRole(role),
  }) as never;

/** The screen makes two reads; they are not interchangeable. */
function serve(options: { activity?: 'ok' | 'fail' } = {}) {
  return vi.spyOn(api, 'get').mockImplementation((async (path: string) => {
    if (path.includes('/activity')) {
      if (options.activity === 'fail') throw REFUSED;
      return ACTIVITY;
    }
    return ACCESS;
  }) as never);
}

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => cleanup());

describe('an administrator opening what an officer has done', () => {
  it('shows the most recent actions against that account', async () => {
    signInAs('admin');
    serve();

    render(<MyAccessScreen user={user('admin')} officer={OFFICER} />);

    await screen.findByText('payment.reversed');
    expect(screen.getByText('commission.payout_approved')).toBeTruthy();
  });

  it('keeps the refusals, with the reason attached', async () => {
    // A list of successes cannot tell an investigator what somebody was
    // stopped from doing, which is the half that matters.
    signInAs('admin');
    serve();

    render(<MyAccessScreen user={user('admin')} officer={OFFICER} />);

    await screen.findByText('You cannot approve a payout you requested yourself.');
  });

  it('counts what was refused over the window the endpoint actually used', async () => {
    // `windowDays` comes back from the API because it clamps the request, so
    // the label names the number that was measured rather than a guess.
    signInAs('admin');
    serve();

    render(<MyAccessScreen user={user('admin')} officer={OFFICER} />);

    const label = en.ofcAcRefusedDays.replace('{{n}}', '7');
    const stat = (await screen.findByText(label)).closest('.stat');
    expect(stat?.querySelector('.stat__value')?.textContent).toBe('3');
  });

  it('names the section for whose record it is', async () => {
    signInAs('admin');
    serve();

    render(<MyAccessScreen user={user('admin')} officer={OFFICER} />);

    await screen.findByText(en.ofcAcActivity);
    expect(screen.queryByText(en.ofcAcActivityMine)).toBeNull();
  });
});

describe('an officer reading their own record', () => {
  it('gets it without any permission at all', async () => {
    // A supervisor holds neither `audit:read` for others nor `user:manage`.
    // Their own activity is theirs by the endpoint's own rule.
    signInAs('supervisor');
    serve();

    render(<MyAccessScreen user={user('supervisor')} />);

    await screen.findByText(en.ofcAcActivityMine);
    expect(screen.getByText('payment.reversed')).toBeTruthy();
  });
});

describe('when that read fails', () => {
  it('says so and offers it again, without touching the sessions beside it', async () => {
    // Two reads, two states. A failed activity read must not take the
    // sessions list with it, which is the mistake this codebase keeps making.
    signInAs('admin');
    serve({ activity: 'fail' });

    render(<MyAccessScreen user={user('admin')} officer={OFFICER} />);

    await screen.findByText('That record could not be read just now.');
    expect(screen.getByRole('button', { name: en.actionTryAgain })).toBeTruthy();
    // The sessions read succeeded, so its own empty sentence still stands.
    expect(screen.getByText(en.ofcAcNoSessions)).toBeTruthy();
  });

  it('does not claim nothing has been recorded', async () => {
    signInAs('admin');
    serve({ activity: 'fail' });

    render(<MyAccessScreen user={user('admin')} officer={OFFICER} />);

    await screen.findByText('That record could not be read just now.');
    expect(screen.queryByText(en.ofcAcNoActivity)).toBeNull();
  });

  it('comes back when asked again', async () => {
    signInAs('admin');
    let call = 0;
    vi.spyOn(api, 'get').mockImplementation((async (path: string) => {
      if (!path.includes('/activity')) return ACCESS;
      call += 1;
      if (call === 1) throw REFUSED;
      return ACTIVITY;
    }) as never);

    render(<MyAccessScreen user={user('admin')} officer={OFFICER} />);
    fireEvent.click(await screen.findByRole('button', { name: en.actionTryAgain }));

    await screen.findByText('payment.reversed');
  });
});

describe('what this must not have changed', () => {
  it('still says nothing has been recorded when that is the answer', async () => {
    signInAs('admin');
    vi.spyOn(api, 'get').mockImplementation((async (path: string) => {
      if (path.includes('/activity')) return { ...ACTIVITY, byDay: [], mostRecent: [] };
      return ACCESS;
    }) as never);

    render(<MyAccessScreen user={user('admin')} officer={OFFICER} />);

    await screen.findByText(en.ofcAcNoActivity);
  });

  it('still waits quietly while the read is in flight', async () => {
    signInAs('admin');
    vi.spyOn(api, 'get').mockImplementation((async (path: string) => {
      if (path.includes('/activity')) return new Promise(() => {});
      return ACCESS;
    }) as never);

    render(<MyAccessScreen user={user('admin')} officer={OFFICER} />);

    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeTruthy());
    expect(screen.queryByText(en.ofcAcNoActivity)).toBeNull();
  });
});
