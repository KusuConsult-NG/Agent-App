/**
 * Every screen in the agent PWA must be reachable by tapping.
 *
 * The app defines a route for `/profile`, and nothing anywhere navigated to
 * it. That would be a dead screen and little more, except that Profile is the
 * hub: it holds the only links to `/application`, where an agent registers the
 * phone they are standing in the market with, and to `/support`, where they
 * report a payment that has not confirmed. With no way into Profile, all three
 * were unreachable.
 *
 * What made it worse is that the API sends people there by name. A new agent's
 * first collection is refused with "This device is not registered to your
 * agent account… Open Profile, then 'View my application and clearance', to
 * register it", and an unpaid agent is told "Open Profile > Bank account to
 * submit it for verification". Both instructions named a screen with no door,
 * so a new agent could not collect any revenue at all and had nothing to read
 * that would tell them why.
 *
 * Checking that each route is linked from *somewhere* would not have caught
 * this: `/application` and `/support` were linked — from Profile, which was
 * itself unreachable. So this walks the link graph from the navigation tabs
 * outward and fails on anything it cannot arrive at, which is what "reachable"
 * has to mean.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-value-that-is-long-enough-32';
process.env.IDENTITY_HASH_SECRET ??= 'test-identity-secret-value-long-enough-32';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'test-webhook-secret-value-long-enough-32';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const AGENT_SRC = join(__dirname, '..', '..', '..', '..', 'apps', 'agent', 'src');
const APP = readFileSync(join(AGENT_SRC, 'App.tsx'), 'utf8');

/** Screens reached by tapping a row in a list, not by a fixed link. */
const PARAMETERISED = /:\w+/;

/** Routes only an unauthenticated visitor sees; they have their own entry points. */
const SIGNED_OUT = new Set(['/apply']);

function sourceFiles(dir: string): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push({ path: full, source: readFileSync(full, 'utf8') });
  }
  return out;
}

/** The routes the app answers to, in declaration order. */
function declaredRoutes(): string[] {
  return [...APP.matchAll(/matchRoute\(route,\s*'([^']+)'\)/g)].map((m) => m[1]);
}

/** Component name rendered for each route, e.g. '/profile' -> 'ProfileScreen'. */
function routeComponents(): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of APP.matchAll(/matchRoute\(route,\s*'([^']+)'\)\)?\s*{?\s*\n?\s*return <(\w+)/g)) {
    map.set(m[1], m[2]);
  }
  // Parameterised routes are matched into a variable first, then rendered.
  for (const m of APP.matchAll(/const (\w+)Match = matchRoute\(route,\s*'([^']+)'\)/g)) {
    const rendered = APP.match(new RegExp(`if \\(${m[1]}Match\\)\\s*{?\\s*\\n?\\s*return <(\\w+)`));
    if (rendered) map.set(m[2], rendered[1]);
  }
  return map;
}

/** Which file each component is declared in. */
function componentFiles(): Map<string, string> {
  const map = new Map<string, string>();
  for (const file of sourceFiles(AGENT_SRC)) {
    for (const m of file.source.matchAll(/export function (\w+)/g)) map.set(m[1], file.path);
  }
  return map;
}

/**
 * Every route a file links to.
 *
 * Both spellings count, because the app uses both: a hash href — as a JSX
 * attribute or as a `href:` property in a list of quick actions — and a
 * `navigate()` call.
 */
function linksFrom(source: string): string[] {
  return [
    ...[...source.matchAll(/['"`]#(\/[^'"`\s${}]*)/g)].map((m) => m[1]),
    ...[...source.matchAll(/navigate\(\s*'([^']+)'/g)].map((m) => m[1]),
    ...[...source.matchAll(/navigate\(\s*`([^`$]+)`/g)].map((m) => m[1]),
  ];
}

describe('agent PWA screens are reachable', () => {
  it('can be tapped to from the navigation, directly or through another screen', () => {
    const routes = declaredRoutes();
    const components = routeComponents();
    const files = componentFiles();

    // Roots: the bottom navigation tabs, which are always on screen.
    const navBlock = APP.slice(APP.indexOf('const nav = useMemo'), APP.indexOf('if (restoring)'));
    const roots = [...navBlock.matchAll(/path: '([^']+)'/g)].map((m) => m[1]);
    assert.ok(roots.length >= 4, `expected navigation tabs, found ${roots.length}`);

    // Walk outward: a screen you can reach lends its links to the frontier.
    const reached = new Set(roots);
    const queue = [...roots];
    while (queue.length) {
      const route = queue.shift()!;
      const component = components.get(route);
      const file = component ? files.get(component) : undefined;
      if (!file) continue;
      for (const link of linksFrom(readFileSync(file, 'utf8'))) {
        const target = link.split('?')[0].replace(/\/$/, '') || '/';
        if (!reached.has(target)) {
          reached.add(target);
          queue.push(target);
        }
      }
    }

    const unreachable = routes.filter(
      (r) => !PARAMETERISED.test(r) && !SIGNED_OUT.has(r) && !reached.has(r),
    );

    assert.deepEqual(
      unreachable,
      [],
      `these screens exist but nothing navigates to them: ${unreachable.join(', ')}`,
    );
  });

  it('offers a way to the screen the API tells agents to open', () => {
    // Two API messages name Profile as the next step: the device that is not
    // registered, and the bank account that has not been submitted. Neither is
    // any use if Profile cannot be opened, so this pins the door itself rather
    // than relying on the walk above to keep covering it.
    const navBlock = APP.slice(APP.indexOf('const nav = useMemo'), APP.indexOf('if (restoring)'));
    assert.match(
      navBlock,
      /path: '\/profile'/,
      'Profile must be in the navigation: the API sends agents there by name to ' +
        'register a device before collecting and to submit a bank account to be paid',
    );
  });
});
