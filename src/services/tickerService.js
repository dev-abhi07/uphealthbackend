/**
 * Ticker / marquee notifications per sub-dashboard.
 * Admin CRUD: system_admin. Public read: any authenticated user.
 */
const { query } = require('../db/pool');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function truthy(v, defaultValue = true) {
  if (v === undefined || v === null || v === '') return defaultValue;
  return v === true || v === 'true' || v === 1 || v === '1';
}

function mapRow(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    dashboard_code: r.dashboard_code,
    dashboard_name: r.dashboard_name || null,
    message: r.message,
    is_active: Boolean(r.is_active),
    starts_at: r.starts_at || null,
    ends_at: r.ends_at || null,
    created_by: r.created_by != null ? Number(r.created_by) : null,
    updated_by: r.updated_by != null ? Number(r.updated_by) : null,
    created_by_username: r.created_by_username || null,
    updated_by_username: r.updated_by_username || null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

async function listDashboards({ activeOnly = true } = {}) {
  const { rows } = await query(
    `
    SELECT code, name, sort_order, is_active
    FROM ticker_dashboard
    WHERE ($1::boolean IS FALSE OR is_active = TRUE)
    ORDER BY sort_order, name
    `,
    [activeOnly]
  );
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    value: r.code,
    label: r.name,
    sort_order: Number(r.sort_order),
    is_active: Boolean(r.is_active),
  }));
}

async function assertDashboard(code) {
  const key = String(code || '').trim().toLowerCase();
  if (!key) throw httpError(400, 'dashboard_code is required');
  const { rows } = await query(
    `SELECT code, name FROM ticker_dashboard WHERE code = $1 AND is_active = TRUE LIMIT 1`,
    [key]
  );
  if (!rows[0]) {
    throw httpError(
      400,
      `Unknown dashboard_code "${code}". Use GET /api/admin/ticker-dashboards`
    );
  }
  return rows[0];
}

/**
 * Active tickers for marquee (public read).
 * Filters: is_active + optional schedule window.
 */
async function listActiveTickers({ dashboardCode } = {}) {
  const code = dashboardCode ? String(dashboardCode).trim().toLowerCase() : null;
  const params = [];
  let where = `
    t.is_active = TRUE
    AND (t.starts_at IS NULL OR t.starts_at <= NOW())
    AND (t.ends_at IS NULL OR t.ends_at >= NOW())
  `;
  if (code) {
    params.push(code);
    where += ` AND t.dashboard_code = $${params.length}`;
  }
  const { rows } = await query(
    `
    SELECT t.*, d.name AS dashboard_name
    FROM ticker_notification t
    JOIN ticker_dashboard d ON d.code = t.dashboard_code
    WHERE ${where}
      AND d.is_active = TRUE
    ORDER BY t.updated_at DESC, t.id DESC
    `,
    params
  );
  return rows.map(mapRow);
}

/**
 * Admin list (includes inactive).
 */
async function listTickersAdmin({
  dashboardCode,
  isActive,
  q,
  page = 1,
  pageSize = 50,
} = {}) {
  const params = [];
  const where = ['1=1'];

  if (dashboardCode) {
    params.push(String(dashboardCode).trim().toLowerCase());
    where.push(`t.dashboard_code = $${params.length}`);
  }
  if (isActive !== undefined && isActive !== null && isActive !== '') {
    params.push(truthy(isActive, true));
    where.push(`t.is_active = $${params.length}`);
  }
  if (q && String(q).trim()) {
    params.push(`%${String(q).trim()}%`);
    where.push(`t.message ILIKE $${params.length}`);
  }

  const limit = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
  params.push(limit, offset);

  const { rows } = await query(
    `
    SELECT t.*,
           d.name AS dashboard_name,
           cu.username AS created_by_username,
           uu.username AS updated_by_username,
           COUNT(*) OVER()::int AS total_count
    FROM ticker_notification t
    JOIN ticker_dashboard d ON d.code = t.dashboard_code
    LEFT JOIN app_user cu ON cu.id = t.created_by
    LEFT JOIN app_user uu ON uu.id = t.updated_by
    WHERE ${where.join(' AND ')}
    ORDER BY t.updated_at DESC, t.id DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
    `,
    params
  );

  const total = rows[0] ? Number(rows[0].total_count) : 0;
  return {
    page: Math.max(Number(page) || 1, 1),
    page_size: limit,
    total,
    tickers: rows.map(mapRow),
  };
}

