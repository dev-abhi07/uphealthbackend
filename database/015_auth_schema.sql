-- =============================================================================
-- Auth / login master tables
-- =============================================================================

CREATE TABLE IF NOT EXISTS app_user (
  id             BIGSERIAL PRIMARY KEY,
  username       VARCHAR(100) NOT NULL,
  full_name      VARCHAR(150),
  email          VARCHAR(150),
  mobile         VARCHAR(20),
  password_hash  TEXT NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_app_user_username UNIQUE (username)
);

CREATE INDEX IF NOT EXISTS idx_app_user_active ON app_user (is_active);

CREATE TABLE IF NOT EXISTS user_role (
  user_id  BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role_id  BIGINT NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS user_geo_assignment (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  geo_level    VARCHAR(20) NOT NULL
                 CHECK (geo_level IN ('division', 'district', 'block', 'facility')),
  division_id  BIGINT REFERENCES division(id),
  district_id  BIGINT REFERENCES district(id),
  block_id     BIGINT REFERENCES block(id),
  facility_id  BIGINT REFERENCES facility(id),
  is_active    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_user_geo_user ON user_geo_assignment (user_id);
