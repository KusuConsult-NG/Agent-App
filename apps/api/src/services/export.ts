/**
 * Getting a report out of the platform, in a form the person receiving it can
 * actually use, and leaving a record that it left.
 *
 * CSV was the only answer, and CSV is the format that quietly damages
 * government data. Excel reads 08012345678 as a number and shows 8012345678;
 * it reads a fourteen-digit TIN as 1.23457E+13; it reads 2026-03-01 as a date
 * in whatever order the machine's locale prefers, which in a state office is
 * not always the order the file was written in. None of that is visible on the
 * screen the officer exported from. All of it is visible in the letter that
 * goes to the Accountant-General.
 *
 * So two more formats.
 *
 * XLSX, written here rather than taken from a library. The obvious dependency
 * carries a transitive advisory, and what is needed is narrow: a worksheet of
 * strings and numbers, no formulas, no styling beyond a bold header row. That
 * is a ZIP container and five small XML parts, all of it checkable -- and
 * `an-export-that-survives-excel.test.ts` unpacks what this writes and parses
 * every part, rather than trusting that it looked right.
 *
 * PDF, for the report somebody signs and files. It is not a better
 * spreadsheet and does not try to be: it is paginated, dated, attributed, and
 * carries the parameters the figures were produced under, because a printed
 * table with no statement of what it covers is the thing an auditor cannot
 * use.
 *
 * WHAT AN EXPORT COSTS
 *
 * Every export takes a copy of government data out of the platform's control.
 * That is often exactly right and it is never nothing, so it is gated on its
 * own permission rather than riding along with the permission that lets an
 * officer read the same rows on screen, it is capped per role, and every one
 * is written to the audit log with what was asked for and how much came back.
 */

import PDFDocument from 'pdfkit';
import { deflateRawSync, crc32 } from 'node:zlib';
import type { PoolClient } from 'pg';
import { config } from '../config';
import { pool, query, queryOne } from '../db/pool';
import { recordAudit } from './audit';
import { forbidden } from '../lib/errors';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

/**
 * How many rows one export may carry, by role.
 *
 * A limit is not a statement that the officer is untrusted; it is a statement
 * that a hundred thousand taxpayer records in one file is a different act from
 * a report, and should have to be asked for as one. The auditor's is highest
 * because an examination that cannot see the whole population is not an
 * examination, and the field roles are lowest because their legitimate exports
 * are about their own territory.
 *
 * WHY THIS READS THE DATABASE
 *
 * It used to be a constant map here, with a floor for anything not in it.
 * Since migration 059 an administrator creates their own roles, so that floor
 * was a role PSIRS invented waiting on an engineer and a release before its
 * officers could export a useful report -- the same shape of problem migration
 * 059 existed to fix for permissions, reproduced one file over. Migration 066
 * put the number on the role.
 *
 * The fallback below is not a policy. It is what to do when the role row has
 * gone missing underneath a live request, which should not happen and must not
 * mean "unlimited": erring towards the smallest limit costs an officer a
 * refusal they can act on, and erring the other way puts the register on
 * somebody's laptop.
 */
const LIMIT_WHEN_THE_ROLE_CANNOT_BE_READ = 0;

/**
 * Cached for the same thirty seconds, and for the same reasons, as the
 * permission map next door: an export is not a hot path, but reading two rows
 * per download to answer a question that changes about once a year is a query
 * that exists to be forgotten about.
 */
let cache: { at: number; limits: Map<string, number> } | null = null;
const CACHE_MS = 30_000;

export function forgetLimits(): void {
  cache = null;
}

export async function rowLimitFor(role: string): Promise<number> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const rows = await query<{ name: string; export_row_limit: number }>(
      pool,
      'SELECT name, export_row_limit FROM roles',
    );
    cache = { at: Date.now(), limits: new Map(rows.map((row) => [row.name, row.export_row_limit])) };
  }

  const cached = cache.limits.get(role);
  if (cached !== undefined) return cached;

  /*
   * A name the cache has not heard of is asked about, not refused.
   *
   * The cache is a snapshot, and a role created thirty seconds ago is exactly
   * the role an administrator is about to test. Falling through to the
   * fallback here made a brand-new role export nothing until the snapshot
   * expired -- safe, and indistinguishable from a bug to the person who had
   * just set its limit.
   */
  const row = await queryOne<{ export_row_limit: number }>(
    pool,
    'SELECT export_row_limit FROM roles WHERE name = $1',
    [role],
  );
  if (!row) return LIMIT_WHEN_THE_ROLE_CANNOT_BE_READ;
  cache.limits.set(role, row.export_row_limit);
  return row.export_row_limit;
}

