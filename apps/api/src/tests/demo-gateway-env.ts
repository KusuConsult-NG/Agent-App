/**
 * Environment for the run with the mock gateway permitted by name.
 *
 * Same ordering constraint as `relaxed-device-env.ts`, `tin-env.ts` and
 * `remita-env.ts`: `config.ts` reads `DEMO_ALLOW_MOCK_GATEWAY` once, at module
 * load, so setting it after anything has imported the config leaves the run on
 * the default — and every assertion in the accompanying file would pass for
 * the wrong reason.
 *
 * NODE_ENV stays 'test', as `env.ts` sets it. The property that distinguishes
 * this flag from every other demo convenience — that it is NOT forced off in
 * production — cannot be shown by a suite that is not a production process,
 * so it is asserted against the source in the accompanying file.
 */

import './env';

process.env.DEMO_ALLOW_MOCK_GATEWAY = 'true';
