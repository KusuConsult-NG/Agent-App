/**
 * Prove each integration mapping against the provider that will actually serve
 * it.
 *
 * `config.ts` refuses to boot in production while any adapter is still `mock`,
 * which catches a deployment that forgot to configure one. It cannot catch the
 * more likely mistake: an adapter pointed at the right provider with the wrong
 * *mapping*. Every adapter reads its provider's response through configurable
 * field paths and maps that provider's status words onto the platform's, and
 * none of those mappings has been confirmed against a real endpoint.
 *
 * A wrong mapping is quiet. `KYC_CLEARED_VALUES` that does not contain the word
 * the vendor actually returns means every applicant lands in UNDER_REVIEW and
 * no agent is ever cleared — which looks like a slow review queue, not a
 * misconfiguration. `TIN_ASSIGNED_VALUES` missing the right word means every
 * taxpayer waits forever for a number the service already issued. The adapters
 * fail closed, which is right, and failing closed silently for six weeks is
 * still a failure.
 *
 * So this asks each configured provider a real question and reports what came
 * back, in terms of the platform's own vocabulary. It changes nothing: no
 * taxpayer is registered, no agent is cleared, no payment is made. It is a
 * read-only conversation whose purpose is to turn "we think the mapping is
 * right" into evidence.
 *
 *   npm run verify:integrations -- --tin 12345678901
 *   npm run verify:integrations -- --all
 *
 * Exit code 0 when every configured integration answered in a way the platform
 * understood; 1 when any did not. Suitable for a go-live gate.
 */

import { config } from '../config';
import { log } from '../lib/logger';
import { tinService } from '../integrations/tin';
import { kycProvider } from '../integrations/kyc';
import { vehicleRegistry } from '../integrations/vehicles';
import { bankVerification } from '../integrations/banks';
import { gateway } from '../integrations/gateway';
import { smsProvider } from '../services/messaging';

interface Check {
  name: string;
  configured: string;
  /** What was asked. */
  question: string;
  /** What the platform made of the answer. */
  outcome: string;
  /** Whether the platform understood it at all. */
  understood: boolean;
  detail?: string;
}

const results: Check[] = [];

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const wantsAll = process.argv.includes('--all');
function wants(flag: string): boolean {
  return wantsAll || process.argv.includes(flag);
}

/**
 * An outcome the adapter uses to say "I could not ask" is not a mapping
 * failure — it is a connectivity or credentials failure, and it is reported
 * differently because the fix is different.
 */
function record(check: Check): void {
  results.push(check);
  // A mock answers confidently and is never evidence of anything. Printing
  // `ok` next to it is how a log kept for 180 days comes to say the
  // integrations were checked when no provider was ever contacted.
  const symbol = check.configured === 'mock' ? 'MOCK' : check.understood ? 'ok  ' : 'FAIL';
  console.log(`  ${symbol}  ${check.name.padEnd(22)} ${check.outcome}`);
  if (check.detail) console.log(`        ${check.detail}`);
}

async function verifyTin(): Promise<void> {
  const tin = argValue('--tin');
  if (!tin) {
    console.log('  skip  TIN                    pass --tin <a real TIN> to check the lookup mapping');
    return;
  }

  const result = await tinService.lookup(tin);
  record({
    name: 'TIN lookup',
    configured: config.integrations.tinService,
    question: `lookup ${tin}`,
    outcome: result.outcome,
    // UNAVAILABLE means the service could not be reached at all. FOUND and
    // NOT_FOUND both mean the mapping worked — the platform read the answer.
    understood: result.outcome !== 'UNAVAILABLE',
    detail:
      result.outcome === 'UNAVAILABLE'
        ? `could not reach the TIN service: ${result.reason ?? 'no reason given'}`
        : result.outcome === 'FOUND'
          ? `resolved to "${result.fullName ?? '(no name in response)'}"`
          : 'the service says there is no such TIN — correct if you passed an unknown one',
  });
}

