/**
 * Told you are in the wrong place, and left there.
 *
 * A field agent who signed into the officer portal was refused: the sign-in
 * succeeded, the session was ended again, and they were shown two sentences —
 * your account belongs to the agent app, and "your sign-in worked — you are
 * simply in the wrong place."
 *
 * The reason was honest. Every screen here is gated on permissions an agent
 * does not hold, so the shell they would have got held the revenue catalogue
 * and the presumptive schedule and nothing else, which reads as broken
 * software rather than as the wrong door.
 *
 * It was still the wrong trade. Refusing a valid sign-in to spare somebody an
 * awkward menu costs them the sign-in; arranging the menu costs a screen. And
 * the refusal protected nothing — `Login.tsx` said so where it ended the
 * session: every screen behind it is permission-gated on the API regardless
 * of which application the request came from.
 *
 * So the door is open, `NAV_BY_ROLE.agent` is the menu, and `/field-work` is
 * the screen that makes its other two items make sense. What that screen must
 * not lose is the one thing the refusal got right: telling an agent where
 * their tools actually are.
 *
 * KNOWING WHERE TO POINT, AND KNOWING WHEN NOT TO
 *
 * `agentAppUrl()` used to answer only from the base path, which is `/portal/`
 * in exactly one arrangement — the combined image — and `/` everywhere else.
 * `Dockerfile.portal` serves the portal alone on its own hostname, and most
 * deployments are that one, so most deployments got the signpost with no
 * direction on it. `VITE_AGENT_APP_URL` is how such a build is told. With
 * neither, there is still nothing to point at: under a base of `/` a link to
 * `/` is a link back to this same page. All three cases are tested here.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { getTranslation } from '@psirs/shared';
import { LoginScreen } from '../screens/Login';
import { FieldWorkScreen } from '../screens/FieldWork';
import { agentAppUrl, crestUrl } from '../ui';
import * as apiModule from '../lib/api';

const en = getTranslation('en');

/** A field agent's session: the sign-in succeeds, the role is not an officer's. */
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

async function signInAsAgent(onSignedIn: (user: unknown) => void) {
  vi.spyOn(apiModule, 'login').mockResolvedValue(AGENT_SESSION as never);
  const logout = vi.spyOn(apiModule, 'logout').mockResolvedValue(undefined as never);

  render(<LoginScreen onSignedIn={onSignedIn as never} />);
  fireEvent.change(screen.getByLabelText(/Phone number/i), {
    target: { value: '+2347010000001' },
  });
  fireEvent.change(screen.getByLabelText(/^Password/i), {
    target: { value: 'FieldAgent2026' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));
  return logout;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('an agent who signs into the officer portal', () => {
  it('is signed in, not turned around at the door', async () => {
    const onSignedIn = vi.fn();
    const logout = await signInAsAgent(onSignedIn);

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(onSignedIn.mock.calls[0]![0]).toMatchObject({ role: 'agent' });
    // The session they just established is theirs to keep.
    expect(logout).not.toHaveBeenCalled();
  });

  it('is not shown the old refusal anywhere on the sign-in screen', async () => {
    const onSignedIn = vi.fn();
    await signInAsAgent(onSignedIn);
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());

    expect(screen.queryByText(en.ofcLoginWrongPlace)).toBeNull();
    expect(screen.queryByText(en.ofcLoginSignInWorked)).toBeNull();
  });
});

describe('the screen an agent lands on', () => {
  it('says where their collection tools actually are', () => {
    render(<FieldWorkScreen />);

    expect(screen.getByText(en.ofcFieldWorkTitle)).toBeTruthy();
    // The one thing the refusal got right, and the thing this must not lose.
    expect(screen.getByText(en.ofcFieldWorkToolsBody)).toBeTruthy();
  });

  it('names what the portal does hold for them, so the menu makes sense', () => {
    render(<FieldWorkScreen />);
    expect(screen.getByText(en.ofcFieldWorkHereBody)).toBeTruthy();
  });

  it('links to the agent app when both are served from one origin', () => {
    vi.stubEnv('BASE_URL', '/portal/');
    render(<FieldWorkScreen />);

    const link = screen.getByRole('link', { name: en.ofcLoginOpenAgentApp });
    expect(link.getAttribute('href')).toBe('/');
  });

  it('links to the agent app wherever the build was told it is', () => {
    /*
     * The case the inference could never cover, and the one most deployments
     * are in: `Dockerfile.portal` on its own hostname. A build that is told
     * the address can point at it; before this it could not.
     */
    vi.stubEnv('BASE_URL', '/');
    vi.stubEnv('VITE_AGENT_APP_URL', 'https://agent.psirs.pl.gov.ng/');
    render(<FieldWorkScreen />);

    const link = screen.getByRole('link', { name: en.ofcLoginOpenAgentApp });
    expect(link.getAttribute('href')).toBe('https://agent.psirs.pl.gov.ng/');
  });

  it('says who to ask when this build has no way to know', () => {
    // A link to '/' under a base of '/' is a link back to this same page.
    vi.stubEnv('BASE_URL', '/');
    render(<FieldWorkScreen />);

    expect(screen.queryByRole('link', { name: en.ofcLoginOpenAgentApp })).toBeNull();
    expect(screen.getByText(en.ofcFieldWorkNoLink)).toBeTruthy();
  });
});

describe('where the agent app is, as a function', () => {
  it('prefers what the build was told over what it can infer', () => {
    // Both available: the explicit address wins, because a combined image
    // that names an external agent app means it.
    vi.stubEnv('BASE_URL', '/portal/');
    vi.stubEnv('VITE_AGENT_APP_URL', 'https://agent.example/');
    expect(agentAppUrl()).toBe('https://agent.example/');
  });

  it('ignores a variable that is set but blank', () => {
    // An unset variable and one set to '' arrive the same way through a
    // Docker build arg; neither is an address.
    vi.stubEnv('BASE_URL', '/');
    vi.stubEnv('VITE_AGENT_APP_URL', '   ');
    expect(agentAppUrl()).toBeNull();
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
