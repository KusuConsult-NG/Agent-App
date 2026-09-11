/**
 * The question an operator has during an outage, which had no screen.
 *
 * `integrationHealth` has existed the whole time: recording every outbound
 * call, deciding an integration is DOWN after three unanswered in a row, and
 * raising an alarm into the officer inbox when it is.
 * `/government/platform/integrations` has served it. Nothing had ever asked
 * for it — one of the reads recorded in READ_WITHOUT_A_SCREEN.
 *
 * So "is it us, or is it Remita?" could not be answered, and PSIRS learned the
 * payment gateway had stopped answering by noticing a queue had stopped
 * moving. By then agents in markets have been taking money against a gateway
 * that cannot confirm it.
 *
 * Three of the four state labels were already in the dictionary, in Hausa,
 * waiting for a screen that was never built.
 *
 * WHAT THESE PIN
 *
 * That a DOWN integration is said before the table rather than found in it;
 * that a failed read of this screen never reports "all answering", which is
 * the one sentence it must never invent; and that the explanation an operator
 * reads is composed here from the dictionary rather than taken from the
 * English the endpoint also sends.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { getTranslation, permissionsForRole } from '@psirs/shared';
import { PlatformScreen } from '../screens/Platform';
import { ApiRequestError, api } from '../lib/api';
import * as apiModule from '../lib/api';
import { setPortalLanguage } from '../lib/i18n';

const en = getTranslation('en');
const ha = getTranslation('ha');

function report(over: Partial<Record<string, unknown>> = {}) {
  return {
    name: 'gateway',
    describes: 'The payment gateway',
    provider: 'remita',
    state: 'HEALTHY',
    lastCalledAt: '2026-09-11T07:00:00.000Z',
    lastSucceededAt: '2026-09-11T07:00:00.000Z',
    lastUnavailableAt: null,
    lastError: null,
    consecutiveFailures: 0,
    callsTotal: 400,
    unavailableTotal: 0,
    // The English the endpoint also sends, which this screen must not use.
    message: 'Answering.',
    ...over,
  };
}

const ALL_WELL = {
  integrations: [report(), report({ name: 'tin', provider: 'psirs', describes: 'The PSIRS TIN service' })],
  healthy: true,
  needingAttention: 0,
};

const GATEWAY_DOWN = {
  integrations: [
    report({
      state: 'DOWN',
      consecutiveFailures: 7,
      lastSucceededAt: '2026-09-10T18:00:00.000Z',
      lastUnavailableAt: '2026-09-11T07:40:00.000Z',
      lastError: 'connect ETIMEDOUT 41.203.0.1:443',
      unavailableTotal: 7,
      message: '7 call(s) in a row could not be answered: connect ETIMEDOUT 41.203.0.1:443',
    }),
    report({ name: 'tin', provider: 'psirs' }),
  ],
  healthy: false,
  needingAttention: 1,
};

const REFUSED = new ApiRequestError(503, {
  code: 'UPSTREAM_UNAVAILABLE',
  message: 'The platform report could not be built.',
  moneyStatus: 'NOT_APPLICABLE',
});

function signIn(role: 'admin' | 'auditor') {
  apiModule.setSession(null);
  sessionStorage.setItem(
    'psirs.portal.user',
    JSON.stringify({
      id: 'u1',
      phone: '+2348000000001',
      fullName: 'Operations Dung',
      role,
      permissions: permissionsForRole(role),
    }),
  );
}

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  setPortalLanguage('en');
  signIn('admin');
});

afterEach(() => {
  cleanup();
  setPortalLanguage('en');
});

describe('an operator asking whether it is us or the gateway', () => {
  it('says which service is not answering, above the table', async () => {
    // The alarm is said before the list rather than found in it, for the same
    // reason the inbox says its critical rows first.
    vi.spyOn(api, 'get').mockResolvedValue(GATEWAY_DOWN as never);

    render(<PlatformScreen />);

    await screen.findByText(en.enumIntegrationAlert);
    expect(screen.getAllByText(new RegExp(en.ofcPlGateway)).length).toBeGreaterThan(0);
  });

  it('counts how many need attention, and says how many are answering', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(GATEWAY_DOWN as never);

    render(<PlatformScreen />);

    await screen.findByText(en.enumIntegrationAlert);
    const needing = screen.getByText(en.ofcPlNeedingAttention).closest('.stat');
    expect(needing?.querySelector('.stat__value')?.textContent).toBe('1');
    const answering = screen.getByText(en.ofcPlAllAnswering).closest('.stat');
    expect(answering?.querySelector('.stat__value')?.textContent).toBe('1');
  });

  it('shows the far end’s own words as evidence, and does not translate them', async () => {
    // A gateway's refusal is evidence. Rewriting it would be inventing it.
    vi.spyOn(api, 'get').mockResolvedValue(GATEWAY_DOWN as never);

    render(<PlatformScreen />);

    await screen.findByText('connect ETIMEDOUT 41.203.0.1:443');
  });

  it('composes the explanation itself rather than printing the server’s English', async () => {
    // The endpoint sends `message` in English. Every input to it is on the
    // row, so a Hausa reader gets the sentence in Hausa.
    setPortalLanguage('ha');
    vi.spyOn(api, 'get').mockResolvedValue(GATEWAY_DOWN as never);

    render(<PlatformScreen />);

    await screen.findByText(ha.ofcPlDownBody.replace('{{n}}', '7'));
    expect(
      screen.queryByText('7 call(s) in a row could not be answered: connect ETIMEDOUT 41.203.0.1:443'),
    ).toBeNull();
  });
});

describe('the sentence this screen must never invent', () => {
  it('does not report anything as answering when the read failed', async () => {
    // "All answering" from a request that did not come back is the single
    // most dangerous thing an outage screen could say.
    vi.spyOn(api, 'get').mockRejectedValue(REFUSED);

    render(<PlatformScreen />);

    await screen.findByText('The platform report could not be built.');
    const answering = screen.getByText(en.ofcPlAllAnswering).closest('.stat');
    expect(answering?.querySelector('.stat__value')?.textContent).toBe('—');
    const needing = screen.getByText(en.ofcPlNeedingAttention).closest('.stat');
    expect(needing?.querySelector('.stat__value')?.textContent).toBe('—');
  });

  it('offers the read again', async () => {
    let call = 0;
    vi.spyOn(api, 'get').mockImplementation(async () => {
      call += 1;
      if (call === 1) throw REFUSED;
      return GATEWAY_DOWN as never;
    });

    render(<PlatformScreen />);
    fireEvent.click(await screen.findByRole('button', { name: en.actionTryAgain }));

    await screen.findByText(en.enumIntegrationAlert);
    expect(screen.queryByText('The platform report could not be built.')).toBeNull();
  });

  it('raises no alarm when everything is answering', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(ALL_WELL as never);

    render(<PlatformScreen />);

    await waitFor(() => expect(screen.getAllByText(en.ofcPlGateway).length).toBeGreaterThan(0));
    expect(screen.queryByText(en.enumIntegrationAlert)).toBeNull();
    const needing = screen.getByText(en.ofcPlNeedingAttention).closest('.stat');
    expect(needing?.querySelector('.stat__value')?.textContent).toBe('0');
  });

  it('waits quietly while the read is in flight', async () => {
    vi.spyOn(api, 'get').mockImplementation(() => new Promise(() => {}));

    render(<PlatformScreen />);

    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeTruthy());
    expect(screen.queryByRole('button', { name: en.actionTryAgain })).toBeNull();
  });
});
