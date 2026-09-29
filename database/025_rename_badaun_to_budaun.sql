-- Canonical district spelling: Badaun → Budaun
-- Safe to re-run.

UPDATE district
SET name = 'Budaun'
WHERE lower(trim(name)) = 'badaun';

UPDATE indicator_outcome_district
SET district_name = 'Budaun', updated_at = NOW()
WHERE lower(trim(district_name)) = 'badaun';

UPDATE ranking_value
SET geo_name = 'Budaun'
WHERE lower(trim(geo_name)) = 'badaun';

UPDATE ranking_value
SET district_name = 'Budaun'
WHERE lower(trim(district_name)) = 'badaun';

-- Facility display names that reference the district (not place names like Badaunadeeh)
UPDATE facility
SET name = replace(name, 'Badaun', 'Budaun')
WHERE name LIKE '%Badaun%'
  AND name NOT LIKE '%Badaunadeeh%';

UPDATE facility_code_master
SET facility_name = replace(facility_name, 'Badaun', 'Budaun')
WHERE facility_name LIKE '%Badaun%'
  AND facility_name NOT LIKE '%Badaunadeeh%';
