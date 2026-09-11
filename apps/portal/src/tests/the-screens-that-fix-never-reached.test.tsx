/**
 * The public screens never got the fix that was written for them.
 *
 * `a-request-that-never-arrived.test.tsx` records the change: a dropped
 * connection used to escape as the bare `TypeError` that `fetch` rejects
 * with, so the eighty-two handlers that reasonably tested `caught instanceof
 * ApiRequestError` dropped it on the floor. Rather than edit eighty-two
 * catches, `couldNotReach()` was made to give a lost connection the shape
 * those handlers already read.
 *
 * That happens inside `request()`. And `publicGet` and `publicPost` did not
 * go through `request()` — they called `raw()`, underneath it. So the nine
 * public call sites kept the old behaviour, every one of them behind a
 * handler testing for the error class they would now never see.
 *
 * Which is exactly the wrong way round. The people on these screens have no
 * account and no app. A cooperative chairman answering a membership list from
 * an SMS link. A referee vouching for an agent. A citizen checking a receipt
 * against the register. They are on the worst connections of anybody who
 * touches this platform, and they were the only ones getting silence.
 *
 * The group leader's screen is the sharpest of them, so it is the one
 * rendered here. Answering three hundred names is half an hour of work, the
 * answers decide who is counted in an allocation, and a submit that failed
 * silently left the button live, the list unchanged, and no way to tell that
 * from a submit that worked.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { getTranslation } from '@psirs/shared';
import { GroupAttestationScreen } from '../screens/Public';
import { ApiRequestError, api } from '../lib/api';
import { setPortalLanguage } from '../lib/i18n';

const en = getTranslation('en');
const ha = getTranslation('ha');

const VIEW = {
  groupName: 'Farin Gada Traders Cooperative',
  groupCode: 'GRP-00412',
  leaderName: 'Nanribet Choji',
  lga: 'Jos North',
  members: [
    {
      id: 'm1',
      status: 'PENDING_ATTESTATION',
      full_name: 'Dashe Pam',
      phone: '+2348030000001',
      member_reference: 'FG-019',
    },
  ],
};

/** What `fetch` does when there is no network: it rejects, with a TypeError. */
function noNetwork() {
  return vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
}

function answered(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  setPortalLanguage('en');
});

afterEach(() => {
  cleanup();
  setPortalLanguage('en');
});

describe('an unauthenticated request that never reached the platform', () => {
  it('arrives as the kind of error the public handlers already catch', async () => {
    noNetwork();
    let caught: unknown;
    try {
      await api.publicGet('/group-attestation/tok');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    expect((caught as ApiRequestError).error.code).toBe('NETWORK');
  });

  it('does the same when the public screen is sending rather than reading', async () => {
    noNetwork();
    let caught: unknown;
    try {
      await api.publicPost('/group-attestation/tok/confirm', { confirmedMemberIds: [] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    expect((caught as ApiRequestError).error.code).toBe('NETWORK');
  });

  /*
   * Nothing on the public screens debits anybody, so a lost connection here
   * must not claim otherwise — the same rule the officer portal holds to.
   */
  it('makes no claim about anybody’s money', async () => {
    noNetwork();
    await expect(api.publicGet('/verify/PSIRS-123')).rejects.toSatisfy(
      (error: ApiRequestError) => error.error.moneyStatus === 'NOT_APPLICABLE',
    );
  });
});

describe('the group leader, on a connection that dropped', () => {
  it('is told, instead of being shown an empty card', async () => {
    noNetwork();

    render(<GroupAttestationScreen token="tok" />);

    await waitFor(() => expect(screen.getByText(en.ofcLgCouldNotReachThe)).toBeTruthy());
  });

  it('is told in the language they are reading', async () => {
    // These screens carry a language toggle for a reason. A blank card is
    // wordless in every language; this must not be English-only instead.
    setPortalLanguage('ha');
    noNetwork();

    render(<GroupAttestationScreen token="tok" />);

    await waitFor(() => expect(screen.getByText(ha.ofcLgCouldNotReachThe)).toBeTruthy());
  });

  it('learns that answers they spent half an hour on did not arrive', async () => {
    // The worst of the nine. The list loads, the leader works through it, the
    // send fails on the connection — and before this the screen said nothing
    // at all: same button, same list, no message. The only reading available
    // was that it had gone through.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('/confirm')) throw new TypeError('Failed to fetch');
      return answered(VIEW);
    });

    render(<GroupAttestationScreen token="tok" />);
    await screen.findByText('Dashe Pam');

    fireEvent.click(screen.getByRole('button', { name: en.pubAttestYes }));
    fireEvent.click(screen.getByRole('button', { name: en.pubAttestSubmit }));

    await waitFor(() => expect(screen.getByText(en.ofcLgCouldNotReachThe)).toBeTruthy());
    // And not the thank-you: nothing was recorded.
    expect(screen.queryByText(en.pubThankYou)).toBeNull();
  });
});

describe('what this must not have changed', () => {
  it('still shows the platform’s own sentence when it is the platform refusing', async () => {
    // A refusal that did arrive is not a connection failure, and must not be
    // relabelled as one. This link is spent, and that is what it should say.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      answered(
        {
          error: {
            code: 'GONE',
            message: 'This attestation link has already been used.',
            moneyStatus: 'NOT_APPLICABLE',
          },
        },
        410,
      ),
    );

    render(<GroupAttestationScreen token="tok" />);

    await screen.findByText('This attestation link has already been used.');
    expect(screen.queryByText(en.ofcLgCouldNotReachThe)).toBeNull();
  });

  it('still waits quietly while the read is in flight', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));

    render(<GroupAttestationScreen token="tok" />);

    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeTruthy());
    expect(screen.queryByText(en.ofcLgCouldNotReachThe)).toBeNull();
  });

  it('still loads the list and asks about each member when the connection is there', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(answered(VIEW));

    render(<GroupAttestationScreen token="tok" />);

    await screen.findByText('Dashe Pam');
    expect(screen.getByRole('button', { name: en.pubAttestYes })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.pubAttestNo })).toBeTruthy();
  });
});
