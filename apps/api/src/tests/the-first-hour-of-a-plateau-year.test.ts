/**
 * The hour when the platform and the State disagree about the year.
 *
 * Nigeria keeps West Africa Time all year: UTC+1, no daylight saving. Every
 * container in this repo runs UTC. So between midnight and 01:00 on any
 * Plateau day the two clocks name different days, and for that hour on 1
 * January they name different YEARS.
 *
 * Thirteen government reference numbers took their year from
 * `new Date().getUTCFullYear()`. Observed, not reasoned about — with the clock
 * frozen at 00:30 on 1 January 2027, Plateau time:
 *
 *     receipt number:            PSIRS/2026/002548
 *     date printed beside it:    1 January 2027
 *
 * A receipt whose number says one financial year and whose date says another.
 * The number is what the receipt is filed under, quoted in an objection, and
 * read back down a telephone.
 *
 * `getUTC*` ignores `TZ`, so deploying the containers as Africa/Lagos would
 * have corrected none of it. The zone has to be named, which is what
 * `reminders.ts` concluded for the date a taxpayer is TOLD ("the date they are
 * given has to be theirs"); this is the same decision for the date the State
 * WRITES DOWN.
 *
 * The second test is the one that keeps the fix honest: an hour earlier the
 * old year must still be the answer, or the skew has only been moved.
 */

import './env';
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { pool } from './helpers';
import { nextInvoiceNumber, nextReceiptNumber } from '../lib/references';
import { currentYearInPlateau, plateauParts, todayInPlateau } from '../lib/calendar-day';
import { resolvePeriod } from '../services/targets';

/** 00:30 on 1 January 2027 in Plateau State. */
const FIRST_HOUR_OF_2027 = Date.UTC(2026, 11, 31, 23, 30);
/** 23:59 on 31 December 2026 in Plateau State, 31 minutes earlier. */
const LAST_MINUTE_OF_2026 = Date.UTC(2026, 11, 31, 22, 59);

/** The date a taxpayer is shown, formatted the way `reminders.ts` formats it. */
const AS_THE_TAXPAYER_SEES_IT = new Intl.DateTimeFormat('en-NG', {
  timeZone: 'Africa/Lagos',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

async function atInstant<T>(now: number, body: () => Promise<T> | T): Promise<T> {
  mock.timers.enable({ apis: ['Date'], now });
  try {
    return await body();
  } finally {
    mock.timers.reset();
  }
}

describe('the first hour of a Plateau year', () => {
  it('numbers a receipt with the year the taxpayer beside it is living in', async () => {
    const { number, shown } = await atInstant(FIRST_HOUR_OF_2027, async () => ({
      number: await nextReceiptNumber(pool),
      shown: AS_THE_TAXPAYER_SEES_IT.format(new Date()),
    }));

    assert.equal(shown, '1 January 2027', 'the fixture is not the first hour of 2027');
    assert.match(
      number,
      /^PSIRS\/2027\//,
      `receipt ${number} was minted on ${shown} and numbered under another year`,
    );
  });

  it('still numbers the last minute of the old year under the old year', async () => {
    const { number, shown } = await atInstant(LAST_MINUTE_OF_2026, async () => ({
      number: await nextInvoiceNumber(pool),
      shown: AS_THE_TAXPAYER_SEES_IT.format(new Date()),
    }));

    assert.equal(shown, '31 December 2026', 'the fixture is not the end of 2026');
    assert.match(number, /^INV\/2026\//, `invoice ${number} was minted on ${shown}`);
  });

  it('reads the Plateau calendar date off an instant, including across a leap day', () => {
    // 23:30 UTC is always the next Plateau day; 22:59 is still this one.
    assert.deepEqual(plateauParts(new Date('2026-12-31T23:30:00Z')), { year: 2027, month: 0, day: 1 });
    assert.deepEqual(plateauParts(new Date('2026-12-31T22:59:59Z')), { year: 2026, month: 11, day: 31 });
    assert.deepEqual(plateauParts(new Date('2028-02-29T23:30:00Z')), { year: 2028, month: 2, day: 1 });
    assert.deepEqual(plateauParts(new Date('2026-09-16T00:00:00Z')), { year: 2026, month: 8, day: 16 });
  });

  it('answers "what day is it" as the citizen would', async () => {
    assert.equal(await atInstant(FIRST_HOUR_OF_2027, () => todayInPlateau()), '2027-01-01');
    assert.equal(await atInstant(LAST_MINUTE_OF_2026, () => todayInPlateau()), '2026-12-31');
    assert.equal(await atInstant(FIRST_HOUR_OF_2027, () => currentYearInPlateau()), 2027);
  });

  it('resolves a target period from the day the officer is standing in', () => {
    const iso = (date: Date) => date.toISOString().slice(0, 10);
    const firstHour = new Date(FIRST_HOUR_OF_2027);

    const daily = resolvePeriod('DAILY', firstHour);
    assert.deepEqual([iso(daily.start), iso(daily.end)], ['2027-01-01', '2027-01-01']);

    const annual = resolvePeriod('ANNUAL', firstHour);
    assert.deepEqual([iso(annual.start), iso(annual.end)], ['2027-01-01', '2027-12-31']);

    // 1 January 2027 is a Friday, so its Monday-based week opened on 28 December.
    const weekly = resolvePeriod('WEEKLY', firstHour);
    assert.deepEqual([iso(weekly.start), iso(weekly.end)], ['2026-12-28', '2027-01-03']);
  });
});

/**
 * Nothing anywhere asks the process what day it is.
 *
 * The fix above is one substitution repeated across the API, the shared package
 * and both clients, which is exactly the kind of fix the next file to need it
 * does not get. This is the guard.
 *
 * It reads code only — lines that are wholly comment are skipped, because a
 * guard that counts a pattern quoted in prose is a guard that fires on its own
 * explanation. That lesson is already recorded: the reachability guard once
 * counted a path mentioned in a comment as a caller.
 *
 * A first draft of this pattern was written `(?:getUTC)?(?:FullYear|...)`,
 * which matches `.getUTCFullYear()` and silently misses `.getFullYear()` —
 * so it could not see the one site that was then sitting in ALLOWED, and the
 * exception was excusing something the guard was never going to find. The
 * `load-bearing` case below exists so that cannot happen twice: it requires
 * every written-down exception to name a file the pattern actually flags, so
 * an excuse for something the guard cannot see fails instead of reassuring.
 */
const REPO = join(__dirname, '..', '..', '..', '..');

/** The roots a date is either stamped from or shown from. */
const SCANNED = [
  join('apps', 'api', 'src'),
  join('apps', 'agent', 'src'),
  join('apps', 'portal', 'src'),
  join('packages', 'shared', 'src'),
];

/** `new Date()` asked, immediately, which year/month/day it is. */
const ASKS_THE_PROCESS =
  /new Date\(\)\s*\.\s*get(?:UTC)?(?:FullYear|Month|Date|Day)\(\)|new Date\(\)\s*\.\s*toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/;

/** Written down, with the reason, rather than quietly excluded. */
const ALLOWED: Record<string, string> = {
  'apps/api/src/routes/vehicles.ts':
    'An upper bound on yearOfManufacture, evaluated once at module load and already ' +
    'carrying a +1 of slack. The slack absorbs both the hour and the staleness; a vehicle ' +
    'made next year is admitted either way, and nothing is stamped with this value.',
};

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'tests' || entry === 'node_modules' || entry === 'dist') continue;
      found.push(...sourceFiles(full));
    } else if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.includes('.test.')) {
      found.push(full);
    }
  }
  return found;
}

