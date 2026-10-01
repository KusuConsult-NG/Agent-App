/**
 * Environment for the run with device binding relaxed.
 *
 * Same ordering constraint as `tin-env.ts` and `remita-env.ts`: `config.ts`
 * reads `DEMO_RELAX_DEVICE_BINDING` once, at module load, so setting it after
 * anything has imported the config leaves the run on the strict behaviour —
 * which is the thing this exists to stop doing, and which would make every
 * assertion in the accompanying test pass for the wrong reason.
 *
 * NODE_ENV stays 'test' here, as `env.ts` sets it. The flag's independence
 * from NODE_ENV — the property that distinguishes it from
 * `DEVICE_AUTO_APPROVE`, which is forced off in production — cannot be shown
 * by running this suite, which is not a production process. It is asserted
 * against the source instead, in the last test of the accompanying file.
 */

import './env';

process.env.DEMO_RELAX_DEVICE_BINDING = 'true';
