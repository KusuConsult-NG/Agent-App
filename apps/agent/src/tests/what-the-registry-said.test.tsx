/**
 * What an agent is told about a vehicle, at the side of a road.
 *
 * The distinction this screen exists to keep is between two answers that both
 * mean "no vehicle here": the authority could not be *asked*, and the
 * authority answered and holds no record. `lookupVehicle` says so in its own
 * comment — an agent shown the wrong one captures a registered vehicle as
 * unregistered — and the screen kept them apart in its colours and in whether
 * it offered a retry.
 *
 * Then it printed the API's English sentence underneath.
 *
 * That is the shape worth noticing here: the screen read `source` twice in
 * the three lines above the text, to choose the alert kind and to decide on
 * the retry button, and reached past it for the prose. Nothing had to be
 * added to the response to fix it.
 *
 * Five answers, not four. A vehicle found on the platform reads differently
 * depending on whether the authority has ever confirmed it, which is what
 * `authorityConfirmed` is on the response for.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { VehiclesScreen } from '../screens/More';
import { api } from '../lib/api';
import { setAppLanguage } from '../lib/i18n';

const ha = translations.ha;
const en = translations.en;

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  setAppLanguage('ha');
});

afterEach(() => {
  cleanup();
  setAppLanguage('en');
});

/** The screen looks a plate up through `api.get`. */
function registryAnswers(lookup: unknown) {
  vi.spyOn(api, 'get').mockImplementation((path: string) => {
    if (path.includes('/vehicles/lookup')) return Promise.resolve(lookup as never);
    return Promise.resolve([] as never);
  });
}

async function lookUp(plate = 'JOS123AB') {
  const field = await screen.findByPlaceholderText('JOS123AB');
  fireEvent.change(field, { target: { value: plate } });
  fireEvent.click(screen.getByRole('button', { name: ha.moreSearchVehicle }));
}

describe('the two answers that both mean “no vehicle”', () => {
  /*
   * The one that must never be mistaken for the other. Saying "not found"
   * when the authority was simply unreachable makes the agent capture the
   * vehicle manually, and the platform then holds an unverified record
   * indistinguishable from one for a genuinely unregistered vehicle.
   */
  it('says the authority could not be reached, in Hausa', async () => {
    registryAnswers({
      source: 'REGISTRY_UNAVAILABLE',
      vehicle: null,
      authorityConfirmed: false,
      message: 'The vehicle authority could not be reached, so we cannot say whether…',
    });
    render(<VehiclesScreen navigate={() => {}} />);
    await lookUp();

    await waitFor(() => expect(screen.getByText(ha.agVehRegistryUnavailable)).toBeTruthy());
    expect(screen.queryByText(ha.agVehNotFound)).toBeNull();
    expect(screen.queryByText(/could not be reached, so we cannot say/)).toBeNull();
  });

  it('says no such vehicle, when that is what the authority actually answered', async () => {
    registryAnswers({
      source: 'NOT_FOUND',
      vehicle: null,
      authorityConfirmed: false,
      message: 'No record of this vehicle was found…',
    });
    render(<VehiclesScreen navigate={() => {}} />);
    await lookUp();

    await waitFor(() => expect(screen.getByText(ha.agVehNotFound)).toBeTruthy());
    expect(screen.queryByText(ha.agVehRegistryUnavailable)).toBeNull();
  });
});

