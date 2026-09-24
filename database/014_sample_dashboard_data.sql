-- Sample import for dashboard (Agra / Achhnera / 2026-05)
-- Institutional delivery 60% + ANC 1st trimester 80%

DELETE FROM kpi_value WHERE time_period_id = 6 AND (district_id = 1 OR (division_id = 18 AND district_id IS NULL));
DELETE FROM fact_component_value WHERE batch_id = 'SAMPLE_AGRA_ACHHNERA_2026_05';

INSERT INTO fact_component_value
  (data_element_id, source_id, geo_level, division_id, district_id, block_id, time_period_id, value_num, batch_id)
VALUES
  (21, 4, 'block', 18, 1, 14, 6, 120, 'SAMPLE_AGRA_ACHHNERA_2026_05'),
  (9,  1, 'block', 18, 1, 14, 6,  30, 'SAMPLE_AGRA_ACHHNERA_2026_05'),
  (24, 5, 'block', 18, 1, 14, 6, 250, 'SAMPLE_AGRA_ACHHNERA_2026_05'),
  (18, 3, 'block', 18, 1, 14, 6,  80, 'SAMPLE_AGRA_ACHHNERA_2026_05'),
  (17, 3, 'block', 18, 1, 14, 6, 100, 'SAMPLE_AGRA_ACHHNERA_2026_05');

INSERT INTO kpi_value
  (indicator_id, geo_level, division_id, district_id, block_id, time_period_id, numerator, denominator, value)
VALUES
  (8, 'block',    18, 1, 14, 6, 150, 250, 60.00),
  (6, 'block',    18, 1, 14, 6,  80, 100, 80.00),
  (8, 'district', 18, 1, NULL, 6, 150, 250, 60.00),
  (6, 'district', 18, 1, NULL, 6,  80, 100, 80.00),
  (8, 'division', 18, NULL, NULL, 6, 150, 250, 60.00),
  (6, 'division', 18, NULL, NULL, 6,  80, 100, 80.00);
