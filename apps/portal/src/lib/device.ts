/**
 * A handle for this browser on this machine, sent so the platform can tell an
 * officer's two computers apart.
 *
 * The portal sent nothing, and the server's device handle was therefore a
 * function of the user agent alone -- see `fingerprintOf` in
 * `apps/api/src/services/officer-devices.ts` for what that cost. The short
 * version: a browser update produced a new "device", so blocking a laptop
 * stopped applying the next time Chrome updated itself.
 *
 * `localStorage` even though an officer's session goes to `sessionStorage` by
 * default. They are answering different questions. The session asks "should
 * closing the browser sign me out", and the portal's answer is yes. The device
 * asks "is this the same computer as last week", and an answer that forgot
 * overnight would recreate the whole defect: a new row every morning, and a
 * block that outlived nothing.
 *
 * It is not a credential and carries nothing about the officer. The server
 * treats it as a handle and never as identity -- the session is what
 * authenticates, and a handle naming somebody else's device gains nothing,
 * because rows are looked up per user.
 */

/** Distinct from the agent's `psirs.device.id`: both apps share one origin. */
const DEVICE_KEY = 'psirs.portal.device.id';

/** What the server will accept: 8 to 128 of these characters. */
const ACCEPTABLE = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * This browser's identifier, or an empty string when there is nowhere to keep
 * one.
 *
 * Empty rather than a fresh value per call, and the caller omits the header
 * entirely. A new identifier on every request would be a new device row on
 * every sign-in, which is worse than the user-agent handle it replaces --
 * private browsing, or storage blocked by policy, has to degrade to the old
 * behaviour rather than to an unbounded list of devices.
 */
export function getDeviceIdentifier(): string {
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (stored && ACCEPTABLE.test(stored)) return stored;

    const minted = `portal-${crypto.randomUUID()}`;
    localStorage.setItem(DEVICE_KEY, minted);
    return minted;
  } catch {
    return '';
  }
}
