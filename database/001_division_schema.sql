-- =============================================================================
-- Schema: division
-- Master table for UP administrative divisions
-- =============================================================================

CREATE TABLE IF NOT EXISTS division (
  id          BIGSERIAL PRIMARY KEY,
  code        VARCHAR(20) NOT NULL,
  name        VARCHAR(150) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_division_code UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_division_name ON division (name);
CREATE INDEX IF NOT EXISTS idx_division_is_active ON division (is_active);

COMMENT ON TABLE division IS 'UP health admin divisions (Division Code / Division Name)';
COMMENT ON COLUMN division.code IS 'Division Code (e.g. 11075)';
COMMENT ON COLUMN division.name IS 'Division Name (e.g. Prayagraj Division)';
