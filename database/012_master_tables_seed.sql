-- =============================================================================
-- Seed: master tables (sources, DEs, indicators 1-9, periods, roles)
-- Run after 011_master_tables_schema.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Roles
-- -----------------------------------------------------------------------------
INSERT INTO role (code, name) VALUES
  ('state_admin', 'State Admin'),
  ('division_viewer', 'Division Viewer'),
  ('district_viewer', 'District Viewer'),
  ('district_uploader', 'District (DH) Uploader'),
  ('district_approver', 'District Approver'),
  ('block_viewer', 'Block Viewer'),
  ('block_uploader', 'Block Uploader'),
  ('facility_uploader', 'Facility Uploader')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

-- -----------------------------------------------------------------------------
-- 21 source systems
-- -----------------------------------------------------------------------------
INSERT INTO source_system
  (code, name, de_count, has_facility, has_block, has_district, remarks)
VALUES
  ('hmis', 'HMIS', 33, TRUE, FALSE, FALSE, NULL),
  ('uprsk', 'UPKSK', 6, TRUE, TRUE, FALSE, NULL),
  ('ekavach', 'e-kavach', 13, TRUE, TRUE, TRUE,
   '2 DE at district level; remaining 11 at facility level'),
  ('mantra', 'Mantra', 5, TRUE, TRUE, TRUE, NULL),
  ('dgfw', 'Estimates released by DGFW', 5, FALSE, TRUE, FALSE, NULL),
  ('crs', 'CRS', 1, FALSE, FALSE, TRUE, NULL),
  ('fbnc', 'FBNC', 4, FALSE, FALSE, TRUE, NULL),
  ('uwin', 'UWIN', 2, FALSE, TRUE, FALSE, NULL),
  ('ccpm', 'CCPM', 2, FALSE, TRUE, FALSE, NULL),
  ('bcpm', 'BCPM', 2, FALSE, TRUE, FALSE, NULL),
  ('aam', 'AAM Portal', 3, TRUE, FALSE, FALSE, NULL),
  ('esanjeevani', 'e-sanjeevani', 1, TRUE, FALSE, FALSE, NULL),
  ('dvdms', 'DVDMS', 3, TRUE, FALSE, FALSE, NULL),
  ('udsp', 'UDSP', 2, TRUE, TRUE, FALSE, NULL),
  ('nikshay', 'Nikshay', 6, FALSE, TRUE, FALSE, NULL),
  ('state_report', 'State report', 1, FALSE, TRUE, FALSE, NULL),
  ('hope', 'HOPE', 1, TRUE, FALSE, FALSE, NULL),
  ('fams', 'FAMS', 2, FALSE, FALSE, TRUE, NULL),
  ('pmjay', 'PMJAY portal', 3, FALSE, FALSE, TRUE, NULL),
  ('koshwani', 'Koshwani', 2, FALSE, FALSE, TRUE, NULL),
  ('his', 'HIS', 7, FALSE, FALSE, TRUE, NULL),
  ('manual_upload', 'Manual Upload Portal', 0, TRUE, TRUE, TRUE, 'Common DH/Block/Facility upload channel')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    de_count = EXCLUDED.de_count,
    has_facility = EXCLUDED.has_facility,
    has_block = EXCLUDED.has_block,
    has_district = EXCLUDED.has_district,
    remarks = EXCLUDED.remarks,
    updated_at = NOW();

-- -----------------------------------------------------------------------------
-- Time periods (sample)
-- -----------------------------------------------------------------------------
INSERT INTO time_period (period_type, label, start_date, end_date) VALUES
  ('monthly', '2025-06', '2025-06-01', '2025-06-30'),
  ('monthly', '2026-01', '2026-01-01', '2026-01-31'),
  ('monthly', '2026-02', '2026-02-01', '2026-02-28'),
  ('monthly', '2026-03', '2026-03-01', '2026-03-31'),
  ('monthly', '2026-04', '2026-04-01', '2026-04-30'),
  ('monthly', '2026-05', '2026-05-01', '2026-05-31'),
  ('fy', 'FY2026-27', '2026-04-01', '2027-03-31'),
  ('cumulative', '2026-01_to_2026-05', '2026-01-01', '2026-05-31')
ON CONFLICT (period_type, label) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Data elements used by indicators 1-9
-- -----------------------------------------------------------------------------
INSERT INTO data_element
  (code, name, source_id, collection_level, variable, filter_text, period_type, unit)
