/**
 * Resolve and enforce user geography scope from JWT geo assignments.
 * state_admin → statewide; others locked to division / district / block.
 */
const { query } = require('../db/pool');

const STATE_ROLES = new Set(['state_admin']);

function isStateAdmin(user) {
  const roles = user?.roles || [];
  return roles.some((r) => STATE_ROLES.has(String(r).toLowerCase()));
}

function primaryGeo(user) {
  const list = Array.isArray(user?.geo) ? user.geo : [];
  return list[0] || null;
}

function normalizeName(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+division$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function namesMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Allow only whole-token / full-prefix matches (avoid "Agra" ⊂ "Prayagraj")
  const aTokens = na.split(/\s+/).filter(Boolean);
  const bTokens = nb.split(/\s+/).filter(Boolean);
  if (aTokens.length === 1 && bTokens.length === 1) {
    return false;
  }
  return (
    aTokens.join(' ') === bTokens.join(' ') ||
    (aTokens[0] === bTokens[0] && Math.min(aTokens.length, bTokens.length) > 1)
  );
}

/**
 * Load human-readable names + codes for the user's primary geo assignment.
 */
async function resolveUserGeoScope(user) {
  if (!user || isStateAdmin(user)) {
    return {
      isStateAdmin: true,
      level: 'state',
      divisionId: null,
      districtId: null,
      blockId: null,
      divisionName: null,
      divisionCode: null,
      districtName: null,
      blockName: null,
      districtNamesInDivision: [],
    };
  }

  const geo = primaryGeo(user);
  if (!geo || !geo.geo_level) {
    return {
      isStateAdmin: false,
      level: 'state',
      divisionId: null,
      districtId: null,
      blockId: null,
      divisionName: null,
      divisionCode: null,
      districtName: null,
      blockName: null,
      districtNamesInDivision: [],
      unrestricted: true,
    };
  }

  const level = String(geo.geo_level).toLowerCase();
  const divisionId = geo.division_id != null ? Number(geo.division_id) : null;
  const districtId = geo.district_id != null ? Number(geo.district_id) : null;
  const blockId = geo.block_id != null ? Number(geo.block_id) : null;

  let divisionName = null;
  let divisionCode = null;
  let districtName = null;
  let blockName = null;
  let districtNamesInDivision = [];

  if (divisionId) {
    const { rows } = await query(
      `SELECT id, name, code FROM division WHERE id = $1 LIMIT 1`,
      [divisionId]
    );
    if (rows[0]) {
      divisionName = rows[0].name;
      divisionCode = rows[0].code != null ? String(rows[0].code) : null;
    }
    const { rows: dists } = await query(
      `SELECT name FROM district WHERE division_id = $1 AND is_active = TRUE`,
      [divisionId]
    );
    districtNamesInDivision = dists.map((r) => r.name);
  }

  if (districtId) {
    const { rows } = await query(
      `
      SELECT d.name AS district_name, dv.id AS division_id, dv.name AS division_name, dv.code AS division_code
      FROM district d
      JOIN division dv ON dv.id = d.division_id
      WHERE d.id = $1
      LIMIT 1
      `,
      [districtId]
    );
    if (rows[0]) {
      districtName = rows[0].district_name;
      if (!divisionId) {
        divisionName = rows[0].division_name;
        divisionCode = rows[0].division_code != null ? String(rows[0].division_code) : null;
      }
    }
  }

  if (blockId) {
    const { rows } = await query(
      `
      SELECT
        b.name AS block_name,
        d.id AS district_id,
        d.name AS district_name,
        dv.id AS division_id,
        dv.name AS division_name,
        dv.code AS division_code
      FROM block b
      JOIN district d ON d.id = b.district_id
      JOIN division dv ON dv.id = d.division_id
      WHERE b.id = $1
      LIMIT 1
      `,
      [blockId]
    );
    if (rows[0]) {
      blockName = rows[0].block_name;
      if (!districtName) districtName = rows[0].district_name;
      if (!divisionName) {
        divisionName = rows[0].division_name;
        divisionCode = rows[0].division_code != null ? String(rows[0].division_code) : null;
      }
    }
  }

  return {
    isStateAdmin: false,
    unrestricted: false,
    level,
    divisionId,
    districtId,
    blockId,
    divisionName,
    divisionCode,
    districtName,
    blockName,
    districtNamesInDivision,
  };
}

/**
 * Force query filters to the user's allowed geography.
 * Mutates `query` (typically req.query).
 * Returns scope; throws 403 if client asks outside scope.
 */
