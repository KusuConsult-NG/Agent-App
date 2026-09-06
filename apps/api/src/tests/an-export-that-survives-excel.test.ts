/**
 * The three formats a report leaves in, and what it costs to take one.
 *
 * CSV was the only answer, and CSV is the format that quietly damages
 * government data: Excel reads 08012345678 as a number and shows
 * 8012345678, and a fourteen-digit TIN as 1.23457E+13. Neither is visible on
 * the screen the officer exported from, and both are visible in the letter
 * that goes to the Accountant-General.
 *
 * WHAT THE WORKBOOK TESTS ACTUALLY CHECK
 *
 * The XLSX writer is a ZIP container written by hand, so "it looked right" is
 * not available as evidence. These tests unpack what it wrote through the
 * central directory -- which the writer builds separately from the local
 * headers, so a disagreement between the two is caught -- inflate every entry
 * and verify each CRC with zlib, then read the cell types out of the sheet.
 *
 * What that does not prove is that Excel opens it, which nothing runnable here
 * can prove. What it does prove is that the container is internally consistent,
 * that every part a workbook needs is present and named correctly, and that a
 * phone number is a string while an amount is a number -- which is the whole
 * reason the format exists rather than CSV.
 */

import './env';
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, inflateRawSync } from 'node:zlib';
import {
  createGovernmentUser,
  get,
  getBinary,
  loginAs,
  pool,
  post,
  resetDatabase,
  seedOneCollection,
  startTestServer,
  stopTestServer,
} from './helpers';
import { query, queryOne } from '../db/pool';
import { seedReferenceData } from '../db/seed';
import { rowLimitFor, toXlsx } from '../services/export';
import { grantStepUp } from './helpers';
import { forget } from '../services/rbac-store';
import { forgetLimits } from '../services/export';

const PHONES = {
  auditor: '+2348081000001',
  revenue: '+2348081000002',
  admin: '+2348081000003',
};
const tokens: Record<string, string> = {};

before(async () => {
  await startTestServer();
});
after(async () => {
  await stopTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  await seedReferenceData();
  /*
   * Both caches, because both outlive a reset.
   *
   * The permission map and the export limits are cached for thirty seconds
   * against a role name, and `resetDatabase` empties the tables underneath
   * them. A test that revoked a permission or lowered a limit would otherwise
   * leave the next test running against a snapshot of its own changes.
   */
  forget();
  forgetLimits();
  for (const [key, phone] of Object.entries(PHONES)) {
    await createGovernmentUser({
      fullName: `Export ${key}`,
      phone,
      role: key === 'auditor' ? 'auditor' : key === 'admin' ? 'admin' : 'revenue_officer',
    });
    tokens[key] = (await loginAs(phone)).accessToken;
  }
  await seedOneCollection('1');
});

const auth = (who: keyof typeof PHONES) => ({ token: tokens[who] });

// ===========================================================================
/**
 * A ZIP reader, written from the format rather than from the writer.
 *
 * It walks the end-of-central-directory record to the central directory and
 * reads each entry's stored offset, then inflates at that offset and checks
 * the CRC. A writer that got an offset, a size or a checksum wrong produces a
 * file that looks fine as bytes and fails here.
 */
