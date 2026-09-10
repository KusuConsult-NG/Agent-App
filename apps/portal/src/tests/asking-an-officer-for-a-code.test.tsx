/**
 * The prompt that guards every consequential decision in this portal.
 *
 * Step-up sits in front of signing an audit report, approving a commission
 * payout, granting a permission, and reversing a payment. It asks for a code
 * sent to the officer's phone, and until now it asked in English — a
 * `window.prompt` literal in `lib/api.ts`, in a portal that has offered Hausa
 * since it was translated.
 *
 * It was invisible for a structural reason worth recording: the portal's
 * English-literal check read `screens/`, `App.tsx` and `ui.tsx`, and never
 * `lib/`. The agent's copy of that check was extended to its own `lib/` this
 * morning, after six English sentences were found being thrown from modules;
 * the portal's was not. So the module every guarded money decision passes
 * through was the one module nothing read.
 *
 * The second half is worse than the wording. Dismissing the prompt threw a
 * plain `Error`, and thirty-three handlers across this portal write
 * `caught instanceof ApiRequestError ? caught.error : null`. A plain Error is
 * not that, so it became `null`, and `ErrorAlert` renders nothing for null:
 * the officer pressed "sign", dismissed the prompt, watched the button stop
 * spinning, and was told nothing at all.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { ApiRequestError, api, stepUp } from '../lib/api';
import { ErrorAlert } from '../ui';
import { setPortalLanguage } from '../lib/i18n';

const en = translations.en as unknown as Record<string, string>;
const ha = translations.ha as unknown as Record<string, string>;

let asked: string | null = null;

beforeEach(() => {
  cleanup();
  asked = null;
  setPortalLanguage('en');
  /*
   * Defined rather than spied on: jsdom does not implement `window.prompt` at
   * all, so there is nothing to spy on. Which is its own small finding — any
   * screen test that reaches a step-up in this environment throws on the
   * prompt rather than on the assertion, and reads as a broken test.
   */
  Object.defineProperty(window, 'prompt', {
    configurable: true,
    writable: true,
    value: (message?: string) => {
      asked = message ?? null;
      return null; // The officer dismisses it.
    },
  });
  // No `developmentCode`, so the prompt is reached — which is what production
  // does, and what the development shortcut hides.
  vi.spyOn(api, 'post').mockResolvedValue({} as never);
});

afterEach(() => {
  setPortalLanguage('en');
  vi.restoreAllMocks();
});

describe('asking an officer for a code', () => {
  it('asks in the language the officer is reading', async () => {
    setPortalLanguage('ha');
    await expect(stepUp('audit.report.sign', '+2348000000009')).rejects.toThrow();
    expect(asked).toBe(ha.stepUpEnterCode);
    expect(asked).not.toBe(en.stepUpEnterCode);
  });

  it('asks in English when that is what they are reading', async () => {
    await expect(stepUp('audit.report.sign', '+2348000000009')).rejects.toThrow();
    expect(asked).toBe(en.stepUpEnterCode);
  });

  /**
   * The refusal has to survive the shape every handler in this portal reads.
   *
   * `instanceof ApiRequestError` is the test thirty-three call sites apply,
   * and anything failing it is turned into `null` and rendered as nothing.
   * This is not a claim about the class hierarchy — it is the reason an
   * officer is told their signature did not happen.
   */
  it('refuses in a shape the screens do not throw away', async () => {
    const caught = await stepUp('audit.report.sign', '+2348000000009').then(
      () => null,
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(ApiRequestError);
    expect((caught as ApiRequestError).error.code).toBe('STEP_UP_ABANDONED');
  });

  /**
   * And it has to reach the screen, which is a separate claim.
   *
   * `ErrorAlert` renders `error.message` raw, so a refusal carrying the right
   * shape and the wrong words would still arrive in English. Rendered here
   * through the real component rather than asserted about the object.
   */
  it('puts the refusal on the screen in Hausa', async () => {
    setPortalLanguage('ha');
    const caught = (await stepUp('x', '+2348000000009').catch((error) => error)) as ApiRequestError;

    render(<ErrorAlert error={caught.error} />);
    await waitFor(() => {
      expect(screen.getByText(ha.stepUpCodeRequired)).toBeTruthy();
    });
    expect(screen.queryByText(en.stepUpCodeRequired)).toBeNull();
  });

  it('has real Hausa for both halves of the exchange', () => {
    for (const key of ['stepUpEnterCode', 'stepUpCodeRequired'] as const) {
      expect(ha[key], `${key} has no Hausa`).toBeTruthy();
      expect(ha[key], `${key} was never translated`).not.toBe(en[key]);
    }
    // "is required ... before you continue" — a condition, not a refusal to act.
    expect(ha.stepUpCodeRequired).toMatch(/\b(bukatar|kafin)\b/);
  });
});
