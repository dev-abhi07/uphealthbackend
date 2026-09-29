-- Active roles for the product (no data-uploader roles — outcome data from API).
INSERT INTO role (code, name, is_active) VALUES
  ('system_admin', 'System Admin', TRUE),
  ('state_admin', 'State', TRUE),
  ('division_viewer', 'Division', TRUE),
  ('district_viewer', 'District', TRUE),
  ('block_viewer', 'Block', TRUE)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name, is_active = TRUE;

UPDATE role
SET is_active = FALSE
WHERE code IN (
  'district_uploader',
  'district_approver',
  'block_uploader',
  'facility_uploader'
);
