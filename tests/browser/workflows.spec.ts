/**
 * Workflows, driven through the browser rather than described.
 *
 * `apps.spec.ts` proves the screens render. That was the first half of D-5.
 * This is the second: that a person sitting in front of the portal can
 * actually complete the work, and — more to the point — that someone who
 * should not complete it, cannot.
 *
 * The API tests already prove the money logic exhaustively, so repeating it
 * here would buy nothing. What only a browser can answer is whether the rules
 * survive the trip through the interface:
 *
 *   * is the control reachable at all, by the person who needs it
 *   * does the refusal arrive as something a human can read, on the screen,
 *     rather than as a swallowed 403 and an unchanged page
 *   * do the roles actually differ once rendered, or does everyone see the
 *     same thing
 *
 * State comes from `seed-browser-fixtures.ts`, which walks the real API to
 * build a verified payment and a reversal approved by two officers. The third
 * officer's execution is left for these tests to perform, because that step —
 * a step-up prompt, a maker-checker refusal, a receipt voided — is the one
 * that matters most and the one nothing had ever driven.
 */

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const PORTAL = process.env.PORTAL_URL ?? 'http://localhost:5174';
const FIXTURES = process.env.BROWSER_FIXTURES ?? '/tmp/psirs-browser-fixtures.json';

interface Fixtures {
  taxpayerId: string;
  tin: string;
  transactionId: string;
  transactionReference: string;
  approvalId: string;
  approverPhone: string;
  executorPhone: string;
  password: string;
}

function fixtures(): Fixtures {
  try {
    return JSON.parse(readFileSync(FIXTURES, 'utf8')) as Fixtures;
  } catch {
    throw new Error(
      `No fixtures at ${FIXTURES}. Run scripts/browser-test.sh, which builds them, ` +
        'rather than invoking Playwright directly.',
    );
  }
}

const ROLES = {
  admin: '+2348000000001',
  revenue: '+2348000000002',
  finance: '+2348000000003',
  supervisor: '+2348000000004',
  auditor: '+2348000000005',
} as const;

async function signIn(page: Page, phone: string, password = 'Password123'): Promise<void> {
  await page.goto(PORTAL);
  await page.locator('#phone').fill(phone);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 15_000 });
}

async function openApprovedReversals(page: Page): Promise<void> {
  await page.goto(`${PORTAL}/#/approvals`);
  await expect(page.locator('#approval-status')).toBeVisible({ timeout: 15_000 });
  await page.locator('#approval-status').selectOption('APPROVED');
  await page.waitForTimeout(1500);
}

// ===========================================================================
// The reversal. Three people, and the interface has to hold the line.
// ===========================================================================

test.describe('Executing an approved reversal', () => {
  /**
   * The officer who approved it tries to execute it.
   *
   * This must fail, and it must fail *visibly*. A silent no-op is the worst
   * outcome available: the officer believes the money went back, the taxpayer
   * is still owed, and nothing on the screen disagrees with either of them.
   */
  test('the approver is refused, on screen, in words', async ({ page }) => {
    const fixture = fixtures();
    await signIn(page, fixture.approverPhone);
    await openApprovedReversals(page);

    const execute = page.getByRole('button', { name: 'Execute reversal' });
    await expect(
      execute.first(),
      'the approver should still see the control; the refusal is the platform\'s to make, ' +
        'not something to hide and hope nobody asks why',
    ).toBeVisible();

    await execute.first().click();
    await page.waitForTimeout(3000);

    const content = await page.locator('.content').innerText();
    expect(
      content,
      'the approver executed their own approval, or was refused without being told',
    ).toMatch(/may not also execute|cannot.*execute|different officer/i);

    // And the request is still sitting there, not quietly consumed.
    await expect(page.getByRole('button', { name: 'Execute reversal' }).first()).toBeVisible();
  });

  /**
   * A genuine third officer completes it.
   *
   * The whole path: step-up authentication, the reversal itself, the
   * commission clawed back, and a refund reference the taxpayer can be given.
   * Nothing had ever driven this through the interface.
   */
  test('a third officer completes it through step-up', async ({ page }) => {
    const fixture = fixtures();
    await signIn(page, fixture.executorPhone, fixture.password);
    await openApprovedReversals(page);

    const execute = page.getByRole('button', { name: 'Execute reversal' });
    await expect(execute.first()).toBeVisible();
    await execute.first().click();

    // Step-up issues and verifies an OTP behind this click.
    await page.waitForTimeout(5000);

    const content = await page.locator('.content').innerText();
    expect(content, `approvals screen said: ${content.slice(0, 400)}`).toMatch(
      /reversal executed/i,
    );
    expect(
      content,
      'a reversal with no refund reference leaves nobody able to trace the money',
    ).toMatch(/RFD-\d{4}-\d+/);
    expect(
      content,
      'the commission earned on a reversed payment must be reversed with it',
    ).toMatch(/commission record/i);
  });
});

