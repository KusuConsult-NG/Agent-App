/**
 * Declining to vouch for somebody is not a thing to do by accident.
 *
 * The referee portal is opened from an SMS link by a community leader with no
 * account. Declining is single-use and irreversible from their side: the
 * service writes `referees.status = 'REJECTED'`, marks the invitation
 * responded, and the token is spent. There is no signing back in to undo it,
 * and the applicant's clearance stops there.
 *
 * The screen asked for the optional reason with `window.prompt`, and then:
 *
 *     const reason = window.prompt('You may give a reason (optional):') ?? undefined;
 *     // ...decline, whatever came back
 *
 * So the Cancel button on that dialog declined. A referee who tapped the wrong
 * button and pressed Cancel to get out of it refused the applicant, and was
 * shown a green tick and the word THANK YOU for doing it.
 *
 * The officer portal has the same pattern written correctly — `if (reason ===
 * null) return;` — which is the tell: the aborting branch was known about, and
 * it is missing from the one place where the action cannot be undone and the
 * person has no account to fix it from.
 *
 * `window.prompt` is also the wrong instrument here regardless of the branch.
 * These links arrive by SMS and are opened in whatever in-app browser the
 * message was read in; several suppress prompts outright, and a suppressed
 * prompt returns null immediately — so the button declined with no dialog at
 * all, instantly, on the first tap.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { RefereePortalScreen } from '../screens/Public';
import { api } from '../lib/api';

const INVITATION = {
  refereeId: 'ref-1',
  referenceCode: 'REF/2026/000001',
  refereeName: 'Musa Danladi',
  applicantName: 'Ladi Dung',
  applicantLga: 'Jos North',
  relationship: 'Community leader who knows the applicant',
  category: 'COMMUNITY_LEADER',
  expiresAt: '2026-12-31T00:00:00.000Z',
  declarations: [
    'I know this person.',
    'The information presented is reasonably accurate.',
    'I am willing to act as referee.',
    'I understand that providing false information may have consequences.',
  ],
};

let post: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'publicGet').mockResolvedValue(INVITATION as never);
  post = vi.fn().mockResolvedValue({ message: 'Recorded.' });
  vi.spyOn(api, 'publicPost').mockImplementation(post as never);
});

afterEach(cleanup);

async function openPortal() {
  render(<RefereePortalScreen token="tok-1" />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /cannot act as referee/i })).toBeTruthy(),
  );
}

describe('a referee who did not mean to decline', () => {
  it('does not decline anybody until they say so a second time', async () => {
    await openPortal();

    fireEvent.click(screen.getByRole('button', { name: /cannot act as referee/i }));

    // Both halves matter. "Nothing was sent" alone passes vacuously under
    // jsdom, where window.prompt throws rather than returning — which is how
    // this test first passed against the very code it was written to fail on.
    // Asking for the confirmation step as well pins the behaviour, not the
    // absence of a side effect.
    expect(await screen.findByRole('button', { name: /yes, decline/i })).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('offers a way back, and taking it sends nothing', async () => {
    await openPortal();
    fireEvent.click(screen.getByRole('button', { name: /cannot act as referee/i }));

    const back = await screen.findByRole('button', { name: /no, go back/i });
    fireEvent.click(back);

    expect(post).not.toHaveBeenCalled();
    // And the referee is returned to the form they were on.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /confirm and submit/i })).toBeTruthy(),
    );
  });

  it('says what declining does before it is done', async () => {
    await openPortal();
    fireEvent.click(screen.getByRole('button', { name: /cannot act as referee/i }));

    // The consequence, in the referee's terms: it cannot be undone from here.
    const panel = await screen.findByText(/cannot be undone/i);
    expect(panel).toBeTruthy();
    // The applicant is named on the confirmation, so it is clear who is refused.
    expect(screen.getAllByText(/Ladi Dung/).length).toBeGreaterThan(0);
  });
});

describe('a referee who does mean to decline', () => {
  it('sends the decline, with the reason when one is given', async () => {
    await openPortal();
    fireEvent.click(screen.getByRole('button', { name: /cannot act as referee/i }));

    const reason = await screen.findByLabelText(/reason/i);
    fireEvent.change(reason, { target: { value: 'I do not know this person.' } });

    fireEvent.click(screen.getByRole('button', { name: /yes, decline/i }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe('/referee/tok-1/decline');
    expect(post.mock.calls[0][1]).toEqual({ reason: 'I do not know this person.' });
  });

  it('does not require a reason', async () => {
    await openPortal();
    fireEvent.click(screen.getByRole('button', { name: /cannot act as referee/i }));
    fireEvent.click(await screen.findByRole('button', { name: /yes, decline/i }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).toEqual({ reason: undefined });
  });
});

describe('the screen never asks the browser for a dialog', () => {
  it('does not call window.prompt', async () => {
    const prompt = vi.fn().mockReturnValue(null);
    vi.stubGlobal('prompt', prompt);

    await openPortal();
    fireEvent.click(screen.getByRole('button', { name: /cannot act as referee/i }));

    // A suppressed prompt returns null with no dialog shown. Relying on one
    // means the button behaves differently depending on which in-app browser
    // the SMS was opened in.
    expect(prompt).not.toHaveBeenCalled();
  });
});
