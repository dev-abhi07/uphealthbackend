const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db/pool');
const config = require('../config');

const STATE_ROLES = new Set(['state_admin']);

async function findUserByUsername(username) {
  const { rows } = await query(
    `
    SELECT
      u.id, u.username, u.full_name, u.email, u.mobile,
      u.password_hash, u.is_active, u.last_login_at
    FROM app_user u
    WHERE LOWER(u.username) = LOWER($1)
    LIMIT 1
  `,
    [username]
  );
  return rows[0] || null;
}

async function getUserRoles(userId) {
  const { rows } = await query(
    `
    SELECT r.code, r.name
    FROM user_role ur
    JOIN role r ON r.id = ur.role_id
    WHERE ur.user_id = $1 AND r.is_active = TRUE
    ORDER BY r.code
  `,
    [userId]
  );
  return rows;
}

async function getUserGeoAssignments(userId) {
  const { rows } = await query(
    `
    SELECT
      uga.geo_level,
      uga.division_id,
      dv.name AS division_name,
      dv.code AS division_code,
      uga.district_id,
      d.name AS district_name,
      d.lgd_code AS district_lgd,
      uga.block_id,
      b.name AS block_name,
      b.lgd_code AS block_lgd,
      uga.facility_id,
      f.name AS facility_name
    FROM user_geo_assignment uga
    LEFT JOIN division dv ON dv.id = uga.division_id
    LEFT JOIN district d ON d.id = uga.district_id
    LEFT JOIN block b ON b.id = uga.block_id
    LEFT JOIN facility f ON f.id = uga.facility_id
    WHERE uga.user_id = $1 AND uga.is_active = TRUE
    ORDER BY uga.geo_level, uga.id
  `,
    [userId]
  );
  return rows;
}

/**
 * Normalized scope for frontend / clients.
 * level: state | division | district | block
 */
function buildUserScope(roles, geoAssignments = []) {
  const roleCodes = (roles || []).map((r) => String(r.code || r).toLowerCase());
  const isStateAdmin = roleCodes.some((c) => STATE_ROLES.has(c));
  const primary = geoAssignments[0] || null;

  if (isStateAdmin || !primary) {
    return {
      level: 'state',
      is_state_admin: isStateAdmin,
      can_upload: isStateAdmin,
      can_view_statewide: true,
      division_id: null,
      division_name: null,
      division_code: null,
      district_id: null,
      district_name: null,
      block_id: null,
      block_name: null,
      label: 'Uttar Pradesh',
      default_filters: {
        level: 'division',
        table_mode: 'district',
      },
    };
  }

  const level = String(primary.geo_level || 'state').toLowerCase();
  const divisionId = primary.division_id != null ? Number(primary.division_id) : null;
  const districtId = primary.district_id != null ? Number(primary.district_id) : null;
  const blockId = primary.block_id != null ? Number(primary.block_id) : null;

  let label = 'Uttar Pradesh';
  if (level === 'block' && primary.block_name) {
    label = primary.district_name
      ? `${primary.block_name} - ${primary.district_name}`
      : primary.block_name;
  } else if (level === 'district' && primary.district_name) {
    label = primary.district_name;
  } else if (level === 'division' && primary.division_name) {
    label = primary.division_name;
  }

  const default_filters = { level: 'division', table_mode: 'district' };
  if (level === 'division') {
    default_filters.level = 'district';
    default_filters.table_mode = 'district';
    if (primary.division_code) default_filters.div_code = String(primary.division_code);
    if (primary.division_name) default_filters.division = primary.division_name;
    if (divisionId != null) default_filters.division_id = String(divisionId);
  } else if (level === 'district') {
    default_filters.level = 'district';
    default_filters.table_mode = 'district';
    if (primary.district_name) default_filters.district = primary.district_name;
    if (districtId != null) default_filters.district_id = String(districtId);
    if (primary.division_code) default_filters.div_code = String(primary.division_code);
    if (divisionId != null) default_filters.division_id = String(divisionId);
  } else if (level === 'block') {
    default_filters.level = 'block';
    default_filters.table_mode = 'district';
    if (primary.district_name) default_filters.district = primary.district_name;
    if (primary.block_name) default_filters.block = primary.block_name;
    if (districtId != null) default_filters.district_id = String(districtId);
    if (blockId != null) default_filters.block_id = String(blockId);
    if (divisionId != null) default_filters.division_id = String(divisionId);
  }

  return {
    level,
    is_state_admin: false,
    can_upload: false,
    can_view_statewide: false,
    division_id: divisionId,
    division_name: primary.division_name || null,
    division_code: primary.division_code != null ? String(primary.division_code) : null,
    district_id: districtId,
    district_name: primary.district_name || null,
    block_id: blockId,
    block_name: primary.block_name || null,
    label,
    default_filters,
  };
}

