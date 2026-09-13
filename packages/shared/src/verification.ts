/**
 * What the platform tells somebody about a document they are holding.
 *
 * This is the shortest and most consequential exchange the platform has with
 * a member of the public: they type a number off a piece of paper and are
 * told whether the State has their money. Eleven answers, and the
 * differences between them are the whole point — a genuine receipt and a
 * genuine *acknowledgement* look alike on paper and mean opposite things
 * about whether the government has been paid.
 *
 * They were composed in `apps/api` as English sentences and rendered as they
 * arrived, on two screens that both offer Hausa: the agent's verify screen,
 * where an agent reads the answer out to the person in front of them, and
 * the public portal, where a citizen checks their own receipt.
 *
 * Codes, so the answer can be given in the language the reader chose. The
 * English stays here for anything that is not a browser — the verification
 * log, and any client that does not know a code.
 */

export const VERIFICATION_REASONS = [
  /** A receipt exists, and the stored document does not match its fingerprint. */
  'RECEIPT_FINGERPRINT_MISMATCH',
  /** Issued, then the payment behind it was reversed or refunded. */
  'RECEIPT_REVERSED',
  /** Voided. */
  'RECEIPT_VOIDED',
  /** A genuine receipt, fingerprint confirmed. */
  'RECEIPT_GENUINE',
  /** A genuine receipt whose stored copy could not be checked on this attempt. */
  'RECEIPT_GENUINE_UNCHECKED',
  /** Nothing on the register matches the number. */
  'NOT_FOUND',
  /** The payment was reversed and the money is going back. */
  'PAYMENT_REVERSED',
  /** Revoked for some other reason. */
  'DOCUMENT_REVOKED',
  'DOCUMENT_FINGERPRINT_MISMATCH',
  /** Genuine, and explicitly not a receipt: the money has not arrived yet. */
  'ACKNOWLEDGEMENT_NOT_RECEIPT',
  /** Carries `{{date}}`. */
  'DOCUMENT_EXPIRED',
  'DOCUMENT_GENUINE',
  'DOCUMENT_GENUINE_UNCHECKED',
] as const;

export type VerificationReason = (typeof VERIFICATION_REASONS)[number];

/**
 * The same eleven in English, for the places a code cannot go.
 *
 * `verification_attempts` records what was asked and what was answered, and
 * is read back long afterwards; and a client that does not know a code still
 * needs a sentence rather than an empty panel.
 */
export const VERIFICATION_SENTENCES: Record<VerificationReason, string> = {
  RECEIPT_FINGERPRINT_MISMATCH:
    'A receipt with this number exists, but the stored document does not match its original ' +
    'fingerprint. Treat the document you were given as unverified and report it to PSIRS.',
  RECEIPT_REVERSED:
    'This receipt was issued but the payment has since been reversed or refunded. It is no ' +
    'longer valid evidence of payment.',
  RECEIPT_VOIDED: 'This receipt has been voided and is not valid.',
  RECEIPT_GENUINE: 'This is a genuine government receipt issued by PSIRS.',
  RECEIPT_GENUINE_UNCHECKED:
    'This is a genuine government receipt issued by PSIRS. The stored copy could not be checked ' +
    'just now, so its fingerprint has not been confirmed on this attempt.',
  NOT_FOUND:
    'No government document matches that number or code. If you were given a receipt bearing ' +
    'this number, it was not issued by PSIRS.',
  PAYMENT_REVERSED:
    'This payment was reversed and the money is being returned to the payer, so no government ' +
    'receipt was issued for it. The document is no longer valid evidence of payment. If you ' +
    'have not received the money, contact PSIRS with this number.',
  DOCUMENT_REVOKED: 'This document has been revoked and is no longer valid.',
  DOCUMENT_FINGERPRINT_MISMATCH:
    'The stored document does not match its original fingerprint. Report this to PSIRS.',
  ACKNOWLEDGEMENT_NOT_RECEIPT:
    'This is a genuine PSIRS acknowledgement of payment, and it is NOT a government receipt. ' +
    'The payment system has confirmed the payment; the money has not yet reached the government ' +
    'account. A receipt is issued automatically once it does, and can be checked here in the ' +
    'same way.',
  DOCUMENT_EXPIRED: 'This document expired on {{date}}.',
  DOCUMENT_GENUINE: 'This is a genuine government document issued by PSIRS.',
  DOCUMENT_GENUINE_UNCHECKED:
    'This is a genuine government document issued by PSIRS. The stored copy could not be checked ' +
    'just now, so its fingerprint has not been confirmed on this attempt.',
};

/** The English for a verification answer, for the log rather than the screen. */
export function verificationSentence(code: VerificationReason, expiresAt?: string): string {
  const text = VERIFICATION_SENTENCES[code];
  return expiresAt ? text.replace('{{date}}', expiresAt.slice(0, 10)) : text;
}
