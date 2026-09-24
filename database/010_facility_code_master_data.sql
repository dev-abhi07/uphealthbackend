-- =============================================================================
-- Seed: facility_code_master from FacilityCodeMaster.csv
-- Run after 009_facility_code_master_schema.sql
-- Requires: facility_code_master_load.csv in this folder
-- =============================================================================

TRUNCATE facility_code_master RESTART IDENTITY;

\copy facility_code_master (facility_code, hfr_code, facility_name, hims_code) FROM 'facility_code_master_load.csv' WITH (FORMAT csv, NULL '')
