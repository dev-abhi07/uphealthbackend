-- =============================================================================
-- Seed: division master data
-- Run after 001_division_schema.sql
-- =============================================================================

INSERT INTO division (code, name) VALUES
  ('11075', 'Prayagraj Division'),
  ('11076', 'Ayodhya Division'),
  ('11077', 'Lucknow Division'),
  ('11078', 'Meerut Division'),
  ('11079', 'Aligarh Division'),
  ('11080', 'Azamgarh Division'),
  ('11081', 'Bareilly Division'),
  ('11082', 'Basti Division'),
  ('11083', 'Chitrakoot Division'),
  ('11084', 'Gonda Division'),
  ('11085', 'Gorakhpur Division'),
  ('11086', 'Jhansi Division'),
  ('11087', 'Kanpur Nagar Division'),
  ('11088', 'Mirzapur Division'),
  ('11089', 'Moradabad Division'),
  ('11090', 'Saharanpur Division'),
  ('11091', 'Varanasi Division'),
  ('14595', 'Agra Division')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    is_active = TRUE,
    updated_at = NOW();
