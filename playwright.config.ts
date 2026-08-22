/**
 * Browser tests for the two front-ends.
 *
 * Kept out of `npm test`: these need the API and both dev servers running
 * against a seeded database. A suite that cannot start without ceremony gets
 * skipped rather than fixed, so `npm run test:browser` does the ceremony.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './apps/portal/src/tests',
  testMatch: '**/*.spec.ts',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    headless: true,
    actionTimeout: 15_000,
    launchOptions: {
      /*
       * The Chromium this environment already has.
       *
       * PLAYWRIGHT_BROWSERS_PATH points at /opt/pw-browsers, but Playwright
       * resolves a build number from its own version — 1.62 looks for build
       * 1234 while the image ships 1194 — so it reports the browser as missing
       * and tells you to download one. Naming the binary avoids a download
       * that the sandbox would block anyway, and pins the test to the browser
       * that is actually installed.
       */
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM ??
        '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
});