function unzip(archive: Buffer): Map<string, string> {
  const endSignature = 0x06054b50;
  let end = archive.length - 22;
  while (end >= 0 && archive.readUInt32LE(end) !== endSignature) end -= 1;
  assert.ok(end >= 0, 'the archive has an end-of-central-directory record');

  const entryCount = archive.readUInt16LE(end + 10);
  let cursor = archive.readUInt32LE(end + 16);
  const files = new Map<string, string>();

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(archive.readUInt32LE(cursor), 0x02014b50, 'central directory entry signature');
    const expectedCrc = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.toString('utf8', cursor + 46, cursor + 46 + nameLength);

    assert.equal(archive.readUInt32LE(localOffset), 0x04034b50, `${name}: local header signature`);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const deflated = archive.subarray(dataStart, dataStart + compressedSize);
    const raw = inflateRawSync(deflated);

    assert.equal(crc32(raw), expectedCrc, `${name}: checksum matches the directory entry`);
    files.set(name, raw.toString('utf8'));
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

// ===========================================================================
describe('a workbook the recipient can actually open', () => {
  it('carries every part a workbook needs, each one intact', () => {
    const archive = toXlsx([{ reference: 'TXN-1', amount_kobo: '500000' }], 'Transactions');
    const files = unzip(archive);

    for (const part of [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ]) {
      assert.ok(files.has(part), `${part} is in the archive`);
      assert.ok(files.get(part)!.startsWith('<?xml'), `${part} is XML`);
    }

    assert.match(files.get('xl/workbook.xml')!, /name="Transactions"/);
  });

  /*
   * The reason this format exists rather than CSV, and the distinction the
   * first version of the writer got wrong: every all-digit string was written
   * as a number, so 08012345678 came out of the export as 8012345678.
   */
  it('keeps a phone number a phone number and an amount an amount', () => {
    const files = unzip(
      toXlsx([
        { phone: '08012345678', tin: '12345678901234', amount_kobo: '500000', name: 'Aisha' },
      ]),
    );
    const sheet = files.get('xl/worksheets/sheet1.xml')!;

    assert.match(
      sheet,
      /<c r="A2" t="inlineStr"><is><t xml:space="preserve">08012345678</,
      'the phone number is a string and keeps its zero',
    );
    assert.match(
      sheet,
      /<c r="B2" t="inlineStr"><is><t xml:space="preserve">12345678901234</,
      'the TIN is a string, not 1.23457E+13',
    );
    assert.match(
      sheet,
      /<c r="C2"><v>500000<\/v><\/c>/,
      'the amount is a number the recipient can total',
    );
  });

  /*
   * The leading-zero rule on its own, without an identifier column name to
   * lean on: a value written that way is never a quantity, whatever the column
   * is called.
   */
  it('treats a leading zero as a label even in a column nobody named', () => {
    const files = unzip(toXlsx([{ whatever: '007', quantity: '7' }]));
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    assert.match(sheet, /<c r="A2" t="inlineStr"><is><t xml:space="preserve">007</);
    assert.match(sheet, /<c r="B2"><v>7<\/v><\/c>/);
  });

  it('does not round a number too long to be one', () => {
    const files = unzip(toXlsx([{ enormous: '123456789012345678' }]));
    assert.match(
      files.get('xl/worksheets/sheet1.xml')!,
      /t="inlineStr"><is><t xml:space="preserve">123456789012345678</,
      'better text than a financial report that is quietly wrong',
    );
  });

  it('escapes what would otherwise break the file', () => {
    const files = unzip(
      toXlsx([{ name: 'Bello & Sons <Ltd>', note: 'He said "no"' }]),
    );
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    assert.match(sheet, /Bello &amp; Sons &lt;Ltd&gt;/);
    assert.match(sheet, /He said &quot;no&quot;/);
    assert.ok(!/<Ltd>/.test(sheet.replace(/&lt;Ltd&gt;/g, '')), 'no raw angle brackets survive');
  });

  /*
   * One control character makes a workbook unopenable rather than showing one
   * bad cell, and they arrive from free-text fields pasted in from elsewhere.
   */
  it('drops characters XML cannot hold, and keeps the ones it can', () => {
    const files = unzip(
      toXlsx([{ pasted: `before${String.fromCharCode(7)}after`, wrapped: 'one\ttwo' }]),
    );
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    assert.match(sheet, /beforeafter/, 'the bell character is gone');
    assert.match(sheet, /one\ttwo/, 'the tab, which XML can hold, is not');
  });

  it('writes a workbook even when nothing matched', () => {
    const files = unzip(toXlsx([]));
    assert.ok(files.get('xl/worksheets/sheet1.xml')!.includes('<sheetData>'));
  });

  /*
   * The named style a reader looks for before it looks at anything else.
   *
   * The first version of the writer left `cellStyles` out: nothing in this
   * workbook uses a named style, and every attribute in the ones above has a
   * default a reader is entitled to assume. Opening the file with openpyxl --
   * an implementation with no shared code with this one -- produced a warning
   * that it had found no default style and was supplying its own, which is one
   * reader being generous and not a thing to rely on from the next.
   *
   * Asserted here rather than left to that manual check, because the manual
   * check happened once and this file is edited again.
   */
  it('declares the Normal style, so a strict reader has one to fall back on', () => {
    const styles = unzip(toXlsx([{ a: 1 }])).get('xl/styles.xml')!;
    assert.match(styles, /<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"\/><\/cellStyles>/);
    // And the cell formats name their parts rather than relying on defaults.
    assert.match(styles, /<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"\/>/);
  });

  it('refuses a sheet name Excel would not accept', () => {
    const files = unzip(toXlsx([{ a: 1 }], 'March/April: report [draft]'));
    const workbook = files.get('xl/workbook.xml')!;
    assert.ok(!/[\\/*?:[\]]/.test(workbook.split('name="')[1]!.split('"')[0]!));
  });
});

// ===========================================================================
describe('an export is a different act from a read', () => {
  it('serves the same rows as JSON, CSV, a workbook and a PDF', async () => {
    const asJson = await get('/government/transactions?limit=10', auth('auditor'));
    assert.equal(asJson.status, 200);
    assert.ok(Array.isArray(asJson.body));

    const asCsv = await get('/government/transactions?limit=10&format=csv', auth('auditor'));
    assert.equal(asCsv.status, 200);
    assert.match(asCsv.headers.get('content-type') ?? '', /text\/csv/);

    const asWorkbook = await getBinary(
      '/government/transactions?limit=10&format=xlsx',
      auth('auditor'),
    );
    assert.equal(asWorkbook.status, 200);
    assert.match(
      asWorkbook.headers.get('content-type') ?? '',
      /spreadsheetml\.sheet/,
    );
    // Unpacks, which is the only claim worth making about bytes.
    const files = unzip(asWorkbook.body);
    assert.ok(files.has('xl/worksheets/sheet1.xml'));

    const asPdf = await getBinary('/government/transactions?limit=10&format=pdf', auth('auditor'));
    assert.equal(asPdf.status, 200);
    assert.match(asPdf.headers.get('content-type') ?? '', /application\/pdf/);
    assert.equal(asPdf.body.subarray(0, 5).toString('ascii'), '%PDF-');
  });

  /*
   * The whole point of a separate permission. Reading on screen is governed by
   * everything around it -- the audit trail, the territory scope, the session;
   * the same rows in a spreadsheet on a laptop are governed by nothing this
   * platform can see.
   */
  it('lets an officer without the export permission read, and not export', async () => {
    await query(
      pool,
      `DELETE FROM role_permissions WHERE role = 'revenue_officer' AND permission = 'data:export'`,
    );
    /*
     * The map is cached for thirty seconds and the cache is keyed on the role,
     * not on the session -- so signing in again would not pick this up, and a
     * test that waited half a minute for it would be a test nobody runs.
     */
    forget();

    const onScreen = await get('/government/transactions?limit=10', auth('revenue'));
    assert.equal(onScreen.status, 200, 'they can still do their job');

    const asFile = await get('/government/transactions?limit=10&format=csv', auth('revenue'));
    assert.equal(asFile.status, 403, JSON.stringify(asFile.body));
    assert.match(JSON.stringify(asFile.body), /may not export/i);
  });

  it('records every export in the audit log, with what was asked for', async () => {
    await get(
      '/government/transactions?limit=10&format=csv&status=SETTLED',
      auth('auditor'),
    );

    const entry = await queryOne<{
      action: string;
      new_value: { format: string; rowCount: number; parameters: Record<string, unknown> };
    }>(
      pool,
      `SELECT action, new_value FROM audit_logs
        WHERE action = 'report.export' ORDER BY sequence_no DESC LIMIT 1`,
    );
    assert.ok(entry, 'the export is in the chain');
    assert.equal(entry!.new_value.format, 'csv');
    assert.equal(entry!.new_value.parameters.status, 'SETTLED');
  });

  /*
   * Reading a page of a table is not an export and must not be logged as one:
   * an audit log where every screenful is an entry is one where the entries
   * that matter cannot be found.
   */
  it('does not record reading the same rows on screen as an export', async () => {
    await get('/government/transactions?limit=10', auth('auditor'));
    const count = await queryOne<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM audit_logs WHERE action = 'report.export'`,
    );
    assert.equal(count!.count, '0');
  });

  it('caps an export at what the role may take, by role', async () => {
    assert.ok(
      (await rowLimitFor('auditor')) > (await rowLimitFor('revenue_officer')),
      'an examination that cannot see the population is not an examination',
    );
    assert.equal(
      await rowLimitFor('agent'),
      0,
      'the field agent takes nothing out of the platform at all',
    );
  });

  /*
   * The reason this moved out of `services/export.ts` in migration 066.
   *
   * A role PSIRS creates used to get a hard-coded floor until an engineer
   * edited a TypeScript file and PSIRS waited for a release -- the same shape
   * of problem the permission map had before migration 059, one file over.
   */
  it('lets an administrator change what a role may take, without a deployment', async () => {
    await grantStepUp(tokens.admin, PHONES.admin, 'user.role.change');
    await post(
      '/government/roles',
      { name: 'zonal_coordinator', label: 'Zonal coordinator', isPortal: true },
      auth('admin'),
    );
    assert.equal(await rowLimitFor('zonal_coordinator'), 5000, 'a new role starts at the floor');

    await grantStepUp(tokens.admin, PHONES.admin, 'user.role.change');
    const raised = await post(
      '/government/roles/zonal_coordinator/export-limit',
      { limit: 40000, reason: 'Zonal coordinators report on the whole zone each month.' },
      auth('admin'),
    );
    assert.equal(raised.status, 200, JSON.stringify(raised.body));
    assert.equal(await rowLimitFor('zonal_coordinator'), 40000, 'and the cache does not hold it back');

    const entry = await queryOne<{ old_value: { exportRowLimit: number }; new_value: { exportRowLimit: number } }>(
      pool,
      `SELECT old_value, new_value FROM audit_logs
        WHERE action = 'rbac.role.export_limit' ORDER BY sequence_no DESC LIMIT 1`,
    );
    assert.equal(entry!.old_value.exportRowLimit, 5000);
    assert.equal(entry!.new_value.exportRowLimit, 40000);
  });

  it('refuses a limit above what the writer could actually produce', async () => {
    await grantStepUp(tokens.admin, PHONES.admin, 'user.role.change');
    const absurd = await post(
      '/government/roles/auditor/export-limit',
      { limit: 9_000_000, reason: 'Asking for more than the file format can carry.' },
      auth('admin'),
    );
    assert.equal(absurd.status, 422, JSON.stringify(absurd.body));
  });

  /*
   * Zero is a decision, and a different one from the permission being absent:
   * that says whether they may export, this says how much.
   */
  it('lets a role be set to export nothing, and says so in those words', async () => {
    await grantStepUp(tokens.admin, PHONES.admin, 'user.role.change');
    await post(
      '/government/roles/revenue_officer/export-limit',
      { limit: 0, reason: 'Field officers stop taking copies pending the data review.' },
      auth('admin'),
    );

    const refused = await get('/government/transactions?limit=10&format=csv', auth('revenue'));
    assert.equal(refused.status, 403, JSON.stringify(refused.body));
    assert.match(JSON.stringify(refused.body), /may not take a copy/i);
  });
});

// ===========================================================================
describe('a signed report, as a file somebody can file', () => {
  async function signedReport(): Promise<{ id: string; reportNumber: string }> {
    const generated = await post(
      '/government/audit/reports',
      { reportType: 'TRANSACTION_AUDIT', title: 'March transaction audit', parameters: {} },
      auth('auditor'),
    );
    assert.equal(generated.status, 201, JSON.stringify(generated.body));
    return generated.body as { id: string; reportNumber: string };
  }

  it('exports the figures that were signed, not the figures now', async () => {
    const report = await signedReport();

    // The record moves underneath it.
    await seedOneCollection('2');

    const pdf = await getBinary(
      `/government/audit/reports/${report.id}/export?format=pdf`,
      auth('auditor'),
    );
    assert.equal(pdf.status, 200);
    assert.equal(pdf.body.subarray(0, 5).toString('ascii'), '%PDF-');

    const workbook = await getBinary(
      `/government/audit/reports/${report.id}/export?format=xlsx`,
      auth('auditor'),
    );
    const files = unzip(workbook.body);
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    const rowCount = (sheet.match(/<row /g) ?? []).length - 1;

    const stored = await get(`/government/audit/reports/${report.id}`, auth('auditor'));
    assert.equal(
      rowCount,
      (stored.body as { row_count: number }).row_count,
      'the file carries the frozen payload, not a fresh query',
    );
  });

  it('records that the report was read, not only that it was taken', async () => {
    const report = await signedReport();
    await get(`/government/audit/reports/${report.id}`, auth('auditor'));

    const view = await queryOne<{ entity_id: string }>(
      pool,
      `SELECT entity_id FROM audit_logs WHERE action = 'report.view' ORDER BY sequence_no DESC LIMIT 1`,
    );
    assert.ok(view, 'looking is recorded too');
    assert.equal(view!.entity_id, report.reportNumber);
  });
});
