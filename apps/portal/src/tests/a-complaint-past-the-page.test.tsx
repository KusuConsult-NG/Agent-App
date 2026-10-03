/**
 * "16 open complaints about conduct or charges", on a queue holding twenty.
 *
 * This screen counts AGENT_MISCONDUCT and UNAUTHORISED_CHARGE tickets that
 * are not closed and shows the figure as a banner above the table. The test
 * that put the banner there says why it matters: a citizen who reports being
 * overcharged by a revenue agent has no other way into this building.
 *
 * It counted them here, over the rows it had, and `/support/tickets` answers
 * with fifty. Measured against the API on sixty open tickets with every third
 * a conduct complaint: twenty exist, sixteen are on the page.
 *
 * `a-complaint-nobody-saw` is the sibling of this file: it fixed the banner
 * DISAPPEARING when the read failed. This is the banner UNDERCOUNTING when
 * the queue is busy. Both end with a complaint nobody saw.
 *
 * So the figure comes from the server now, over every matching ticket. The
 * list of subjects inside the banner is still the page's — those are all the
 * screen has — which is why the banner also says how many are not below it.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { SupportScreen } from '../screens/Support';
import { api } from '../lib/api';
import { translations } from '@psirs/shared';
import { setPortalLanguage } from '../lib/i18n';

const en = translations.en as unknown as Record<string, string>;

function ticket(n: number, over: Record<string, unknown> = {}) {
  return {
    id: `t-${n}`,
    ticket_number: `SUP-2026-${String(n).padStart(6, '0')}`,
    category: 'PAYMENT_ISSUE',
    subject: `Payment did not go through ${n}`,
    status: 'OPEN',
    priority: 'NORMAL',
    created_at: '2026-09-09T10:00:00Z',
    updated_at: '2026-09-09T10:00:00Z',
    resolved_at: null,
    raised_by_name: 'Ladi Dung',
    raiser_role: 'citizen',
    assigned_to_name: null,
    transaction_reference: null,
    message_count: 1,
    last_message_at: null,
    ...over,
  };
}

const complaint = (n: number) =>
  ticket(n, {
    category: 'AGENT_MISCONDUCT',
    subject: `Agent asked for more than the receipt ${n}`,
  });

beforeEach(() => {
  cleanup();
  setPortalLanguage('en');
});

afterEach(() => {
  setPortalLanguage('en');
  vi.restoreAllMocks();
});

describe('the complaints banner over a capped queue', () => {
  it('says how many complaints are open, not how many fitted on the page', async () => {
    // Sixteen complaints on the page; twenty in the queue.
    vi.spyOn(api, 'get').mockResolvedValue({
      tickets: Array.from({ length: 16 }, (_, i) => complaint(i)),
      matched: 60,
      conductOpen: 20,
      cap: 50,
    } as never);
    render(<SupportScreen navigate={() => {}} />);

    await waitFor(() => {
      expect(
        screen.getByText(en.ofcSpOpenComplaints.replace('{{n}}', '20')),
      ).toBeTruthy();
    });
    // The page's own count must not be what is shown.
    expect(screen.queryByText(en.ofcSpOpenComplaints.replace('{{n}}', '16'))).toBeNull();
  });

  it('says how many of them are not in the table', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      tickets: Array.from({ length: 16 }, (_, i) => complaint(i)),
      matched: 60,
      conductOpen: 20,
      cap: 50,
    } as never);
    render(<SupportScreen navigate={() => {}} />);

    await waitFor(() => {
      expect(
        screen.getByText(en.ofcSpComplaintsBeyondThisPage.replace('{{n}}', '4')),
      ).toBeTruthy();
    });
  });

  it('stays quiet about the rest when the table holds them all', async () => {
    // The bound. A sentence printed whenever the banner draws would pass the
    // case above and tell every supervisor that complaints are missing.
    vi.spyOn(api, 'get').mockResolvedValue({
      tickets: [complaint(1), complaint(2)],
      matched: 2,
      conductOpen: 2,
      cap: 50,
    } as never);
    render(<SupportScreen navigate={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(en.ofcSpOpenComplaints.replace('{{n}}', '2'))).toBeTruthy();
    });
    expect(screen.queryByText(/not in the table below/i)).toBeNull();
  });

  it('raises the banner for a complaint that is not on the page at all', async () => {
    /*
     * The case the old arithmetic could not express. Fifty payment issues
     * sort ahead of the complaints, so the page carries none of them — and a
     * count over the page is nought, which removed the banner entirely. The
     * citizen who reported being overcharged had no other way in.
     */
    vi.spyOn(api, 'get').mockResolvedValue({
      tickets: Array.from({ length: 50 }, (_, i) => ticket(i)),
      matched: 54,
      conductOpen: 4,
      cap: 50,
    } as never);
    render(<SupportScreen navigate={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(en.ofcSpOpenComplaints.replace('{{n}}', '4'))).toBeTruthy();
    });
    expect(
      screen.getByText(en.ofcSpComplaintsBeyondThisPage.replace('{{n}}', '4')),
    ).toBeTruthy();
  });

  it('counts the page when an older API answers with a bare array', async () => {
    // Not a nought. This endpoint returned an array until the count moved to
    // the server, and a nought here removes the banner — which is the failure
    // `a-complaint-nobody-saw` exists for.
    vi.spyOn(api, 'get').mockResolvedValue([
      complaint(1),
      complaint(2),
      ticket(3),
    ] as never);
    render(<SupportScreen navigate={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(en.ofcSpOpenComplaints.replace('{{n}}', '2'))).toBeTruthy();
    });
    expect(screen.queryByText(/not in the table below/i)).toBeNull();
  });
});
