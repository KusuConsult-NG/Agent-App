/**
 * A citizen, with no login, reading what they have already paid.
 *
 * The public page cannot tell the taxpayer from anybody else who knows their
 * phone number, so the statement is not offered on the strength of having been
 * found. It is offered on the strength of a code sent to the number the record
 * carries — and the screen has to say that plainly, or a person who typed a
 * TIN will wait for an SMS on the handset in their hand.
 *
 * Shot at phone size, because that is what a market trader is holding.
 *
 * Run it with: scripts/uat/stack.sh up && npx playwright test tests/browser/citizen-statement.spec.ts
 */

import { test, expect, type Page, type Locator, type ConsoleMessage } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const PORTAL = process.env.PORTAL_URL ?? 'http://localhost:5174';
const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const SHOTS = 'docs/uat-screenshots';
const PHONE = { width: 414, height: 896 };

mkdirSync(SHOTS, { recursive: true });

function watchConsole(page: Page): { errors: string[] } {
  const errors: string[] = [];
  const expected = [/401/, /404/, /Failed to load resource/, /ServiceWorker/i, /manifest/i, /favicon/i];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    if (expected.some((pattern) => pattern.test(message.text()))) return;
    errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
  return { errors };
}

async function shot(page: Page, name: string, focus?: string): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  if (focus) await page.getByText(new RegExp(focus, 'i')).first().scrollIntoViewIfNeeded();
  else await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

/** A seeded taxpayer who has actually paid something, found through the API. */
async function aTaxpayerWhoHasPaid(): Promise<{ tin: string; phone: string }> {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-app-version': '1.0.0' },
    body: JSON.stringify({ phone: '+2348000000001', password: 'Password123' }),
  });
  const { accessToken } = (await login.json()) as { accessToken: string };

  const found = await fetch(`${API}/taxpayers/search?q=Amina&limit=5`, {
    headers: { authorization: `Bearer ${accessToken}`, 'x-app-version': '1.0.0' },
  });
  const rows = (await found.json()) as { tin: string | null; phone: string }[];
  const withTin = rows.find((row) => row.tin);
  expect(withTin, 'the seed registers a taxpayer with a TIN').toBeTruthy();
  return { tin: withTin!.tin!, phone: withTin!.phone };
}

/**
 * Read the code out of the SMS the platform queued.
 *
 * From the database rather than from an endpoint, because there is no endpoint
 * that hands a one-time code back and there must not be. In the field this
 * step is a person reading their own phone; here it is the harness standing in
 * for the handset, which is the only part of the journey a browser cannot do.
 */
async function codeFromTheSms(phone: string): Promise<string> {
  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString:
      process.env.UAT_DATABASE_URL ??
      'postgres://postgres:postgres@localhost:5432/psirs_uat',
  });
  try {
    const { rows } = await pool.query<{ message: string }>(
      `SELECT message FROM notifications
        WHERE channel = 'SMS' AND recipient = $1
        ORDER BY created_at DESC LIMIT 5`,
      [phone],
    );
    for (const row of rows) {
      const match = /(\d{4,10})/.exec(row.message ?? '');
      if (match) return match[1]!;
    }
    throw new Error(`No code in the messages sent to ${phone}`);
  } finally {
    await pool.end();
  }
}

/**
 * Press something, and wait the limiter out rather than trip over it.
 *
 * Every step of this journey is rate-limited from one address, and every one
 * of those limits is doing a job: the status check stops a stranger walking a
 * range of TINs, the code request stops them making somebody's phone buzz all
 * afternoon, and the statement stops them guessing at a six-digit code. A spec
 * that runs the journey several times in a minute meets all three, which is
 * the platform working and not a defect to design around. The limiter says how
 * long to wait; waiting exercises the control, and anything else evades it.
 *
 * Repeating the press is safe on each of them: the refusal is made by the
 * middleware before the handler runs, so nothing was checked, nothing was
 * sent, and no one-time code was consumed. A retry after a *wrong* code would
 * be a different thing entirely, and this is not that.
 */
async function pressing(
  page: Page,
  button: RegExp,
  untilVisible: () => Locator,
  what: string,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.getByRole('button', { name: button }).click();
    try {
      await expect(untilVisible()).toBeVisible({ timeout: 12_000 });
      return;
    } catch {
      const text = await page.locator('body').innerText();
      const seconds = Number(/Wait (\d+) second/.exec(text)?.[1] ?? 0);
      if (!seconds) throw new Error(`${what} failed, and not for rate limiting: ${text.slice(0, 300)}`);
      await page.waitForTimeout((seconds + 1) * 1000);
    }
  }
  throw new Error(`${what} was still rate limited after five attempts.`);
}

