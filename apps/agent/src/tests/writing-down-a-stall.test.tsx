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
import { ApiRequestError, api } from '../lib/api';
import * as drafts from '../lib/drafts';
import { bandFor } from '@psirs/shared';

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

beforeEach(async () => {
  vi.restoreAllMocks();
  // The queue is a real IndexedDB store in these tests, and it outlives a
  // render: a draft left by one case would be counted by the next.
  for (const draft of await drafts.listDrafts()) {
    await drafts.removeDraft(draft.clientReference);
  }
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

  it('works out the band on the phone, as the facts are entered', async () => {
    /*
     * "What have you written me down as" is asked while the agent is still
     * standing there, and an agent who has to say "wait for the notice" looks
     * either evasive or powerless. The phone answers it — with the same
     * function the office runs, imported from the shared package rather than
     * copied, so the two cannot drift into telling a trader different things.
     */
    render(<EnumerateScreen taxpayerId="tp-1" navigate={() => {}} />);
    await screen.findByLabelText(/Where they trade from/i);
    expect(
      screen.queryByText(/Size from what you have written/i),
      'nothing is claimed before the facts are in',
    ).toBeNull();

    await fill({ premises: 'LOCK_UP_SHOP', equipment: '3', people: '2' });
    expect(screen.getByText(/Size from what you have written/i)).toBeTruthy();
    expect(screen.getByText(/This is a Small business/i)).toBeTruthy();

    // Premises set a floor the counts cannot lower, and the phone knows it.
    fireEvent.change(screen.getByLabelText(/Where they trade from/i), {
      target: { value: 'BUILDING' },
    });
    expect(screen.getByText(/This is a Medium business/i)).toBeTruthy();
  });

  it('runs the platform’s rule, not a second copy of it', async () => {
    /*
     * Asserted against `bandFor` itself rather than against three hand-written
     * expectations. A copied rule that agreed on the cases somebody thought to
     * write down is exactly the failure this is meant to exclude.
     */
    const cases: { premises: string; equipment: string; people: string }[] = [
      { premises: 'NONE', equipment: '0', people: '0' },
      { premises: 'STALL', equipment: '3', people: '0' },
      { premises: 'KIOSK', equipment: '0', people: '5' },
      { premises: 'LOCK_UP_SHOP', equipment: '0', people: '0' },
      { premises: 'BUILDING', equipment: '0', people: '0' },
      { premises: 'STALL', equipment: '10', people: '0' },
    ];

    for (const each of cases) {
      cleanup();
      render(<EnumerateScreen taxpayerId="tp-1" navigate={() => {}} />);
      await fill(each);
      const expected = bandFor({
        premises: each.premises as never,
        equipmentCount: Number(each.equipment),
        peopleWorking: Number(each.people),
      });
      const label = expected.charAt(0) + expected.slice(1).toLowerCase();
      expect(
        screen.getByText(new RegExp(`This is a ${label} business`, 'i')),
        `${each.premises}/${each.equipment}/${each.people} should read as ${expected}`,
      ).toBeTruthy();
    }
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
      bandAtCapture: 'SMALL',
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

  it('keeps the count on the phone when there is no signal', async () => {
    /*
     * The markets worth enumerating are the ones the network is worst in. An
     * enumeration that needed a connection would be collected where coverage
     * already exists, which is exactly where the missing taxpayers are not.
     *
     * The agent does not have to know which happened before they press it:
     * one button, sent if it can be and queued if it cannot.
     */
    vi.spyOn(api, 'post').mockRejectedValue(new TypeError('Failed to fetch'));
    render(<EnumerateScreen taxpayerId="tp-1" navigate={() => {}} />);
    await fill({ premises: 'LOCK_UP_SHOP', equipment: '3', people: '2' });
    fireEvent.click(screen.getByRole('button', { name: /Save what you saw/i }));

    await waitFor(() => expect(screen.getByText(/Held on this phone/i)).toBeTruthy());

    /*
     * Read back out of the queue rather than watched going in. A spy on the
     * module's own export never sees the call `submitOrQueue` makes to it, and
     * would have passed on a screen that saved nothing at all.
     */
    const queue = await drafts.pendingDrafts();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.draftType).toBe('BUSINESS_OBSERVATION');
    expect(queue[0]!.payload).toEqual({
      taxpayerId: 'tp-1',
      premises: 'LOCK_UP_SHOP',
      equipmentCount: 3,
      peopleWorking: 2,
      economicSector: 'ARTISAN_CRAFT',
      // What the agent was shown travels with it, so the office can tell
      // whether the trader was told something else.
      bandAtCapture: 'SMALL',
    });
  });

  it('still answers the band on a count that never left the phone', async () => {
    /*
     * The whole reason the rule runs here. A trader whose stall was written
     * down in a market with no signal is owed the same answer as one written
     * down on Ahmadu Bello Way — and the office checking it again on arrival
     * is a different statement from the office being the only one who knows.
     */
    vi.spyOn(api, 'post').mockRejectedValue(new TypeError('Failed to fetch'));
    render(<EnumerateScreen taxpayerId="tp-1" navigate={() => {}} />);
    await fill({ premises: 'LOCK_UP_SHOP', equipment: '3', people: '2' });
    fireEvent.click(screen.getByRole('button', { name: /Save what you saw/i }));

    await waitFor(() => expect(screen.getByText(/Held on this phone/i)).toBeTruthy());
    expect(screen.getByText(/Size recorded/i)).toBeTruthy();
    expect(screen.getByText(/^Small$/)).toBeTruthy();
    expect(screen.getByText(/do not write it down a second time/i)).toBeTruthy();
    // Still no money on it, offline or on.
    expect(document.body.textContent).not.toMatch(/₦/);
  });

  it('does not queue a refusal the office would repeat', async () => {
    /*
     * A taxpayer who is not active, a group with no standing, a negative
     * count: those are the office answering, not the network failing.
     * Queueing one defers the same answer to a day when the trader is no
     * longer standing there and the agent cannot fix it.
     */
    const refusal = new ApiRequestError(409, {
      code: 'GROUP_HAS_NO_TAX_ROLE',
      message: 'This group has not been given a part in enumeration.',
    } as never);
    vi.spyOn(api, 'post').mockRejectedValue(refusal);
    render(<EnumerateScreen taxpayerId="tp-1" navigate={() => {}} />);
    await fill({ premises: 'LOCK_UP_SHOP', equipment: '3', people: '2' });
    fireEvent.click(screen.getByRole('button', { name: /Save what you saw/i }));

    await waitFor(() =>
      expect(screen.getByText(/has not been given a part in enumeration/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/Held on this phone/i)).toBeNull();
    expect(await drafts.pendingDrafts(), 'a refusal is not a lost connection').toEqual([]);
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