/** Every scanned file, as a repo-relative path with forward slashes. */
function scanned(): string[] {
  return SCANNED.flatMap((root) => sourceFiles(join(REPO, root))).map((file) =>
    file.slice(REPO.length + 1).split(sep).join('/'),
  );
}

function asksTheProcess(relative: string): string[] {
  const hits: string[] = [];
  const source = readFileSync(join(REPO, relative), 'utf8');
  for (const [index, line] of source.split('\n').entries()) {
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
    if (ASKS_THE_PROCESS.test(line)) hits.push(`${relative}:${index + 1}  ${trimmed}`);
  }
  return hits;
}

describe('which clock the platform asks', () => {
  it('asks Plateau, or the reader, everywhere it stamps or filters by a date', () => {
    const files = scanned();
    assert.ok(files.length > 100, `expected the source tree, found ${files.length} files`);

    const offenders = files
      .filter((relative) => !(relative in ALLOWED))
      .flatMap((relative) => asksTheProcess(relative));

    assert.deepEqual(
      offenders,
      [],
      'these ask the process what day it is, and the process is UTC in a UTC+1 state. ' +
        'On the server use currentYearInPlateau/todayInPlateau/plateauParts from ' +
        'lib/calendar-day; on a client use todayIsoLocal from @psirs/shared; or add the ' +
        `file to ALLOWED with the reason:\n  ${offenders.join('\n  ')}`,
    );
  });

  it('keeps every written-down exception load-bearing', () => {
    // An exception that excuses nothing is worse than no exception: it reads
    // as though the guard has looked at that file and decided, when in fact
    // the pattern never matched there at all.
    const idle = Object.keys(ALLOWED).filter((relative) => asksTheProcess(relative).length === 0);
    assert.deepEqual(
      idle,
      [],
      `ALLOWED excuses files the guard does not flag — either the file changed or the ` +
        `pattern cannot see it: ${idle.join(', ')}`,
    );
  });

  it('keeps every written-down exception pointing at a file that still exists', () => {
    const live = new Set(scanned());
    const stale = Object.keys(ALLOWED).filter((name) => !live.has(name));
    assert.deepEqual(stale, [], `ALLOWED names files that no longer exist: ${stale.join(', ')}`);
  });
});
