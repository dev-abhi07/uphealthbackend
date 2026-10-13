-- Allow api_hit event type for global API access logging
ALTER TABLE user_activity_log DROP CONSTRAINT IF EXISTS user_activity_log_event_type_check;
ALTER TABLE user_activity_log ADD CONSTRAINT user_activity_log_event_type_check
  CHECK (event_type IN (
    'login',
    'logout',
    'page_view',
    'page_leave',
    'page_heartbeat',
    'action',
    'dashboard_view',
    'api_hit'
  ));
