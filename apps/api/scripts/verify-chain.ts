/**
 * Replay the entire audit chain and report.
 *
 * Paged, because `verifyAuditChain` defaults to 10,000 entries from sequence
 * 0. Calling it plainly against a large chain replays the oldest ten thousand
 * rows and answers "valid" without having looked at anything recent — a check
 * that reads as end-to-end and is not one.
 */
import { pool, closePool, queryOne } from '../src/db/pool';
import { verifyAuditChain } from '../src/services/audit';

const PAGE = 10_000;

async function main(): Promise<void> {
  const total = await queryOne<{ count: string; max: string }>(
    pool,
    'SELECT count(*)::text AS count, COALESCE(max(sequence_no),0)::text AS max FROM audit_logs',
  );
  console.log(`chain holds ${total?.count} entries, highest sequence ${total?.max}`);

  let from = 0;
  let checked = 0;
  for (;;) {
    const page = await verifyAuditChain(pool, { fromSequence: from, limit: PAGE });
    if (!page.valid) {
      console.log(`BROKEN at sequence ${page.brokenAtSequence}: ${page.detail}`);
      await closePool();
      process.exit(1);
    }
    checked += page.entriesChecked;
    if (page.entriesChecked < PAGE) break;
    from += PAGE;
  }
  console.log(`valid: ${checked} entries replayed end to end`);
  await closePool();
}

main().catch(async (error) => {
  console.error(error);
  await closePool();
  process.exit(1);
});