SELECT v.code, v.name, s.id, v.collection_level, v.variable, v.filter_text, v.period_type, v.unit
FROM (VALUES
  -- Indicator 1
  ('DE_V65_CSECTION', 'Total number of C-Section deliveries performed (3.1)', 'hmis', 'facility', 'v65', 'CHC', 'monthly', 'count'),
  ('DE_UPKSK_FRU_D', 'Facility Specialized Unit: FRU-D (designated CHC-FRU)', 'uprsk', 'facility', NULL, 'CHC', 'monthly', 'count'),
  -- Indicator 2
  ('E4', 'New Pregnant Women registered for ANC within 1st trimester', 'ekavach', 'block', NULL, NULL, 'monthly', 'count'),
  ('E5', 'New Pregnant Women registered for ANC', 'ekavach', 'block', NULL, NULL, 'monthly', 'count'),
  -- Indicator 3
  ('E6', 'Total Number of PW received 4 or more ANC services', 'ekavach', 'block', NULL, NULL, 'monthly', 'count'),
  ('E7', 'New Pregnant Women registered for ANC (4+ ANC denom)', 'ekavach', 'block', NULL, NULL, 'monthly', 'count'),
  -- Indicator 4
  ('E8', 'Institutional deliveries including C-section (Public - Mantra)', 'mantra', 'facility', NULL, 'Public', 'monthly', 'count'),
  ('E9', 'Institutional deliveries including C-section (Private - HMIS 2.2 / v54)', 'hmis', 'facility', 'v54', 'Private', 'monthly', 'count'),
  ('E10', 'Estimated delivery (DGFW)', 'dgfw', 'block', NULL, NULL, 'monthly', 'count'),
  -- Indicator 5
  ('DE_MANTRA_STAY48_FAC', 'Facilities where avg stay >= 48 hrs for normal delivery', 'mantra', 'facility', NULL, NULL, 'monthly', 'count'),
  ('DE_MANTRA_NORMAL_DEL_FAC', 'Facilities that conducted normal delivery during the month', 'mantra', 'facility', NULL, NULL, 'monthly', 'count'),
  -- Indicator 6 HRP identified parts
  ('DE_V16_HTN_DETECTED', 'New cases of PW with hypertension detected (1.3.1)', 'hmis', 'facility', 'v16', NULL, 'monthly', 'count'),
  ('DE_V24_HB_LE7', 'PW having Hb level<=7 g/dl (1.4.4)', 'hmis', 'facility', 'v24', NULL, 'monthly', 'count'),
  ('DE_V27_GDM_POS', 'PW tested positive for GDM (1.5.2)', 'hmis', 'facility', 'v27', NULL, 'monthly', 'count'),
  ('DE_V35_THYROID_POS', 'PW tested positive for Thyroid disorder (1.7.1)', 'hmis', 'facility', 'v35', NULL, 'monthly', 'count'),
  -- Indicator 6 HRP managed parts
  ('DE_V17_HTN_MANAGED', 'PW with hypertension managed at institution (1.3.2)', 'hmis', 'facility', 'v17', NULL, 'monthly', 'count'),
  ('DE_V25_ANAEMIA_TREATED', 'PW treated for severe anaemia Hb<=7 (1.4.5)', 'hmis', 'facility', 'v25', NULL, 'monthly', 'count'),
  ('DE_V28_GDM_MANAGED', 'GDM positive PW managed with Insulin/Metformin (1.5.3)', 'hmis', 'facility', 'v28', NULL, 'monthly', 'count'),
  ('DE_V36_THYROID_TREATED', 'PW treated for thyroid disorder (1.7.2)', 'hmis', 'facility', 'v36', NULL, 'monthly', 'count'),
  -- Indicator 7
  ('E22', 'U/VHND sessions conducted in the last month', 'ekavach', 'block', NULL, NULL, 'monthly', 'count'),
  ('E23', 'Estimated population (DGFW) for VHND planned base', 'dgfw', 'block', NULL, NULL, 'fy', 'count'),
  -- Indicator 8
  ('E24', 'Births registered (CRS)', 'crs', 'district', NULL, NULL, 'cumulative', 'count'),
  ('E25', 'Estimated live births (DGFW)', 'dgfw', 'block', NULL, NULL, 'fy', 'count'),
  -- Indicator 9
  ('E26', 'ANMs who logged into eKavach in last 30 days', 'ekavach', 'district', NULL, NULL, 'rolling_30d', 'count'),
  ('E27', 'Total number of active ANMs on eKavach', 'ekavach', 'district', NULL, NULL, 'rolling_30d', 'count')
) AS v(code, name, source_code, collection_level, variable, filter_text, period_type, unit)
JOIN source_system s ON s.code = v.source_code
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    source_id = EXCLUDED.source_id,
    collection_level = EXCLUDED.collection_level,
    variable = EXCLUDED.variable,
    filter_text = EXCLUDED.filter_text,
    period_type = EXCLUDED.period_type,
    unit = EXCLUDED.unit,
    updated_at = NOW();

-- -----------------------------------------------------------------------------
-- Indicators 1-9
-- -----------------------------------------------------------------------------
INSERT INTO indicator
  (sno, code, name, domain, indicator_type, ranking_level, formula_text, unit, is_negative, period_type, primary_source_id)
