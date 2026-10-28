-- =============================================================================
-- Concurrent login sessions (max N per user; oldest revoked when over limit)
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_session (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  session_id         VARCHAR(64) NOT NULL,
  client_session_id  VARCHAR(64),
  user_agent         TEXT,
  ip_address         VARCHAR(64),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at         TIMESTAMPTZ,
  CONSTRAINT uq_user_session_session_id UNIQUE (session_id)
);

CREATE INDEX IF NOT EXISTS idx_user_session_user_active
  ON user_session (user_id, created_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_session_client
  ON user_session (user_id, client_session_id)
  WHERE client_session_id IS NOT NULL AND revoked_at IS NULL;
