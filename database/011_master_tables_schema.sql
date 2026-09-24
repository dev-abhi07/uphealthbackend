-- =============================================================================
-- Master tables only (config / reference)
-- Geo masters already exist: division, district, block, facility,
--                            facility_code_master
-- This file adds: source, DE, indicator config, time period
-- Does NOT create fact / kpi / upload transactional tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Source systems (21 data sources)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_system (
  id              BIGSERIAL PRIMARY KEY,
  code            VARCHAR(50) NOT NULL,
  name            VARCHAR(150) NOT NULL,
  de_count        INT NOT NULL DEFAULT 0,
  has_facility    BOOLEAN NOT NULL DEFAULT FALSE,
  has_block       BOOLEAN NOT NULL DEFAULT FALSE,
  has_district    BOOLEAN NOT NULL DEFAULT FALSE,
  remarks         TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_source_system_code UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_source_system_active ON source_system (is_active);

COMMENT ON TABLE source_system IS 'Master: 21 external/manual data sources';
COMMENT ON COLUMN source_system.de_count IS 'Number of data elements from source sheet';
COMMENT ON COLUMN source_system.has_facility IS 'Source provides facility-level DEs';
COMMENT ON COLUMN source_system.has_block IS 'Source provides block-level DEs';
COMMENT ON COLUMN source_system.has_district IS 'Source provides district-level DEs';

-- -----------------------------------------------------------------------------
-- 2. Data elements (DE catalog)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_element (
  id                  BIGSERIAL PRIMARY KEY,
  code                VARCHAR(50) NOT NULL,
  name                TEXT NOT NULL,
  source_id           BIGINT NOT NULL REFERENCES source_system(id),
  collection_level    VARCHAR(20) NOT NULL
                        CHECK (collection_level IN ('facility', 'block', 'district')),
  variable            VARCHAR(50),
  external_field      VARCHAR(100),
  filter_text         VARCHAR(100),
  period_type         VARCHAR(30) DEFAULT 'monthly'
                        CHECK (period_type IN ('monthly', 'rolling_30d', 'cumulative', 'fy', 'custom')),
  unit                VARCHAR(30) DEFAULT 'count',
  description         TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_data_element_code UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_data_element_source ON data_element (source_id);
CREATE INDEX IF NOT EXISTS idx_data_element_level ON data_element (collection_level);
CREATE INDEX IF NOT EXISTS idx_data_element_active ON data_element (is_active);

COMMENT ON TABLE data_element IS 'Master: data elements (DE) from sources; collection_level = fetch grain';
COMMENT ON COLUMN data_element.collection_level IS 'facility | block | district — level for data fetch';
COMMENT ON COLUMN data_element.variable IS 'HMIS variable e.g. v65, v54';
COMMENT ON COLUMN data_element.filter_text IS 'e.g. CHC, Public, Private';

-- -----------------------------------------------------------------------------
-- 3. Indicator master
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS indicator (
  id                  BIGSERIAL PRIMARY KEY,
  sno                 INT,
  code                VARCHAR(50) NOT NULL,
  name                TEXT NOT NULL,
  domain              VARCHAR(50),
  indicator_type      VARCHAR(30),
  ranking_level       VARCHAR(20) NOT NULL
                        CHECK (ranking_level IN ('division', 'district', 'block', 'both', 'facility')),
  formula_text        TEXT,
  unit                VARCHAR(20) NOT NULL DEFAULT 'percent',
  is_negative         BOOLEAN NOT NULL DEFAULT FALSE,
  weight              NUMERIC(8,4),
  period_type         VARCHAR(30) DEFAULT 'monthly',
  primary_source_id   BIGINT REFERENCES source_system(id),
  description         TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_indicator_code UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_indicator_domain ON indicator (domain);
CREATE INDEX IF NOT EXISTS idx_indicator_type ON indicator (indicator_type);
CREATE INDEX IF NOT EXISTS idx_indicator_ranking ON indicator (ranking_level);
CREATE INDEX IF NOT EXISTS idx_indicator_sno ON indicator (sno);

COMMENT ON TABLE indicator IS 'Master: KPI definitions for dashboard (BY INDICATORS / TYPE / DOMAIN)';
COMMENT ON COLUMN indicator.domain IS 'e.g. ante_natal, delivery_care — BY DOMAIN tab';
COMMENT ON COLUMN indicator.indicator_type IS 'coverage | quality | data_quality — BY TYPE tab';
COMMENT ON COLUMN indicator.ranking_level IS 'Client calculation/ranking level: district | both | block';
COMMENT ON COLUMN indicator.weight IS 'Weight for overall composite score';

-- -----------------------------------------------------------------------------
-- 4. Indicator applicable display levels
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS indicator_level (
  indicator_id  BIGINT NOT NULL REFERENCES indicator(id) ON DELETE CASCADE,
  level         VARCHAR(20) NOT NULL
                  CHECK (level IN ('division', 'district', 'block', 'facility')),
  PRIMARY KEY (indicator_id, level)
);

COMMENT ON TABLE indicator_level IS 'Master: where KPI can be shown in UI/API';

-- -----------------------------------------------------------------------------
-- 5. Indicator ↔ data element (numerator / denominator parts)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS indicator_component (
  id                BIGSERIAL PRIMARY KEY,
  indicator_id      BIGINT NOT NULL REFERENCES indicator(id) ON DELETE CASCADE,
  data_element_id   BIGINT NOT NULL REFERENCES data_element(id),
  role              VARCHAR(30) NOT NULL
                      CHECK (role IN (
                        'numerator', 'denominator',
                        'numerator_part', 'denominator_part', 'part'
                      )),
  sort_order        INT NOT NULL DEFAULT 0,
  expression_note   TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_indicator_component UNIQUE (indicator_id, data_element_id, role)
);

CREATE INDEX IF NOT EXISTS idx_indicator_component_ind ON indicator_component (indicator_id);
CREATE INDEX IF NOT EXISTS idx_indicator_component_de ON indicator_component (data_element_id);

COMMENT ON TABLE indicator_component IS 'Master: maps indicator formula parts to data elements';
COMMENT ON COLUMN indicator_component.role IS 'numerator / denominator / *_part for multi-source KPIs';

-- -----------------------------------------------------------------------------
-- 6. Time period master
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS time_period (
  id           BIGSERIAL PRIMARY KEY,
  period_type  VARCHAR(30) NOT NULL
                 CHECK (period_type IN ('monthly', 'rolling_30d', 'cumulative', 'fy', 'custom')),
  label        VARCHAR(50) NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_time_period UNIQUE (period_type, label)
);

CREATE INDEX IF NOT EXISTS idx_time_period_dates ON time_period (start_date, end_date);

COMMENT ON TABLE time_period IS 'Master: reporting periods (May-26, FY2026-27, etc.)';

-- -----------------------------------------------------------------------------
-- 7. Role master (for later upload / dashboard access)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role (
  id         BIGSERIAL PRIMARY KEY,
  code       VARCHAR(50) NOT NULL,
  name       VARCHAR(100) NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_role_code UNIQUE (code)
);

COMMENT ON TABLE role IS 'Master: user roles (district/block/facility uploaders, etc.)';
