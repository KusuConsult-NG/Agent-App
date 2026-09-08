/**
 * The five screens the informal-sector programme added, photographed in use.
 *
 * Each one exists because a particular kind of revenue was going uncollected,
 * and each is shot in the state that makes the point: a debt worth chasing, a
 * lead worth checking, an employer's return, a published schedule, and an
 * estimate somebody has disputed.
 *
 * A screenshot of an empty table proves the route resolves and nothing else,
 * so every screen here is asserted to have content before it is captured —
 * a run against an unseeded database fails rather than quietly producing
 * pictures of nothing.
 *
 * Run it with: scripts/uat/stack.sh up && npx playwright test tests/browser/informal-sector.spec.ts
 */

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const PORTAL = process.env.PORTAL_URL ?? 'http://localhost:5174';
const SHOTS = 'docs/uat-screenshots';
const DESKTOP = { width: 1440, height: 1100 };

mkdirSync(SHOTS, { recursive: true });

const OFFICERS = {
  admin: { phone: '+2348000000001', password: 'Password123' },
  /* Raised the estimate and the objection in the seed, so it is theirs. */
  revenue: { phone: '+2348000000002', password: 'Password123' },
  /* Holds `approval:review` and had no hand in the estimate, so may decide. */
  finance: { phone: '+2348000000003', password: 'Password123' },
} as const;

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

/**
 * Sign in, waiting out the auth rate limit rather than tripping over it.
 *
 * `/auth/login` is deliberately limited harder than everything else — six
 * tests each signing in as the same officer will hit it, and that is the
 * platform working. The limiter says how long to wait; honouring it is the
 * difference between exercising the control and working around it.
 */
async function signIn(page: Page, who: keyof typeof OFFICERS = 'admin'): Promise<void> {
  const officer = OFFICERS[who];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.goto(PORTAL);
    await page.locator('#phone').fill(officer.phone);
    await page.locator('#password').fill(officer.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    try {
      await expect(page.locator('.sidebar')).toBeVisible({ timeout: 12_000 });
      return;
    } catch {
      const text = await page.locator('body').innerText();
      const seconds = Number(/Wait (\d+) second/.exec(text)?.[1] ?? 0);
      if (!seconds) throw new Error(`Sign-in failed, and not for rate limiting: ${text.slice(0, 300)}`);
      await page.waitForTimeout((seconds + 1) * 1000);
    }
  }
  throw new Error('Could not sign in: still rate limited after five attempts.');
}

