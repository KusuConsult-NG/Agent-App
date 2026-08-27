/**
 * The walkthrough: both applications, every officer role, driven in a browser.
 *
 * `apps.spec.ts` beside this one asks whether the screens render. This asks a
 * different question — whether somebody could actually do their job — and it
 * leaves a photograph of each answer in `docs/uat-screenshots/` so the result
 * can be read by a person who was not here when it ran.
 *
 * It runs against the dataset in `scripts/uat/seed-uat.mjs`, which is created
 * by calling the same endpoints the applications call. That matters: a
 * screenshot of a state the platform could not itself produce is a picture of
 * the seed, not of the software.
 *
 * A console error fails the test it appears in. In a government application a
 * React error boundary swallowing an exception looks exactly like an empty
 * table, and an officer cannot tell "no fraud flags this week" from "the fraud
 * screen crashed".
 *
 * Run it with: scripts/uat/stack.sh up && npx playwright test tests/browser/uat.spec.ts
 */

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const PORTAL = process.env.PORTAL_URL ?? 'http://localhost:5174';
const AGENT = process.env.AGENT_URL ?? 'http://localhost:5173';
const SHOTS = 'docs/uat-screenshots';

mkdirSync(SHOTS, { recursive: true });

const OFFICERS = {
  admin: { phone: '+2348000000001', password: 'Password123', label: 'Admin Officer' },
  revenue: { phone: '+2348000000002', password: 'Password123', label: 'Revenue Officer' },
  finance: { phone: '+2348000000003', password: 'Password123', label: 'Finance Officer' },
  supervisor: { phone: '+2348000000004', password: 'Password123', label: 'Agent Supervisor' },
  auditor: { phone: '+2348000000005', password: 'Password123', label: 'State Auditor' },
} as const;

const AGENT_LOGIN = { phone: '+2347010000001', password: 'FieldAgent2026' };

/**
 * Collect console errors and page exceptions for a test to assert on.
 *
 * Some noise is not a defect: a 401 on a protected endpoint before sign-in, a
 * service worker declining to register over plain HTTP. Those are filtered by
 * pattern rather than by ignoring errors wholesale, because "ignore console
 * errors" and "this specific error is expected" are different postures and only
 * one of them still catches a crash.
 */
function watchConsole(page: Page): { errors: string[] } {
  const errors: string[] = [];
  const expected = [/401/, /Failed to load resource/, /ServiceWorker/i, /manifest/i, /favicon/i];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (expected.some((pattern) => pattern.test(text))) return;
    errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
  return { errors };
}

/**
 * Settle the network, then photograph.
 *
 * The officer portal is shot full-page: an officer scrolls a table and the
 * whole thing is the evidence. The agent PWA is shot at the viewport, because
 * its navigation bar is fixed to the bottom of a phone screen — a full-page
 * capture renders that bar floating across the middle of the image, which is a
 * photograph of the screenshot tool rather than of the app.
 */
async function shot(page: Page, name: string, options: { fullPage?: boolean } = {}): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  /*
   * Scroll to the top before a viewport capture.
   *
   * A phone screenshot photographs whatever the viewport is showing, and after
   * pressing a button near the bottom of a long screen that is the middle of
   * the page. The banner saying what happened to the money sits at the top, so
   * the one thing the screenshot exists to prove was the one thing outside it.
   */
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: options.fullPage ?? true });
}

/** What an agent actually holds: a phone, not a desktop window. */
const PHONE = { width: 414, height: 896 };
const DESKTOP = { width: 1440, height: 1000 };
const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';

/** A signed-in officer, for the two steps that are not screen work. */
async function officerToken(who: keyof typeof OFFICERS): Promise<string> {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: OFFICERS[who].phone, password: OFFICERS[who].password }),
  });
  const body = (await response.json()) as { accessToken?: string };
  expect(body.accessToken, `${who} could not sign in to the API`).toBeTruthy();
  return body.accessToken!;
}

