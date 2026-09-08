/**
 * What the handset lets an agent write down, and what it refuses to let them
 * decide.
 *
 * Enumeration is the one thing in this programme that happens in a market
 * rather than at a desk, and the agent doing it is paid commission on what
 * they collect. That single fact sets every property here:
 *
 *   1. There is no amount on the form, and none comes back. An agent holding
 *      a figure is an agent who can be haggled with, and a presumptive regime
 *      that gets haggled with in its first year does not get a second.
 *   2. The band comes from the server, computed from the facts. It is shown
 *      because the trader will ask what has been written about them — not so
 *      the agent can pick it.
 *   3. Zero is an answer and blank is not. A hawker with no equipment and
 *      nobody working for them is precisely who the exemption is for, so a
 *      skipped question must not read as a finding of nought.
 *   4. Only an association PSIRS has given standing can be named, because
 *      naming one is what lets its leader contradict the count later.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { EnumerateScreen } from '../screens/Enumerate';
import { api } from '../lib/api';

const TAXPAYER = {
  taxpayer: {
    id: 'tp-1',
    tin: '841446134',
    first_name: 'Amina',
    last_name: 'Bulus',
    business_name: null,
    phone: '+2348031000011',
    lga_name: 'Jos North',
    economic_sector: 'ARTISAN_CRAFT',
  },
};

const GROUPS = {
  groups: [
    { id: 'grp-1', name: 'Rukuba Road Traders Association', tax_role: 'ATTESTATION' },
    { id: 'grp-2', name: 'Vom Farmers Cooperative', tax_role: 'NONE' },
  ],
};

let posted: { path: string; body: any }[] = [];

function stub(recorded: Record<string, unknown> = {}) {
  posted = [];
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/groups')) return GROUPS as never;
    return TAXPAYER as never;
  });
  vi.spyOn(api, 'post').mockImplementation(async (path: string, body?: unknown) => {
    posted.push({ path, body });
    return {
      id: 'obs-1',
      sizeBand: 'SMALL',
      premises: 'LOCK_UP_SHOP',
      attestationState: 'NOT_SOUGHT',
      ...recorded,
    } as never;
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => [
        { code: 'ARTISAN_CRAFT', label: 'Craft and trade work' },
        { code: 'RETAIL_TRADE', label: 'Retail trade' },
      ],
    })),
  );
  stub();
});

afterEach(cleanup);

async function fill(values: { premises: string; equipment: string; people: string }) {
  fireEvent.change(await screen.findByLabelText(/Where they trade from/i), {
    target: { value: values.premises },
  });
  fireEvent.change(screen.getByLabelText(/Machines or equipment/i), {
    target: { value: values.equipment },
  });
  fireEvent.change(screen.getByLabelText(/People working besides the owner/i), {
    target: { value: values.people },
  });
}

describe('writing down a stall', () => {
  it('has no field for an amount, and says so on the form', async () => {
    render(<EnumerateScreen taxpayerId="tp-1" navigate={() => {}} />);
    await screen.findByLabelText(/Where they trade from/i);

    for (const label of [/amount/i, /naira|₦/, /turnover/i, /tax due/i]) {
      expect(screen.queryByLabelText(label), `a field matching ${label} is on the form`).toBeNull();
    }
    expect(screen.getByText(/You are not setting the tax/i)).toBeTruthy();
    expect(screen.getByText(/the office will send a notice/i)).toBeTruthy();
  });

  it('offers no way to choose a size band', async () => {
    /*
     * The band is the price in everything but name — one step from the band is
     * the bill. An agent who could pick it could be asked to pick a smaller
     * one, at a stall, with nobody watching.
     */
    render(<EnumerateScreen taxpayerId="tp-1" navigate={() => {}} />);
    await screen.findByLabelText(/Where they trade from/i);

    expect(screen.queryByLabelText(/band/i)).toBeNull();
    for (const band of [/^micro$/i, /^small$/i, /^medium$/i]) {
      expect(screen.queryByRole('option', { name: band })).toBeNull();
    }
  });

  it('will not send a count somebody skipped', async () => {
    render(<EnumerateScreen taxpayerId="tp-1" navigate={() => {}} />);
    const save = await screen.findByRole('button', { name: /Save what you saw/i });
    expect(save).toHaveProperty('disabled', true);

    // Premises alone is not enough: the two counts decide the exemption.
    fireEvent.change(screen.getByLabelText(/Where they trade from/i), {
      target: { value: 'STALL' },
    });
    expect(save).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText(/Machines or equipment/i), { target: { value: '0' } });
    expect(save, 'one count answered is not both').toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText(/People working besides the owner/i), {
      target: { value: '0' },
    });
    expect(save, 'nought is an answer, and this is the person the exemption is for').toHaveProperty(
      'disabled',
      false,
    );
  });

  it('sends the facts, and nothing the agent decided', async () => {
    render(<EnumerateScreen taxpayerId="tp-1" navigate={() => {}} />);
    await fill({ premises: 'LOCK_UP_SHOP', equipment: '3', people: '2' });
    fireEvent.click(screen.getByRole('button', { name: /Save what you saw/i }));

    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]!.path).toBe('/government/enumeration/observations');
    expect(posted[0]!.body).toEqual({
      taxpayerId: 'tp-1',
      premises: 'LOCK_UP_SHOP',
      equipmentCount: 3,
      peopleWorking: 2,
      economicSector: 'ARTISAN_CRAFT',
    });
  });

  it('offers only an association that may actually vouch for the count', async () => {
    render(<EnumerateScreen taxpayerId="tp-1" navigate={() => {}} />);
    const picker = await screen.findByLabelText(/Market association/i);
    const names = Array.from(picker.querySelectorAll('option')).map((o) => o.textContent);

    expect(names).toContain('Rukuba Road Traders Association');
    expect(
      names,
      'a group with no part in enumeration cannot have its leader asked anything',
    ).not.toContain('Vom Farmers Cooperative');
  });

  it('names the association when one is chosen', async () => {
    render(<EnumerateScreen taxpayerId="tp-1" navigate={() => {}} />);
    await fill({ premises: 'STALL', equipment: '1', people: '0' });
    fireEvent.change(screen.getByLabelText(/Market association/i), {
      target: { value: 'grp-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save what you saw/i }));

    await waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0]!.body).toMatchObject({ groupId: 'grp-1' });
  });

  it('shows the band the server worked out, and still no amount', async () => {
    render(<EnumerateScreen taxpayerId="tp-1" navigate={() => {}} />);
    await fill({ premises: 'LOCK_UP_SHOP', equipment: '3', people: '2' });
    fireEvent.click(screen.getByRole('button', { name: /Save what you saw/i }));

    await waitFor(() => expect(screen.getByText(/Written down/i)).toBeTruthy());
    expect(screen.getByText(/Small/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/₦/);
  });

  it('says the leader will be asked, when the count went through an association', async () => {
    stub({ attestationState: 'PENDING' });
    render(<EnumerateScreen taxpayerId="tp-1" navigate={() => {}} />);
    await fill({ premises: 'LOCK_UP_SHOP', equipment: '3', people: '2' });
    fireEvent.click(screen.getByRole('button', { name: /Save what you saw/i }));

    await waitFor(() => expect(screen.getByText(/leader will be asked to confirm/i)).toBeTruthy());
    expect(screen.getByText(/Nothing is charged until an officer looks at it/i)).toBeTruthy();
  });

  it('does not promise a leader will be asked when nobody will', async () => {
    render(<EnumerateScreen taxpayerId="tp-1" navigate={() => {}} />);
    await fill({ premises: 'LOCK_UP_SHOP', equipment: '3', people: '2' });
    fireEvent.click(screen.getByRole('button', { name: /Save what you saw/i }));

    await waitFor(() => expect(screen.getByText(/An officer will look at this/i)).toBeTruthy());
    expect(screen.queryByText(/leader will be asked to confirm/i)).toBeNull();
  });
});
