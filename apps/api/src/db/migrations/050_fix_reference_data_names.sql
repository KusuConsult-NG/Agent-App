-- Correct revenue item names, training module titles, and commission policy
-- name for databases seeded before the label cleanup.  The seed uses
-- ON CONFLICT DO NOTHING, so existing rows kept the old names.

BEGIN;

-- Revenue items: singular forms, consistent slash usage, drop redundant words.
UPDATE revenue_items SET name = 'Street Naming Registration Fees'
  WHERE code = 'STREET-NAMING'  AND name <> 'Street Naming Registration Fees';
UPDATE revenue_items SET name = 'Road Tax'
  WHERE code = 'ROAD-TAX'      AND name <> 'Road Tax';
UPDATE revenue_items SET name = 'Environmental/Ecological Fees'
  WHERE code = 'ECOLOGICAL-FEE' AND name <> 'Environmental/Ecological Fees';
UPDATE revenue_items SET name = 'Slaughter/Abattoir Fees'
  WHERE code = 'ABATTOIR-FEE'  AND name <> 'Slaughter/Abattoir Fees';
UPDATE revenue_items SET name = 'Motor Park Levy'
  WHERE code = 'MOTOR-PARK-LEVY' AND name <> 'Motor Park Levy';
UPDATE revenue_items SET name = 'Infrastructure Maintenance Levy'
  WHERE code = 'INFRA-LEVY'    AND name <> 'Infrastructure Maintenance Levy';
UPDATE revenue_items SET name = 'Market Tax and Levy'
  WHERE code = 'MARKET-LEVY'   AND name <> 'Market Tax and Levy';

-- Commission policy: title case.
UPDATE commission_policies SET name = 'Standard Grassroots Agent Incentive'
  WHERE code = 'STANDARD' AND name <> 'Standard Grassroots Agent Incentive';

-- Training modules: title case.
UPDATE training_modules SET title = 'Revenue Collection Process'  WHERE code = 'TRN-01';
UPDATE training_modules SET title = 'Taxpayer Registration'       WHERE code = 'TRN-02';
UPDATE training_modules SET title = 'TIN Process'                 WHERE code = 'TRN-03';
UPDATE training_modules SET title = 'Payment Process'             WHERE code = 'TRN-04';
UPDATE training_modules SET title = 'Receipt Verification'        WHERE code = 'TRN-05';
UPDATE training_modules SET title = 'Vehicle Renewal'             WHERE code = 'TRN-06';
UPDATE training_modules SET title = 'Agent Commission'            WHERE code = 'TRN-07';
UPDATE training_modules SET title = 'Fraud Prevention'            WHERE code = 'TRN-08';
UPDATE training_modules SET title = 'Data Protection'             WHERE code = 'TRN-09';
UPDATE training_modules SET title = 'Customer Service'            WHERE code = 'TRN-10';
UPDATE training_modules SET title = 'Government Ethics'           WHERE code = 'TRN-11';
UPDATE training_modules SET title = 'Escalation Procedures'       WHERE code = 'TRN-12';

COMMIT;
