/**
 * A sentence in Hausa with the state inside it in English.
 *
 * `grpNotActiveYet` is translated — "Wannan kungiya tana {{status}}. Za a iya
 * rubuta mambobi bayan jami'i ya amince da ita" — and the hole was filled with
 * `group.status.toLowerCase()`. So a Hausa-reading agent read "Wannan kungiya
 * tana pending.": an English word, lowercased so it was not even the token the
 * database holds, in the middle of a Hausa sentence.
 *
 * It was never once right. The alert renders only when the group is not
 * ACTIVE, so the value is always PENDING or SUSPENDED, and both have had Hausa
 * in `ENUM_LABELS` since that table was built. The same file has a `readable`
 * wrapper around `enumLabel` three lines from the top, used elsewhere on the
 * screen; this call site walked past it.
 *
 * Nothing could catch it. `every-state-has-a-name.test.ts` asks whether the
 * dictionary knows the state, and it did. The Hausa coverage guard counts keys,
 * and the key was there with its Hausa. The existing test for this alert reads
 * the English screen, where `.toLowerCase()` is indistinguishable from a
 * translation. `a-state-in-the-middle-of-a-sentence.test.ts` now holds the
 * shape of the call across both front ends; this holds what the agent reads.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { GroupScreen } from '../screens/Groups';
import { api } from '../lib/api';
import { setAppLanguage } from '../lib/i18n';

const ha = translations.ha;

const GROUP = {
  id: 'g-1',
  code: 'GRP/2026/000001',
  name: 'Bokkos Farmers Cooperative',
  group_type: 'FARMERS_COOPERATIVE',
  economic_sector: null,
  status: 'PENDING',
  lga_name: 'Bokkos',
  ward_name: null,
  community: 'Bokkos',
  member_estimate: 40,
  leader_name: 'Musa Danladi',
  leader_phone: '+2348030000001',
  attested_members: '0',
  pending_members: '0',
};

beforeEach(() => {
  vi.restoreAllMocks();
  setAppLanguage('ha');
});

afterEach(() => {
  cleanup();
  setAppLanguage('en');
});

describe('a group an officer has not approved yet, read in Hausa', () => {
  it('says the state in Hausa rather than in English', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(GROUP as never);
    render(<GroupScreen groupId="g-1" />);

    const expected = ha.grpNotActiveYet.replace('{{status}}', ha.enumPending);
    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());

    // And not the database's word for it, in either case.
    expect(screen.queryByText(/pending/i)).toBeNull();
  });

  it('does the same for a suspended group', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ...GROUP, status: 'SUSPENDED' } as never);
    render(<GroupScreen groupId="g-1" />);

    const expected = ha.grpNotActiveYet.replace('{{status}}', ha.enumSuspended);
    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
    expect(screen.queryByText(/suspended/i)).toBeNull();
  });

  /*
   * The two states this alert can show are the only two it can show, and that
   * is worth holding: if a third were added to the group status constraint, the
   * sentence would still be translated — `enumLabel` guarantees that — but
   * nobody would have decided what it should say.
   */
  it('shows nothing of the sort once the group is active', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ...GROUP, status: 'ACTIVE' } as never);
    render(<GroupScreen groupId="g-1" />);

    await waitFor(() => expect(screen.queryByText(ha.grpWaitingOfficer)).toBeNull());
  });
});
