/**
 * User activity log — page views, actions, time spent on dashboard/ranking.
 * Write: any authenticated user. Read/summary: system_admin.
 */
const { query } = require('../db/pool');

const ALLOWED_EVENTS = new Set([
  'login',
  'logout',
  'page_view',
  'page_leave',
  'page_heartbeat',
  'action',
  'dashboard_view',
  'api_hit',
]);

/** FE aliases → canonical event_type */
const EVENT_ALIASES = {
  login: 'login',
  log_in: 'login',
  signin: 'login',
  sign_in: 'login',
  logout: 'logout',
  log_out: 'logout',
  signout: 'logout',
  sign_out: 'logout',
  page_view: 'page_view',
  pageview: 'page_view',
  'page-view': 'page_view',
  view: 'page_view',
  page_enter: 'page_view',
  enter: 'page_view',
  page_leave: 'page_leave',
  pageleave: 'page_leave',
  'page-leave': 'page_leave',
  leave: 'page_leave',
  exit: 'page_leave',
  unload: 'page_leave',
  page_exit: 'page_leave',
  page_heartbeat: 'page_heartbeat',
  heartbeat: 'page_heartbeat',
  'page-heartbeat': 'page_heartbeat',
  ping: 'page_heartbeat',
  keep_alive: 'page_heartbeat',
  keepalive: 'page_heartbeat',
  action: 'action',
  click: 'action',
  user_action: 'action',
  useraction: 'action',
  event_action: 'action',
  api_hit: 'api_hit',
  apihit: 'api_hit',
  'api-hit': 'api_hit',
  api: 'api_hit',
  request: 'api_hit',
  dashboard_view: 'dashboard_view',
  dashboardview: 'dashboard_view',
  'dashboard-view': 'dashboard_view',
  dashboard: 'dashboard_view',
  ranking_view: 'dashboard_view',
};

function resolveEventType(raw = {}) {
  const candidates = [
    raw.event_type,
    raw.eventType,
    raw.event,
    raw.type,
    raw.name,
  ];
  for (const c of candidates) {
    if (c == null || c === '') continue;
    const key = String(c)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/-/g, '_');
    // try exact + with underscores normalized from camelCase already lowercased
    if (EVENT_ALIASES[key]) return EVENT_ALIASES[key];
    // camelCase leftovers: pageView → pageview already; page_View unlikely
    const compact = key.replace(/_/g, '');
    if (EVENT_ALIASES[compact]) return EVENT_ALIASES[compact];
    if (ALLOWED_EVENTS.has(key)) return key;
  }

  // Heuristics when FE omits event_type
  if (raw.action_name || raw.actionName || (raw.action && typeof raw.action === 'string' && !EVENT_ALIASES[String(raw.action).toLowerCase()])) {
    // { action: "download" } without event_type → treat as action
    if (!raw.event_type && !raw.eventType && !raw.type && !raw.event) {
      return 'action';
    }
  }
  if (
    (raw.duration_ms != null || raw.durationMs != null || raw.duration_sec != null) &&
    (raw.page || raw.path || raw.route)
  ) {
    if (!raw.event_type && !raw.eventType && !raw.type && !raw.event) {
      return 'page_leave';
    }
  }
  if (raw.page || raw.path || raw.route) {
    if (!raw.event_type && !raw.eventType && !raw.type && !raw.event) {
      return 'page_view';
    }
  }
  return null;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * FE often sends from=2026-09-01&to=2026-09-30 (date only).
 * Treat as full IST/calendar days: [from 00:00, to+1 day).
 */
