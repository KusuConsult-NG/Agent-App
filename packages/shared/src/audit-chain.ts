/**
 * What an auditor is told when they check the log for themselves.
 *
 * PRD §7.7 exposes chain verification to government precisely so integrity is
 * something they can establish rather than take on trust. The button is on the
 * oversight screen, the officer portal offers Hausa, and the four answers were
 * English sentences composed in `apps/api` and rendered exactly as they
 * arrived.
 *
 * The distinctions matter more here than almost anywhere else in the platform,
 * because each names a different kind of interference:
 *
 *   - the head of the log was cut off, so entries that existed are gone;
 *   - an entry in the middle is missing, or was inserted out of order;
 *   - an entry's *content* was edited after the fact, and its own hash
 *     no longer matches what it holds.
 *
 * "The audit log has been tampered with" is not an answer an auditor can act
 * on. Which of the three it is decides what they do next, and it cannot be
 * read out of a language they do not have.
 *
 * Codes, so the answer reaches the reader in their own language. The English
 * below stays for the places a code cannot go.
 */

export const CHAIN_VERDICTS = [
  /** Replayed clean. Carries `{{count}}`. */
  'INTACT',
  /**
   * The oldest surviving entry names a predecessor that is not there.
   *
   * Deleting the head of the chain is the one tamper the replay cannot see on
   * its own — the remainder links to itself perfectly — which is why it is
   * checked separately and why it has its own answer. Carries `{{sequence}}`.
   */
  'GENESIS_REMOVED',
  /** An entry is missing or was inserted out of order. Carries `{{sequence}}`. */
  'LINK_MISMATCH',
  /** An entry's content no longer matches its recorded hash. Carries `{{sequence}}`. */
  'CONTENT_MODIFIED',
] as const;

export type ChainVerdict = (typeof CHAIN_VERDICTS)[number];

/**
 * The same four in English, for the places a code cannot go.
 *
 * A verification is itself an auditable act, and the sentence is what a
 * reader sees months later in the record of who checked and what they were
 * told. A client that does not know a code still needs a sentence rather than
 * an empty panel.
 */
export const CHAIN_SENTENCES: Record<ChainVerdict, string> = {
  INTACT:
    'Audit chain verified over {{count}} entries. No tampering detected.',
  GENESIS_REMOVED:
    'Audit chain broken at entry {{sequence}}: the oldest entry in the log names a ' +
    'predecessor that is not there, so the beginning of the chain has been removed.',
  LINK_MISMATCH:
    'Audit chain broken at entry {{sequence}}: an entry is missing or was inserted ' +
    'out of order.',
  CONTENT_MODIFIED:
    'Audit chain broken at entry {{sequence}}: the entry’s content does not match its ' +
    'recorded hash, so the row was modified after it was written.',
};

/**
 * The English sentence for a verdict, with its number filled in.
 *
 * `count` for `INTACT`, `sequence` for the three breaks. Both are accepted
 * for either, because a caller that has to remember which verdict takes which
 * number is a caller that will one day pass the wrong one.
 */
export function chainSentence(
  verdict: ChainVerdict,
  numbers: { count?: number; sequence?: number } = {},
): string {
  return CHAIN_SENTENCES[verdict]
    .replace('{{count}}', String(numbers.count ?? 0))
    .replace('{{sequence}}', String(numbers.sequence ?? 0));
}