export interface ExportRequest {
  actorId: string;
  actorRole: string;
  /** What was exported, in the words the audit log will carry. */
  subject: string;
  format: ExportFormat;
  parameters: Record<string, unknown>;
}

/**
 * Refuse, or record.
 *
 * Called with the rows in hand rather than before the query, because the
 * number that matters to somebody reading the log later is how much data
 * actually left, not how much was asked for.
 */
export async function recordExport(
  client: PoolClient,
  request: ExportRequest,
  rowCount: number,
): Promise<void> {
  const limit = await rowLimitFor(request.actorRole);
  if (rowCount > limit) {
    throw forbidden(
      limit === 0
        ? 'Your role may read this on screen and may not take a copy of it.'
        : `This export is ${rowCount.toLocaleString()} rows and your role may export ` +
          `${limit.toLocaleString()} at a time.`,
      'Narrow the period or the filters, or ask an administrator to raise the limit for your role.',
    );
  }

  await recordAudit(client, {
    actorId: request.actorId,
    actorRole: request.actorRole,
    action: 'report.export',
    entityType: 'report',
    entityId: request.subject,
    newValue: { format: request.format, rowCount, parameters: request.parameters },
    reason: `Exported ${request.subject} as ${request.format.toUpperCase()}.`,
  });
}

/**
 * And the read itself.
 *
 * "Reports generated" was marked partial in the officer-readiness assessment
 * for a precise reason: exports were audited and report *views* were not, so
 * the log could show that nobody had taken a copy of a taxpayer's history
 * while an officer had read it forty times. Looking is not free either.
 */
export async function recordReportView(
  client: PoolClient,
  request: Omit<ExportRequest, 'format'>,
  rowCount: number,
): Promise<void> {
  await recordAudit(client, {
    actorId: request.actorId,
    actorRole: request.actorRole,
    action: 'report.view',
    entityType: 'report',
    entityId: request.subject,
    newValue: { rowCount, parameters: request.parameters },
  });
}

// ===========================================================================
// XLSX
// ===========================================================================

/**
 * A value, as a cell: is this a quantity, or is it a label that happens to be
 * made of digits?
 *
 * The whole point of this format over CSV rests on getting that right. An
 * amount has to be a number or the recipient cannot total the column; a phone
 * number has to be text or it loses its leading zero and nobody can ring it.
 *
 * Three rules, in order.
 *
 * A leading zero settles it on its own: 08012345678 is not eleven billion, and
 * no quantity is ever written that way. This is the rule that caught the first
 * version of this function, which wrote every all-digit string as a number and
 * silently did to the export the exact thing the format was added to prevent.
 *
 * The column name settles the rest. A TIN, a BVN, an account number and a
 * receipt reference are identifiers: they are never added up, and a
 * fourteen-digit one displayed as 1.23457E+13 is not a TIN any more. Nothing
 * about the *value* distinguishes them from an amount, so the header is what
 * there is to go on, and a rule a reader can check beats a guess.
 *
 * What is left -- digits, no leading zero, not an identifier column -- is a
 * quantity, and is written as one if it survives the round trip exactly. Kobo
 * columns arrive as strings because they are BIGINT and JavaScript would round
 * them; anything longer than an exactly-representable integer stays text
 * rather than being quietly rounded in a financial report.
 */
const SAFE_INTEGER_DIGITS = 15;

/**
 * Columns whose contents are identifiers, however numeric they look.
 *
 * Matched on the header rather than listed exhaustively, because report
 * queries name their columns consistently -- `transaction_reference`,
 * `receipt_number`, `agent_code` -- and a new report should inherit the
 * behaviour without anybody remembering to add it here.
 */
const IDENTIFIER_COLUMN =
  /(^|_)(tin|nin|bvn|phone|msisdn|code|reference|number|id|account)(_|$)/i;

