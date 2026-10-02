/**
 * Eleven writes that were allowed to fail, and nothing anywhere said so.
 *
 * Some writes are evidence rather than control, and `routes/citizen.ts` states
 * the trade plainly:
 *
 *     A failure to write the log must never fail the citizen's lookup: this is
 *     evidence, not a control, and refusing to tell somebody what they owe
 *     because an audit insert failed would be the wrong trade.
 *
 * That is right, and none of this changes it. What was missing was the other
 * half. Eleven sites swallowed with `.catch(() => undefined)` and logged
 * nothing, so these could each stop being written with no signal in any log,
 * table or metric:
 *
 *   verification_attempts    who searched the public register
 *   audit_log access.denied  who was refused, and for what
 *   document_access_logs     who read the receipt book
 *
 * The audit trail is load-bearing across this system's design — a whole
 * migration exists to keep a hash chain over it — and a hole in it that
 * nothing reports is worse than a hole somebody can see. It was found by a
 * check that could not answer its own question: asked to confirm the deployed
 * proxy chain by reading the newest `verification_attempts` row, the answer
 * was "no rows", which cannot distinguish no traffic from a write that has
 * been failing since deploy.
 *
 * FOUR SITES GOT `error` RATHER THAN `warn`, because their failure compounds
 * rather than merely losing a record:
 *
 *   - `withJobLock`'s unlock. `client.release()` returns the connection to the
 *     pool rather than closing it, and a session-level advisory lock outlives
 *     that. A failed unlock leaves the lock held on a pooled connection, so
 *     every later run of that job takes the `{ ran: false }` branch and does
 *     nothing for as long as the process lives.
 *   - The migration lock, which every boot queues behind.
 *   - The incentive evaluation unlock, which is the same held worker lock for
 *     one programme: every later evaluation of it is skipped, silently.
 *   - The incentive bulk evaluation, where the swallow covered the whole pass
 *     and not just its audit row: the 202 has gone, so an exception left a
 *     programme half-evaluated with nothing saying so.
 *
 * The sentence above said THREE and listed three, in the same commit that
 * wrote all four. `LEVELS` below is the count that recomputes itself.
 *
 * AND ONE OF THE ELEVEN WAS NOT THIS CLASS AT ALL. `GET /receipts/:id` read
 * with `.catch(() => null)` and then `throw notFound('That receipt')`. Its
 * comment says the catch is there so a malformed uuid is a 404 rather than the
 * 500 a `::uuid` cast error produces — a fair intent, implemented by catching
 * everything, so a database it could not reach was also reported as a receipt
 * that does not exist. An officer investigating a disputed payment would be
 * told the receipt was not there, whenever PostgreSQL was unavailable. That is
 * the "could not read" turned into "there is none" that this repository has
 * already swept once. Fixed by checking the id's shape before the query
 * instead of catching after it.
 */

import './env';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { bestEffort, __resetBestEffort } from '../lib/best-effort';
import { createGovernmentUser, get, loginAs, resetDatabase, startTestServer, stopTestServer } from './helpers';
import { seedReferenceData } from '../db/seed';

before(async () => {
  await startTestServer();
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({
    fullName: 'Receipt Reader',
    phone: '+2348095420001',
    role: 'admin',
  });
  officerToken = (await loginAs('+2348095420001')).accessToken;
});
after(async () => {
  await stopTestServer();
});

let officerToken = '';

/** Lines the logger wrote, captured for the duration of one call. */
async function linesFrom(body: () => Promise<unknown>): Promise<string[]> {
  const captured: string[] = [];
  const warn = console.warn;
  const error = console.error;
  const log = console.log;
  console.warn = (line: unknown) => captured.push(String(line));
  console.error = (line: unknown) => captured.push(String(line));
  console.log = (line: unknown) => captured.push(String(line));
  try {
    await body();
  } finally {
    console.warn = warn;
    console.error = error;
    console.log = log;
  }
  return captured;
}

beforeEach(() => {
  __resetBestEffort();
});