function appendDateRange(where, params, from, to) {
  if (from) {
    const raw = String(from).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      params.push(raw);
      where.push(`l.created_at >= $${params.length}::date`);
    } else {
      params.push(raw);
      where.push(`l.created_at >= $${params.length}::timestamptz`);
    }
  }
  if (to) {
    const raw = String(to).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      // Inclusive end date: created_at < next day
      params.push(raw);
      where.push(`l.created_at < ($${params.length}::date + INTERVAL '1 day')`);
    } else {
      params.push(raw);
      where.push(`l.created_at <= $${params.length}::timestamptz`);
    }
  }
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function strOrNull(v, max = 255) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function normalizeEvent(raw = {}) {
  const eventType = resolveEventType(raw);
  if (!eventType || !ALLOWED_EVENTS.has(eventType)) {
    const got =
      raw.event_type ?? raw.eventType ?? raw.event ?? raw.type ?? raw.name ?? null;
    throw httpError(
      400,
      `event_type must be one of: ${[...ALLOWED_EVENTS].join(', ')}` +
        (got != null ? ` (got: ${JSON.stringify(got)})` : ' (missing event_type)')
    );
  }

  let durationMs = numOrNull(raw.duration_ms ?? raw.durationMs ?? raw.duration);
  // Allow duration_sec from FE
  if (durationMs == null && (raw.duration_sec != null || raw.durationSec != null)) {
    const sec = numOrNull(raw.duration_sec ?? raw.durationSec);
    if (sec != null) durationMs = sec * 1000;
  }
  if (durationMs != null && durationMs < 0) durationMs = 0;

  let payload = raw.action_payload ?? raw.payload ?? raw.meta ?? null;
  if (payload != null && typeof payload !== 'object') {
    payload = { value: payload };
  }

  let clientTs = raw.client_ts || raw.clientTs || raw.timestamp || null;
  if (clientTs) {
    const d = new Date(clientTs);
    clientTs = Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // action_name: prefer explicit fields; if event is action and `action` is not an event alias, use it
  let actionName =
    raw.action_name || raw.actionName || null;
  if (!actionName && raw.action != null) {
    const a = String(raw.action).trim().toLowerCase();
    if (!EVENT_ALIASES[a] && !ALLOWED_EVENTS.has(a)) {
      actionName = raw.action;
    }
  }

  return {
    event_type: eventType,
    session_id: strOrNull(raw.session_id || raw.sessionId, 64),
    page: strOrNull(raw.page || raw.path || raw.route, 255),
    page_title: strOrNull(raw.page_title || raw.pageTitle || raw.title, 255),
    action_name: strOrNull(actionName, 120),
    action_payload: payload,
    duration_ms: durationMs,
    period_label: strOrNull(raw.period_label || raw.period || raw.periodLabel, 20),
    view_mode: strOrNull(raw.view_mode || raw.viewMode || raw.view, 40),
    geo_level: strOrNull(raw.geo_level || raw.geoLevel || raw.level, 20),
    dashboard_code: strOrNull(
      raw.dashboard_code || raw.dashboardCode || raw.dashboard,
      80
    ),
    referrer: strOrNull(raw.referrer, 1000),
    client_ts: clientTs,
  };
}

function formatIstDateTime(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  // Asia/Kolkata wall clock
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const time = `${get('hour')}:${get('minute')}:${get('second')}`;
  return { date, time, display: `${date} ${time}` };
}

function mapRow(r) {
  if (!r) return null;
  const ist = formatIstDateTime(r.created_at || r.client_ts);
  const rankingPeriod = r.period_label || null;
  // period_label for FE "Period" column: ranking month (if any) + activity date-time
  let periodLabel = ist?.display || rankingPeriod || null;
  if (rankingPeriod && ist?.display) {
    periodLabel = `${rankingPeriod} | ${ist.display}`;
  }

  return {
    id: Number(r.id),
    user_id: Number(r.user_id),
    username: r.username || null,
    full_name: r.full_name || null,
    session_id: r.session_id || null,
    event_type: r.event_type,
    page: r.page || null,
    page_title: r.page_title || null,
    action_name: r.action_name || null,
    action_payload: r.action_payload || null,
    duration_ms: r.duration_ms != null ? Number(r.duration_ms) : null,
    duration_sec:
      r.duration_ms != null ? Math.round(Number(r.duration_ms) / 1000) : null,
    period_label: periodLabel,
    ranking_period: rankingPeriod,
    activity_date: ist?.date || null,
    activity_time: ist?.time || null,
    view_mode: r.view_mode || null,
    geo_level: r.geo_level || null,
    dashboard_code: r.dashboard_code || null,
    referrer: r.referrer || null,
    ip_address: r.ip_address || null,
    user_agent: r.user_agent || null,
    client_ts: r.client_ts || null,
    created_at: r.created_at,
  };
}

async function insertEvent(userId, event, { ip, userAgent } = {}) {
  const e = normalizeEvent(event);
  const { rows } = await query(
    `
    INSERT INTO user_activity_log (
      user_id, session_id, event_type, page, page_title,
      action_name, action_payload, duration_ms,
      period_label, view_mode, geo_level, dashboard_code,
      referrer, ip_address, user_agent, client_ts
    ) VALUES (
      $1,$2,$3,$4,$5,
      $6,$7::jsonb,$8,
      $9,$10,$11,$12,
      $13,$14,$15,$16
    )
    RETURNING *
    `,
    [
      userId,
      e.session_id,
      e.event_type,
      e.page,
      e.page_title,
      e.action_name,
      e.action_payload ? JSON.stringify(e.action_payload) : null,
      e.duration_ms,
      e.period_label,
      e.view_mode,
      e.geo_level,
      e.dashboard_code,
      e.referrer,
      strOrNull(ip, 64),
      strOrNull(userAgent, 1000),
      e.client_ts,
    ]
  );
  return mapRow(rows[0]);
}

/**
 * Log one or many events for the authenticated user.
 */
async function logEvents(userId, body, meta = {}) {
  const list = Array.isArray(body?.events)
    ? body.events
    : Array.isArray(body)
      ? body
      : [body];

  if (!list.length) throw httpError(400, 'Provide an event object or events[]');
  if (list.length > 100) throw httpError(400, 'Max 100 events per request');

  const saved = [];
  for (const item of list) {
    saved.push(await insertEvent(userId, item, meta));
  }
  return { count: saved.length, events: saved };
}

/**
 * Fire-and-forget activity log — never throws (safe for login/logout hooks).
 */
async function logActivitySafe(userId, event, meta = {}) {
  try {
    if (!userId) return null;
    const { events } = await logEvents(userId, event, meta);
    return events?.[0] || null;
  } catch (err) {
    console.error('[userLog] logActivitySafe failed:', err.message);
    return null;
  }
}

async function listLogs({
  userId,
  username,
  eventType,
  page,
  sessionId,
  from,
  to,
  q,
  pageNum = 1,
  pageSize = 50,
  groupBy = 'name',
  logsPerUser = 0,
} = {}) {
  const where = ['1=1'];
  const params = [];

  if (userId) {
    params.push(Number(userId));
    where.push(`l.user_id = $${params.length}`);
  }
  if (username) {
    params.push(String(username).toLowerCase());
    where.push(`lower(u.username) = $${params.length}`);
  }
  if (eventType) {
    params.push(String(eventType).toLowerCase());
    where.push(`l.event_type = $${params.length}`);
  }
  if (page) {
    params.push(`%${String(page).toLowerCase()}%`);
    where.push(`lower(COALESCE(l.page, '')) LIKE $${params.length}`);
  }
  if (sessionId) {
    params.push(String(sessionId));
    where.push(`l.session_id = $${params.length}`);
  }
  appendDateRange(where, params, from, to);
  if (q) {
    params.push(`%${String(q).toLowerCase()}%`);
    where.push(
      `(lower(u.username) LIKE $${params.length}
        OR lower(COALESCE(u.full_name, '')) LIKE $${params.length}
        OR lower(COALESCE(l.page, '')) LIKE $${params.length}
        OR lower(COALESCE(l.action_name, '')) LIKE $${params.length}
        OR lower(COALESCE(l.page_title, '')) LIKE $${params.length})`
    );
  }

  const w = where.join(' AND ');
  const groupMode = String(groupBy || 'name').toLowerCase();
  const grouped =
    groupMode === 'name' ||
    groupMode === 'user' ||
    groupMode === 'username' ||
    groupMode === '1' ||
    groupMode === 'true';

  if (grouped) {
    return listLogsGroupedByName({
      whereSql: w,
      params: [...params],
      pageNum,
      pageSize,
      logsPerUser,
    });
  }

  const limit = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const offset = (Math.max(Number(pageNum) || 1, 1) - 1) * limit;

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM user_activity_log l
    JOIN app_user u ON u.id = l.user_id
    WHERE ${w}
  `;
  const { rows: countRows } = await query(countSql, params);
  const total = countRows[0]?.total || 0;

  const listParams = [...params, limit, offset];
  const { rows } = await query(
    `
    SELECT l.*, u.username, u.full_name
    FROM user_activity_log l
    JOIN app_user u ON u.id = l.user_id
    WHERE ${w}
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT $${listParams.length - 1} OFFSET $${listParams.length}
    `,
    listParams
  );

  return {
    group_by: null,
    total,
    page: Math.max(Number(pageNum) || 1, 1),
    page_size: limit,
    count: rows.length,
    logs: rows.map(mapRow),
    groups: [],
  };
}

/**
 * Paginate by user (name), each group includes recent activity logs.
 */
async function listLogsGroupedByName({
  whereSql,
  params,
  pageNum = 1,
  pageSize = 25,
  logsPerUser = 0,
} = {}) {
  const limit = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
  const offset = (Math.max(Number(pageNum) || 1, 1) - 1) * limit;
  const perUser = Math.min(Math.max(Number(logsPerUser) || 0, 0), 100);

  const { rows: countRows } = await query(
    `
    SELECT COUNT(*)::int AS total
    FROM (
      SELECT l.user_id
      FROM user_activity_log l
      JOIN app_user u ON u.id = l.user_id
      WHERE ${whereSql}
      GROUP BY l.user_id
    ) t
    `,
    params
  );
  const total = countRows[0]?.total || 0;

  const userParams = [...params, limit, offset];
  const { rows: users } = await query(
    `
    SELECT u.id AS user_id,
           u.username,
           u.full_name,
           COALESCE(NULLIF(trim(u.full_name), ''), u.username) AS name,
           COUNT(*)::int AS event_count,
           COUNT(*) FILTER (WHERE l.event_type IN ('page_view','dashboard_view'))::int AS page_views,
           COUNT(*) FILTER (WHERE l.event_type = 'page_leave')::int AS page_leaves,
           COUNT(*) FILTER (WHERE l.event_type = 'action')::int AS actions,
           COUNT(*) FILTER (WHERE l.event_type = 'login')::int AS logins,
           COALESCE(SUM(l.duration_ms) FILTER (
             WHERE l.event_type IN ('page_leave','page_heartbeat')
           ), 0)::bigint AS duration_ms,
           MAX(l.created_at) AS last_activity_at,
           MIN(l.created_at) AS first_activity_at
    FROM user_activity_log l
    JOIN app_user u ON u.id = l.user_id
    WHERE ${whereSql}
    GROUP BY u.id, u.username, u.full_name
    ORDER BY MAX(l.created_at) DESC, COUNT(*) DESC
    LIMIT $${userParams.length - 1} OFFSET $${userParams.length}
    `,
    userParams
  );

  const groups = [];
  for (const u of users) {
    let logRows = [];
    if (perUser > 0) {
      const logParams = [...params, Number(u.user_id), perUser];
      const res = await query(
        `
        SELECT l.*, u.username, u.full_name
        FROM user_activity_log l
        JOIN app_user u ON u.id = l.user_id
        WHERE ${whereSql}
          AND l.user_id = $${logParams.length - 1}
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT $${logParams.length}
        `,
        logParams
      );
      logRows = res.rows;
    }

    const durationMs = Number(u.duration_ms || 0);
    groups.push({
      user_id: Number(u.user_id),
      username: u.username,
      full_name: u.full_name || null,
      name: u.name,
      event_count: u.event_count,
      page_views: u.page_views,
      page_leaves: u.page_leaves,
      actions: u.actions,
      logins: u.logins,
      duration_ms: durationMs,
      duration_sec: Math.round(durationMs / 1000),
      duration_min: Number((durationMs / 60000).toFixed(2)),
      last_activity_at: u.last_activity_at,
      first_activity_at: u.first_activity_at,
      // Detail URL for FE click-through
      logs_url: `/api/admin/user-logs/user/${u.user_id}`,
      logs_count: logRows.length,
      logs: logRows.map(mapRow),
    });
  }

  return {
    group_by: 'name',
    total,
    total_users: total,
    page: Math.max(Number(pageNum) || 1, 1),
    page_size: limit,
    count: groups.length,
    logs_per_user: perUser,
    logs: [],
    users: groups,
    groups,
    by_user: groups,
  };
}

/**
 * Flat activity log for one user (after click on name in list).
 */
async function listLogsForUser(userId, opts = {}) {
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) {
    throw httpError(400, 'Valid user_id required');
  }

  const { rows: userRows } = await query(
    `
    SELECT id, username, full_name,
           COALESCE(NULLIF(trim(full_name), ''), username) AS name
    FROM app_user
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );
  if (!userRows[0]) throw httpError(404, `User not found: ${id}`);

  const data = await listLogs({
    ...opts,
    userId: id,
    groupBy: 'none',
    pageNum: opts.pageNum || 1,
    pageSize: opts.pageSize || 50,
  });

  const time = await timeSummary({
    userId: id,
    from: opts.from,
    to: opts.to,
    source: opts.timeSource || 'leave',
  });

  const u = userRows[0];
  return {
    user: {
      user_id: Number(u.id),
      username: u.username,
      full_name: u.full_name || null,
      name: u.name,
      ...formatDurationMs(time.totals.duration_ms),
    },
    time_summary: time.totals,
    time_by_page: time.by_page,
    time_by_day: time.by_day,
    ...data,
  };
}

