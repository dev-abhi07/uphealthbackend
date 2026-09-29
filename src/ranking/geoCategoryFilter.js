/**
 * Category filters for ranking map / table (Show All | Aspirational | High Priority).
 *
 * Frontend query key: `filter`
 * Values: `all` | `aspirational` | `high_priority`
 *
 * Applies to division & district lists (and district children under divisions).
 * Block level is a no-op (single-block views don't need these filters).
 */

const { normalizeGeoName } = require('./rankingNameNormalize');

/** NITI Aayog aspirational districts in UP (+ legacy extras already used in deep-dive). */
const ASPIRATIONAL_DISTRICTS = [
  'Bahraich',
  'Balrampur',
  'Chandauli',
  'Chitrakoot',
  'Fatehpur',
  'Gonda',
  'Kaushambi',
  'Shravasti',
  'Shrawasti',
  'Siddharth Nagar',
  'Siddharthnagar',
  'Sonbhadra',
].map((n) => normalizeKey(n));

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

function normalizeKey(name) {
  return String(normalizeGeoName(name) || name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

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

function districtInCategory(districtName, filterKey) {
  const set = categorySet(filterKey);
  if (!set) return true;
  return set.has(normalizeKey(districtName));
}

/**
 * Build set of division names that contain ≥1 district in the category.
 * @param {Array<{district_name:string, division_name:string}>} districtMaster
 */
function divisionsMatchingCategory(districtMaster, filterKey) {
  const set = categorySet(filterKey);
  if (!set) return null;
  const out = new Set();
  for (const row of districtMaster || []) {
    if (set.has(normalizeKey(row.district_name))) {
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
  // Block login / block-only lists: skip category filters
  if (level === 'block') {
    return {
      rankings,
      filter: filterKey,
      filter_note: 'Category filter skipped at block level',
    };
  }

  let filtered = rankings;
  let filter_note = null;

  if (level === 'district') {
    filtered = rankings.filter((r) => {
      if (r && r.is_state) return true;
      return districtInCategory(r.name || r.area_name || r.district_name, filterKey);
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
            districtInCategory(c.name || c.area_name || c.district_name, filterKey)
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
    // state / unknown → treat as district names if present
    filtered = rankings.filter((r) => {
      if (r && r.is_state) return true;
      return districtInCategory(r.name || r.area_name || r.district_name, filterKey);
    });
  }

  if (filterKey === 'high_priority' && filtered.filter((r) => !r.is_state).length === 0) {
    filter_note = 'No high_priority districts matched for this geo level';
  }
  if (filterKey === 'aspirational' && filtered.filter((r) => !r.is_state).length === 0) {
    filter_note = 'No aspirational districts matched for this geo level';
  }

  return { rankings: filtered, filter: filterKey, filter_note };
}

/** District name list for breakup scoping under a category filter. */
function districtNamesForFilter(filterRaw, districtMaster = []) {
  const filterKey = parseFilter(filterRaw);
  const set = categorySet(filterKey);
  if (!set) return null;
  return (districtMaster || [])
    .map((d) => d.district_name)
    .filter((n) => set.has(normalizeKey(n)));
}

module.exports = {
  ASPIRATIONAL_DISTRICTS,
  HIGH_PRIORITY_DISTRICTS,
  parseFilter,
  districtInCategory,
  divisionsMatchingCategory,
  applyGeoCategoryFilter,
  districtNamesForFilter,
  normalizeKey,
};