function isQuantity(columnName: string, text: string): boolean {
  if (IDENTIFIER_COLUMN.test(columnName)) return false;
  if (!/^-?\d+(\.\d+)?$/.test(text)) return false;
  if (/^-?0\d/.test(text)) return false;
  const digits = text.replace(/^-|\./g, '').length;
  return digits <= SAFE_INTEGER_DIGITS;
}

/**
 * Tab, newline and carriage return: the only characters below space that XML
 * 1.0 can represent at all.
 *
 * The rest have to go. A single one of them makes the whole workbook
 * unopenable rather than showing one bad cell, and they arrive here from
 * free-text fields somebody pasted into from another system.
 *
 * Written as a scan over code points rather than as a character class, because
 * a regex literal for this range is a line of invisible bytes that no reviewer
 * can check by eye and any editor might silently rewrite.
 */
const LEGAL_BELOW_SPACE = new Set([9, 10, 13]);

function stripCharactersXmlCannotHold(text: string): string {
  let kept = '';
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (code < 32 && !LEGAL_BELOW_SPACE.has(code)) continue;
    kept += character;
  }
  return kept;
}

function escapeXml(text: string): string {
  return stripCharactersXmlCannotHold(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A1, B1, ... Z1, AA1. */
function cellReference(columnIndex: number, rowNumber: number): string {
  let column = '';
  let index = columnIndex;
  do {
    column = String.fromCharCode(65 + (index % 26)) + column;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return `${column}${rowNumber}`;
}

function sheetXml(rows: Record<string, unknown>[], headers: string[]): string {
  const cell = (
    columnIndex: number,
    rowNumber: number,
    columnName: string,
    value: unknown,
    bold: boolean,
  ): string => {
    if (value === null || value === undefined || value === '') return '';
    const reference = cellReference(columnIndex, rowNumber);
    const style = bold ? ' s="1"' : '';
    const text = value instanceof Date ? value.toISOString() : String(value);
    if (typeof value === 'number' || (typeof value === 'string' && isQuantity(columnName, text))) {
      return `<c r="${reference}"${style}><v>${escapeXml(text)}</v></c>`;
    }
    /*
     * Inline strings rather than a shared-strings table. Sharing saves space in
     * a workbook that repeats values and costs a whole extra part that has to
     * stay in step with the sheet; for an export written once and read once,
     * the simpler file is the one more likely to be correct.
     */
    return (
      `<c r="${reference}"${style} t="inlineStr">` +
      `<is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`
    );
  };

  const headerRow =
    '<row r="1">' +
    // The header cells are labels, whatever they are named after.
    headers.map((header, index) => cell(index, 1, 'header', header, true)).join('') +
    '</row>';

  const bodyRows = rows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 2;
      return (
        `<row r="${rowNumber}">` +
        headers.map((header, index) => cell(index, rowNumber, header, row[header], false)).join('') +
        '</row>'
      );
    })
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${headerRow}${bodyRows}</sheetData>` +
    '</worksheet>'
  );
}

/** The parts a workbook cannot open without, plus one for the bold header. */
function workbookParts(rows: Record<string, unknown>[], sheetName: string): [string, string][] {
  const headers = rows.length > 0 ? Object.keys(rows[0]!) : ['(no rows)'];
  // Excel refuses these characters in a sheet name and caps it at 31.
  const safeName = escapeXml(sheetName.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31)) || 'Report';

  return [
    [
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ' +
        'ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.' +
        'openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-' +
        'officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>',
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/' +
        'relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    ],
    [
      'xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets>` +
        '</workbook>',
    ],
    [
      'xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/' +
        'relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/' +
        'relationships/styles" Target="styles.xml"/>' +
        '</Relationships>',
    ],
    [
      'xl/styles.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
        '<borders count="1"><border/></borders>' +
        '<cellStyleXfs count="1">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
        '</cellXfs>' +
        /*
         * The Normal named style, which a reader looks for before it looks at
         * anything else.
         *
         * Left out of the first version because nothing in this workbook uses
         * a named style, and every attribute above has a default that a reader
         * is entitled to assume. openpyxl opened the file and warned that it
         * had no default style and was supplying its own -- which is one
         * implementation being generous, and not a thing to rely on from the
         * next one. A warning from a tolerant reader is the cheapest possible
         * notice that a stricter reader may refuse.
         */
        '<cellStyles count="1">' +
        '<cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        '</styleSheet>',
    ],
    ['xl/worksheets/sheet1.xml', sheetXml(rows, headers)],
  ];
}

