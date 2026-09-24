-- Sample HMIS facility facts + computed KPI values for Agra (May-2026)
-- Indicators: CHC-FRU C-section, HRP managed, Perinatal death, HBNC sick referral, UPKSK all services
-- Batch: SAMPLE_HMIS_AGRA_2026_05

BEGIN;

DELETE FROM kpi_value
WHERE time_period_id = 6
  AND district_id = 1
  AND indicator_id IN (1, 2, 10, 11, 12);

DELETE FROM fact_component_value
WHERE batch_id = 'SAMPLE_HMIS_AGRA_2026_05';

-- =============================================================================
-- Facility-level HMIS facts (Agra CHCs)
-- =============================================================================
INSERT INTO fact_component_value
  (data_element_id, source_id, geo_level, division_id, district_id, block_id, facility_id, time_period_id, value_num, batch_id)
VALUES
  -- CHC-FRU designation (DE_UPKSK_FRU_D = 11)
  (11, 1, 'facility', 18, 1, 14, 21110, 6, 1, 'SAMPLE_HMIS_AGRA_2026_05'),
  (11, 1, 'facility', 18, 1, 14, 21109, 6, 1, 'SAMPLE_HMIS_AGRA_2026_05'),
  (11, 1, 'facility', 18, 1, 16, 21111, 6, 1, 'SAMPLE_HMIS_AGRA_2026_05'),
  (11, 1, 'facility', 18, 1,  4, 21112, 6, 1, 'SAMPLE_HMIS_AGRA_2026_05'),
  (11, 1, 'facility', 18, 1,  4, 21113, 6, 1, 'SAMPLE_HMIS_AGRA_2026_05'),
  (11, 1, 'facility', 18, 1,  2, 21114, 6, 1, 'SAMPLE_HMIS_AGRA_2026_05'),

  -- C-section counts v65 (DE_V65_CSECTION = 10) — Achhnera & Bah >=10
  (10, 1, 'facility', 18, 1, 14, 21110, 6, 14, 'SAMPLE_HMIS_AGRA_2026_05'),
  (10, 1, 'facility', 18, 1, 14, 21109, 6,  3, 'SAMPLE_HMIS_AGRA_2026_05'),
  (10, 1, 'facility', 18, 1, 16, 21111, 6,  8, 'SAMPLE_HMIS_AGRA_2026_05'),
  (10, 1, 'facility', 18, 1,  4, 21112, 6, 12, 'SAMPLE_HMIS_AGRA_2026_05'),
  (10, 1, 'facility', 18, 1,  4, 21113, 6,  5, 'SAMPLE_HMIS_AGRA_2026_05'),
  (10, 1, 'facility', 18, 1,  2, 21114, 6,  2, 'SAMPLE_HMIS_AGRA_2026_05'),

  -- Extra institutional deliveries E9 (DE id 9)
  (9, 1, 'facility', 18, 1, 14, 21110, 6, 95, 'SAMPLE_HMIS_AGRA_2026_05'),
  (9, 1, 'facility', 18, 1, 14, 21109, 6, 40, 'SAMPLE_HMIS_AGRA_2026_05'),
  (9, 1, 'facility', 18, 1, 16, 21111, 6, 70, 'SAMPLE_HMIS_AGRA_2026_05'),
  (9, 1, 'facility', 18, 1,  4, 21112, 6, 88, 'SAMPLE_HMIS_AGRA_2026_05'),
  (9, 1, 'facility', 18, 1,  2, 21114, 6, 55, 'SAMPLE_HMIS_AGRA_2026_05'),
  (9, 1, 'facility', 18, 1,  3, 21115, 6, 48, 'SAMPLE_HMIS_AGRA_2026_05'),
  (9, 1, 'facility', 18, 1,  8, 21116, 6, 62, 'SAMPLE_HMIS_AGRA_2026_05'),

  -- HRP detected (den parts): v16=8, v24=7, v27=6, v35=5
  -- HRP managed (num parts): v17=4, v25=3, v28=2, v36=1
  -- Achhnera CHC 21110
  (8, 1, 'facility', 18, 1, 14, 21110, 6, 20, 'SAMPLE_HMIS_AGRA_2026_05'),
  (7, 1, 'facility', 18, 1, 14, 21110, 6, 15, 'SAMPLE_HMIS_AGRA_2026_05'),
  (6, 1, 'facility', 18, 1, 14, 21110, 6,  8, 'SAMPLE_HMIS_AGRA_2026_05'),
  (5, 1, 'facility', 18, 1, 14, 21110, 6,  5, 'SAMPLE_HMIS_AGRA_2026_05'),
  (4, 1, 'facility', 18, 1, 14, 21110, 6, 18, 'SAMPLE_HMIS_AGRA_2026_05'),
  (3, 1, 'facility', 18, 1, 14, 21110, 6, 12, 'SAMPLE_HMIS_AGRA_2026_05'),
  (2, 1, 'facility', 18, 1, 14, 21110, 6,  7, 'SAMPLE_HMIS_AGRA_2026_05'),
  (1, 1, 'facility', 18, 1, 14, 21110, 6,  4, 'SAMPLE_HMIS_AGRA_2026_05'),
  -- Akola CHC 21111
  (8, 1, 'facility', 18, 1, 16, 21111, 6, 12, 'SAMPLE_HMIS_AGRA_2026_05'),
  (7, 1, 'facility', 18, 1, 16, 21111, 6, 10, 'SAMPLE_HMIS_AGRA_2026_05'),
  (6, 1, 'facility', 18, 1, 16, 21111, 6,  4, 'SAMPLE_HMIS_AGRA_2026_05'),
  (5, 1, 'facility', 18, 1, 16, 21111, 6,  3, 'SAMPLE_HMIS_AGRA_2026_05'),
  (4, 1, 'facility', 18, 1, 16, 21111, 6, 10, 'SAMPLE_HMIS_AGRA_2026_05'),
  (3, 1, 'facility', 18, 1, 16, 21111, 6,  8, 'SAMPLE_HMIS_AGRA_2026_05'),
  (2, 1, 'facility', 18, 1, 16, 21111, 6,  3, 'SAMPLE_HMIS_AGRA_2026_05'),
  (1, 1, 'facility', 18, 1, 16, 21111, 6,  2, 'SAMPLE_HMIS_AGRA_2026_05'),
  -- Bah CHC 21112
  (8, 1, 'facility', 18, 1,  4, 21112, 6, 18, 'SAMPLE_HMIS_AGRA_2026_05'),
  (7, 1, 'facility', 18, 1,  4, 21112, 6, 14, 'SAMPLE_HMIS_AGRA_2026_05'),
  (6, 1, 'facility', 18, 1,  4, 21112, 6,  6, 'SAMPLE_HMIS_AGRA_2026_05'),
  (5, 1, 'facility', 18, 1,  4, 21112, 6,  4, 'SAMPLE_HMIS_AGRA_2026_05'),
  (4, 1, 'facility', 18, 1,  4, 21112, 6, 15, 'SAMPLE_HMIS_AGRA_2026_05'),
  (3, 1, 'facility', 18, 1,  4, 21112, 6, 11, 'SAMPLE_HMIS_AGRA_2026_05'),
  (2, 1, 'facility', 18, 1,  4, 21112, 6,  5, 'SAMPLE_HMIS_AGRA_2026_05'),
  (1, 1, 'facility', 18, 1,  4, 21112, 6,  3, 'SAMPLE_HMIS_AGRA_2026_05'),

  -- Perinatal: fresh SB v71=51, mac SB v72=52, NB death v455=53, LB male v68=54, LB female v69=55
  (51, 1, 'facility', 18, 1, 14, 21110, 6,  2, 'SAMPLE_HMIS_AGRA_2026_05'),
  (52, 1, 'facility', 18, 1, 14, 21110, 6,  1, 'SAMPLE_HMIS_AGRA_2026_05'),
  (53, 1, 'facility', 18, 1, 14, 21110, 6,  1, 'SAMPLE_HMIS_AGRA_2026_05'),
  (54, 1, 'facility', 18, 1, 14, 21110, 6, 70, 'SAMPLE_HMIS_AGRA_2026_05'),
  (55, 1, 'facility', 18, 1, 14, 21110, 6, 65, 'SAMPLE_HMIS_AGRA_2026_05'),
  (51, 1, 'facility', 18, 1, 16, 21111, 6,  1, 'SAMPLE_HMIS_AGRA_2026_05'),
  (52, 1, 'facility', 18, 1, 16, 21111, 6,  0, 'SAMPLE_HMIS_AGRA_2026_05'),
  (53, 1, 'facility', 18, 1, 16, 21111, 6,  1, 'SAMPLE_HMIS_AGRA_2026_05'),
  (54, 1, 'facility', 18, 1, 16, 21111, 6, 45, 'SAMPLE_HMIS_AGRA_2026_05'),
  (55, 1, 'facility', 18, 1, 16, 21111, 6, 40, 'SAMPLE_HMIS_AGRA_2026_05'),
  (51, 1, 'facility', 18, 1,  4, 21112, 6,  3, 'SAMPLE_HMIS_AGRA_2026_05'),
  (52, 1, 'facility', 18, 1,  4, 21112, 6,  1, 'SAMPLE_HMIS_AGRA_2026_05'),
  (53, 1, 'facility', 18, 1,  4, 21112, 6,  2, 'SAMPLE_HMIS_AGRA_2026_05'),
  (54, 1, 'facility', 18, 1,  4, 21112, 6, 80, 'SAMPLE_HMIS_AGRA_2026_05'),
  (55, 1, 'facility', 18, 1,  4, 21112, 6, 75, 'SAMPLE_HMIS_AGRA_2026_05'),

  -- HBNC: sick NB ref v63=62, HBNC visits v62=63
  (62, 1, 'facility', 18, 1, 14, 21110, 6,   8, 'SAMPLE_HMIS_AGRA_2026_05'),
  (63, 1, 'facility', 18, 1, 14, 21110, 6, 120, 'SAMPLE_HMIS_AGRA_2026_05'),
  (62, 1, 'facility', 18, 1, 16, 21111, 6,   5, 'SAMPLE_HMIS_AGRA_2026_05'),
  (63, 1, 'facility', 18, 1, 16, 21111, 6,  90, 'SAMPLE_HMIS_AGRA_2026_05'),
  (62, 1, 'facility', 18, 1,  4, 21112, 6,  10, 'SAMPLE_HMIS_AGRA_2026_05'),
  (63, 1, 'facility', 18, 1,  4, 21112, 6, 150, 'SAMPLE_HMIS_AGRA_2026_05'),
  (62, 1, 'facility', 18, 1,  2, 21114, 6,   4, 'SAMPLE_HMIS_AGRA_2026_05'),
  (63, 1, 'facility', 18, 1,  2, 21114, 6,  70, 'SAMPLE_HMIS_AGRA_2026_05'),

  -- UPKSK all services E89=92 / E90=93
  (92, 1, 'facility', 18, 1, 14, 21110, 6, 72, 'SAMPLE_HMIS_AGRA_2026_05'),
  (93, 1, 'facility', 18, 1, 14, 21110, 6, 90, 'SAMPLE_HMIS_AGRA_2026_05'),
  (92, 1, 'facility', 18, 1, 16, 21111, 6, 55, 'SAMPLE_HMIS_AGRA_2026_05'),
  (93, 1, 'facility', 18, 1, 16, 21111, 6, 80, 'SAMPLE_HMIS_AGRA_2026_05'),
  (92, 1, 'facility', 18, 1,  4, 21112, 6, 68, 'SAMPLE_HMIS_AGRA_2026_05'),
  (93, 1, 'facility', 18, 1,  4, 21112, 6, 85, 'SAMPLE_HMIS_AGRA_2026_05'),
  (92, 1, 'facility', 18, 1,  2, 21114, 6, 40, 'SAMPLE_HMIS_AGRA_2026_05'),
  (93, 1, 'facility', 18, 1,  2, 21114, 6, 70, 'SAMPLE_HMIS_AGRA_2026_05');