test.use({ viewport: PHONE });

test('the page says where the code goes before anybody presses anything', async ({ page }) => {
  // Slow, for the same reason: a limiter asking for fifty seconds needs room.
  test.slow();
  /*
   * The one sentence that has to be read. A person who types a TIN and expects
   * an SMS on the phone in their hand concludes the platform is broken when
   * nothing arrives — and a person who typed somebody else's TIN needs to know
   * the code is not coming to them.
   */
  const console_ = watchConsole(page);
  const { tin } = await aTaxpayerWhoHasPaid();

  await page.goto(`${PORTAL}/#/citizen`);
  await page.getByLabel(/Tax Identification Number/i).fill(tin);
  await pressing(
    page,
    /Check status/i,
    () => page.getByText(/What you have already paid/i),
    'Checking the status',
  );

  await expect(page.getByText(/never sent to a number typed here/i)).toBeVisible();
  /*
   * The period is on the screen before the button that spends a code, because
   * the code is consumed by the statement it opens — picking the window
   * afterwards would mean discovering that at the cost of an SMS.
   */
  await expect(page.getByLabel(/^From$/i)).toBeVisible();
  await expect(page.getByLabel(/^To$/i)).toBeVisible();
  // Framed on the button that spends the code, so the period fields sitting
  // above it are in the picture rather than below the fold.
  await shot(page, 'citizen-stmt-01-offered', 'Send me a code');
  expect(console_.errors, console_.errors.join('\n')).toEqual([]);
});

test('a name search is offered nothing, because it found no specific person', async ({ page }) => {
  // Slow, for the same reason: a limiter asking for fifty seconds needs room.
  test.slow();
  const console_ = watchConsole(page);
  await page.goto(`${PORTAL}/#/citizen`);
  await page.getByRole('button', { name: /^By name$/i }).click();
  await page.getByLabel(/name/i).fill('Amina');
  /*
   * The search has to have answered before "no statement offered" means
   * anything. A refused request — rate limited, or failed — also shows no
   * button, and this test would pass on it while proving nothing.
   */
  await pressing(
    page,
    /Check status/i,
    () => page.getByText(/matching record|records found with a similar name/i),
    'Searching by name',
  );

  await expect(page.getByRole('button', { name: /Send me a code/i })).toHaveCount(0);
  await shot(page, 'citizen-stmt-02-name-search-offered-nothing');
  expect(console_.errors, console_.errors.join('\n')).toEqual([]);
});

test('the statement itself, once the code from the SMS is entered', async ({ page }) => {
  /*
   * Allowed to be slow, because waiting the limiters out is part of the
   * journey. Each window is a minute and this test crosses three of them; a
   * test cut off at forty-five seconds cannot honour a limiter that asks for
   * fifty, and would report the control working as a failure.
   */
  test.slow();
  const console_ = watchConsole(page);
  const { tin, phone } = await aTaxpayerWhoHasPaid();

  await page.goto(`${PORTAL}/#/citizen`);
  await page.getByLabel(/Tax Identification Number/i).fill(tin);
  await pressing(
    page,
    /Check status/i,
    () => page.getByRole('button', { name: /Send me a code/i }),
    'Checking the status',
  );

  // A period the citizen set themselves, rather than the twelve-month default.
  await page.getByLabel(/^From$/i).fill('2026-01-01');
  await page.getByLabel(/^To$/i).fill('2026-12-31');

  await pressing(
    page,
    /Send me a code/i,
    () => page.getByLabel(/Code from the SMS/i),
    'Asking for a code',
  );
  await shot(page, 'citizen-stmt-03-code-sent', 'code has gone to the phone');

  await page.getByLabel(/Code from the SMS/i).fill(await codeFromTheSms(phone));
  await pressing(
    page,
    /Show my payments/i,
    () => page.getByText(/What it went to/i),
    'Reading the statement',
  );

  // The statement carries no receipt numbers, so it cannot be used to prove a
  // payment to anybody — and it says so rather than leaving them to find out.
  await expect(page.getByText(/the receipt is the proof/i)).toBeVisible();
  await expect(page.getByText(/from 2026-01-01 to 2026-12-31/i)).toBeVisible();
  // Another window means another code, and the button says so rather than
  // letting a citizen find out from an expired-code message.
  await expect(page.getByRole('button', { name: /Look at a different period/i })).toBeVisible();
  await shot(page, 'citizen-stmt-04-statement', 'Each payment');
  // The tail of the statement, where the rows end and the way back to a
  // different window sits — the part a citizen reaches after reading.
  await shot(page, 'citizen-stmt-05-another-period', 'Look at a different period');
  expect(console_.errors, console_.errors.join('\n')).toEqual([]);
});
