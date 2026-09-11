/**
 * Giving an association standing over what its members are assessed on.
 *
 * A registered cooperative is not automatically an attesting body. Until an
 * officer says so, on the record and with a reason, its leader cannot
 * contradict an agent's count of a member's stall — and that matters because
 * the contradiction moves a band, and a band is a bill.
 *
 * Phase 5 gave groups the column and nothing could write it, so every group
 * sat at NONE for ever and the attestation half of enumeration was
 * unreachable. This screen is what makes it reachable, and these tests are
 * about the two things that must be true of it: the reason is not optional,
 * and taking the standing away works as readily as giving it.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { GroupsScreen } from '../screens/Groups';
import * as apiModule from '../lib/api';

const GROUPS = [
  {
    id: 'grp-1',
    code: 'GRP-0001',
    name: 'Terminus Tailors Guild',
    group_type: 'ARTISAN_GUILD',
    economic_sector: 'ARTISAN_CRAFT',
    status: 'ACTIVE',
    lga_name: 'Jos North',
    leader_name: 'Yusuf Bala',
    leader_phone: '+2348030000001',
    attested_members: '18',
    tax_role: 'NONE',
  },
  {
    id: 'grp-2',
    code: 'GRP-0002',
    name: 'Bukuru Transport Union',
    group_type: 'TRANSPORT_UNION',
    economic_sector: 'TRANSPORT_PASSENGER',
    status: 'ACTIVE',
    lga_name: 'Jos South',
    leader_name: 'Nanle Dung',
    leader_phone: '+2348030000002',
    attested_members: '64',
    tax_role: 'ATTESTATION',
  },
  {
    id: 'grp-3',
    code: 'GRP-0003',
    name: 'Vom Farmers Cooperative',
    group_type: 'FARMERS_COOPERATIVE',
    economic_sector: 'AGRICULTURE',
    status: 'PENDING',
    lga_name: 'Jos South',
    leader_name: 'Rifkatu Choji',
    leader_phone: '+2348030000003',
    attested_members: '0',
    tax_role: 'NONE',
  },
];

let posted: { path: string; body: any }[] = [];

beforeEach(() => {
  cleanup();
  posted = [];
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/groups')) return { groups: GROUPS } as never;
    if (path.includes('/allocations')) return { rounds: [] } as never;
    return [] as never;
  });
  vi.spyOn(apiModule.api, 'post').mockImplementation(async (path: string, body?: unknown) => {
    posted.push({ path, body });
    return { taxRole: (body as { taxRole: string }).taxRole } as never;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function reason(text: string) {
  const box = await screen.findByLabelText(/reason/i);
  fireEvent.change(box, { target: { value: text } });
}

describe('a group’s part in enumeration', () => {
  it('will not confer standing until a reason has been written', async () => {
    /*
     * Not a validation error after the fact. A leader who can contradict an
     * agent has real power over a member's bill, and the audit record of why
     * they were given it is the only thing that makes that reviewable — so the
     * control is inert until the reason exists.
     */
    render(<GroupsScreen navigate={() => {}} />);
    await waitFor(() => expect(screen.getByText('Terminus Tailors Guild')).toBeTruthy());

    const row = screen.getByText('Terminus Tailors Guild').closest('tr')!;
    const control = within(row).getByLabelText(/Part in enumeration — Terminus Tailors Guild/i);
    expect(control).toHaveProperty('disabled', true);

    await reason('Recognised under the market bye-law of 2026.');
    expect(control).toHaveProperty('disabled', false);
  });

  it('confers it, and says which part was given', async () => {
    render(<GroupsScreen navigate={() => {}} />);
    await waitFor(() => expect(screen.getByText('Terminus Tailors Guild')).toBeTruthy());
    await reason('Recognised under the market bye-law of 2026.');

    const row = screen.getByText('Terminus Tailors Guild').closest('tr')!;
    fireEvent.change(within(row).getByLabelText(/Part in enumeration/i), {
      target: { value: 'ATTESTATION' },
    });

    await waitFor(() => {
      const call = posted.find((entry) => entry.path.includes('/tax-role'));
      expect(call!.path).toBe('/groups/grp-1/tax-role');
      expect(call!.body).toMatchObject({
        taxRole: 'ATTESTATION',
        reason: 'Recognised under the market bye-law of 2026.',
      });
    });
  });

  it('takes it away again', async () => {
    // A union inflating its members' figures has to stop being consulted the
    // same day, so withdrawal cannot be a schema change or a support ticket.
    render(<GroupsScreen navigate={() => {}} />);
    await waitFor(() => expect(screen.getByText('Bukuru Transport Union')).toBeTruthy());
    await reason('Leader suspended pending an inflation complaint.');

    const row = screen.getByText('Bukuru Transport Union').closest('tr')!;
    const control = within(row).getByLabelText(/Part in enumeration/i) as HTMLSelectElement;
    expect(control.value, 'the list shows what each group may already do').toBe('ATTESTATION');
    fireEvent.change(control, { target: { value: 'NONE' } });

    await waitFor(() => {
      const call = posted.find((entry) => entry.path.includes('/tax-role'));
      expect(call!.body).toMatchObject({ taxRole: 'NONE' });
    });
  });

  it('offers nothing on a group nobody has approved yet', async () => {
    /*
     * A pending registration is a claim that an association exists. Offering
     * to give it standing before anybody checked would let a group vouch for
     * itself by filling in a form.
     */
    render(<GroupsScreen navigate={() => {}} />);
    // It appears twice: once in the queue awaiting a decision and once in the
    // register below it. Neither may offer the control.
    await waitFor(() =>
      expect(screen.getAllByText('Vom Farmers Cooperative').length).toBeGreaterThan(0),
    );

    const rows = screen.getAllByText('Vom Farmers Cooperative').map((node) => node.closest('tr')!);
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(within(row).queryByLabelText(/Part in enumeration/i)).toBeNull();
    }
  });

  it('says “No part” rather than “No fixed premises”', async () => {
    /*
     * The enum dictionary is keyed by value, so NONE is one entry serving two
     * columns — a premises on an enumeration observation and a part in
     * enumeration on a group. Rendering the group column through it told an
     * officer that a cooperative had no fixed premises.
     */
    vi.spyOn(apiModule, 'can').mockImplementation((permission: string) => permission !== 'group:manage');
    render(<GroupsScreen navigate={() => {}} />);
    await waitFor(() => expect(screen.getByText('Terminus Tailors Guild')).toBeTruthy());

    const row = screen.getByText('Terminus Tailors Guild').closest('tr')!;
    expect(row.textContent).toMatch(/No part/);
    expect(row.textContent).not.toMatch(/No fixed premises/);
  });
});
