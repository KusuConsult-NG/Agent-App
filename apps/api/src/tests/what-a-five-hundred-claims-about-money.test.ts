/**
 * The one error nobody anticipated, speaking with more confidence than any
 * other.
 *
 * Every unhandled exception in this API is answered by `internal()`. It said:
 *
 *     "The request could not be completed because of a problem on our side.
 *      No financial record has been changed. Quote the reference below to
 *      support."                              moneyStatus: NOT_DEBITED
 *
 * `MoneyStatus` defines NOT_DEBITED as "No payment was attempted; nothing has
 * been debited". An exception nobody anticipated can be thrown after a
 * transaction has committed, after a gateway has accepted a payment, after a
 * receipt has been issued — and the error handler that calls this says exactly
 * that, four lines above the call: "on a revenue platform an unhandled
 * exception is a taxpayer who paid and has no receipt."
 *
 * What the agent sees makes it concrete. `ui.tsx` renders NOT_DEBITED as
 * *"No money has been taken from the taxpayer"* — "Ba a karbi kudi daga mai
 * biyan haraji ba" — in plain error styling, not the warning styling it
 * reserves for UNCONFIRMED's *"Do not collect again."* So at the moment the
 * platform knew least, it told the person standing in front of a citizen who
 * had just handed over cash that the cash was still theirs.
 *
 * THE RULE IS THE CLIENT'S OWN. `apps/agent/src/lib/api.ts` already decides
 * this correctly for a request that never got an answer at all — a read moves
 * no money either way, a write under `/payments` is a write whose effect is
 * unknown, every other write is NOT_APPLICABLE "because telling an agent their
 * taxpayer may have been debited by a failed support ticket is its own kind of
 * wrong". A 500 is the same situation with a status line attached. The server
 * now gives the same answer.
 *
 * The last test is the one that matters most: a NOT_DEBITED the platform *can*
 * prove must survive. `paymentFailed` says it because the gateway said so, and
 * a fix that swept every NOT_DEBITED away would have cost an agent the one
 * message that lets them collect again in good conscience.
 */

import './env';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IllegalTransitionError } from '@psirs/shared';
import { errorHandler } from '../middleware/error-handler';
import { internal, paymentFailed, AppError } from '../lib/errors';

interface Body {
  error: {
    code: string;
    message: string;
    moneyStatus: string;
    nextStep?: string;
    reference?: string;
  };
}

/** Drive the real handler, so the wiring is covered and not just `internal`. */
function five_hundred(method: string, path: string, thrown?: Error): { status: number; body: Body } {
  const req = {
    method,
    path,
    requestId: 'req-under-test',
    header: () => undefined,
    auth: undefined,
  } as never;

  let status = 0;
  let body: Body | null = null;
  const res = {
    headersSent: false,
    status(code: number) {
      status = code;
      return this;
    },
    json(sent: Body) {
      body = sent;
      return this;
    },
    setHeader() {
      return this;
    },
  };

  errorHandler(thrown ?? new Error('something nobody anticipated'), req, res as never, (() => {}) as never);
  assert.ok(body, 'the handler sent nothing at all');
  return { status, body: body! };
}

/** A unique violation as node-postgres reports one. */
function uniqueViolation(constraint: string): Error {
  return Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
    code: '23505',
    constraint,
  });
}

/** The sentences that assert a financial outcome this path cannot know. */
const CLAIMS_NOTHING_HAPPENED = /no financial record has been changed|no money has been taken|nothing has been debited/i;

