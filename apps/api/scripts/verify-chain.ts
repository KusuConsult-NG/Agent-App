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
import { chainSentence } from '@psirs/shared';

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
      console.log(
        `BROKEN at sequence ${page.brokenAtSequence}: ${chainSentence(page.verdict, {
          sequence: page.brokenAtSequence,
        })}`,
      );
      await closePool();
      process.exit(1);
    }
    checked += page.entriesChecked;
    if (page.entriesChecked < PAGE) break;
    from += PAGE;
  }
  /*
   * "End to end" of what is there, which is not the same as "nothing is
   * missing". Entries cut from the end of the log leave a shorter chain that
   * replays perfectly, so the line names where it stopped: that number, kept
   * from run to run, is what makes a shortened log visible.
   */
  console.log(
    `intact: ${checked} entries replayed, none altered or missing, up to sequence ${total?.max}`,
  );
  await closePool();
}

main().catch(async (error) => {
  console.error(error);
  await closePool();
  process.exit(1);
});
