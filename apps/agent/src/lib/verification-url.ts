/**
 * Where a citizen goes to check the document in their hand.
 *
 * This is printed onto thermal paper and handed over. Unlike everything else
 * this app renders, it cannot be corrected afterwards — the taxpayer walks away
 * with it, and if it points nowhere they have a government receipt carrying a
 * dead address.
 *
 * It was hardcoded to `http://localhost:5174`, which is the officer portal on a
 * developer's laptop. Every receipt printed from a real handset would have
 * carried it.
 *
 * `window.location.origin` is not the fix it looks like: that is the *agent
 * app's* origin, and public verification lives on the portal, which is a
 * different host in every deployment this platform has. Substituting one wrong
 * URL for another would have made the defect harder to notice rather than
 * fixing it.
 *
 * So the address is configuration, and when it is absent the URL is omitted
 * entirely. A receipt showing a verification code and no link is one a citizen
 * can still act on — the code can be typed into any PSIRS page, and the printer
 * driver renders the code beside the QR anyway. A receipt showing a link to
 * somebody's laptop is worse than one showing no link at all, because it looks
 * authoritative and goes nowhere.
 */

/** The public verification base, e.g. https://verify.psirs.pl.gov.ng */
function configuredBase(): string | null {
  const configured = import.meta.env.VITE_VERIFICATION_BASE_URL;
  if (typeof configured !== 'string') return null;

  const trimmed = configured.trim().replace(/\/+$/, '');
  if (!trimmed) return null;

  /*
   * A localhost address is treated as absent, deliberately.
   *
   * It is the value a build inherits from a developer's environment file, and
   * it is the one value that must never reach paper. Refusing it here means the
   * failure is a missing link on a receipt rather than a link to a machine no
   * citizen can reach.
   */
  try {
    const url = new URL(trimmed);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return null;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * The URL to print, or null when there is no public address to print.
 *
 * Null is a legitimate answer and callers must handle it: the receipt is
 * printed with the verification code and no link.
 */
export function verificationUrlFor(code: string | null | undefined): string | null {
  const base = configuredBase();
  if (!base || !code) return null;
  return `${base}/#/verify/${encodeURIComponent(code)}`;
}