function signToken(user, roles, geo) {
  const scope = buildUserScope(roles, geo);
  const payload = {
    sub: user.id,
    username: user.username,
    full_name: user.full_name,
    roles: roles.map((r) => r.code),
    scope_level: scope.level,
    geo: geo.map((g) => ({
      geo_level: g.geo_level,
      division_id: g.division_id,
      district_id: g.district_id,
      block_id: g.block_id,
      facility_id: g.facility_id,
      division_name: g.division_name || null,
      division_code: g.division_code != null ? String(g.division_code) : null,
      district_name: g.district_name || null,
      block_name: g.block_name || null,
    })),
  };

  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
}

function publicUser(user, roles, geo) {
  const scope = buildUserScope(roles, geo);
  return {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    email: user.email,
    mobile: user.mobile,
    roles: roles.map((r) => ({ code: r.code, name: r.name })),
    geo_assignments: geo,
    scope,
    last_login_at: user.last_login_at,
  };
}

async function login(username, password) {
  if (!username || !password) {
    const err = new Error('Username and password are required');
    err.status = 400;
    throw err;
  }

  const user = await findUserByUsername(username.trim());
  if (!user || !user.is_active) {
    const err = new Error('Invalid username or password');
    err.status = 401;
    throw err;
  }

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    const err = new Error('Invalid username or password');
    err.status = 401;
    throw err;
  }

  const roles = await getUserRoles(user.id);
  const geo = await getUserGeoAssignments(user.id);
  const token = signToken(user, roles, geo);
  const publicProfile = publicUser(user, roles, geo);

  await query(`UPDATE app_user SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`, [
    user.id,
  ]);

  return {
    token,
    token_type: 'Bearer',
    expires_in: config.jwt.expiresIn,
    user: publicProfile,
    scope: publicProfile.scope,
  };
}

async function getProfile(userId) {
  const { rows } = await query(
    `
    SELECT id, username, full_name, email, mobile, is_active, last_login_at
    FROM app_user WHERE id = $1
  `,
    [userId]
  );
  const user = rows[0];
  if (!user || !user.is_active) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  const roles = await getUserRoles(userId);
  const geo = await getUserGeoAssignments(userId);
  return publicUser(user, roles, geo);
}

async function changePassword(userId, currentPassword, newPassword) {
  if (!currentPassword || !newPassword) {
    const err = new Error('Current and new password are required');
    err.status = 400;
    throw err;
  }
  if (String(newPassword).length < 6) {
    const err = new Error('New password must be at least 6 characters');
    err.status = 400;
    throw err;
  }

  const { rows } = await query(`SELECT id, password_hash FROM app_user WHERE id = $1`, [userId]);
  const user = rows[0];
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) {
    const err = new Error('Current password is incorrect');
    err.status = 400;
    throw err;
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await query(
    `UPDATE app_user SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
    [userId, hash]
  );

  return { message: 'Password updated successfully' };
}

/** Demo accounts for integration (no passwords in response). */
async function listDemoAccounts() {
  const { rows } = await query(
    `
    SELECT
      u.username,
      u.full_name,
      r.code AS role_code,
      r.name AS role_name,
      uga.geo_level,
      dv.name AS division_name,
      d.name AS district_name,
      b.name AS block_name
    FROM app_user u
    LEFT JOIN user_role ur ON ur.user_id = u.id
    LEFT JOIN role r ON r.id = ur.role_id
    LEFT JOIN user_geo_assignment uga ON uga.user_id = u.id AND uga.is_active = TRUE
    LEFT JOIN division dv ON dv.id = uga.division_id
    LEFT JOIN district d ON d.id = uga.district_id
    LEFT JOIN block b ON b.id = uga.block_id
    WHERE u.is_active = TRUE
    ORDER BY
      CASE r.code
        WHEN 'state_admin' THEN 0
        WHEN 'division_viewer' THEN 1
        WHEN 'district_viewer' THEN 2
        WHEN 'block_viewer' THEN 3
        ELSE 9
      END,
      u.username
    `
  );

  return {
    password_hint: 'Pass@123',
    accounts: rows.map((r) => ({
      username: r.username,
      full_name: r.full_name,
      role: r.role_code,
      role_name: r.role_name,
      geo_level: r.geo_level || 'state',
      division: r.division_name || null,
      district: r.district_name || null,
      block: r.block_name || null,
    })),
  };
}

module.exports = {
  login,
  getProfile,
  changePassword,
  findUserByUsername,
  buildUserScope,
  listDemoAccounts,
};
