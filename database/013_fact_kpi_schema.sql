-- =============================================================================
-- Transactional tables for sample dashboard data
-- =============================================================================

CREATE TABLE IF NOT EXISTS fact_component_value (
  id               BIGSERIAL PRIMARY KEY,
  data_element_id  BIGINT NOT NULL REFERENCES data_element(id),
  source_id        BIGINT NOT NULL REFERENCES source_system(id),
  geo_level        VARCHAR(20) NOT NULL
                     CHECK (geo_level IN ('facility', 'block', 'district')),
  division_id      BIGINT REFERENCES division(id),
  district_id      BIGINT REFERENCES district(id),
  block_id         BIGINT REFERENCES block(id),
  facility_id      BIGINT REFERENCES facility(id),
  time_period_id   BIGINT REFERENCES time_period(id),
  as_of_date       DATE,
  value_num        NUMERIC(18,4) NOT NULL,
  batch_id         VARCHAR(100),
  ingested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fact_de_period ON fact_component_value (data_element_id, time_period_id);
CREATE INDEX IF NOT EXISTS idx_fact_district ON fact_component_value (district_id, data_element_id, time_period_id);
CREATE INDEX IF NOT EXISTS idx_fact_block ON fact_component_value (block_id, data_element_id, time_period_id);

CREATE TABLE IF NOT EXISTS kpi_value (
  id               BIGSERIAL PRIMARY KEY,
  indicator_id     BIGINT NOT NULL REFERENCES indicator(id),
  geo_level        VARCHAR(20) NOT NULL
                     CHECK (geo_level IN ('division', 'district', 'block', 'facility')),
  division_id      BIGINT REFERENCES division(id),
  district_id      BIGINT REFERENCES district(id),
  block_id         BIGINT REFERENCES block(id),
  facility_id      BIGINT REFERENCES facility(id),
  time_period_id   BIGINT REFERENCES time_period(id),
  as_of_date       DATE,
  numerator        NUMERIC(18,4),
  denominator      NUMERIC(18,4),
  value            NUMERIC(18,4),
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kpi_indicator_period ON kpi_value (indicator_id, geo_level, time_period_id);
CREATE INDEX IF NOT EXISTS idx_kpi_district ON kpi_value (district_id, indicator_id, time_period_id);
