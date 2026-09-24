-- =============================================================================
-- Seed: facility master from Facility.csv
-- Run after 007_facility_schema.sql
-- Requires: database/facility_load.csv (generated from Downloads/Facility.csv)
-- =============================================================================

TRUNCATE facility RESTART IDENTITY;

\copy facility (source_id, facility_code, state_id, division_id, district_id, block_id, source_block_id, name, status, is_active) FROM 'facility_load.csv' WITH (FORMAT csv, NULL '')
