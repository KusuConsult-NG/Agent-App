/**
 * A reversal takes three people, and the interface has to hold that line.
 *
 * Reversing a payment is the most consequential thing an officer can do to a
 * citizen's record: money goes back, a receipt is voided, and the commission
 * earned on it is clawed back from an agent who has already been paid. The
 * rule is maker-checker with a third pair of hands — the officer who approves
 * it may not also execute it — and it is guarded by step-up authentication on
 * top of that.
 *
 * The API tests prove the rule exhaustively: `step-up-is-a-second-factor`,
 * `step-up-operations` and `step-up-reachable` are all in the suite. What none
 * of them can answer is whether the rule survives the trip through the
 * interface, and until this file there was **no browser coverage of step-up at
 * all**. Two things only a browser can settle:
 *
 *   * does the refusal arrive as something a human can read, on the screen,
 *     rather than as a swallowed 403 and a page that has not changed — an
 *     officer who believes the money went back, and a taxpayer still owed it,
 *     is the worst outcome available here
 *   * can a genuine third officer actually complete it, step-up prompt and all
 *
 * Three seeded officers play the three parts, so nothing is written to the
 * database behind the API's back: the revenue officer raises it, the finance
 * officer approves it, and the second finance officer — `+2348000000006`, who
 * exists in the demo seed for exactly this reason — executes it.
 */

import { test, expect, type Page } from '@playwright/test';

const PORTAL = process.env.PORTAL_URL ?? 'http://localhost:5174';
const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';

const AGENT = {
  phone: '+2347010000001',
  password: 'FieldAgent2026',
  device: 'demo-agent-device-000001',
};
const REQUESTER = { phone: '+2348000000002', password: 'Password123' }; // revenue officer
const APPROVER = { phone: '+2348000000003', password: 'Password123' }; // finance officer
const EXECUTOR = { phone: '+2348000000006', password: 'Password123' }; // second finance officer

interface Options {
  token?: string;
  device?: string;
  idempotencyKey?: string;
}

async function call<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  options: Options = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-app-version': '1.0.0',
  };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.device) headers['x-device-id'] = options.device;
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (response.status >= 400) {
    throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 400)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

async function signIn(
  who: { phone: string; password: string },
  device?: string,
): Promise<string> {
  const session = await call<{ accessToken: string }>(
    'POST',
    '/auth/login',
    { phone: who.phone, password: who.password },
    { device },
  );
  return session.accessToken;
}

/**
 * A paid transaction, reversed as far as two officers can take it.
 *
 * Built through the API rather than the screens, deliberately. Driving a
 * collection through the agent PWA is already covered by `uat.spec.ts`, and
 * repeating it here would make this file fail for reasons that have nothing to
 * do with what it is about. What these tests own is the last step.
 */
async function anApprovedReversal(): Promise<{ approvalId: string }> {
  const stamp = Date.now().toString().slice(-6);
  const agentToken = await signIn(AGENT, AGENT.device);
  const agentAuth: Options = { token: agentToken, device: AGENT.device };

  const lgas = await call<{ id: string }[]>('GET', '/reference/lgas');

  const taxpayer = await call<{ taxpayerId: string }>(
    'POST',
    '/taxpayers',
    {
      taxpayerType: 'INDIVIDUAL',
      firstName: 'Ladi',
      // Unique per run: the duplicate guard refuses a second record with the
      // same name on the same phone, which is exactly what it is for.
      lastName: `Bulus${stamp}`,
      /*
       * The last digit is load-bearing. The development TIN stub branches on
       * it — 7 defers, 8 is unreachable, 9 declines — so a phone ending in a
       * timestamp digit has no TIN about a third of the time, and the failure
       * looks like anything but its cause.
       */
      phone: `+23480${stamp}11`,
      address: 'Kuru village square',
      lgaId: lgas[0]!.id,
      consentGiven: true,
      declarationAccepted: true,
    },
    { ...agentAuth, idempotencyKey: `rev3-tp-${stamp}` },
  );

  const items = await call<{ id: string; code: string }[]>('GET', '/revenue/items', undefined, {
    token: agentToken,
  });
  const item = items.find((candidate) => candidate.code === 'SHOPS-KIOSKS') ?? items[0]!;

  const assessment = await call<{ transactionId: string }>(
    'POST',
    '/revenue/assessments',
    { taxpayerId: taxpayer.taxpayerId, revenueItemId: item.id, inputs: {} },
    { ...agentAuth, idempotencyKey: `rev3-as-${stamp}` },
  );

  const initiated = await call<{ gatewayReference: string }>(
    'POST',
    '/payments/initiate',
    { transactionId: assessment.transactionId },
    { ...agentAuth, idempotencyKey: `rev3-pay-${stamp}` },
  );

  // The gateway confirms it. Nothing else in the platform can.
  await call(
    'POST',
    '/payments/simulate',
    { gatewayReference: initiated.gatewayReference, outcome: 'SUCCESS', deliverWebhook: true },
    agentAuth,
  );

  const requesterToken = await signIn(REQUESTER);

  /*
   * The amount is read, not assumed.
   *
   * A reversal returns the payment it reverses in full, and the platform
   * refuses one that does not — on screen, in words, which is how this was
   * found: the figure carried over from an older fixture was 100000 kobo
   * against a payment that is now 300000, and the approvals screen said so
   * rather than reversing the wrong amount. Reading it keeps the test honest
   * when the catalogue price changes again.
   */
  const payments = await call<{ gateway_reference: string; amount_kobo: string }[]>(
    'GET',
    '/payments?limit=50',
    undefined,
    { token: requesterToken },
  );
  const paid = payments.find((row) => row.gateway_reference === initiated.gatewayReference);
  if (!paid) throw new Error(`the API does not know gateway reference ${initiated.gatewayReference}`);
  const approverToken = await signIn(APPROVER);

  const approval = await call<{ approvalId: string }>(
    'POST',
    '/government/approvals',
    {
      approvalType: 'PAYMENT_REVERSAL',
      entityType: 'transaction',
      entityId: assessment.transactionId,
      payload: {
        amountKobo: paid.amount_kobo,
        reason: 'Charged twice for the same kiosk in this period',
        refundType: 'REVERSAL',
      },
      reason: 'Duplicate assessment confirmed against the ward register.',
    },
    { token: requesterToken },
  );

  await call(
    'POST',
    `/government/approvals/${approval.approvalId}/decide`,
    { decision: 'APPROVE', reason: 'Duplicate confirmed against the record.' },
    { token: approverToken },
  );

  return { approvalId: approval.approvalId };
}

