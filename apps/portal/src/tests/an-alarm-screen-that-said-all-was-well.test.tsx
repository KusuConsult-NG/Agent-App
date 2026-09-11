/**
 * The inbox is where the platform raises the alarm about itself, and a failed
 * read made it say there was nothing wrong.
 *
 * `InboxScreen` carries two kinds of row. One is addressed to an officer —
 * a case needs them. The other is addressed to their role, and that is how
 * the platform's own alarms arrive: a background job that has stalled,
 * collection that has stopped. There is no other screen that says so.
 *
 * Its catch did `setRows([])`, which prints "Nothing has been raised for
 * you." The unread counter started at `0` and was never moved, so the figure
 * under "Not yet read" stayed `0`. The critical count is derived from rows,
 * so it read `0` too, and the red banner above the list — the one that exists
 * precisely so nobody has to spot the alarm in a table of forty rows — was
 * not drawn at all.
 *
 * Four statements, all of them false, all of them from one request that did
 * not come back. And the shape of them is the worst possible shape: every one
 * says the same reassuring thing, which is the state an officer closes the
 * screen on.
 *
 * The refusal did reach the top of the page. That is not enough when the rest
 * of the screen is confidently contradicting it.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { InboxScreen } from '../screens/Inbox';
import { ApiRequestError, api } from '../lib/api';
import * as apiModule from '../lib/api';
import { permissionsForRole } from '@psirs/shared';

const STALLED_JOB = {
  id: 'n1',
  kind: 'JOB_STALLED',
  severity: 'CRITICAL',
  subject: 'Reconciliation has not run for three days',
  body: 'The overnight reconciliation job last completed on 8 September.',
  entity_type: null,
  entity_id: null,
  created_at: '2026-09-11T06:00:00.000Z',
  read_at: null,
  read_by_name: null,
  addressed_to_role: 'admin',
};

const ROUTINE = {
  id: 'n2',
  kind: 'CASE_ASSIGNED',
  severity: 'INFO',
  subject: 'A dispute was assigned to you',
  body: 'Case 4471 is waiting for your decision.',
  entity_type: 'case',
  entity_id: 'case-4471',
  created_at: '2026-09-11T07:00:00.000Z',
  read_at: null,
  read_by_name: null,
  addressed_to_role: null,
};

const REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'The inbox could not be read.',
  moneyStatus: 'NOT_APPLICABLE',
});

function signIn() {
  apiModule.setSession(null);
  sessionStorage.setItem(
    'psirs.portal.user',
    JSON.stringify({
      id: 'u1',
      phone: '+2348000000001',
      fullName: 'Administrator',
      role: 'admin',
      permissions: permissionsForRole('admin'),
    }),
  );
}

/** The figure a `Stat` is showing, found by the label printed beside it. */
function statValue(label: string): string {
  const stat = screen.getByText(label).closest('.stat');
  return stat?.querySelector('.stat__value')?.textContent ?? '';
}

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  signIn();
});

afterEach(() => cleanup());

describe('an inbox whose read was refused', () => {
  it('does not say nothing has been raised', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(REFUSED);

    render(<InboxScreen navigate={() => {}} />);

    await screen.findByText('The inbox could not be read.');
    // The sentence the empty table prints. It is a statement about the
    // platform being quiet, and the platform may be screaming.
    expect(screen.queryByText('Nothing has been raised for you.')).toBeNull();
  });

  it('does not put a nought under the two counts', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(REFUSED);

    render(<InboxScreen navigate={() => {}} />);
    await screen.findByText('The inbox could not be read.');

    // "Not yet read" and "Needing attention now". Both used to read 0 —
    // the first from a counter that never left its initial value, the
    // second from filtering a list that was not there.
    expect(statValue('Not yet read')).not.toBe('0');
    expect(statValue('Needing attention now')).not.toBe('0');
  });

  it('offers a way to ask again, and the alarm arrives when it works', async () => {
    let call = 0;
    vi.spyOn(api, 'get').mockImplementation(async () => {
      call += 1;
      if (call === 1) throw REFUSED;
      return { notifications: [STALLED_JOB, ROUTINE], unread: 2 } as never;
    });

    render(<InboxScreen navigate={() => {}} />);
    await screen.findByText('The inbox could not be read.');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    // The whole point of the retry: the alarm that was hidden behind the
    // failure gets through. Twice over — once in the banner above the list
    // and once in the list — which is the screen working as intended.
    expect(await screen.findAllByText('Reconciliation has not run for three days')).toHaveLength(2);
    await waitFor(() => expect(statValue('Not yet read')).toBe('2'));
    expect(screen.getByText('The platform needs attention')).toBeTruthy();
    expect(screen.queryByText('The inbox could not be read.')).toBeNull();
  });

  it('does not offer the mark-all button as though there were nothing to mark', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(REFUSED);

    render(<InboxScreen navigate={() => {}} />);
    await screen.findByText('The inbox could not be read.');

    // Disabled either way, which is right — there is nothing to act on. What
    // must not happen is the screen looking like a cleared inbox.
    expect(screen.getByRole('button', { name: 'Mark all read' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('the states this must not have broken', () => {
  it('still draws a skeleton while the read is in flight', async () => {
    // A read that has not answered yet is the one case where saying nothing
    // is correct. It must not show the failure, and it must not show a count.
    vi.spyOn(api, 'get').mockImplementation(() => new Promise(() => {}));

    render(<InboxScreen navigate={() => {}} />);

    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeTruthy());
    expect(screen.queryByText('Nothing has been raised for you.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('still says nothing has been raised when that is true', async () => {
    // The sentence is not wrong. It is wrong from a failure. An inbox that
    // genuinely answered with no rows must still be able to say so.
    vi.spyOn(api, 'get').mockResolvedValue({ notifications: [], unread: 0 } as never);

    render(<InboxScreen navigate={() => {}} />);

    await screen.findByText('Nothing has been raised for you.');
    expect(statValue('Not yet read')).toBe('0');
    expect(statValue('Needing attention now')).toBe('0');
  });

  it('still announces a critical row above the list', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      notifications: [STALLED_JOB, ROUTINE],
      unread: 2,
    } as never);

    render(<InboxScreen navigate={() => {}} />);

    await screen.findByText('The platform needs attention');
    expect(statValue('Needing attention now')).toBe('1');
  });

  it('still reports a refused mark-read without losing the list', async () => {
    // The action's failure and the load's failure are separate states now.
    // A row that would not mark must not take the rows away with it.
    vi.spyOn(api, 'get').mockResolvedValue({
      notifications: [ROUTINE],
      unread: 1,
    } as never);
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiRequestError(409, {
        code: 'CONFLICT',
        message: 'That notification was already marked read.',
        moneyStatus: 'NOT_APPLICABLE',
      }),
    );

    render(<InboxScreen navigate={() => {}} />);
    await screen.findByText('A dispute was assigned to you');

    fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));

    await screen.findByText('That notification was already marked read.');
    expect(screen.getByText('A dispute was assigned to you')).toBeTruthy();
  });
});

