-- =============================================================================
-- An enumeration captured where there is no signal.
--
-- The markets worth enumerating are the ones the network is worst in. Wase,
-- Kanam, Langtang North — the Councils whose traders are least likely to be on
-- the register are also the ones where a handset spends the afternoon with one
-- bar, and an agent who has to be online to write down a stall will simply not
-- write down the stalls that matter most. The coverage this whole programme is
-- for would then be measured exactly where coverage already exists.
--
-- So `BUSINESS_OBSERVATION` joins the draft types the queue can carry, and the
-- sync route computes the band when the capture arrives.
--
-- NAMED FOR WHAT IT HOLDS, NOT FOR THE ACTIVITY.
--
-- 'ENUMERATION' would have been the obvious word and is already taken: the
-- label dictionary is keyed by value, and ENUMERATION there is a group's part
-- in enumeration — "Enumeration only". A drafts list rendering that against a
-- queued capture would tell an agent their observation was a tax role.
--
-- WHY THE BAND IS NOT IN THE PAYLOAD.
--
-- It could be: the rule that turns premises, equipment and people into MICRO,
-- SMALL or MEDIUM is simple enough to run on a phone. It is not, because a
-- band computed on a handset is a band that can be computed differently on a
-- handset — an old build, a modified build, a build somebody sideloaded. The
-- facts are what the agent observed and the band is what PSIRS concludes from
-- them, and that division is the whole reason an agent paid commission can be
-- trusted to enumerate at all. The queue carries facts.
-- =============================================================================

ALTER TABLE offline_drafts DROP CONSTRAINT IF EXISTS offline_drafts_draft_type_check;

ALTER TABLE offline_drafts
  ADD CONSTRAINT offline_drafts_draft_type_check
  CHECK (draft_type IN (
    'TAXPAYER_REGISTRATION', 'SERVICE_REQUEST', 'VEHICLE_CAPTURE', 'DOCUMENT_CAPTURE',
    'BUSINESS_OBSERVATION'));
