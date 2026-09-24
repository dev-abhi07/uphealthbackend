-- =============================================================================
-- Schema: facility_code_master
-- Source: FacilityCodeMaster.csv
--   FacilityCode, HFR_CODE, FacilityName, HIMSCode
-- =============================================================================

CREATE TABLE IF NOT EXISTS facility_code_master (
  id              BIGSERIAL PRIMARY KEY,
  facility_code   VARCHAR(30) NOT NULL,
  hfr_code        VARCHAR(50),
  facility_name   VARCHAR(255) NOT NULL,
  hims_code       VARCHAR(30),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_facility_code_master_code UNIQUE (facility_code)
);

CREATE INDEX IF NOT EXISTS idx_fcm_hfr_code ON facility_code_master (hfr_code);
CREATE INDEX IF NOT EXISTS idx_fcm_hims_code ON facility_code_master (hims_code);
CREATE INDEX IF NOT EXISTS idx_fcm_facility_name ON facility_code_master (facility_name);

COMMENT ON TABLE facility_code_master IS 'Facility code crosswalk: FacilityCode, HFR, HIMS';
COMMENT ON COLUMN facility_code_master.facility_code IS 'Source FacilityCode (e.g. FC10156)';
COMMENT ON COLUMN facility_code_master.hfr_code IS 'Source HFR_CODE';
COMMENT ON COLUMN facility_code_master.hims_code IS 'Source HIMSCode';
