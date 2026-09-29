/**
 * Ranking Excel geo names → master (division/district) canonical names.
 * Excel spellings often differ from map / district master.
 *
 * IMPORTANT: district aliases must match `district.name` (not division labels).
 * Mapping "Aligarh" → "Aligarh Division" corrupts district outcome rows.
 */
const DISTRICT_ALIASES = {
  bagpat: 'Baghpat',
  badaun: 'Budaun',
  unnav: 'Unnao',
  // Master table spelling is Shrawasti
  shrawasti: 'Shrawasti',
  shravasti: 'Shrawasti',
  // Upstream sometimes labels district as division
  'aligarh division': 'Aligarh',
  // occasional variants
  'gautam budh nagar': 'Gautam Buddha Nagar',
  'gb nagar': 'Gautam Buddha Nagar',
  maunathbhanjan: 'Maunathbhanjan',
  'mau nath bhanjan': 'Maunathbhanjan',
  'rae bareilly': 'Rae Bareli',
  raebareli: 'Rae Bareli',
  'rai bareli': 'Rae Bareli',
  faizabad: 'Ayodhya',
  // FE map / HMIS sometimes appends Urban/Rural
  'lucknow (urban)': 'Lucknow',
  'lucknow (rural)': 'Lucknow',
  'lucknow urban': 'Lucknow',
  'lucknow rural': 'Lucknow',
};

const DIVISION_ALIASES = {
  'kanpur division': 'Kanpur Nagar Division',
  'alligarh division': 'Aligarh Division',
  // Shorthand only for division filters — not applied to district ingest
  'aligarh div': 'Aligarh Division',
  kanpur: 'Kanpur Nagar Division',
};

function key(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Normalize a district label to master `district.name` spelling.
 */
function normalizeDistrictName(name) {
  const raw = String(name || '').trim();
  if (!raw) return raw;
  const k = key(raw);
  if (DISTRICT_ALIASES[k]) return DISTRICT_ALIASES[k];
  // Strip trailing (Urban)/(Rural) qualifiers used by FE map labels
  const stripped = raw.replace(/\s*\((urban|rural)\)\s*$/i, '').trim();
  if (stripped && stripped !== raw) {
    const sk = key(stripped);
    if (DISTRICT_ALIASES[sk]) return DISTRICT_ALIASES[sk];
    return stripped;
  }
  return raw;
}

/**
 * Normalize a geo / district / division label to master spelling.
 * District aliases win over division aliases so outcome ingest stays clean.
 */
function normalizeGeoName(name) {
  const raw = String(name || '').trim();
  if (!raw) return raw;
  const asDistrict = normalizeDistrictName(raw);
  if (asDistrict !== raw) return asDistrict;
  const k = key(raw);
  if (DIVISION_ALIASES[k]) return DIVISION_ALIASES[k];
  return raw;
}

/** All known excel→canonical pairs for bulk DB repair */
function allAliasPairs() {
  const pairs = [];
  for (const [from, to] of Object.entries(DISTRICT_ALIASES)) {
    pairs.push({ from, to });
  }
  for (const [from, to] of Object.entries(DIVISION_ALIASES)) {
    pairs.push({ from, to });
  }
  return pairs;
}

module.exports = {
  DISTRICT_ALIASES,
  DIVISION_ALIASES,
  normalizeGeoName,
  normalizeDistrictName,
  allAliasPairs,
  key,
};
