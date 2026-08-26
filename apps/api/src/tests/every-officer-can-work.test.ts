/**
 * Sign in as each officer and open everything their own menu offers.
 *
 * Two suites already hold pieces of this. `portal-navigation.test.ts` compares
 * the menu's permission against the permission on the route, reading both from
 * source; `officer-actions-reachable.test.ts` checks that every write endpoint
 * is called from somewhere in the portal. Neither one signs in.
 *
 * What neither can see is the screen. A menu item leads to a component, and
 * that component fetches whatever it fetches — often several endpoints, only
 * one of which the menu was gated on. A screen offered to a role that can load
 * three of its four panels is a screen that renders with a permission error in
 * it, and the source comparison says everything matches.
 *
 * So this walks it: for every role that can reach the portal, resolve the menu
 * to its screens, resolve each screen to the endpoints it actually calls, and
 * ask the running API for them with that officer's own token. A 403 anywhere in
 * there is a screen the platform offers and refuses.
 *
 * The auditor matters most and is the least exercised. Their entire job is
 * reading, and they hold no permission that changes anything, so a read they
 * are refused is not an inconvenience — it is the control environment failing
 * quietly. Nobody notices an auditor who cannot see something; they just do not
 * report on it.
 *
 * Only endpoints with a static path are asked for. A screen that builds its URL
 * from a record id needs that record to exist, which is a fixture question
 * rather than a permission one, and guessing at ids here would test the wrong
 * thing.
 */

import './env';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  createGovernmentUser,
  get,
  loginAs,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { seedReferenceData } from '../db/seed';
import { permissionsForRole, type Role } from '@psirs/shared';

const PORTAL = join(__dirname, '..', '..', '..', 'portal', 'src');

/** `matchRoute(route, '/path')) return <ScreenName` — the portal's dispatch. */
function routeToComponent(): Map<string, string> {
  const app = readFileSync(join(PORTAL, 'App.tsx'), 'utf8');
  const map = new Map<string, string>();
  for (const match of app.matchAll(/matchRoute\(route,\s*'([^']+)'\)\)\s*return\s*<(\w+)/g)) {
    map.set(match[1]!, match[2]!);
  }
  return map;
}

/** `import { A, B } from './screens/File'` — where each component lives. */
function componentToFile(): Map<string, string> {
  const app = readFileSync(join(PORTAL, 'App.tsx'), 'utf8');
  const map = new Map<string, string>();
  for (const match of app.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/screens\/(\w+)'/g)) {
    for (const name of match[1]!.split(',')) {
      const clean = name.trim();
      if (clean) map.set(clean, `${match[2]}.tsx`);
    }
  }
  return map;
}

/**
 * Static GETs one screen makes.
 *
 * Sliced to the component rather than read off the whole file: several screens
 * share a file — Finance.tsx holds reconciliation, commissions and approvals —
 * and reading the file would blame each of them for the others' fetches. That
 * is a false alarm of exactly the kind that gets a failing test switched off.
 *
 * Template literals are skipped. A URL built from a record id needs that record
 * to exist, which is a fixture question and not a permission one.
 */
