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

/**
 * Comments out, before anything is matched for a path.
 *
 * This check decides a read has a caller by finding its path quoted in the
 * client source. Backticks are in that character class and whole files were
 * being scanned, so a path named in a screen's HEADER COMMENT satisfied it
 * exactly as well as a call did — and every screen here documents the
 * endpoint it reads in its header, by house style.
 *
 * Proved by pointing a screen's fetch at a path that does not exist: the
 * check still passed, on the strength of the comment three lines above it.
 * The claim being made was "this path is mentioned somewhere", not "this
 * path has a caller", which is not the claim this file is for — it is the
 * one thing standing between the codebase and another endpoint finished,
 * seeded, tested and never called.
 *
 * Measured before changing it: with comments stripped AND the recorded list
 * switched off entirely, every read that came back was already on that list.
 * Nothing was reachable only through a comment, so this tightens the check
 * without moving a single endpoint into it.
 *
 * `(^|[^:])` keeps `https://` out of the line-comment rule, so a URL in a
 * string is not truncated at the slashes.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function readAll(dir: string): string {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .map((f) => stripComments(readFileSync(join(dir, f), 'utf8')))
    .join('\n');
}

/**
 * Screens and libraries, not tests.
 *
 * A test is not a caller. An endpoint reached only from
 * `expect(post).toHaveBeenCalledWith('/government/...')` is an endpoint no
 * officer can reach, and this check exists to say so — the agent half of
 * `anyClientSource` has always excluded its tests, and the portal half
 * including them looks like the slip rather than the intention.
 *
 * Measured before changing it, the same way as the comment strip above: with
 * the portal's tests dropped AND the recorded list switched off, the reads
 * that came back were the same seventeen, every one already recorded. So
 * nothing in this codebase is reachable only through a test, and this closes
 * the hole without moving anything into the list.
 */
function portalSource(): string {
  return [PORTAL, join(PORTAL, 'screens'), join(PORTAL, 'lib')]
    .map(readAll)
    .join('\n');
}

/**
 * Both clients, for the read check only.
 *
 * A write is asked about one application at a time — an officer must not be
 * able to initiate a payment, and that separation is the point of the check
 * above. A read is different: `/taxpayers/sectors` and `/payments/lookup` are
 * facts the agent application asks for and the portal never does, and neither
 * is unreachable. Asking "does anybody fetch this" of one client alone
 * reported twenty of them as orphaned.
 */
const AGENT = '../agent/src';

function anyClientSource(): string {
  return [
    portalSource(),
    ...[AGENT, join(AGENT, 'screens'), join(AGENT, 'lib'), join(AGENT, 'components')].map(readAll),
  ].join('\n');
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
    /*
     * A segment is its literal part. `analytics${params}` blanks to
     * `analytics*`, which is the same segment as `analytics` followed by a
     * query string — the trailing wildcard is the interpolation, not part of
     * the name, and leaving it on meant the segment never compared equal.
     */
    .map((segment) => (segment.startsWith(':') ? '*' : segment.replace(/\*+$/, '')))
    .map((segment) => (segment === '' ? '*' : segment));
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
  /*
   * Interpolations blanked before anything is matched.
   *
   * Both patterns below stop at whitespace, and a real path carries
   * interpolations with spaces inside them —
   * `/government/periods/figures?periodStart=${period.period_start.slice(0, 10)}`
   * has a space in `slice(0, 10)`, so the match ended mid-expression and the
   * closing quote never arrived. Every path built that way looked absent.
   *
   * That is why this file needed two hand-pinned settlement tests and a list
   * of endpoints "without a screen": some of them had a screen, and this
   * could not see it. `*` stands in for the value, which is what `segments`
   * reduces an interpolation to anyway.
   */
  const source = portalSource().replace(/\$\{[^}]*\}/g, '*');
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

/**
 * And the reads, which this file did not look at until three were found.
 *
 * The check above matches `post|patch|put|delete`. That was a deliberate
 * scope — a write nobody can make is a feature that does not exist — and it
 * left the other half open: a *read* nobody can make is a fact nobody can
 * learn, and three of those were found in one afternoon by rendering screens.
 *
 *   * `GET /government/audit/reports/:id` returns `checksumMatches`, which is
 *     how an auditor learns a signed report's stored figures were altered.
 *     The screen read the list instead, which repeats the checksum recorded
 *     at generation — the one value tampering does not disturb.
 *
 *   * `GET /allocations/rounds/:id` adds collected against awarded, the
 *     reconciliation its own comment calls "the one that matters".
 *
 *   * `GET /government/users/:id/sessions` is how an administrator sees
 *     somebody else's machines. Without it the only laptop they could block
 *     was the one they were sitting at.
 *
 * All three were built, permissioned, documented in `API.md`, and reachable
 * by nobody. Nothing else was going to catch that: the API tests prove the
 * endpoint works, and the type checker sees no dangling reference because
 * there is no reference.
 */