SELECT v.sno, v.code, v.name, v.domain, v.indicator_type, v.ranking_level, v.formula_text, v.unit, v.is_negative, v.period_type, s.id
FROM (VALUES
  (1, 'IND_CHC_FRU_CSECTION_PCT',
   '% of CHC-FRUs conducted >=10 C-section per month against designated CHC-FRUs',
   'delivery_care', 'quality', 'district',
   'CHC-FRUs with >=10 C-sections / designated CHC-FRUs * 100', 'percent', FALSE, 'monthly', 'hmis'),
  (2, 'IND_ANC_1ST_TRIMESTER_PCT',
   '% of PW registered for ANC within the first trimester against total PW registered for ANC',
   'ante_natal', 'coverage', 'both',
   'E4 / E5 * 100', 'percent', FALSE, 'monthly', 'ekavach'),
  (3, 'IND_ANC_4PLUS_PCT',
   '% of PW receiving 4 or more antenatal care check-ups against total PW registered for ANC',
   'ante_natal', 'coverage', 'both',
   'E6 / E7 * 100', 'percent', FALSE, 'monthly', 'ekavach'),
  (4, 'IND_INSTITUTIONAL_DELIVERY_PCT',
   'Percentage of pregnant women delivered in institution against estimated delivery',
   'delivery_care', 'coverage', 'both',
   '(E8 + E9) / E10 * 100', 'percent', FALSE, 'monthly', 'mantra'),
  (5, 'IND_NORMAL_DEL_STAY48_PCT',
   '% of facilities where average duration of stay is more than 48 hours for normal delivery',
   'delivery_care', 'quality', 'both',
   'facilities_stay_ge_48 / facilities_with_normal_delivery * 100', 'percent', FALSE, 'monthly', 'mantra'),
  (6, 'IND_HRP_MANAGED_PCT',
   '% of HRP managed against identified',
   'ante_natal', 'quality', 'both',
   '(v17+v25+v28+v36) / (v16+v24+v27+v35) * 100', 'percent', FALSE, 'monthly', 'hmis'),
  (7, 'IND_VHND_PCT',
   '% of U/VHND sessions conducted against planned in the last month',
   'ante_natal', 'coverage', 'both',
   'E22 / E23 * 100', 'percent', FALSE, 'monthly', 'ekavach'),
  (8, 'IND_BIRTH_REG_PCT',
   '% of births registered against estimated live births (cumulative)',
   'delivery_care', 'coverage', 'district',
   'E24 / E25 * 100', 'percent', FALSE, 'cumulative', 'crs'),
  (9, 'IND_ANM_LOGIN_PCT',
   '% of ANMs who logged into eKavach in the last 30 days, against total active ANMs',
   'data_quality', 'data_quality', 'district',
   'E26 / E27 * 100', 'percent', FALSE, 'rolling_30d', 'ekavach')
) AS v(sno, code, name, domain, indicator_type, ranking_level, formula_text, unit, is_negative, period_type, source_code)
JOIN source_system s ON s.code = v.source_code
ON CONFLICT (code) DO UPDATE
SET sno = EXCLUDED.sno,
    name = EXCLUDED.name,
    domain = EXCLUDED.domain,
    indicator_type = EXCLUDED.indicator_type,
    ranking_level = EXCLUDED.ranking_level,
    formula_text = EXCLUDED.formula_text,
    unit = EXCLUDED.unit,
    is_negative = EXCLUDED.is_negative,
    period_type = EXCLUDED.period_type,
    primary_source_id = EXCLUDED.primary_source_id,
    updated_at = NOW();

