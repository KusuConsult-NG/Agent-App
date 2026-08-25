/**
 * Environment for the run that puts the API on the real TIN adapter.
 *
 * Same ordering constraint as `remita-env.ts`: `integrations/tin/index.ts`
 * chooses its adapter once, at module load, from `TIN_SERVICE`. Setting that
 * anywhere later leaves the suite on the mock, which is the thing this exists
 * to stop doing.
 */

import './env';

/** Where the TIN-service-shaped stub listens. */
export const TIN_STUB_PORT = 39218;

process.env.TIN_SERVICE = 'psirs-tin-service';
process.env.TIN_SERVICE_URL = `http://127.0.0.1:${TIN_STUB_PORT}`;
process.env.TIN_SERVICE_API_KEY = 'stub-tin-api-key';
// Left at the defaults on purpose. The status vocabulary is the single most
// likely thing to be wrong in a real deployment, so the run should exercise
// the mapping a deployment gets rather than one tuned to make it pass.