/**
 * What the notification actually said, which the table dropped.
 *
 * The only writer of `body` is `raiseSystemAlerts`, and it composes the job's
 * purpose, when it last succeeded, how many times it has failed in a row, and
 * the line that matters:
 *
 *     (job.lastError ? `\nLast error: ${job.lastError}` : '')
 *
 * This screen declared `body` on its row type and drew four columns, none of
 * them that one — the same shape as `lastDetail` on the unattended-work board,
 * and the fixtures above have carried bodies all along for a value nothing
 * rendered.
 *
 * So an administrator woken at night by a CRITICAL alert read the subject —
 * "reconciliation-sweep: Failed 3 times in a row" — and to find out what it
 * actually threw had to already know that a different screen would tell them.
 */
describe('the detail under the subject', () => {
  beforeEach(() => cleanup());
  afterEach(() => vi.restoreAllMocks());

  it('shows what the alert said, not only its subject', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      notifications: [STALLED_JOB],
      unread: 1,
    } as never);

    render(<InboxScreen navigate={() => {}} />);

    /*
     * A CRITICAL row appears twice: once in the alert above the table, which
     * lists subjects only, and once as a table row. The detail is what is
     * being asserted, so both queries take all matches.
     */
    await waitFor(() =>
      expect(
        screen.getAllByText('Reconciliation has not run for three days').length,
      ).toBeGreaterThan(0),
    );
    expect(
      screen.getAllByText(/The overnight reconciliation job last completed on 8 September/).length,
    ).toBeGreaterThan(0);
  });

  it('keeps the lines the server composed it with', async () => {
    /*
     * `raiseSystemAlerts` joins purpose, last success, failure count and the
     * error with newlines. Collapsed into one run of text the error is buried
     * mid-paragraph, which is the one line somebody woken at 3am is looking
     * for.
     */
    vi.spyOn(api, 'get').mockResolvedValue({
      notifications: [
        {
          ...STALLED_JOB,
          body:
            'Matches gateway settlements against recorded payments.\n' +
            'Last succeeded: 2026-09-08T02:00:00Z. Consecutive failures: 3.\n' +
            'Last error: Remita returned 503 for the statement.',
        },
      ],
      unread: 1,
    } as never);

    render(<InboxScreen navigate={() => {}} />);

    await waitFor(() =>
      expect(screen.getAllByText(/Last error: Remita returned 503/).length).toBeGreaterThan(0),
    );
    const detail = screen
      .getAllByText(/Last error: Remita returned 503/)
      .find((node) => node.tagName === 'SPAN')!;
    expect(getComputedStyle(detail).whiteSpace).toBe('pre-line');
  });

  it('shows a dash rather than an empty cell when there is no detail', async () => {
    // The control. Most notifications are raised with no body at all, and a
    // blank cell reads as a rendering fault rather than as an absence.
    vi.spyOn(api, 'get').mockResolvedValue({
      notifications: [{ ...ROUTINE, body: '' }],
      unread: 1,
    } as never);

    render(<InboxScreen navigate={() => {}} />);

    await screen.findByText('A dispute was assigned to you');
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
