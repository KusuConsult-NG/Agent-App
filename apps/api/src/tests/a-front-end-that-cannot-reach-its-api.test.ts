/**
 * The front-end images have to serve `/api`, and nothing checked that they did.
 *
 * Both clients call a relative base — `const API_BASE = '/api/v1'` in
 * `apps/agent/src/lib/api.ts` and `apps/portal/src/lib/api.ts` — and that is
 * deliberate. `apps/agent/vite.config.ts` says why beside the dev proxy that
 * makes it work locally: *"The PWA and API share an origin in production; the
 * dev proxy keeps cookies, CSP and CORS behaviour the same in development."*
 * The refresh cookie, the CSP and the absence of any preflight all rest on it.
 *
 * Deployed as three separate services, the nginx images are what has to make
 * that true, and for a while neither did. `Dockerfile.agent` and
 * `Dockerfile.portal` defined `location /assets/`, `location /` and (agent
 * only) `location = /sw.js`, and no `location /api/`. A request for
 * `/api/v1/auth/login` fell through to `try_files $uri $uri/ /index.html` and
 * was answered with `index.html` — 200, `text/html` — so every call died at
 * `response.json()` and both front-ends loaded their shell with nothing
 * working, sign-in included. Measured against real nginx, not inferred.
 *
 * Nothing caught it because no test reads these images and no CI job builds
 * them. `dockerfile-paths.test.ts` next door checks that every path a
 * Dockerfile copies exists — the same class of failure, found the same way —
 * and this is the other half: that what the images serve is what the clients
 * assume.
 *
 * The body-size case is the one most likely to rot. A KYC document is a
 * photograph of an ID card; the API accepts 8 MB of one and nginx defaults to
 * 1 MB, so adding the proxy without raising the limit refuses most phone
 * photographs with a proxy error page instead of the sentence the API wrote
 * for the agent holding the phone. The assertion below reads the API's own
 * constant rather than repeating the number, so raising one without the other
 * fails here.
 */

import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

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

const ROOT = workspaceRoot();

/**
 * The images that serve a browser client, and the client each one serves.
 *
 * `Dockerfile.agent` serves BOTH from one origin — the agent at `/`, the
 * portal at `/portal/` — which its own header explains at length, so it is
 * listed against the agent's client and the portal's relative base is checked
 * through `Dockerfile.portal`'s row. `Dockerfile.portal` still builds the
 * portal alone, at `/`, for a deployment that wants it on its own hostname.
 *
 * Being listed here is what subjects an image to every check below: the proxy
 * present, the URI passed through unrewritten, a body limit above the API's
 * own, the SPA fallback intact, a startup guard on API_ORIGIN, the envsubst
 * filter, and a listen port taken from the platform.
 */
const FRONT_ENDS = [
  { image: 'Dockerfile.agent', client: 'apps/agent/src/lib/api.ts', name: 'agent+portal' },
  { image: 'Dockerfile.portal', client: 'apps/portal/src/lib/api.ts', name: 'portal' },
] as const;

const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');

/**
 * A literal, for interpolating into a RegExp.
 *
 * `PSIRS_APP=${name}` was built by interpolation, which held while every name
 * was plain letters. `agent+portal` read as "agen", one-or-more "t", then
 * "portal" — so the check failed against a Dockerfile declaring precisely
 * what it asked for, and would just as easily have passed against one that
 * did not.
 */
function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The file with its comments taken out.
 *
 * These Dockerfiles explain themselves at length, and the explanations quote
 * the very directives being checked — the note about the startup guard
 * contains the words `proxy_pass http://;` as an illustration of what an unset
 * API_ORIGIN produces. A guard satisfied by a sentence about a directive
 * rather than the directive is the mistake this repository has already made
 * once, in the reachability check that counted a path inside a comment as a
 * caller. Both `#` (Dockerfile, nginx) and `//` are stripped.
 */
function directivesOnly(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed !== '' && !trimmed.startsWith('#') && !trimmed.startsWith('//');
    })
    .join('\n');
}

