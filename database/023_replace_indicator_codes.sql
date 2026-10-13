-- Replace legacy indicator.code with IND001–IND037; drop public_code
-- Run after 022 (or standalone if public_code never added)

BEGIN;

UPDATE indicator SET code = 'IND004', updated_at = NOW() WHERE code = 'IND_INSTITUTIONAL_DELIVERY_PCT';
UPDATE indicator SET code = 'IND024', updated_at = NOW() WHERE code = 'IND_DIABETES_SCREEN_30PLUS_PCT';
UPDATE indicator SET code = 'IND030', updated_at = NOW() WHERE code = 'IND_KOSHWANI_BUDGET_UTIL_PCT';
UPDATE indicator SET code = 'IND033', updated_at = NOW() WHERE code = 'IND_HIS_ACTIVE_FACILITY_PCT';
UPDATE indicator SET code = 'IND014', updated_at = NOW() WHERE code = 'IND_HBNC_SICK_REFERRAL_PCT';
UPDATE indicator SET code = 'IND026', updated_at = NOW() WHERE code = 'IND_UPKSK_ALL_SERVICES_PCT';
UPDATE indicator SET code = 'IND031', updated_at = NOW() WHERE code = 'IND_ABHA_VS_ENUMERATED_PCT';
UPDATE indicator SET code = 'IND002', updated_at = NOW() WHERE code = 'IND_ANC_1ST_TRIMESTER_PCT';
UPDATE indicator SET code = 'IND005', updated_at = NOW() WHERE code = 'IND_NORMAL_DEL_STAY48_PCT';
UPDATE indicator SET code = 'IND015', updated_at = NOW() WHERE code = 'IND_FULL_IMMUNIZATION_PCT';
UPDATE indicator SET code = 'IND023', updated_at = NOW() WHERE code = 'IND_HTN_SCREEN_30PLUS_PCT';
UPDATE indicator SET code = 'IND001', updated_at = NOW() WHERE code = 'IND_CHC_FRU_CSECTION_PCT';
UPDATE indicator SET code = 'IND020', updated_at = NOW() WHERE code = 'IND_TB_NOTIFICATION_RATE';
UPDATE indicator SET code = 'IND028', updated_at = NOW() WHERE code = 'IND_FAMS_BUDGET_UTIL_PCT';
UPDATE indicator SET code = 'IND010', updated_at = NOW() WHERE code = 'IND_PERINATAL_DEATH_PCT';
UPDATE indicator SET code = 'IND034', updated_at = NOW() WHERE code = 'IND_HIS_OPD_VS_HMIS_PCT';
UPDATE indicator SET code = 'IND013', updated_at = NOW() WHERE code = 'IND_SNCU_DISCHARGE_PCT';
UPDATE indicator SET code = 'IND017', updated_at = NOW() WHERE code = 'IND_ASHA_AVG_INCENTIVE';
UPDATE indicator SET code = 'IND018', updated_at = NOW() WHERE code = 'IND_FUNCTIONAL_AAM_PCT';
UPDATE indicator SET code = 'IND019', updated_at = NOW() WHERE code = 'IND_UDSP_REPORTING_PCT';
UPDATE indicator SET code = 'IND025', updated_at = NOW() WHERE code = 'IND_NQAS_CERTIFIED_PCT';
UPDATE indicator SET code = 'IND027', updated_at = NOW() WHERE code = 'IND_EDL_DRUG_AVAIL_PCT';
UPDATE indicator SET code = 'IND037', updated_at = NOW() WHERE code = 'IND_PMJAY_ABDM_HIS_PCT';
UPDATE indicator SET code = 'IND036', updated_at = NOW() WHERE code = 'IND_ABHA_EHR_LINK_PCT';
UPDATE indicator SET code = 'IND022', updated_at = NOW() WHERE code = 'IND_DRTB_SUCCESS_PCT';
UPDATE indicator SET code = 'IND032', updated_at = NOW() WHERE code = 'IND_ABHA_NEW_REG_PCT';
UPDATE indicator SET code = 'IND035', updated_at = NOW() WHERE code = 'IND_ABHA_OPD_HIS_PCT';
UPDATE indicator SET code = 'IND006', updated_at = NOW() WHERE code = 'IND_HRP_MANAGED_PCT';
UPDATE indicator SET code = 'IND029', updated_at = NOW() WHERE code = 'IND_GOLDEN_CARD_PCT';
UPDATE indicator SET code = 'IND021', updated_at = NOW() WHERE code = 'IND_TB_SUCCESS_PCT';
UPDATE indicator SET code = 'IND003', updated_at = NOW() WHERE code = 'IND_ANC_4PLUS_PCT';
UPDATE indicator SET code = 'IND008', updated_at = NOW() WHERE code = 'IND_BIRTH_REG_PCT';
UPDATE indicator SET code = 'IND009', updated_at = NOW() WHERE code = 'IND_ANM_LOGIN_PCT';
UPDATE indicator SET code = 'IND007', updated_at = NOW() WHERE code = 'IND_VHND_PCT';
UPDATE indicator SET code = 'IND012', updated_at = NOW() WHERE code = 'IND_NBSU_BOR';
UPDATE indicator SET code = 'IND011', updated_at = NOW() WHERE code = 'IND_LBW_PCT';
UPDATE indicator SET code = 'IND016', updated_at = NOW() WHERE code = 'IND_MR2_PCT';

-- Drop public_code (no longer used — code IS the API id)
DROP INDEX IF EXISTS uq_indicator_public_code;
ALTER TABLE indicator DROP COLUMN IF EXISTS public_code;

DROP INDEX IF EXISTS uq_ranking_indicator_public_code;
ALTER TABLE ranking_indicator DROP COLUMN IF EXISTS public_code;

-- Re-link ranking overlaps by master code
UPDATE ranking_indicator ri SET
  master_indicator_id = m.id,
  domain_label = COALESCE(ri.domain_label, m.domain_label),
  numerator_text = COALESCE(ri.numerator_text, m.numerator_text),
  denominator_text = COALESCE(ri.denominator_text, m.denominator_text),
  data_source_text = COALESCE(ri.data_source_text, m.data_source_text),
  is_negative = COALESCE(m.is_negative, ri.is_negative)
FROM indicator m
WHERE (ri.code, m.code) IN (
  ('RANK_ANC4_HB', 'IND003'),
  ('RANK_INST_DEL', 'IND004'),
  ('RANK_FULL_IMM', 'IND015'),
  ('RANK_ASHA_EXP', 'IND017'),
  ('RANK_TB_NOTIF', 'IND020')
);

COMMIT;