async function verifyKyc(): Promise<void> {
  const identity = argValue('--nin');
  if (!identity) {
    console.log('  skip  KYC                    pass --nin <a sandbox identity> to check the mapping');
    return;
  }

  const result = await kycProvider.verify({
    identityType: 'NIN',
    identityNumber: identity,
    firstName: argValue('--first-name') ?? 'Verification',
    lastName: argValue('--last-name') ?? 'Probe',
    dateOfBirth: argValue('--dob') ?? '1990-01-01',
    phone: argValue('--phone') ?? '+2348000000000',
  });

  // UNDER_REVIEW is what an unrecognised status maps to. That is the correct
  // fail-closed behaviour and also exactly what a wrong mapping looks like, so
  // it is reported as needing a human to confirm rather than as a pass.
  const unmapped = result.status === 'UNDER_REVIEW';
  record({
    name: 'KYC verification',
    configured: config.integrations.kycProvider,
    question: `verify NIN ending ${identity.slice(-2)}`,
    outcome: result.status,
    understood: result.status !== 'UNAVAILABLE' && !unmapped,
    detail: unmapped
      ? 'UNDER_REVIEW means the vendor returned a status the mapping does not recognise. ' +
        'Add it to KYC_CLEARED_VALUES / KYC_FAILED_VALUES / KYC_MORE_INFO_VALUES, ' +
        'or confirm this identity really is inconclusive.'
      : result.failureReason,
  });
}

async function verifyVehicleRegistry(): Promise<void> {
  const registration = argValue('--plate');
  if (!registration) {
    console.log('  skip  Vehicle registry       pass --plate <a real registration> to check it');
    return;
  }

  const result = await vehicleRegistry.lookup(registration);
  record({
    name: 'Vehicle registry',
    configured: config.integrations.vehicleRegistry,
    question: `lookup ${registration}`,
    outcome: result.outcome,
    understood: result.outcome !== 'UNAVAILABLE',
    detail:
      result.outcome === 'UNAVAILABLE'
        ? `could not reach the registry: ${result.reason ?? 'no reason given'}`
        : undefined,
  });
}

async function verifyBank(): Promise<void> {
  const account = argValue('--account');
  const bankCode = argValue('--bank-code');
  if (!account || !bankCode) {
    console.log('  skip  Bank verification      pass --account and --bank-code to check it');
    return;
  }

  const result = await bankVerification.verify({
    accountNumber: account,
    bankCode,
    // The name match is decided by the adapter; passing what the caller says
    // they expect is what makes MISMATCH meaningful here.
    expectedName: argValue('--account-name') ?? 'Verification Probe',
  });
  record({
    name: 'Bank verification',
    configured: config.integrations.bankVerification,
    question: `resolve ${bankCode}/${account.slice(-4)}`,
    outcome: result.outcome,
    understood: result.outcome !== 'UNAVAILABLE',
    detail:
      result.accountName
        ? `the bank holds this account as "${result.accountName}"`
        : result.failureReason,
  });
}

async function verifyGateway(): Promise<void> {
  const reference = argValue('--rrr');
  if (!reference) {
    console.log('  skip  Payment gateway        pass --rrr <a known reference> to check status mapping');
    return;
  }

  const result = await gateway.verify(reference);
  // PENDING is what an unmapped status code becomes. Same reasoning as
  // UNDER_REVIEW above: correct, and indistinguishable from a bad mapping.
  const unmapped = result.status === 'PENDING' || result.status === 'UNKNOWN';
  record({
    name: 'Payment gateway',
    configured: config.payments.gateway,
    question: `verify ${reference}`,
    outcome: result.status,
    understood: !unmapped,
    detail: unmapped
      ? 'An unmapped status code stays PENDING, which is safe but means this reference ' +
        'can never be confirmed. Check REMITA_SUCCESS_STATUS_CODES against what the ' +
        'gateway returned for a reference you know was paid.'
      : `amount ${result.amountKobo ?? '(none reported)'} kobo`,
  });
}

async function verifyMessaging(): Promise<void> {
  const recipient = argValue('--sms');
  if (!recipient) {
    console.log('  skip  SMS provider           pass --sms <your own number> to send one test message');
    return;
  }

  // The only check here that has a side effect, which is why it needs an
  // explicit number rather than running under --all.
  const result = await smsProvider.send({
    channel: 'SMS',
    recipient,
    subject: null,
    message: 'PSIRS integration verification. No action needed.',
  });
  record({
    name: 'SMS provider',
    configured: config.notifications.smsProvider,
    question: `send to ${recipient.slice(0, 6)}…`,
    outcome: result.outcome,
    understood: result.outcome !== 'UNAVAILABLE',
    detail: result.outcome === 'SENT' ? `provider reference ${result.reference || '(none)'}` : result.reason,
  });
}

