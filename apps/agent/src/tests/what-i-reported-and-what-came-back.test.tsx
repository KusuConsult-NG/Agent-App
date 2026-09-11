/**
 * An agent checking on the problem they reported.
 *
 * `SupportScreen` caught a failed read with `setTickets([])`, and an empty
 * list prints "You have not reported anything yet."
 *
 * The refusal was shown above it, so this is the two-contradictory-statements
 * version rather than the silent one — but the false half is the sentence
 * under "My reports", which is where the agent is looking. And the agents who
 * open this screen are the ones with something outstanding: a handset that
 * was suspended, a commission that did not arrive, a taxpayer disputing a
 * receipt. Being told they never reported it is the answer that makes
 * somebody give up rather than press again.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { SupportScreen } from '../screens/Support';
import { ApiRequestError, api } from '../lib/api';

const TICKET = {
  id: 't-1',
  ticket_number: 'SUP-2026-000031',
  category: 'COMMISSION_QUERY',
  subject: 'August commission has not arrived',
  status: 'OPEN',
  priority: 'NORMAL',
  created_at: '2026-09-09T10:00:00Z',
  message_count: 2,
  last_message_at: '2026-09-09T12:00:00Z',
  transaction_reference: null,
};

const REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'PSIRS could not be reached just now.',
  moneyStatus: 'NOT_APPLICABLE',
});

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => cleanup());

describe('when the list of my reports cannot be read', () => {
  it('does not tell the agent they never reported anything', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(REFUSED);
    render(<SupportScreen navigate={() => {}} />);

    await waitFor(() => expect(screen.getByText(/could not be reached just now/i)).toBeTruthy());
    expect(screen.queryByText(/have not reported anything/i)).toBeNull();
  });

  it('still offers the way to report a problem', async () => {
    // The failure is in reading the history, not in raising something new,
    // and an agent who came here to report a problem still needs to.
    vi.spyOn(api, 'get').mockRejectedValue(REFUSED);
    render(<SupportScreen navigate={() => {}} />);

    await waitFor(() => expect(screen.getByText(/could not be reached just now/i)).toBeTruthy());
    expect(screen.getAllByText(/Report a problem/i).length).toBeGreaterThan(0);
  });
});

describe('when it can', () => {
  /*
   * Both controls. An agent with nothing outstanding should be told so
   * plainly, and one with something outstanding should see it.
   */
  it('says nothing has been reported when nothing has', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([] as never);
    render(<SupportScreen navigate={() => {}} />);

    await waitFor(() => expect(screen.getByText(/have not reported anything/i)).toBeTruthy());
  });

  it('lists what is outstanding', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([TICKET] as never);
    render(<SupportScreen navigate={() => {}} />);

    await waitFor(() => expect(screen.getByText(/commission has not arrived/i)).toBeTruthy());
    expect(document.body.textContent).toMatch(/SUP-2026-000031/);
  });
});