function readsOf(file: string, component: string): { path: string; guarded: boolean }[] {
  const source = readFileSync(join(PORTAL, 'screens', file), 'utf8');
  const start = source.indexOf(`export function ${component}(`);
  if (start === -1) return [];
  const next = source.indexOf('\nexport function ', start + 1);
  const body = source.slice(start, next === -1 ? source.length : next);

  /*
   * Flags the screen sets from its own permissions, so it can decide what to
   * ask for. "Outstanding work" holds three queues and fetches each only when
   * the officer holds the permission that queue needs, so an auditor sees the
   * refunds and never asks for the other two — correct behaviour that would
   * read as a broken screen if every endpoint in the file had to answer every
   * officer offered it.
   */
  const flags = [...body.matchAll(/const\s+(\w+)\s*=\s*can\(/g)].map((match) => match[1]!);

  const reads: { path: string; guarded: boolean }[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(/api\s*\.\s*get\s*(?:<[^>]*>)?\(\s*'([^'`]+)'/g)) {
    const path = match[1]!.split('?')[0]!;
    if (seen.has(path)) continue;
    seen.add(path);
    // Guarded only if one of those flags is tested immediately above the call.
    // A screen whose main panel loads unconditionally is making a claim about
    // who may open it, and that claim is what the menu has to match.
    const preceding = body.slice(Math.max(0, match.index! - 220), match.index!);
    reads.push({ path, guarded: flags.some((flag) => new RegExp(`if\\s*\\(\\s*${flag}\\b`).test(preceding)) });
  }
  return reads;
}

/**
 * The menu, read out of the portal's source.
 *
 * Parsed rather than imported: the portal is an ES module outside this
 * package's rootDir, so importing it would not compile here. `portal-navigation
 * .test.ts` reads the same table the same way, and both spellings of the
 * permission field are handled because a pattern that matched only one of them
 * once went quiet about a whole menu item.
 */
interface MenuItem {
  path: string;
  label: string;
  permissions: string[];
}

function menu(): MenuItem[] {
  const source = readFileSync(join(PORTAL, 'lib', 'permissions.ts'), 'utf8');
  const pattern =
    /\{\s*path:\s*'([^']+)',\s*label:\s*'([^']+)',\s*permission:\s*(\[[^\]]*\]|'[^']+')\s*,?\s*\}/g;
  const items = [...source.matchAll(pattern)].map((match) => ({
    path: match[1]!,
    label: match[2]!,
    permissions: [...match[3]!.matchAll(/'([^']+)'/g)].map((entry) => entry[1]!),
  }));
  assert.ok(items.length > 15, `expected the portal menu, found ${items.length} items`);
  return items;
}

/** `requirePermission` grants on any one of the permissions it lists. */
function offeredTo(role: Role): MenuItem[] {
  const held = new Set<string>(permissionsForRole(role) as readonly string[]);
  return menu().filter((item) => item.permissions.some((permission) => held.has(permission)));
}

const ROLES = ['admin', 'revenue_officer', 'finance_officer', 'supervisor', 'auditor'] as const;
const PHONES: Record<string, string> = {
  admin: '+2348030000800',
  revenue_officer: '+2348030000801',
  finance_officer: '+2348030000802',
  supervisor: '+2348030000803',
  auditor: '+2348030000804',
};

const tokens: Record<string, string> = {};

before(async () => {
  await startTestServer();
  await resetDatabase();
  await seedReferenceData();
  for (const role of ROLES) {
    await createGovernmentUser({ role, phone: PHONES[role]!, fullName: `${role} officer` });
    tokens[role] = (await loginAs(PHONES[role]!)).accessToken;
  }
});
after(async () => {
  await stopTestServer();
});

describe('the portal a role is given', () => {
  it('resolves its menu to real screens, so a passing run means something', () => {
    const routes = routeToComponent();
    const files = componentToFile();
    assert.ok(routes.size > 15, `expected the route table, found ${routes.size} entries`);

    const known = new Set(readdirSync(join(PORTAL, 'screens')));
    for (const [path, component] of routes) {
      const file = files.get(component);
      assert.ok(file, `${path} renders <${component}> and nothing imports it from ./screens`);
      assert.ok(known.has(file), `${path} renders <${component}> from a file that is not there`);
    }
  });

  for (const role of ROLES) {
    it(`opens every screen a ${role.replace('_', ' ')} is offered`, async () => {
      const routes = routeToComponent();
      const files = componentToFile();

      const refused: string[] = [];
      const blank: string[] = [];
      for (const item of offeredTo(role)) {
        const component = routes.get(item.path);
        if (!component) continue; // '/' is the role home, rendered inline.
        const file = files.get(component);
        if (!file) continue;

        const reads = readsOf(file, component);
        if (reads.length === 0) continue;

        let loaded = 0;
        for (const read of reads) {
          const response = await get(read.path, { token: tokens[role] });
          assert.notEqual(
            response.status,
            500,
            `${item.label} -> GET ${read.path} failed: ${JSON.stringify(response.body)}`,
          );
          if (response.status === 403) {
            if (!read.guarded) refused.push(`${item.label} (${item.path}) -> GET ${read.path}`);
          } else {
            loaded += 1;
          }
        }

        if (loaded === 0) blank.push(`${item.label} (${item.path})`);
      }

      assert.deepEqual(
        refused,
        [],
        `these screens are on the ${role} menu, ask for this without checking first, ` +
          `and are refused:\n  ` + refused.join('\n  '),
      );
      assert.deepEqual(
        blank,
        [],
        `these screens are on the ${role} menu and nothing on them loads at all:\n  ` +
          blank.join('\n  '),
      );
    });
  }

  it('lets an auditor prove the audit trail has not been tampered with', async () => {
    // The one thing the role exists for. It is a GET, so it is covered above
    // as well — but only if the audit screen is on the auditor's menu, which is
    // exactly the sort of thing that changes by accident.
    const response = await get('/government/audit/verify', { token: tokens.auditor });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.valid, true, JSON.stringify(response.body));

    assert.ok(
      offeredTo('auditor').some((item) => item.path === '/audit'),
      'an auditor with no way to the audit screen cannot reach the check at all',
    );
  });
});
