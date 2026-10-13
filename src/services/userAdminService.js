/**
 * Admin user management — system_admin only (not state_admin).
 * Create / list / update users with role + geo assignment for panel.
 */
const bcrypt = require('bcryptjs');
const { query, pool } = require('../db/pool');

const MANAGEABLE_ROLES = new Set([
  'system_admin',
  'state_admin',
  'division_viewer',
  'district_viewer',
  'block_viewer',
]);

const STATEWIDE_ROLES = new Set(['system_admin', 'state_admin']);

/** Friendly labels for panel (codes stay stable for JWT / geo scope). */
const ROLE_LABELS = {
  system_admin: 'System Admin',
  state_admin: 'State',
  division_viewer: 'Division',
  district_viewer: 'District',
  block_viewer: 'Block',
};

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalizeUsername(username) {
  return String(username || '')
    .trim()
    .toLowerCase();
}

function roleNeedsGeo(roleCode) {
  return !STATEWIDE_ROLES.has(String(roleCode || '').toLowerCase());
}

function expectedGeoLevel(roleCode) {
  const c = String(roleCode || '').toLowerCase();
  if (c === 'division_viewer' || c === 'division') return 'division';
  if (c === 'district_viewer' || c === 'district') return 'district';
  if (c === 'block_viewer' || c === 'block') return 'block';
  return null;
}

/** Accept panel aliases: state → state_admin, division → division_viewer, etc. */
function normalizeRoleCode(roleCode) {
  const c = String(roleCode || '')
    .trim()
    .toLowerCase();
  const aliases = {
    system: 'system_admin',
    system_admin: 'system_admin',
    admin: 'system_admin',
    state: 'state_admin',
    state_admin: 'state_admin',
    division: 'division_viewer',
    division_viewer: 'division_viewer',
    district: 'district_viewer',
    district_viewer: 'district_viewer',
    block: 'block_viewer',
    block_viewer: 'block_viewer',
  };
  return aliases[c] || c;
}

/**
 * Resolve and validate geo payload for a role.
 * Accepts ids and/or names / LGD codes.
 */
async function resolveGeoForRole(roleCode, geoInput = {}) {
  const role = String(roleCode || '').toLowerCase();
  if (STATEWIDE_ROLES.has(role)) {
    return null;
  }

  const wantLevel = expectedGeoLevel(role);
  if (!wantLevel) {
    throw httpError(400, `Role ${roleCode} is not assignable via admin panel`);
  }

  const raw = geoInput || {};
  let geoLevel = String(raw.geo_level || wantLevel).toLowerCase();
  if (geoLevel !== wantLevel) {
    throw httpError(
      400,
      `Role ${roleCode} requires geo_level=${wantLevel} (got ${geoLevel})`
    );
  }

  let divisionId = raw.division_id != null ? Number(raw.division_id) : null;
  let districtId = raw.district_id != null ? Number(raw.district_id) : null;
  let blockId = raw.block_id != null ? Number(raw.block_id) : null;

  if (wantLevel === 'division') {
    if (!divisionId && raw.division) {
      const { rows } = await query(
        `
        SELECT id FROM division
        WHERE is_active = TRUE AND (
          lower(trim(name)) = lower(trim($1))
          OR code::text = $1
          OR id::text = $1
        )
        LIMIT 1
        `,
        [String(raw.division)]
      );
      divisionId = rows[0] ? Number(rows[0].id) : null;
    }
    if (!divisionId) throw httpError(400, 'division_id (or division) is required');
    const { rows } = await query(
      `SELECT id FROM division WHERE id = $1 AND is_active = TRUE`,
      [divisionId]
    );
    if (!rows[0]) throw httpError(400, `Division not found: ${divisionId}`);
    return {
      geo_level: 'division',
      division_id: divisionId,
      district_id: null,
      block_id: null,
      facility_id: null,
    };
  }

  if (wantLevel === 'district') {
    if (!districtId && (raw.district || raw.district_lgd || raw.lgd)) {
      const key = String(raw.district || raw.district_lgd || raw.lgd);
      const { rows } = await query(
        `
        SELECT id, division_id FROM district
        WHERE is_active = TRUE AND (
          lower(trim(name)) = lower(trim($1))
          OR lgd_code::text = $1
          OR id::text = $1
        )
        LIMIT 1
        `,
        [key]
      );
      if (rows[0]) {
        districtId = Number(rows[0].id);
        if (!divisionId) divisionId = Number(rows[0].division_id);
      }
    }
    if (!districtId) throw httpError(400, 'district_id (or district) is required');
    const { rows } = await query(
      `SELECT id, division_id FROM district WHERE id = $1 AND is_active = TRUE`,
      [districtId]
    );
    if (!rows[0]) throw httpError(400, `District not found: ${districtId}`);
    divisionId = divisionId || Number(rows[0].division_id);
    return {
      geo_level: 'district',
      division_id: divisionId,
      district_id: districtId,
      block_id: null,
      facility_id: null,
    };
  }

  // block
  if (!blockId && (raw.block || raw.block_lgd || raw.lgd)) {
    const key = String(raw.block || raw.block_lgd || raw.lgd);
    const { rows } = await query(
      `
      SELECT b.id, b.district_id, d.division_id
      FROM block b
      JOIN district d ON d.id = b.district_id
      WHERE b.is_active = TRUE AND (
        lower(trim(b.name)) = lower(trim($1))
        OR lower(replace(trim(b.name), ' ', '-')) = lower(replace(trim($1), ' ', '-'))
        OR b.lgd_code::text = $1
        OR b.id::text = $1
      )
      LIMIT 1
      `,
      [key]
    );
    if (rows[0]) {
      blockId = Number(rows[0].id);
      districtId = districtId || Number(rows[0].district_id);
      divisionId = divisionId || Number(rows[0].division_id);
    }
  }
  if (!blockId) throw httpError(400, 'block_id (or block / block_lgd) is required');
  const { rows } = await query(
    `
    SELECT b.id, b.district_id, d.division_id
    FROM block b
    JOIN district d ON d.id = b.district_id
    WHERE b.id = $1 AND b.is_active = TRUE
    `,
    [blockId]
  );
  if (!rows[0]) throw httpError(400, `Block not found: ${blockId}`);
  return {
    geo_level: 'block',
    division_id: divisionId || Number(rows[0].division_id),
    district_id: districtId || Number(rows[0].district_id),
    block_id: blockId,
    facility_id: null,
  };
}

