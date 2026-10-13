-- Block indicator outcome cache (external API → DB → frontend)
-- Source JSON: districtName, districtLgdCode, blockName, blockLgdCode,
--   month, year, indexOutcome, rankOutcome, indicators{IND###}

CREATE TABLE IF NOT EXISTS indicator_outcome_block (
  id               BIGSERIAL PRIMARY KEY,
  external_id      BIGINT,
  district_name    VARCHAR(200) NOT NULL,
  district_lgd     INT NOT NULL,
  block_name       VARCHAR(200) NOT NULL,
  block_lgd        INT NOT NULL,
  month            INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year             INT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  period_label     VARCHAR(20) NOT NULL,
  index_outcome    NUMERIC(18,8),
  rank_outcome     INT,
  source           VARCHAR(20) NOT NULL DEFAULT 'api'
                     CHECK (source IN ('api', 'excel', 'manual')),
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (year, month, block_lgd)
);

CREATE INDEX IF NOT EXISTS idx_outcome_block_period
  ON indicator_outcome_block (year, month, rank_outcome);

CREATE INDEX IF NOT EXISTS idx_outcome_block_lgd
  ON indicator_outcome_block (block_lgd);

CREATE INDEX IF NOT EXISTS idx_outcome_block_district_lgd
  ON indicator_outcome_block (district_lgd);

CREATE TABLE IF NOT EXISTS indicator_outcome_block_value (
  id               BIGSERIAL PRIMARY KEY,
  year             INT NOT NULL,
  month            INT NOT NULL,
  period_label     VARCHAR(20) NOT NULL,
  block_lgd        INT NOT NULL,
  district_lgd     INT,
  indicator_code   VARCHAR(20) NOT NULL,
  value            NUMERIC(18,8),
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (year, month, block_lgd, indicator_code)
);

CREATE INDEX IF NOT EXISTS idx_outcome_block_value_period_ind
  ON indicator_outcome_block_value (year, month, indicator_code);

CREATE INDEX IF NOT EXISTS idx_outcome_block_value_lgd
  ON indicator_outcome_block_value (block_lgd);

COMMENT ON TABLE indicator_outcome_block IS 'Cached block composite rank/score from external outcome API';
COMMENT ON TABLE indicator_outcome_block_value IS 'Cached per-indicator values (IND###) for block outcome';