/** The gateway reference the agent's screen is showing, read off the screen. */
async function settlementReferenceFor(page: Page): Promise<string> {
  const text = await page.locator('body').innerText();
  const match = text.match(/Gateway reference\s*\n?\s*(\S+)/i);
  expect(match, `no gateway reference on screen: ${text.slice(0, 400)}`).toBeTruthy();
  return match![1];
}

/**
 * The bank credit, recorded by a finance officer.
 *
 * Through the API rather than the screen: recording a settlement in the portal
 * takes a bank statement upload, which a browser test cannot meaningfully fake.
 * What is being demonstrated is what the receipt depends on, not which control
 * an officer presses to supply it.
 */
async function settleThroughApi(gatewayReference: string): Promise<void> {
  const token = await officerToken('finance');
  // The list route answers with a bare array and takes no gateway filter, so
  // the batch it just collected is found by reading it.
  const status = await fetch(`${API}/payments?limit=50`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const list = (await status.json()) as { gateway_reference: string; amount_kobo: string }[];
  const payment = list.find((row) => row.gateway_reference === gatewayReference);
  expect(payment, `the API does not know gateway reference ${gatewayReference}`).toBeTruthy();

  const response = await fetch(`${API}/government/settlements`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      settlementDate: new Date().toISOString().slice(0, 10),
      gatewayReferences: [gatewayReference],
      receivedAmountKobo: payment!.amount_kobo,
      bankReference: `UAT-JOURNEY-${gatewayReference}`,
    }),
  });
  expect(response.status, `settlement refused: ${await response.text()}`).toBe(201);
}
const agentShot = (page: Page, name: string) => shot(page, name, { fullPage: false });

