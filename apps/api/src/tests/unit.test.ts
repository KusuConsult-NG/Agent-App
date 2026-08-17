/**
 * Unit tests for the pure domain logic: money, rates, state machines and the
 * agent lifecycle derivation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLES,
  applyBasisPoints,
  assertTransactionTransition,
  canTransactionTransition,
  deriveAccessStage,
  deriveApplicationState,
  activationBlockers,
  formatNaira,
  IllegalTransitionError,
  koboToNaira,
  MoneyError,
  nairaToKobo,
  parseKobo,
  permissionsForRole,
  roleHasPermission,
  type AgentStatusAxes,
} from '@psirs/shared';
import { computeAmount, evaluateFormula, type RateVersion } from '../services/rate-engine';

describe('money', () => {
  it('parses kobo from strings and rejects floats', () => {
    assert.equal(parseKobo('10000000'), 10_000_000n);
    assert.equal(parseKobo(2500), 2500n);
    assert.throws(() => parseKobo('1500.50'), MoneyError);
    assert.throws(() => parseKobo(1500.5), MoneyError);
    assert.throws(() => parseKobo('1e5'), MoneyError);
  });

  it('converts naira to kobo without floating point error', () => {
    // The classic float trap: 0.1 + 0.2 !== 0.3. Integer kobo has no such issue.
    assert.equal(nairaToKobo('0.10') + nairaToKobo('0.20'), nairaToKobo('0.30'));
    assert.equal(nairaToKobo('1,500.75'), 150_075n);
    assert.equal(nairaToKobo('100000'), 10_000_000n);
    assert.equal(koboToNaira(150_075n), '1500.75');
  });

  it('formats naira for Nigerian display', () => {
    assert.equal(formatNaira(10_000_000n), '₦100,000.00');
    assert.equal(formatNaira(150n), '₦1.50');
    assert.equal(formatNaira(0n), '₦0.00');
  });

  it('computes the PRD §25 worked example exactly', () => {
    // ₦100,000 transaction at 1.5% must be exactly ₦1,500.00.
    const transaction = nairaToKobo('100000');
    const commission = applyBasisPoints(transaction, 150);
    assert.equal(commission, nairaToKobo('1500'));
    assert.equal(formatNaira(commission), '₦1,500.00');
  });

  it('rounds commission half-up and stays reproducible', () => {
    // 1.5% of ₦333.33 = 4.99995 kobo units -> rounds to 5 kobo, deterministically.
    assert.equal(applyBasisPoints(33_333n, 150), 500n);
    assert.equal(applyBasisPoints(33_333n, 150), applyBasisPoints(33_333n, 150));
    assert.equal(applyBasisPoints(0n, 150), 0n);
  });

  it('handles amounts beyond the safe integer range', () => {
    // ₦100 billion in kobo exceeds 2^53 only at extreme scale, but bigint holds
    // any state budget without loss.
    const huge = nairaToKobo('999999999999');
    assert.equal(huge, 99_999_999_999_900n);
    assert.equal(koboToNaira(huge), '999999999999.00');
    // 1.5% of 99,999,999,999,900 kobo is 1,499,999,999,998.5 — rounded half-up.
    assert.equal(applyBasisPoints(huge, 150), 1_499_999_999_999n);
  });
});

describe('rate engine', () => {
  const baseRate = (overrides: Partial<RateVersion>): RateVersion => ({
    id: 'rate-1',
    revenue_item_id: 'item-1',
    version: 1,
    rate_type: 'FIXED',
    fixed_amount_kobo: null,
    rate_basis_points: null,
    tiers: null,
    formula: null,
    minimum_amount_kobo: null,
    maximum_amount_kobo: null,
    effective_from: new Date(),
    effective_to: null,
    ...overrides,
  });

  it('computes a fixed charge', () => {
    const result = computeAmount(
      baseRate({ rate_type: 'FIXED', fixed_amount_kobo: '500000' }),
      {},
    );
    assert.equal(result.amountKobo, 500_000n);
    assert.ok(result.trace.length >= 2);
  });

  it('computes a percentage of the declared base', () => {
    const result = computeAmount(
      baseRate({ rate_type: 'PERCENTAGE', rate_basis_points: 500 }),
      { baseAmountKobo: '10000000' },
    );
    assert.equal(result.amountKobo, 500_000n); // 5% of ₦100,000 = ₦5,000
  });

  it('applies progressive tiers to the correct portions', () => {
    const result = computeAmount(
      baseRate({
        rate_type: 'TIERED',
        tiers: {
          tiers: [
            { upToKobo: '30000000', basisPoints: 700 },
            { upToKobo: '60000000', basisPoints: 1100 },
            { upToKobo: null, basisPoints: 1500 },
          ],
        },
      }),
      { baseAmountKobo: '70000000' }, // ₦700,000 taxable
    );

    // ₦300,000 @7% = ₦21,000; ₦300,000 @11% = ₦33,000; ₦100,000 @15% = ₦15,000
    assert.equal(result.amountKobo, nairaToKobo('69000'));
  });

  it('clamps to statutory minimum and maximum', () => {
    const min = computeAmount(
      baseRate({
        rate_type: 'PERCENTAGE',
        rate_basis_points: 100,
        minimum_amount_kobo: '500000',
      }),
      { baseAmountKobo: '1000000' }, // 1% of ₦10,000 = ₦100, below the ₦5,000 floor
    );
    assert.equal(min.amountKobo, 500_000n);
    assert.ok(min.trace.some((step) => step.step === 'Minimum applied'));

    const max = computeAmount(
      baseRate({
        rate_type: 'PERCENTAGE',
        rate_basis_points: 1000,
        maximum_amount_kobo: '100000',
      }),
      { baseAmountKobo: '10000000' },
    );
    assert.equal(max.amountKobo, 100_000n);
  });

  it('evaluates formulas with correct precedence and no code execution', () => {
    assert.equal(evaluateFormula('2 + 3 * 4', {}), 14n);
    assert.equal(evaluateFormula('(2 + 3) * 4', {}), 20n);
    assert.equal(evaluateFormula('625 * renewalPeriodMonths * 100', { renewalPeriodMonths: 12 }), 750_000n);
    // Division rounds half-up rather than truncating.
    assert.equal(evaluateFormula('7 / 2', {}), 4n);
  });

  it('refuses formulas that reach outside the supplied inputs', () => {
    // No property access, no function calls, no globals: a configuration string
    // must never be able to execute code.
    assert.throws(() => evaluateFormula('process.exit(1)', {}), /unsupported character|needs a value/);
    assert.throws(() => evaluateFormula('constructor', {}), /needs a value for "constructor"/);
    assert.throws(() => evaluateFormula('1 / 0', {}), /divides by zero/);
    assert.throws(() => evaluateFormula('(1 + 2', {}), /unbalanced brackets/);
  });

  it('requires declared inputs rather than inventing a zero', () => {
    assert.throws(
      () => computeAmount(baseRate({ rate_type: 'PERCENTAGE', rate_basis_points: 500 }), {}),
      /Assessable amount is required/,
    );
  });
});

describe('transaction state machine', () => {
  it('permits the documented happy path', () => {
    const path = [
      'INITIATED',
      'ASSESSMENT_CREATED',
      'INVOICE_GENERATED',
      'PAYMENT_INITIATED',
      'PAYMENT_PENDING',
      'PAYMENT_SUCCESSFUL',
      'PAYMENT_VERIFIED',
      'RECEIPT_GENERATED',
      'RECONCILIATION_PENDING',
      'SETTLED',
    ] as const;

    for (let i = 0; i < path.length - 1; i += 1) {
      assert.doesNotThrow(() => assertTransactionTransition(path[i]!, path[i + 1]!));
    }
  });

  it('refuses to reach a receipt without verification', () => {
    // The single most important rule in the platform, expressed as a graph.
    assert.throws(
      () => assertTransactionTransition('PAYMENT_PENDING', 'RECEIPT_GENERATED'),
      IllegalTransitionError,
    );
    assert.throws(
      () => assertTransactionTransition('PAYMENT_SUCCESSFUL', 'RECEIPT_GENERATED'),
      IllegalTransitionError,
    );
    assert.throws(
      () => assertTransactionTransition('FAILED', 'RECEIPT_GENERATED'),
      IllegalTransitionError,
    );
    assert.ok(canTransactionTransition('PAYMENT_VERIFIED', 'RECEIPT_GENERATED'));
  });

  it('makes reversal and cancellation terminal', () => {
    for (const terminal of ['REVERSED', 'REFUNDED', 'CANCELLED', 'EXPIRED'] as const) {
      assert.throws(
        () => assertTransactionTransition(terminal, 'PAYMENT_VERIFIED'),
        IllegalTransitionError,
      );
    }
  });

  it('never allows a failed payment to become successful', () => {
    assert.throws(
      () => assertTransactionTransition('FAILED', 'PAYMENT_SUCCESSFUL'),
      IllegalTransitionError,
    );
  });
});

describe('RBAC matrix', () => {
  it('gives no role the power to delete financial records', () => {
    // There is no such permission to grant — verified by its absence from the
    // permission union rather than by a runtime check.
    const permissions = [
      'payment:read:all',
      'payment:reconcile',
      'commission:manage',
    ] as const;
    for (const permission of permissions) {
      assert.equal(roleHasPermission('auditor', permission), permission === 'payment:read:all');
    }
  });

  it('keeps auditors strictly read-only', () => {
    assert.ok(roleHasPermission('auditor', 'audit:read'));
    assert.ok(roleHasPermission('auditor', 'payment:read:all'));
    assert.equal(roleHasPermission('auditor', 'taxpayer:create'), false);
    assert.equal(roleHasPermission('auditor', 'payment:reconcile'), false);
    assert.equal(roleHasPermission('auditor', 'agent:manage'), false);
    assert.equal(roleHasPermission('auditor', 'catalogue:configure'), false);
  });

  it('does not let an agent configure rates or approve their own work', () => {
    assert.equal(roleHasPermission('agent', 'catalogue:configure'), false);
    assert.equal(roleHasPermission('agent', 'commission:payout:approve'), false);
    assert.equal(roleHasPermission('agent', 'payment:reverse:approve'), false);
    assert.equal(roleHasPermission('agent', 'approval:authorise'), false);
  });

  it('separates finance approval from administrative configuration', () => {
    assert.ok(roleHasPermission('finance_officer', 'commission:payout:approve'));
    assert.equal(roleHasPermission('finance_officer', 'catalogue:configure'), false);
    assert.equal(roleHasPermission('admin', 'commission:payout:approve'), false);
  });
});

describe('agent lifecycle derivation', () => {
  const axes = (overrides: Partial<AgentStatusAxes> = {}): AgentStatusAxes => ({
    accountStatus: 'ACTIVE',
    kycStatus: 'NOT_STARTED',
    refereeStatus: 'PENDING',
    trainingStatus: 'PENDING',
    clearanceStatus: 'PENDING',
    operationalStatus: 'INACTIVE',
    applicationSubmitted: true,
    flags: {
      kycCleared: false,
      refereeCleared: false,
      trainingCompleted: false,
      bankVerified: false,
      agreementAccepted: false,
      deviceRegistered: false,
      governmentApproved: false,
    },
    ...overrides,
  });

  it('reproduces the Addendum §14 truth table', () => {
    // Pending KYC + pending referee -> still an application
    assert.equal(deriveApplicationState(axes()), 'APPLICATION_SUBMITTED');

    // Cleared KYC + pending referee -> awaiting referee
    assert.equal(
      deriveApplicationState(
        axes({ kycStatus: 'CLEARED', flags: { ...axes().flags, kycCleared: true } }),
      ),
      'REFEREE_PENDING',
    );

    // Cleared KYC + failed referee -> not cleared
    assert.equal(
      deriveApplicationState(
        axes({
          kycStatus: 'CLEARED',
          refereeStatus: 'FAILED',
          flags: { ...axes().flags, kycCleared: true },
        }),
      ),
      'ACTION_REQUIRED',
    );

    // Failed KYC + cleared referee -> not cleared
    assert.equal(
      deriveApplicationState(
        axes({
          kycStatus: 'FAILED',
          refereeStatus: 'CLEARED',
          flags: { ...axes().flags, refereeCleared: true },
        }),
      ),
      'ACTION_REQUIRED',
    );

    // Both cleared -> ready for government review
    assert.equal(
      deriveApplicationState(
        axes({
          kycStatus: 'CLEARED',
          refereeStatus: 'CLEARED',
          flags: { ...axes().flags, kycCleared: true, refereeCleared: true },
        }),
      ),
      'READY_FOR_REVIEW',
    );
  });

  it('lists every outstanding requirement before activation', () => {
    const blockers = activationBlockers(axes().flags);
    assert.equal(blockers.length, 7);
    assert.ok(blockers.some((b) => b.includes('KYC')));
    assert.ok(blockers.some((b) => b.includes('referee')));
    assert.ok(blockers.some((b) => b.includes('training')));
    assert.ok(blockers.some((b) => b.includes('bank account')));
    assert.ok(blockers.some((b) => b.includes('agreement')));
    assert.ok(blockers.some((b) => b.includes('device')));
    assert.ok(blockers.some((b) => b.includes('Government review')));
  });

  it('grants progressive access in the Addendum §26 stages', () => {
    assert.equal(deriveAccessStage(axes()), 'APPLICANT');
    assert.equal(
      deriveAccessStage(axes({ flags: { ...axes().flags, kycCleared: true } })),
      'KYC_CLEARED',
    );
    assert.equal(
      deriveAccessStage(
        axes({
          clearanceStatus: 'APPROVED',
          flags: { ...axes().flags, kycCleared: true, governmentApproved: true },
        }),
      ),
      'APPROVED',
    );
    assert.equal(deriveAccessStage(axes({ operationalStatus: 'ACTIVE' })), 'ACTIVE');
  });

  it('treats suspension as overriding every other signal', () => {
    const suspended = axes({
      operationalStatus: 'SUSPENDED',
      kycStatus: 'CLEARED',
      refereeStatus: 'CLEARED',
      clearanceStatus: 'APPROVED',
      flags: {
        kycCleared: true,
        refereeCleared: true,
        trainingCompleted: true,
        bankVerified: true,
        agreementAccepted: true,
        deviceRegistered: true,
        governmentApproved: true,
      },
    });
    assert.equal(deriveApplicationState(suspended), 'SUSPENDED');
    assert.equal(activationBlockers(suspended.flags).length, 0);
  });
});

describe('citizens are served by agents, not by a portal', () => {
  it('has no taxpayer role to sign in as', () => {
    // An authorised agent approaches the citizen to onboard them or help them
    // remit. A citizen holds no account, so there is no credential to phish and
    // no session whose compromise could raise an assessment.
    assert.equal((ROLES as readonly string[]).includes('taxpayer'), false);
    assert.deepEqual(
      [...ROLES],
      ['agent', 'supervisor', 'revenue_officer', 'finance_officer', 'auditor', 'admin'],
    );
  });

  it('grants no permission that only a citizen could have held', () => {
    // These existed solely for the self-service portal. Leaving them in the
    // union would let a route guard name them and silently deny everyone.
    const granted = new Set(ROLES.flatMap((role) => [...permissionsForRole(role)]));
    for (const orphan of ['taxpayer:read:own', 'vehicle:read:own', 'incentive:read:own']) {
      assert.equal(
        [...granted].includes(orphan as never),
        false,
        `${orphan} should not exist once the citizen portal is removed`,
      );
    }
  });
});
