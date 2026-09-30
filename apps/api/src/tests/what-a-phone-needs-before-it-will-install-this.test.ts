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

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/*
 * This lives in the API suite rather than beside the agent code it checks.
 *
 * It reads files — the manifest, index.html, the service worker — rather than
 * exercising agent runtime behaviour, which is the same shape as the
 * Dockerfile and .dockerignore guards already here. The agent's own tsconfig
 * is browser-targeted and carries no node types, and adding them so one test
 * could call readFileSync would let node APIs into app code with nothing to
 * notice. Written first in the wrong place, and pushed before `npm run
 * typecheck` was run over it, which is how that was found.
 */
function workspaceRoot(): string {
  let directory = process.cwd();
  for (;;) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { workspaces?: unknown };
      if (parsed.workspaces) return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error('no workspace root above ' + process.cwd());
    directory = parent;
  }
}

const AGENT_ROOT = join(workspaceRoot(), 'apps', 'agent');
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
    assert.ok(['standalone', 'fullscreen', 'minimal-ui'].includes(manifest.display));
  });

  it('declares the PNG sizes Chrome documents', () => {
    const png = manifest.icons.filter((icon) => icon.type === 'image/png');
    const sizes = png.map((icon) => icon.sizes);
    assert.ok(sizes.includes('192x192'), 'no 192x192 PNG icon; Chrome documents one');
    assert.ok(sizes.includes('512x512'), 'no 512x512 PNG icon; Chrome documents one');
  });

  it('keeps an icon whose purpose includes "any"', () => {
    // A manifest offering only `maskable` icons is not installable: the
    // install dialog needs an unmasked one to show.
    const any = manifest.icons.filter((icon) => (icon.purpose ?? 'any').split(/\s+/).includes('any'));
    assert.ok(any.length > 0);
  });

  it('ships every icon file it names', () => {
    for (const icon of manifest.icons) {
      const path = join(PUBLIC, icon.src.replace(/^\//, ''));
      assert.ok(existsSync(path), `${icon.src} is declared but not in public/`);
    }
  });
});

describe('the iOS home screen', () => {
  it('is given a PNG, because Safari ignores an SVG apple-touch-icon', () => {
    const match = /<link rel="apple-touch-icon"[^>]*href="([^"]+)"/.exec(indexHtml);
    assert.ok(match, 'index.html declares no apple-touch-icon at all');
    assert.match(
      match![1],
      /\.png$/,
      'apple-touch-icon is not a PNG — iOS will show a screenshot of the page instead of the crest',
    );
  });

  it('points at a file that exists', () => {
    const match = /<link rel="apple-touch-icon"[^>]*href="([^"]+)"/.exec(indexHtml);
    assert.ok(existsSync(join(PUBLIC, match![1].replace(/^\//, ''))));
  });
});

describe('the service worker, which is the other installability gate', () => {
  const sw = readFileSync(join(PUBLIC, 'sw.js'), 'utf8');

  it('has a fetch handler', () => {
    // No fetch handler, no install offer — whatever the manifest says.
    assert.match(sw, /addEventListener\(\s*['"]fetch['"]/);
  });

  it('answers navigations, so the shell survives a cold offline start', () => {
    assert.match(sw, /request\.mode === 'navigate'/);
  });

  it('is registered unconditionally, not only in development', () => {
    const main = readFileSync(join(AGENT_ROOT, 'src', 'main.tsx'), 'utf8');
    assert.match(main, /navigator\.serviceWorker\.register\(\s*['"]\/sw\.js['"]/);
    // A registration behind `import.meta.env.DEV` would make every deployed
    // build uninstallable while working perfectly on a developer's machine.
    const registration = main.slice(main.indexOf("'serviceWorker' in navigator"));
    assert.doesNotMatch(registration.slice(0, 400), /import\.meta\.env\.DEV/);
  });
});
