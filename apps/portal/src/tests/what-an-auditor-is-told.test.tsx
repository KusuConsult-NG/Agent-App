/**
 * The one control government has for checking the log itself.
 *
 * PRD §7.7 exposes chain verification to auditors precisely so integrity is
 * something they can establish rather than take on trust. The heading over
 * the answer was already translated — "An taba rajistar bincike" — and the
 * sentence underneath it, the one that says what was actually done to the
 * log, arrived as the API's English and was rendered exactly as it came.
 *
 * That sentence is the entire answer. "The audit trail has been tampered
 * with" is not something an auditor can act on; which of the three breaks it
 * is decides what they do next:
 *
 *   - the head of the log was cut off, so entries that existed are gone;
 *   - an entry is missing from the middle, or was inserted out of order;
 *   - a row's content was edited after it was written.
 *
 * These render the real screen off real answers and check that each of the
 * four reaches the reader in the language the heading above it is in.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { CHAIN_TEXT, CHAIN_VERDICTS, chainSentence, translations } from '@psirs/shared';
import { AuditScreen } from '../screens/Oversight';
import { api } from '../lib/api';
import { setPortalLanguage } from '../lib/i18n';

const ha = translations.ha;
const en = translations.en;

/**
 * The screen loads its entry list on mount and verifies on demand. Only the
 * verify call matters here; everything else answers with an empty list so the
 * screen renders rather than failing for an unrelated reason.
 */
function answering(verify: unknown) {
  vi.spyOn(api, 'get').mockImplementation((path: string) => {
    if (path.includes('/audit/verify')) return Promise.resolve(verify as never);
    // The job panel shares this screen and reads an object, not a list.
    if (path.includes('/government/workers'))
      return Promise.resolve({ jobs: [], healthy: true, needingAttention: 0 } as never);
    return Promise.resolve([] as never);
  });
}

/**
 * Render, and wait until nothing is still in flight.
 *
 * `AuditScreen` fires several requests on mount. A test that asserts on one
 * of them and returns leaves the others settling, and their `.then(setState)`
 * reaches an unmounted tree — React schedules the work, and if the file's
 * environment has gone by then the scheduler wakes to `ReferenceError: window
 * is not defined`. It fails no assertion, is reported against whichever file
 * happened to be running, and makes `vitest run` exit 1 about one run in six.
 *
 * `BackgroundWorkPanel` renders a spinner until its own fetch resolves, so
 * its title appearing is proof that the slowest of them has landed.
 */
async function renderSettled(lang: typeof ha | typeof en = ha) {
  render(<AuditScreen />);
  await screen.findByText(lang.ofcOvUnattendedWork);
}

async function pressVerify() {
  const button = await screen.findByRole('button', { name: ha.ofcOvVerifyChain });
  fireEvent.click(button);
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  setPortalLanguage('ha');
});

afterEach(async () => {
  cleanup();
  setPortalLanguage('en');
});