describe('what a 500 claims about the money', () => {
  it('says the outcome is unknown when the request was a payment write', async () => {
    const { status, body } = five_hundred('POST', '/payments/initiate');

    assert.equal(status, 500);
    assert.equal(
      body.error.moneyStatus,
      'UNCONFIRMED',
      'an exception nobody anticipated cannot know whether the gateway took the money',
    );
    assert.match(body.error.message, /not known/i);
    assert.ok(body.error.nextStep, 'an agent holding cash needs to be told what to do next');
    assert.match(body.error.nextStep!, /before collecting anything again/i);
  });

  it('claims nothing about money for a write that is not a payment', () => {
    // NOT_APPLICABLE rather than UNCONFIRMED: telling an agent their taxpayer
    // may have been debited by a failed support ticket is its own kind of
    // wrong, which is the client's phrase for the same decision.
    const { body } = five_hundred('POST', '/support/tickets');

    assert.equal(body.error.moneyStatus, 'NOT_APPLICABLE');
    assert.equal(body.error.nextStep, undefined);
  });

  it('claims nothing about money for a read', () => {
    const { body } = five_hundred('GET', '/reference/lgas');
    assert.equal(body.error.moneyStatus, 'NOT_APPLICABLE');
  });

  it('never asserts that nothing happened, on any path', () => {
    /*
     * The class rather than the three cases. An unhandled exception is by
     * definition one nobody thought about; there is no path on which it may
     * say what did or did not happen.
     */
    const paths: [string, string][] = [
      ['POST', '/payments/initiate'],
      ['POST', '/payments/simulate'],
      ['POST', '/taxpayers'],
      ['POST', '/revenue/assessments'],
      ['POST', '/vehicles/renewals'],
      ['POST', '/support/tickets'],
      ['GET', '/reference/lgas'],
      ['GET', '/payments'],
    ];

    const claiming: string[] = [];
    for (const [method, path] of paths) {
      const { body } = five_hundred(method, path);
      if (CLAIMS_NOTHING_HAPPENED.test(body.error.message)) {
        claiming.push(`${method} ${path}: ${body.error.message}`);
      }
      if (body.error.moneyStatus === 'NOT_DEBITED') {
        claiming.push(`${method} ${path}: moneyStatus NOT_DEBITED`);
      }
    }

    assert.deepEqual(
      claiming,
      [],
      `a 500 cannot know this, and these said it anyway:\n${claiming.join('\n')}`,
    );
  });

  it('is the same whether or not the handler was told the request', () => {
    // `internal()` is called with the request by the error handler and without
    // it by anything that constructs one directly. The no-argument form must
    // still not claim anything, rather than falling back to the old sentence.
    const bare = internal('req-under-test').toJSON() as Body;
    assert.doesNotMatch(bare.error.message, CLAIMS_NOTHING_HAPPENED);
    assert.notEqual(bare.error.moneyStatus, 'NOT_DEBITED');
  });

  it('leaves a NOT_DEBITED the platform can actually prove', () => {
    /*
     * THE CONTROL, and the point of it.
     *
     * `paymentFailed` is raised when the gateway has told us the payment did
     * not go through. That is knowledge, not a guess, and it is the one
     * message that lets an agent collect again in good conscience. A fix that
     * swept every NOT_DEBITED out of the codebase would have cost them it.
     */
    const failed = paymentFailed('TXN-2026-000001', 'the card was declined').toJSON() as Body;

    assert.equal(failed.error.moneyStatus, 'NOT_DEBITED');
    assert.match(failed.error.message, /no money has been taken/i);
  });

  it('says the same about a reference the platform composed twice', () => {
    /*
     * The 23505 branch made the identical claim and had not had the identical
     * correction. A clash on a composed reference — `PSIRS/2026/000123`,
     * `ASM/2026/000456` — is a generator fault, and it was answered 409
     * DUPLICATE_RECORD with `moneyStatus: NOT_DEBITED`: "No money has been
     * taken from the taxpayer", on a write under /payments, at the moment a
     * receipt was being numbered. A receipt is numbered after the money has
     * arrived.
     *
     * Driven here rather than end to end because the payment reference
     * carries a random suffix on purpose, so it cannot be made to collide.
     * `a-reference-the-platform-composed-twice.test.ts` provokes the real
     * thing on the assessment sequence, which is what a restore without
     * setval leaves.
     */
    const { status, body } = five_hundred(
      'POST',
      '/payments/initiate',
      uniqueViolation('receipts_verification_code_key'),
    );

    assert.equal(status, 500, `answered ${status}, so the caller was blamed for it`);
    assert.equal(body.error.moneyStatus, 'UNCONFIRMED');
    assert.doesNotMatch(body.error.message, CLAIMS_NOTHING_HAPPENED);
    assert.ok(body.error.reference, 'and nothing for the agent to quote');
  });

  it('claims nothing about money when the composed reference was not on a payment path', () => {
    const { status, body } = five_hundred(
      'POST',
      '/revenue/assessments',
      uniqueViolation('assessments_assessment_number_key'),
    );
    assert.equal(status, 500);
    assert.equal(body.error.moneyStatus, 'NOT_APPLICABLE');
  });

  it('leaves a duplicate somebody really created as a duplicate', () => {
    /*
     * The control. `departments_code_key` is a code an officer typed and it
     * keeps both its 409 and the sentence that names what they typed —
     * otherwise this change would have turned every collision into a 500 and
     * taken the actionable refusals with it.
     */
    const { status, body } = five_hundred(
      'POST',
      '/government/departments',
      uniqueViolation('departments_code_key'),
    );
    assert.equal(status, 409);
    assert.equal(body.error.code, 'DUPLICATE_RECORD');
    assert.match(body.error.message, /already uses that code/);
  });

  it('does not claim nothing was taken when a settled transaction refused a move', () => {
    /*
     * The same false claim, in the branch next door.
     *
     * An `IllegalTransitionError` means this request changed nothing — the
     * state machine refused it — so the honest money state is whatever the
     * record already said. The branch answered every one of them
     * `NOT_DEBITED`, which `MoneyStatus` defines as "No payment was
     * attempted" and the agent application renders as "No money has been
     * taken from the taxpayer".
     *
     * SETTLED is in `REVENUE_RECOGNISED_STATES` — "States in which government
     * money is considered actually received". A re-receipt attempt against a
     * settled transaction was therefore answered with the one sentence that
     * contradicts the record it was refused by. RECEIVED exists for exactly
     * this: "Money was received; the failure is downstream of the payment
     * itself."
     */
    const { status, body } = five_hundred(
      'POST',
      '/payments/abc/confirm',
      new IllegalTransitionError('Transaction', 'SETTLED', 'RECEIPT_GENERATED'),
    );
    assert.equal(status, 409);
    assert.equal(body.error.code, 'ILLEGAL_STATE_TRANSITION');
    assert.equal(body.error.moneyStatus, 'RECEIVED');
    assert.doesNotMatch(body.error.message, CLAIMS_NOTHING_HAPPENED);
  });

  it('says the outcome is unknown while the payment is still in flight', () => {
    const { status, body } = five_hundred(
      'POST',
      '/payments/abc/confirm',
      new IllegalTransitionError('Transaction', 'PAYMENT_PENDING', 'SETTLED'),
    );
    assert.equal(status, 409);
    assert.equal(body.error.moneyStatus, 'UNCONFIRMED');
  });

  it('keeps the reassurance where it is true', () => {
    // Before a payment is started, NOT_DEBITED is the thing the agent needs
    // in order to tell the citizen nothing was taken. It stays.
    const { body } = five_hundred(
      'POST',
      '/payments/initiate',
      new IllegalTransitionError('Transaction', 'INVOICE_GENERATED', 'SETTLED'),
    );
    assert.equal(body.error.moneyStatus, 'NOT_DEBITED');
  });

  it('reads the payment machine by its own state names, not the transaction\'s', () => {
    /*
     * Two machines track the same money under different words: a payment is
     * VERIFIED where a transaction is PAYMENT_VERIFIED. Mapping one set onto
     * both would have made every payment refusal read NOT_DEBITED, which is
     * the defect with an extra step.
     */
    const verified = five_hundred(
      'POST',
      '/payments/abc/confirm',
      new IllegalTransitionError('Payment', 'VERIFIED', 'SUCCESSFUL'),
    );
    assert.equal(verified.body.error.moneyStatus, 'RECEIVED');

    const pending = five_hundred(
      'POST',
      '/payments/abc/confirm',
      new IllegalTransitionError('Payment', 'PENDING', 'VERIFIED'),
    );
    assert.equal(pending.body.error.moneyStatus, 'UNCONFIRMED');

    const failed = five_hundred(
      'POST',
      '/payments/abc/confirm',
      new IllegalTransitionError('Payment', 'FAILED', 'VERIFIED'),
    );
    assert.equal(failed.body.error.moneyStatus, 'NOT_DEBITED');
  });

  it("says nothing about the taxpayer's money when the entity is not theirs", () => {
    /*
     * A commission is the agent's fee. An illegal transition on one told the
     * agent "No money has been taken from the taxpayer", which is an answer
     * to a question nobody asked — and one an agent requesting a payout could
     * reach, because `requestPayout` transitions commissions.
     */
    const { body } = five_hundred(
      'POST',
      '/agents/me/commission/payout',
      new IllegalTransitionError('Commission', 'PAID', 'ELIGIBLE'),
    );
    assert.equal(body.error.moneyStatus, 'NOT_APPLICABLE');
    assert.doesNotMatch(body.error.message, CLAIMS_NOTHING_HAPPENED);
  });

  it('still answers an anticipated error with what that error knows', () => {
    // The second control: this changes the unhandled path only. An AppError
    // thrown deliberately is passed through with its own money status.
    const req = { method: 'POST', path: '/payments/initiate', requestId: 'r', header: () => undefined } as never;
    let body: Body | null = null;
    const res = {
      headersSent: false,
      status() { return this; },
      json(sent: Body) { body = sent; return this; },
      setHeader() { return this; },
    };
    errorHandler(
      new AppError({ statusCode: 402, code: 'PAYMENT_FAILED', message: 'x', moneyStatus: 'NOT_DEBITED' }),
      req,
      res as never,
      (() => {}) as never,
    );
    assert.equal(body!.error.moneyStatus, 'NOT_DEBITED');
  });
});
