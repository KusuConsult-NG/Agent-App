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
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { SupportScreen } from '../screens/Support';
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
