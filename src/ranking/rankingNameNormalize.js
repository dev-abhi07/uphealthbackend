/**
 * Ranking Excel geo names → master (division/district) canonical names.
 * Excel spellings often differ from map / district master.
 */
const DISTRICT_ALIASES = {
  bagpat: 'Baghpat',
  budaun: 'Badaun',
  unnav: 'Unnao',
  shrawasti: 'Shravasti',
  // occasional variants
  'gautam budh nagar': 'Gautam Buddha Nagar',
  'gb nagar': 'Gautam Buddha Nagar',
  maunathbhanjan: 'Maunathbhanjan',
  'mau nath bhanjan': 'Maunathbhanjan',
};

const DIVISION_ALIASES = {
  'kanpur division': 'Kanpur Nagar Division',
  'alligarh division': 'Aligarh Division',
  aligarh: 'Aligarh Division',
  kanpur: 'Kanpur Nagar Division',
};

function key(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Normalize a geo / district / division label to master spelling.
 */
function normalizeGeoName(name) {
  const raw = String(name || '').trim();
  if (!raw) return raw;
  const k = key(raw);
  if (DISTRICT_ALIASES[k]) return DISTRICT_ALIASES[k];
  if (DIVISION_ALIASES[k]) return DIVISION_ALIASES[k];
  // "Kanpur Division" already covered; also strip/repair common typos
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
  allAliasPairs,
  key,
};