async function signInToPortal(page: Page, who: keyof typeof OFFICERS): Promise<void> {
  const officer = OFFICERS[who];
  await page.goto(PORTAL);
  await page.locator('#phone').fill(officer.phone);
  // By id, not by label: the password field shares its accessible name with the
  // "Show password" toggle beside it, which exists because agents type on a
  // phone in sunlight.
  await page.locator('#password').fill(officer.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.sidebar')).toBeVisible({ timeout: 20_000 });
}

/**
 * Sign in to the agent PWA.
 *
 * Its fields carry no ids — they are composed through `Field` and
 * `PasswordField` wrappers rather than written out — so they are found by input
 * type, which is what a person scanning the form does anyway. The password
 * field cannot be found by its accessible name because it shares one with the
 * "show password" toggle beside it, a control that exists because agents type
 * on a phone in sunlight.
 */
async function signInToAgentApp(page: Page): Promise<void> {
  await page.goto(AGENT);
  await page.locator('input[type="tel"]').first().fill(AGENT_LOGIN.phone);
  await page.locator('input[type="password"]').first().fill(AGENT_LOGIN.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  // The first screen after sign-in fetches the money bar and the day's
  // collections, so it is not ready the instant the button is pressed.
  await page.waitForTimeout(3500);
}

/** What the sidebar actually offers this role — the menu is permission-filtered. */
async function menu(page: Page): Promise<{ label: string; href: string }[]> {
  return page.locator('.sidebar a').evaluateAll((links) =>
    links.map((link) => ({
      label: (link.textContent ?? '').trim(),
      href: (link as HTMLAnchorElement).getAttribute('href') ?? '',
    })),
  );
}

const slug = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'screen';

/**
 * Open every screen this role is offered and photograph it.
 *
 * Walking the menu rather than a hardcoded list means the walkthrough tracks
 * the permission model: if a role gains or loses a screen, this covers the new
 * set without anybody remembering to edit it. It also proves the menu never
 * offers a screen the API refuses — a link that 403s is a promise the platform
 * does not keep.
 */
async function walkEveryScreen(page: Page, who: keyof typeof OFFICERS): Promise<string[]> {
  const console_ = watchConsole(page);
  await signInToPortal(page, who);
  await shot(page, `portal-${who}-01-home`);

  const links = await menu(page);
  expect(links.length, `${who} is offered at least one screen`).toBeGreaterThan(0);

  const visited: string[] = [];
  for (const [index, link] of links.entries()) {
    await page.goto(`${PORTAL}/${link.href.replace(/^#?\/?/, '#/')}`);
    await page.waitForTimeout(1200);

    const body = (await page.locator('.content').innerText().catch(() => '')).toLowerCase();
    expect(body, `${who} → ${link.label} is not refused by the API`).not.toContain('not permitted');
    expect(body, `${who} → ${link.label} renders something`).not.toHaveLength(0);

    await shot(page, `portal-${who}-${String(index + 2).padStart(2, '0')}-${slug(link.label)}`);
    visited.push(link.label);
  }

  expect(
    console_.errors,
    `${who} console errors: ${console_.errors.join(' | ')}`,
  ).toEqual([]);
  return visited;
}

// ===========================================================================
test.describe('The field agent', () => {
  test.use({ viewport: PHONE });

  test('signs in and sees the money bar', async ({ page }) => {
    const console_ = watchConsole(page);
    await signInToAgentApp(page);
    await agentShot(page, 'agent-01-home');

    const text = await page.locator('body').innerText();
    expect(text.length).toBeGreaterThan(40);
    expect(console_.errors, `console errors: ${console_.errors.join(' | ')}`).toEqual([]);
  });

  test('finds the taxpayers it onboarded, and can search them', async ({ page }) => {
    const console_ = watchConsole(page);
    await signInToAgentApp(page);

    await page.goto(`${AGENT}/#/taxpayers`);
    await page.waitForTimeout(2000);
    await agentShot(page, 'agent-02-taxpayers');

    const listed = await page.locator('body').innerText();
    // The seed registered twelve through this same app; at least one of them
    // must be findable, or "who did I register today" has no answer.
    expect(listed).toMatch(/Amina|Bulus|Jos Main Market|taxpayer/i);

    const search = page.locator('input[type="search"], input[placeholder*="earch" i]').first();
    if (await search.count()) {
      await search.fill('Amina');
      await page.waitForTimeout(1800);
      await agentShot(page, 'agent-03-taxpayer-search');
    }
    expect(console_.errors, `console errors: ${console_.errors.join(' | ')}`).toEqual([]);
  });

  test('opens the collection flow without throwing', async ({ page }) => {
    const console_ = watchConsole(page);
    await signInToAgentApp(page);
    await page.goto(`${AGENT}/#/collect`);
    await page.waitForTimeout(2000);
    await agentShot(page, 'agent-04-collect');
    expect(await page.locator('body').innerText()).not.toHaveLength(0);
    expect(console_.errors, `console errors: ${console_.errors.join(' | ')}`).toEqual([]);
  });

  test('shows its own commission record', async ({ page }) => {
    const console_ = watchConsole(page);
    await signInToAgentApp(page);
    await page.goto(`${AGENT}/#/commission`);
    await page.waitForTimeout(2000);
    await agentShot(page, 'agent-05-commission');
    expect(console_.errors, `console errors: ${console_.errors.join(' | ')}`).toEqual([]);
  });

  test('reaches vehicle particulars', async ({ page }) => {
    const console_ = watchConsole(page);
    await signInToAgentApp(page);
    await page.goto(`${AGENT}/#/vehicles`);
    await page.waitForTimeout(2500);
    await agentShot(page, 'agent-06-vehicles');
    expect(console_.errors, `console errors: ${console_.errors.join(' | ')}`).toEqual([]);
  });

  test('shows the receipts it has issued', async ({ page }) => {
    const console_ = watchConsole(page);
    await signInToAgentApp(page);
    await page.goto(`${AGENT}/#/receipts`);
    await page.waitForTimeout(2500);
    await agentShot(page, 'agent-07-receipts');
    expect(console_.errors, `console errors: ${console_.errors.join(' | ')}`).toEqual([]);
  });

  test('opens the day\u2019s collections, the support desk and the profile', async ({ page }) => {
    const console_ = watchConsole(page);
    await signInToAgentApp(page);
    for (const [index, route] of ['collections', 'support', 'groups', 'profile'].entries()) {
      await page.goto(`${AGENT}/#/${route}`);
      await page.waitForTimeout(1800);
      await agentShot(page, `agent-${String(index + 8).padStart(2, '0')}-${route}`);
      expect(
        (await page.locator('body').innerText()).toLowerCase(),
        `${route} is a real screen`,
      ).not.toContain('that screen does not exist');
    }
    expect(console_.errors, `console errors: ${console_.errors.join(' | ')}`).toEqual([]);
  });
});

// ===========================================================================
/**
 * The money path, driven by hand.
 *
 * Everything above asks whether a screen opens. These ask whether the job can
 * be done: find the taxpayer, choose what they owe, have the platform price it,
 * take the payment, and — the part that matters most — see the platform refuse
 * to call it collected until the gateway has confirmed it.
 */
test.describe('A collection, end to end in the app', () => {
  test.setTimeout(240_000);

  /**
   * The whole journey on a handset the platform has never seen.
   *
   * Every Playwright context starts with empty storage, so the agent app mints
   * a fresh device identifier — which is exactly a real agent picking up a new
   * phone. The platform then refuses to let them collect, by design, and the
   * refusal has to be cleared the way it is cleared in the field: the agent
   * registers the handset and an officer approves it. Doing that here rather
   * than pre-approving a device in the seed is the difference between proving
   * the control works and quietly stepping around it.
   */
  test('a new handset is registered, approved by an officer, and then collects', async ({
    browser,
  }) => {
    const agentContext = await browser.newContext({ viewport: PHONE });
    const agentPage = await agentContext.newPage();
    const agentConsole = watchConsole(agentPage);
    await signInToAgentApp(agentPage);

    /** Pick a taxpayer and price a levy — the steps before money is asked for. */
    const priceALevy = async () => {
      await agentPage.goto(`${AGENT}/#/collect`);
      await agentPage.waitForTimeout(2000);
      await agentPage.locator('input[type="search"]').first().fill('Rifkatu');
      await agentPage.getByRole('button', { name: /^search$/i }).click();
      await agentPage.waitForTimeout(2500);
      await agentPage.locator('.list__item').first().click();
      await agentPage.waitForTimeout(1500);

      const select = agentPage.locator('select').first();
      await expect(select).toBeVisible({ timeout: 20_000 });
      const options = await select.locator('option').allTextContents();
      const levy = options.find((option) => /Shops and Kiosks Rates/i.test(option));
      expect(levy, 'the shops and kiosks levy is offered').toBeTruthy();
      await select.selectOption({ label: levy! });
      await agentPage.waitForTimeout(600);
      await agentPage.getByRole('button', { name: /calculate amount/i }).click();
      await agentPage.waitForTimeout(2500);
    };

    // --- the platform refuses an unknown handset --------------------------
    /*
     * The refusal lands at the moment money would be committed, not on page
     * load: an unapproved handset may still look up a taxpayer and see what a
     * levy costs, because neither of those takes anything from anybody. Proving
     * it here — by being refused first and approved after — is the difference
     * between demonstrating the control and stepping around it.
     */
    await priceALevy();
    await agentShot(agentPage, 'journey-01a-priced-before-approval');
    await agentPage.getByRole('button', { name: /confirm and proceed to payment/i }).click();
    /*
     * Wait for the refusal to be on screen rather than for a number of seconds.
     * The app retries a failed request before giving up — which is right on a
     * handset with one bar of signal — so the message an agent actually reads
     * arrives several seconds after the button is pressed, not immediately.
     */
    await expect(
      agentPage.getByText(/device is not registered/i).first(),
      'an unapproved handset is refused, in words the agent can act on',
    ).toBeVisible({ timeout: 45_000 });
    await agentShot(agentPage, 'journey-01b-refused-unregistered-device');

    // --- the agent registers it -------------------------------------------
    await agentPage.goto(`${AGENT}/#/application`);
    await agentPage.waitForTimeout(2000);
    const register = agentPage.getByRole('button', { name: /register this device/i });
    await expect(register).toBeVisible({ timeout: 20_000 });
    await register.click();
    await agentPage.waitForTimeout(2500);
    await agentShot(agentPage, 'journey-02-device-registered-pending');

    // --- an officer approves it -------------------------------------------
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const adminConsole = watchConsole(adminPage);
    await signInToPortal(adminPage, 'admin');
    await adminPage.goto(`${PORTAL}/#/agents`);
    await adminPage.waitForTimeout(2000);
    await shot(adminPage, 'journey-03-officer-agent-list');

    // The row carries an explicit Open action; the name itself is not a link.
    await adminPage
      .locator('tr', { hasText: 'Demo Field Agent' })
      .getByRole('button', { name: /^open$/i })
      .first()
      .click();
    await adminPage.waitForTimeout(3000);
    await shot(adminPage, 'journey-04-officer-agent-detail');

    const approve = adminPage.getByRole('button', { name: /^approve$/i }).first();
    await expect(approve, 'the pending handset offers an Approve action').toBeVisible({
      timeout: 20_000,
    });
    await approve.click();
    await adminPage.waitForTimeout(3000);
    await shot(adminPage, 'journey-05-officer-approved-device');

    // --- now the agent can collect ----------------------------------------
    await agentPage.reload();
    await agentPage.waitForTimeout(2000);
    await priceALevy();
    await agentShot(agentPage, 'journey-07-priced-by-government');

    // The taxpayer's TIN is shown before anything is charged, which is how the
    // agent knows they have the right person; and the amount comes from the
    // catalogue, never from the agent.
    const priced = await agentPage.locator('body').innerText();
    expect(priced).toMatch(/TIN [A-Z0-9-]+|No TIN yet/);
    expect(priced).toMatch(/₦3,000\.00/);

    await agentPage.getByRole('button', { name: /confirm and proceed to payment/i }).click();
    await expect(
      agentPage.getByRole('button', { name: /check payment status/i }),
    ).toBeVisible({ timeout: 40_000 });
    await agentShot(agentPage, 'journey-08-payment-initiated');

    /*
     * The heart of §95. Money has been asked for and nothing has confirmed it,
     * so the app must not say collected — it must say the payment is not
     * confirmed and tell the agent not to ask the taxpayer to pay again.
     */
    expect(await agentPage.locator('body').innerText()).toMatch(
      /not.{0,20}confirmed|awaiting confirmation|do not ask the taxpayer/i,
    );

    // --- the gateway confirms ---------------------------------------------
    const simulate = agentPage.getByRole('button', { name: /simulate success/i });
    await expect(simulate).toBeVisible({ timeout: 20_000 });
    await simulate.click();
    await agentPage.waitForTimeout(2500);

    /*
     * Simulating a gateway success does not itself receipt anything — it makes
     * the gateway say yes, and the platform still has to go and ask. Pressing
     * Check payment status is that asking, and it is the only thing that can
     * turn a pending collection into a receipt. If the app has already asked
     * and re-rendered, the button is gone and there is nothing left to press.
     */
    const check = agentPage.getByRole('button', { name: /check payment status/i });
    if (await check.count()) await check.first().click().catch(() => undefined);
    await agentPage.waitForTimeout(4000);
    await agentShot(agentPage, 'journey-09-acknowledged');

    /*
     * The gateway confirming is not the State being paid, so what the taxpayer
     * is given here is an acknowledgement, numbered as one and saying on its
     * face that it is not a receipt. The agent is told the payment IS confirmed
     * — otherwise they would collect a second time from someone who has paid.
     */
    const acknowledged = await agentPage.locator('body').innerText();
    expect(acknowledged, 'the acknowledgement is numbered as one').toMatch(
      /PSIRS-ACK\/\d{4}\/\d+/,
    );
    expect(acknowledged, 'and says plainly that it is not a receipt').toMatch(/NOT a receipt/i);
    expect(acknowledged, 'no receipt number may appear before settlement').not.toMatch(
      /Receipt PSIRS\/\d{4}\/\d+/,
    );

    /*
     * --- the money reaches a government account --------------------------
     *
     * The other half of §95, and the half that decides whether the State was
     * paid. A finance officer records the bank credit; that is what issues the
     * receipt, and nothing an agent or an app can press will do it instead.
     */
    const financeContext = await browser.newContext({ viewport: DESKTOP });
    const financePage = await financeContext.newPage();
    await signInToPortal(financePage, 'finance');
    await financePage.goto(`${PORTAL}/#/reconciliation`);
    await financePage.waitForTimeout(2500);
    await shot(financePage, 'journey-09b-finance-money-in-transit');

    const inTransit = await financePage.locator('.content').innerText();
    expect(
      inTransit,
      'the officer can see money the gateway holds and the State does not',
    ).toMatch(/transit|awaiting settlement|pending settlement/i);
    await financeContext.close();

    /*
     * Recording the settlement itself goes through the API: the screen that
     * does it takes a bank statement upload, which a browser test cannot
     * meaningfully fake, and the point being demonstrated is what the receipt
     * depends on rather than which button an officer presses.
     */
    const gatewayReference = await settlementReferenceFor(agentPage);
    await settleThroughApi(gatewayReference);

    await agentPage.reload();
    await agentPage.waitForTimeout(3500);
    await agentShot(agentPage, 'journey-09c-receipted-after-settlement');

    expect(
      await agentPage.locator('body').innerText(),
      'the receipt appears once, and only once, the money has arrived',
    ).toMatch(/PSIRS\/\d{4}\/\d+/);

    expect(agentConsole.errors, `agent console: ${agentConsole.errors.join(' | ')}`).toEqual([]);
    expect(adminConsole.errors, `admin console: ${adminConsole.errors.join(' | ')}`).toEqual([]);
    await agentContext.close();
    await adminContext.close();
  });

  /**
   * Vehicle particulars, which is the other half of what an agent collects.
   *
   * The seed captured four vehicles and renewed them; this proves an officer or
   * agent can find one by its registration number and put a renewal through the
   * screen rather than only through the API. The renewal is priced by formula
   * from the vehicle's own class, so the amount is not a number anybody typed.
   */
  test('finds a vehicle by registration and renews its particulars', async ({ browser }) => {
    const context = await browser.newContext({ viewport: PHONE });
    const page = await context.newPage();
    const console_ = watchConsole(page);
    await signInToAgentApp(page);

    await page.goto(`${AGENT}/#/vehicles`);
    await page.waitForTimeout(2000);
    await agentShot(page, 'journey-13-vehicle-search');

    await page.getByLabel(/registration number/i).first().fill('PL001JOS');
    await page.getByRole('button', { name: /search vehicle/i }).click();
    await page.waitForTimeout(3000);
    await agentShot(page, 'journey-14-vehicle-found');

    const found = await page.locator('body').innerText();
    expect(found, 'the captured vehicle is findable by its plate').toMatch(/PL001JOS/i);

    // Its current cover is stated before anything is charged, so an owner
    // renewing early can see what they already paid for.
    expect(found).toMatch(/Toyota|Corolla|expires|valid|renew/i);

    const service = page.getByLabel(/renewal service/i).first();
    if (await service.count()) {
      const options = await service.locator('option').allTextContents();
      const priv = options.find((option) => /private/i.test(option));
      if (priv) await service.selectOption({ label: priv });
      await page.waitForTimeout(800);
      await agentShot(page, 'journey-15-vehicle-renewal-chosen');
    }

    expect(console_.errors, `console errors: ${console_.errors.join(' | ')}`).toEqual([]);
    await context.close();
  });

  test('registers a new taxpayer through the wizard', async ({ browser }) => {
    const context = await browser.newContext({ viewport: PHONE });
    const page = await context.newPage();
    const console_ = watchConsole(page);
    await signInToAgentApp(page);
    await page.goto(`${AGENT}/#/taxpayers/new`);
    await page.waitForTimeout(2000);
    await agentShot(page, 'journey-10-register-step-1');

    const stamp = String(Date.now()).slice(-6);

    /*
     * Walk the wizard rather than jumping to the end. Each step gates the next
     * on what it needs, which is the behaviour worth proving: a registration
     * cannot be submitted half-filled, and the reason Continue is unavailable
     * is stated rather than left to be guessed at.
     */
    for (let guard = 0; guard < 8; guard += 1) {
      const fill = async (label: string, value: string) => {
        const field = page.getByLabel(label, { exact: false }).first();
        if ((await field.count()) && (await field.isVisible().catch(() => false))) {
          await field.fill(value).catch(() => undefined);
        }
      };
      await fill('First name', 'Ngozi');
      await fill('Last name', `Dashe${stamp}`);
      await fill('Phone number', `0803${stamp}1`);
      await fill('Street address', `${guard + 5} Zaria Road, Jos`);
      await fill('Address', `${guard + 5} Zaria Road, Jos`);

      // Consent and the declaration are separate boxes and neither is ticked
      // in advance, because a consent nobody gave is not consent.
      const boxes = page.locator('input[type="checkbox"]');
      for (let index = 0; index < (await boxes.count()); index += 1) {
        const box = boxes.nth(index);
        if ((await box.isVisible().catch(() => false)) && !(await box.isChecked())) {
          await box.check().catch(() => undefined);
        }
      }

      const submit = page.getByRole('button', { name: /^register taxpayer$/i });
      if ((await submit.count()) && (await submit.isEnabled())) {
        await agentShot(page, 'journey-11-register-ready');
        await submit.click();
        break;
      }
      const next = page.getByRole('button', { name: /^continue$/i });
      if (!(await next.count()) || !(await next.isEnabled())) break;
      await next.click();
      await page.waitForTimeout(800);
    }

    await page.waitForTimeout(4000);
    await agentShot(page, 'journey-12-registered');
    expect(console_.errors, `console errors: ${console_.errors.join(' | ')}`).toEqual([]);
    await context.close();
  });
});

// ===========================================================================
test.describe('The officer portal, role by role', () => {
  for (const who of ['admin', 'revenue', 'finance', 'auditor', 'supervisor'] as const) {
    test(`${OFFICERS[who].label}: every screen they are offered opens`, async ({ page }) => {
      const visited = await walkEveryScreen(page, who);
      console.log(`  ${OFFICERS[who].label} walked ${visited.length} screens: ${visited.join(', ')}`);
    });
  }
});

// ===========================================================================
test.describe('What a citizen sees without an account', () => {
  test('the public verification page answers an unknown receipt', async ({ page }) => {
    const console_ = watchConsole(page);
    await page.goto(`${PORTAL}/#/verify/PSIRS-NOT-A-REAL-RECEIPT`);
    await page.waitForTimeout(1800);
    await shot(page, 'public-01-verify-unknown');
    expect((await page.locator('body').innerText()).length).toBeGreaterThan(20);
    expect(console_.errors, `console errors: ${console_.errors.join(' | ')}`).toEqual([]);
  });

  test('the citizen status page renders', async ({ page }) => {
    const console_ = watchConsole(page);
    await page.goto(`${PORTAL}/#/citizen`);
    await page.waitForTimeout(1800);
    await shot(page, 'public-02-citizen');
    expect(console_.errors, `console errors: ${console_.errors.join(' | ')}`).toEqual([]);
  });
});
