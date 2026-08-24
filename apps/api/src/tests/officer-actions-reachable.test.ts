/**
 * Every officer action the API can perform, reachable from a screen.
 *
 * An audit of the portal against the API found 74 write endpoints and 29 with
 * no caller anywhere in the portal. Twenty-four of those were correctly absent
 * — they belong to the agent application, and a government officer has no
 * business initiating a payment or syncing an offline draft.
 *
 * Five were officer functions that existed in the API and could not be reached
 * by anybody: running a fraud sweep, creating a distribution round, opening or
 * closing one, listing its awards, and regenerating an invoice document. A
 * distribution round could be created only by a request nobody could make from
 * a screen, which in practice meant none could be created at all.
 *
 * This holds the property rather than the fix: an officer endpoint with no
 * caller fails here, so the next one added has to be given a way in.
 */

import './env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROUTES = 'src/routes';
const PORTAL = '../portal/src';

/**
 * Endpoints that belong to the agent application, not the officer portal.
 *
 * Listed rather than pattern-matched: "anything under /agents/me" is a rule
 * that would silently absorb a new officer endpoint that happened to sit
 * there. Each of these is a deliberate statement that a government officer
 * does not do this.
 */
const AGENT_APPLICATION_ONLY = new Set([
  '/agents/apply',
  '/agents/me/agreement',
  '/agents/me/bank/change',
  '/agents/me/bank/verify',
  '/agents/me/commission/payout',
  '/agents/me/devices',
  '/agents/me/kyc',
  '/agents/me/kyc/documents',
  '/agents/me/referees',
  '/agents/me/training/:moduleCode',
  '/groups/collections',
  /*
   * Handing over the goods at the collection point. Guarded by
   * `requireActiveAgent()` as well as the permission — the route's own comment
   * calls it the strongest case for device binding, because an agent whose
   * handset was revoked for mishandling a distribution must not be able to
   * carry on from a laptop. An officer portal could not satisfy that guard and
   * should not try.
   */
  '/allocations/collections',
  '/payments/:paymentId/confirm',
  '/payments/initiate',
  '/payments/payments',
  '/payments/simulate',
  '/revenue/assessments',
  '/revenue/quote',
  '/taxpayers/duplicate-check',
  '/taxpayers/sync',
  '/government/tickets',
  '/government/tickets/:id/messages',
  '/government/tickets/:id/update',
]);

/** Run by a scheduler rather than by a person. */
const SCHEDULED_ONLY = new Set(['/usage/expire']);

function readAll(dir: string): string {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
}

function portalSource(): string {
  return [PORTAL, join(PORTAL, 'screens'), join(PORTAL, 'lib'), join(PORTAL, 'tests')]
    .map(readAll)
    .join('\n');
}

const PREFIX: Record<string, string> = {
  'government.ts': '/government',
  'agents.ts': '/agents',
  'revenue.ts': '/revenue',
  'taxpayers.ts': '/taxpayers',
  'payments.ts': '/payments',
  'groups.ts': '',
  'vehicles.ts': '/vehicles',
  'usage.ts': '/usage',
};

/** Every POST/PATCH/PUT/DELETE the API exposes, with its mounted path. */
function writeEndpoints(): string[] {
  const found: string[] = [];
  for (const file of readdirSync(ROUTES).filter((f) => f.endsWith('.ts'))) {
    const prefix = PREFIX[file];
    if (prefix === undefined) continue;
    const src = readFileSync(join(ROUTES, file), 'utf8');
    for (const match of src.matchAll(/(\w*Router)\.(post|patch|put|delete)\(\s*\n?\s*'([^']+)'/g)) {
      // groups.ts mounts two routers at different paths.
      const mount =
        file === 'groups.ts'
          ? match[1] === 'allocationRouter'
            ? '/allocations'
            : '/groups'
          : prefix;
      found.push(mount + match[3]);
    }
  }
  return [...new Set(found)];
}

describe('the portal can reach every officer action', () => {
  it('leaves no officer endpoint without a caller', () => {
    const portal = portalSource();
    const orphans = writeEndpoints()
      .filter((path) => !AGENT_APPLICATION_ONLY.has(path) && !SCHEDULED_ONLY.has(path))
      // Compare on the static stem: the portal builds these with template
      // literals, so `/agents/${id}/review` contains `/agents/`.
      .filter((path) => !portal.includes(path.split('/:')[0]!));

    assert.deepEqual(
      orphans,
      [],
      'these officer endpoints exist and no screen calls them — give them a way in, ' +
        'or record why an officer never performs them:\n  ' + orphans.join('\n  '),
    );
  });

  it('keeps the agent application’s endpoints out of the officer portal', () => {
    // The other direction. An officer portal that could initiate a payment or
    // sync an offline draft would be doing an agent's job with an officer's
    // permissions.
    const portal = portalSource();
    const leaked = [...AGENT_APPLICATION_ONLY].filter(
      (path) =>
        // /government/tickets is the officer's view of the same desk, reached
        // through /support — the exclusion here is about the write path.
        !path.startsWith('/government/') && portal.includes(`'${path}'`),
    );
    assert.deepEqual(leaked, []);
  });
});

describe('the five that had no way in', () => {
  const portal = portalSource();

  for (const [what, endpoint] of [
    ['run a fraud sweep', '/government/fraud/sweep'],
    ['create a distribution round', '/allocations/rounds'],
    ['open or close a round', '/allocations/rounds/'],
    ['see who was awarded', '/allocations/rounds/'],
    ['regenerate an invoice document', '/revenue/invoices/'],
  ] as const) {
    it(`can ${what}`, () => {
      assert.ok(portal.includes(endpoint), `${endpoint} is still unreachable`);
    });
  }
});
