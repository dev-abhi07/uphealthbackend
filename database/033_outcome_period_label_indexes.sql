-- Speed up analytics range reads that filter on period_label
CREATE INDEX IF NOT EXISTS idx_outcome_district_value_period_label
  ON indicator_outcome_district_value (period_label);
CREATE INDEX IF NOT EXISTS idx_outcome_block_value_period_label
  ON indicator_outcome_block_value (period_label);
CREATE INDEX IF NOT EXISTS idx_outcome_district_period_label
  ON indicator_outcome_district (period_label);
CREATE INDEX IF NOT EXISTS idx_outcome_block_period_label
  ON indicator_outcome_block (period_label);
CREATE INDEX IF NOT EXISTS idx_outcome_district_value_period_label_ind
  ON indicator_outcome_district_value (period_label, indicator_code);
CREATE INDEX IF NOT EXISTS idx_outcome_block_value_period_label_ind
  ON indicator_outcome_block_value (period_label, indicator_code);
