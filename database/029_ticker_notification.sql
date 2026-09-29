-- Ticker / marquee messages per sub-dashboard (landing, health ranking, etc.)

CREATE TABLE IF NOT EXISTS ticker_dashboard (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS ticker_notification (
  id              BIGSERIAL PRIMARY KEY,
  dashboard_code  TEXT NOT NULL REFERENCES ticker_dashboard(code),
  message         TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at       TIMESTAMPTZ NULL,
  ends_at         TIMESTAMPTZ NULL,
  created_by      BIGINT NULL REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by      BIGINT NULL REFERENCES app_user(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ticker_notification_message_nonempty CHECK (length(trim(message)) > 0),
  CONSTRAINT ticker_notification_dates_ok CHECK (
    ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at
  )
);

CREATE INDEX IF NOT EXISTS idx_ticker_notification_dashboard
  ON ticker_notification (dashboard_code, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ticker_notification_active_window
  ON ticker_notification (dashboard_code, starts_at, ends_at)
  WHERE is_active = TRUE;

INSERT INTO ticker_dashboard (code, name, sort_order) VALUES
  ('health_ranking', 'Health Ranking', 1),
  ('program_area',   'Program Area',   2),
  ('cm_dashboard',   'CM Dashboard',   3),
  ('niti_dashboard', 'NITI Dashboard', 4),
  ('cmo_dashboard',  'CMO Dashboard',  5),
  ('landing_page',   'Landing Page',   6)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      sort_order = EXCLUDED.sort_order,
      is_active = TRUE;
