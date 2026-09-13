-- =============================================================================
-- A citizen asking the platform what they have paid.
--
-- `/citizen-status` answers without a login, and the long comment in its route
-- explains the premise everything there is built on: it cannot tell the
-- taxpayer from anybody else who knows their phone number — a rival trader, a
-- lender, a former partner, a local official. Three fields were removed for
-- exactly that reason, and one of them was the date of the last payment,
-- because "a payment date describes their circumstances".
--
-- A full payment history is that judgement multiplied by a hundred: every levy
-- paid, when, and for how much, which together describe a person's trade, their
-- takings and their movements. It cannot go behind a phone number.
--
-- What is missing is not a stricter identifier but a different kind of proof.
-- A TIN and a phone number are both things a stranger can know; a code sent to
-- the number ON THE RECORD is something only somebody holding that handset can
-- read. The platform already has that machinery — hashed codes, expiry, an
-- attempt budget, delivery through the notification service — used for login,
-- step-up and referee verification. This adds the one purpose it lacked.
--
-- The code is sent to the number the record carries, never to a number in the
-- request. So a stranger who knows somebody's TIN succeeds only in sending
-- that person an SMS, and learns nothing at all.
-- =============================================================================

ALTER TABLE otp_codes DROP CONSTRAINT IF EXISTS otp_codes_purpose_check;

ALTER TABLE otp_codes
  ADD CONSTRAINT otp_codes_purpose_check
  CHECK (purpose IN (
    'LOGIN', 'REGISTRATION', 'STEP_UP', 'PASSWORD_RESET', 'REFEREE_VERIFY',
    'CITIZEN_STATEMENT'));
