/**
 * Enumeration on the handset, photographed at the size an agent holds.
 *
 * The officer screens in `informal-sector.spec.ts` are where estimates are
 * decided. This is where the facts they rest on are written down — in a
 * market, on a phone, by somebody paid commission on what they collect.
 *
 * The pictures exist to show one thing above all: there is no amount on this
 * form and none comes back. An agent who could see a figure could be haggled
 * with, and a presumptive regime haggled with at a stall in its first year
 * does not get a second.
 *
 * Shot at the viewport rather than full-page, because the navigation bar is
 * fixed to the bottom of a phone screen and a full-page capture floats it
 * across the middle of the image.
 *
 * Run it with: scripts/uat/stack.sh up && npx playwright test tests/browser/agent-enumeration.spec.ts
 */

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const AGENT = process.env.AGENT_URL ?? 'http://localhost:5173';
const SHOTS = 'docs/uat-screenshots';
const PHONE = { width: 414, height: 896 };
const LOGIN = { phone: '+2347010000001', password: 'FieldAgent2026' };

mkdirSync(SHOTS, { recursive: true });

function watchConsole(page: Page): { errors: string[] } {
  const errors: string[] = [];
  const expected = [/401/, /Failed to load resource/, /ServiceWorker/i, /manifest/i, /favicon/i];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    if (expected.some((pattern) => pattern.test(message.text()))) return;
    errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
  return { errors };
}

