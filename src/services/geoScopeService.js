/**
 * Resolve and enforce user geography scope from JWT geo assignments.
 * system_admin / state_admin → statewide view; others locked to division / district / block.
 * (User management is system_admin-only — enforced in admin routes, not here.)
 */
const { query } = require('../db/pool');
const { normalizeDistrictName } = require('../ranking/rankingNameNormalize');

const STATEWIDE_ROLES = new Set(['state_admin', 'system_admin']);

function isStateAdmin(user) {
  const roles = user?.roles || [];
  return roles.some((r) => {
    const code = String(
      r && typeof r === 'object' ? r.code || r.name || '' : r
    )
      .toLowerCase()
      .replace(/\s+/g, '_');
    return STATEWIDE_ROLES.has(code);
  });
}

function primaryGeo(user) {
  const list = Array.isArray(user?.geo) ? user.geo : [];
  return list[0] || null;
}

function normalizeName(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Compare division labels: "Lucknow" ≈ "Lucknow Division". */
function normalizeDivisionKey(value = '') {
  return normalizeName(value).replace(/\s+division$/i, '').trim();
}

/** Strip FE qualifiers: "Lucknow (Urban)" → "lucknow". */
function normalizeDistrictKey(value = '') {
  const aliased = normalizeDistrictName(value);
  return normalizeName(aliased)
    .replace(/\b(urban|rural)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const da = normalizeDistrictKey(a);
  const db = normalizeDistrictKey(b);
  if (da && db && da === db) return true;
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

function divisionNamesMatch(a, b) {
  const na = normalizeDivisionKey(a);
  const nb = normalizeDivisionKey(b);
  return Boolean(na && nb && na === nb);
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
  /** @type {Array<{id:number, lgd:number|null, name:string}>} */
  let districtsInDivision = [];
  let blockNamesInDistrict = [];
  /** @type {Array<{id:number, lgd:number|null, name:string}>} */
  let blocksInDistrict = [];
  let districtLgd = null;
  let blockLgd = null;

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
      `
      SELECT id, name, lgd_code
      FROM district
      WHERE division_id = $1 AND is_active = TRUE
      ORDER BY name
      `,
      [divisionId]
    );
    districtsInDivision = dists.map((r) => ({
      id: Number(r.id),
      lgd: r.lgd_code != null ? Number(r.lgd_code) : null,
      name: r.name,
    }));
    districtNamesInDivision = districtsInDivision.map((r) => r.name);
  }

  if (districtId) {
    const { rows } = await query(
      `
      SELECT d.name AS district_name, d.lgd_code,
             dv.id AS division_id, dv.name AS division_name, dv.code AS division_code
      FROM district d
      JOIN division dv ON dv.id = d.division_id
      WHERE d.id = $1
      LIMIT 1
      `,
      [districtId]
    );
    if (rows[0]) {
      districtName = rows[0].district_name;
      districtLgd = rows[0].lgd_code != null ? Number(rows[0].lgd_code) : null;
      if (!divisionId) {
        divisionName = rows[0].division_name;
        divisionCode = rows[0].division_code != null ? String(rows[0].division_code) : null;
      }
    }
    const { rows: blocks } = await query(
      `
      SELECT id, name, lgd_code
      FROM block
      WHERE district_id = $1 AND is_active = TRUE
      ORDER BY name
      `,
      [districtId]
    );
    blocksInDistrict = blocks.map((r) => ({
      id: Number(r.id),
      lgd: r.lgd_code != null ? Number(r.lgd_code) : null,
      name: r.name,
    }));
    blockNamesInDistrict = blocksInDistrict.map((r) => r.name);
  }

  if (blockId) {
    const { rows } = await query(
      `
      SELECT
        b.name AS block_name,
        b.lgd_code AS block_lgd,
        d.id AS district_id,
        d.name AS district_name,
        d.lgd_code AS district_lgd,
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
      blockLgd = rows[0].block_lgd != null ? Number(rows[0].block_lgd) : null;
      if (!districtName) districtName = rows[0].district_name;
      if (districtLgd == null && rows[0].district_lgd != null) {
        districtLgd = Number(rows[0].district_lgd);
      }
      if (districtId == null && rows[0].district_id != null) {
        // keep assigned districtId; fill if missing
      }
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
    districtLgd,
    blockName,
    blockLgd,
    districtNamesInDivision,
    districtsInDivision,
    blockNamesInDistrict,
    blocksInDistrict,
  };
}

/**
 * Resolve district name from query when FE sends master id / LGD / name.
 * @param {object} q
 * @param {Array<{id:number, lgd:number|null, name:string}>} [districtsInDivision]
 */
function resolveAskedDistrictName(q, districtsInDivision = []) {
  const byName =
    q.district ||
    q.district_name ||
    q.selected_district ||
    null;
  if (byName && !/^\d+$/.test(String(byName).trim())) {
    return String(byName).trim();
  }

  const candidates = [
    q.district_id,
    q.district_lgd,
    q.dt_lgd,
    q.lgd,
    // area_id alone = district when no block selected
    !q.block && !q.block_id && !String(q.area_id || '').includes('__')
      ? q.area_id
      : null,
    byName,
  ]
    .filter((v) => v != null && String(v).trim() !== '')
    .map((v) => String(v).trim());

  for (const c of candidates) {
    if (/^\d+$/.test(c)) {
      const idOrLgd = Number(c);
      const hit = (districtsInDivision || []).find(
        (d) => d.id === idOrLgd || (d.lgd != null && d.lgd === idOrLgd)
      );
      if (hit) return hit.name;
    } else {
      const hit = (districtsInDivision || []).find(
        (d) =>
          namesMatch(c, d.name) ||
          normalizeName(c) === normalizeName(d.name) ||
          normalizeDistrictKey(c) === normalizeDistrictKey(d.name)
      );
      if (hit) return hit.name;
    }
  }
  return byName ? String(byName).trim() : null;
}

/**
 * Analytics / geo-options peer browse:
 * - view=analytics
 * - analytics_compare=geography
 * - peer_compare=1 (set by geo-options for dropdown cascade)
 *
 * Allows same-level peer geos for compare; map/table stay locked.
 */
function isAnalyticsQuery(query = {}) {
  const view = String(query.view || '').toLowerCase();
  if (view === 'analytics') return true;
  const compare = String(query.analytics_compare || '').toLowerCase();
  if (compare === 'geography' || compare === 'geo') return true;
  const peer =
    query.peer_compare === '1' ||
    query.peer_compare === 'true' ||
    query.peer_compare === true ||
    query._peer_geo === '1';
  return Boolean(peer);
}

function matchBlockName(asked, name) {
  return (
    namesMatch(asked, name) ||
    normalizeName(asked) === normalizeName(name) ||
    normalizeDistrictKey(asked) === normalizeDistrictKey(name)
  );
}

/**
 * Force query filters to the user's allowed geography.
 * Mutates `query` (typically req.query).
 * Returns scope; throws 403 if client asks outside scope.
 */
function enforceQueryGeoScope(query, scope) {
  if (!scope || scope.isStateAdmin || scope.unrestricted) return scope;

  const q = query || {};
  const analytics = isAnalyticsQuery(q);
  const askedDivision = q.division || q.div_code || q.divCode || '';
  const askedDistrict = q.district || q.district_id || '';
  const askedBlock = q.block || q.block_name || '';

  if (scope.level === 'division') {
    // Analytics / FE often send district_id or area_id as master PK / LGD.
    // Resolve to district name before name-based allow-list checks.
    const resolvedDistrict = resolveAskedDistrictName(
      q,
      scope.districtsInDivision || []
    );
    if (resolvedDistrict) {
      q.district = resolvedDistrict;
      q.district_name = resolvedDistrict;
    }

    // Analytics peer: allow selecting another division (and its districts later)
    if (analytics && askedDivision) {
      const okHome =
        divisionNamesMatch(askedDivision, scope.divisionName) ||
        String(askedDivision) === String(scope.divisionCode) ||
        String(askedDivision) === String(scope.divisionId);
      if (!okHome) {
        // Keep requested peer division on the query; do not force home division.
        // District/block under peer division are validated loosely (master exists via services).
        if (!q.division && q.div_code) {
          /* keep div_code as peer selector */
        }
        // Skip home-division remap / lock below for peer compare
        q.level = q.level || 'division';
        q.geo_level = q.geo_level || 'division';
        q.table_mode = q.table_mode || q.geo_level || 'division';
        q._analytics_peer = true;
        return scope;
      }
    }

    // FE table/deep-dive sometimes sends a selected DISTRICT as division= / div_code=
    // (e.g. division=Sitapur&div_code=Sitapur). Remap to district if it belongs
    // to this user's division instead of 403'ing.
    if (askedDivision && scope.divisionName && scope.divisionCode) {
      const okDivision =
        divisionNamesMatch(askedDivision, scope.divisionName) ||
        String(askedDivision) === String(scope.divisionCode) ||
        String(askedDivision) === String(scope.divisionId);
      if (!okDivision) {
        const matchedDistrict = (scope.districtNamesInDivision || []).find(
          (n) =>
            namesMatch(askedDivision, n) ||
            normalizeName(askedDivision) === normalizeName(n) ||
            normalizeDistrictKey(askedDivision) === normalizeDistrictKey(n)
        );
        if (matchedDistrict) {
          // Treat as district drill-down / indicator breakup for that district
          q.district = matchedDistrict;
          q.district_name = matchedDistrict;
          delete q.division;
          delete q.div_code;
          delete q.divCode;
          delete q.division_id;
          // Keep table at district (or block if already requested)
          if (
            !q.level ||
            String(q.level).toLowerCase() === 'division' ||
            String(q.geo_level || '').toLowerCase() === 'division' ||
            String(q.table_mode || '').toLowerCase() === 'division'
          ) {
            q.level = 'district';
            q.geo_level = 'district';
            q.table_mode = 'district';
          }
        } else {
          const err = new Error('Access denied: outside your division scope');
          err.status = 403;
          throw err;
        }
      }
    }
    const askedDistrictAfter =
      q.district || q.district_id || q.district_name || askedDistrict || '';
    if (askedDistrictAfter && scope.districtNamesInDivision?.length) {
      const ok = scope.districtNamesInDivision.some(
        (n) =>
          namesMatch(askedDistrictAfter, n) ||
          normalizeName(askedDistrictAfter) === normalizeName(n) ||
          normalizeDistrictKey(askedDistrictAfter) === normalizeDistrictKey(n)
      );
      if (!ok) {
        const err = new Error('Access denied: district is outside your division');
        err.status = 403;
        throw err;
      }
    }
    // Always lock query to this division. Do NOT auto-select a district —
    // FE often sends district=<division short name> (e.g. Lucknow) which
    // wrongly scopes the panel to one district.
    if (scope.divisionName) q.division = scope.divisionName;
    if (scope.divisionCode) {
      q.div_code = scope.divisionCode;
      q.parent_area_id = scope.divisionCode;
    }
    if (scope.divisionId != null) q.division_id = String(scope.divisionId);

    // Clear accidental district filter when it equals the division's short name
    // (Lucknow district vs Lucknow Division) and no explicit district drill-down id/lgd.
    // Keep remapped district selections (Sitapur, Hardoi, …).
    const divShort = normalizeDivisionKey(scope.divisionName);
    const askedDistNorm = normalizeDistrictKey(
      q.district || q.district_name || askedDistrict || ''
    );
    const hasExplicitDistrictId =
      q.district_id || q.district_lgd || q.dt_lgd || q.lgd || q.area_id;
    const isRemappedOtherDistrict =
      askedDistNorm &&
      divShort &&
      askedDistNorm !== divShort &&
      (scope.districtNamesInDivision || []).some(
        (n) => normalizeDistrictKey(n) === askedDistNorm
      );
    if (
      askedDistNorm &&
      divShort &&
      askedDistNorm === divShort &&
      !hasExplicitDistrictId &&
      !isRemappedOtherDistrict
    ) {
      delete q.district;
      delete q.district_name;
      delete q.selected_district;
    }

    // Division users default to district ranking. Allow explicit block drill-down
    // when a district inside the division is selected (FE: level=block&district=…).
    const effectiveAskedDistrict =
      q.district || q.district_name || askedDistrict || '';
    const wantsBlock =
      String(q.level || '').toLowerCase() === 'block' ||
      String(q.geo_level || '').toLowerCase() === 'block' ||
      String(q.table_mode || '').toLowerCase() === 'block';

    if (wantsBlock && effectiveAskedDistrict) {
      q.level = 'block';
      q.geo_level = 'block';
      q.table_mode = 'block';
    } else {
      if (!q.level || String(q.level).toLowerCase() === 'division') {
        q.level = 'district';
      }
      if (!q.geo_level || String(q.geo_level).toLowerCase() === 'division') {
        q.geo_level = 'district';
      }
      if (!q.table_mode || String(q.table_mode).toLowerCase() === 'division') {
        q.table_mode = 'district';
      }
      // Stay on district ranking — clear leftover block mode from prior navigation
      if (String(q.level).toLowerCase() === 'district') {
        q.table_mode = 'district';
      }
    }
  } else if (scope.level === 'district') {
    const analyticsPeerDistrict =
      analytics &&
      askedDistrict &&
      scope.districtName &&
      !namesMatch(askedDistrict, scope.districtName) &&
      String(askedDistrict) !== String(scope.districtId) &&
      !(scope.districtLgd != null && String(askedDistrict) === String(scope.districtLgd));

    if (analyticsPeerDistrict) {
      // Allow comparing / viewing another district statewide in analytics
      q._analytics_peer = true;
      // Keep requested district; do not force home district overwrite
      if (/^\d+$/.test(String(askedDistrict).trim())) {
        // leave numeric id for resolveScope / analytics parser
      } else {
        q.district = String(askedDistrict).trim();
        q.district_name = q.district;
      }
      if (scope.divisionName) q.home_division = scope.divisionName;
      q.level = q.level || 'district';
      q.geo_level = q.geo_level || 'district';
      return scope;
    }

    if (askedDistrict && scope.districtName && !namesMatch(askedDistrict, scope.districtName)) {
      const askedOk =
        String(askedDistrict) === String(scope.districtId) ||
        (scope.districtLgd != null && String(askedDistrict) === String(scope.districtLgd));
      if (!askedOk) {
        const err = new Error('Access denied: outside your district scope');
        err.status = 403;
        throw err;
      }
    }
    if (askedBlock && scope.blockNamesInDistrict?.length) {
      const ok = scope.blockNamesInDistrict.some((n) => matchBlockName(askedBlock, n));
      if (!ok) {
        const err = new Error('Access denied: block is outside your district');
        err.status = 403;
        throw err;
      }
    }
    if (scope.districtName) q.district = scope.districtName;
    if (scope.divisionName) q.division = scope.divisionName;
    if (scope.divisionCode) q.div_code = scope.divisionCode;
    if (scope.districtId) q.district_id = String(scope.districtId);
    if (scope.districtLgd != null) {
      q.district_lgd = String(scope.districtLgd);
      q.dt_lgd = String(scope.districtLgd);
    }

    // Clear accidental block filter when it equals district name
    const distNorm = normalizeName(scope.districtName);
    const askedBlockNorm = normalizeName(askedBlock);
    const hasExplicitBlockId = q.block_id || q.block_lgd;
    if (askedBlockNorm && distNorm && askedBlockNorm === distNorm && !hasExplicitBlockId) {
      delete q.block;
      delete q.block_name;
      delete q.selected_block;
    }

    // District users land on block ranking under their district
    if (!q.level || ['division', 'district'].includes(String(q.level).toLowerCase())) {
      q.level = 'block';
    }
    if (
      !q.geo_level ||
      ['division', 'district'].includes(String(q.geo_level).toLowerCase())
    ) {
      q.geo_level = 'block';
    }
    if (!q.table_mode || q.table_mode === 'district' || q.table_mode === 'division') {
      q.table_mode = 'block';
    }
  } else if (scope.level === 'block') {
    // FE often sends area_id = district LGD (Lucknow=162) on block views / breakup_only.
    // Do not treat that as a block id (would 403 vs Chinhat).
    const areaRaw = q.area_id != null ? String(q.area_id).trim() : '';
    const areaIsDistrictRef =
      areaRaw &&
      (String(areaRaw) === String(scope.districtId) ||
        (scope.districtLgd != null && String(areaRaw) === String(scope.districtLgd)) ||
        namesMatch(areaRaw, scope.districtName));

    const districtOk =
      !askedDistrict ||
      namesMatch(askedDistrict, scope.districtName) ||
      String(askedDistrict) === String(scope.districtId) ||
      (scope.districtLgd != null && String(askedDistrict) === String(scope.districtLgd)) ||
      areaIsDistrictRef;
    if (!districtOk) {
      const err = new Error('Access denied: outside your district scope');
      err.status = 403;
      throw err;
    }

    const askedBlockId =
      q.block_id ||
      q.block_lgd ||
      askedBlock ||
      (areaRaw && !areaIsDistrictRef ? areaRaw : '') ||
      '';
    const homeBlockOk =
      !askedBlockId ||
      matchBlockName(askedBlockId, scope.blockName) ||
      String(askedBlockId) === String(scope.blockId) ||
      (scope.blockLgd != null && String(askedBlockId) === String(scope.blockLgd));

    // Analytics: Chinhat user may select Malihabad (peer block in same district)
    if (analytics && askedBlockId && !homeBlockOk) {
      const peerHit = (scope.blocksInDistrict || []).find(
        (b) =>
          matchBlockName(askedBlockId, b.name) ||
          String(askedBlockId) === String(b.id) ||
          (b.lgd != null && String(askedBlockId) === String(b.lgd))
      );
      const peerBlockName = peerHit ? peerHit.name : null;
      if (!peerBlockName) {
        const err = new Error(
          'Access denied: block is outside your district (analytics peer compare)'
        );
        err.status = 403;
        throw err;
      }
      q._analytics_peer = true;
      q.block = peerBlockName;
      q.block_name = peerBlockName;
      q.area_id = peerBlockName;
      q.block_id = peerHit ? String(peerHit.id) : peerBlockName;
    } else if (!homeBlockOk) {
      const err = new Error('Access denied: outside your block scope');
      err.status = 403;
      throw err;
    }

    if (scope.districtName) q.district = scope.districtName;
    if (scope.districtId != null) q.district_id = String(scope.districtId);
    if (scope.districtLgd != null) {
      q.district_lgd = String(scope.districtLgd);
      q.dt_lgd = String(scope.districtLgd);
    }

    if (!q._analytics_peer) {
      if (scope.blockName) {
        q.block = scope.blockName;
        q.block_name = scope.blockName;
      }
      if (scope.blockId != null) q.block_id = String(scope.blockId);
      // Prefer block LGD on area_id for downstream services (not district LGD)
      if (scope.blockLgd != null) q.area_id = String(scope.blockLgd);
    }

    if (scope.divisionName) q.division = scope.divisionName;
    if (scope.divisionCode) {
      q.div_code = scope.divisionCode;
      // Keep parent_area_id as district id when FE sent it for analytics cascade
      if (!analytics) q.parent_area_id = scope.divisionCode;
    }
    if (scope.divisionId != null && !analytics) {
      q.division_id = String(scope.divisionId);
    }

    // Block users stay on block analytics / ranking
    q.level = 'block';
    q.geo_level = 'block';
    q.table_mode = 'block';
  }

  return scope;
}

/**
 * Filter ranking / tree rows to the user's geography.
 * Keeps API rank on each row; sets local_rank to 1..n within the filtered list.
 */
function filterRankingsByScope(rankings, scope, geoLevel = 'district') {
  if (!Array.isArray(rankings)) return rankings;
  if (!scope || scope.isStateAdmin || scope.unrestricted) {
    return densifyRanks(rankings);
  }

  const level = String(geoLevel || '').toLowerCase();
  let filtered = rankings;

  if (scope.level === 'division') {
    if (level === 'division') {
      filtered = rankings.filter((r) =>
        divisionNamesMatch(r.name || r.area_name, scope.divisionName)
      );
    } else if (level === 'district' || level === 'block') {
      const allowed = new Set(
        (scope.districtNamesInDivision || []).map((n) => normalizeName(n))
      );
      filtered = rankings
        .filter((r) => {
          const districtLabel =
            level === 'block'
              ? r.district_name || r.districtName || r.district
              : r.name || r.area_name;
          return allowed.has(normalizeName(districtLabel));
        })
        .map((r) => {
          if (!Array.isArray(r.children) || !r.children.length) return r;
          if (level === 'district') return r;
          return {
            ...r,
            children: densifyRanks(
              r.children.filter((c) =>
                allowed.has(
                  normalizeName(c.district_name || c.districtName || r.name)
                )
              )
            ),
          };
        });
    }
  } else if (scope.level === 'district') {
    if (level === 'division') {
      filtered = rankings.filter((r) =>
        divisionNamesMatch(r.name || r.area_name, scope.divisionName)
      );
    } else if (level === 'district') {
      filtered = rankings
        .filter(
          (r) =>
            namesMatch(r.name || r.area_name, scope.districtName) ||
            normalizeName(r.name || r.area_name) === normalizeName(scope.districtName)
        )
        .map((r) => ({ ...r }));
    } else if (level === 'block') {
      const allowed = new Set(
        (scope.blockNamesInDistrict || []).map((n) => normalizeName(n))
      );
      filtered = rankings.filter((r) => {
        const inDistrict =
          !r.district_name && !r.districtName && !r.district
            ? true
            : namesMatch(r.district_name || r.districtName || r.district, scope.districtName) ||
              normalizeName(r.district_name || r.districtName || r.district) ===
                normalizeName(scope.districtName);
        if (!inDistrict) return false;
        if (!allowed.size) return true;
        return allowed.has(normalizeName(r.name || r.area_name));
      });
    }
  } else if (scope.level === 'block') {
    if (level === 'block') {
      filtered = rankings.filter((r) => namesMatch(r.name || r.area_name, scope.blockName));
    } else if (level === 'district') {
      filtered = rankings
        .filter((r) => namesMatch(r.name || r.area_name, scope.districtName))
        .map((r) => ({
          ...r,
          children: Array.isArray(r.children)
            ? densifyRanks(
                r.children.filter((c) => namesMatch(c.name || c.area_name, scope.blockName))
              )
            : r.children,
        }));
    } else if (level === 'division') {
      filtered = rankings.filter((r) =>
        divisionNamesMatch(r.name || r.area_name, scope.divisionName)
      );
    }
  }

  return densifyRanks(filtered);
}

/**
 * After geo filter: keep API / outcome rank on `rank`, `state_rank`, and `local_rank`
 * so UIs that bind any of these show the real statewide rank (not 1..n in the filtered list).
 * `list_index` is the only 1..n position within the current filtered list.
 */
function densifyRanks(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  return rows.map((r, i) => {
    const apiRank =
      r.state_rank != null
        ? Number(r.state_rank)
        : r.rank != null
          ? Number(r.rank)
          : null;
    const rank = apiRank != null ? apiRank : i + 1;
    return {
      ...r,
      state_rank: rank,
      rank,
      local_rank: rank,
      list_index: i + 1,
    };
  });
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
    district_lgd: scope.districtLgd != null ? scope.districtLgd : null,
    block: scope.blockName,
    districts_in_division: scope.districtNamesInDivision || [],
    blocks_in_district: scope.blockNamesInDistrict || [],
  };
}

module.exports = {
  isStateAdmin,
  resolveUserGeoScope,
  enforceQueryGeoScope,
  filterRankingsByScope,
  densifyRanks,
  scopeMeta,
  resolveAskedDistrictName,
  isAnalyticsQuery,
  namesMatch,
  divisionNamesMatch,
  normalizeName,
  normalizeDistrictKey,
  normalizeDivisionKey,
};