export function toXlsx(rows: Record<string, unknown>[], sheetName = 'Report'): Buffer {
  return zip(workbookParts(rows, sheetName));
}

/**
 * A ZIP container, deflated, with the central directory the format requires.
 *
 * No compression levels, no ZIP64, no encryption: every part here is small XML
 * and the whole file is written in one pass. The 32-bit sizes in these headers
 * are the reason the row cap above is not merely a policy -- a four-gigabyte
 * export could not be written correctly by this code, and silently truncating
 * one would be far worse than refusing it.
 */
function zip(parts: [string, string][]): Buffer {
  const chunks: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of parts) {
    const nameBytes = Buffer.from(name, 'utf8');
    const raw = Buffer.from(content, 'utf8');
    const deflated = deflateRawSync(raw);
    const checksum = crc32(raw);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed to extract
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(8, 8); // deflate
    localHeader.writeUInt16LE(0, 10); // modification time
    localHeader.writeUInt16LE(0x21, 12); // 1 January 1980, this format's epoch
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(deflated.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    chunks.push(localHeader, nameBytes, deflated);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // version made by
    entry.writeUInt16LE(20, 6); // version needed to extract
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(deflated.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt16LE(0, 30); // extra
    entry.writeUInt16LE(0, 32); // comment
    entry.writeUInt16LE(0, 34); // disk
    entry.writeUInt16LE(0, 36); // internal attributes
    entry.writeUInt32LE(0, 38); // external attributes
    entry.writeUInt32LE(offset, 42);

    directory.push(entry, nameBytes);
    offset += localHeader.length + nameBytes.length + deflated.length;
  }

  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk holding the directory
  end.writeUInt16LE(parts.length, 8);
  end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...chunks, directoryBytes, end]);
}

// ===========================================================================
// PDF
// ===========================================================================

export interface PdfReport {
  title: string;
  rows: Record<string, unknown>[];
  /** What the figures cover, printed under the title. Never omitted. */
  parameters: Record<string, unknown>;
  generatedBy: string;
  /** Present when the report is a signed `audit_reports` row. */
  reportNumber?: string | null;
  checksum?: string | null;
}

const INK = '#12211a';
const MUTED = '#5b6b63';
const RULE = '#c9d6cf';

/** Below this a column carries no information, only the fact that it exists. */
export const MINIMUM_COLUMN = 24;

/**
 * How many columns fit on the page, and how wide each one is.
 *
 * Pulled out of the renderer because it is the whole of the layout decision,
 * and because a mistake in it is invisible in the output: the page still
 * renders, still validates, and is simply missing the data. Checking it here
 * needs no PDF reader, which is what makes it checkable at all -- the first
 * attempt at a test for this searched the PDF bytes for the note it prints,
 * and found nothing, because PDFKit deflates its content streams.
 *
 * Scale to fit, but never below the minimum. The first version scaled every
 * column by one factor and then cut from the front at the first one narrower
 * than that -- past about thirty columns the factor takes *every* column under
 * it, so the count reached zero and a forty-column report came out as a
 * heading and a paragraph saying nothing fit: a valid PDF, served with a 200,
 * carrying none of the data the officer asked for. No report the platform
 * ships is that wide, so it was latent rather than live, and rendering forty
 * columns and reading the result is what found it.
 *
 * Columns are taken from the front rather than by picking whichever widest
 * ones happen to fit: a table whose columns are not in the order the report
 * defined them is a table nobody can check against the CSV of the same report.
 */
export function fitColumns(
  natural: number[],
  width: number,
): { widths: number[]; shown: number; tableWidth: number } {
  const totalNatural = natural.reduce((sum, value) => sum + value, 0);
  const scale = totalNatural > width && totalNatural > 0 ? width / totalNatural : 1;
  const widths = natural.map((value) => Math.max(value * scale, MINIMUM_COLUMN));

  let shown = 0;
  let tableWidth = 0;
  while (shown < widths.length && tableWidth + widths[shown]! <= width) {
    tableWidth += widths[shown]!;
    shown += 1;
  }
  return { widths, shown, tableWidth };
}