describe('what an auditor is told about the chain', () => {
  it('names a row edited after it was written, in Hausa, with its entry number', async () => {
    answering({
      valid: false,
      entriesChecked: 4120,
      brokenAtSequence: 8891,
      verdict: 'CONTENT_MODIFIED',
      message: 'Audit chain broken at entry 8891: the entry’s content does not match.',
    });

    await renderSettled();
    await pressVerify();

    const expected = ha.ofcOvChainContentModified.replace('{{sequence}}', '8891');
    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
    // And not the sentence the server composed.
    expect(screen.queryByText(/does not match\./)).toBeNull();
  });

  /*
   * The break the replay cannot see on its own. Cut entries 1..N off the front
   * and the remainder links to itself perfectly, so this is checked separately
   * in the service — and it is a different event from a gap in the middle,
   * which is why it gets its own sentence rather than sharing one.
   */
  it('distinguishes a log whose beginning was removed from a gap in the middle', async () => {
    answering({
      valid: false,
      entriesChecked: 0,
      brokenAtSequence: 41,
      verdict: 'GENESIS_REMOVED',
      message: 'Audit chain broken at entry 41.',
    });

    await renderSettled();
    await pressVerify();

    const removed = ha.ofcOvChainGenesisRemoved.replace('{{sequence}}', '41');
    await waitFor(() => expect(screen.getByText(removed)).toBeTruthy());
    expect(screen.queryByText(ha.ofcOvChainLinkMismatch.replace('{{sequence}}', '41'))).toBeNull();
  });

  it('reports a clean replay with the number of entries it covered', async () => {
    answering({
      valid: true,
      entriesChecked: 12045,
      verdict: 'INTACT',
      message: 'Audit chain verified over 12045 entries. No tampering detected.',
    });

    await renderSettled();
    await pressVerify();

    await waitFor(() =>
      expect(screen.getByText(ha.ofcOvChainIntact.replace('{{count}}', '12045'))).toBeTruthy(),
    );
    // The heading says intact, not tampered.
    expect(screen.getByText(ha.ofcOvIntact)).toBeTruthy();
  });

  /*
   * A verdict this build has never heard of, which is what a deployment looks
   * like while the API is ahead of the portal. An auditor told the log is
   * broken and given no reason at all is worse off than one given the reason
   * in the wrong language, so the server's sentence is the last resort.
   */
  it('keeps the server’s sentence for an outcome it does not know', async () => {
    answering({
      valid: false,
      entriesChecked: 9,
      brokenAtSequence: 3,
      verdict: 'SOMETHING_THE_PORTAL_HAS_NOT_MET',
      message: 'Audit chain broken at entry 3: a check added after this portal shipped.',
    });

    await renderSettled();
    await pressVerify();

    await waitFor(() =>
      expect(
        screen.getByText('Audit chain broken at entry 3: a check added after this portal shipped.'),
      ).toBeTruthy(),
    );
  });

  it('says it in English for an officer working in English', async () => {
    setPortalLanguage('en');
    answering({
      valid: false,
      entriesChecked: 100,
      brokenAtSequence: 77,
      verdict: 'LINK_MISMATCH',
      message: 'Audit chain broken at entry 77.',
    });

    await renderSettled(en);
    fireEvent.click(await screen.findByRole('button', { name: en.ofcOvVerifyChain }));

    await waitFor(() =>
      expect(
        screen.getByText(en.ofcOvChainLinkMismatch.replace('{{sequence}}', '77')),
      ).toBeTruthy(),
    );
  });
});

describe('every verdict can be said at all', () => {
  /*
   * The map is typed against the verdict union, so a fifth outcome without a
   * key fails the build. What the compiler cannot see is an entry pointing at
   * a key that was never added to the dictionary, or added to one language
   * and not the other — which renders `undefined` at the one place government
   * checks the log for itself.
   */
  it('has a sentence in both languages for all four', () => {
    expect(CHAIN_VERDICTS.length).toBe(4);
    for (const verdict of CHAIN_VERDICTS) {
      const key = CHAIN_TEXT[verdict];
      expect(key, `${verdict} has no dictionary key`).toBeTruthy();
      for (const lang of ['en', 'ha'] as const) {
        const text = (translations[lang] as unknown as Record<string, string>)[key];
        expect(typeof text, `${verdict} has no ${lang} string`).toBe('string');
        expect(text.trim().length, `${verdict} is empty in ${lang}`).toBeGreaterThan(0);
      }
    }
  });

  /*
   * Each break names its entry, and the clean answer names its count. A
   * sentence that dropped its number would still be a sentence, and would
   * still pass every render test above, while telling an auditor a row was
   * changed without saying which one.
   */
  it('fills in the number each verdict carries', () => {
    expect(chainSentence('INTACT', { count: 4120 })).toContain('4120');
    for (const verdict of ['GENESIS_REMOVED', 'LINK_MISMATCH', 'CONTENT_MODIFIED'] as const) {
      expect(chainSentence(verdict, { sequence: 8891 }), verdict).toContain('8891');
      expect(chainSentence(verdict, { sequence: 8891 }), verdict).not.toContain('{{');
    }
    expect(chainSentence('INTACT', { count: 0 })).not.toContain('{{');
  });

  /* The dictionary strings carry the same placeholders the sentences do. */
  it('leaves no placeholder unfilled on the screen’s own strings', () => {
    expect(en.ofcOvChainIntact).toContain('{{count}}');
    expect(ha.ofcOvChainIntact).toContain('{{count}}');
    for (const verdict of ['GENESIS_REMOVED', 'LINK_MISMATCH', 'CONTENT_MODIFIED'] as const) {
      const key = CHAIN_TEXT[verdict];
      expect((en as unknown as Record<string, string>)[key], verdict).toContain('{{sequence}}');
      expect((ha as unknown as Record<string, string>)[key], verdict).toContain('{{sequence}}');
    }
  });
});

