/**
 * Links the platform hands to the public.
 *
 * These are the two places where someone outside government is asked to follow
 * a URL: the code printed and QR-encoded on every receipt and certificate, and
 * the invitation sent to a referee who by design has no account. Both were
 * built by joining strings onto a configured base, and both produced a URL the
 * portal cannot route.
 *
 * The portal is a hash router — deliberately, so a static host serves every
 * route from one file with no rewrite rules (see apps/portal/src/router.tsx).
 * It reads `window.location.hash`, so `/verify/ABC` leaves the hash empty, the
 * route resolves to `/`, and the visitor lands on the government sign-in page.
 * A citizen scanning the QR on their receipt was shown a staff login form; a
 * referee following their invitation was asked for a password they cannot have.
 * Neither failure looks like an error — the portal renders perfectly, just the
 * wrong screen — so nothing surfaced it until someone followed a link.
 *
 * Building both URLs here means the hash cannot be forgotten in one place and
 * remembered in another, and `verifyPath`/`refereePath` are exported so a test
 * can check them against the routes the portal actually declares.
 */

import { config } from '../config';

export const verifyPath = 'verify';
export const refereePath = 'referee';

/**
 * The portal origin, however VERIFICATION_BASE_URL happens to be written.
 *
 * The setting has always been documented with `/verify` on the end, and the
 * referee link used to strip it back off with a `.replace()`. Both spellings
 * are accepted so an existing deployment's configuration keeps working.
 */
function portalOrigin(): string {
  return config.branding.verificationBaseUrl
    .replace(/#.*$/, '')
    .replace(/\/+$/, '')
    .replace(new RegExp(`/${verifyPath}$`), '')
    .replace(/\/+$/, '');
}

/** Where a receipt or certificate says it can be checked. */
export function verificationUrl(verificationCode: string): string {
  return `${portalOrigin()}/#/${verifyPath}/${encodeURIComponent(verificationCode)}`;
}

/** The one-time link a referee is sent. */
export function refereeInvitationUrl(token: string): string {
  return `${portalOrigin()}/#/${refereePath}/${encodeURIComponent(token)}`;
}
