-- =============================================================================
-- Schema: district
-- Mapped to division via division_id (FK)
-- Columns from source: Division Id, D_LGD, DistrictName
-- =============================================================================

CREATE TABLE IF NOT EXISTS district (
  id            BIGSERIAL PRIMARY KEY,
  division_id   BIGINT NOT NULL REFERENCES division(id),
  lgd_code      VARCHAR(20) NOT NULL,
  name          VARCHAR(150) NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_district_lgd_code UNIQUE (lgd_code)
);

CREATE INDEX IF NOT EXISTS idx_district_division_id ON district (division_id);
CREATE INDEX IF NOT EXISTS idx_district_name ON district (name);
CREATE INDEX IF NOT EXISTS idx_district_is_active ON district (is_active);

COMMENT ON TABLE district IS 'UP districts mapped to division';
COMMENT ON COLUMN district.division_id IS 'FK → division.id (source Division Id)';
COMMENT ON COLUMN district.lgd_code IS 'District LGD code (D_LGD)';
COMMENT ON COLUMN district.name IS 'District name';
