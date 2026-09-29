const { outcomeConfig, buildBlockUrl, basicAuthHeader } = require('./outcomeConfig');
const { normalizeDistrictName } = require('../ranking/rankingNameNormalize');

/**
 * Fetch block outcome rows from external API (HTTP Basic Auth).
 * Shape: districtName, districtLgdCode, blockName, blockLgdCode, indexOutcome, rankOutcome, indicators
 */
async function fetchBlockOutcomeFromApi({ month, year }) {
  const cfg = outcomeConfig();
  const url = buildBlockUrl(month, year);
  if (!url) {
    const err = new Error(
      'OUTCOME_BLOCK_API_URL is not configured (use {month} and {year} placeholders)'
    );
    err.code = 'OUTCOME_URL_MISSING';
    throw err;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    const headers = { Accept: 'application/json' };
    const basic = basicAuthHeader();
    if (basic) {
      headers.Authorization = basic;
    } else if (cfg.apiKey) {
      headers.Authorization = `Bearer ${cfg.apiKey}`;
      headers['X-API-Key'] = cfg.apiKey;
    }

    const res = await fetch(url, { method: 'GET', headers, signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Block outcome API HTTP ${res.status}: ${text.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    const body = await res.json();
    const rows = normalizeApiBody(body);
    if (!rows.length) {
      const err = new Error('Block outcome API returned no rows');
      err.code = 'OUTCOME_EMPTY';
      throw err;
    }
    return rows;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeApiBody(body) {
  if (Array.isArray(body)) return body.map(normalizeBlockRow).filter(Boolean);
  if (body && Array.isArray(body.data)) return body.data.map(normalizeBlockRow).filter(Boolean);
  if (body && Array.isArray(body.blocks)) return body.blocks.map(normalizeBlockRow).filter(Boolean);
  if (body && Array.isArray(body.results)) {
    return body.results.map(normalizeBlockRow).filter(Boolean);
  }
  return [];
}

function normalizeBlockRow(r) {
  if (!r || typeof r !== 'object') return null;
  const districtLgd =
    r.districtLgdCode ?? r.district_lgd_code ?? r.districtLgd ?? r.DistrictLGDcode;
  const districtName = r.districtName ?? r.district_name ?? r.District;
  const blockLgd = r.blockLgdCode ?? r.block_lgd_code ?? r.blockLgd ?? r.BlockLGDcode;
  const blockName = r.blockName ?? r.block_name ?? r.Block ?? r.name;
  const month = r.month ?? r.Month;
  const year = r.year ?? r.Year;
  const indexOutcome = r.indexOutcome ?? r.index_outcome;
  const rankOutcome = r.rankOutcome ?? r.rank_outcome;
  const indicators = r.indicators || r.Indicators || {};
  if (blockLgd == null || !blockName) return null;
  return {
    id: r.id ?? r.external_id ?? null,
    districtName: districtName
      ? normalizeDistrictName(String(districtName).trim())
      : null,
    districtLgdCode: districtLgd != null ? Number(districtLgd) : null,
    blockName: String(blockName).trim(),
    blockLgdCode: Number(blockLgd),
    month: month != null ? Number(month) : null,
    year: year != null ? Number(year) : null,
    indexOutcome: indexOutcome != null ? Number(indexOutcome) : null,
    rankOutcome: rankOutcome != null ? Number(rankOutcome) : null,
    indicators: typeof indicators === 'object' && indicators ? indicators : {},
  };
}

module.exports = {
  fetchBlockOutcomeFromApi,
  normalizeApiBody,
  normalizeBlockRow,
};
