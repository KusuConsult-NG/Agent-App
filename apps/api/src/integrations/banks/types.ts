/**
 * Bank account verification contract (Addendum §16).
 *
 * This verifies an agent's **commission** account, and nothing else. Government
 * revenue never touches an agent's bank account (PRD §6, §16) — it settles to
 * the government account directly. What is at stake here is the agent's own
 * earnings, and the risk is that they reach the wrong person.
 *
 * Four outcomes, and the last is not about the account:
 *
 *   VERIFIED     the bank resolved the account and the name matches
 *   MISMATCH     the account exists, but is held by someone else
 *   NOT_FOUND    the bank holds no such account number
 *   UNAVAILABLE  the bank could not be asked — NOT a verdict
 *
 * MISMATCH and NOT_FOUND are corrections the agent can act on, and they block
 * clearance until fixed, which is right. UNAVAILABLE must not: an applicant
 * whose bank happened to be down would otherwise carry a permanent-looking
 * FAILED on their record, indistinguishable from one whose account belongs to
 * a different person.
 *
 * Note where the name comparison lives. The bank resolves the account and
 * returns the name it holds; deciding whether that is the same person is this
 * platform's judgement, not the vendor's, so it is `matchesAccountName` below —
 * one rule, one place, tested — rather than something each adapter reimplements.
 */

export type BankVerificationOutcome = 'VERIFIED' | 'MISMATCH' | 'NOT_FOUND' | 'UNAVAILABLE';

export interface BankVerificationRequest {
  bankCode: string;
  accountNumber: string;
  expectedName: string;
}

export interface BankVerificationResult {
  outcome: BankVerificationOutcome;
  /** The name the bank holds. Present on VERIFIED and MISMATCH. */
  accountName?: string;
  reference: string;
  /** Why it did not verify, or why the bank could not be asked. */
  failureReason?: string;
  provider: string;
}

export interface BankVerificationService {
  readonly name: string;
  /**
   * Resolve an account at the bank and decide whether it is the agent's.
   *
   * Implementations must never throw for an upstream failure: return
   * UNAVAILABLE, so the caller can tell "not this person's account" from
   * "we could not ask".
   */
  verify(request: BankVerificationRequest): Promise<BankVerificationResult>;
}

export function bankUnavailable(provider: string, reason: string): BankVerificationResult {
  return { outcome: 'UNAVAILABLE', reference: '', failureReason: reason, provider };
}

/**
 * Decide whether the name a bank returned is the same person as the name on the
 * application.
 *
 * This cannot be string equality. Nigerian banks routinely return names in a
 * different order from how the holder writes them ("MUSA DANLADI" for Danladi
 * Musa), with or without middle names, and with punctuation the applicant did
 * not type. Requiring an exact match would reject most legitimate agents.
 *
 * It also cannot be loose. This decides where an agent's commission is paid, so
 * the bias is towards rejection: a false reject sends one applicant to an
 * officer, a false accept sends government-derived money to a stranger.
 *
 * The rule: normalise both to bare uppercase letters, split into name parts,
 * and require that one set of parts is contained in the other — order does not
 * matter, an extra middle name does not matter — with at least two parts
 * matching. A single shared name is not a match, because half the state shares
 * a surname.
 *
 *   "Danladi Musa"        vs "MUSA DANLADI"          match (reordered)
 *   "Danladi Musa"        vs "MUSA DANLADI IBRAHIM"  match (extra middle name)
 *   "Danladi M. Musa"     vs "DANLADI MUSA"          match (initial expanded)
 *   "Danladi Musa"        vs "DANLADI OKAFOR"        no — one part in common
 *   "Musa"                vs "MUSA DANLADI"          no — one part in common
 *   "Danladi Musa"        vs "CHINEDU OKAFOR"        no
 */
export function matchesAccountName(expectedName: string, actualName: string): boolean {
  const expected = nameParts(expectedName);
  const actual = nameParts(actualName);
  if (expected.length === 0 || actual.length === 0) return false;

  const [shorter, longer] = expected.length <= actual.length ? [expected, actual] : [actual, expected];

  let matched = 0;
  const claimed = new Set<number>();

  for (const part of shorter) {
    const index = longer.findIndex((candidate, position) => {
      if (claimed.has(position)) return false;
      if (candidate === part) return true;
      // A single letter stands for a name beginning with it, so a middle
      // initial on one side and the full name on the other still match.
      if (part.length === 1) return candidate.startsWith(part);
      if (candidate.length === 1) return part.startsWith(candidate);
      return false;
    });

    if (index === -1) return false; // containment is required, not overlap
    claimed.add(index);
    matched += 1;
  }

  return matched >= 2;
}

function nameParts(name: string): string[] {
  return (
    name
      .toUpperCase()
      // An apostrophe is dropped rather than treated as a break: banks hold
      // "Ngo'ale" as NGOALE, and the applicant types the apostrophe.
      .replace(/'/g, '')
      // A hyphen separates. "Mary-Jane" is held by different banks as
      // "MARY-JANE" or "MARY JANE", and splitting matches both; only the
      // concatenated "MARYJANE" form is missed, which goes to an officer.
      .replace(/[^A-Z]+/g, ' ')
      .split(' ')
      .filter((part) => part.length > 0)
  );
}
