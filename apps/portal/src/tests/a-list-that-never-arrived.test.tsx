/**
 * An empty dropdown, and no way to tell why.
 *
 * Seventeen places in this portal read reference geography and taxonomy like
 * this:
 *
 *     api.get<Lga[]>('/reference/lgas').then(setLgas).catch(() => setLgas([]));
 *
 * A 500 becomes an empty list. A dropped connection becomes an empty list. The
 * screen then carries on as though the State of Plateau had no Local
 * Government Areas in it.
 *
 * The agent PWA was swept for exactly this and has carried
 * `apps/agent/src/lib/reference.ts` since, with a `failed` flag and a doc
 * comment explaining why it matters. The portal was never swept. This holds
 * the two places where the consequence is not a degraded screen but a dead
 * one:
 *
 *   - Presumptive. The preview button is `disabled={busy || !lgaId}` and the
 *     LGA defaults to the first in the list. No list, no default, and an
 *     officer cannot work out what the trader in front of them would pay —
 *     the button is grey and the select beside it is empty.
 *
 *   - Organisation. Creating an office is `disabled={... || !form.lgaId}`,
 *     and every option in that select comes from the list. An empty one
 *     leaves the placeholder as the only choice, so a new tax office simply
 *     cannot be opened.
 *
 * In both cases the officer is left to conclude that Plateau State has no
 * LGAs, which is the one explanation that is certainly wrong.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import * as apiModule from '../lib/api';
import { PresumptiveScreen } from '../screens/Presumptive';
import { OrganisationScreen } from '../screens/Organisation';

const LGAS = [
  { id: 'lga-1', name: 'Jos North' },
  { id: 'lga-2', name: 'Wase' },
];

const SCHEDULE = {
  readiness: { lgasClassified: 2, lgasTotal: 2, entriesPublished: 4, nanoAdopted: true },
  classes: [
    {
      lgaId: 'lga-1',
      lgaName: 'Jos North',
      classCode: 'A' as const,
      indexSource: 'National Bureau of Statistics, 2024 living standards survey',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    },
  ],
  entries: [],
  nano: null,
};

/** Whether the LGA read is answered or refused. */
let lgasArrive = true;

function stubApi() {
  vi.spyOn(apiModule, 'can').mockReturnValue(true);
  vi.spyOn(apiModule.api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/reference/lgas')) {
      if (!lgasArrive) throw new Error('The connection was reset.');
      return LGAS as never;
    }
    if (path.startsWith('/government/presumptive/schedule')) return SCHEDULE as never;
    if (path.startsWith('/government/departments')) return [] as never;
    if (path.startsWith('/government/offices')) return [] as never;
    if (path.startsWith('/government/users')) return [] as never;
    return [] as never;
  });
}

beforeEach(() => {
  cleanup();
  lgasArrive = true;
  stubApi();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('working out a presumptive assessment when the LGA list did not arrive', () => {
  it('says the list could not be loaded', async () => {
    lgasArrive = false;
    render(<PresumptiveScreen />);

    await waitFor(() =>
      expect(screen.getAllByText(/This list could not be loaded/i).length).toBeGreaterThan(0),
    );
  });

  it('offers a way to ask again', async () => {
    /*
     * Without this the officer has nothing to do but reload the browser, and
     * nothing on the screen suggests that would help.
     */
    lgasArrive = false;
    render(<PresumptiveScreen />);

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /Try again/i }).length).toBeGreaterThan(0),
    );

    // And pressing it really does ask again, rather than only looking willing.
    lgasArrive = true;
    const before = vi
      .mocked(apiModule.api.get)
      .mock.calls.filter(([path]) => String(path).startsWith('/reference/lgas')).length;
    fireEvent.click(screen.getAllByRole('button', { name: /Try again/i })[0]!);

    await waitFor(() => {
      const after = vi
        .mocked(apiModule.api.get)
        .mock.calls.filter(([path]) => String(path).startsWith('/reference/lgas')).length;
      expect(after).toBeGreaterThan(before);
    });
    await waitFor(() => expect(screen.getAllByText('Jos North').length).toBeGreaterThan(0));
  });

  it('says nothing of the sort when the list arrived', async () => {
    // The control. A list that is genuinely short is a real answer and this
    // must not speak over it.
    render(<PresumptiveScreen />);

    await waitFor(() => expect(screen.getAllByText('Jos North').length).toBeGreaterThan(0));
    expect(screen.queryByText(/This list could not be loaded/i)).toBeNull();
  });
});

describe('opening a new tax office when the LGA list did not arrive', () => {
  /*
   * Both the button that opens the form and the button that submits it read
   * "Add an office", so the form is found by its heading and queried within.
   */
  async function openTheOfficeForm(): Promise<HTMLElement> {
    render(<OrganisationScreen user={{ role: 'admin' } as never} />);
    fireEvent.click((await screen.findAllByRole('button', { name: /Add an office/i }))[0]!);
    const heading = await screen.findByRole('heading', { name: /Add an office/i });
    return heading.closest('.card') as HTMLElement;
  }

  it('says the list could not be loaded rather than showing an empty one', async () => {
    lgasArrive = false;
    const form = await openTheOfficeForm();

    await waitFor(() =>
      expect(within(form).getAllByText(/This list could not be loaded/i).length).toBeGreaterThan(0),
    );
  });

  it('leaves the create button off, which is right, but says why', async () => {
    /*
     * The button staying off is correct — an office has to sit in an LGA and
     * there is none to put it in. What was wrong was doing that silently, so
     * the only available reading was that Plateau State has no LGAs.
     */
    lgasArrive = false;
    const form = await openTheOfficeForm();

    await waitFor(() =>
      expect(within(form).getAllByText(/This list could not be loaded/i).length).toBeGreaterThan(0),
    );
    const create = within(form).getByRole('button', { name: /Add an office/i });
    expect((create as HTMLButtonElement).disabled).toBe(true);
  });

  it('fills the select when the list arrived', async () => {
    // The control.
    const form = await openTheOfficeForm();

    await waitFor(() => expect(within(form).getAllByText('Jos North').length).toBeGreaterThan(0));
    expect(within(form).queryByText(/This list could not be loaded/i)).toBeNull();
  });
});
