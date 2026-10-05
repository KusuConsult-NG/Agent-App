/**
 * When a session can still be used, rendered for SQL.
 *
 * A session ends in three ways and only one of them writes anything. Ending it
 * by hand, or blocking its machine, sets `revoked_at`. Going idle past
 * `expires_at` writes nothing at all. Passing `absolute_expires_at` is marked
 * revoked only if the session comes back and tries to refresh — `auth.ts`
 * does that on the way to refusing it — so one that never returns stays
 * unmarked for good.
 *
 * Signing in honours all three. The readers did not. Measured with one live
 * session, one idle past its expiry and one past its absolute lifetime, all
 * unrevoked: the officer's own "where am I signed in" list showed all three
 * with a green ACTIVE badge and an End button; the device card beside it
 * counted a live session on the absolute-expired one's machine and none on
 * the idle one's, which the list above it called active; and the
 * administrator's view of the officer's activity listed the absolute-expired
 * one as somewhere they were signed in.
 *
 * A screen for checking whether somebody else is in your account is the one
 * place a dead session must not read as a live one.
 *
 * Written against the alias `s`, like the other fragments in `lib/`, so a
 * caller that names `sessions` something else fails in Postgres rather than
 * matching the wrong table.
 */
export const LIVE_SESSION_SQL = `(s.revoked_at IS NULL
  AND s.expires_at > now()
  AND (s.absolute_expires_at IS NULL OR s.absolute_expires_at > now()))`;