async function listRoles() {
  const { rows } = await query(
    `
    SELECT code, name, is_active
    FROM role
    WHERE code = ANY($1::text[])
    ORDER BY
      CASE code
        WHEN 'system_admin' THEN 0
        WHEN 'state_admin' THEN 1
        WHEN 'division_viewer' THEN 2
        WHEN 'district_viewer' THEN 3
        WHEN 'block_viewer' THEN 4
        ELSE 9
      END
    `,
    [[...MANAGEABLE_ROLES]]
  );
  return rows.map((r) => ({
    code: r.code,
    name: ROLE_LABELS[r.code] || r.name,
    needs_geo: roleNeedsGeo(r.code),
    geo_level: expectedGeoLevel(r.code),
  }));
}

async function listGeoOptions({ divisionId, districtId } = {}) {
  if (districtId) {
    const { rows } = await query(
      `
      SELECT b.id, b.name, b.lgd_code, b.district_id, d.name AS district_name
      FROM block b
      JOIN district d ON d.id = b.district_id
      WHERE b.is_active = TRUE AND b.district_id = $1
      ORDER BY b.name
      `,
      [Number(districtId)]
    );
    return {
      level: 'block',
      items: rows.map((r) => ({
        id: Number(r.id),
        name: r.name,
        lgd_code: r.lgd_code != null ? String(r.lgd_code) : null,
        district_id: Number(r.district_id),
        district_name: r.district_name,
      })),
    };
  }
  if (divisionId) {
    const { rows } = await query(
      `
      SELECT d.id, d.name, d.lgd_code, d.division_id, dv.name AS division_name
      FROM district d
      JOIN division dv ON dv.id = d.division_id
      WHERE d.is_active = TRUE AND d.division_id = $1
      ORDER BY d.name
      `,
      [Number(divisionId)]
    );
    return {
      level: 'district',
      items: rows.map((r) => ({
        id: Number(r.id),
        name: r.name,
        lgd_code: r.lgd_code != null ? String(r.lgd_code) : null,
        division_id: Number(r.division_id),
        division_name: r.division_name,
      })),
    };
  }
  const { rows } = await query(
    `
    SELECT id, name, code
    FROM division
    WHERE is_active = TRUE
    ORDER BY name
    `
  );
  return {
    level: 'division',
    items: rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      code: r.code != null ? String(r.code) : null,
    })),
  };
}