async function signIn(page: Page): Promise<void> {
  await page.goto(AGENT);
  await page.locator('input[type="tel"]').first().fill(LOGIN.phone);
  await page.locator('input[type="password"]').first().fill(LOGIN.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForTimeout(3000);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

/**
 * Find the trader standing in front of you, and open their record.
 *
 * The agent's taxpayers tab is a search rather than a browsable list, on
 * purpose — a handset that could page through the State's whole register is
 * a handset that leaks it. So this is the real flow: type a name, open the
 * match.
 */
async function openATaxpayer(page: Page, name = 'Amina'): Promise<void> {
  await page.goto(`${AGENT}/#/taxpayers`);
  await page.waitForTimeout(1500);

  /*
   * Retried, because search is rate-limited and this spec searches six times
   * in a couple of minutes. That limit is the platform working — a handset
   * that could sweep the register at speed is a handset that leaks it — so it
   * is waited out rather than turned off.
   */
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.getByRole('searchbox').first().fill(name);
    await page.getByRole('button', { name: /^search$|^bincika$/i }).first().click();
    try {
      await page.locator('.list__item').first().waitFor({ timeout: 8_000 });
      break;
    } catch {
      if (attempt === 3) throw new Error(`No taxpayer matching "${name}" after four attempts.`);
      await page.waitForTimeout(6_000);
    }
  }
  await page.locator('.list__item').first().click();
  await page.waitForTimeout(1800);
}

test.use({ viewport: PHONE });

test('the errand sits beside collecting, on the taxpayer an agent is standing in front of', async ({
  page,
}) => {
  const console_ = watchConsole(page);
  await signIn(page);
  await openATaxpayer(page);

  await expect(page.getByRole('button', { name: /Write down the business/i })).toBeVisible({
    timeout: 20_000,
  });
  await shot(page, 'agent-enum-01-taxpayer');
  expect(console_.errors, console_.errors.join('\n')).toEqual([]);
});

test('the form asks for facts and nothing else', async ({ page }) => {
  /*
   * Premises, equipment, people, trade — and a warning that says in as many
   * words that the agent is not setting the tax, so they have something to
   * tell a trader who asks what it will cost.
   */
  const console_ = watchConsole(page);
  await signIn(page);
  await openATaxpayer(page);
  await page.getByRole('button', { name: /Write down the business/i }).click();
  await page.waitForTimeout(1500);

  await expect(page.getByLabel(/Where they trade from/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/You are not setting the tax/i)).toBeVisible();
  // The property the whole screen turns on, asserted rather than assumed.
  await expect(page.locator('body')).not.toContainText('₦');
  await shot(page, 'agent-enum-02-blank-form');
  expect(console_.errors, console_.errors.join('\n')).toEqual([]);
});

test('nothing can be saved until both counts are answered', async ({ page }) => {
  // Nought is an answer and blank is not: a hawker with no equipment and
  // nobody working for them is precisely who the exemption is for.
  const console_ = watchConsole(page);
  await signIn(page);
  await openATaxpayer(page);
  await page.getByRole('button', { name: /Write down the business/i }).click();
  await page.waitForTimeout(1500);

  const save = page.getByRole('button', { name: /Save what you saw/i });
  await expect(save).toBeDisabled();
  await page.getByLabel(/Where they trade from/i).selectOption('LOCK_UP_SHOP');
  await page.getByRole('combobox', { name: 'Trade', exact: true }).selectOption('ARTISAN_CRAFT');
  await page.getByLabel(/Machines or equipment/i).fill('3');
  await expect(save, 'one count answered is not both').toBeDisabled();

  await page.getByLabel(/People working besides the owner/i).fill('2');
  await expect(save).toBeEnabled();
  await shot(page, 'agent-enum-03-filled-in');
  expect(console_.errors, console_.errors.join('\n')).toEqual([]);
});

test('the band comes back from the office, and still no amount', async ({ page }) => {
  /*
   * Shown because the trader will ask what has been written about them, and
   * an agent who cannot answer looks evasive. Not shown so the agent can
   * choose it — the server decided it from the facts, and there is no control
   * on this screen that could change it.
   */
  const console_ = watchConsole(page);
  await signIn(page);
  await openATaxpayer(page);
  await page.getByRole('button', { name: /Write down the business/i }).click();
  await page.waitForTimeout(1500);

  await page.getByLabel(/Where they trade from/i).selectOption('BUILDING');
  await page.getByRole('combobox', { name: 'Trade', exact: true }).selectOption('ARTISAN_CRAFT');
  await page.getByLabel(/Machines or equipment/i).fill('8');
  await page.getByLabel(/People working besides the owner/i).fill('5');
  await page.getByRole('button', { name: /Save what you saw/i }).click();

  await expect(page.getByText(/Written down/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Size recorded/i)).toBeVisible();
  await expect(page.locator('body')).not.toContainText('₦');
  await shot(page, 'agent-enum-04-written-down');
  expect(console_.errors, console_.errors.join('\n')).toEqual([]);
});

test('a count taken with no signal is kept on the phone, with no band', async ({ page }) => {
  /*
   * The markets worth enumerating are the ones the network is worst in. An
   * enumeration that needed a connection would be collected where coverage
   * already exists, which is exactly where the missing taxpayers are not.
   *
   * The confirmation cannot say what the online one says: nothing has worked
   * out a band yet. A size shown here would be one the handset invented.
   */
  const console_ = watchConsole(page);
  await signIn(page);
  await openATaxpayer(page);
  await page.getByRole('button', { name: /Write down the business/i }).click();
  await page.waitForTimeout(1500);

  await page.getByLabel(/Where they trade from/i).selectOption('LOCK_UP_SHOP');
  await page.getByRole('combobox', { name: 'Trade', exact: true }).selectOption('ARTISAN_CRAFT');
  await page.getByLabel(/Machines or equipment/i).fill('3');
  await page.getByLabel(/People working besides the owner/i).fill('2');

  // The network drops between filling the form and pressing save, which is
  // how it actually happens in a market.
  await page.context().setOffline(true);
  await page.getByRole('button', { name: /Save what you saw/i }).click();

  await expect(page.getByText(/Held on this phone/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Size recorded/i)).toHaveCount(0);
  await expect(page.getByText(/do not write it down a second time/i)).toBeVisible();
  await shot(page, 'agent-enum-06-held-on-the-phone');

  await page.context().setOffline(false);
  expect(console_.errors, console_.errors.join('\n')).toEqual([]);
});

test('in Hausa, which is what most of these agents read', async ({ page }) => {
  const console_ = watchConsole(page);
  await signIn(page);
  await page.getByRole('button', { name: /switch language/i }).click();
  await page.waitForTimeout(1500);
  await openATaxpayer(page);
  await page.getByRole('button', { name: /Rubuta yadda kasuwancin yake/i }).click();
  await page.waitForTimeout(1500);

  await expect(page.getByText(/Ba kai ne kake sanya harajin ba/i)).toBeVisible({ timeout: 20_000 });
  await shot(page, 'agent-enum-07-hausa');
  expect(console_.errors, console_.errors.join('\n')).toEqual([]);
});