describe('a write that is allowed to fail, and says so', () => {
  it('does not reject, so it can never fail the request it hangs off', async () => {
    // The whole premise. `await` must not throw and `void` must not leave an
    // unhandled rejection.
    await assert.doesNotReject(async () => {
      await bestEffort('probe.rejects', Promise.reject(new Error('the database is gone')));
    });
  });

  it('reports the failure rather than swallowing it', async () => {
    const lines = await linesFrom(() =>
      bestEffort('verification_attempt.record', Promise.reject(new Error('connection refused'))),
    );
    assert.equal(lines.length, 1, `expected one line, got ${JSON.stringify(lines)}`);
    assert.match(lines[0]!, /verification_attempt\.record/);
    assert.match(lines[0]!, /connection refused/, 'and says why, not just that');
  });

  it('carries the database error code, which is the actionable part', async () => {
    // 57P01 is the server shutting down under us; 23505 a duplicate. They ask
    // for different things from whoever reads the line.
    //
    // Logged as `errorCode`: `code` is a credential word in lib/logger's
    // redaction list, because that is how a one-time code is logged, and a
    // field called `code` arrives as [redacted]. This assertion is what
    // caught that — the first version of the helper used `code` and the line
    // said nothing useful.
    const pgError = Object.assign(new Error('terminating connection'), { code: '57P01' });
    const lines = await linesFrom(() => bestEffort('probe.code', Promise.reject(pgError)));
    assert.match(lines[0]!, /57P01/);
    assert.doesNotMatch(lines[0]!, /redacted/, 'the code was redacted as if it were a credential');
  });

  it('says nothing when the work succeeds', async () => {
    const lines = await linesFrom(() => bestEffort('probe.fine', Promise.resolve('done')));
    assert.deepEqual(lines, []);
  });

  it('does not emit a line per request when the database is down', async () => {
    /*
     * `session.touch` runs on every authenticated request. If PostgreSQL is
     * unreachable, a line each would bury the one line somebody needed and
     * cost real money in an aggregator — so the first failure reports and the
     * rest are counted.
     */
    const lines = await linesFrom(async () => {
      for (let i = 0; i < 50; i += 1) {
        await bestEffort('session.touch', Promise.reject(new Error('no connection')));
      }
    });
    assert.equal(lines.length, 1, `50 failures produced ${lines.length} lines`);
  });

  it('tells the reader how many failures the line speaks for', async () => {
    const lines = await linesFrom(async () => {
      // One line, then silence.
      for (let i = 0; i < 5; i += 1) {
        await bestEffort('probe.throttled', Promise.reject(new Error('down')));
      }
      // A minute later the next failure reports, and owes the count.
      mock.timers.enable({ apis: ['Date'], now: Date.now() + 61_000 });
      try {
        await bestEffort('probe.throttled', Promise.reject(new Error('still down')));
      } finally {
        mock.timers.reset();
      }
    });
    assert.equal(lines.length, 2, JSON.stringify(lines));
    assert.match(
      lines[1]!,
      /alsoSpeaksFor/,
      'the second line does not say how many it stands for, so a reader ' +
        'cannot tell one failure from a hundred',
    );
    assert.match(lines[1]!, /"alsoSpeaksFor":4|alsoSpeaksFor.{0,3}4/);
  });

  it('throttles each operation separately', async () => {
    // A failing audit insert must not silence a failing lock release.
    const lines = await linesFrom(async () => {
      await bestEffort('probe.one', Promise.reject(new Error('a')));
      await bestEffort('probe.two', Promise.reject(new Error('b')));
      await bestEffort('probe.one', Promise.reject(new Error('a again')));
    });
    assert.equal(lines.length, 2, JSON.stringify(lines));
  });

  it('sends a compounding failure to error rather than warn', async () => {
    // A stuck advisory lock blocks every later run of that job; a lost audit
    // row does not. They should not read the same to whoever is on call.
    const warned: string[] = [];
    const errored: string[] = [];
    const w = console.warn;
    const e = console.error;
    console.warn = (line: unknown) => warned.push(String(line));
    console.error = (line: unknown) => errored.push(String(line));
    try {
      await bestEffort('job.unlock.probe', Promise.reject(new Error('lock stuck')), {
        level: 'error',
      });
      await bestEffort('audit.probe', Promise.reject(new Error('row lost')));
    } finally {
      console.warn = w;
      console.error = e;
    }
    assert.equal(errored.length, 1, 'the lock failure did not reach error');
    assert.equal(warned.length, 1, 'the lost row did not reach warn');
  });
});

