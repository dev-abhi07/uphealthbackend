-- =============================================================================
-- Schema: facility
-- Mapped to division, district, block
-- Source: Facility.csv
--   PK_UniqueID, FK_FacilityCode, FK_StateID, FK_DivisionID, FK_DistrictID,
--   FK_BlockID, FacilityName, FacilityStatus
-- =============================================================================

CREATE TABLE IF NOT EXISTS facility (
  id                BIGSERIAL PRIMARY KEY,
  source_id         BIGINT NOT NULL,
  facility_code     VARCHAR(30) NOT NULL,
  state_id          INT DEFAULT 1,
  division_id       BIGINT NOT NULL REFERENCES division(id),
  district_id       BIGINT NOT NULL REFERENCES district(id),
  block_id          BIGINT REFERENCES block(id),
  source_block_id   INT,
  name              VARCHAR(255) NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'Active',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_facility_source_id UNIQUE (source_id),
  CONSTRAINT uq_facility_code UNIQUE (facility_code)
);

CREATE INDEX IF NOT EXISTS idx_facility_division_id ON facility (division_id);
CREATE INDEX IF NOT EXISTS idx_facility_district_id ON facility (district_id);
CREATE INDEX IF NOT EXISTS idx_facility_block_id ON facility (block_id);
CREATE INDEX IF NOT EXISTS idx_facility_source_block_id ON facility (source_block_id);
CREATE INDEX IF NOT EXISTS idx_facility_name ON facility (name);
CREATE INDEX IF NOT EXISTS idx_facility_is_active ON facility (is_active);
CREATE INDEX IF NOT EXISTS idx_facility_status ON facility (status);

COMMENT ON TABLE facility IS 'UP health facilities mapped to division, district, block';
COMMENT ON COLUMN facility.source_id IS 'Source PK_UniqueID';
COMMENT ON COLUMN facility.facility_code IS 'Source FK_FacilityCode';
COMMENT ON COLUMN facility.block_id IS 'FK → block.id (nullable if source block not in block master)';
COMMENT ON COLUMN facility.source_block_id IS 'Original FK_BlockID from Facility.csv';
COMMENT ON COLUMN facility.status IS 'Active / Inactive from FacilityStatus';