/** `MAX_DOCUMENT_BYTES` as the API actually defines it. */
function apiMaxDocumentBytes(): number {
  const source = read('apps/api/src/services/kyc-documents.ts');
  const match = /MAX_DOCUMENT_BYTES\s*=\s*([0-9]+)\s*\*\s*1024\s*\*\s*1024/.exec(source);
  assert.ok(
    match,
    'MAX_DOCUMENT_BYTES is no longer written as N * 1024 * 1024 in ' +
      'services/kyc-documents.ts; this check needs rewriting with it rather ' +
      'than quietly passing',
  );
  return Number(match![1]) * 1024 * 1024;
}

/** `client_max_body_size 12m;` -> bytes. */
function parseSize(value: string): number {
  const match = /^([0-9]+)([kmg]?)$/i.exec(value.trim());
  assert.ok(match, `could not read a size from ${JSON.stringify(value)}`);
  const scale = { '': 1, k: 1024, m: 1024 * 1024, g: 1024 * 1024 * 1024 }[
    match![2].toLowerCase()
  ]!;
  return Number(match![1]) * scale;
}

for (const { image, client, name } of FRONT_ENDS) {
  test(`${name}: the client asks for a relative /api base`, () => {
    // The premise of everything below. If a client is ever given an absolute
    // base or a configurable host, the proxy stops being what makes it work
    // and these checks are measuring the wrong thing.
    const source = read(client);
    assert.match(
      source,
      /const API_BASE = '\/api\/v1'/,
      `${client} no longer calls a relative /api/v1. If that changed on ` +
        'purpose, this file and the nginx proxy it guards both need revisiting',
    );
  });

  test(`${name}: the image proxies /api rather than serving it the shell`, () => {
    const source = directivesOnly(read(image));

    assert.match(
      source,
      /location \^~ \/api\/ \{/,
      `${image} has no "location ^~ /api/" block, so /api/v1/... falls ` +
        'through to the SPA fallback and every API call is answered with ' +
        'index.html',
    );

    const proxyPass = /proxy_pass\s+http:\/\/([^;\s]+);/.exec(source);
    assert.ok(proxyPass, `${image} has a /api/ location with no proxy_pass`);

    // No trailing slash and no path: the API mounts its own routes at
    // /api/v1 (`app.use('/api/v1', api)`), so the URI has to pass through
    // unchanged. A trailing slash makes nginx rewrite it and every route 404s.
    assert.equal(
      proxyPass![1],
      '${API_ORIGIN}',
      `${image} proxies to ${JSON.stringify(proxyPass![1])}. It must be a ` +
        'bare ${API_ORIGIN} with no trailing slash or path: the API serves ' +
        'the /api/v1 prefix itself, and anything else rewrites the URI',
    );
  });

  test(`${name}: the API origin is substituted, and is not optional`, () => {
    const source = directivesOnly(read(image));

    // envsubst only runs on the template directory, so a config written
    // straight to conf.d would ship with a literal ${API_ORIGIN}. And the
    // name has to be `default.conf.template`, so what it renders REPLACES
    // the stock /etc/nginx/conf.d/default.conf rather than sitting beside
    // it: rendered as `<app>.conf`, both blocks listened on the same port
    // with the same server_name, nginx logged `conflicting server name
    // "localhost" ... ignored`, kept the stock one, and answered every API
    // call with a static file lookup — `open() ".../api/v1/health" failed`,
    // 404. The proxy this image exists to provide was not in effect, and the
    // build-time `rm` of that file had not prevented it.
    assert.match(
      source,
      /\/etc\/nginx\/templates\/default\.conf\.template/,
      `${image} does not render its config as default.conf, so the stock ` +
        'nginx config can survive beside it and win the server_name ' +
        'conflict — which silently disables the /api/ proxy',
    );

    // Without a filter, envsubst also eats $uri, $host and
    // $proxy_add_x_forwarded_for — every nginx variable is $name-shaped. The
    // filter names what may be substituted; it has to include API_ORIGIN and
    // must not be absent. (PORT joined it later, so this checks containment
    // rather than the bare name it used to be.)
    const originFilter = /ENV NGINX_ENVSUBST_FILTER=(\S+)/.exec(source);
    assert.ok(
      originFilter,
      `${image} sets no NGINX_ENVSUBST_FILTER, so envsubst would substitute ` +
        "nginx's own variables away to empty strings",
    );
    assert.match(
      originFilter![1],
      /API_ORIGIN/,
      `${image}'s envsubst filter does not admit API_ORIGIN, so the config ` +
        'would ship with a literal ${API_ORIGIN}',
    );

    assert.match(
      source,
      /docker-entrypoint\.d\/05-require-api-origin\.sh/,
      `${image} has no startup guard for API_ORIGIN. Unset, it becomes ` +
        '"proxy_pass http://;" and nginx dies with "no host in upstream" ' +
        'against a line number; a default would be a wrong host serving a ' +
        'shell where nothing works',
    );
  });

  test(`${name}: says which front-end it is in its startup log`, () => {
    const source = directivesOnly(read(image));
    // Both images render `default.conf.template` now, so the envsubst line no
    // longer names the app — it used to say `<app>.conf.template`. A log
    // showing the portal template while serving the agent service's hostname
    // is how a service pointed at the wrong image came to light, so the
    // signal is restored deliberately rather than left to the rename.
    assert.match(
      source,
      new RegExp(`ENV PSIRS_APP=${escapeForRegExp(name)}\\b`),
      `${image} does not declare PSIRS_APP=${name}, so nothing in its ` +
        'startup log says which front-end is running',
    );
    assert.match(
      source,
      /echo "05-require-api-origin\.sh: this is the \$\{PSIRS_APP:-unknown\}/,
      `${image} declares PSIRS_APP but never prints it, which is the same ` +
        'as not having it',
    );
  });

  test(`${name}: owns the server block, whatever Host the platform sends`, () => {
    const source = directivesOnly(read(image));

    // The Host is the platform's public hostname, never localhost, so
    // `server_name localhost` matched nothing and worked only by being the
    // sole block. Verified: with a second block present it lost the conflict.
    assert.doesNotMatch(
      source,
      /server_name\s+localhost\s*;/,
      `${image} names its server block "localhost", which no request to the ` +
        'deployed service carries, and which collides with the stock config',
    );
    assert.match(
      source,
      /server_name\s+_\s*;/,
      `${image} should use the catch-all server_name, since the Host is ` +
        'whatever hostname the platform publishes',
    );
    assert.match(
      source,
      /listen \$\{PORT\} default_server;/,
      `${image} does not mark its block default_server, so which block ` +
        'serves an unmatched Host is left to file ordering',
    );
  });

  test(`${name}: listens on the port the platform routes to`, () => {
    const source = directivesOnly(read(image));

    // `listen 80` works only where the platform is told to route to 80.
    // Railway injects PORT and routes to that; an image listening elsewhere
    // is reached by nothing and the edge answers "Application failed to
    // respond" — a deployment that succeeded and a service nobody can talk
    // to. Verified against real nginx: with PORT=8085 it binds 8085 and
    // leaves 80 empty.
    assert.match(
      source,
      /listen \$\{PORT\}[^;]*;/,
      `${image} hardcodes its listen port instead of taking \${PORT}`,
    );

    // envsubst has to be allowed to substitute it, or the config ships with
    // a literal ${PORT} and nginx refuses to start.
    const filter = /ENV NGINX_ENVSUBST_FILTER=(\S+)/.exec(source);
    assert.ok(filter, `${image} sets no NGINX_ENVSUBST_FILTER`);
    assert.match(
      filter![1],
      /PORT/,
      `${image} does not let envsubst substitute PORT, so the template ` +
        'would keep a literal ${PORT} and nginx would fail to parse it',
    );

    // And a default, or an unset PORT yields `listen ;`. It must be a
    // `.envsh`: the nginx entrypoint SOURCES .envsh and EXECUTES .sh in a
    // subshell, so an export from a .sh would not reach the envsubst step.
    assert.match(
      source,
      /docker-entrypoint\.d\/[0-9]+-default-port\.envsh/,
      `${image} has no .envsh supplying a PORT default, so an unset PORT ` +
        'substitutes to nothing and nginx dies on "listen ;"',
    );
  });

  test(`${name}: the proxy accepts a document as large as the API will`, () => {
    const source = directivesOnly(read(image));
    const declared = /client_max_body_size\s+([0-9]+[kKmMgG]?)\s*;/.exec(source);
    assert.ok(
      declared,
      `${image} sets no client_max_body_size, so nginx's 1 MB default refuses ` +
        'a KYC photograph with its own 413 before the API sees it',
    );

    const limit = parseSize(declared![1]);
    const apiLimit = apiMaxDocumentBytes();
    assert.ok(
      limit >= apiLimit,
      `${image} caps a request at ${limit} bytes and the API accepts ` +
        `${apiLimit}. Every document between the two is refused by the proxy, ` +
        'so the agent gets an error page instead of the API\'s own sentence ' +
        'about photographing rather than filming the document',
    );
  });
}

test('no front-end config declares an nginx `types` block', () => {
  /*
   * A `types { ... }` block in a server or location does NOT extend the map
   * inherited from the http-level `include /etc/nginx/mime.types`. It
   * REPLACES it.
   *
   * This was added to two of these images to give `.webmanifest` its proper
   * media type, which nginx's bundled map genuinely lacks. The effect was
   * that the only extension nginx recognised in the whole server was
   * `.webmanifest`, and every other file fell through to
   * `default_type application/octet-stream` — index.html, the JS bundle, the
   * SVG crest. Measured against real nginx:
   *
   *     /                 200 application/octet-stream
   *     /assets/index.js  200 application/octet-stream
   *     /icon.svg         200 application/octet-stream
   *
   * These images set `X-Content-Type-Options: nosniff`, so a browser takes
   * that at face value: Chromium answered a navigation with "Download is
   * starting" rather than rendering anything. Both applications were dead,
   * and nginx -t called the configuration valid, the container started, and
   * the platform health check — which asks only for a 200 — was satisfied.
   * That combination is why this needs a test rather than care.
   *
   * The media type belongs on one exact-match location as a `default_type`,
   * which applies only where the extension yields nothing and so cannot
   * reach another file. `gzip_types` is a different directive and is fine.
   */
  for (const { image, name } of FRONT_ENDS) {
    const offending = directivesOnly(read(image))
      .split('\n')
      .filter((line) => /^\s*types\s*\{/.test(line));

    assert.deepEqual(
      offending,
      [],
      `${name}: ${image} declares an nginx \`types\` block. That replaces the ` +
        'inherited mime.types map rather than extending it, so every ' +
        'extension it does not list is served as application/octet-stream — ' +
        'and with nosniff set, the browser downloads the page instead of ' +
        'rendering it. Use `default_type` in an exact-match location for the ' +
        'one type nginx lacks.',
    );
  }
});

test('the manifest still gets a media type from somewhere', () => {
  // The guard above must not be satisfied by deleting the intent. The image
  // that serves a PWA manifest still has to name its type, just not with a
  // `types` block.
  for (const { image, name } of FRONT_ENDS) {
    const source = directivesOnly(read(image));
    if (!source.includes('webmanifest')) continue;
    assert.match(
      source,
      /default_type\s+application\/manifest\+json;/,
      `${name}: ${image} mentions webmanifest but sets no ` +
        'application/manifest+json media type for it',
    );
  }
});

test('the SPA fallback is still there, underneath the proxy', () => {
  // The proxy must not have been added by replacing it: a deep client route
  // reloaded in the browser has to keep returning index.html.
  for (const { image, name } of FRONT_ENDS) {
    const source = directivesOnly(read(image));
    assert.match(
      source,
      /try_files \$uri \$uri\/ \/index\.html/,
      `${name}: ${image} lost its SPA fallback, so reloading a deep route 404s`,
    );
  }
});

// ===========================================================================

describe('what the build context carries, and what it must not', () => {
  /*
   * The root `.dockerignore` serves every image that has no
   * `<dockerfile>.dockerignore` of its own, and it has to be right in two
   * directions at once.
   *
   * It used to exclude `apps/agent` and `apps/portal` — correct for the API
   * image, which never copies them, and fatal for the two front-end images,
   * whose entire source lives there. `Dockerfile.agent.dockerignore` and
   * `Dockerfile.portal.dockerignore` override it for those builds, but
   * `<dockerfile>.dockerignore` is a BuildKit convention and a builder that
   * does not implement it falls back to the root file and fails on
   * `COPY apps/agent ./apps/agent` with "not found". GitHub Actions honours
   * it; Railway's Metal builder is a different implementation. Correctness
   * should not rest on whether they agree, so the exclusions are gone and no
   * image's contents changed — nothing here does a bare `COPY .`.
   *
   * The other direction is why the file exists at all, in its own words: "A
   * build context that includes .env or .git is how a secret ends up in a
   * published layer." Nothing tested that, and this file was edited without
   * it. Both halves are pinned here.
   */
  const rules = () =>
    readFileSync(join(ROOT, '.dockerignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));

  for (const source of ['apps/agent', 'apps/portal', 'apps/api', 'packages/shared']) {
    it(`does not exclude ${source}, which an image copies`, () => {
      assert.ok(
        !rules().includes(source),
        `the root .dockerignore excludes ${source}. A builder that ignores ` +
          'the per-Dockerfile convention will fail that image\'s COPY with ' +
          '"not found" — which is how this broke before',
      );
    });
  }

  for (const secret of ['.git', '.env', '.env.*', 'node_modules']) {
    it(`still keeps ${secret} out of every context`, () => {
      assert.ok(
        rules().includes(secret),
        `the root .dockerignore no longer excludes ${secret}. Its first line ` +
          'says why that matters: a context carrying .env or .git is how a ' +
          'secret ends up in a published layer',
      );
    });
  }

  it('relies on no per-Dockerfile .dockerignore, which Railway may not read', () => {
    /*
     * `<dockerfile>.dockerignore` is a BuildKit convention, not a Docker
     * guarantee. The note at the top of this block already says why that
     * matters — GitHub Actions honours it, Railway's Metal builder is a
     * different implementation, and "correctness should not rest on whether
     * they agree" — which is why the root file stopped excluding the
     * front-ends.
     *
     * `Dockerfile.agent.dockerignore` survived that change and excluded
     * `apps/portal`. Harmless while this image built only the agent; fatal
     * the moment it also built the portal, and fatal only on a builder that
     * reads the file — so it would have worked in CI and failed on the
     * platform, which is the worst available outcome. Both per-image files
     * are gone and the root `.dockerignore` serves every build, as the
     * assertions above require it to.
     */
    const stray = [
      'Dockerfile.dockerignore',
      'Dockerfile.api.dockerignore',
      'Dockerfile.agent.dockerignore',
      'Dockerfile.portal.dockerignore',
    ].filter((name) => existsSync(join(ROOT, name)));

    assert.deepEqual(
      stray,
      [],
      `${stray.join(', ')} exists. A per-Dockerfile .dockerignore is read by ` +
        'BuildKit and may be ignored by the platform builder, so the build ' +
        'context differs between CI and deployment — the build passes here ' +
        'and fails there, or worse, the other way round. Put every rule in ' +
        'the root .dockerignore, which every builder reads.',
    );
  });

  it('never does a bare COPY . , which is what makes the above safe', () => {
    // Every image taking only the paths it names is the reason un-excluding
    // the front-ends costs context size and nothing in any shipped image.
    for (const image of ['Dockerfile', 'Dockerfile.api', 'Dockerfile.agent', 'Dockerfile.portal']) {
      const source = directivesOnly(readFileSync(join(ROOT, image), 'utf8'));
      assert.doesNotMatch(
        source,
        /^COPY \.\s/m,
        `${image} copies the whole context, so what the .dockerignore lets ` +
          'through now decides what ships in that image',
      );
    }
  });
});
