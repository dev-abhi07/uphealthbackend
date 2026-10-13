/**
 * Replace legacy IND_* codes with IND001–IND037 across seed/template files.
 * Also writes database/023_replace_indicator_codes.sql for live DB rename.
 */
const fs = require('fs');
const path = require('path');

const OLD_TO_NEW = {
  IND_CHC_FRU_CSECTION_PCT: 'IND001',
  IND_ANC_1ST_TRIMESTER_PCT: 'IND002',
  IND_ANC_4PLUS_PCT: 'IND003',
  IND_INSTITUTIONAL_DELIVERY_PCT: 'IND004',
  IND_NORMAL_DEL_STAY48_PCT: 'IND005',
  IND_HRP_MANAGED_PCT: 'IND006',
  IND_VHND_PCT: 'IND007',
  IND_BIRTH_REG_PCT: 'IND008',
  IND_ANM_LOGIN_PCT: 'IND009',
  IND_PERINATAL_DEATH_PCT: 'IND010',
  IND_LBW_PCT: 'IND011',
  IND_NBSU_BOR: 'IND012',
  IND_SNCU_DISCHARGE_PCT: 'IND013',
  IND_HBNC_SICK_REFERRAL_PCT: 'IND014',
  IND_FULL_IMMUNIZATION_PCT: 'IND015',
  IND_MR2_PCT: 'IND016',
  IND_ASHA_AVG_INCENTIVE: 'IND017',
  IND_FUNCTIONAL_AAM_PCT: 'IND018',
  IND_UDSP_REPORTING_PCT: 'IND019',
  IND_TB_NOTIFICATION_RATE: 'IND020',
  IND_TB_SUCCESS_PCT: 'IND021',
  IND_DRTB_SUCCESS_PCT: 'IND022',
  IND_HTN_SCREEN_30PLUS_PCT: 'IND023',
  IND_DIABETES_SCREEN_30PLUS_PCT: 'IND024',
  IND_NQAS_CERTIFIED_PCT: 'IND025',
  IND_UPKSK_ALL_SERVICES_PCT: 'IND026',
  IND_EDL_DRUG_AVAIL_PCT: 'IND027',
  IND_FAMS_BUDGET_UTIL_PCT: 'IND028',
  IND_GOLDEN_CARD_PCT: 'IND029',
  IND_KOSHWANI_BUDGET_UTIL_PCT: 'IND030',
  IND_ABHA_VS_ENUMERATED_PCT: 'IND031',
  IND_ABHA_NEW_REG_PCT: 'IND032',
  IND_HIS_ACTIVE_FACILITY_PCT: 'IND033',
  IND_HIS_OPD_VS_HMIS_PCT: 'IND034',
  IND_ABHA_OPD_HIS_PCT: 'IND035',
  IND_ABHA_EHR_LINK_PCT: 'IND036',
  IND_PMJAY_ABDM_HIS_PCT: 'IND037',
};

const FILES = [
  'src/upload/templateRegistry.js',
  'src/services/uploadService.js',
  'scripts/generateSampleXlsx.js',
  'database/017_full_indicator_sheet_seed.sql',
  'database/012_master_tables_seed.sql',
  'database/019_anc4_hb_combined_indicator.sql',
  'docs/UPLOAD_API.md',
];

const root = path.join(__dirname, '..');

// Longer keys first so partial overlaps never happen
const pairs = Object.entries(OLD_TO_NEW).sort((a, b) => b[0].length - a[0].length);

for (const rel of FILES) {
  const fp = path.join(root, rel);
  if (!fs.existsSync(fp)) {
    console.warn('skip missing', rel);
    continue;
  }
  let t = fs.readFileSync(fp, 'utf8');
  let n = 0;
  for (const [oldCode, newCode] of pairs) {
    const re = new RegExp(oldCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const matches = t.match(re);
    if (matches) {
      t = t.replace(re, newCode);
      n += matches.length;
    }
  }
  fs.writeFileSync(fp, t);
  console.log(rel, n);
}

// Live DB migration SQL
const updates = pairs
  .map(
    ([oldCode, newCode]) =>
      `UPDATE indicator SET code = '${newCode}', updated_at = NOW() WHERE code = '${oldCode}';`
  )
  .join('\n');

const sql = `-- Replace legacy indicator.code with IND001–IND037; drop public_code
-- Run after 022 (or standalone if public_code never added)

BEGIN;

${updates}

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
`;

fs.writeFileSync(path.join(root, 'database', '023_replace_indicator_codes.sql'), sql);
console.log('wrote database/023_replace_indicator_codes.sql');