/**
 * The job monitor above the chain check, on the same screen.
 *
 * `describeState` composed six sentences in `apps/api` and this column
 * printed them — while the column immediately beside it rendered the same
 * `state` as a translated badge. Everything the sentences are built from was
 * already here: the enum, the count of consecutive failures, and the error
 * from the last run, which this screen had been receiving without ever
 * declaring the field.
 */
describe('what the job monitor says about an unattended job', () => {
  function jobs(rows: unknown[]) {
    vi.spyOn(api, 'get').mockImplementation((path: string) => {
      if (path.includes('/government/workers'))
        return Promise.resolve({
          jobs: rows,
          healthy: false,
          needingAttention: rows.length,
        } as never);
      return Promise.resolve([] as never);
    });
  }

  const base = {
    name: 'reconcile-settlements',
    purpose: 'Reconcile settlements',
    intervalMs: 6 * 60 * 60_000,
    lastStartedAt: null,
    lastSucceededAt: null,
    lastDetail: null,
    lastError: null,
    consecutiveFailures: 0,
    runsTotal: 0,
    failuresTotal: 0,
    message: 'English from the API',
  };

  /*
   * The pair that must not be confused. A job that has not started means the
   * schedule may have stopped; a job that started and never returned means an
   * instance died holding it. Both read as "not working" and are looked into
   * differently.
   */
  /*
   * Two tests, not one with a `cleanup()` in the middle.
   *
   * Tearing the tree down mid-test unmounts `AuditScreen` while the other
   * requests it fires on mount are still in flight; their `.then(setState)`
   * then lands on a dead tree and React schedules work that can outlive the
   * file's environment entirely. That surfaced as an intermittent
   * `ReferenceError: window is not defined` attributed to whichever test file
   * happened to be running — never this one — and it failed no assertion
   * while making `vitest run` exit 1 about a quarter of the time.
   *
   * Letting the framework's own per-test cleanup do the teardown costs
   * nothing and removes the race.
   */
  it('says a job has not started when it should have', async () => {
    jobs([{ ...base, state: 'OVERDUE' }]);
    await renderSettled();
    await waitFor(() => expect(screen.getByText(ha.ofcOvJobOverdue)).toBeTruthy());
    expect(screen.queryByText(ha.ofcOvJobStalled)).toBeNull();
    expect(screen.queryByText('English from the API')).toBeNull();
  });

  /*
   * The other half of the pair. A job that has not started means the schedule
   * may have stopped; one that started and never returned means an instance
   * died holding it. Both read as "not working" and are looked into
   * differently.
   */
  it('says a job started and never came back', async () => {
    jobs([{ ...base, state: 'STALLED' }]);
    await renderSettled();
    await waitFor(() => expect(screen.getByText(ha.ofcOvJobStalled)).toBeTruthy());
    expect(screen.queryByText(ha.ofcOvJobOverdue)).toBeNull();
  });

  it('counts the failures in a row and names the last reason', async () => {
    jobs([
      {
        ...base,
        state: 'FAILING',
        consecutiveFailures: 3,
        lastError: 'connection refused',
      },
    ]);
    await renderSettled();

    const expected = ha.ofcOvJobFailing
      .replace('{{count}}', '3')
      .replace('{{error}}', 'connection refused');
    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
  });

  /* A failing job with nothing recorded still has to say so, not show a blank. */
  it('says so when a failure recorded no reason', async () => {
    jobs([{ ...base, state: 'FAILING', consecutiveFailures: 1, lastError: null }]);
    await renderSettled();

    const expected = ha.ofcOvJobFailing
      .replace('{{count}}', '1')
      .replace('{{error}}', ha.ofcOvJobNoReason);
    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
  });

  it('says how often a job runs in the reader’s language too', async () => {
    jobs([{ ...base, state: 'HEALTHY', intervalMs: 30_000 }]);
    await renderSettled();
    await waitFor(() =>
      expect(screen.getByText(ha.ofcOvEverySeconds.replace('{{n}}', '30'))).toBeTruthy(),
    );
  });

  it('has both languages for all six states', () => {
    const keys = [
      'ofcOvJobHealthy',
      'ofcOvJobRunning',
      'ofcOvJobOverdue',
      'ofcOvJobStalled',
      'ofcOvJobFailing',
      'ofcOvJobNeverRun',
    ] as const;
    for (const key of keys) {
      const e = (en as unknown as Record<string, string>)[key];
      const h = (ha as unknown as Record<string, string>)[key];
      expect(typeof h, `${key} missing in ha`).toBe('string');
      expect(e, `${key} identical in both languages`).not.toBe(h);
    }
    expect(en.ofcOvJobFailing).toContain('{{count}}');
    expect(ha.ofcOvJobFailing).toContain('{{error}}');
  });
});

