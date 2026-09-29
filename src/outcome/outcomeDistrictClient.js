const { outcomeConfig, buildDistrictUrl, basicAuthHeader } = require('./outcomeConfig');
const { normalizeDistrictName } = require('../ranking/rankingNameNormalize');

/**
 * Fetch district outcome rows from external API (HTTP Basic Auth).
 * Accepts array body or { data: [] } / { districts: [] }.
 */
async function fetchDistrictOutcomeFromApi({ month, year }) {
  const cfg = outcomeConfig();
  const url = buildDistrictUrl(month, year);
  if (!url) {
    const err = new Error(
      'OUTCOME_DISTRICT_API_URL is not configured (use {month} and {year} placeholders)'
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
      const err = new Error(`Outcome API HTTP ${res.status}: ${text.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    const body = await res.json();
    const rows = normalizeApiBody(body);
    if (!rows.length) {
      const err = new Error('Outcome API returned no district rows');
      err.code = 'OUTCOME_EMPTY';
      throw err;
    }
    return rows;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeApiBody(body) {
  if (Array.isArray(body)) return body.map(normalizeRow).filter(Boolean);
  if (body && Array.isArray(body.data)) return body.data.map(normalizeRow).filter(Boolean);
  if (body && Array.isArray(body.districts)) {
    return body.districts.map(normalizeRow).filter(Boolean);
  }
  if (body && Array.isArray(body.results)) {
    return body.results.map(normalizeRow).filter(Boolean);
  }
  return [];
}

function normalizeRow(r) {
  if (!r || typeof r !== 'object') return null;
  const districtLgd =
    r.districtLgdCode ?? r.district_lgd_code ?? r.districtLgd ?? r.DistrictLGDcode;
  const districtName = r.districtName ?? r.district_name ?? r.District ?? r.name;
  const month = r.month ?? r.Month;
  const year = r.year ?? r.Year;
  const indexOutcome = r.indexOutcome ?? r.index_outcome;
  const rankOutcome = r.rankOutcome ?? r.rank_outcome;
  const indicators = r.indicators || r.Indicators || {};
  if (districtLgd == null || !districtName) return null;
  return {
    id: r.id ?? r.external_id ?? null,
    districtName: normalizeDistrictName(String(districtName).trim()),
    districtLgdCode: Number(districtLgd),
    month: month != null ? Number(month) : null,
    year: year != null ? Number(year) : null,
    indexOutcome: indexOutcome != null ? Number(indexOutcome) : null,
    rankOutcome: rankOutcome != null ? Number(rankOutcome) : null,
    indicators: typeof indicators === 'object' && indicators ? indicators : {},
  };
}

module.exports = {
  fetchDistrictOutcomeFromApi,
  normalizeApiBody,
  normalizeRow,
};
