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
/**
 * Where the API's stdout goes, which is where the development message
 * provider writes what it "delivered". See [codeFromTheSms].
 */
const API_LOG = process.env.UAT_API_LOG ?? '/tmp/psirs-uat/api.log';
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

/**
 * A seeded taxpayer who has actually paid something, found through the API.
 *
 * Both calls are checked for the shape they are supposed to return rather than
 * assumed. `/taxpayers/search` is rate limited, and a limiter's reply is an
 * object; calling `.find` on it threw `rows.find is not a function` from
 * inside this helper, which says nothing about what went wrong and sent the
 * last reader looking at the seed.
 */
async function aTaxpayerWhoHasPaid(): Promise<{ tin: string; phone: string }> {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-app-version': '1.0.0' },
    body: JSON.stringify({ phone: '+2348000000001', password: 'Password123' }),
  });
  const session = (await login.json()) as { accessToken?: string };
  expect(
    session.accessToken,
    `signing in as the demonstration administrator failed (${login.status}): ${JSON.stringify(session)}`,
  ).toBeTruthy();

  const found = await fetch(`${API}/taxpayers/search?q=Amina&limit=5`, {
    headers: { authorization: `Bearer ${session.accessToken!}`, 'x-app-version': '1.0.0' },
  });
  const body: unknown = await found.json();
  expect(
    Array.isArray(body),
    `the taxpayer search answered ${found.status} with ${JSON.stringify(body)} rather than a list`,
  ).toBe(true);

  const rows = body as { tin: string | null; phone: string }[];
  const withTin = rows.find((row) => row.tin);
  expect(withTin, 'the seed registers a taxpayer with a TIN').toBeTruthy();
  return { tin: withTin!.tin!, phone: withTin!.phone };
}

/**
 * Read the code the platform actually sent, from where it actually sent it.
 *
 * In the field this step is a person reading their own phone; here it is the
 * harness standing in for the handset, which is the only part of the journey a
 * browser cannot do. The question is where the harness may legitimately look.
 *
 * NOT THE DATABASE, AND THIS IS NOT A DETAIL. `notifications.message` keeps
 * the sentence with the credential replaced by `██████` —
 * `services/notifications.ts` calls it WITHHELD — and the deliverable body
 * lives in `secret_message`, which the dispatcher reads once and sets to NULL
 * as the row becomes SENT. `otp_codes` keeps only sha256(code). So after
 * delivery the plaintext exists nowhere in the database, on purpose: a join
 * from a queued body to the hash used to resolve the credential it opens.
 *
 * This helper read `notifications.message` and scraped the first four-to-ten
 * digit run out of the five newest messages. It could not have worked. What it
 * returned was whatever number came first — `2027` from "valid until
 * 2027-10-01", or part of an amount from a receipt SMS — so the statement was
 * refused and the failure read as the statement screen being broken.
 *
 * The development message provider logs what it delivered:
 *
 *     [notify:SMS] -> +2348031100000: PSIRS: Your verification code is 806919.
 *
 * That line is the handset. It exists only because `services/messaging/mock.ts`
 * is selected, which `config.ts` refuses to boot with in production, so nothing
 * here can read a real citizen's code.
 */
/**
 * How much of the log exists right now.
 *
 * Taken BEFORE the press that asks for a code, so [codeFromTheSms] can ignore
 * everything written earlier. Without it the helper hands back the newest code
 * it can see, which for the first second is the PREVIOUS one — the stack's log
 * is not cleared between manual pokes and runs — and the server answers the
 * statement request 400 because that code is spent or expired. Measured: four
 * codes for one number in the log, and the test used the third.
 */
async function smsSoFar(): Promise<number> {
  const { readFile } = await import('node:fs/promises');
  return (await readFile(API_LOG, 'utf8').catch(() => '')).length;
}