/**
 * The five questions an auditor is offered, which were labelled with their
 * own dictionary keys.
 *
 * `AuditQuery.label` was typed `string`, every entry held a key, and the
 * button drew `{query.label}` straight out. So the card read
 *
 *     ofcOvReversedAfterPayment   ofcOvAllRateChanges   ofcOvOneAgentCollected
 *
 * in English and in Hausa alike, because a key is the same identifier in
 * both. The heading over the answer was the same value, so an auditor who
 * pressed one and got a table had no sentence saying what the table was.
 *
 * Nothing caught it, and the reasons are worth writing down: a key is not
 * English prose, so the English-literal lint passes it; the keys do exist in
 * the dictionary, so the Hausa coverage guard counts them translated; and no
 * test had rendered this card at all. The sibling field `prompt` was already
 * typed `keyof TranslationDictionary` and already drawn through `t[...]` —
 * the pattern was there and was applied to one of the two fields.
 */
describe('the standard audit questions are written in words', () => {
  function quiet() {
    vi.spyOn(api, 'get').mockImplementation((path: string) => {
      if (path.includes('/government/workers'))
        return Promise.resolve({ jobs: [], healthy: true, needingAttention: 0 } as never);
      return Promise.resolve([] as never);
    });
  }

  const KEYS = [
    'ofcOvReversedAfterPayment',
    'ofcOvAllRateChanges',
    'ofcOvOneAgentCollected',
    'ofcOvReceiptsOneItem',
    'ofcOvWhoLookedAtRecord',
  ] as const;

  it('offers them in English as sentences, not identifiers', async () => {
    quiet();
    setPortalLanguage('en');
    await renderSettled(en);

    for (const key of KEYS) {
      expect(
        screen.getByRole('button', { name: en[key] }),
        `the button for ${key} should carry its words`,
      ).toBeTruthy();
      expect(screen.queryByRole('button', { name: key })).toBeNull();
    }
  });

  it('offers them in Hausa too, which a key could never be', async () => {
    /*
     * The half that proves the bug was not merely cosmetic in one language.
     * A raw key reads identically whichever language the officer chose, so
     * Hausa was as broken as English and neither guard could see it.
     */
    quiet();
    setPortalLanguage('ha');
    await renderSettled(ha);

    for (const key of KEYS) {
      expect(screen.getByRole('button', { name: ha[key] })).toBeTruthy();
    }
  });

  /*
   * The third place the same value is drawn, and the one that survived.
   *
   * Typing `label` as `keyof TranslationDictionary` stops a SENTENCE being put
   * in the field — that is a compile error now. It does nothing about the key
   * being rendered raw, because a string-literal union is a perfectly good
   * ReactNode. This site passed the typecheck before and after the type
   * changed, and only rendering the screen finds it.
   */
  it('heads the question that asks for a parameter with words too', async () => {
    quiet();
    setPortalLanguage('en');
    await renderSettled(en);

    // This one needs an agent chosen, so pressing it opens the parameter card.
    fireEvent.click(screen.getByRole('button', { name: en.ofcOvOneAgentCollected }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: en.ofcOvOneAgentCollected })).toBeTruthy(),
    );
    expect(screen.queryByRole('heading', { name: 'ofcOvOneAgentCollected' })).toBeNull();
  });

  it('heads the answer with the question, not its key', async () => {
    quiet();
    setPortalLanguage('en');
    await renderSettled(en);

    // A question with no parameter runs as soon as it is pressed.
    fireEvent.click(screen.getByRole('button', { name: en.ofcOvAllRateChanges }));

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: en.ofcOvAllRateChanges }),
      ).toBeTruthy(),
    );
  });
});

