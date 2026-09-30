/**
 * Rasterise `public/icon.svg` into the PNGs the platforms actually require.
 *
 * Two platforms refuse the SVG, for different reasons:
 *
 *   - iOS Safari ignores an SVG `apple-touch-icon` entirely, so an installed
 *     PWA showed a screenshot-or-letter tile where a government app should
 *     show its crest. It wants a PNG, and 180x180 is the size it asks for.
 *   - Chrome's installability check documents 192 and 512 PNG icons. Recent
 *     Chrome accepts `sizes="any"` SVG, but Samsung Internet, older WebViews
 *     and the Android WebView used by some launchers are less consistent, and
 *     "Install app" quietly not appearing is the failure mode.
 *
 * Rendered with the Chromium that Playwright already ships in this repository
 * rather than by adding an image dependency: the SVG has a 192 viewBox, so
 * each size is one deviceScaleFactor away and the output is deterministic.
 *
 * Run from apps/agent: `node scripts/render-icons.mjs`
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', 'public');

/** The viewBox of icon.svg. Every output is a scale of this. */
const BASE = 192;

/** Why each size exists, so nobody deletes one as redundant. */
const SIZES = [
  [180, 'icon-180.png', 'iOS apple-touch-icon; Safari ignores SVG here'],
  [192, 'icon-192.png', "Chrome's documented installability icon"],
  [512, 'icon-512.png', 'Chrome splash screen and the install dialog'],
];

const svg = readFileSync(join(PUBLIC, 'icon.svg'), 'utf8');

/*
 * The pre-installed Chromium, not a downloaded one.
 *
 * This container ships Chromium at PLAYWRIGHT_BROWSERS_PATH and
 * PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD stops npm re-fetching it, but the build
 * number the repository's Playwright expects and the one installed do not
 * have to agree — they did not — and `launch()` then asks for a download that
 * cannot happen. Naming the binary is the documented way through, and
 * rendering a 192px square is not a feature where a build number matters.
 */
const EXECUTABLE =
  process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch({ executablePath: EXECUTABLE });
try {
  for (const [size, name, why] of SIZES) {
    const page = await browser.newPage({
      viewport: { width: BASE, height: BASE },
      deviceScaleFactor: size / BASE,
    });
    // The icon is opaque by design (a filled rect covers the viewBox), but an
    // omitted background would composite to transparent black on iOS, which
    // renders as a black tile rather than the green one.
    await page.setContent(
      `<!doctype html><style>
         html,body{margin:0;padding:0;width:${BASE}px;height:${BASE}px;overflow:hidden}
         svg{display:block;width:${BASE}px;height:${BASE}px}
       </style>${svg}`,
      { waitUntil: 'load' },
    );
    const png = await page.screenshot({ omitBackground: false, type: 'png' });
    writeFileSync(join(PUBLIC, name), png);
    await page.close();
    console.log(`  ${name.padEnd(15)} ${size}x${size}  ${png.length} bytes  — ${why}`);
  }
} finally {
  await browser.close();
}