async function getUserById(userId, { includeInactive = true } = {}) {
  const { rows } = await query(
    `
    SELECT id, username, full_name, email, mobile, is_active, last_login_at, created_at, updated_at
    FROM app_user WHERE id = $1
    `,
    [userId]
  );
  const user = rows[0];
  if (!user) throw httpError(404, 'User not found');
  if (!includeInactive && !user.is_active) throw httpError(404, 'User not found');

  const roles = await query(
    `
    SELECT r.code, r.name
    FROM user_role ur
    JOIN role r ON r.id = ur.role_id
    WHERE ur.user_id = $1
    ORDER BY r.code
    `,
    [userId]
  );
  const geo = await query(
    `
    SELECT
      uga.id, uga.geo_level, uga.division_id, uga.district_id, uga.block_id, uga.facility_id,
      uga.is_active,
      dv.name AS division_name, dv.code AS division_code,
      d.name AS district_name, d.lgd_code AS district_lgd,
      b.name AS block_name, b.lgd_code AS block_lgd
    FROM user_geo_assignment uga
    LEFT JOIN division dv ON dv.id = uga.division_id
    LEFT JOIN district d ON d.id = uga.district_id
    LEFT JOIN block b ON b.id = uga.block_id
    WHERE uga.user_id = $1
    ORDER BY uga.id
    `,
    [userId]
  );

  const roleCodes = roles.rows.map((r) => r.code);
  const primaryRole = roleCodes[0] || null;
  return {
    id: Number(user.id),
    username: user.username,
    full_name: user.full_name,
    email: user.email,
    mobile: user.mobile,
    is_active: !!user.is_active,
    roles: roles.rows.map((r) => ({
      code: r.code,
      name: ROLE_LABELS[r.code] || r.name,
    })),
    role: primaryRole,
    role_name: primaryRole ? ROLE_LABELS[primaryRole] || primaryRole : null,
    geo_assignments: geo.rows.map((g) => ({
      id: Number(g.id),
      geo_level: g.geo_level,
      division_id: g.division_id != null ? Number(g.division_id) : null,
      division_name: g.division_name,
      division_code: g.division_code != null ? String(g.division_code) : null,
      district_id: g.district_id != null ? Number(g.district_id) : null,
      district_name: g.district_name,
      district_lgd: g.district_lgd != null ? String(g.district_lgd) : null,
      block_id: g.block_id != null ? Number(g.block_id) : null,
      block_name: g.block_name,
      block_lgd: g.block_lgd != null ? String(g.block_lgd) : null,
      is_active: !!g.is_active,
    })),
    last_login_at: user.last_login_at,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

async function listUsers({
  q,
  role,
  geoLevel,
  isActive,
  page = 1,
  pageSize = 20,
} = {}) {
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);
  const offset = (pageNum - 1) * limit;
  const params = [];
  const where = [];

  const search = q != null && String(q).trim() !== '' ? String(q).trim() : null;
  if (search) {
    params.push(`%${search}%`);
    const p = `$${params.length}`;
    where.push(`(
      u.username ILIKE ${p}
      OR COALESCE(u.full_name, '') ILIKE ${p}
      OR COALESCE(u.email, '') ILIKE ${p}
      OR COALESCE(u.mobile, '') ILIKE ${p}
      OR EXISTS (
        SELECT 1 FROM user_role ur
        JOIN role r ON r.id = ur.role_id
        WHERE ur.user_id = u.id
          AND (r.code ILIKE ${p} OR r.name ILIKE ${p})
      )
      OR EXISTS (
        SELECT 1 FROM user_geo_assignment uga
        LEFT JOIN division dv ON dv.id = uga.division_id
        LEFT JOIN district d ON d.id = uga.district_id
        LEFT JOIN block b ON b.id = uga.block_id
        WHERE uga.user_id = u.id AND uga.is_active = TRUE
          AND (
            COALESCE(dv.name, '') ILIKE ${p}
            OR COALESCE(d.name, '') ILIKE ${p}
            OR COALESCE(b.name, '') ILIKE ${p}
            OR COALESCE(d.lgd_code::text, '') ILIKE ${p}
            OR COALESCE(b.lgd_code::text, '') ILIKE ${p}
          )
      )
    )`);
  }

  if (role) {
    const roleCode = normalizeRoleCode(role);
    params.push(roleCode);
    where.push(
      `EXISTS (
        SELECT 1 FROM user_role ur JOIN role r ON r.id = ur.role_id
        WHERE ur.user_id = u.id AND lower(r.code) = lower($${params.length})
      )`
    );
  }

  if (geoLevel) {
    const gl = String(geoLevel).toLowerCase();
    // Statewide roles have no geo row — treat geo_level=state as those users
    if (gl === 'state') {
      where.push(
        `EXISTS (
          SELECT 1 FROM user_role ur JOIN role r ON r.id = ur.role_id
          WHERE ur.user_id = u.id
            AND lower(r.code) IN ('system_admin', 'state_admin')
        )`
      );
    } else {
      params.push(gl);
      where.push(
        `EXISTS (
          SELECT 1 FROM user_geo_assignment uga
          WHERE uga.user_id = u.id AND uga.is_active AND lower(uga.geo_level) = $${params.length}
        )`
      );
    }
  }

  if (
    isActive === true ||
    isActive === false ||
    isActive === 'true' ||
    isActive === 'false' ||
    isActive === '1' ||
    isActive === '0'
  ) {
    const active =
      isActive === true || isActive === 'true' || isActive === '1';
    params.push(active);
    where.push(`u.is_active = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await query(
    `SELECT COUNT(*)::int AS n FROM app_user u ${whereSql}`,
    params
  );
  const total = countRes.rows[0]?.n || 0;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  params.push(limit);
  params.push(offset);
  const { rows } = await query(
    `
    SELECT u.id
    FROM app_user u
    ${whereSql}
    ORDER BY u.created_at DESC, u.id DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `,
    params
  );

  const items = [];
  for (const r of rows) {
    items.push(await getUserById(r.id));
  }

  return {
    total,
    page: pageNum,
    page_size: limit,
    total_pages: totalPages,
    has_next: pageNum < totalPages,
    has_prev: pageNum > 1 && totalPages > 0,
    search: search,
    filters: {
      role: role ? normalizeRoleCode(role) : null,
      geo_level: geoLevel ? String(geoLevel).toLowerCase() : null,
      is_active:
        isActive === undefined || isActive === null || isActive === ''
          ? null
          : isActive === true ||
            isActive === 'true' ||
            isActive === '1',
    },
    items,
  };
}

async function setUserRole(client, userId, roleCode) {
  const roleRes = await client.query(
    `SELECT id FROM role WHERE lower(code) = lower($1) AND is_active = TRUE`,
    [roleCode]
  );
  if (!roleRes.rows[0]) throw httpError(400, `Unknown or inactive role: ${roleCode}`);
  await client.query(`DELETE FROM user_role WHERE user_id = $1`, [userId]);
  await client.query(
    `INSERT INTO user_role (user_id, role_id) VALUES ($1, $2)`,
    [userId, roleRes.rows[0].id]
  );
}

async function setUserGeo(client, userId, geo) {
  await client.query(`DELETE FROM user_geo_assignment WHERE user_id = $1`, [userId]);
  if (!geo) return;
  await client.query(
    `
    INSERT INTO user_geo_assignment
      (user_id, geo_level, division_id, district_id, block_id, facility_id, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, TRUE)
    `,
    [
      userId,
      geo.geo_level,
      geo.division_id,
      geo.district_id,
      geo.block_id,
      geo.facility_id || null,
    ]
  );
}

async function createUser(body = {}, actorUserId = null) {
  const username = normalizeUsername(body.username);
  const password = body.password;
  const roleCode = normalizeRoleCode(body.role || body.role_code);
  const fullName = body.full_name || body.fullName || null;
  const email = body.email || null;
  const mobile = body.mobile || null;

  if (!username || username.length < 3) {
    throw httpError(400, 'username is required (min 3 characters)');
  }
  if (!/^[a-z0-9._-]+$/i.test(username)) {
    throw httpError(400, 'username may only contain letters, numbers, . _ -');
  }
  if (!password || String(password).length < 6) {
    throw httpError(400, 'password is required (min 6 characters)');
  }
  if (!roleCode || !MANAGEABLE_ROLES.has(roleCode)) {
    throw httpError(
      400,
      `role must be one of: ${[...MANAGEABLE_ROLES].join(', ')}`
    );
  }

  const existing = await query(
    `SELECT id FROM app_user WHERE lower(username) = lower($1)`,
    [username]
  );
  if (existing.rows[0]) throw httpError(409, `Username already exists: ${username}`);

  const geo = await resolveGeoForRole(roleCode, body.geo || body.geo_assignment || {});
  const hash = await bcrypt.hash(String(password), 10);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `
      INSERT INTO app_user (username, full_name, email, mobile, password_hash, is_active)
      VALUES ($1, $2, $3, $4, $5, TRUE)
      RETURNING id
      `,
      [username, fullName, email, mobile, hash]
    );
    const userId = Number(ins.rows[0].id);
    await setUserRole(client, userId, roleCode);
    await setUserGeo(client, userId, geo);
    await client.query('COMMIT');
    return getUserById(userId);
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

async function updateUser(userId, body = {}, actorUserId = null) {
  const id = Number(userId);
  if (!Number.isFinite(id)) throw httpError(400, 'Invalid user id');

  const current = await getUserById(id);
  if (actorUserId != null && Number(actorUserId) === id && body.is_active === false) {
    throw httpError(400, 'You cannot deactivate your own account');
  }

  const fullName =
    body.full_name !== undefined ? body.full_name : current.full_name;
  const email = body.email !== undefined ? body.email : current.email;
  const mobile = body.mobile !== undefined ? body.mobile : current.mobile;
  const isActive =
    body.is_active !== undefined
      ? body.is_active === true || body.is_active === 'true'
      : current.is_active;

  const roleCode = normalizeRoleCode(
    body.role || body.role_code || current.role || ''
  );
  if (!roleCode || !MANAGEABLE_ROLES.has(roleCode)) {
    throw httpError(
      400,
      `role must be one of: ${[...MANAGEABLE_ROLES].join(', ')}`
    );
  }

  let geoInput = body.geo !== undefined ? body.geo : body.geo_assignment;
  if (geoInput === undefined) {
    const g = current.geo_assignments.find((x) => x.is_active) || current.geo_assignments[0];
    geoInput = g
      ? {
          geo_level: g.geo_level,
          division_id: g.division_id,
          district_id: g.district_id,
          block_id: g.block_id,
        }
      : {};
  }
  const geo = await resolveGeoForRole(roleCode, geoInput || {});

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `
      UPDATE app_user
      SET full_name = $2, email = $3, mobile = $4, is_active = $5, updated_at = NOW()
      WHERE id = $1
      `,
      [id, fullName, email, mobile, isActive]
    );
    await setUserRole(client, id, roleCode);
    await setUserGeo(client, id, geo);

    if (body.password) {
      if (String(body.password).length < 6) {
        throw httpError(400, 'password must be at least 6 characters');
      }
      const hash = await bcrypt.hash(String(body.password), 10);
      await client.query(
        `UPDATE app_user SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
        [id, hash]
      );
    }
    await client.query('COMMIT');
    return getUserById(id);
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

async function setUserActive(userId, isActive, actorUserId = null) {
  const id = Number(userId);
  if (actorUserId != null && Number(actorUserId) === id && !isActive) {
    throw httpError(400, 'You cannot deactivate your own account');
  }
  const { rowCount } = await query(
    `UPDATE app_user SET is_active = $2, updated_at = NOW() WHERE id = $1`,
    [id, !!isActive]
  );
  if (!rowCount) throw httpError(404, 'User not found');
  return getUserById(id);
}

async function resetPassword(userId, newPassword) {
  if (!newPassword || String(newPassword).length < 6) {
    throw httpError(400, 'password must be at least 6 characters');
  }
  const hash = await bcrypt.hash(String(newPassword), 10);
  const { rowCount } = await query(
    `UPDATE app_user SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
    [Number(userId), hash]
  );
  if (!rowCount) throw httpError(404, 'User not found');
  return { message: 'Password reset successfully', user_id: Number(userId) };
}

module.exports = {
  MANAGEABLE_ROLES,
  ROLE_LABELS,
  normalizeRoleCode,
  listRoles,
  listGeoOptions,
  listUsers,
  getUserById,
  createUser,
  updateUser,
  setUserActive,
  resetPassword,
  resolveGeoForRole,
};
