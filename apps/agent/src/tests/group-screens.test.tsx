/**
 * What the group screens tell an agent before they act.
 *
 * Three things about a cooperative are not obvious from the outside, and an
 * agent who assumes the opposite of any of them has misled somebody:
 *
 *   1. Registering a group assesses nobody. A market association appearing on
 *      the register is not a bill.
 *   2. Members cannot be added until an officer has approved the group — so a
 *      pending group must not show a member form that would only fail.
 *   3. A membership does not count until the group's own leader confirms it.
 *      The agent recording members is paid commission on what those members
 *      later pay, which is exactly why their word alone is not sufficient.
 *
 * The API enforces all three. These pin down that the screen says so, because
 * being refused after the fact is a worse way to learn it than being told.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { GroupScreen, RegisterGroupScreen } from '../screens/Groups';
import { api } from '../lib/api';

const PENDING = {
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

const ACTIVE = { ...PENDING, status: 'ACTIVE', attested_members: '3', pending_members: '2' };

beforeEach(() => {
  vi.restoreAllMocks();
  // The registration screen reads the LGA list straight from the reference
  // endpoint, as the taxpayer wizard does.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => [{ id: 'lga-1', name: 'Bokkos' }] })),
  );
});

afterEach(cleanup);

describe('registering a group', () => {
  it('offers every kind of body an agent meets, and says it charges nobody', async () => {
    render(<RegisterGroupScreen navigate={() => {}} />);

    // The eight the API's enum accepts. A ninth option here would be a form
    // that cannot be submitted.
    const select = await screen.findByLabelText(/what kind of group/i);
    const values = Array.from(select.querySelectorAll('option'))
      .map((o) => (o as HTMLOptionElement).value)
      .filter(Boolean);
    expect(values).toHaveLength(8);
    expect(values).toContain('FARMERS_COOPERATIVE');
    expect(values).toContain('TRANSPORT_UNION');

    expect(screen.getByText(/this does not assess anybody/i)).toBeTruthy();
    expect(screen.getByText(/Nobody is charged anything/i)).toBeTruthy();
  });

  it('will not submit until the group and its leader are both named', async () => {
    render(<RegisterGroupScreen navigate={() => {}} />);
    const button = await screen.findByRole('button', { name: /register group/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('a group waiting for an officer', () => {
  it('offers no member form, and says what is being waited for', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(PENDING as never);
    render(<GroupScreen groupId="g-1" />);

    await waitFor(() => expect(screen.getByText(/waiting for an officer/i)).toBeTruthy());
    // The refusal the API would give, said before the agent tries.
    expect(screen.getByText(/Members can be recorded once an officer has approved it/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /record this member/i })).toBeNull();
  });
});

describe('an approved group', () => {
  it('lets members be recorded and explains why the leader must confirm', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(ACTIVE as never);
    render(<GroupScreen groupId="g-1" />);

    await waitFor(() => expect(screen.getByText(/record a member/i)).toBeTruthy());

    // The commission conflict, named rather than implied.
    expect(
      screen.getByText(/You are paid commission on what these members pay/i),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /send the leader a confirmation link/i })).toBeTruthy();

    // The member button stays disabled until somebody has been picked.
    const record = screen.getByRole('button', { name: /record this member/i }) as HTMLButtonElement;
    expect(record.disabled).toBe(true);
  });
});
