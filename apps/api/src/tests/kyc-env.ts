/**
 * Environment for the run that puts the API on the real KYC adapter.
 *
 * Same ordering constraint as `remita-env.ts` and `tin-env.ts`:
 * `integrations/kyc/index.ts` picks its adapter once, at module load.
 */

import './env';

/** Where the identity-provider-shaped stub listens. */
export const KYC_STUB_PORT = 39219;

process.env.KYC_PROVIDER = 'identity-service';
process.env.KYC_PROVIDER_URL = `http://127.0.0.1:${KYC_STUB_PORT}/verify`;
process.env.KYC_PROVIDER_API_KEY = 'stub-kyc-api-key';
// Defaults kept. The status vocabulary is exactly what goes wrong in a real
// deployment, and a run tuned to pass would prove nothing about it.
