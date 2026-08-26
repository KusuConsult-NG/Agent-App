/**
 * No external call while a transaction is open.
 *
 * A `withTransaction` block holds a pooled connection and whatever row locks
 * its statements have taken, until it commits. Calling a provider from inside
 * one hands both to a third party for as long as they take to answer: the
 * PSIRS TIN service during a taxpayer registration, an identity provider
 * during KYC, a bank during a verification, the vehicle authority during a
 * capture. Six functions did it, including the busiest write path on the
 * platform.
 *
 * Nothing was wrong until something was slow. A provider having a bad
 * afternoon does not fail a request — it holds a connection, and a queue of
 * agents in markets doing the same is how a pool runs dry and everything stops
 * at once, for a reason that looks nothing like its cause.
 *
 * Each was restructured to read, ask, then write. Two got safer in the
 * process: `submitKyc` used to supersede the previous attempt and then rely on
 * a throw to roll that back when the provider was unreachable, and now writes
 * nothing until it has an answer; `completeRenewal` used to roll a paid
 * renewal back if the authority could not be told, and now issues the papers
 * and leaves the announcement to the sweep that already existed for it.
 *
 * This holds the property. The exception list is empty on purpose: where a
 * call genuinely needs a row the transaction has locked, the answer is the one
 * `attemptRefund` uses — commit, then call — not an entry here.
 */

import './env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SERVICES = 'src/services';

/** Every adapter that leaves this process for somewhere the platform does not run. */
const PROVIDERS = [
  'vehicleRegistry',
  'kycProvider',
  'tinService',
  'bankVerification',
  'paymentGateway',
  'storage',
  'smsProvider',
  'emailProvider',
];

interface Offence {
  file: string;
  line: number;
  text: string;
}

/**
 * Walk a file counting brace depth, and report any provider call that happens
 * while a `withTransaction` callback is still open.
 *
 * Depth counting rather than parsing, deliberately: it is a few lines, it has
 * no dependencies, and its failure mode is a false positive somebody reads —
 * not a silent pass.
 */
function offencesIn(file: string, source: string): Offence[] {
  const call = new RegExp(`\\b(${PROVIDERS.join('|')})\\.\\w+\\(`);
  const found: Offence[] = [];
  const lines = source.split('\n');

  let depth = 0;
  let transactionDepth: number | null = null;

  for (const [index, line] of lines.entries()) {
    // A line's own opening brace does not count until after it is read, so a
    // call on the same line as the `withTransaction(` opener is still inside.
    if (/withTransaction\(async/.test(line) && transactionDepth === null) {
      transactionDepth = depth;
    }

    if (transactionDepth !== null && call.test(line) && !line.trimStart().startsWith('*')) {
      found.push({ file, line: index + 1, text: line.trim() });
    }

    depth += (line.match(/[{(]/g) ?? []).length - (line.match(/[})]/g) ?? []).length;
    if (transactionDepth !== null && depth <= transactionDepth) transactionDepth = null;
  }

  return found;
}

describe('a database transaction', () => {
  it('is never held open across a call to somebody else', () => {
    const offences: Offence[] = [];
    for (const name of readdirSync(SERVICES).filter((f) => f.endsWith('.ts'))) {
      offences.push(...offencesIn(name, readFileSync(join(SERVICES, name), 'utf8')));
    }

    assert.deepEqual(
      offences.map((o) => `${o.file}:${o.line}  ${o.text}`),
      [],
      'these call a provider with a transaction open, so its row locks and its pooled ' +
        'connection are held until a third party answers. Read, ask, then write — as ' +
        '`attemptRefund` does:\n  ' +
        offences.map((o) => `${o.file}:${o.line}  ${o.text}`).join('\n  '),
    );
  });

  it('is what this test would have caught before the restructure', () => {
    // The detector has to actually detect. A file shaped like the old
    // `submitKyc` — read inside the transaction, call, then write — must be
    // reported, or the empty result above means nothing.
    const before = [
      'export async function submitKyc(params: { agentId: string }) {',
      '  return withTransaction(async (client) => {',
      '    const agent = await queryOne(client, "SELECT 1", []);',
      '    const verification = await kycProvider.verify({ agent });',
      '    await client.query("UPDATE agents SET kyc_status = $1", [verification.status]);',
      '  });',
      '}',
    ].join('\n');

    const caught = offencesIn('before.ts', before);
    assert.equal(caught.length, 1, `expected the provider call to be reported: ${JSON.stringify(caught)}`);
    assert.match(caught[0]!.text, /kycProvider\.verify/);
  });

  it('does not report a call made after the transaction closes', () => {
    // And it has to stop reporting once the block ends, or the property is
    // unsatisfiable and somebody deletes the test.
    const after = [
      'export async function completeRenewal(params: { id: string }) {',
      '  const done = await withTransaction(async (client) => {',
      '    return client.query("UPDATE vehicle_renewals SET status = $1", ["COMPLETED"]);',
      '  });',
      '  await vehicleRegistry.recordRenewal({ id: params.id });',
      '  return done;',
      '}',
    ].join('\n');

    assert.deepEqual(offencesIn('after.ts', after), []);
  });
});
