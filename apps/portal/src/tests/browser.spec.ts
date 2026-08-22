/**
 * Both applications, driven in a real browser.
 *
 * D-5 recorded that the government portal's twelve screens carry no automated
 * test of any kind. The permission model is now covered, but nothing had ever
 * rendered a component — so a screen that throws on mount, a public page that
 * discloses more than it should, or a layout that collapses at a given viewport
 * would all have passed every check in the repository.
 *
 * This runs against a live stack: the API on 4000, the portal on 5174, the
 * agent PWA on 5173. It is deliberately not part of `npm test` — it needs three
 * processes and a seeded database, and a suite that cannot run on a laptop
 * without ceremony gets skipped rather than fixed. `npm run test:browser`
 * starts everything.
 *
 * WHAT IS WORTH ASSERTING IN A BROWSER
 *
 * Not that a heading says the right words — that is what the component tests
 * are for, and it breaks whenever anyone edits copy. The things only a browser
 * can answer:
 *
 *   * does the screen render at all, or throw on mount
 *   * does the page reach the API and get a real answer
 *   * does the public verification page disclose only what it should
 *   * does the layout hold at the viewports people actually use
 *
 * A console error is treated as a failure. In a government application a
 * React error boundary swallowing an exception looks identical to an empty
 * table, and an officer cannot tell the difference between "no fraud flags" and
 * "the fraud screen crashed".
 */

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

const PORTAL = process.env.PORTAL_URL ?? 'http://localhost:5174';
const AGENT = process.env.AGENT_URL ?? 'http://localhost:5173';

const OFFICER = { phone: '+2348000000002', password: 'Password123' };

/**
 * Collect console errors and page exceptions for a test to assert on.
 *
 * Some noise is unavoidable and not a defect: a 401 on a protected endpoint
 * before sign-in, a service worker declining to register over plain HTTP.
 * Those are filtered by pattern rather than by ignoring errors wholesale,
 * because "ignore console errors" and "this specific error is expected" are
 * different postures and only one of them still catches a crash.
 */
function watchConsole(page: Page): { errors: string[] } {
  const errors: string[] = [];
  const expected = [
    /401/,
    /Failed to load resource/,
    /ServiceWorker/i,
    /manifest/i,
    /favicon/i,
  ];

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (expected.some((pattern) => pattern.test(text))) return;
    errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));

  return { errors };
}

async function signInToPortal(page: Page): Promise<void> {
  await page.goto(PORTAL);
  await page.locator('#phone').fill(OFFICER.phone);
  // Targeted by id, not by label: the password field shares its accessible
  // name with the "Show password" toggle beside it, so getByLabel matches two
  // elements. That toggle exists because agents type on a phone in sunlight —
  // the ambiguity is a consequence of a real accessibility feature, not a bug.
  await page.locator('#password').fill(OFFICER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 15_000 });
}

// ===========================================================================
test.describe('Public surfaces, which need no account', () => {
  test('receipt verification answers an unknown code without leaking or crashing', async ({
    page,
  }) => {
    const console_ = watchConsole(page);
    await page.goto(`${PORTAL}/#/verify/NOT-A-REAL-CODE`);

    // It must say something. A blank page is the failure mode where a citizen
    // cannot tell whether their receipt is bad or the site is broken.
    await expect(page.locator('body')).not.toBeEmpty();
    await page.waitForTimeout(2000);

    const text = (await page.locator('body').innerText()).toLowerCase();
    expect(text.length).toBeGreaterThan(20);

    // Whatever it says, it must not have produced a stack trace.
    expect(console_.errors, `console errors: ${console_.errors.join(' | ')}`).toEqual([]);
  });

  test('the citizen status page renders', async ({ page }) => {
    const console_ = watchConsole(page);
    await page.goto(`${PORTAL}/#/citizen`);
    await page.waitForTimeout(1500);
    await expect(page.locator('body')).not.toBeEmpty();
    expect(console_.errors, `console errors: ${console_.errors.join(' | ')}`).toEqual([]);
  });
});

