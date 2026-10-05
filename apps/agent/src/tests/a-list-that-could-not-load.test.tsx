/**
 * Two lists in the field app that answered "none" when they meant "unknown".
 *
 * The officer portal learned this everywhere. Every screen there that reads a
 * list pairs an empty one with a failure flag — `territoriesFailed`,
 * `optionsFailed`, `roundsError` — because an empty list renders a sentence,
 * and a failed read must not be able to say it. Two screens in the agent
 * application still caught a failure with `setX([])`.
 *
 * ENUMERATION
 *
 * An empty association list renders "No association to record this through
 * — None of your groups has been given a part in enumeration yet. Record it
 * anyway — an officer can ask the leader later." So a dropped connection at a
 * market stall, which is the case this screen queues captures for, told the
 * agent no association had standing and told them to record the count
 * without one. Recording through the association is the check that lets its
 * leader confirm or contradict the count. The sector list on the same screen
 * already said when it could not load.
 *
 * VEHICLE RENEWAL
 *
 * An empty renewal-service list left the required menu holding only its
 * placeholder, with nothing said. The agent could not complete the renewal
 * and could not tell a menu that failed to load from a service the platform
 * does not offer. The collection screen reads the same catalogue and says
 * when it cannot.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { EnumerateScreen } from '../screens/Enumerate';
import { VehiclesScreen } from '../screens/More';
import { api } from '../lib/api';
import * as drafts from '../lib/drafts';
import { setAppLanguage } from '../lib/i18n';

const en = translations.en;

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

const STANDING = { id: 'grp-1', name: 'Rukuba Road Traders Association', tax_role: 'ATTESTATION' };

beforeEach(async () => {
  vi.restoreAllMocks();
  setAppLanguage('en');
  for (const draft of await drafts.listDrafts()) {
    await drafts.removeDraft(draft.clientReference);
  }
  /*
   * The sector list arrives through `fetch`, not `api.get` — and `request()`
   * reads the body with `text()`, not `json()`.
   *
   * The stub this was copied from offers only `json()`, so in that file the
   * sector list fails on every run; it never asserts on sectors, so nothing
   * noticed. Here it showed up at once, as two "could not be loaded" messages
   * on a screen meant to have one.
   */
  const SECTORS = [{ code: 'ARTISAN_CRAFT', label: 'Craft and trade work' }];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => SECTORS,
      text: async () => JSON.stringify(SECTORS),
    })),
  );
});

afterEach(() => {
  cleanup();
  setAppLanguage('en');
});

describe('the association list on the enumeration screen', () => {
  it('says it could not load, rather than that no association has standing', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/groups')) throw new Error('network');
      return TAXPAYER as never;
    });
    render(<EnumerateScreen taxpayerId="tp-1" navigate={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(en.tpListCouldNotLoad)).toBeTruthy();
    });
    expect(
      screen.queryByText(en.agEnNoGroupsTitle),
      'a failed read told the agent no association had standing',
    ).toBeNull();
    expect(screen.queryByText(en.agEnNoGroups)).toBeNull();
  });

  it('offers the list again once the connection is back', async () => {
    let attempts = 0;
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/groups')) {
        attempts += 1;
        if (attempts === 1) throw new Error('network');
        return { groups: [STANDING] } as never;
      }
      return TAXPAYER as never;
    });
    render(<EnumerateScreen taxpayerId="tp-1" navigate={() => {}} />);

    const retry = await screen.findByRole('button', { name: en.actionTryAgain });
    fireEvent.click(retry);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: STANDING.name })).toBeTruthy();
    });
    expect(screen.queryByText(en.tpListCouldNotLoad)).toBeNull();
  });

  it('still says there is none when there genuinely is none', async () => {
    // The bound. Every group here has no part in enumeration, so the empty
    // answer is the true one and must still be given.
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/groups')) {
        return { groups: [{ id: 'grp-2', name: 'Vom Farmers Cooperative', tax_role: 'NONE' }] } as never;
      }
      return TAXPAYER as never;
    });
    render(<EnumerateScreen taxpayerId="tp-1" navigate={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(en.agEnNoGroupsTitle)).toBeTruthy();
    });
    expect(screen.queryByText(en.tpListCouldNotLoad)).toBeNull();
  });
});

describe('the renewal-service menu on the vehicle screen', () => {
  const FOUND = {
    source: 'PLATFORM',
    authorityConfirmed: true,
    message: 'Found.',
    vehicle: {
      id: 'veh-1',
      registration_number: 'JOS123AB',
      owner_name: 'Danladi Musa',
      vehicle_type: 'PRIVATE',
      current_expiry_date: '2026-12-31',
    },
  };

  async function lookUp() {
    const field = await screen.findByPlaceholderText('JOS123AB');
    fireEvent.change(field, { target: { value: 'JOS123AB' } });
    fireEvent.click(screen.getByRole('button', { name: en.moreSearchVehicle }));
  }

  it('says the services could not load, rather than offering an empty menu', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.includes('/revenue/items')) throw new Error('network');
      if (path.includes('/vehicles/lookup')) return FOUND as never;
      return [] as never;
    });
    render(<VehiclesScreen navigate={() => {}} />);
    await lookUp();

    await waitFor(() => {
      expect(screen.getByRole('option', { name: en.tpListCouldNotLoad })).toBeTruthy();
    });
    expect(screen.queryByRole('option', { name: en.moreSelectRenewalType })).toBeNull();
    expect(screen.getByRole('button', { name: en.actionTryAgain })).toBeTruthy();
  });

  it('fills the menu when the services load', async () => {
    // The bound. A menu that always said it could not load would pass the
    // case above.
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.includes('/revenue/items')) {
        return [{ id: 'ri-1', name: 'Vehicle licence renewal', name_ha: null, code: 'VEH-LIC' }] as never;
      }
      if (path.includes('/vehicles/lookup')) return FOUND as never;
      return [] as never;
    });
    render(<VehiclesScreen navigate={() => {}} />);
    await lookUp();

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Vehicle licence renewal' })).toBeTruthy();
    });
    expect(screen.getByRole('option', { name: en.moreSelectRenewalType })).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.actionTryAgain })).toBeNull();
  });
});
