/**
 * What the platforms need before they will offer to install this.
 *
 * An agent reported not seeing an install prompt, and the app was in fact
 * installable — Chrome removed the automatic banner years ago and the entry
 * now lives in the menu. But checking that turned up two real gaps in what
 * the app declares, and neither would announce itself:
 *
 *   - `apple-touch-icon` pointed at `icon.svg`. iOS Safari ignores an SVG
 *     there and falls back to a screenshot of the page, so an installed PWA
 *     showed a scrap of the sign-in screen where a government crest belongs.
 *     Nothing errors; the tile is just wrong.
 *   - The manifest declared one SVG icon at `sizes: "any"`. Recent Chrome
 *     accepts that, but Chrome's own installability documentation asks for
 *     192 and 512 PNGs, and Samsung Internet and the Android WebViews some
 *     launchers use are less consistent. The failure mode is "Install app"
 *     quietly not appearing, which is indistinguishable from a user missing
 *     the menu item.
 *
 * The PNGs are rendered from the SVG by `scripts/render-icons.mjs` using the
 * Chromium Playwright already ships here, so they cannot drift from the mark
 * without somebody re-running it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const AGENT_ROOT = join(__dirname, '..', '..');
const PUBLIC = join(AGENT_ROOT, 'public');

const manifest = JSON.parse(
  readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf8'),
) as {
  display: string;
  start_url: string;
  scope: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};

const indexHtml = readFileSync(join(AGENT_ROOT, 'index.html'), 'utf8');

describe('the manifest says enough for a browser to offer an install', () => {
  it('declares a display mode that counts as installable', () => {
    // `browser` is the one value that disqualifies it.
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest.display);
  });

  it('declares the PNG sizes Chrome documents', () => {
    const png = manifest.icons.filter((icon) => icon.type === 'image/png');
    const sizes = png.map((icon) => icon.sizes);
    expect(sizes, 'no 192x192 PNG icon; Chrome documents one').toContain('192x192');
    expect(sizes, 'no 512x512 PNG icon; Chrome documents one').toContain('512x512');
  });

  it('keeps an icon whose purpose includes "any"', () => {
    // A manifest offering only `maskable` icons is not installable: the
    // install dialog needs an unmasked one to show.
    const any = manifest.icons.filter((icon) => (icon.purpose ?? 'any').split(/\s+/).includes('any'));
    expect(any.length).toBeGreaterThan(0);
  });

  it('ships every icon file it names', () => {
    for (const icon of manifest.icons) {
      const path = join(PUBLIC, icon.src.replace(/^\//, ''));
      expect(existsSync(path), `${icon.src} is declared but not in public/`).toBe(true);
    }
  });
});

describe('the iOS home screen', () => {
  it('is given a PNG, because Safari ignores an SVG apple-touch-icon', () => {
    const match = /<link rel="apple-touch-icon"[^>]*href="([^"]+)"/.exec(indexHtml);
    expect(match, 'index.html declares no apple-touch-icon at all').not.toBeNull();
    expect(
      match![1],
      'apple-touch-icon is not a PNG — iOS will show a screenshot of the page ' +
        'instead of the crest',
    ).toMatch(/\.png$/);
  });

  it('points at a file that exists', () => {
    const match = /<link rel="apple-touch-icon"[^>]*href="([^"]+)"/.exec(indexHtml);
    expect(existsSync(join(PUBLIC, match![1].replace(/^\//, '')))).toBe(true);
  });
});

describe('the service worker, which is the other installability gate', () => {
  const sw = readFileSync(join(PUBLIC, 'sw.js'), 'utf8');

  it('has a fetch handler', () => {
    // No fetch handler, no install offer — whatever the manifest says.
    expect(sw).toMatch(/addEventListener\(\s*['"]fetch['"]/);
  });

  it('answers navigations, so the shell survives a cold offline start', () => {
    expect(sw).toMatch(/request\.mode === 'navigate'/);
  });

  it('is registered unconditionally, not only in development', () => {
    const main = readFileSync(join(AGENT_ROOT, 'src', 'main.tsx'), 'utf8');
    expect(main).toMatch(/navigator\.serviceWorker\.register\(\s*['"]\/sw\.js['"]/);
    // A registration behind `import.meta.env.DEV` would make every deployed
    // build uninstallable while working perfectly on a developer's machine.
    const registration = main.slice(main.indexOf("'serviceWorker' in navigator"));
    expect(registration.slice(0, 400)).not.toMatch(/import\.meta\.env\.DEV/);
  });
});