async function getTickerById(id) {
  const { rows } = await query(
    `
    SELECT t.*, d.name AS dashboard_name,
           cu.username AS created_by_username,
           uu.username AS updated_by_username
    FROM ticker_notification t
    JOIN ticker_dashboard d ON d.code = t.dashboard_code
    LEFT JOIN app_user cu ON cu.id = t.created_by
    LEFT JOIN app_user uu ON uu.id = t.updated_by
    WHERE t.id = $1
    LIMIT 1
    `,
    [Number(id)]
  );
  if (!rows[0]) throw httpError(404, 'Ticker not found');
  return mapRow(rows[0]);
}

async function createTicker(body = {}, actorUserId = null) {
  const dashboard = await assertDashboard(
    body.dashboard_code || body.dashboard || body.dashboard_id
  );
  const message = String(body.message || '').trim();
  if (!message) throw httpError(400, 'message is required');

  const isActive = truthy(body.is_active, true);
  const startsAt = body.starts_at || body.start_at || null;
  const endsAt = body.ends_at || body.end_at || null;

  const { rows } = await query(
    `
    INSERT INTO ticker_notification (
      dashboard_code, message, is_active, starts_at, ends_at, created_by, updated_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $6)
    RETURNING id
    `,
    [
      dashboard.code,
      message,
      isActive,
      startsAt,
      endsAt,
      actorUserId != null ? Number(actorUserId) : null,
    ]
  );
  return getTickerById(rows[0].id);
}

async function updateTicker(id, body = {}, actorUserId = null) {
  const existing = await getTickerById(id);
  let dashboardCode = existing.dashboard_code;
  if (body.dashboard_code || body.dashboard || body.dashboard_id) {
    const d = await assertDashboard(
      body.dashboard_code || body.dashboard || body.dashboard_id
    );
    dashboardCode = d.code;
  }

  const message =
    body.message !== undefined ? String(body.message || '').trim() : existing.message;
  if (!message) throw httpError(400, 'message cannot be empty');

  const isActive =
    body.is_active !== undefined ? truthy(body.is_active, true) : existing.is_active;
  const startsAt =
    body.starts_at !== undefined || body.start_at !== undefined
      ? body.starts_at || body.start_at || null
      : existing.starts_at;
  const endsAt =
    body.ends_at !== undefined || body.end_at !== undefined
      ? body.ends_at || body.end_at || null
      : existing.ends_at;

  await query(
    `
    UPDATE ticker_notification
    SET dashboard_code = $2,
        message = $3,
        is_active = $4,
        starts_at = $5,
        ends_at = $6,
        updated_by = $7,
        updated_at = NOW()
    WHERE id = $1
    `,
    [
      Number(id),
      dashboardCode,
      message,
      isActive,
      startsAt,
      endsAt,
      actorUserId != null ? Number(actorUserId) : null,
    ]
  );
  return getTickerById(id);
}

async function deleteTicker(id, { soft = true } = {}) {
  await getTickerById(id);
  if (soft) {
    await query(
      `
      UPDATE ticker_notification
      SET is_active = FALSE, updated_at = NOW()
      WHERE id = $1
      `,
      [Number(id)]
    );
    return { id: Number(id), deleted: true, soft: true };
  }
  await query(`DELETE FROM ticker_notification WHERE id = $1`, [Number(id)]);
  return { id: Number(id), deleted: true, soft: false };
}

module.exports = {
  listDashboards,
  listActiveTickers,
  listTickersAdmin,
  getTickerById,
  createTicker,
  updateTicker,
  deleteTicker,
};