// ===========================================================================

/** Every `.ts` under `src/`, excluding the tests themselves. */
function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === 'tests' || entry === 'node_modules') continue;
      sourceFiles(path, found);
    } else if (entry.endsWith('.ts')) {
      found.push(path);
    }
  }
  return found;
}

/**
 * A promise whose rejection is discarded and nothing else.
 *
 * Matches `.catch(() => undefined)`, `=> null`, `=> {}` and `=> void 0`. It
 * deliberately does not match a catch with a body, which is a decision
 * somebody wrote down rather than a failure dropped on the floor.
 */
const SILENT_SWALLOW = /\.catch\(\s*\(\s*\)\s*=>\s*(?:undefined|null|void 0|\{\s*\})\s*\)/;

/**
 * Where a bare swallow is still the right answer, and why.
 *
 * Empty on purpose. Every one of the eleven had a reason it could be
 * swallowed and none had a reason it should be unreported — including the
 * error reporter, whose own failure now reaches stdout, because `lib/logger`
 * imports only `config` and cannot re-enter the reporter. If an entry is ever
 * needed here it wants a sentence saying what would read the failure instead.
 */
const ALLOWED: Record<string, string> = {};

describe('nothing swallows a failure without a word', () => {
  it('has no silent catch left in the API source', () => {
    const offenders: string[] = [];
    for (const path of sourceFiles(join(process.cwd(), 'src'))) {
      const relative = path.slice(path.indexOf(`src${sep}`));
      const source = readFileSync(path, 'utf8');
      // The helper's own doc comment quotes the shape it replaced.
      const code = source
        .split('\n')
        .filter((line) => {
          const t = line.trim();
          return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
        })
        .join('\n');
      if (SILENT_SWALLOW.test(code) && !(relative in ALLOWED)) offenders.push(relative);
    }
    assert.deepEqual(
      offenders,
      [],
      'these discard a failure with no log, table or metric recording it. ' +
        'Use bestEffort() from lib/best-effort, or add an entry to ALLOWED ' +
        `saying what would read the failure instead: ${offenders.join(', ')}`,
    );
  });

  it('has no idle entry in ALLOWED', () => {
    // An exception for a file that no longer needs one is an exception nobody
    // will question later. This repository has written two of those already.
    for (const [relative, reason] of Object.entries(ALLOWED)) {
      const source = readFileSync(join(process.cwd(), relative), 'utf8');
      assert.ok(
        SILENT_SWALLOW.test(source),
        `ALLOWED lists ${relative} (${reason}) but nothing there matches the ` +
          'pattern any more — remove the entry',
      );
    }
  });
});

// ===========================================================================

/**
 * Which failures reach `error`, and the rule that decides.
 *
 * `BestEffortOptions.level` states the line exactly: `warn` for a record that
 * was lost, `error` where the failure *compounds* — a held advisory lock that
 * stops every later run of a job, a background pass with no caller left to
 * tell. The line is not how much the record matters. Every row in this
 * module's care matters; that is the reason any of it is logged at all.
 *
 * Two sites had it the other way and reported a lost record at `error`: the
 * taxpayer record-access and search logs, on the stated reasoning that a
 * missing row in an access log is not recoverable later and not detectable
 * from anywhere else. Both halves of that are true — and both are equally
 * true of `document_access.record`, the log of who read the receipt book,
 * which is one insert of the same kind at `warn` a few files away. The
 * outlier bought nothing and cost the alerting: an unreachable database then
 * pages somebody once a minute per surface, which is how the next real error
 * comes to be scrolled past.
 *
 * So this table holds the *class* and derives the level, rather than pinning
 * the levels as they are. A new call site has to say which half of the rule it
 * falls in, and then cannot pick a level that contradicts its own answer.
 */
