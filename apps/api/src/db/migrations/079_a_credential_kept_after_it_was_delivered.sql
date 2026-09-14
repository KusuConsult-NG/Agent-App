-- ============================================================================
-- 079: the plaintext credential the notification queue kept
--
-- `otp_codes` stores only sha256(code). `referee_invitations` stores only
-- sha256(token). Both are deliberate, and both are stated as such in the code
-- that writes them.
--
-- The SMS carrying that code, and the SMS carrying that link, were then
-- rendered in full into `notifications.message` — in the same database, beside
-- the hash, and nothing has ever deleted a notification. The hash was doing no
-- work: this join returns the credential in plaintext, matched to the row it
-- opens.
--
--   SELECT i.status
--     FROM notifications n
--     JOIN referee_invitations i
--       ON i.invitation_token_hash =
--          encode(digest(substring(n.message from 'referee/([A-Za-z0-9_-]+)'),
--                        'sha256'), 'hex')
--    WHERE n.event = 'REFEREE_INVITATION';
--
-- Run against the UAT database it resolved two invitations, one of them still
-- SENT and a fortnight from expiry. The same join through `otp_codes` on
-- `code_hash` resolves the one-time code.
--
-- The message has to exist in plaintext at some point — the gateway is handed
-- it — but it does not have to be kept. `secret_message` carries it from the
-- queue to the gateway and no further: the dispatcher reads it, sends it, and
-- clears it as the row reaches SENT or FAILED. `message` holds the same text
-- with the credential masked, so a support officer working the queue still
-- sees what was sent, to whom, in which language and whether it arrived.
-- ============================================================================

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS secret_message text;

COMMENT ON COLUMN notifications.secret_message IS
  'The deliverable body while it still holds a credential. Written only for events that carry one, read once by the dispatcher, and set to NULL as the row becomes SENT or FAILED. NULL is the resting state; `message` is the retained record and has the credential masked.';

-- ---------------------------------------------------------------------------
-- The history. Rows already queued carry the plaintext, and a column added
-- today does not reach them.
--
-- Masking here cannot un-send what was sent, and it does not reach a backup
-- taken before today: a snapshot from the last fortnight still holds live
-- referee tokens, which is why DISASTER-RECOVERY-PLAN.md now says to treat
-- pre-079 archives as credential-bearing. What it does do is stop the running
-- database being the easy copy.
--
-- Both patterns are anchored on text the template itself puts there, so a
-- reference code, a date or the "5" in "expires in 5 minutes" is left alone:
-- the OTP is the only run of four or more digits in its body, and the token is
-- the only path segment after /referee/.
-- ---------------------------------------------------------------------------
UPDATE notifications
   SET message = regexp_replace(message, '(referee/)[A-Za-z0-9_-]{16,}', '\1██████')
 WHERE event = 'REFEREE_INVITATION'
   AND message ~ 'referee/[A-Za-z0-9_-]{16,}';

UPDATE notifications
   SET message = regexp_replace(message, '[0-9]{4,8}', '██████')
 WHERE event = 'SECURITY_ALERT'
   AND message ~ '[0-9]{4,8}';

-- A row that has finished with the gateway must not still be holding one.
ALTER TABLE notifications
  ADD CONSTRAINT notifications_secret_cleared_when_terminal
  CHECK (secret_message IS NULL OR status = 'QUEUED');
