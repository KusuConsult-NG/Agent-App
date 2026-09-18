-- ============================================================================
-- 081: the vehicle whose owner is on the register, and is never connected
--
-- A Nigerian mobile number has three ordinary spellings and they are the same
-- number: 08031234567, 2348031234567, +2348031234567. `phoneSchema` settles
-- every number this platform *writes through a form* on the last of those, so
-- `taxpayers.phone` is canonical.
--
-- `vehicles.owner_phone` is not written through that schema. It comes from the
-- vehicle authority's record, or from a free-text box an agent types the
-- owner's number into, and it was stored exactly as given. The connection
-- graph's second arm then joins the two columns with `=`:
--
--     JOIN taxpayers t ON t.phone = v.owner_phone AND t.status = 'ACTIVE'
--
-- Observed, four vehicles owned by one taxpayer stored as +2348031234567:
--
--     owner_phone      edge asserted
--     +2348031234567   yes
--     2348031234567    no
--     08031234567      no
--     0803 123 4567    no
--
-- rebuildVehicleConnections returned {fromPhone: 1, ambiguous: 0}. The three
-- misses are silent in both directions: no edge, and nothing in the ambiguous
-- count, which exists precisely so that "a number that never surfaces" is a
-- problem somebody knows they have.
--
-- 08031234567 is the form a Nigerian registry returns and the form a citizen
-- reads off their own handset, so the common case is the one that missed. The
-- consequence is not cosmetic: `liabilitiesFor` and `coverageLeads` read these
-- edges, so a vehicle whose owner PSIRS already holds on the register is an
-- asset the State cannot see when it assesses or pursues that person.
--
-- `upsertVehicle` now canonicalises on the way in (`canonicalPhoneOrRaw`),
-- which leaves a number that is not Nigerian at all exactly as given rather
-- than refusing a capture over an owner's dialling code. This brings the rows
-- already stored to the same form, so the join is an equality between two
-- columns that mean the same thing.
-- ============================================================================

UPDATE vehicles
   SET owner_phone = '+234' || right(regexp_replace(owner_phone, '[\s\-()]', '', 'g'), 10)
 WHERE owner_phone IS NOT NULL
   AND regexp_replace(owner_phone, '[\s\-()]', '', 'g') ~ '^(\+?234|0)[789][0-9]{9}$'
   AND owner_phone <> '+234' || right(regexp_replace(owner_phone, '[\s\-()]', '', 'g'), 10);

COMMENT ON COLUMN vehicles.owner_phone IS
  'The owner''s number as the authority or the agent gave it, canonicalised to +234XXXXXXXXXX where it parses as Nigerian and left as given where it does not. Matched against taxpayers.phone by the connection graph, so the two have to mean the same thing byte for byte.';

-- ---------------------------------------------------------------------------
-- And it stays that way.
--
-- The service canonicalises on write; this is the same rule where a column can
-- also be reached by a migration, a repair script or a path written later. It
-- refuses only the case it can decide: a value that parses as a Nigerian
-- number but is not in the form the join expects. Anything it cannot parse —
-- a foreign number, a landline, a partial number an agent half-typed — is left
-- alone, because refusing a vehicle capture over the owner's dialling code is
-- the worse outcome and the platform does not do it.
-- ---------------------------------------------------------------------------
ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_owner_phone_canonical
  CHECK (
    owner_phone IS NULL
    OR regexp_replace(owner_phone, '[\s\-()]', '', 'g') !~ '^(\+?234|0)[789][0-9]{9}$'
    OR owner_phone = '+234' || right(regexp_replace(owner_phone, '[\s\-()]', '', 'g'), 10)
  );