async function codeFromTheSms(phone: string, since: number): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  // The number is a literal, and it opens with '+'.
  const quoted = phone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = new RegExp(
    `\\[notify:SMS\\] -> ${quoted}: [^\\n]*?verification code is (\\d{4,10})`,
    'g',
  );

  /*
   * Polled, because queueing and delivering are two steps: the request returns
   * as soon as the row is written and the dispatcher sends it a moment later.
   * The last match rather than the first — `workers: 1` in playwright.config.ts
   * means one test is in flight, so the newest code for this number is this
   * test's, and an earlier run's expired code must not win.
   */
  /*
   * Longer than one dispatch cycle, which is the number that matters.
   * `services/jobs.ts` declares `notification-dispatch` at 30s, so a request
   * landing just after a tick waits almost that long before the provider
   * writes anything. A 20s window passed whenever the timing was kind and
   * failed the Hausa journey when it was not — the code was issued, nobody had
   * waited long enough to see it.
   */
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const log = await readFile(API_LOG, 'utf8').catch(() => '');
    // Only what was written after this test asked.
    const codes = [...log.slice(since).matchAll(line)].map((match) => match[1]!);
    if (codes.length > 0) return codes[codes.length - 1]!;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(
    `No verification code for ${phone} written to ${API_LOG} in the 60s after ` +
      'it was requested. Set UAT_API_LOG if the API writes its output somewhere ' +
      'else; the code is not recoverable from the database by design.',
  );
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

  // Before the press that asks, so only this request's code can be read.
  const asked = await smsSoFar();
  await pressing(
    page,
    /Send me a code/i,
    () => page.getByLabel(/Code from the SMS/i),
    'Asking for a code',
  );
  await shot(page, 'citizen-stmt-03-code-sent', 'code has gone to the phone');

  await page.getByLabel(/Code from the SMS/i).fill(await codeFromTheSms(phone, asked));
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

/**
 * The same journey read in Hausa.
 *
 * Shot rather than asserted from the dictionary, because a dictionary entry
 * proves a translation exists and not that the screen uses it. Four strings on
 * these pages had Hausa in the dictionary, and in the review sheet, while the
 * screen went on showing English — a screenshot is what finds that, and a
 * table of key/value pairs is what hides it.
 */
test('the whole journey, read in Hausa', async ({ page }) => {
  // Slow for the same reason as the English journey: three limiters to honour.
  test.slow();
  const console_ = watchConsole(page);
  const { tin, phone } = await aTaxpayerWhoHasPaid();

  await page.goto(`${PORTAL}/#/citizen`);
  await page.getByRole('button', { name: 'Hausa' }).click();

  // Every control on the search form, not only the ones with a label element.
  await expect(page.getByRole('button', { name: 'Ta TIN' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ta waya' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ta suna' })).toBeVisible();
  await shot(page, 'citizen-stmt-ha-01-search');

  await page.getByLabel(/Lambar Shaidar Haraji/i).fill(tin);
  await pressing(
    page,
    /Duba matsayi/i,
    () => page.getByText(/Abin da ka riga ka biya/i),
    'Duba matsayi',
  );

  await expect(page.getByLabel(/^Daga$/i)).toBeVisible();
  await expect(page.getByLabel(/^Zuwa$/i)).toBeVisible();
  await shot(page, 'citizen-stmt-ha-02-offered', 'Aiko min da lamba');

  await page.getByLabel(/^Daga$/i).fill('2026-01-01');
  await page.getByLabel(/^Zuwa$/i).fill('2026-12-31');

  // Before the press that asks, as in the English journey above.
  const asked = await smsSoFar();
  await pressing(
    page,
    /Aiko min da lamba/i,
    () => page.getByLabel(/Lambar da ke cikin sakon/i),
    'Aiko min da lamba',
  );
  await shot(page, 'citizen-stmt-ha-03-code-sent', 'an aika lamba');

  await page.getByLabel(/Lambar da ke cikin sakon/i).fill(await codeFromTheSms(phone, asked));
  await pressing(
    page,
    /Nuna min biyayyata/i,
    () => page.getByText(/Abin da aka biya/i),
    'Nuna min biyayyata',
  );

  await expect(page.getByText(/Biyayya daga 2026-01-01 zuwa 2026-12-31/i)).toBeVisible();
  /*
   * The levies too. Their Hausa lives in the catalogue rather than the
   * dictionary, which is why it was reaching the statement and not the screen.
   */
  await expect(page.getByText('Harajin Kasuwa').first()).toBeVisible();
  await expect(page.getByText(/Sabunta Takardun Mota/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Duba wani lokaci dabam/i })).toBeVisible();
  await shot(page, 'citizen-stmt-ha-04-statement', 'Kowane biya');
  await shot(page, 'citizen-stmt-ha-05-another-period', 'Duba wani lokaci dabam');

  /*
   * Nothing English left on the page. The screenshots are the real check —
   * this is the part of it a machine can hold, and it is what would have
   * caught "Check status" sitting under a Hausa heading.
   */
  const body = await page.locator('body').innerText();
  for (const english of [
    'Check status',
    'By TIN',
    'By phone',
    'By name',
    'What you have already paid',
    'Send me a code',
    'Show my payments',
    'Look at a different period',
    'Market Tax and Levy',
  ]) {
    expect(body, `"${english}" is still on the Hausa page`).not.toContain(english);
  }

  expect(console_.errors, console_.errors.join('\n')).toEqual([]);
});
