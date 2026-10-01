-- =============================================================================
-- User activity / page access log
-- FE posts page views, actions, time spent; sysadmin can query.
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_activity_log (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  session_id       VARCHAR(64),
  event_type       VARCHAR(40) NOT NULL
                     CHECK (event_type IN (
                       'login',
                       'logout',
                       'page_view',
                       'page_leave',
                       'page_heartbeat',
                       'action',
                       'dashboard_view',
                       'api_hit'
                     )),
  page             VARCHAR(255),
  page_title       VARCHAR(255),
  action_name      VARCHAR(120),
  action_payload   JSONB,
  duration_ms      INTEGER,
  period_label     VARCHAR(20),
  view_mode        VARCHAR(40),
  geo_level        VARCHAR(20),
  dashboard_code   VARCHAR(80),
  referrer         TEXT,
  ip_address       VARCHAR(64),
  user_agent       TEXT,
  client_ts        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ual_user_created
  ON user_activity_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ual_event_created
  ON user_activity_log (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ual_page_created
  ON user_activity_log (page, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ual_session
  ON user_activity_log (session_id, created_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ual_created
  ON user_activity_log (created_at DESC);

COMMENT ON TABLE user_activity_log IS
  'Tracks logged-in users: page access, actions, time spent on ranking/dashboard pages';
