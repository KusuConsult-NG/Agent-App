/**
 * A printer that will not print, in the language the agent reads.
 *
 * An agent stands in a market with a citizen waiting for their receipt. The
 * printer refuses — the paper ran out, the Bluetooth link dropped, the handset
 * never had Web Bluetooth to begin with. Every one of those has a remedy the
 * agent can act on in the next thirty seconds, and the screen's only job is to
 * say which one it is.
 *
 * It said it in English. `bluetooth-printer.ts` threw an Error carrying an
 * English sentence and both screens rendered `err.message || t.something`, so
 * the English beat the Hausa sitting immediately behind it. Six of those were
 * corrected in this application before these two were found, which is the
 * reason this file exists rather than a note saying the types make it
 * impossible: they do, and the previous six were impossible in the same way
 * until somebody rendered the screen.
 *
 * So this renders the screens. Both of them, through a real refusal.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { translations } from '@psirs/shared';
import { ProfileScreen } from '../screens/More';
import {
  PRINTER_PROBLEM_TEXT,
  PrinterUnavailable,
  bluetoothPrinter,
  type PrinterProblem,
} from '../lib/bluetooth-printer';
import { setAppLanguage } from '../lib/i18n';

const ha = translations.ha as unknown as Record<string, string>;
const en = translations.en as unknown as Record<string, string>;

beforeEach(() => {
  cleanup();
  setAppLanguage('ha');
  // A connected printer, so the test-slip button is on the screen at all.
  vi.spyOn(bluetoothPrinter, 'getState').mockReturnValue({
    status: 'connected',
    deviceName: 'RPP02N',
  } as never);
  vi.spyOn(bluetoothPrinter, 'subscribe').mockReturnValue(() => {});
});

afterEach(() => {
  setAppLanguage('en');
  vi.restoreAllMocks();
});

/** What the printer panel is telling the agent, and nothing else on the page. */
function said(): string {
  return document.querySelector('#printer-message')?.textContent ?? '';
}

/**
 * Every way `printTestSlip` can refuse, and what each should put on the screen.
 *
 * `CONNECT_FAILED` is not reachable from a slip that is already connected, and
 * is covered where it happens — connecting — so it is not asserted here.
 */
const REFUSALS: PrinterProblem[] = [
  'NOT_CONNECTED',
  'NO_WRITABLE_SERVICE',
  'SEND_FAILED',
  'DISCONNECTED',
  'UNSUPPORTED',
];

describe('a printer that refuses, on the agent screen', () => {
  for (const problem of REFUSALS) {
    it(`says ${problem} in Hausa`, async () => {
      vi.spyOn(bluetoothPrinter, 'printTestSlip').mockRejectedValue(
        new PrinterUnavailable(problem),
      );
      render(<ProfileScreen onSignOut={() => {}} />);
      fireEvent.click(screen.getByText(ha.morePrintTestSlip));

      const key = PRINTER_PROBLEM_TEXT[problem];
      /*
       * Read out of the message element rather than off the page.
       *
       * `getByText` across the document passed this test for `UNSUPPORTED`
       * with the bug still in place: jsdom has no Web Bluetooth, so the
       * screen prints `moreNoWebBluetooth` as a permanent hint, and the
       * assertion matched the hint while the message said something else.
       * Fourteen milliseconds and a green tick for a test of nothing.
       */
      await waitFor(() => {
        expect(said()).toBe(ha[key]);
      });
      // The English for this refusal, and the generic line that used to be
      // the loser of `err.message || t.morePrinterPrintFailed`.
      expect(said()).not.toBe(en[key]);
      expect(said()).not.toBe(en.morePrinterPrintFailed);
    });
  }

  /**
   * A failure from somewhere else still has to say something.
   *
   * Removing `err.message` removes the only thing that spoke for an error the
   * printer did not raise — a bug in the encoder, say. The generic line is the
   * right answer there, and it has to actually appear rather than leaving the
   * agent looking at a button that did nothing.
   */
  it('falls back to the general refusal for an error it does not recognise', async () => {
    vi.spyOn(bluetoothPrinter, 'printTestSlip').mockRejectedValue(
      new Error('Cannot read properties of undefined'),
    );
    render(<ProfileScreen onSignOut={() => {}} />);
    fireEvent.click(screen.getByText(ha.morePrintTestSlip));

    await waitFor(() => {
      expect(said()).toBe(ha.morePrinterPrintFailed);
    });
    // And emphatically not the developer's sentence.
    expect(said()).not.toMatch(/Cannot read properties/);
  });
});
