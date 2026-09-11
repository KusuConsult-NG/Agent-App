/**
 * The support queue, and the complaint a failed read hid.
 *
 * `SupportScreen` caught a refusal with `setTickets([])`, and an empty queue
 * prints "No tickets match this filter."
 *
 * That is the ordinary version of this defect. The costly version is two lines
 * above it: complaints about how revenue staff treated somebody —
 * AGENT_MISCONDUCT and UNAUTHORISED_CHARGE — are counted out of this same
 * list, and shown as a banner that fires only when the count is above zero.
 * An empty array does not merely produce an empty table. It removes the
 * banner, so a refused read says, silently, that nobody has complained about
 * an agent this week.
 *
 * A citizen who reports being overcharged by a revenue agent has no other way
 * into this building.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { SupportScreen } from '../screens/Support';
import { formatDateTime } from '../ui';
import { ApiRequestError, api } from '../lib/api';
import { permissionsForRole } from '@psirs/shared';

const COMPLAINT = {
  id: 't-1',
  ticket_number: 'SUP-2026-000031',
  category: 'UNAUTHORISED_CHARGE',
  subject: 'Agent asked for ₦2,000 above the receipt',
  status: 'OPEN',
  priority: 'HIGH',
  created_at: '2026-09-09T10:00:00Z',
  raised_by_name: 'Ladi Dung',
  raiser_role: 'citizen',
  assigned_to_name: null,
  transaction_reference: 'PSIRS-TX-2026-000901',
  message_count: 1,
};

const REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'The support queue could not be read.',
  moneyStatus: 'NOT_APPLICABLE',
});

function signIn() {
  sessionStorage.setItem(
    'psirs.portal.user',
    JSON.stringify({
      id: 'u1',
      phone: '+2348000000001',
      fullName: 'Support Officer',
      role: 'admin',
      permissions: permissionsForRole('admin'),
    }),
  );
}

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  signIn();
});

afterEach(() => cleanup());

describe('a support queue that could not be read', () => {
  it('does not report it as no tickets matching', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(REFUSED);
    render(<SupportScreen navigate={() => {}} />);

    await waitFor(() => expect(screen.getByText(/support queue could not be read/i)).toBeTruthy());
    expect(screen.queryByText(/No tickets match this filter/i)).toBeNull();
  });

  it('offers to ask again', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockRejectedValueOnce(REFUSED)
      .mockResolvedValueOnce([COMPLAINT] as never);
    render(<SupportScreen navigate={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: /Try again/i }));

    await waitFor(() => expect(screen.getByText(/above the receipt/)).toBeTruthy());
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('the conduct banner', () => {
  /*
   * The half that has a person on the other end of it. The banner is derived
   * from the same list, so the old empty array silently answered "no open
   * complaints" — which is the answer an officer acts on by doing nothing.
   */
  it('is raised when a complaint about an agent is open', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([COMPLAINT] as never);
    render(<SupportScreen navigate={() => {}} />);

    await waitFor(() => expect(screen.getByText(/open complaint/i)).toBeTruthy());
  });

  it('is not answered either way while the queue is unreadable', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(REFUSED);
    render(<SupportScreen navigate={() => {}} />);

    await waitFor(() => expect(screen.getByText(/support queue could not be read/i)).toBeTruthy());
    // Silence about complaints is only honest beside a visible failure.
    expect(screen.queryByText(/open complaint/i)).toBeNull();
    expect(screen.queryByText(/No tickets match this filter/i)).toBeNull();
  });

  /*
   * The control. A queue with no conduct complaints in it is the ordinary
   * state, and the banner staying away is what makes it mean something when
   * it appears.
   */
  it('stays away when the queue really holds none', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([
      { ...COMPLAINT, category: 'APP_PROBLEM', subject: 'Cannot sign in on the handset' },
    ] as never);
    render(<SupportScreen navigate={() => {}} />);

    await waitFor(() => expect(screen.getByText(/Cannot sign in/)).toBeTruthy());
    expect(screen.queryByText(/open complaint/i)).toBeNull();
  });
});

/**
 * When it was last touched, which is what triage actually runs on.
 *
 * The queue showed when a ticket was RAISED and not when anybody last answered
 * it. So a complaint opened three weeks ago and replied to this morning looked
 * exactly like one opened three weeks ago and left alone since — and the reply
 * count beside it does not separate them either, because both may say 4.
 *
 * `last_message_at` was declared on the row type and drawn by no column. The
 * fixture above did not even carry it, so the shape the API sends had never
 * been rendered.
 */
describe('which complaint has been waiting', () => {
  /** The queue endpoint answers with a bare array, as the tests above show. */
  const queue = (tickets: unknown[]) =>
    vi.spyOn(api, 'get').mockResolvedValue(tickets as never);

  it('says when a ticket was last replied to', async () => {
    queue([{ ...COMPLAINT, last_message_at: '2026-09-11T08:00:00Z' }]);
    render(<SupportScreen navigate={() => {}} />);

    await waitFor(() => expect(screen.getByText('SUP-2026-000031')).toBeTruthy());
    const row = screen.getByText('SUP-2026-000031').closest('tr')!;
    /*
     * Asserted through the same formatter the screen uses, not on a loose
     * `/2026/`. That matched the transaction reference sitting in the same row
     * — `PSIRS-TX-2026-000901` — so it passed with the column removed.
     */
    expect(within(row).getByText(formatDateTime('2026-09-11T08:00:00Z'))).toBeTruthy();
    expect(within(row).getByText(formatDateTime(COMPLAINT.created_at))).toBeTruthy();
    expect(within(row).queryByText(/No reply yet/i)).toBeNull();
  });

  it('says nobody has answered it at all, which is the one to open first', async () => {
    queue([{ ...COMPLAINT, last_message_at: null }]);
    render(<SupportScreen navigate={() => {}} />);

    await waitFor(() => expect(screen.getByText('SUP-2026-000031')).toBeTruthy());
    const row = screen.getByText('SUP-2026-000031').closest('tr')!;
    expect(within(row).getByText(/No reply yet/i)).toBeTruthy();
  });

  it('still says when it was raised, which is a different question', async () => {
    // The control: the new column must not have replaced the old one.
    queue([{ ...COMPLAINT, last_message_at: null }]);
    render(<SupportScreen navigate={() => {}} />);

    await waitFor(() => expect(screen.getByText('SUP-2026-000031')).toBeTruthy());
    const row = screen.getByText('SUP-2026-000031').closest('tr')!;
    expect(within(row).getByText(formatDateTime(COMPLAINT.created_at))).toBeTruthy();
  });
});
