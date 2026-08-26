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
  /*
   * Registering a taxpayer, getting them a TIN, capturing a vehicle and
   * selling a renewal. All four are the field job — an agent in a market with
   * the person in front of them — and all four became visible here only when
   * the check started matching paths segment by segment. An officer correcting
   * a record does it through `/taxpayers/:id/identity`, which is on a screen.
   */
  '/taxpayers/',
  '/taxpayers/:id/tin',
  '/vehicles/',
  '/vehicles/:id/renew',
  /*
   * Neither an officer nor an agent: the group leader answering by SMS link,
   * with no account at all. The officer's side of it — asking for the link —
   * is `/groups/:id/attestation-request`, which the Groups screen calls.
   */
  '/groups/:token/confirm',
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

/**
 * Officer endpoints that deliberately have no button, with the reason each one
 * stays. Separate from the agent-application list above because these *are*
 * officer actions — they are simply reached another way, or not at all.
 */
const OFFICER_WITHOUT_A_SCREEN = new Set([
  /*
   * An officer raising a bank-account change on an agent's behalf. The agent
   * does this themselves from the PWA, and the officer's side of it — verifying
   * the change somebody requested — is `/agents/bank-changes/:approvalId/verify`,
   * which the Agents screen calls. This exists for an agent who cannot act for
   * themselves, and it carries step-up; putting it on a screen would make an
   * officer changing where an agent's commission is paid an ordinary click.
   */
  '/agents/:agentId/bank/change',
  /*
   * Evaluating one taxpayer against one programme. The screen offers
   * `/evaluate-all`, which is the decision an officer actually makes, and a
   * single taxpayer is re-evaluated automatically whenever they check their own
   * status through the citizen page.
   */
  '/government/programmes/:id/evaluate',
  /*
   * Re-issuing a renewal document. Normally automatic on payment confirmation;
   * this is the recovery path for an interrupted session, used by the agent who
   * was serving the motorist rather than by an officer at a desk.
   */
  '/vehicles/renewals/:renewalId/document',
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

/**
 * A path, in the pieces that have to line up.
 *
 * Query string dropped, `${...}` and `:param` both reduced to a wildcard, so
 * `/vehicles/${id}/status` and `/vehicles/:vehicleId/status` are the same
 * three segments and `/vehicles/renewals/authority-outstanding` is not.
 */
function segments(path: string): string[] {
  return path
    .replace(/\?.*$/, '')
    .replace(/\$\{[^}]*\}/g, '*')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map((segment) => (segment.startsWith(':') ? '*' : segment));
}

function samePath(a: string[], b: string[]): boolean {
  return (
    a.length === b.length &&
    a.every((segment, index) => segment === '*' || b[index] === '*' || segment === b[index])
  );
}

/**
 * Every path the portal names, and whether it was only ever read.
 *
 * Two passes, because the portal reaches the API both ways. Some screens call
 * `api.post` with the path inline; others hand a path to a helper that calls
 * it later, so a rule that only understood direct calls would report a
 * hundred false positives and be useless. The `api.get(` pass exists to mark
 * the reads, which is what makes a write endpoint sharing a path with a read
 * endpoint visible rather than absorbed.
 */
function portalPaths(): { path: string[]; read: boolean }[] {
  const source = portalSource();
  const found: { path: string[]; read: boolean }[] = [];
  for (const match of source.matchAll(/api\.get(?:<[^>]*>)?\(\s*[`'"](\/[^`'"]*)/g)) {
    found.push({ path: segments(match[1]), read: true });
  }
  for (const match of source.matchAll(/[`'"](\/[a-z][a-z-]*(?:\/[^`'"\s]*)?)[`'"]/gi)) {
    found.push({ path: segments(match[1]), read: false });
  }
  return found;
}

describe('the portal can reach every officer action', () => {
  /*
   * Matched segment by segment, and a read is not a write.
   *
   * This used to ask whether the portal's source *contained* the endpoint's
   * static stem. `/vehicles/:vehicleId/status` reduced to `/vehicles/`, which
   * the portal certainly contains — it fetches `/vehicles/renewals/...` — so
   * every write endpoint sitting under a path the portal reads was reported as
   * reachable without anybody having built a way in. Two settlement endpoints
   * had to be pinned by hand below because of it, and the general case was
   * still open: a new officer endpoint under an existing path passed silently,
   * which is the one thing this file exists to prevent.
   */
  it('leaves no officer endpoint without a caller', () => {
    const paths = portalPaths();
    const orphans = writeEndpoints()
      .filter(
        (path) =>
          !AGENT_APPLICATION_ONLY.has(path) &&
          !SCHEDULED_ONLY.has(path) &&
          !OFFICER_WITHOUT_A_SCREEN.has(path),
      )
      .filter((path) => {
        const want = segments(path);
        const hits = paths.filter((candidate) => samePath(want, candidate.path));
        // Named only inside an `api.get` is a read of the same path, not a
        // caller for the write.
        return !hits.some((hit) => !hit.read);
      });

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

/**
 * The two the stem check could not see.
 *
 * The check above compares a write endpoint against the portal's source and
 * asks whether the path appears anywhere. That cannot tell a read from a
 * write, so an endpoint whose path the portal already mentions in order to
 * *read* something looks reached. `POST /government/settlements` sat behind
 * exactly that: the reconciliation screen fetched `/government/settlements`
 * for the figures, and the endpoint that records one — the entry point to the
 * whole settlement path, and the only thing that moves a day's collections to
 * SETTLED — had no caller anywhere and was never reported.
 *
 * These two are asserted on the write call rather than the path, which is what
 * the general check cannot do without flagging every endpoint whose portal
 * caller builds its URL from a template literal.
 */
describe('recording and closing a settlement', () => {
  const portal = portalSource();

  it('can be recorded from a screen', () => {
    assert.ok(
      /api\.post<[^>]*>\(\s*'\/government\/settlements'/.test(portal) ||
        portal.includes("api.post('/government/settlements'"),
      'nothing in the portal records a settlement, so nothing would ever be settled',
    );
  });

  it('can be closed from a screen once it is disputed', () => {
    assert.ok(
      portal.includes('/government/settlements/${'),
      'a disputed settlement holds its collections back, so there has to be a way to close it',
    );
  });
});
