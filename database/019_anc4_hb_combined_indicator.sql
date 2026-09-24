-- =============================================================================
-- Convert IND_ANC_4PLUS_PCT into combined "ANC 4+ with Hb testing" indicator
-- UI formula:
--   (((1a1 / (1a2 / 12)) + (1b1 / (1b2 / 12))) / 2) * 100
-- where:
--   1a1 = PW with 4+ ANC
--   1a2 = annual ELA (estimated PW)
--   1b1 = PW Hb tested 4+ times
--   1b2 = annual ELA (same as 1a2)
-- =============================================================================

BEGIN;

-- New / clarified data elements
INSERT INTO data_element (code, name, source_id, collection_level, variable, filter_text, period_type, unit)
SELECT v.code, v.name, s.id, v.collection_level, v.variable, v.filter_text, v.period_type, 'count'
FROM (VALUES
  ('E6', '1a1: Number of PW received 4 or more ANC check ups', 'ekavach', 'block', NULL, NULL, 'monthly'),
  ('E_ELA_PW', '1a2/1b2: Estimated number of pregnant women for period (ELA, annual)', 'dgfw', 'block', NULL, NULL, 'fy'),
  ('E_HB4_TEST', '1b1: Number of PW tested for Haemoglobin (Hb) 4 or more times', 'ekavach', 'block', NULL, NULL, 'monthly')
) AS v(code, name, source_code, collection_level, variable, filter_text, period_type)
JOIN source_system s ON s.code = v.source_code
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  source_id = EXCLUDED.source_id,
  collection_level = EXCLUDED.collection_level,
  period_type = EXCLUDED.period_type,
  updated_at = NOW();

-- Update indicator definition (keep code IND_ANC_4PLUS_PCT for stability)
UPDATE indicator SET
  name = 'PW received 4 or more ANC with Hb testing',
  formula_text = '(((1a1 / (1a2 / 12)) + (1b1 / (1b2 / 12))) / 2) * 100',
  primary_source_id = (SELECT id FROM source_system WHERE code = 'ekavach'),
  updated_at = NOW()
WHERE code = 'IND_ANC_4PLUS_PCT';

-- Replace components for this indicator
DELETE FROM indicator_component
WHERE indicator_id = (SELECT id FROM indicator WHERE code = 'IND_ANC_4PLUS_PCT');

INSERT INTO indicator_component (indicator_id, data_element_id, role, sort_order, expression_note)
SELECT i.id, d.id, c.role, c.sort_order, c.expression_note
FROM (VALUES
  ('IND_ANC_4PLUS_PCT', 'E6',         'numerator_part',   1, '1a1: PW with 4+ ANC'),
  ('IND_ANC_4PLUS_PCT', 'E_ELA_PW',   'denominator_part', 2, '1a2 & 1b2: annual ELA PW (divide by 12 for monthly)'),
  ('IND_ANC_4PLUS_PCT', 'E_HB4_TEST', 'numerator_part',   3, '1b1: PW Hb tested 4+ times')
) AS c(indicator_code, de_code, role, sort_order, expression_note)
JOIN indicator i ON i.code = c.indicator_code
JOIN data_element d ON d.code = c.de_code;

-- -----------------------------------------------------------------------------
-- Sample Agra facts + KPI (May-2026)
-- Achhnera block: 1a1=80, 1b1=70, ELA annual=1200 → monthly ELA=100 → 75%
-- District uses same numbers for demo (Achhnera as representative)
-- -----------------------------------------------------------------------------
DELETE FROM fact_component_value WHERE batch_id = 'SAMPLE_ANC4_HB_AGRA_2026_05';
DELETE FROM kpi_value
WHERE time_period_id = 6
  AND district_id = 1
  AND indicator_id = (SELECT id FROM indicator WHERE code = 'IND_ANC_4PLUS_PCT');

INSERT INTO fact_component_value
  (data_element_id, source_id, geo_level, division_id, district_id, block_id, time_period_id, value_num, batch_id)
SELECT d.id, d.source_id, 'block', 18, 1, 14, 6, v.value_num, 'SAMPLE_ANC4_HB_AGRA_2026_05'
FROM (VALUES
  ('E6', 80),
  ('E_HB4_TEST', 70),
  ('E_ELA_PW', 1200)
) AS v(de_code, value_num)
JOIN data_element d ON d.code = v.de_code;

-- District-level facts (same demo totals)
INSERT INTO fact_component_value
  (data_element_id, source_id, geo_level, division_id, district_id, block_id, time_period_id, value_num, batch_id)
SELECT d.id, d.source_id, 'district', 18, 1, NULL, 6, v.value_num, 'SAMPLE_ANC4_HB_AGRA_2026_05'
FROM (VALUES
  ('E6', 80),
  ('E_HB4_TEST', 70),
  ('E_ELA_PW', 1200)
) AS v(de_code, value_num)
JOIN data_element d ON d.code = v.de_code;

INSERT INTO kpi_value
  (indicator_id, geo_level, division_id, district_id, block_id, time_period_id, numerator, denominator, value)
SELECT i.id, v.geo_level, 18, 1, v.block_id, 6, v.numerator, v.denominator, v.value
FROM indicator i
CROSS JOIN (VALUES
  -- value = average of two ratios * 100; store num/den as sum of parts for transparency
  -- num proxy = 1a1+1b1 = 150, den proxy = 2*(ELA/12) = 200 → 75%
  ('block',    14::bigint, 150::numeric, 200::numeric, 75.00::numeric),
  ('district', NULL,       150::numeric, 200::numeric, 75.00::numeric)
) AS v(geo_level, block_id, numerator, denominator, value)
WHERE i.code = 'IND_ANC_4PLUS_PCT';

COMMIT;
