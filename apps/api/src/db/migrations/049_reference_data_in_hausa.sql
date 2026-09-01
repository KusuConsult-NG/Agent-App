-- Revenue categories, items, MDAs, programmes and territories carry names a
-- citizen or agent reads.  Until now these were English only; this adds a
-- Hausa column so both front ends can show the name in the viewer's language.
--
-- LGA and ward names are proper nouns and stay as-is.

ALTER TABLE revenue_authorities   ADD COLUMN IF NOT EXISTS name_ha TEXT;
ALTER TABLE revenue_categories    ADD COLUMN IF NOT EXISTS name_ha TEXT;
ALTER TABLE revenue_items         ADD COLUMN IF NOT EXISTS name_ha TEXT;
ALTER TABLE mdas                  ADD COLUMN IF NOT EXISTS name_ha TEXT;
ALTER TABLE incentive_programmes  ADD COLUMN IF NOT EXISTS name_ha TEXT;
ALTER TABLE territories           ADD COLUMN IF NOT EXISTS name_ha TEXT;
