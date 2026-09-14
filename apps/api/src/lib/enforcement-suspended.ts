/**
 * When the State has agreed not to pursue an invoice, rendered for SQL.
 *
 * A trader who thinks a presumptive estimate is wrong may object, and while
 * the objection is open enforcement is suspended. That is a real promise: it
 * is what makes the objection window usable by somebody who cannot afford to
 * be wrong about whether they can afford the bill.
 *
 * A promise made once and honoured in one query is not a promise. The rule
 * was written out by hand in `arrearsWorklist`, where it worked, and nowhere
 * else — so the incentive arrears gate disqualified objectors, the compliance
 * score docked them, the citizen portal told them to go and pay, and the
 * reminder sweep sent them an SMS demanding it. Four readers of one rule,
 * three of them wrong, and each found separately.
 *
 * So it is written once here and imported. A fifth reader that forgets to ask
 * is still possible; a fifth reader that asks and gets a different answer is
 * not.
 *
 * WHAT THIS IS NOT FOR
 *
 * Reports of what the State is owed. Disputed money is still owed until
 * somebody decides the objection, and a receivables figure that quietly
 * excluded it would understate the State's own book. The line is whether the
 * query acts against the taxpayer or describes the ledger:
 * `taxpayer_compliance` carries both figures side by side for exactly that
 * reason.
 */

/**
 * True when the invoice aliased `i` is under an open objection.
 *
 * Written against the alias `i` because every caller already uses it for
 * `invoices`; a caller that does not must alias it or this will not compile
 * in Postgres, which is the failure mode to want — a silent match against the
 * wrong table is the one to avoid. No user input goes anywhere near this.
 */
export const UNDER_OPEN_OBJECTION_SQL = `EXISTS (
  SELECT 1
    FROM presumptive_assessments pa
    JOIN assessment_objections ao
      ON ao.presumptive_assessment_id = pa.id AND ao.status = 'OPEN'
   WHERE pa.assessment_id = i.assessment_id
)`;