// ===========================================================================
// Role differentiation, measured rather than eyeballed.
// ===========================================================================

test.describe('The roles differ once rendered', () => {
  /**
   * Sign in as all five and compare what the interface offers.
   *
   * The original complaint was that every role looked the same. The nav is
   * permission-filtered in code and unit-tested, but nothing had ever checked
   * the rendered result — and a gate that is correct in the table and bypassed
   * in the component is exactly the bug that looks fine in review.
   */
  test('each role is offered a different menu', async ({ browser }) => {
    const menus = new Map<string, string[]>();

    for (const [role, phone] of Object.entries(ROLES)) {
      // A fresh context per role. Sharing one page signs the next role into a
      // window that already holds a session, which silently measures the
      // previous role's menu twice.
      const context = await browser.newContext();
      const page = await context.newPage();
      await signIn(page, phone);

      const hrefs = await page
        .locator('.sidebar a')
        .evaluateAll((links) =>
          links.map((link) => link.getAttribute('href') ?? '').filter(Boolean),
        );
      menus.set(role, hrefs);
      expect(hrefs.length, `${role} was offered no screens at all`).toBeGreaterThan(0);
      await context.close();
    }

    const distinct = new Set([...menus.values()].map((paths) => [...paths].sort().join(',')));
    expect(
      distinct.size,
      `roles were offered identical menus: ${JSON.stringify([...menus])}`,
    ).toBe(Object.keys(ROLES).length);

    /*
     * The specific claims, each traceable to a permission rather than to what
     * the menu happened to contain on the day. Asserting only "they differ"
     * would survive the gates being wrong in every particular.
     */
    expect(
      menus.get('auditor'),
      'an auditor holds no approval permission and must not be offered the queue',
    ).not.toContain('#/approvals');
    expect(
      menus.get('supervisor'),
      'a supervisor holds no audit:read and must not be offered the audit log',
    ).not.toContain('#/audit');
    expect(
      menus.get('finance'),
      'payment:reconcile belongs to the finance officer alone',
    ).toContain('#/reconciliation');
    expect(
      menus.get('revenue'),
      'only the finance officer reconciles; the revenue officer should not see that screen',
    ).not.toContain('#/reconciliation');
    expect(menus.get('admin'), 'an administrator manages agent clearance').toContain('#/agents');

    // The supervisor is territory-scoped and should see materially less than
    // the state-wide roles — a useful canary for a gate that has stopped
    // gating, since a broken filter tends to show everyone everything.
    expect(
      menus.get('supervisor')!.length,
      'the territory-scoped supervisor was offered as much as a state-wide officer',
    ).toBeLessThan(menus.get('admin')!.length);
  });

  /**
   * The auditor is the sharpest case: full visibility, no ability to change
   * anything. If a single mutating control renders for them, the read-only
   * guarantee that makes an auditor an auditor is not real.
   */
  test('an auditor is offered no control that changes anything', async ({ page }) => {
    await signIn(page, ROLES.auditor);

    const paths = await page
      .locator('.sidebar a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? '').filter(Boolean));

    const MUTATING = /^(approve|reject|execute|reverse|suspend|revoke|activate|create|add|assign|clear|resolve|deactivate|issue|send|configure|save|update|delete|remove)\b/i;
    const offending: string[] = [];

    for (const path of paths) {
      await page.goto(`${PORTAL}/${path}`);
      await page.waitForTimeout(1200);
      const labels = await page
        .locator('.content button')
        .evaluateAll((buttons) => buttons.map((button) => (button.textContent ?? '').trim()));
      for (const label of labels) {
        if (MUTATING.test(label)) offending.push(`${path}: "${label}"`);
      }
    }

    expect(
      offending,
      `an auditor was offered controls that change state: ${offending.join(', ')}`,
    ).toEqual([]);
  });
});

// ===========================================================================
// The citizen's own workflow — no account, no agent, no office visit.
// ===========================================================================

test.describe('A citizen checks their own tax status', () => {
  test('a TIN returns that citizen\'s standing', async ({ page }) => {
    const fixture = fixtures();
    await page.goto(`${PORTAL}/#/citizen`);
    await expect(page.locator('#citizen-input')).toBeVisible({ timeout: 15_000 });

    await page.locator('#citizen-input').fill(fixture.tin);
    await page.getByRole('button', { name: 'Check status' }).click();
    await page.waitForTimeout(3000);

    const card = await page.locator('.public__card').innerText();
    expect(card, `lookup by TIN ${fixture.tin} said: ${card.slice(0, 300)}`).not.toMatch(
      /NOT FOUND/i,
    );
    expect(
      card,
      'a citizen who looks themselves up should be told where they stand, not shown a number',
    ).toMatch(/up to date|outstanding|compliance|assessed|attention/i);
  });

  test('an unknown TIN says so plainly', async ({ page }) => {
    await page.goto(`${PORTAL}/#/citizen`);
    await expect(page.locator('#citizen-input')).toBeVisible({ timeout: 15_000 });

    await page.locator('#citizen-input').fill('PL00000000');
    await page.getByRole('button', { name: 'Check status' }).click();
    await page.waitForTimeout(3000);

    const card = await page.locator('.public__card').innerText();
    expect(card).toMatch(/NOT FOUND/i);
    // A blank result is the failure where a citizen cannot tell whether their
    // TIN is wrong or the service is down.
    expect(card.length).toBeGreaterThan(40);
  });

  /**
   * A name search must give a count and nothing else.
   *
   * Names are not identifying — the point of the count-only response is that
   * searching "Musa" cannot become a way to read a stranger's tax position.
   */
  test('a name search reveals no individual', async ({ page }) => {
    await page.goto(`${PORTAL}/#/citizen`);
    await expect(page.locator('#citizen-input')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'By name' }).click();
    await page.locator('#citizen-input').fill('Ladi');
    await page.getByRole('button', { name: 'Check status' }).click();
    await page.waitForTimeout(3000);

    const card = await page.locator('.public__card').innerText();
    expect(
      card,
      'a name search disclosed a TIN — anyone could then read that person\'s full position',
    ).not.toMatch(/\bPL-?\d{6,}/);
    expect(card, 'a name search disclosed a compliance score').not.toMatch(/score/i);
  });
});

