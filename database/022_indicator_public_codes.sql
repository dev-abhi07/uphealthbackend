-- =============================================================================
-- Indicator public codes (IND001–IND037) + definition fields for API compatibility
-- Source: Ind_definition.xlsx (Defenetion / Domain wose)
-- Keeps internal `code` (IND_CHC_FRU_…) for upload templates; adds `public_code`.
-- =============================================================================

-- Master indicator table
ALTER TABLE indicator
  ADD COLUMN IF NOT EXISTS public_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS short_name TEXT,
  ADD COLUMN IF NOT EXISTS numerator_text TEXT,
  ADD COLUMN IF NOT EXISTS denominator_text TEXT,
  ADD COLUMN IF NOT EXISTS data_source_text TEXT,
  ADD COLUMN IF NOT EXISTS domain_label VARCHAR(120);

CREATE UNIQUE INDEX IF NOT EXISTS uq_indicator_public_code
  ON indicator (public_code)
  WHERE public_code IS NOT NULL;

COMMENT ON COLUMN indicator.public_code IS 'Client/API id IND001–IND037 (Ind_definition.xlsx)';
COMMENT ON COLUMN indicator.short_name IS 'UI short label';
COMMENT ON COLUMN indicator.numerator_text IS 'Definition numerator from indicator master sheet';
COMMENT ON COLUMN indicator.denominator_text IS 'Definition denominator from indicator master sheet';
COMMENT ON COLUMN indicator.data_source_text IS 'Human-readable data source(s) from master sheet';
COMMENT ON COLUMN indicator.domain_label IS 'Display domain label (e.g. Maternal Health)';

-- Ranking indicator: optional link to master KPI + same definition fields
ALTER TABLE ranking_indicator
  ADD COLUMN IF NOT EXISTS public_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS master_indicator_id BIGINT REFERENCES indicator(id),
  ADD COLUMN IF NOT EXISTS numerator_text TEXT,
  ADD COLUMN IF NOT EXISTS denominator_text TEXT,
  ADD COLUMN IF NOT EXISTS data_source_text TEXT,
  ADD COLUMN IF NOT EXISTS domain_label VARCHAR(120),
  ADD COLUMN IF NOT EXISTS is_negative BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ranking_indicator_public_code
  ON ranking_indicator (public_code)
  WHERE public_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ranking_indicator_master
  ON ranking_indicator (master_indicator_id);

COMMENT ON COLUMN ranking_indicator.public_code IS 'Mapped IND### when ranking KPI aligns with master sheet';
COMMENT ON COLUMN ranking_indicator.master_indicator_id IS 'FK to indicator when mapped to master KPI';

-- Assign IND001–IND037 by sno (matches Ind_definition.xlsx order)
UPDATE indicator SET public_code = 'IND' || lpad(sno::text, 3, '0'), updated_at = NOW()
WHERE sno BETWEEN 1 AND 37
  AND (public_code IS NULL OR public_code <> ('IND' || lpad(sno::text, 3, '0')));

-- Ranking ↔ master overlaps (best-effort)
UPDATE ranking_indicator ri SET
  public_code = m.public_code,
  master_indicator_id = m.id,
  domain_label = COALESCE(ri.domain_label, m.domain_label),
  numerator_text = COALESCE(ri.numerator_text, m.numerator_text),
  denominator_text = COALESCE(ri.denominator_text, m.denominator_text),
  data_source_text = COALESCE(ri.data_source_text, m.data_source_text),
  is_negative = COALESCE(m.is_negative, ri.is_negative)
FROM indicator m
WHERE (ri.code, m.public_code) IN (
  ('RANK_ANC4_HB', 'IND003'),
  ('RANK_INST_DEL', 'IND004'),
  ('RANK_FULL_IMM', 'IND015'),
  ('RANK_ASHA_EXP', 'IND017'),
  ('RANK_TB_NOTIF', 'IND020')
);