async function main(): Promise<void> {
  console.log('Integration verification');
  console.log(`  environment: ${config.env}`);
  console.log('');
  console.log('  Configured providers:');
  for (const [name, value] of [
    ['payment gateway', config.payments.gateway],
    ['TIN service', config.integrations.tinService],
    ['KYC provider', config.integrations.kycProvider],
    ['vehicle registry', config.integrations.vehicleRegistry],
    ['bank verification', config.integrations.bankVerification],
    ['SMS provider', config.notifications.smsProvider],
  ] as const) {
    const marker = value === 'mock' ? '  (mock — nothing real is being checked)' : '';
    console.log(`    ${name.padEnd(20)} ${value}${marker}`);
  }
  console.log('');

  const anyMock = [
    config.payments.gateway,
    config.integrations.tinService,
    config.integrations.kycProvider,
    config.integrations.vehicleRegistry,
    config.integrations.bankVerification,
    config.notifications.smsProvider,
  ].includes('mock');

  if (anyMock) {
    console.log('  NOTE: at least one provider is still "mock". Verifying a mock proves');
    console.log('        nothing about the real service. Point the adapters at the');
    console.log('        provider sandboxes before treating this as evidence.');
    console.log('');
  }

  console.log('  Checks:');
  if (wants('--tin')) await verifyTin();
  else console.log('  skip  TIN                    (--tin)');
  if (wants('--nin')) await verifyKyc();
  else console.log('  skip  KYC                    (--nin)');
  if (wants('--plate')) await verifyVehicleRegistry();
  else console.log('  skip  Vehicle registry       (--plate)');
  if (wants('--account')) await verifyBank();
  else console.log('  skip  Bank verification      (--account, --bank-code)');
  if (wants('--rrr')) await verifyGateway();
  else console.log('  skip  Payment gateway        (--rrr)');
  // Never under --all: it sends a real message to a real person.
  if (process.argv.includes('--sms')) await verifyMessaging();
  else console.log('  skip  SMS provider           (--sms, never included in --all)');

  console.log('');
  const mocked = results.filter((r) => r.configured === 'mock');
  const failed = results.filter((r) => r.configured !== 'mock' && !r.understood);
  const checked = results.length;

  if (checked === 0) {
    console.log('  Nothing was checked. Pass at least one of --tin, --nin, --plate,');
    console.log('  --account, --rrr, --sms, or --all.');
    process.exitCode = 1;
    return;
  }

  // A run whose subject was a mock proves nothing, so it must not end in the
  // sentence that invites it to be filed as proof. This is not pedantry about
  // wording: this output is the artefact the daily job keeps for 180 days as
  // the evidence closing B-4, and an auditor reading it four months later has
  // only these lines to go on.
  if (mocked.length > 0) {
    console.log(`  ${mocked.length} of ${checked} check(s) were answered by a development mock:`);
    for (const check of mocked) {
      console.log(`    - ${check.name} (${check.configured})`);
    }
    console.log('');
    console.log('  A mock answers whatever it was written to answer. These checks are not');
    console.log('  evidence about any real provider and this run cannot be recorded as');
    console.log('  verification. Point the adapters at the provider sandboxes and run again.');
    process.exitCode = 1;
    if (failed.length === 0) return;
    console.log('');
  }

  if (failed.length === 0) {
    console.log(`  ${checked} check(s) ran and every answer was understood by the platform.`);
    console.log('  Record this output against the go-live checklist.');
    return;
  }

  console.log(`  ${failed.length} of ${checked} check(s) reached a real provider and produced an`);
  console.log('  answer the platform could not act on. These are not ready for production:');
  for (const check of failed) {
    console.log(`    - ${check.name}: ${check.outcome}`);
  }
  process.exitCode = 1;
}

main().catch((error) => {
  log.error('integration verification failed to run', { component: 'verify-integrations', error });
  process.exitCode = 1;
});
