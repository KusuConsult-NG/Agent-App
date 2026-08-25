/**
 * Environment for the run that puts the API on the real Remita adapter.
 *
 * Separate module for the same reason as `env.ts`: imports are evaluated
 * before the importing file's statements, so `config.ts` would already have
 * read `PAYMENT_GATEWAY` by the time an assignment at the top of the test ran.
 * `integrations/gateway.ts` picks its adapter once, at module load, from that
 * value — so this has to be in place first or the suite silently runs on the
 * mock, which is precisely what it exists to stop doing.
 *
 * The port is a constant rather than an ephemeral one for the same ordering
 * reason: `REMITA_BASE_URL` must be final before the adapter is constructed,
 * which is before any server could have been asked what port it got.
 */

import './env';

/** Where the Remita-shaped stub listens. */
export const REMITA_STUB_PORT = 39217;

export const REMITA_MERCHANT_ID = '2547916';
export const REMITA_API_KEY = 'stub-remita-api-key';
export const REMITA_SERVICE_TYPE_ID = '4430731';

process.env.PAYMENT_GATEWAY = 'remita';
process.env.REMITA_BASE_URL = `http://127.0.0.1:${REMITA_STUB_PORT}`;
process.env.REMITA_MERCHANT_ID = REMITA_MERCHANT_ID;
process.env.REMITA_API_KEY = REMITA_API_KEY;
process.env.REMITA_SERVICE_TYPE_ID = REMITA_SERVICE_TYPE_ID;
// Keep the default (`00` succeeds, nothing fails) so the run exercises the
// mapping a deployment would actually get, not one tuned to make it pass.