function readEndpoints(): string[] {
  const found: string[] = [];
  for (const file of readdirSync(ROUTES).filter((f) => f.endsWith('.ts'))) {
    const prefix = PREFIX[file];
    if (prefix === undefined) continue;
    const src = readFileSync(join(ROUTES, file), 'utf8');
    for (const match of src.matchAll(/(\w*Router)\.get\(\s*\n?\s*'([^']+)'/g)) {
      const mount =
        file === 'groups.ts'
          ? match[1] === 'allocationRouter'
            ? '/allocations'
            : '/groups'
          : prefix;
      found.push(mount + (match[2] === '/' ? '' : match[2]));
    }
  }
  return [...new Set(found)];
}

/**
 * Reads an officer never performs, each for a stated reason.
 *
 * Deliberately not pattern-matched. "Anything under /agents/me" would quietly
 * absorb the next officer endpoint that happened to sit there, which is how
 * the three above survived.
 */
const READ_WITHOUT_A_SCREEN = new Set([
  // The agent application's own reads. An officer does not have an
  // application, a training record, or a commission of their own.
  '/agents/me',
  '/agents/me/application',
  '/agents/me/bank/change',
  '/agents/me/commission',
  '/agents/me/home',
  '/agents/me/kyc/documents',
  '/agents/me/kyc/documents/:id',
  '/agents/me/training',
  '/agents/me/transactions',
  '/agents/performance',
  // Answered to a citizen or a referee with no account at all, from the
  // public screens rather than the officer portal.
  '/citizen/status',
  '/citizen/statement',
  '/citizen/verify/:code',
  // Read by the service worker and the agent shell, not by a person.
  '/push/vapid-key',
  '/auth/me',
  // A file stream, reached by a link the browser follows rather than by
  // `api.get` — the document itself, not a description of it.
  '/government/cases/evidence/:id/file',
  '/agents/kyc/documents/:id/file',
  '/payments/:id/download',

  /*
   * ---------------------------------------------------------------------
   * Reads with no caller today. Not excused — recorded.
   * ---------------------------------------------------------------------
   *
   * Each was verified by hand against both clients. They are listed so this
   * check can pass and the *next* unreachable read fails, rather than being
   * absorbed into a backlog nothing names. Three others found the same way
   * have already been given callers or their own task.
   *
   * `/government/platform/integrations` was the first of these and now has a
   * screen: `/platform`, offered to administrators and auditors, which is why
   * it is no longer in the list below. An outage used to be discovered from a
   * queue that had stopped moving rather than from anywhere that said so.
   *
   * The consequential ones remaining, in the order I would fix them:
   *
   *   `/government/users/:id/activity` — what an officer did. The audit log
   *     exists and is searchable; this is the per-officer view of it, and an
   *     administrator investigating somebody has no way to open it.
   *
   *   `/government/audit/reports/:id` — the recomputed checksum. The list now
   *     carries `checksumMatches` per row, so the fact reaches an auditor;
   *     this endpoint additionally returns the payload and the recomputed
   *     value, which is what a reviewer needs to see *what* changed.
   *
   *   `/taxpayers/:id/incentives` — what a citizen is entitled to. Programmes
   *     grant entitlement and nothing shows a taxpayer their own.
   *
   * The rest are quieter: a support ticket's detail, an assessment or invoice
   * by id, a payment lookup, the MDA list, a transfer history, commission by
   * place, and a KYC access log the screen mentions only in a comment.
   */
  '/government/intelligence/taxpayers/:id/access-log',
  '/government/commissions/by-place',
  '/government/transfers',
  '/government/audit/reports/:id',
  '/government/users/:id/activity',
  '/government/tickets/:id',
  '/payments',
  '/payments/lookup',
  '/revenue/authorities',
  '/revenue/assessments/:id',
  '/revenue/invoices/:id',
  '/revenue/taxpayers/:id/obligations',
  '/taxpayers/:id/incentives',
]);

describe('the portal can read every fact the API will tell it', () => {
  it('leaves no officer read without a caller', () => {
    const source = anyClientSource().replace(/\$\{[^}]*\}/g, '*');
    const paths: string[][] = [];
    /*
     * The literal prefix of every quoted path, without needing it to end.
     *
     * A path is nearly always followed by a query string or an interpolation,
     * so requiring a closing quote finds only the handful that stop at a
     * segment boundary. `segments` reduces `*` and `:param` to the same
     * wildcard, so the prefix is all that has to line up.
     */
    for (const match of source.matchAll(/[`'"](\/[a-z][a-z0-9-]*(?:\/[a-z0-9\-*:_]+)*)/gi)) {
      paths.push(segments(match[1]));
    }
    const orphans = readEndpoints()
      .filter(
        (path) =>
          !AGENT_APPLICATION_ONLY.has(path) &&
          !SCHEDULED_ONLY.has(path) &&
          !OFFICER_WITHOUT_A_SCREEN.has(path) &&
          !READ_WITHOUT_A_SCREEN.has(path),
      )
      .filter((path) => {
        const want = segments(path);
        return !paths.some((candidate) => samePath(want, candidate));
      });

    assert.deepEqual(
      orphans,
      [],
      'these reads exist and no screen asks for them, so the fact they answer ' +
        'reaches nobody — give them a caller, or record why an officer never ' +
        'asks:\n  ' + orphans.join('\n  '),
    );
  });
});