// ===========================================================================
// Signing out everywhere, as the user experiences it.
// ===========================================================================

test.describe('Session revocation reaches the screen', () => {
  /**
   * The API tests prove the tokens die. This proves the person finds out.
   *
   * What actually happens is worth stating precisely, because it is not the
   * obvious thing: the shell stays on screen until the next reload — the nav
   * is drawn from the cached user — but every request behind it is refused,
   * and the content area says so in words. So no data survives the revocation,
   * and the officer is not left reading a populated screen they no longer have
   * any right to. That distinction is the whole point of testing it in a
   * browser: "the token is rejected" and "the human is told" are different
   * claims, and only the second one protects anybody.
   */
  test('a revoked session shows no data and says why', async ({ page, playwright }) => {
    await signIn(page, ROLES.revenue);
    await page.goto(`${PORTAL}/#/transactions`);
    await page.waitForTimeout(2000);

    // Sign the same officer out everywhere, from outside the browser — as they
    // would from another device on discovering their account was compromised.
    const api = await playwright.request.newContext({
      baseURL: process.env.API_URL ?? 'http://localhost:4000',
    });
    const login = await api.post('/api/v1/auth/login', {
      data: { phone: ROLES.revenue, password: 'Password123' },
      headers: { 'x-app-version': '1.0.0' },
    });
    const { accessToken } = (await login.json()) as { accessToken: string };
    const revoked = await api.post('/api/v1/auth/logout-all', {
      headers: { authorization: `Bearer ${accessToken}`, 'x-app-version': '1.0.0' },
    });
    expect(revoked.status()).toBe(200);
    await api.dispose();

    await page.goto(`${PORTAL}/#/audit`);
    await page.waitForTimeout(4000);

    const content = await page.locator('.content').innerText();
    expect(
      content,
      `the revoked session was told nothing; screen said: ${content.slice(0, 300)}`,
    ).toMatch(/sign in|session has been ended|need to sign in/i);

    // The audit log is the most sensitive screen in the portal. Not one row.
    expect(
      content,
      'a revoked session was still served audit entries',
    ).not.toMatch(/\b(TXN|RCT|RFD)-\d{4}-\d+/);

    // And a reload puts them back where they belong.
    await page.reload();
    await page.waitForTimeout(3000);
    await expect(
      page.locator('#phone'),
      'reloading a revoked session did not return the officer to sign-in',
    ).toBeVisible();
  });
});
