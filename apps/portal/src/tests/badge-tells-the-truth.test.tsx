/**
 * A status badge that says the opposite of what happened.
 *
 * `Badge` classified with `String.includes`, and INACTIVE contains ACTIVE.
 * So four states were rendered in the colour of their own opposites:
 *
 *   INACTIVE      an MDA or revenue authority that has been switched off
 *   INVALID       what public verification answers for a doctored receipt
 *   UNPAID        an invoice nobody has paid
 *   UNVERIFIED    a vehicle the authority never confirmed
 *
 * The verification one is the reason this is not cosmetic. A citizen at a
 * checkpoint is shown the same green chip for a forged receipt as for a
 * genuine one, which is the platform asserting a payment happened when the
 * whole of PRD §95 is that it must not do that without confirmation.
 *
 * Matching whole underscore-separated words fixes it. This holds two things:
 * that the four now read correctly, and — the part that matters for the next
 * word somebody adds — that no value can reach the success colour through a
 * negation of a success word.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { statusSeverity, GOOD_STATUS_WORDS } from '@psirs/shared';
import { Badge } from '../ui';

describe('a badge in the colour of what happened', () => {
  it('does not read a negated word as the word inside it', () => {
    expect(statusSeverity('INACTIVE')).toBe('danger');
    expect(statusSeverity('INVALID')).toBe('danger');
    expect(statusSeverity('UNVERIFIED')).toBe('danger');
    // Outstanding, not failed: an invoice starts life unpaid.
    expect(statusSeverity('UNPAID')).toBe('pending');
  });

  it('still reads the words themselves as good news', () => {
    expect(statusSeverity('ACTIVE')).toBe('success');
    expect(statusSeverity('VALID')).toBe('success');
    expect(statusSeverity('PAID')).toBe('success');
    expect(statusSeverity('PAYMENT_VERIFIED')).toBe('success');
    expect(statusSeverity('CLEARED')).toBe('success');
  });

  it('warns about a document that does not match its own fingerprint', () => {
    expect(statusSeverity('TAMPERED')).toBe('danger');
  });

  /*
   * The property, not the four instances.
   *
   * Someone adding a word to the good list should not have to remember that
   * its negation exists somewhere in the schema. Every prefix here turns a
   * word into its opposite, and none of them may produce the success colour.
   */
  it('never colours a negation of a good word as success', () => {
    for (const word of GOOD_STATUS_WORDS) {
      for (const negated of [`UN${word}`, `IN${word}`, `NON_${word}`, `NOT_${word}`, `NO_${word}`]) {
        expect(statusSeverity(negated), `${negated} must not read as success`).not.toBe('success');
      }
    }
  });

  it('keeps the states this platform actually renders where they were', () => {
    // A representative sweep, so the word-matching rewrite is held to having
    // changed only what it set out to change.
    const unchanged: Record<string, string> = {
      PENDING: 'pending',
      PENDING_ATTESTATION: 'pending',
      READY_FOR_REVIEW: 'pending',
      REVIEWED: 'pending',
      OPENED: 'pending',
      RECONCILIATION_PENDING: 'pending',
      AWAITING_SCHEDULE: 'pending',
      FAILED: 'danger',
      REJECTED: 'danger',
      REVERSED: 'danger',
      SUSPENDED: 'danger',
      REVOKED: 'danger',
      EXPIRED: 'danger',
      DISPUTED: 'danger',
      SETTLED: 'success',
      RECEIPT_GENERATED: 'neutral',
      NOT_STARTED: 'neutral',
      NOT_APPLICABLE: 'neutral',
      AGENT_ACTIVATION: 'neutral',
      ONE_OFF: 'neutral',
    };

    for (const [status, kind] of Object.entries(unchanged)) {
      expect(statusSeverity(status), status).toBe(kind);
    }
  });

  it('says nothing rather than something wrong when there is no status', () => {
    expect(statusSeverity('')).toBe('neutral');
  });

  it('puts the colour on the chip the officer actually sees', () => {
    cleanup();
    render(
      <>
        <Badge status="INVALID" />
        <Badge status="VALID" />
      </>,
    );
    expect(screen.getByText('INVALID').className).toContain('badge--danger');
    expect(screen.getByText('VALID').className).toContain('badge--success');
  });
});
