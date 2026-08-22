/**
 * Asking for a justification before an action that cannot be undone quietly.
 */

import { ApiRequestError, type ApiError } from './api';

/**
 * Ask for a justification, then do the thing — and say what happened either way.
 *
 * Actions that release money, close a discrepancy or settle a fraud flag each
 * used to be written out longhand at the call site with two holes in it.
 *
 * The first was silence on refusal: the `api.post` sat outside any try/catch,
 * so a rejection became an unhandled promise and the screen did not change. The
 * server's separation-of-duties check is the case that matters. "You cannot
 * approve a payout you requested yourself" is a real refusal, correctly
 * implemented, carefully worded — and the officer it exists to stop saw a
 * button that did nothing at all. A control nobody is told about is a control
 * that gets worked around, usually by asking a colleague to press the button
 * without explaining why.
 *
 * The second was silence on a short answer: `if (!reason || reason.length < n)
 * return` abandoned the action without a word, so typing four characters into
 * a box that wanted five looked exactly like success.
 *
 * `null` from the prompt means the person pressed Cancel, which is the one case
 * that should stay quiet — they changed their mind and know it.
 */
export async function withJustification(params: {
  question: string;
  minimum: number;
  tooShort: string;
  run: (justification: string) => Promise<void>;
  onSuccess: string;
  setError: (error: ApiError | null) => void;
  setMessage: (message: string | null) => void;
}): Promise<void> {
  const typed = window.prompt(params.question);
  if (typed === null) return;

  params.setError(null);
  params.setMessage(null);

  if (typed.trim().length < params.minimum) {
    params.setError({ code: 'CLIENT', message: params.tooShort, moneyStatus: 'NOT_APPLICABLE' });
    return;
  }

  try {
    await params.run(typed.trim());
    params.setMessage(params.onSuccess);
  } catch (caught) {
    if (caught instanceof ApiRequestError) params.setError(caught.error);
    else if (caught instanceof Error) {
      params.setError({ code: 'CLIENT', message: caught.message, moneyStatus: 'NOT_APPLICABLE' });
    }
  }
}