type Loss = 'the record is lost' | 'the failure compounds';

function levelFor(loss: Loss): 'warn' | 'error' {
  return loss === 'the failure compounds' ? 'error' : 'warn';
}

/** Every `bestEffort` operation in the API source, and what its failure costs. */
const LEVELS: Record<string, { loss: Loss; because: string }> = {
  'session.touch': {
    loss: 'the record is lost',
    because: "a session's last-used stamp; the next request writes another",
  },
  'audit.access_denied': {
    loss: 'the record is lost',
    because: 'who was refused, and for what',
  },
  'device.touch': {
    loss: 'the record is lost',
    because: "when an agent's device was last seen",
  },
  'taxpayer_access.record': {
    loss: 'the record is lost',
    because: "who opened one citizen's record",
  },
  'taxpayer_search.record': {
    loss: 'the record is lost',
    because: 'who searched the register, and what was typed into it',
  },
  'document_access.record': {
    loss: 'the record is lost',
    because: 'who read the receipt book',
  },
  'verification_attempt.record': {
    loss: 'the record is lost',
    because: 'who searched the public register',
  },
  'error_reporting.report': {
    loss: 'the record is lost',
    because:
      'one report the external reporter would not take. The log line is then ' +
      'the report, which is why it must not be silent — and why it is not ' +
      'worth more than the report it stands in for',
  },
  'job.unlock.${name}': {
    loss: 'the failure compounds',
    because:
      'a session-level lock left held on a pooled connection, so every later ' +
      'run of that job does nothing for as long as the process lives',
  },
  'migration.unlock': {
    loss: 'the failure compounds',
    because: 'every boot queues behind it',
  },
  'incentive.evaluation_unlock': {
    loss: 'the failure compounds',
    because: 'the same held worker lock, for one programme: every later evaluation is skipped',
  },
  'incentive.bulk_evaluate': {
    loss: 'the failure compounds',
    because:
      'the swallow covers the whole pass, not an audit row. The 202 has gone, ' +
      'so a half-evaluated programme has no caller left to tell',
  },
};

/**
 * Lines that are nothing but comment, dropped.
 *
 * The same filter the swallow sweep above uses, and for the same reason: a
 * comment quoting `level: 'error'` must not read as one. Line numbers do not
 * survive it, so a failure names the file and the operation instead — which
 * is what somebody would act on anyway.
 */
function codeOnly(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');
}

/**
 * The slice of source from one `bestEffort(` to its matching `)`.
 *
 * Balanced rather than a fixed window, because a window is exactly the
 * heuristic that has already failed once in this repository: a comment grew
 * and pushed the thing being counted out the far end of it.
 */
function callExtent(code: string, open: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i]!;
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced bestEffort( call at offset ${open}`);
}

interface Site {
  file: string;
  operation: string;
  level: 'warn' | 'error';
}

/** Every `bestEffort(...)` call in the non-test API source. */
function callSites(): Site[] {
  const found: Site[] = [];
  for (const path of sourceFiles(join(process.cwd(), 'src'))) {
    const relative = path.slice(path.indexOf(`src${sep}`));
    if (relative === join('src', 'lib', 'best-effort.ts')) continue;
    const code = codeOnly(readFileSync(path, 'utf8'));
    for (let at = code.indexOf('bestEffort('); at >= 0; at = code.indexOf('bestEffort(', at + 1)) {
      const extent = callExtent(code, at + 'bestEffort'.length);
      const operation = /^\(\s*(['"`])([^'"`]*)\1/.exec(extent);
      assert.ok(
        operation,
        `the first argument of a bestEffort call in ${relative} is not a ` +
          `literal, so nothing can check its level: ${extent.slice(0, 80)}`,
      );
      found.push({
        file: relative,
        operation: operation[2]!,
        level: /\blevel:\s*'error'/.test(extent) ? 'error' : 'warn',
      });
    }
  }
  return found;
}

