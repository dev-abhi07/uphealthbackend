/**
 * Category filters for ranking map / table (Show All | Aspirational | High Priority).
 *
 * Frontend query key: `filter`
 * Values: `all` | `aspirational` | `high_priority`
 *
 * Aspirational districts + blocks: fixed list from Aspirational_blocks.xlsx
 * (42 districts / 108 blocks). Matched primarily by LGD code.
 */

const { normalizeGeoName } = require('./rankingNameNormalize');
const aspirationalData = require('./aspirationalGeoData.json');

function normalizeKey(name) {
  return String(normalizeGeoName(name) || name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** District names (normalized) from fixed aspirational Excel. */
const ASPIRATIONAL_DISTRICTS = (aspirationalData.districts || []).map((d) =>
  normalizeKey(d.district)
);

/** District LGD codes as strings. */
const ASPIRATIONAL_DISTRICT_LGDS = new Set(
  (aspirationalData.districts || [])
    .map((d) => String(d.district_lgd || '').trim())
    .filter(Boolean)
);

/** Block LGD codes as strings. */
const ASPIRATIONAL_BLOCK_LGDS = new Set(
  (aspirationalData.blocks || [])
    .map((b) => String(b.block_lgd || '').trim())
    .filter(Boolean)
);

/** district_lgd → Set(block_lgd) */
const ASPIRATIONAL_BLOCKS_BY_DISTRICT = (() => {
  const map = new Map();
  for (const b of aspirationalData.blocks || []) {
    const dl = String(b.district_lgd || '').trim();
    const bl = String(b.block_lgd || '').trim();
    if (!dl || !bl) continue;
    if (!map.has(dl)) map.set(dl, new Set());
    map.get(dl).add(bl);
  }
  return map;
})();

/**
 * NHM High Priority Districts (UP) — MoHFW HPD list (includes aspirational).
 * Names normalized to master spellings where known.
 */
const HIGH_PRIORITY_DISTRICTS = [
  'Sonbhadra',
  'Sitapur',
  'Barabanki',
  'Bara Banki',
  'Hardoi',
  'Shahjahanpur',
  'Lakhimpur Kheri',
  'Kheri',
  'Gonda',
  'Budaun',
  'Badaun',
  'Kaushambi',
  'Siddharth Nagar',
  'Siddharthnagar',
  'Shravasti',
  'Shrawasti',
  'Balrampur',
  'Bahraich',
  'Bareilly',
  'Etah',
  'Ayodhya',
  'Faizabad',
  'Sant Kabir Nagar',
  'Kasganj',
  'Kanshiram Nagar',
  'Kannauj',
  'Auraiya',
  'Fatehpur',
  'Banda',
  'Farrukhabad',
  'Chitrakoot',
  'Chandauli',
].map((n) => normalizeKey(n));

function parseFilter(raw) {
  const v = String(raw || 'all').toLowerCase().trim();
  if (v === 'aspirational' || v === 'aspirational_districts') return 'aspirational';
  if (
    v === 'high_priority' ||
    v === 'high-priority' ||
    v === 'highpriority' ||
    v === 'hpd'
  ) {
    return 'high_priority';
  }
  return 'all';
}

function categorySet(filterKey) {
  if (filterKey === 'aspirational') return new Set(ASPIRATIONAL_DISTRICTS);
  if (filterKey === 'high_priority') return new Set(HIGH_PRIORITY_DISTRICTS);
  return null;
}

function rowDistrictLgd(row) {
  const v =
    row?.district_lgd ??
    row?.districtLgd ??
    row?.dt_lgd ??
    row?.dtLgd ??
    row?.lgd_code ??
    row?.lgdCode ??
    row?.area_id ??
    row?.areaId ??
    null;
  return v != null && String(v).trim() !== '' ? String(v).trim() : '';
}

function rowBlockLgd(row) {
  const v =
    row?.block_lgd ??
    row?.blockLgd ??
    row?.lgd_code ??
    row?.lgdCode ??
    row?.area_id ??
    row?.areaId ??
    null;
  return v != null && String(v).trim() !== '' ? String(v).trim() : '';
}

function districtInCategory(districtName, filterKey, districtLgd = '') {
  if (filterKey === 'aspirational') {
    if (districtLgd && ASPIRATIONAL_DISTRICT_LGDS.has(String(districtLgd))) {
      return true;
    }
    return ASPIRATIONAL_DISTRICTS.includes(normalizeKey(districtName));
  }
  const set = categorySet(filterKey);
  if (!set) return true;
  return set.has(normalizeKey(districtName));
}

function blockInAspirational(blockLgd, districtLgd = '') {
  const bl = String(blockLgd || '').trim();
  if (!bl) return false;
  if (districtLgd) {
    const set = ASPIRATIONAL_BLOCKS_BY_DISTRICT.get(String(districtLgd));
    if (set) return set.has(bl);
  }
  return ASPIRATIONAL_BLOCK_LGDS.has(bl);
}

/**
 * Build set of division names that contain ≥1 district in the category.
 * @param {Array<{district_name:string, division_name:string, lgd_code?:any}>} districtMaster
 */
function divisionsMatchingCategory(districtMaster, filterKey) {
  const set = categorySet(filterKey);
  if (!set && filterKey !== 'aspirational') return null;
  const out = new Set();
  for (const row of districtMaster || []) {
    const lgd = row.lgd_code != null ? String(row.lgd_code) : '';
    if (
      districtInCategory(row.district_name, filterKey, lgd) ||
      (filterKey === 'aspirational' &&
        lgd &&
        ASPIRATIONAL_DISTRICT_LGDS.has(lgd))
    ) {
      out.add(normalizeKey(row.division_name));
    }
  }
  return out;
}

/**
 * Filter ranking rows for map/table.
 * @param {Array} rankings
 * @param {string} filterRaw
 * @param {'division'|'district'|'block'|string} geoLevel
 * @param {Array} [districtMaster]
 */
function applyGeoCategoryFilter(rankings, filterRaw, geoLevel, districtMaster = []) {
  const filterKey = parseFilter(filterRaw);
  if (filterKey === 'all' || !Array.isArray(rankings)) {
    return { rankings, filter: filterKey, filter_note: null };
  }

  const level = String(geoLevel || '').toLowerCase();
  let filtered = rankings;
  let filter_note = null;

  if (level === 'block') {
    if (filterKey === 'aspirational') {
      filtered = rankings.filter((r) => {
        if (r && r.is_state) return true;
        const bl = rowBlockLgd(r);
        const dl = rowDistrictLgd(r);
        return blockInAspirational(bl, dl);
      });
    } else {
      // High priority / other: keep blocks whose parent district is in category
      filtered = rankings.filter((r) => {
        if (r && r.is_state) return true;
        return districtInCategory(
          r.district_name || r.district || r.districtName,
          filterKey,
          rowDistrictLgd(r)
        );
      });
    }
  } else if (level === 'district') {
    filtered = rankings.filter((r) => {
      if (r && r.is_state) return true;
      return districtInCategory(
        r.name || r.area_name || r.district_name,
        filterKey,
        rowDistrictLgd(r)
      );
    });
  } else if (level === 'division') {
    const allowedDivs = divisionsMatchingCategory(districtMaster, filterKey);
    filtered = rankings
      .filter((r) => {
        if (r && r.is_state) return true;
        if (!allowedDivs) return true;
        return allowedDivs.has(normalizeKey(r.name || r.area_name));
      })
      .map((r) => {
        if (!Array.isArray(r.children) || !r.children.length) return r;
        return {
          ...r,
          children: r.children.filter((c) =>
            districtInCategory(
              c.name || c.area_name || c.district_name,
              filterKey,
              rowDistrictLgd(c)
            )
          ),
          child_count: undefined,
        };
      })
      .map((r) =>
        Array.isArray(r.children)
          ? { ...r, child_count: r.children.length, expandable: r.children.length > 0 }
          : r
      );
  } else {
    filtered = rankings.filter((r) => {
      if (r && r.is_state) return true;
      return districtInCategory(
        r.name || r.area_name || r.district_name,
        filterKey,
        rowDistrictLgd(r)
      );
    });
  }

  if (filterKey === 'high_priority' && filtered.filter((r) => !r.is_state).length === 0) {
    filter_note = 'No high_priority districts matched for this geo level';
  }
  if (filterKey === 'aspirational' && filtered.filter((r) => !r.is_state).length === 0) {
    filter_note =
      level === 'block'
        ? 'No aspirational blocks matched for this district'
        : 'No aspirational districts matched for this geo level';
  }

  return { rankings: filtered, filter: filterKey, filter_note };
}

/** District name list for breakup scoping under a category filter. */
function districtNamesForFilter(filterRaw, districtMaster = []) {
  const filterKey = parseFilter(filterRaw);
  if (filterKey === 'aspirational') {
    return (aspirationalData.districts || []).map((d) => d.district);
  }
  const set = categorySet(filterKey);
  if (!set) return null;
  return (districtMaster || [])
    .map((d) => d.district_name)
    .filter((n) => set.has(normalizeKey(n)));
}

module.exports = {
  ASPIRATIONAL_DISTRICTS,
  ASPIRATIONAL_DISTRICT_LGDS,
  ASPIRATIONAL_BLOCK_LGDS,
  ASPIRATIONAL_BLOCKS_BY_DISTRICT,
  HIGH_PRIORITY_DISTRICTS,
  parseFilter,
  districtInCategory,
  blockInAspirational,
  divisionsMatchingCategory,
  applyGeoCategoryFilter,
  districtNamesForFilter,
  normalizeKey,
};
