/**
 * "Corrections awaiting review", counting something that could not exist.
 *
 * The revenue officer's home screen has a tile for requests to change a
 * taxpayer's record — "someone asked for a change" — and it counted approvals
 * of type TAXPAYER_CORRECTION. The approvals table's CHECK does not allow that
 * type, so no such row has ever been written, and the tile read 0 on every
 * deployment however many people had asked. Measured: a DATA_CORRECTION case
 * opened, the tile unmoved, and the tile's link opening the approvals queue,
 * where no correction has ever been.
 *
 * A record is corrected directly, by an officer holding `taxpayer:correct`
 * under step-up. What waits for somebody is the request, and the request is a
 * case. The tile now counts those, and opens the case list narrowed to them.
 *
 * The second half is the guard the first half lacked. A check already refuses
 * a transaction status the column cannot hold; nothing looked at approval
 * types, and this one sat in a dashboard query for its whole life.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  createGovernmentUser,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
} from './helpers';
import { queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';

let officer = '';

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Records Officer', phone: '+2348039910001', role: 'revenue_officer' });
  officer = (await loginAs('+2348039910001')).accessToken;
});

const tile = async () => {
  const home = await get('/government/home', { token: officer });
  assert.equal(home.status, 200, JSON.stringify(home.body));
  return home.body.revenue.corrections_awaiting_review as string;
};

const openCase = async (category: string) => {
  const opened = await post(
    '/government/cases',
    { subject: 'The surname on this record is spelt wrongly', category, department: 'revenue_officer' },
    { token: officer },
  );
  assert.equal(opened.status, 201, JSON.stringify(opened.body));
  return opened.body.id as string;
};

describe('the corrections tile on the revenue officer home', () => {
  it('counts a request to correct a record while it is open', async () => {
    assert.equal(await tile(), '0');
    await openCase('DATA_CORRECTION');
    assert.equal(await tile(), '1', 'somebody asked for a change, and the officer is told');
  });

  it('stops counting it once it is resolved', async () => {
    const id = await openCase('DATA_CORRECTION');
    await pool.query(
      `UPDATE cases SET status = 'RESOLVED', resolved_at = now(), resolution = 'Surname corrected'
        WHERE id = $1`,
      [id],
    );
    assert.equal(await tile(), '0');
  });

  it('does not count other work as a correction', async () => {
    await openCase('TAXPAYER_DISPUTE');
    await openCase('GENERAL');
    assert.equal(await tile(), '0');
  });
});

describe('approval types named in the source', () => {
  it('names none the approvals table cannot hold', async () => {
    const constraint = await queryOne<{ def: string }>(
      pool,
      `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conrelid = 'approvals'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%approval_type%'`,
    );
    assert.ok(constraint, 'approvals has a CHECK constraint naming approval_type');
    const allowed = new Set([...constraint!.def.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]!));
    assert.ok(allowed.size > 5, `read ${allowed.size} approval types from the constraint`);

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return walk(full);
        return full.endsWith('.ts') ? [full] : [];
      });
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    let named = 0;
    for (const file of ['services', 'routes', 'lib'].flatMap((dir) => walk(join(root, dir)))) {
      const source = readFileSync(file, 'utf8');
      // `approval_type = 'X'` and `approval_type IN ('X', 'Y')`, in SQL.
      for (const match of source.matchAll(/approval_type\s*(?:=\s*'([A-Z_]+)'|IN\s*\(([^)]*)\))/g)) {
        const values = match[1] ? [match[1]] : [...match[2]!.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!);
        for (const value of values) {
          named += 1;
          if (!allowed.has(value)) offenders.push(`${file.slice(root.length + 1)}: ${value}`);
        }
      }
    }
    assert.ok(named > 3, `found only ${named} approval types named in SQL; the scan has broken`);
    assert.deepEqual(offenders, [], 'these approval types can never match a row');
  });
});
