/**
 * What an officer sees when the portal cannot reach the platform.
 *
 * `ApiRequestError` meant "the server said no". So `caught instanceof
 * ApiRequestError ? caught.error : null` — the handler eighty-two places in
 * this codebase reasonably wrote — turned a lost connection into `null`, and
 * `null` is the value that means "nothing has gone wrong".
 *
 * On a screen that renders its data or a spinner, that is a spinner that never
 * stops. The case file is the clearest instance: an officer opening a case on
 * a dropped connection watched it load forever, with no message, no retry, and
 * no way to tell that from a slow query.
 *
 * These render the screen through a real fetch rejection rather than asserting
 * about the client, because the failure being fixed was never in the client —
 * it was in what reached the page.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { getTranslation, permissionsForRole, type Role } from '@psirs/shared';
import { CasesScreen } from '../screens/Cases';
import { ApiRequestError, api } from '../lib/api';
import * as apiModule from '../lib/api';

const en = getTranslation('en');

function signInAs(role: Role) {
  apiModule.setSession(null);
  sessionStorage.setItem(
    'psirs.portal.user',
    JSON.stringify({
      id: 'u1',
      phone: '+2348000000001',
      fullName: 'Command Officer',
      role,
      permissions: permissionsForRole(role),
    }),
  );
}

const user = (role: Role) =>
  ({
    id: 'u1',
    phone: '+2348000000001',
    fullName: 'Command Officer',
    email: null,
    role,
    permissions: permissionsForRole(role),
  }) as never;

/** What `fetch` does when there is no network: it rejects, with a TypeError. */
function noNetwork() {
  return vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
}

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('a request that never reached the platform', () => {
  it('arrives as the kind of error every handler already catches', async () => {
    noNetwork();
    let caught: unknown;
    try {
      await api.get('/government/cases');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    expect((caught as ApiRequestError).error.code).toBe('NETWORK');
  });

  /*
   * Nothing an officer does from this portal debits a taxpayer, so a lost
   * connection here must not claim otherwise. A false money warning is its own
   * kind of wrong: it is the sentence that stops somebody acting.
   */
  it('makes no claim about anybody’s money', async () => {
    noNetwork();
    await expect(api.post('/government/cases', { subject: 'x' })).rejects.toSatisfy(
      (error: ApiRequestError) => error.error.moneyStatus === 'NOT_APPLICABLE',
    );
  });

  it('leaves an officer looking at a message, not a spinner that never stops', async () => {
    signInAs('auditor');
    noNetwork();

    render(
      <CasesScreen
        user={user('auditor')}
        route="/cases?case=cc000000-0000-4000-8000-000000000001"
        navigate={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText(en.ofcLgCouldNotReachThe)).toBeTruthy());
  });
});
