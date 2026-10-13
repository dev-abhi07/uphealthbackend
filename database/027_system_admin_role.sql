-- System admin role (user management). Distinct from state_admin (statewide view only).
INSERT INTO role (code, name) VALUES
  ('system_admin', 'System Admin')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = TRUE;
