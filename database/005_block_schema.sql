-- =============================================================================
-- Schema: block
-- Mapped to division + district
-- Source: block_master.csv
--   FK_DivisionID, FK_DistrictID, Fk_TehsilId, Fk_StateId, B_LGD, BlockName
-- =============================================================================

CREATE TABLE IF NOT EXISTS block (
  id            BIGSERIAL PRIMARY KEY,
  division_id   BIGINT NOT NULL REFERENCES division(id),
  district_id   BIGINT NOT NULL REFERENCES district(id),
  tehsil_id     INT,
  state_id      INT DEFAULT 1,
  lgd_code      VARCHAR(20) NOT NULL,
  name          VARCHAR(150) NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_block_lgd_code UNIQUE (lgd_code),
  CONSTRAINT fk_block_district_division
    FOREIGN KEY (district_id) REFERENCES district(id)
);

CREATE INDEX IF NOT EXISTS idx_block_division_id ON block (division_id);
CREATE INDEX IF NOT EXISTS idx_block_district_id ON block (district_id);
CREATE INDEX IF NOT EXISTS idx_block_tehsil_id ON block (tehsil_id);
CREATE INDEX IF NOT EXISTS idx_block_name ON block (name);
CREATE INDEX IF NOT EXISTS idx_block_is_active ON block (is_active);

COMMENT ON TABLE block IS 'UP blocks mapped to district and division';
COMMENT ON COLUMN block.division_id IS 'FK → division.id (FK_DivisionID)';
COMMENT ON COLUMN block.district_id IS 'FK → district.id (FK_DistrictID)';
COMMENT ON COLUMN block.tehsil_id IS 'Source Fk_TehsilId (tehsil master later)';
COMMENT ON COLUMN block.state_id IS 'Source Fk_StateId';
COMMENT ON COLUMN block.lgd_code IS 'Block LGD code (B_LGD)';
COMMENT ON COLUMN block.name IS 'Block name';
