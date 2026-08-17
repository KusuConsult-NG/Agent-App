/**
 * Cryptographic helpers.
 *
 * Anything secret that the platform only ever needs to *compare* — refresh
 * tokens, OTPs, referee invitation tokens, national identity numbers — is
 * stored as a hash, so a database disclosure does not hand over reusable
 * credentials or citizens' identity numbers (PRD §54, §62; Addendum §33, §37).
 */

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256Buffer(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Keyed hash for identity numbers (NIN, BVN, ...).
 *
 * HMAC rather than a bare digest: identity numbers have a small, enumerable
 * key space, so an unkeyed hash would be trivially reversible by brute force.
 * The key lives outside the database.
 */
export function hashIdentityNumber(identityNumber: string): string {
  const normalised = identityNumber.replace(/\s+/g, '').toUpperCase();
  return createHmac('sha256', config.identityHashSecret).update(normalised).digest('hex');
}

/** Display form that confirms which document is on file without revealing it. */
export function maskIdentityNumber(identityNumber: string): string {
  const normalised = identityNumber.replace(/\s+/g, '');
  if (normalised.length <= 4) return '*'.repeat(normalised.length);
  return `${'*'.repeat(normalised.length - 4)}${normalised.slice(-4)}`;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, config.auth.bcryptRounds);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Numeric OTP generated with a CSPRNG — never Math.random. */
export function generateOtp(length = config.auth.otpLength): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += randomInt(0, 10).toString();
  }
  return code;
}

/** Constant-time comparison, for OTPs, signatures and verification codes. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Verify a payment gateway webhook signature (PRD §53, §54).
 *
 * The signature covers the raw request body exactly as received: re-serialising
 * parsed JSON would change byte order and break verification, and would also
 * let an attacker smuggle differences between the signed and parsed payloads.
 */
export function verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
  const expected = createHmac('sha512', config.payments.webhookSecret)
    .update(rawBody)
    .digest('hex');
  return safeEqual(expected, signature);
}

export function signWebhookPayload(rawBody: Buffer | string): string {
  return createHmac('sha512', config.payments.webhookSecret).update(rawBody).digest('hex');
}

/**
 * Short, human-transcribable verification code for receipts and documents.
 *
 * Excludes characters that are misread when a code is copied off a printed
 * receipt or read aloud over the phone: 0/O, 1/I/L, 5/S, 8/B.
 */
const CODE_ALPHABET = '234679ACDEFGHJKMNPQRTUVWXYZ';

export function generateVerificationCode(length = 10): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export function normaliseVerificationCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}
