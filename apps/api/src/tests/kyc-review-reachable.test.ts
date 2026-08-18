/**
 * A document nobody can open is not evidence.
 *
 * The capture side of KYC document handling was built and the review side was
 * not. Documents were uploaded, checksummed, stored and access-logged, and the
 * three endpoints a reviewer needs had no caller anywhere in the portal:
 *
 *   GET  /agents/kyc/documents/:id/file      the only way to see one
 *   POST /agents/kyc/documents/:id/review    the decision
 *   GET  /agents/kyc/documents/:id/access    who has looked at it
 *
 * `activationBlockers` gates activation on seven things, and human review of a
 * submitted document is not among them — `kycCleared` is the identity
 * provider's automated verdict. So `governmentApproved`, the one genuinely
 * human gate in the clearance pipeline, was being passed by an officer who
 * could not open the documents the applicant had submitted. The access log
 * that exists to answer "who has seen this citizen's papers" had nothing to
 * record, because nobody could read anything.
 *
 * This test holds the endpoints and the screen together. Storing a document
 * that no reviewer can reach is worse than not storing it: the platform keeps
 * a person's identity papers and gets nothing for it.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-jwt-secret-value-that-is-long-enough-32';
process.env.IDENTITY_HASH_SECRET ??= 'test-identity-secret-value-long-enough-32';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'test-webhook-secret-value-long-enough-32';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

function sourceUnder(...segments: string[]): string {
  const root = join(REPO_ROOT, ...segments);
  let out = '';
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry)) out += readFileSync(path, 'utf8');
    }
  };
  walk(root);
  return out;
}

/** The review endpoints, and what each is for. */
const REVIEW_ENDPOINTS = [
  { fragment: '/kyc/documents/', suffix: '/file', purpose: 'open a submitted document' },
  { fragment: '/kyc/documents/', suffix: '/review', purpose: 'accept or reject one' },
  { fragment: '/kyc/documents/', suffix: '/access', purpose: 'see who has looked at it' },
] as const;

describe('A reviewer can reach the documents they are approving against', () => {
  it('finds the endpoints in the API, so a passing run means something', () => {
    const routes = readFileSync(join(REPO_ROOT, 'apps', 'api', 'src', 'routes', 'agents.ts'), 'utf8');
    for (const { suffix } of REVIEW_ENDPOINTS) {
      assert.ok(
        routes.includes(`/kyc/documents/:id${suffix}`),
        `expected a /kyc/documents/:id${suffix} route in agents.ts`,
      );
    }
  });

  it('has a caller in the portal for each of them', () => {
    const portal = sourceUnder('apps', 'portal', 'src');

    for (const { fragment, suffix, purpose } of REVIEW_ENDPOINTS) {
      assert.ok(
        portal.includes(fragment) && portal.includes(`${suffix}\``),
        `nothing in the portal can ${purpose} — the platform stores a citizen's identity ` +
          `papers and no officer can reach them (expected a call ending ${suffix})`,
      );
    }
  });

  it('fetches the bytes with the reviewer’s token rather than as a bare image source', () => {
    // The file endpoint is authenticated, so `<img src="/api/.../file">` would
    // send no token and render a broken image. It also has to be revoked after
    // viewing rather than left in an object URL an idle tab keeps alive.
    const viewer = readFileSync(
      join(REPO_ROOT, 'apps', 'portal', 'src', 'screens', 'KycDocuments.tsx'),
      'utf8',
    );
    assert.match(viewer, /fetchFile\(/, 'the document is fetched with the reviewer’s credentials');
    assert.match(
      viewer,
      /revokeObjectURL/,
      'the object URL must be revoked — a citizen’s identity document should not outlive the viewer',
    );
  });

  it('lists the documents on the screen where the applicant is approved', () => {
    // The decision and the evidence belong on the same page. Putting the
    // documents anywhere else recreates the gap in a different shape.
    const detail = readFileSync(
      join(REPO_ROOT, 'apps', 'portal', 'src', 'screens', 'Agents.tsx'),
      'utf8',
    );
    assert.match(detail, /KycDocumentsCard/);
    assert.ok(
      detail.includes('/kyc/documents') || detail.includes('KycDocumentsCard'),
      'the agent detail screen must show the documents behind the approval',
    );
  });
});