describe('a vehicle the platform already holds', () => {
  /*
   * Both of these are `source: 'PLATFORM'`. Only `authorityConfirmed` tells
   * them apart, which is why four sentences would have been one too few.
   */
  /*
   * Two tests rather than one with a `cleanup()` between the halves. Tearing
   * the tree down mid-test unmounts the screen while its other requests are
   * in flight, and React can then schedule work that outlives the file's
   * environment — an unhandled `window is not defined` that fails no
   * assertion and still makes the run exit 1.
   */
  it('says a vehicle the authority has confirmed', async () => {
    registryAnswers({
      source: 'PLATFORM',
      vehicle: { registration_number: 'JOS123AB' },
      authorityConfirmed: true,
      message: 'Vehicle found and confirmed…',
    });
    render(<VehiclesScreen navigate={() => {}} />);
    await lookUp();
    await waitFor(() => expect(screen.getByText(ha.agVehFoundConfirmed)).toBeTruthy());
    expect(screen.queryByText(ha.agVehFoundUnconfirmed)).toBeNull();
  });

  it('says a vehicle the authority has never confirmed', async () => {
    registryAnswers({
      source: 'PLATFORM',
      vehicle: { registration_number: 'JOS123AB' },
      authorityConfirmed: false,
      message: 'Vehicle found on the platform…',
    });
    render(<VehiclesScreen navigate={() => {}} />);
    await lookUp();
    await waitFor(() => expect(screen.getByText(ha.agVehFoundUnconfirmed)).toBeTruthy());
    expect(screen.queryByText(ha.agVehFoundConfirmed)).toBeNull();
  });

  it('says it in English for an agent working in English', async () => {
    setAppLanguage('en');
    registryAnswers({
      source: 'AUTHORITY',
      vehicle: { registration_number: 'JOS123AB' },
      authorityConfirmed: true,
      message: 'Vehicle found at the vehicle authority.',
    });
    render(<VehiclesScreen navigate={() => {}} />);
    const field = await screen.findByPlaceholderText('JOS123AB');
    fireEvent.change(field, { target: { value: 'JOS123AB' } });
    fireEvent.click(screen.getByRole('button', { name: en.moreSearchVehicle }));

    await waitFor(() => expect(screen.getByText(en.agVehFoundAtAuthority)).toBeTruthy());
  });

  /*
   * A source this build has not met keeps the server's words. An agent given
   * no answer is worse off than one given the answer in the wrong language.
   */
  it('keeps what the server said for a source it does not know', async () => {
    registryAnswers({
      source: 'SOMETHING_ADDED_LATER',
      vehicle: null,
      authorityConfirmed: false,
      message: 'An outcome this build of the app has never seen.',
    });
    render(<VehiclesScreen navigate={() => {}} />);
    await lookUp();

    await waitFor(() =>
      expect(screen.getByText('An outcome this build of the app has never seen.')).toBeTruthy(),
    );
  });
});

describe('the confirmations after an action', () => {
  it('has both languages, and they differ, for every one', () => {
    const keys = [
      'agVehFoundConfirmed',
      'agVehFoundUnconfirmed',
      'agVehRegistryUnavailable',
      'agVehNotFound',
      'agVehFoundAtAuthority',
      'agRefereeRequestSent',
      'agDevicePendingApproval',
      'agDeviceSuspended',
      'agDeviceActive',
      'agGroupMemberRecorded',
    ] as const;
    for (const key of keys) {
      const e = (en as unknown as Record<string, string>)[key];
      const h = (ha as unknown as Record<string, string>)[key];
      expect(typeof e, `${key} missing in en`).toBe('string');
      expect(typeof h, `${key} missing in ha`).toBe('string');
      expect(h.trim().length, `${key} empty in ha`).toBeGreaterThan(0);
      expect(e, `${key} is identical in both languages`).not.toBe(h);
    }
  });

  /*
   * The three handset answers must stay distinct. Registering a handset PSIRS
   * already holds returns the row it has, so "registered and active" is
   * exactly what a suspended handset is not.
   */
  it('keeps the three handset answers apart', () => {
    const answers = [ha.agDevicePendingApproval, ha.agDeviceSuspended, ha.agDeviceActive];
    expect(new Set(answers).size).toBe(3);
  });

  it('carries the referee’s name into the confirmation', () => {
    expect(en.agRefereeRequestSent).toContain('{{name}}');
    expect(ha.agRefereeRequestSent).toContain('{{name}}');
    expect(ha.agRefereeRequestSent.replace('{{name}}', 'Ladi Bature')).toContain('Ladi Bature');
  });
});