/**
 * Aggregate time spent + activity by user / page for admin dashboard.
 */
async function summary({ from, to, userId, username, q } = {}) {
  const where = ['1=1'];
  const params = [];
  appendDateRange(where, params, from, to);
  if (userId) {
    params.push(Number(userId));
    where.push(`l.user_id = $${params.length}`);
  }
  if (username) {
    params.push(String(username).toLowerCase());
    where.push(`lower(u.username) = $${params.length}`);
  }
  if (q) {
    params.push(`%${String(q).toLowerCase()}%`);
    where.push(
      `(lower(u.username) LIKE $${params.length}
        OR lower(COALESCE(u.full_name, '')) LIKE $${params.length})`
    );
  }
  const w = where.join(' AND ');
  const joinUser = 'JOIN app_user u ON u.id = l.user_id';

  const { rows: byUser } = await query(
    `
    SELECT u.id AS user_id, u.username, u.full_name,
           COALESCE(NULLIF(trim(u.full_name), ''), u.username) AS name,
           COUNT(*)::int AS event_count,
           COUNT(*) FILTER (WHERE l.event_type IN ('page_view','dashboard_view'))::int AS page_views,
           COUNT(*) FILTER (WHERE l.event_type = 'page_leave')::int AS page_leaves,
           COUNT(*) FILTER (WHERE l.event_type = 'action')::int AS actions,
           COUNT(*) FILTER (WHERE l.event_type = 'login')::int AS logins,
           COUNT(*) FILTER (WHERE l.event_type = 'logout')::int AS logouts,
           COALESCE(SUM(l.duration_ms) FILTER (
             WHERE l.event_type IN ('page_leave','page_heartbeat')
           ), 0)::bigint AS duration_ms,
           MAX(l.created_at) AS last_activity_at,
           MIN(l.created_at) AS first_activity_at
    FROM user_activity_log l
    ${joinUser}
    WHERE ${w}
    GROUP BY u.id, u.username, u.full_name
    ORDER BY duration_ms DESC, event_count DESC, name
    LIMIT 200
    `,
    params
  );

  const { rows: byPage } = await query(
    `
    SELECT COALESCE(l.page, '(unknown)') AS page,
           COUNT(*) FILTER (WHERE l.event_type IN ('page_view','dashboard_view'))::int AS page_views,
           COUNT(*) FILTER (WHERE l.event_type = 'action')::int AS actions,
           COALESCE(SUM(l.duration_ms) FILTER (
             WHERE l.event_type IN ('page_leave','page_heartbeat')
           ), 0)::bigint AS duration_ms
    FROM user_activity_log l
    ${joinUser}
    WHERE ${w}
    GROUP BY COALESCE(l.page, '(unknown)')
    ORDER BY duration_ms DESC, page_views DESC
    LIMIT 50
    `,
    params
  );

  const { rows: byEvent } = await query(
    `
    SELECT l.event_type,
           COUNT(*)::int AS count
    FROM user_activity_log l
    ${joinUser}
    WHERE ${w}
    GROUP BY l.event_type
    ORDER BY count DESC
    `,
    params
  );

  const { rows: totals } = await query(
    `
    SELECT COUNT(*)::int AS total_events,
           COUNT(DISTINCT l.user_id)::int AS unique_users,
           COUNT(DISTINCT l.session_id)::int AS sessions,
           COALESCE(SUM(l.duration_ms) FILTER (
             WHERE l.event_type IN ('page_leave','page_heartbeat')
           ), 0)::bigint AS duration_ms
    FROM user_activity_log l
    ${joinUser}
    WHERE ${w}
    `,
    params
  );

  const t = totals[0] || {};
  const users = byUser.map((r) => {
    const durationMs = Number(r.duration_ms || 0);
    return {
      user_id: Number(r.user_id),
      username: r.username,
      full_name: r.full_name || null,
      name: r.name,
      event_count: r.event_count,
      page_views: r.page_views,
      page_leaves: r.page_leaves,
      actions: r.actions,
      logins: r.logins,
      logouts: r.logouts,
      duration_ms: durationMs,
      duration_sec: Math.round(durationMs / 1000),
      duration_min: Number((durationMs / 60000).toFixed(2)),
      last_activity_at: r.last_activity_at,
      first_activity_at: r.first_activity_at,
    };
  });

  return {
    group_by: 'name',
    totals: {
      total_events: t.total_events || 0,
      unique_users: t.unique_users || 0,
      sessions: t.sessions || 0,
      ...formatDurationMs(t.duration_ms),
    },
    time_summary: formatDurationMs(t.duration_ms),
    // Primary: grouped by display name
    users: users.map((u) => withDurationFields(u)),
    by_user: users.map((u) => withDurationFields(u)),
    groups: users.map((u) => withDurationFields(u)),
    by_page: byPage.map((r) =>
      withDurationFields({
        page: r.page,
        page_views: r.page_views,
        actions: r.actions,
        duration_ms: Number(r.duration_ms || 0),
      })
    ),
    by_event_type: byEvent.map((r) => ({
      event_type: r.event_type,
      count: r.count,
    })),
  };
}

