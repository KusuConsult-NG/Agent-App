/**
 * Step-up authentication for the agent app (PRD §35).
 *
 * The API guards the payout request with `requireStepUp`, and the agent app
 * had no way to satisfy it. The button existed, the hint under it said "A
 * one-time code is required to request a payout", and there was nowhere to
 * enter one — so the request answered 403 STEP_UP_REQUIRED and the agent had
 * no path forward. The portal has had a `stepUp()` helper all along; the PWA
 * never got one, which left the last step of the commission pipeline
 * unreachable in the only application an agent uses.
 *
 * Two differences from the portal's version, both because of who is holding
 * the phone:
 *
 *   * No `window.prompt`. It is unstyled, it cannot explain what is being
 *     authorised, and on a handset it is a system dialogue over a page the
 *     agent can no longer read. The code is entered in the page, next to the
 *     amount it authorises.
 *
 *   * The grant is requested for one action and spent on one action. That is
 *     the API's rule already — a grant is consumed by the request that uses
 *     it — and the UI is built to match rather than to hold a code around.
 */

import { api, getUser } from './api';

/** How long the code is good for, as the server reported it. */
export interface CodeRequest {
  expiresInSeconds: number;
  /**
   * Present only while a mock SMS provider is configured; `config.ts` refuses
   * to boot in production with one. It is shown to the agent rather than
   * filled in silently, so a development build never looks like it authorised
   * something on its own.
   */
  developmentCode?: string;
}

/** The number the code is sent to: the agent's own, never one typed in. */
export function stepUpDestination(): string | null {
  return getUser()?.phone ?? null;
}

export async function requestStepUpCode(): Promise<CodeRequest> {
  const destination = stepUpDestination();
  if (!destination) throw new Error('Sign in again to request a code.');

  const result = await api.post<{ expiresInSeconds: number; developmentCode?: string }>(
    '/auth/otp/request',
    { destination, purpose: 'STEP_UP' },
  );
  return {
    expiresInSeconds: result.expiresInSeconds,
    ...(result.developmentCode ? { developmentCode: result.developmentCode } : {}),
  };
}

/**
 * Exchange the code for a grant.
 *
 * Throws whatever the API said — "that code has expired", "too many incorrect
 * attempts" — so the caller shows the server's own words rather than a generic
 * failure. The agent needs to know which of those it was: one means try again,
 * the other means request a new code.
 */
export async function grantStepUp(action: string, code: string): Promise<void> {
  const destination = stepUpDestination();
  if (!destination) throw new Error('Sign in again to request a code.');

  await api.post('/auth/step-up', { action, destination, code });
}
