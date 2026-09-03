/**
 * Test environment variables.
 *
 * This lives in its own module, imported before anything else, because
 * TypeScript hoists `import` statements above assignments in the importing
 * file. Setting `process.env` at the top of helpers.ts would therefore run
 * *after* config.ts had already been loaded and read its defaults.
 */

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5432/psirs_test';
process.env.JWT_SECRET ??= 'test-jwt-secret-value-that-is-long-enough-32';
process.env.IDENTITY_HASH_SECRET ??= 'test-identity-secret-value-long-enough-32';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'test-webhook-secret-value-long-enough-32';
process.env.STORAGE_PATH ??= '/tmp/psirs-test-storage';

// Push endpoints are held to the services a browser could actually have named,
// so the fixtures' invented host has to be declared like any other. Declared
// here rather than by rewriting sixteen call sites as `fcm.googleapis.com`,
// because it also exercises the setting PSIRS uses to add a push service the
// default list has not met. `attacker.example.net` and the internal addresses
// the audit probes stay refused, which is the point of the tests that use them.
process.env.PUSH_ENDPOINT_HOSTS ??=
  'fcm.googleapis.com,updates.push.services.mozilla.com,web.push.apple.com,notify.windows.com,push.example.test';

// The suite performs far more sign-ins and OTP requests in one minute than any
// real user would. Rate limiting itself is covered by a dedicated test that
// sets its own limit.
process.env.AUTH_RATE_LIMIT_MAX ??= '2000';
process.env.RATE_LIMIT_MAX ??= '5000';
// The suite creates a handful of agent applicants; production keeps the tight
// default of 5 per hour.
process.env.AGENT_APPLY_RATE_LIMIT_MAX ??= '100';
process.env.GROUP_ATTESTATION_RATE_LIMIT_MAX ??= '2000';
process.env.REFEREE_RATE_LIMIT_MAX ??= '2000';

export {};
