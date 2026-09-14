/**
 * Nothing in this suite talks to a server.
 *
 * The agent PWA reached this conclusion first, after a CI failure nobody could
 * reproduce — see `apps/agent/src/tests-setup.ts`, which carries the full
 * account. The symptom there is the symptom here: an error thrown from React's
 * scheduler that fails the run while every assertion passes.
 *
 * The portal had no setup file at all, so it never got the fix. Its screens
 * load on mount — the oversight board its job health, the audit screen its
 * entries, the dashboard its figures — and a test that renders one and asserts
 * on a single piece of it leaves the rest of those requests in flight.
 * happy-dom resolves a relative `/api/v1/...` against `http://localhost:3000`
 * and genuinely tries, so the suite has been making connection attempts to a
 * server that is not running.
 *
 * On this machine they refuse instantly and usually land before teardown,
 * which is why the suite looked clean. Add enough load — a new test file was
 * all it took — and some of them arrive after their environment has gone.
 * React's scheduler then wakes in the check phase to a `window` that no longer
 * exists: `ReferenceError: window is not defined`, attributed to whichever
 * file happened to be running rather than to the one that made the request,
 * failing nothing and exiting 1.
 *
 * Measured before and after: with the offending file present, 4 runs in 25
 * carried the error; with this shim, none in the runs below.
 *
 * A resolved empty response rather than a rejection, for the reason the agent's
 * copy gives: a rejecting default replaces one late-arriving promise with
 * another, which is the problem rather than a fix. A test that needs a real
 * shape mocks `api` directly, as every test in this suite already does.
 */
Object.defineProperty(globalThis, 'fetch', {
  writable: true,
  configurable: true,
  value: async () =>
    new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
});