/**
 * A table, paginated, landscape, with the header repeated on every page.
 *
 * Columns are laid out by measuring the widest cell in each and scaling to fit
 * the page, so a report of eight short columns is not squeezed into a third of
 * the width while a report of twenty overflows. Beyond what fits, the
 * remaining columns are named in a line under the table rather than silently
 * dropped: the reader has to be told the file has more in it than the paper
 * does.
 */
export function renderReportPdf(report: PdfReport): Promise<Buffer> {
  const document = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
  const chunks: Buffer[] = [];
  document.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve) => {
    document.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const left = document.page.margins.left;
  const width = document.page.width - left - document.page.margins.right;
  const headers = report.rows.length > 0 ? Object.keys(report.rows[0]!) : [];

  const text = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString().slice(0, 19).replace('T', ' ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  /*
   * Measure, then scale. Sampling the first two hundred rows: measuring fifty
   * thousand costs more than the layout is worth, and the widths do not move.
   */
  document.fontSize(7);
  const sample = report.rows.slice(0, 200);
  const natural = headers.map((header) => {
    const widest = sample.reduce(
      (best, row) => Math.max(best, document.widthOfString(text(row[header]))),
      document.widthOfString(header),
    );
    return Math.min(widest + 8, 160);
  });

  const { widths, shown, tableWidth } = fitColumns(natural, width);
  const omitted = headers.slice(shown);

  let cursor = 0;

  function drawHeading(): void {
    document.fillColor(INK).fontSize(14).text(report.title, left, document.page.margins.top);
    document.moveDown(0.2);
    document.fillColor(MUTED).fontSize(8);
    const stamp = [
      config.branding.agencyName,
      `Generated ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC by ` +
        report.generatedBy,
      report.reportNumber ? `Report ${report.reportNumber}` : null,
      `${report.rows.length.toLocaleString()} row(s)`,
    ]
      .filter(Boolean)
      .join('  -  ');
    document.text(stamp, left);
    const parameters = Object.entries(report.parameters)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => `${key}: ${text(value)}`)
      .join('   ');
    /*
     * Printed even when there are no filters, because "everything this officer
     * may see" is itself a statement about what the figures cover, and a
     * printed table that does not say what it covers is the thing an auditor
     * cannot use.
     */
    document.text(`Covering - ${parameters || 'everything this officer may see'}`, left);
    if (report.checksum) document.text(`Checksum ${report.checksum}`, left);
    document.moveDown(0.5);
    cursor = document.y;

    let x = left;
    document.fontSize(7).fillColor(INK);
    for (let index = 0; index < shown; index += 1) {
      document.text(headers[index]!, x + 2, cursor + 2, {
        width: widths[index]! - 4,
        height: 10,
        ellipsis: true,
        lineBreak: false,
      });
      x += widths[index]!;
    }
    document
      .strokeColor(INK)
      .lineWidth(0.8)
      .moveTo(left, cursor + 12)
      .lineTo(left + tableWidth, cursor + 12)
      .stroke();
    cursor += 12;
  }

  function drawRow(values: unknown[]): void {
    const height = 12;
    if (cursor + height > document.page.height - document.page.margins.bottom) {
      document.addPage();
      drawHeading();
    }
    let x = left;
    document.fontSize(7).fillColor(MUTED);
    for (let index = 0; index < shown; index += 1) {
      document.text(text(values[index]), x + 2, cursor + 2, {
        width: widths[index]! - 4,
        height: height - 2,
        ellipsis: true,
        lineBreak: false,
      });
      x += widths[index]!;
    }
    document
      .strokeColor(RULE)
      .lineWidth(0.4)
      .moveTo(left, cursor + height)
      .lineTo(left + tableWidth, cursor + height)
      .stroke();
    cursor += height;
  }

  drawHeading();
  for (const record of report.rows) drawRow(headers.map((header) => record[header]));

  if (omitted.length > 0) {
    document
      .fillColor(MUTED)
      .fontSize(7)
      .text(
        `${omitted.length} column(s) did not fit and are not shown here: ${omitted.join(', ')}. ` +
          'Export as XLSX or CSV for the whole record.',
        left,
        cursor + 8,
        { width },
      );
  }

  if (report.rows.length === 0) {
    document.fillColor(MUTED).fontSize(9).text('No rows matched.', left, cursor + 8);
  }

  document.end();
  return finished;
}