-- -----------------------------------------------------------------------------
-- Indicator display levels
-- ranking_level district => division + district
-- ranking_level both     => division + district + block
-- -----------------------------------------------------------------------------
INSERT INTO indicator_level (indicator_id, level)
SELECT i.id, lvl.level
FROM indicator i
JOIN (VALUES
  ('IND_CHC_FRU_CSECTION_PCT', 'division'),
  ('IND_CHC_FRU_CSECTION_PCT', 'district'),
  ('IND_ANC_1ST_TRIMESTER_PCT', 'division'),
  ('IND_ANC_1ST_TRIMESTER_PCT', 'district'),
  ('IND_ANC_1ST_TRIMESTER_PCT', 'block'),
  ('IND_ANC_4PLUS_PCT', 'division'),
  ('IND_ANC_4PLUS_PCT', 'district'),
  ('IND_ANC_4PLUS_PCT', 'block'),
  ('IND_INSTITUTIONAL_DELIVERY_PCT', 'division'),
  ('IND_INSTITUTIONAL_DELIVERY_PCT', 'district'),
  ('IND_INSTITUTIONAL_DELIVERY_PCT', 'block'),
  ('IND_NORMAL_DEL_STAY48_PCT', 'division'),
  ('IND_NORMAL_DEL_STAY48_PCT', 'district'),
  ('IND_NORMAL_DEL_STAY48_PCT', 'block'),
  ('IND_HRP_MANAGED_PCT', 'division'),
  ('IND_HRP_MANAGED_PCT', 'district'),
  ('IND_HRP_MANAGED_PCT', 'block'),
  ('IND_VHND_PCT', 'division'),
  ('IND_VHND_PCT', 'district'),
  ('IND_VHND_PCT', 'block'),
  ('IND_BIRTH_REG_PCT', 'division'),
  ('IND_BIRTH_REG_PCT', 'district'),
  ('IND_ANM_LOGIN_PCT', 'division'),
  ('IND_ANM_LOGIN_PCT', 'district')
) AS lvl(ind_code, level) ON lvl.ind_code = i.code
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Indicator components
-- -----------------------------------------------------------------------------
INSERT INTO indicator_component (indicator_id, data_element_id, role, sort_order, expression_note)
SELECT i.id, d.id, c.role, c.sort_order, c.expression_note
FROM (VALUES
  ('IND_CHC_FRU_CSECTION_PCT', 'DE_V65_CSECTION', 'numerator_part', 1, 'Count CHC-FRUs with >=10 C-sections from v65'),
  ('IND_CHC_FRU_CSECTION_PCT', 'DE_UPKSK_FRU_D', 'denominator', 2, 'Designated CHC-FRU count'),
  ('IND_ANC_1ST_TRIMESTER_PCT', 'E4', 'numerator', 1, NULL),
  ('IND_ANC_1ST_TRIMESTER_PCT', 'E5', 'denominator', 2, NULL),
  ('IND_ANC_4PLUS_PCT', 'E6', 'numerator', 1, NULL),
  ('IND_ANC_4PLUS_PCT', 'E7', 'denominator', 2, NULL),
  ('IND_INSTITUTIONAL_DELIVERY_PCT', 'E8', 'numerator_part', 1, 'Public (Mantra)'),
  ('IND_INSTITUTIONAL_DELIVERY_PCT', 'E9', 'numerator_part', 2, 'Private (HMIS)'),
  ('IND_INSTITUTIONAL_DELIVERY_PCT', 'E10', 'denominator', 3, 'DGFW estimated delivery'),
  ('IND_NORMAL_DEL_STAY48_PCT', 'DE_MANTRA_STAY48_FAC', 'numerator', 1, NULL),
  ('IND_NORMAL_DEL_STAY48_PCT', 'DE_MANTRA_NORMAL_DEL_FAC', 'denominator', 2, NULL),
  ('IND_HRP_MANAGED_PCT', 'DE_V17_HTN_MANAGED', 'numerator_part', 1, 'managed sum'),
  ('IND_HRP_MANAGED_PCT', 'DE_V25_ANAEMIA_TREATED', 'numerator_part', 2, 'managed sum'),
  ('IND_HRP_MANAGED_PCT', 'DE_V28_GDM_MANAGED', 'numerator_part', 3, 'managed sum'),
  ('IND_HRP_MANAGED_PCT', 'DE_V36_THYROID_TREATED', 'numerator_part', 4, 'managed sum'),
  ('IND_HRP_MANAGED_PCT', 'DE_V16_HTN_DETECTED', 'denominator_part', 5, 'identified sum'),
  ('IND_HRP_MANAGED_PCT', 'DE_V24_HB_LE7', 'denominator_part', 6, 'identified sum'),
  ('IND_HRP_MANAGED_PCT', 'DE_V27_GDM_POS', 'denominator_part', 7, 'identified sum'),
  ('IND_HRP_MANAGED_PCT', 'DE_V35_THYROID_POS', 'denominator_part', 8, 'identified sum'),
  ('IND_VHND_PCT', 'E22', 'numerator', 1, NULL),
  ('IND_VHND_PCT', 'E23', 'denominator', 2, 'Population / planned base'),
  ('IND_BIRTH_REG_PCT', 'E24', 'numerator', 1, NULL),
  ('IND_BIRTH_REG_PCT', 'E25', 'denominator', 2, 'Sum blocks to district'),
  ('IND_ANM_LOGIN_PCT', 'E26', 'numerator', 1, NULL),
  ('IND_ANM_LOGIN_PCT', 'E27', 'denominator', 2, NULL)
) AS c(ind_code, de_code, role, sort_order, expression_note)
JOIN indicator i ON i.code = c.ind_code
JOIN data_element d ON d.code = c.de_code
ON CONFLICT (indicator_id, data_element_id, role) DO UPDATE
SET sort_order = EXCLUDED.sort_order,
    expression_note = EXCLUDED.expression_note,
    is_active = TRUE;
