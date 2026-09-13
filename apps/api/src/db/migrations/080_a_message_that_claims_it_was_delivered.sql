-- ============================================================================
-- 080: the constraint migration 011 said it was adding
--
-- 011 exists because `dispatchQueued` marked every notification SENT with a
-- fabricated reference — `mock-<id>` — whether or not a provider had been
-- configured, let alone contacted. Nothing was delivered and the table said
-- otherwise. Its header states the remedy in one word:
--
--   "`provider` is what makes that UNREPRESENTABLE going forward: a row can
--    only claim SENT alongside the name of the service that accepted it."
--
-- It added `provider TEXT`. Nullable, no CHECK, no trigger. Nothing became
-- unrepresentable. Against the UAT database, with no service involved:
--
--   INSERT INTO notifications (recipient, event, channel, message, status,
--                              sent_at, provider_reference)
--   VALUES ('+2348000000000','RECEIPT_GENERATED','SMS','PSIRS: your receipt…',
--           'SENT', now(), 'looks-real-000999');
--   -- INSERT 0 1, provider NULL
--
-- A row claiming delivery, with a timestamp and a plausible gateway reference,
-- and no gateway. `PRD-TRACEABILITY.md` relays 011's promise to a government
-- as "`notifications.provider` NOT NULL for SENT" — a constraint no migration
-- ever wrote. Every other database control that table names is real; this was
-- the one that was not.
--
-- The property held in one function, and (in this repository's own phrase) a
-- rule the service enforces and the database does not is one UPDATE away from
-- being undone. This is the rule, written where it cannot be walked round.
--
-- What the constraint deliberately still allows:
--
--   QUEUED, provider NULL        nothing has been asked to deliver it yet
--   QUEUED, provider set         the provider was asked and could not be
--                                reached; the row stays QUEUED and is still
--                                owed, and it keeps the name of who was tried
--   FAILED, provider NULL        no provider owns that channel, or one threw
--                                before answering — there is nobody to name
--   FAILED, provider set         the provider answered and refused it
--
-- DELIVERED and READ are downstream of SENT: nothing writes them today, and
-- when something does, a message cannot have been read without having been
-- delivered by somebody.
--
-- No existing row violates it — psirs_uat, psirs_test and the four shard
-- databases all return 0 — which is 011's own cleanup still holding: it marked
-- the historical SENT-without-delivery rows FAILED and said why.
-- ============================================================================

ALTER TABLE notifications
  ADD CONSTRAINT notifications_provider_named_when_delivered
  CHECK (status NOT IN ('SENT', 'DELIVERED', 'READ') OR provider IS NOT NULL);

COMMENT ON CONSTRAINT notifications_provider_named_when_delivered ON notifications IS
  'A row may claim it was delivered only alongside the name of the service that accepted it. Migration 011 said it had made the alternative unrepresentable; it had added a nullable column. This is the constraint.';