function formatDurationMs(ms) {
  const n = Math.max(0, Math.round(Number(ms) || 0));
  const totalSec = Math.floor(n / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return {
    duration_ms: n,
    duration_sec: totalSec,
    duration_min: Number((n / 60000).toFixed(2)),
    duration_hours: Number((n / 3600000).toFixed(2)),
    duration_display: `${hh}:${mm}:${ss}`,
    duration_label:
      h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`,
  };
}

function durationEventSql(source = 'leave') {
  const s = String(source || 'leave').toLowerCase();
  if (s === 'all' || s === 'both') {
    return `l.event_type IN ('page_leave','page_heartbeat')`;
  }
  if (s === 'heartbeat' || s === 'ping') {
    return `l.event_type = 'page_heartbeat'`;
  }
  return `l.event_type = 'page_leave'`;
}

function withDurationFields(row) {
  const ms = Number(row.duration_ms || 0);
  return { ...row, ...formatDurationMs(ms) };
}

/**
 * Dedicated time summary — by user / page / day.
 * Default source=leave (page_leave only) to avoid double-counting heartbeats.
 */
async function timeSummary({
  from,
  to,
  userId,
  username,
  q,
  source = 'leave',
} = {}) {
  const where = ['1=1'];
  const params = [];
  appendDateRange(where, params, from, to);
  if (userId) {
    params.push(Number(userId));
    where.push(`l.user_id = $${params.length}`);
  }
  if (username) {
    params.push(String(username).toLowerCase());
    where.push(`lower(u.username) = $${params.length}`);
  }
  if (q) {
    params.push(`%${String(q).toLowerCase()}%`);
    where.push(
      `(lower(u.username) LIKE $${params.length}
        OR lower(COALESCE(u.full_name, '')) LIKE $${params.length}
        OR lower(COALESCE(l.page, '')) LIKE $${params.length})`
    );
  }
  const w = where.join(' AND ');
  const durFilter = durationEventSql(source);
  const joinUser = 'JOIN app_user u ON u.id = l.user_id';
  const srcNorm =
    String(source || 'leave').toLowerCase() === 'all'
      ? 'all'
      : String(source || 'leave').toLowerCase() === 'heartbeat'
        ? 'heartbeat'
        : 'leave';

  const { rows: totalsRows } = await query(
    `
    SELECT COUNT(DISTINCT l.user_id)::int AS unique_users,
           COUNT(*) FILTER (WHERE ${durFilter})::int AS timed_events,
           COALESCE(SUM(l.duration_ms) FILTER (WHERE ${durFilter}), 0)::bigint AS duration_ms,
           COUNT(*) FILTER (WHERE l.event_type IN ('page_view','dashboard_view'))::int AS page_views,
           COUNT(*) FILTER (WHERE l.event_type = 'action')::int AS actions
    FROM user_activity_log l
    ${joinUser}
    WHERE ${w}
    `,
    params
  );

  const { rows: byUser } = await query(
    `
    SELECT u.id AS user_id, u.username, u.full_name,
           COALESCE(NULLIF(trim(u.full_name), ''), u.username) AS name,
           COUNT(*) FILTER (WHERE ${durFilter})::int AS timed_events,
           COALESCE(SUM(l.duration_ms) FILTER (WHERE ${durFilter}), 0)::bigint AS duration_ms,
           COUNT(*) FILTER (WHERE l.event_type IN ('page_view','dashboard_view'))::int AS page_views,
           COUNT(*) FILTER (WHERE l.event_type = 'action')::int AS actions,
           MAX(l.created_at) AS last_activity_at
    FROM user_activity_log l
    ${joinUser}
    WHERE ${w}
    GROUP BY u.id, u.username, u.full_name
    ORDER BY duration_ms DESC, name
    LIMIT 200
    `,
    params
  );

  const { rows: byPage } = await query(
    `
    SELECT COALESCE(l.page, '(unknown)') AS page,
           COUNT(*) FILTER (WHERE ${durFilter})::int AS timed_events,
           COALESCE(SUM(l.duration_ms) FILTER (WHERE ${durFilter}), 0)::bigint AS duration_ms,
           COUNT(*) FILTER (WHERE l.event_type IN ('page_view','dashboard_view'))::int AS page_views,
           COUNT(*) FILTER (WHERE l.event_type = 'action')::int AS actions
    FROM user_activity_log l
    ${joinUser}
    WHERE ${w}
    GROUP BY COALESCE(l.page, '(unknown)')
    ORDER BY duration_ms DESC, page_views DESC
    LIMIT 50
    `,
    params
  );

  const { rows: byDay } = await query(
    `
    SELECT (l.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
           COUNT(DISTINCT l.user_id)::int AS unique_users,
           COALESCE(SUM(l.duration_ms) FILTER (WHERE ${durFilter}), 0)::bigint AS duration_ms,
           COUNT(*) FILTER (WHERE l.event_type IN ('page_view','dashboard_view'))::int AS page_views,
           COUNT(*) FILTER (WHERE l.event_type = 'action')::int AS actions
    FROM user_activity_log l
    ${joinUser}
    WHERE ${w}
    GROUP BY (l.created_at AT TIME ZONE 'Asia/Kolkata')::date
    ORDER BY day DESC
    LIMIT 62
    `,
    params
  );

  const t = totalsRows[0] || {};
  const totals = {
    unique_users: t.unique_users || 0,
    timed_events: t.timed_events || 0,
    page_views: t.page_views || 0,
    actions: t.actions || 0,
    ...formatDurationMs(t.duration_ms),
  };

  const users = byUser.map((r) =>
    withDurationFields({
      user_id: Number(r.user_id),
      username: r.username,
      full_name: r.full_name || null,
      name: r.name,
      timed_events: r.timed_events,
      page_views: r.page_views,
      actions: r.actions,
      last_activity_at: r.last_activity_at,
      logs_url: `/api/admin/user-logs/user/${r.user_id}`,
      time_url: `/api/admin/user-logs/time-summary?user_id=${r.user_id}`,
      duration_ms: Number(r.duration_ms || 0),
    })
  );

  return {
    source: srcNorm,
    note:
      'Default source=leave uses page_leave only (recommended). Use source=all to include heartbeats.',
    totals,
    time_summary: totals,
    users,
    by_user: users,
    by_page: byPage.map((r) =>
      withDurationFields({
        page: r.page,
        timed_events: r.timed_events,
        page_views: r.page_views,
        actions: r.actions,
        duration_ms: Number(r.duration_ms || 0),
      })
    ),
    by_day: byDay.map((r) =>
      withDurationFields({
        day: r.day,
        unique_users: r.unique_users,
        page_views: r.page_views,
        actions: r.actions,
        duration_ms: Number(r.duration_ms || 0),
      })
    ),
  };
}

module.exports = {
  ALLOWED_EVENTS,
  logEvents,
  logActivitySafe,
  listLogs,
  listLogsForUser,
  summary,
  timeSummary,
};
