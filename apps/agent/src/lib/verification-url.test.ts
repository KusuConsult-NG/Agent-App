/**
 * The one string in this app that cannot be corrected after it is wrong.
 *
 * It goes onto thermal paper and into a citizen's pocket. Everything else the
 * app renders can be fixed on the next load; this cannot.
 */

import { describe, expect, it, afterEach, vi } from 'vitest';

async function fresh() {
  vi.resetModules();
  return import('./verification-url');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the address printed on a receipt', () => {
  it('uses the configured public verification site', async () => {
    vi.stubEnv('VITE_VERIFICATION_BASE_URL', 'https://verify.psirs.pl.gov.ng');
    const { verificationUrlFor } = await fresh();

    expect(verificationUrlFor('XM3KN-RX6AC')).toBe(
      'https://verify.psirs.pl.gov.ng/#/verify/XM3KN-RX6AC',
    );
  });

  it('tolerates a trailing slash, because a configured value will have one', async () => {
    vi.stubEnv('VITE_VERIFICATION_BASE_URL', 'https://verify.psirs.pl.gov.ng/');
    const { verificationUrlFor } = await fresh();

    expect(verificationUrlFor('ABC12-DEF34')).toBe(
      'https://verify.psirs.pl.gov.ng/#/verify/ABC12-DEF34',
    );
  });

  it('prints no link at all rather than a localhost one', async () => {
    /*
     * The defect this exists for. A build that inherits a developer's
     * environment file would otherwise print `http://localhost:5174` on every
     * receipt handed to a citizen — an address that looks official and reaches
     * nothing. A receipt with a code and no link is one they can still act on.
     */
    vi.stubEnv('VITE_VERIFICATION_BASE_URL', 'http://localhost:5174');
    const { verificationUrlFor } = await fresh();

    expect(verificationUrlFor('XM3KN-RX6AC')).toBeNull();
  });

  it('treats 127.0.0.1 the same way', async () => {
    vi.stubEnv('VITE_VERIFICATION_BASE_URL', 'http://127.0.0.1:5174');
    const { verificationUrlFor } = await fresh();

    expect(verificationUrlFor('XM3KN-RX6AC')).toBeNull();
  });

  it('prints no link when nothing is configured', async () => {
    vi.stubEnv('VITE_VERIFICATION_BASE_URL', '');
    const { verificationUrlFor } = await fresh();

    expect(verificationUrlFor('XM3KN-RX6AC')).toBeNull();
  });

  it('prints no link when there is no code to check', async () => {
    vi.stubEnv('VITE_VERIFICATION_BASE_URL', 'https://verify.psirs.pl.gov.ng');
    const { verificationUrlFor } = await fresh();

    expect(verificationUrlFor(null)).toBeNull();
    expect(verificationUrlFor(undefined)).toBeNull();
    expect(verificationUrlFor('')).toBeNull();
  });

  it('refuses a value that is not a URL', async () => {
    // Rather than concatenating it into one and printing the result.
    vi.stubEnv('VITE_VERIFICATION_BASE_URL', 'verify.psirs.pl.gov.ng');
    const { verificationUrlFor } = await fresh();

    expect(verificationUrlFor('XM3KN-RX6AC')).toBeNull();
  });

  it('escapes the code rather than trusting it', async () => {
    vi.stubEnv('VITE_VERIFICATION_BASE_URL', 'https://verify.psirs.pl.gov.ng');
    const { verificationUrlFor } = await fresh();

    expect(verificationUrlFor('a/b c')).toBe('https://verify.psirs.pl.gov.ng/#/verify/a%2Fb%20c');
  });
});
