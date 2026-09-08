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

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
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

test.use({ viewport: PHONE });

test('the page says where the code goes before anybody presses anything', async ({ page }) => {
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
  await page.getByRole('button', { name: /Check status/i }).click();

  await expect(page.getByText(/What you have already paid/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/never sent to a number typed here/i)).toBeVisible();
  await shot(page, 'citizen-stmt-01-offered', 'What you have already paid');
  expect(console_.errors, console_.errors.join('\n')).toEqual([]);
});

test('a name search is offered nothing, because it found no specific person', async ({ page }) => {
  const console_ = watchConsole(page);
  await page.goto(`${PORTAL}/#/citizen`);
  await page.getByRole('button', { name: /^By name$/i }).click();
  await page.getByLabel(/name/i).fill('Amina');
  await page.getByRole('button', { name: /Check status/i }).click();

  await page.waitForTimeout(2000);
  await expect(page.getByRole('button', { name: /Send me a code/i })).toHaveCount(0);
  await shot(page, 'citizen-stmt-02-name-search-offered-nothing');
  expect(console_.errors, console_.errors.join('\n')).toEqual([]);
});

test('the statement itself, once the code from the SMS is entered', async ({ page }) => {
  const console_ = watchConsole(page);
  const { tin, phone } = await aTaxpayerWhoHasPaid();

  await page.goto(`${PORTAL}/#/citizen`);
  await page.getByLabel(/Tax Identification Number/i).fill(tin);
  await page.getByRole('button', { name: /Check status/i }).click();
  await expect(page.getByRole('button', { name: /Send me a code/i })).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole('button', { name: /Send me a code/i }).click();
  await expect(page.getByLabel(/Code from the SMS/i)).toBeVisible({ timeout: 20_000 });
  await shot(page, 'citizen-stmt-03-code-sent', 'code has gone to the phone');

  const code = await codeFromTheSms(phone);
  await page.getByLabel(/Code from the SMS/i).fill(code);
  await page.getByRole('button', { name: /Show my payments/i }).click();

  await expect(page.getByText(/What it went to/i)).toBeVisible({ timeout: 20_000 });
  // The statement carries no receipt numbers, so it cannot be used to prove a
  // payment to anybody — and it says so rather than leaving them to find out.
  await expect(page.getByText(/the receipt is the proof/i)).toBeVisible();
  await shot(page, 'citizen-stmt-04-statement', 'Each payment');
  expect(console_.errors, console_.errors.join('\n')).toEqual([]);
});
