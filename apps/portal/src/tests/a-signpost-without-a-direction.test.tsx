/**
 * Told you are in the wrong place, and left there.
 *
 * A field agent who signs into the officer portal is refused, and should be:
 * every screen here is gated on permissions an agent does not hold, so the
 * shell they would get contains one item and no way to do their job — which
 * reads as broken software rather than as the wrong door. `Login.tsx` says
 * exactly that where it ends the session.
 *
 * What it then showed them was two sentences: your account belongs to the
 * agent app, and "your sign-in worked — you are simply in the wrong place."
 * True, and all the portal could honestly say while the agent app lived on a
 * hostname it had no way to know.
 *
 * Served from one origin the agent app is at the root, one relative link
 * away, and a signpost with no direction on it is half a signpost. It is also
 * the first thing a real agent did with the combined deployment: signed in at
 * /portal/, was told they were in the wrong place, and asked where the right
 * one was.
 *
 * THE OTHER HALF IS KNOWING WHEN NOT TO POINT
 *
 * `Dockerfile.portal` still serves the portal alone on its own hostname, and
 * there the portal genuinely cannot know where the agent app is. A link to
 * `/` would be a link to itself. `agentAppUrl()` answers null unless this
 * build was made for a subpath, which happens in exactly one arrangement —
 * the combined image — and both halves are tested here.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { getTranslation } from '@psirs/shared';
import { LoginScreen } from '../screens/Login';
import { agentAppUrl, crestUrl } from '../ui';
import * as apiModule from '../lib/api';

const en = getTranslation('en');

/** A field agent's session: the sign-in succeeds, the role is wrong. */
const AGENT_SESSION = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresIn: 900,
  user: {
    id: 'u-agent',
    fullName: 'Danladi Musa',
    phone: '+2347010000001',
    email: null,
    role: 'agent',
    permissions: ['taxpayer:create'],
    agentId: 'a-1',
  },
};

async function signInAsAgent() {
  vi.spyOn(apiModule, 'login').mockResolvedValue(AGENT_SESSION as never);
  vi.spyOn(apiModule, 'logout').mockResolvedValue(undefined as never);

  render(<LoginScreen onSignedIn={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(/Phone number/i), {
    target: { value: '+2347010000001' },
  });
  fireEvent.change(screen.getByLabelText(/^Password/i), {
    target: { value: 'FieldAgent2026' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));

  // The panel is the proof the rejection happened at all.
  await waitFor(() => expect(screen.getByText(en.ofcLoginWrongPlace)).toBeTruthy());
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('an agent who signs into the officer portal', () => {
  it('is still told plainly that the sign-in worked', async () => {
    // What must not be lost: the reassurance. An agent whose password is
    // correct must not be left wondering whether it was.
    await signInAsAgent();

    expect(screen.getByText(en.ofcLoginSignInWorked)).toBeTruthy();
    expect(screen.getByText(en.ofcLoginUseAgentApp)).toBeTruthy();
  });

  it('is given the way there when both apps share an origin', async () => {
    vi.stubEnv('BASE_URL', '/portal/');
    await signInAsAgent();

    const link = screen.getByRole('link', { name: en.ofcLoginOpenAgentApp });
    expect(link.getAttribute('href')).toBe('/');
  });

  it('is given no link when the portal is on its own hostname', async () => {
    /*
     * BASE_URL is '/' here, which is what `Dockerfile.portal` and
     * `npm run dev` produce. A link to '/' would be a link back to this same
     * sign-in form, which is worse than the sentence alone.
     */
    vi.stubEnv('BASE_URL', '/');
    await signInAsAgent();

    expect(screen.queryByRole('link', { name: en.ofcLoginOpenAgentApp })).toBeNull();
  });
});

describe('where this build looks for its own crest', () => {
  /*
   * Nine screens wrote `src="/icon.svg"`. Vite rewrites absolute URLs in
   * index.html and in imported assets; a string literal in JSX is neither, so
   * `--base=/portal/` left every one of them pointing at the ROOT of the
   * origin — the AGENT's copy in the combined image. The two files are
   * byte-identical today, which is the only reason nothing looked wrong, and
   * is not a property either app promises to keep.
   */
  it('follows the base when the portal is mounted under one', () => {
    /*
     * The assertion that matters, and the one the first draft could not make.
     * Written against a module-level const it read
     * `expect(CREST_URL).toBe(`${import.meta.env.BASE_URL}icon.svg`)`, which
     * under the runner's base of `/` is `'/icon.svg'` — exactly the literal
     * being replaced. It passed against the bug.
     */
    vi.stubEnv('BASE_URL', '/portal/');

    expect(crestUrl()).toBe('/portal/icon.svg');
    expect(agentAppUrl()).toBe('/');
  });

  it('is the origin root when the portal is served from it', () => {
    vi.stubEnv('BASE_URL', '/');
    expect(crestUrl()).toBe('/icon.svg');
  });

  it('renders the crest from that URL on the sign-in screen', () => {
    render(<LoginScreen onSignedIn={vi.fn()} />);
    const crest = document.querySelector('img');
    expect(crest?.getAttribute('src')).toBe(crestUrl());
  });
});