function enforceQueryGeoScope(query, scope) {
  if (!scope || scope.isStateAdmin || scope.unrestricted) return scope;

  const q = query || {};
  const askedDivision = q.division || q.div_code || q.divCode || '';
  const askedDistrict = q.district || q.district_id || '';
  const askedBlock = q.block || q.block_name || '';

  if (scope.level === 'division') {
    if (askedDivision && scope.divisionName && scope.divisionCode) {
      const ok =
        namesMatch(askedDivision, scope.divisionName) ||
        String(askedDivision) === String(scope.divisionCode) ||
        String(askedDivision) === String(scope.divisionId);
      if (!ok) {
        const err = new Error('Access denied: outside your division scope');
        err.status = 403;
        throw err;
      }
    }
    if (askedDistrict && scope.districtNamesInDivision?.length) {
      const ok = scope.districtNamesInDivision.some((n) => namesMatch(askedDistrict, n));
      if (!ok) {
        const err = new Error('Access denied: district is outside your division');
        err.status = 403;
        throw err;
      }
    }
    if (scope.divisionName) q.division = scope.divisionName;
    if (scope.divisionCode) {
      q.div_code = scope.divisionCode;
      if (!q.parent_area_id) q.parent_area_id = scope.divisionCode;
    }
  } else if (scope.level === 'district') {
    if (askedDistrict && scope.districtName && !namesMatch(askedDistrict, scope.districtName)) {
      const err = new Error('Access denied: outside your district scope');
      err.status = 403;
      throw err;
    }
    if (scope.districtName) q.district = scope.districtName;
    if (scope.divisionName) q.division = scope.divisionName;
    if (scope.divisionCode) q.div_code = scope.divisionCode;
    if (scope.districtId) q.district_id = String(scope.districtId);
  } else if (scope.level === 'block') {
    if (askedDistrict && scope.districtName && !namesMatch(askedDistrict, scope.districtName)) {
      const err = new Error('Access denied: outside your district scope');
      err.status = 403;
      throw err;
    }
    if (askedBlock && scope.blockName && !namesMatch(askedBlock, scope.blockName)) {
      const err = new Error('Access denied: outside your block scope');
      err.status = 403;
      throw err;
    }
    if (scope.districtName) q.district = scope.districtName;
    if (scope.blockName) {
      q.block = scope.blockName;
      q.block_name = scope.blockName;
    }
    if (scope.divisionName) q.division = scope.divisionName;
    if (scope.divisionCode) q.div_code = scope.divisionCode;
  }

  return scope;
}

/**
 * Filter ranking / tree rows to the user's geography.
 */
function filterRankingsByScope(rankings, scope, geoLevel = 'district') {
  if (!Array.isArray(rankings)) return rankings;
  if (!scope || scope.isStateAdmin || scope.unrestricted) return rankings;

  const level = String(geoLevel || '').toLowerCase();

  if (scope.level === 'division') {
    if (level === 'division') {
      return rankings.filter((r) => namesMatch(r.name || r.area_name, scope.divisionName));
    }
    if (level === 'district' || level === 'block') {
      const allowed = new Set(
        (scope.districtNamesInDivision || []).map((n) => normalizeName(n))
      );
      return rankings
        .filter((r) => {
          const districtLabel =
            level === 'block' ? r.district_name || r.districtName || r.district : r.name || r.area_name;
          return allowed.has(normalizeName(districtLabel)) || namesMatch(districtLabel, scope.districtName);
        })
        .map((r) => {
          if (!Array.isArray(r.children) || !r.children.length) return r;
          if (level === 'district') return r;
          return {
            ...r,
            children: r.children.filter((c) =>
              namesMatch(c.district_name || c.districtName || r.name, scope.districtName) ||
              allowed.has(normalizeName(c.district_name || c.districtName || r.name))
            ),
          };
        });
    }
  }

  if (scope.level === 'district') {
    if (level === 'division') {
      return rankings.filter((r) => namesMatch(r.name || r.area_name, scope.divisionName));
    }
    if (level === 'district') {
      return rankings
        .filter((r) => namesMatch(r.name || r.area_name, scope.districtName))
        .map((r) => ({ ...r }));
    }
    if (level === 'block') {
      return rankings.filter(
        (r) =>
          namesMatch(r.district_name || r.districtName || r.district, scope.districtName) ||
          namesMatch(r.name || r.area_name, scope.districtName)
      );
    }
  }

  if (scope.level === 'block') {
    if (level === 'block') {
      return rankings.filter((r) => namesMatch(r.name || r.area_name, scope.blockName));
    }
    if (level === 'district') {
      return rankings
        .filter((r) => namesMatch(r.name || r.area_name, scope.districtName))
        .map((r) => ({
          ...r,
          children: Array.isArray(r.children)
            ? r.children.filter((c) => namesMatch(c.name || c.area_name, scope.blockName))
            : r.children,
        }));
    }
    if (level === 'division') {
      return rankings.filter((r) => namesMatch(r.name || r.area_name, scope.divisionName));
    }
  }

  return rankings;
}

function scopeMeta(scope) {
  if (!scope) return null;
  return {
    is_state_admin: Boolean(scope.isStateAdmin),
    level: scope.level,
    division_id: scope.divisionId,
    district_id: scope.districtId,
    block_id: scope.blockId,
    division: scope.divisionName,
    division_code: scope.divisionCode,
    district: scope.districtName,
    block: scope.blockName,
  };
}

module.exports = {
  isStateAdmin,
  resolveUserGeoScope,
  enforceQueryGeoScope,
  filterRankingsByScope,
  scopeMeta,
  namesMatch,
  normalizeName,
};