/**
 * And the agents the picker cannot offer.
 *
 * "What did one agent collect" is answered by choosing the agent from a
 * select, which is filled from `/agents?limit=200`. That endpoint clamps to
 * 200 and orders by `created_at DESC`, so the list holds the 200 most
 * recently registered — and an agent who joined before them cannot be chosen
 * at all.
 *
 * For an audit that is the wrong 200 to keep. The subject of an investigation
 * is more often a long-serving agent than last month's intake, and the screen
 * said nothing: the select simply did not contain them, which reads as the
 * agent not existing rather than as a list that stops.
 */
describe('the agent picker says when it is not every agent', () => {
  const agent = (index: number) => ({
    id: `agent-${index}`,
    full_name: `Agent Number ${index}`,
    agent_code: `PL-${String(index).padStart(4, '0')}`,
  });

  function withAgents(count: number) {
    vi.spyOn(api, 'get').mockImplementation((path: string) => {
      if (path.startsWith('/agents')) {
        return Promise.resolve(
          Array.from({ length: count }, (_unused, index) => agent(index)) as never,
        );
      }
      if (path.includes('/government/workers'))
        return Promise.resolve({ jobs: [], healthy: true, needingAttention: 0 } as never);
      return Promise.resolve([] as never);
    });
  }

  /*
   * Open the one standard question that needs an agent chosen.
   *
   * In English, because this file's `beforeEach` puts the screen in Hausa and
   * the sentence being asserted below is the English one. Through
   * `renderSettled` rather than a bare render, for the reason its own comment
   * gives: the screen fires several requests on mount and a test that returns
   * while they are still settling fails a different file about one run in six.
   */
  async function openTheAgentQuestion() {
    setPortalLanguage('en');
    await renderSettled(en);
    fireEvent.click(await screen.findByRole('button', { name: en.ofcOvOneAgentCollected }));
    await waitFor(() => expect(screen.getByLabelText(en.ofcOvWhichAgent)).toBeTruthy());
  }

  it('says so when the list comes back at its ceiling', async () => {
    withAgents(200);
    await openTheAgentQuestion();

    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Agent Number 0/ })).toBeTruthy(),
    );
    expect(
      screen.getByText(/most recently registered agents/i),
      'a select that stops at 200 reads as PSIRS having 200 agents',
    ).toBeTruthy();
  });

  it('says nothing when every agent fits', async () => {
    // The control: a notice on a complete list would be a false warning, and
    // an auditor who learns to ignore it will ignore the true one.
    withAgents(12);
    await openTheAgentQuestion();

    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Agent Number 0/ })).toBeTruthy(),
    );
    expect(screen.queryByText(/most recently registered agents/i)).toBeNull();
  });

  it('asks for the same number the notice reasons about', async () => {
    withAgents(200);
    const spy = vi.spyOn(api, 'get');
    await openTheAgentQuestion();

    await waitFor(() => {
      const asked = spy.mock.calls.map(([path]) => String(path)).find((p) => p.startsWith('/agents'));
      expect(asked).toBe('/agents?limit=200');
    });
  });
});