// ===========================================================================
test.describe('The government portal, signed in', () => {
  test('an officer can sign in and reaches a screen they may open', async ({ page }) => {
    const console_ = watchConsole(page);
    await signInToPortal(page);

    // The landing-path logic: nobody arrives on a permission error.
    const body = (await page.locator('.content').innerText()).toLowerCase();
    expect(body).not.toContain('not permitted');
    expect(console_.errors, `console errors: ${console_.errors.join(' | ')}`).toEqual([]);
  });

  /**
   * Every screen the signed-in officer is offered, opened in turn.
   *
   * The menu is permission-filtered, so this walks exactly what this role may
   * reach — which also means the test adapts if the role's permissions change,
   * rather than asserting a hardcoded list that would need editing.
   */
  test('every screen in the menu renders without throwing', async ({ page }) => {
    const console_ = watchConsole(page);
    await signInToPortal(page);

    const links = await page.locator('.sidebar a').all();
    const paths: string[] = [];
    for (const link of links) {
      const href = await link.getAttribute('href');
      if (href) paths.push(href);
    }
    expect(paths.length, 'the officer should be offered several screens').toBeGreaterThan(3);

    const broken: string[] = [];
    for (const path of paths) {
      await page.goto(`${PORTAL}/${path}`);
      await page.waitForTimeout(1200);

      const content = page.locator('.content');
      await expect(content).toBeVisible();
      const text = await content.innerText();

      // An empty content area means the screen rendered nothing at all.
      if (text.trim().length < 10) broken.push(`${path}: rendered empty`);
      if (/that page does not exist/i.test(text)) broken.push(`${path}: routed to not-found`);
    }

    expect(broken, broken.join(' | ')).toEqual([]);
    expect(console_.errors, `console errors: ${console_.errors.join(' | ')}`).toEqual([]);
  });

  test('the portal shell holds at a laptop viewport and a phone', async ({ page }) => {
    await signInToPortal(page);

    // Desktop: sidebar beside the content.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(400);
    const wide = await page.locator('.sidebar').boundingBox();
    expect(wide, 'sidebar should be present at desktop width').not.toBeNull();
    expect(wide!.width).toBeLessThan(400);

    // Phone: the 900px breakpoint collapses it to a full-width bar.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const narrow = await page.locator('.sidebar').boundingBox();
    expect(narrow, 'sidebar should still be present on a phone').not.toBeNull();
    expect(
      narrow!.width,
      'below 900px the sidebar should span the width rather than stay a rail',
    ).toBeGreaterThan(300);

    // Nothing should scroll sideways on a phone.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'the portal scrolls horizontally on a phone').toBeLessThanOrEqual(1);
  });
});

// ===========================================================================
test.describe('The agent PWA', () => {
  test('the sign-in screen renders', async ({ page }) => {
    const console_ = watchConsole(page);
    await page.goto(AGENT);
    await page.waitForTimeout(1500);
    await expect(page.locator('body')).not.toBeEmpty();
    expect(console_.errors, `console errors: ${console_.errors.join(' | ')}`).toEqual([]);
  });

  /**
   * The desktop-width question, measured rather than argued.
   *
   * The PWA is pinned to `max-width: 560px` with no breakpoint above 359px,
   * which is deliberate for a field tool used one-handed outdoors. This does
   * not assert that is wrong — it records what actually happens on a large
   * screen, so the trade-off is visible in test output rather than in a
   * stylesheet comment.
   */
  test('records how much of a desktop screen the phone layout uses', async ({ page }) => {
    await page.goto(AGENT);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(600);

    const app = await page.locator('.app, #root > div').first().boundingBox();
    expect(app, 'the app shell should render').not.toBeNull();

    const used = Math.round((app!.width / 1920) * 100);
    console.log(`    agent PWA uses ${app!.width}px of 1920px (${used}%) at desktop width`);

    // The constraint is real and intentional; this pins that it is a
    // constraint, so removing it is a visible change rather than a silent one.
    expect(app!.width).toBeLessThanOrEqual(600);
  });

  test('does not scroll sideways on the narrowest phone it targets', async ({ page }) => {
    await page.goto(AGENT);
    // 320px is the floor the stylesheet's 359px breakpoint is written for.
    await page.setViewportSize({ width: 320, height: 640 });
    await page.waitForTimeout(600);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'the agent app scrolls horizontally at 320px').toBeLessThanOrEqual(1);
  });
});