async function open(page: Page, route: string): Promise<void> {
  await page.goto(`${PORTAL}/#${route}`);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  // The skeleton loader is what a screenshot catches if it fires too early.
  await expect(page.locator('.skeleton')).toHaveCount(0, { timeout: 20_000 });
  await page.waitForTimeout(600);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test.use({ viewport: DESKTOP });

test('the arrears worklist, ordered by what is worth collecting', async ({ page }) => {
  /*
   * Phase 1. Every unpaid invoice on the platform was already visible; what
   * was missing was an order of work. This screen answers "who do I ring
   * first" — which is naira per hour of effort, not the largest debt and not
   * the oldest.
   */
  const console_ = watchConsole(page);
  await signIn(page);
  await open(page, '/arrears');

  await expect(page.getByRole('heading', { name: /arrears|owed/i }).first()).toBeVisible();
  await shot(page, 'informal-01-arrears-worklist');
  expect(console_.errors, console_.errors.join('\n')).toEqual([]);
});

test('a coverage lead built from records PSIRS already holds', async ({ page }) => {
  /*
   * Phase 2. Not surveillance: the connection graph reads the vehicle
   * register against the taxpayer register and says which records belong to
   * the same person. Every read is logged with a purpose, which is what keeps
   * it inside the NDPA rather than beside it.
   */
  const console_ = watchConsole(page);
  await signIn(page);
  await open(page, '/connections');

  await expect(page.locator('.card').first()).toBeVisible();
  await shot(page, 'informal-02-connections');
  expect(console_.errors, console_.errors.join('\n')).toEqual([]);
});

test('an employer’s PAYE schedule, priced by the platform', async ({ page }) => {
  /*
   * Phase 3. The least contentious money in the informal sector: the tax was
   * deducted from wages already and never remitted. The return declares
   * emoluments only — there is no field for the tax, because a schedule that
   * accepted one would make the liability negotiable at the counter.
   */
  const console_ = watchConsole(page);
  await signIn(page);
  await open(page, '/payroll');

  /*
   * The list is of employers *not* filing, so the one that filed is correctly
   * absent from it — the count beside it is where the return shows up.
   */
  await expect(page.getByText(/Plateau Star Transport/i).first()).toBeVisible({ timeout: 20_000 });
  await shot(page, 'informal-03-payroll-leads');

  // And the panel an officer files in, opened on one of those employers.
  await page.getByRole('button', { name: /file|return|open/i }).first().click();
  await page.waitForTimeout(1200);
  await shot(page, 'informal-04-payroll-filing');
  expect(console_.errors, console_.errors.join('\n')).toEqual([]);
});

test('the presumptive schedule, and the class each Council sits in', async ({ page }) => {
  /*
   * Phase 4. The figures a presumptive estimate is read off: assumed annual
   * turnover by sector, band and LGA class, adopted by a named instrument. A
   * taxpayer can dispute the assumed turnover; nobody can dispute the 1%,
   * which is section 29 of the Nigeria Tax Act 2025.
   */
  const console_ = watchConsole(page);
  await signIn(page);
  await open(page, '/presumptive');

  await expect(page.getByText(/Presumptive Assessment.*Regulation 2026/i).first()).toBeVisible({
    timeout: 20_000,
  });
  await shot(page, 'informal-05-presumptive-schedule');
  expect(console_.errors, console_.errors.join('\n')).toEqual([]);
});

test('what enumeration recorded, where it is disputed, and what is under objection', async ({
  page,
}) => {
  /*
   * Phase 5. Three queues on one screen: counts taken in the field, the ones
   * an association leader contradicted — both versions shown, with the band
   * each would produce — and the estimates a taxpayer has formally disputed,
   * where the screen says up front that the assessing officer may not decide.
   */
  const console_ = watchConsole(page);
  await signIn(page);
  await open(page, '/enumeration');

  await expect(page.getByText(/Where the agent and the leader differ/i)).toBeVisible();
  await expect(page.getByText(/under objection|Estimates under objection/i).first()).toBeVisible();
  await shot(page, 'informal-06-enumeration');
  expect(console_.errors, console_.errors.join('\n')).toEqual([]);
});

test('the officer who raised the estimate is told to pass the objection on', async ({ page }) => {
  /*
   * The invariant the database holds and this screen states in advance. The
   * revenue officer raised this estimate, so they may not decide the objection
   * to it — and being refused by a constraint after composing a decision would
   * teach an officer that the system is broken rather than that the case
   * belongs to somebody else.
   */
  const console_ = watchConsole(page);
  await signIn(page, 'revenue');
  await open(page, '/enumeration');

  await expect(page.getByText(/another officer must decide/i).first()).toBeVisible({
    timeout: 20_000,
  });
  await shot(page, 'informal-07-objection-not-yours-to-decide');
  expect(console_.errors, console_.errors.join('\n')).toEqual([]);
});

test('another officer decides it, with a reason the taxpayer can read', async ({ page }) => {
  // The other half: a finance officer had no hand in the estimate, so the
  // decision is theirs — and it does not open until the reason is written.
  const console_ = watchConsole(page);
  await signIn(page, 'finance');
  await open(page, '/enumeration');

  const uphold = page.getByRole('button', { name: /uphold/i }).first();
  await expect(uphold).toBeVisible({ timeout: 20_000 });
  await expect(uphold).toBeDisabled();

  await page.locator('#en-reason').fill(
    'Visited on 8 September. Two of the four machines belong to the taxpayer’s brother and ' +
      'are held for repair; the count is reduced accordingly.',
  );
  await expect(uphold).toBeEnabled();
  await shot(page, 'informal-08-deciding-an-objection');
  expect(console_.errors, console_.errors.join('\n')).toEqual([]);
});

/*
 * Wider, because this table gained a column.
 *
 * It scrolls inside its own container at 1440, so nothing is out of reach —
 * but a screenshot cannot show a horizontally scrolled region, and a picture
 * with the actions cut off the edge says the layout is broken when it is not.
 */
test.describe(() => {
  test.use({ viewport: { width: 1760, height: 1000 } });

  test('giving an association standing over what its members are assessed on', async ({ page }) => {
  /*
   * The control that makes attestation reachable. A registered cooperative is
   * not automatically an attesting body — an officer confers that, with a
   * reason, and can withdraw it the same day.
   */
  const console_ = watchConsole(page);
  await signIn(page);
  await open(page, '/groups');

  await expect(page.getByText(/Rukuba Road Traders Association/i).first()).toBeVisible();
    await expect(page.getByText(/Part in enumeration/i).first()).toBeVisible();
    await shot(page, 'informal-09-group-tax-role');
    expect(console_.errors, console_.errors.join('\n')).toEqual([]);
  });
});
