/**
 * "No groups yet — register one" is an instruction, and a failed read gave it.
 *
 * `GroupsScreen` lists the cooperatives, market associations and unions an
 * agent has brought onto the register. Its catch did `setGroups([])`, which
 * prints:
 *
 *   "No groups yet. When you meet a cooperative, a market association or a
 *    union, register it here so its members can be brought onto the register
 *    together."
 *
 * Two things are wrong with that sentence arriving from a request that did not
 * come back. It is untrue, which is the whole of this defect class. And it is
 * not a report at all — it is a prompt. An agent who registered the Farin Gada
 * traders last week, opens this screen in a market with a bad signal, and is
 * told they have no groups, is being invited to register them again.
 *
 * A duplicate group is not a duplicate row in a list. Membership attestation
 * and allocation both hang off a group, so the same market ends up split
 * across two of them, with the leader confirming members on whichever one the
 * SMS happened to name.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { GroupsScreen } from '../screens/Groups';
import { ApiRequestError, api } from '../lib/api';

const GROUP = {
  id: 'g-1',
  name: 'Farin Gada Traders Cooperative',
  code: 'GRP-00412',
  group_type: 'COOPERATIVE',
  lga_name: 'Jos North',
  status: 'ACTIVE',
  attested_members: '38',
};

const OFFLINE = new ApiRequestError(503, {
  code: 'OFFLINE',
  message: 'You are offline.',
  moneyStatus: 'NOT_APPLICABLE',
});

beforeEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => cleanup());

describe('an agent whose group list could not be read', () => {
  it('is not told they have registered none', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(OFFLINE);

    render(<GroupsScreen navigate={vi.fn()} />);

    await screen.findByText('You are offline.');
    expect(screen.queryByText(/No groups yet/i)).toBeNull();
  });

  it('is given something to press instead', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(OFFLINE);

    render(<GroupsScreen navigate={vi.fn()} />);

    await screen.findByRole('button', { name: 'Try again' });
  });

  it('sees the cooperative they already registered when the read works', async () => {
    // The point of the retry: the group that was there all along.
    let call = 0;
    vi.spyOn(api, 'get').mockImplementation(async () => {
      call += 1;
      if (call === 1) throw OFFLINE;
      return { groups: [GROUP] } as never;
    });

    render(<GroupsScreen navigate={vi.fn()} />);
    await screen.findByRole('button', { name: 'Try again' });

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await screen.findByText('Farin Gada Traders Cooperative');
    expect(screen.queryByText('You are offline.')).toBeNull();
    expect(screen.queryByText(/No groups yet/i)).toBeNull();
  });
});

describe('what this must not have changed', () => {
  it('still says there are none when the platform actually answered none', async () => {
    // The sentence is not wrong. It is wrong from a failure.
    vi.spyOn(api, 'get').mockResolvedValue({ groups: [] } as never);

    render(<GroupsScreen navigate={vi.fn()} />);

    await screen.findByText(/No groups yet/i);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('still offers registering a group whatever the list did', async () => {
    // This is how a whole market reaches the register at once, and it does not
    // depend on the list having loaded.
    vi.spyOn(api, 'get').mockRejectedValue(OFFLINE);

    render(<GroupsScreen navigate={vi.fn()} />);

    await screen.findByText('You are offline.');
    expect(screen.getByRole('button', { name: /Register a group/i })).toBeTruthy();
  });

  it('still draws a skeleton while the read is in flight', async () => {
    vi.spyOn(api, 'get').mockImplementation(() => new Promise(() => {}));

    render(<GroupsScreen navigate={vi.fn()} />);

    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeTruthy());
    expect(screen.queryByText(/No groups yet/i)).toBeNull();
  });
});