async function signInToPortal(page: Page, who: { phone: string; password: string }): Promise<void> {
  await page.goto(PORTAL);
  await page.locator('#phone').fill(who.phone);
  await page.locator('#password').fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 20_000 });
}

/**
 * The approvals screen, filtered to what is waiting to be executed.
 *
 * Polls for the row rather than settling the network once. Changing the filter
 * fires a fetch and re-renders, and `networkidle` resolved against the *page*
 * load rather than that fetch — so the first attempt at this read "No approval
 * requests match this filter" from a table that was about to have one, which
 * is a race that would have failed in CI perhaps one run in three.
 */
async function openApprovedReversals(page: Page): Promise<void> {
  await page.goto(`${PORTAL}/#/approvals`);
  await expect(page.locator('#approval-status')).toBeVisible({ timeout: 20_000 });

  // Selected once, then waited on. Re-selecting inside the poll looks like the
  // safer shape and is the opposite: `selectOption` on a value already chosen
  // fires no change event, so the refetch never happens and the poll spends
  // its whole timeout re-reading the render it is waiting to replace.
  await page.locator('#approval-status').selectOption('APPROVED');

  await expect
    .poll(async () => page.locator('.content').innerText(), {
      timeout: 30_000,
      intervals: [500, 1000, 2000],
      message: 'the approved reversal never reached the table',
    })
    .not.toMatch(/No approval requests match/i);
}

test.describe('executing an approved reversal', () => {
  // The stack is slow to seed and both tests need the same reversal, but they
  // must not share one: the second executes it, which would leave the first
  // asserting against a request that is no longer executable.
  test.slow();

  test('the officer who approved it is refused, on screen, in words', async ({ page }) => {
    await anApprovedReversal();
    await signInToPortal(page, APPROVER);
    await openApprovedReversals(page);

    const execute = page.getByRole('button', { name: 'Execute reversal' });
    await expect(
      execute.first(),
      'the approver should still be offered the control; the refusal is the platform’s to ' +
        'make and say, not something to hide and hope nobody asks why',
    ).toBeVisible({ timeout: 20_000 });

    await execute.first().click();

    // The refusal has to reach the screen. Waiting on the text rather than a
    // fixed pause, so a slow answer is not read as a silent one.
    await expect(async () => {
      const content = await page.locator('.content').innerText();
      expect(
        content,
        'the approver executed their own approval, or was refused without being told',
      ).toMatch(/may not also execute|cannot.*execute|different officer|ba za ka iya/i);
    }).toPass({ timeout: 20_000 });

    // And the request is still sitting there, not quietly consumed.
    await expect(page.getByRole('button', { name: 'Execute reversal' }).first()).toBeVisible();
  });

  test('a third officer completes it through step-up', async ({ page }) => {
    await anApprovedReversal();
    await signInToPortal(page, EXECUTOR);
    await openApprovedReversals(page);

    const execute = page.getByRole('button', { name: 'Execute reversal' });
    await expect(execute.first()).toBeVisible({ timeout: 20_000 });
    await execute.first().click();

    /*
     * Step-up issues and verifies a one-time code behind this click. In
     * development the API returns the code in the response and `stepUp()` uses
     * it; if it ever stopped doing so the portal falls back to `window.prompt`,
     * which Playwright dismisses — so this fails with "a one-time code is
     * required" rather than hanging, which is the failure worth having.
     *
     * Asserted on the refund reference rather than on the sentence around it.
     * That sentence is an English literal in `Finance.tsx` — it should come
     * from the dictionary, and pinning a test to it would hold the bug in
     * place. The reference is the thing a taxpayer is given to trace the money,
     * and it reads the same in either language.
     */
    await expect(async () => {
      const content = await page.locator('.content').innerText();
      expect(
        content,
        `a reversal with no refund reference leaves nobody able to trace the money. ` +
          `Screen said: ${content.slice(0, 400)}`,
      ).toMatch(/RFD-\d{4}-\d+/);
    }).toPass({ timeout: 30_000 });
  });
});
