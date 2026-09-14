/**
 * The queue of money citizens are still owed, when it cannot be read.
 *
 * This screen opens by stating the thing it exists to prevent:
 *
 *   "A queue nobody can look at is indistinguishable from an empty one,
 *    which is the wrong thing for a refund to be indistinguishable from."
 *
 * It was doing it. Every fetch answered a failure with `setX([])`, and an
 * empty array is exactly what an emptied queue looks like. With the requests
 * failing — an expired session, a scoped refusal, the API down — the counts
 * came to zero, `loaded` came to true, and the screen rendered a green
 * success alert reading "Nothing is outstanding. Every refund has been made."
 *
 * An officer opens the list of refunds owed to citizens, is shown a green
 * tick, and closes the tab. The citizens are still owed.
 *
 * That is the second screen today whose own doc comment named the defect it
 * had — the auditor's workbench was the first — and it is worth saying why
 * that keeps happening: the comment describes the design, and the design is
 * right. What was never checked is whether the code does it.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { OutstandingScreen } from '../screens/Outstanding';
import * as apiModule from '../lib/api';
import { setPortalLanguage } from '../lib/i18n';

const en = translations.en as unknown as Record<string, string>;
const ha = translations.ha as unknown as Record<string, string>;

const REFUND = {
  id: 'rf-1',
  refund_reference: 'RFD-2026-000041',
  amount_kobo: '300000',
  status: 'PENDING',
  attempts: 2,
  failure_reason: 'gateway timeout',
  last_attempt_at: '2026-09-09T11:00:00.000Z',
  created_at: '2026-09-01T08:00:00.000Z',
  transaction_reference: 'TRX-2026-000041',
};

/** Which fetches fail for a given test. 'all' is the outage. */
let failing: 'none' | 'all' | 'refunds' = 'none';

function answer(path: string): unknown {
  if (path.includes('refunds/outstanding')) return { refunds: [REFUND] };
  if (path.includes('tin-outstanding')) return { taxpayers: [] };
  if (path.includes('ended-with-arrears')) return { taxpayers: [] };
  return { renewals: [], vehiclesAwaitingAuthority: [] };
}

beforeEach(() => {
  cleanup();
  setPortalLanguage('en');
  failing = 'none';
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    if (failing === 'all') throw new Error('gateway timeout');
    if (failing === 'refunds' && path.includes('refunds/outstanding')) {
      throw new Error('gateway timeout');
    }
    return answer(path) as never;
  });
});

afterEach(() => {
  setPortalLanguage('en');
  vi.restoreAllMocks();
});

describe('a queue nobody can see', () => {
  /**
   * The one that would have sent an officer away satisfied.
   */
  it('does not say every refund has been made when no queue could be read', async () => {
    failing = 'all';
    render(<OutstandingScreen />);

    await waitFor(() => {
      expect(screen.getByText(en.ofcOsQueueUnreadable)).toBeTruthy();
    });
    expect(screen.queryByText(en.ofcOsNothingOutstanding)).toBeNull();
    expect(screen.queryByText(en.ofcOsEveryRefundHasBeen)).toBeNull();
  });

  it('says how many queues it could not read', async () => {
    failing = 'refunds';
    render(<OutstandingScreen />);

    await waitFor(() => {
      expect(
        screen.getByText(en.ofcOsQueueUnreadableBody.replace('{{n}}', '1')),
      ).toBeTruthy();
    });
  });

  /**
   * And a genuinely empty set of queues still reads as empty.
   *
   * A warning on every load is a warning nobody reads by the second week,
   * which would make the real one invisible in the way this change exists to
   * prevent. "Nothing is outstanding" has to remain sayable.
   */
  it('still says nothing is outstanding when every queue was read and is empty', async () => {
    vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
      if (path.includes('refunds/outstanding')) return { refunds: [] } as never;
      return answer(path) as never;
    });
    render(<OutstandingScreen />);

    await waitFor(() => {
      expect(screen.getByText(en.ofcOsNothingOutstanding)).toBeTruthy();
    });
    expect(screen.queryByText(en.ofcOsQueueUnreadable)).toBeNull();
  });

  it('says nothing about unreadable queues when everything loaded', async () => {
    render(<OutstandingScreen />);
    await waitFor(() => expect(screen.getByText('RFD-2026-000041')).toBeTruthy());
    expect(screen.queryByText(en.ofcOsQueueUnreadable)).toBeNull();
  });

  it('warns an officer reading Hausa in Hausa', async () => {
    setPortalLanguage('ha');
    failing = 'all';
    render(<OutstandingScreen />);

    await waitFor(() => expect(screen.getByText(ha.ofcOsQueueUnreadable)).toBeTruthy());
    expect(screen.queryByText(en.ofcOsQueueUnreadable)).toBeNull();
    // "could not be read" is a negative, and stays one.
    expect(ha.ofcOsQueueUnreadable).toMatch(/\b(ba|bai|babu)\b/i);
  });
});
