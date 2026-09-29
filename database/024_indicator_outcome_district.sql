-- District indicator outcome cache (external API → DB → frontend)
-- Source JSON: districtName, districtLgdCode, month, year, indexOutcome, rankOutcome, indicators{IND001…}

CREATE TABLE IF NOT EXISTS indicator_outcome_district (
  id               BIGSERIAL PRIMARY KEY,
  external_id      BIGINT,
  district_name    VARCHAR(200) NOT NULL,
  district_lgd     INT NOT NULL,
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
  UNIQUE (year, month, district_lgd)
);

CREATE INDEX IF NOT EXISTS idx_outcome_district_period
  ON indicator_outcome_district (year, month, rank_outcome);

CREATE INDEX IF NOT EXISTS idx_outcome_district_lgd
  ON indicator_outcome_district (district_lgd);

CREATE TABLE IF NOT EXISTS indicator_outcome_district_value (
  id               BIGSERIAL PRIMARY KEY,
  year             INT NOT NULL,
  month            INT NOT NULL,
  period_label     VARCHAR(20) NOT NULL,
  district_lgd     INT NOT NULL,
  indicator_code   VARCHAR(20) NOT NULL,
  value            NUMERIC(18,8),
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (year, month, district_lgd, indicator_code)
);

CREATE INDEX IF NOT EXISTS idx_outcome_district_value_period_ind
  ON indicator_outcome_district_value (year, month, indicator_code);

CREATE INDEX IF NOT EXISTS idx_outcome_district_value_lgd
  ON indicator_outcome_district_value (district_lgd);

CREATE TABLE IF NOT EXISTS indicator_outcome_sync_log (
  id               BIGSERIAL PRIMARY KEY,
  geo_level        VARCHAR(20) NOT NULL DEFAULT 'district',
  year             INT NOT NULL,
  month            INT NOT NULL,
  period_label     VARCHAR(20) NOT NULL,
  status           VARCHAR(20) NOT NULL,
  source           VARCHAR(20),
  row_count        INT,
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE indicator_outcome_district IS 'Cached district composite rank/score from external outcome API';
COMMENT ON TABLE indicator_outcome_district_value IS 'Cached per-indicator values (IND001–IND037) for district outcome';
