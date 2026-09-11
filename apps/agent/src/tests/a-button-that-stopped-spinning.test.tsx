/**
 * An agent presses Register, and the signal goes.
 *
 * The catch on this screen handled only an `ApiRequestError`. A request that
 * begins and then fails — one bar of signal in a market, which is the
 * ordinary case for this application rather than the unusual one — set no
 * error, recorded no outcome, and changed nothing: the button stopped
 * spinning and the six filled steps sat there exactly as before.
 *
 * The screen handles being OFFLINE with care. The capture stays on the phone
 * and says "saved on device, not yet sent". What it did not handle is the
 * request that starts and does not finish, and the two look identical to the
 * agent — except that one of them says so.
 *
 * The consequence is the subject of this very screen. Unable to tell whether
 * a record was created, the agent presses Register again, and duplicate
 * detection is what the whole wizard exists to get right.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { RegisterTaxpayerScreen } from '../screens/Taxpayers';
import { api } from '../lib/api';
import { setAppLanguage } from '../lib/i18n';

const ha = translations.ha as unknown as Record<string, string>;

const LGAS = [{ id: 'lga-1', name: 'Jos North', name_ha: null }];

/** Not an `ApiRequestError`: the case this screen dropped. */
const DROPPED = new Error('Failed to fetch');

beforeEach(() => {
  cleanup();
  setAppLanguage('ha');
  /*
   * The reference lists go through `useReferenceList`, which reads them with
   * the api client rather than a bare `fetch` — so this answers with a real
   * `Response` that `rawRequest` can read, not a `json()` stub.
   *
   * They are still mocked at the transport rather than through `api.get`,
   * which is the point of the hook: the LGA list is a required field on step
   * three, and a list that does not arrive stops the wizard there. Nothing
   * below gets past that step without this.
   */
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/reference/lgas') ? LGAS : [];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as never);
  vi.spyOn(api, 'get').mockResolvedValue([] as never);
});

afterEach(() => {
  setAppLanguage('en');
  vi.restoreAllMocks();
});

/**
 * Fill the wizard and press Register.
 *
 * Six steps, driven by their labels rather than their order — the steps have
 * been renumbered once already, and an index would have made this test walk
 * past the one it cares about.
 */
async function registerSomebody() {
  render(<RegisterTaxpayerScreen navigate={vi.fn()} connection="ONLINE" />);

  // Step 0: no existing TIN. The default is already "no", so continue.
  fireEvent.click(screen.getByRole('button', { name: ha.tpContinue! }));

  // Step 1: who they are. `Field` appends " *" to a required label, so these
  // are matched loosely rather than by an exact string.
  const field = (label: string) => screen.getByLabelText(label, { exact: false });
  fireEvent.change(field(ha.tpFirstName!), { target: { value: 'Ladi' } });
  fireEvent.change(field(ha.tpLastName!), { target: { value: 'Bala' } });
  fireEvent.change(field(ha.tpPhoneNumber!), { target: { value: '08030000001' } });
  fireEvent.click(screen.getByRole('button', { name: ha.tpContinue! }));

  // Step 2: identity, all optional.
  fireEvent.click(screen.getByRole('button', { name: ha.tpContinue! }));

  // Step 3: where they are. The address field shares its key with the step
  // heading, which `getByLabelText` does not look at.
  fireEvent.change(field(ha.tpStepAddress!), { target: { value: '14 Rukuba Road' } });
  await waitFor(() => expect(screen.getByText('Jos North')).toBeTruthy());
  fireEvent.change(field(ha.tpLga!), { target: { value: 'lga-1' } });
  fireEvent.click(screen.getByRole('button', { name: ha.tpContinue! }));

  // Step 4: livelihood, all optional.
  fireEvent.click(screen.getByRole('button', { name: ha.tpContinue! }));

  // Step 5: consent and declaration, both required.
  fireEvent.click(screen.getByLabelText(ha.tpConsent!, { exact: false }));
  fireEvent.click(screen.getByLabelText(ha.tpDeclaration!, { exact: false }));

  fireEvent.click(screen.getByRole('button', { name: ha.tpRegisterTaxpayer! }));
}

describe('registering a taxpayer when the connection gives out', () => {
  it('tells the agent the attempt failed', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(DROPPED);

    await registerSomebody();

    await waitFor(() => expect(screen.getByText(/Failed to fetch/)).toBeTruthy());
  });

  it('does not claim the capture was saved on the device', async () => {
    /*
     * The one wrong answer worse than silence. "Saved on device, not yet
     * sent" is a promise that the registration is safe on the handset and
     * will go when there is signal — and a request that failed mid-flight
     * saved nothing.
     */
    vi.spyOn(api, 'post').mockRejectedValue(DROPPED);

    await registerSomebody();

    await waitFor(() => expect(screen.getByText(/Failed to fetch/)).toBeTruthy());
    expect(screen.queryByText(ha.tpSavedOnDevice!)).toBeNull();
  });

  it('still says so when the server refuses with a body', async () => {
    // The control: the branch that always worked must go on working.
    const { ApiRequestError } = await import('../lib/api');
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiRequestError(
        400,
        { code: 'VALIDATION_FAILED', message: 'The phone number is not valid.', moneyStatus: 'NOT_APPLICABLE' },
        null,
      ),
    );

    await registerSomebody();

    await waitFor(() => expect(screen.getByText(/phone number is not valid/i)).toBeTruthy());
  });
});