-- =============================================================================
-- Computed KPI values (district + block)
-- =============================================================================
INSERT INTO kpi_value
  (indicator_id, geo_level, division_id, district_id, block_id, time_period_id, numerator, denominator, value)
VALUES
  -- 1) % CHC-FRU with >=10 C-sections: 2 of 6 = 33.33 (district only)
  (2, 'district', 18, 1, NULL, 6, 2, 6, 33.33),

  -- 6) HRP managed %  (num 95 / den 119)
  (1, 'district', 18, 1, NULL, 6, 95, 119, ROUND(95.0/119*100, 2)),
  (1, 'block',    18, 1, 14,   6, 41,  48, ROUND(41.0/48*100, 2)),
  (1, 'block',    18, 1, 16,   6, 23,  29, ROUND(23.0/29*100, 2)),
  (1, 'block',    18, 1,  4,   6, 34,  42, ROUND(34.0/42*100, 2)),

  -- 10) Perinatal death % (12 / 375)
  (12, 'district', 18, 1, NULL, 6, 12, 375, ROUND(12.0/375*100, 2)),
  (12, 'block',    18, 1, 14,   6,  4, 135, ROUND(4.0/135*100, 2)),
  (12, 'block',    18, 1, 16,   6,  2,  85, ROUND(2.0/85*100, 2)),
  (12, 'block',    18, 1,  4,   6,  6, 155, ROUND(6.0/155*100, 2)),

  -- 14) HBNC sick referral % (27 / 430)
  (11, 'district', 18, 1, NULL, 6, 27, 430, ROUND(27.0/430*100, 2)),
  (11, 'block',    18, 1, 14,   6,  8, 120, ROUND(8.0/120*100, 2)),
  (11, 'block',    18, 1, 16,   6,  5,  90, ROUND(5.0/90*100, 2)),
  (11, 'block',    18, 1,  4,   6, 10, 150, ROUND(10.0/150*100, 2)),
  (11, 'block',    18, 1,  2,   6,  4,  70, ROUND(4.0/70*100, 2)),

  -- 26) UPKSK all services % (235 / 325)
  (10, 'district', 18, 1, NULL, 6, 235, 325, ROUND(235.0/325*100, 2)),
  (10, 'block',    18, 1, 14,   6,  72,  90, ROUND(72.0/90*100, 2)),
  (10, 'block',    18, 1, 16,   6,  55,  80, ROUND(55.0/80*100, 2)),
  (10, 'block',    18, 1,  4,   6,  68,  85, ROUND(68.0/85*100, 2)),
  (10, 'block',    18, 1,  2,   6,  40,  70, ROUND(40.0/70*100, 2));

COMMIT;