describe('the level says whether a failure compounds, not how much it mattered', () => {
  it('has every call site in the table', () => {
    const undeclared = callSites()
      .filter((site) => !(site.operation in LEVELS))
      .map((site) => `${site.operation} (${site.file})`);
    assert.deepEqual(
      undeclared,
      [],
      'these bestEffort calls do not say which half of the rule they are in. ' +
        'Add an entry to LEVELS giving the class and what the failure costs: ' +
        `${undeclared.join(', ')}`,
    );
  });

  it('reports at the level its class requires', () => {
    const wrong: string[] = [];
    for (const site of callSites()) {
      const declared = LEVELS[site.operation];
      if (!declared) continue; // the test above owns this.
      const wanted = levelFor(declared.loss);
      if (site.level !== wanted) {
        wrong.push(
          `${site.operation} in ${site.file} reports at ${site.level}, but ` +
            `LEVELS says ${declared.loss} (${declared.because}), which is ${wanted}`,
        );
      }
    }
    assert.deepEqual(wrong, [], wrong.join('; '));
  });

  it('has no idle entry in LEVELS', () => {
    // An entry for an operation nothing calls any more is the stale count
    // this file's own header carried for as long as it existed.
    const live = new Set(callSites().map((site) => site.operation));
    const stale = Object.keys(LEVELS).filter((operation) => !live.has(operation));
    assert.deepEqual(stale, [], `LEVELS names operations nothing calls: ${stale.join(', ')}`);
  });

  it('still describes the rule the table applies', () => {
    /*
     * The table derives `error` from "the failure compounds" and nothing else.
     * If the helper's own documented line moves, that derivation is no longer
     * the rule and every entry above wants rereading — so this fails rather
     * than letting the two drift apart quietly.
     */
    const helper = readFileSync(join(process.cwd(), 'src/lib/best-effort.ts'), 'utf8');
    assert.match(helper, /`warn` for a record that was lost/);
    assert.match(helper, /`error` where the failure compounds/);
  });
});

// ===========================================================================

describe('asking for a receipt that is not there, and one that cannot be looked up', () => {
  /*
   * `GET /receipts/:id` had no test of any kind, which is how its read came to
   * wrap the whole query in `.catch(() => null)` and report a database it
   * could not reach as a receipt that does not exist. These two pin the
   * behaviour that was right and had to survive the fix; the third is what the
   * class guard above now prevents from coming back.
   */
  it('answers a malformed id with a 404 rather than a cast error', async () => {
    const response = await get('/receipts/not-a-uuid', { token: officerToken });
    assert.equal(
      response.status,
      404,
      `a malformed id produced ${response.status}: ${JSON.stringify(response.body).slice(0, 200)}`,
    );
  });

  it('answers a well-formed id for no receipt with the same 404', async () => {
    // Deliberately the same answer: whether an id is well-formed is not
    // something this endpoint owes a caller who has guessed one.
    const response = await get('/receipts/00000000-0000-4000-8000-000000000000', {
      token: officerToken,
    });
    assert.equal(response.status, 404, JSON.stringify(response.body).slice(0, 200));
  });

  it('does not decide a receipt is absent by catching the query', () => {
    // The distinction the catch destroyed. Structural, because making the
    // database unreachable mid-suite would take every other test with it.
    const source = readFileSync(join(process.cwd(), 'src/routes/payments.ts'), 'utf8');
    const read = source.slice(source.indexOf('RECEIPT_DETAIL_SQL} WHERE r.id'));
    assert.doesNotMatch(
      read.slice(0, 400),
      /\.catch\(/,
      'the receipt read is wrapped in a catch again, so an unreachable ' +
        'database will once more be reported to an officer as a receipt that ' +
        'does not exist',
    );
  });
});
