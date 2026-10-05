/**
 * The leader's confirmation link, which this screen used to show the agent.
 *
 * The group screen tells the agent why their word is not enough — "you are paid
 * commission on what these members pay … the group's own leader confirms the
 * list" — and then, under "Send this to the leader", printed the link that
 * confirms it. The link opens without an account, so the agent could confirm
 * their own members. The API no longer returns it; it goes by SMS to the
 * leader's phone. What the screen has to show now is where it went.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { GroupScreen } from '../screens/Groups';
import { api } from '../lib/api';

const en = translations.en;

const GROUP = {
  id: 'g-1',
  name: 'Mangu Grain Farmers',
  code: 'GRP-00071',
  group_type: 'FARMERS_COOPERATIVE',
  lga_name: 'Mangu',
  ward_name: null,
  community: null,
  status: 'ACTIVE',
  leader_name: 'Danjuma Pam',
  leader_phone: '+2348030000371',
  attested_members: '0',
  pending_members: '1',
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => cleanup());

describe('asking the leader to confirm the members', () => {
  it('says the link went to the leader’s phone, and does not show it', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
      (path === '/groups/g-1' ? GROUP : []) as never,
    );
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      sentTo: '***********371',
      expiresAt: '2026-10-19T00:00:00.000Z',
      message: "The confirmation link was sent to the group leader's phone (***********371).",
    } as never);

    render(<GroupScreen groupId="g-1" />);
    fireEvent.click(await screen.findByText(en.grpSendLeaderLink));

    await waitFor(() => expect(screen.getByText(en.grpSentToLeader)).toBeTruthy());
    expect(post).toHaveBeenCalledWith('/groups/g-1/attestation-request', {});
    expect(screen.getByText(/\*+371/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/group-attestation\//);
    expect(document.body.textContent).not.toContain('{{phone}}');
  });
});
