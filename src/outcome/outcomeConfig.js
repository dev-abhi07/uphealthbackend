/**
 * External district outcome API config.
 *
 * District ranking serves ONLY this API → DB cache (legacy ranking_value Excel is skipped).
 * Basic Auth: USER_NAME_UPDSUPERADMIN / PASSWORD_UPDSU
 * URL: OUTCOME_DISTRICT_API_URL with {month} {year} {period} placeholders
 */
function cleanEnv(v) {
  return String(v || '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

function outcomeConfig() {
  return {
    enabled: String(process.env.OUTCOME_API_ENABLED || 'true').toLowerCase() !== 'false',
    districtUrl: cleanEnv(process.env.OUTCOME_DISTRICT_API_URL),
    blockUrl: cleanEnv(process.env.OUTCOME_BLOCK_API_URL),
    timeoutMs: Number(process.env.OUTCOME_API_TIMEOUT_MS) || 8000,
    apiKey: cleanEnv(process.env.OUTCOME_API_KEY),
    basicUser: cleanEnv(process.env.USER_NAME_UPDSUPERADMIN),
    basicPass: cleanEnv(process.env.PASSWORD_UPDSU),
    preferOutcome: String(process.env.OUTCOME_PREFER_CACHE || 'true').toLowerCase() !== 'false',
    /** Auto-pull upstream on dashboard/table GET when true. */
    syncOnRead: String(process.env.OUTCOME_SYNC_ON_READ || 'false').toLowerCase() === 'true',
  };
}

function basicAuthHeader() {
  const { basicUser, basicPass } = outcomeConfig();
  if (!basicUser || !basicPass) return null;
  return 'Basic ' + Buffer.from(`${basicUser}:${basicPass}`).toString('base64');
}

function buildDistrictUrl(month, year) {
  const { districtUrl } = outcomeConfig();
  if (!districtUrl) return null;
  const period = `${year}-${String(month).padStart(2, '0')}`;
  return districtUrl
    .replace(/\{month\}/gi, String(month))
    .replace(/\{year\}/gi, String(year))
    .replace(/\{period\}/gi, period);
}

function buildBlockUrl(month, year) {
  const { blockUrl } = outcomeConfig();
  if (!blockUrl) return null;
  const period = `${year}-${String(month).padStart(2, '0')}`;
  return blockUrl
    .replace(/\{month\}/gi, String(month))
    .replace(/\{year\}/gi, String(year))
    .replace(/\{period\}/gi, period);
}

function parsePeriodInput({ period, month, year } = {}) {
  if (month != null && year != null) {
    const m = Number(month);
    const y = Number(year);
    if (m >= 1 && m <= 12 && y >= 2000) {
      return {
        month: m,
        year: y,
        period_label: `${y}-${String(m).padStart(2, '0')}`,
        period_display: displayMonth(m, y),
      };
    }
  }
  const raw = String(period || '').trim();
  const iso = raw.match(/^(\d{4})-(\d{2})$/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    return {
      month: m,
      year: y,
      period_label: raw,
      period_display: displayMonth(m, y),
    };
  }
  const named = raw.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (named) {
    const names = [
      'jan', 'feb', 'mar', 'apr', 'may', 'jun',
      'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
    ];
    const idx = names.findIndex((n) => named[1].toLowerCase().startsWith(n));
    if (idx >= 0) {
      const m = idx + 1;
      const y = Number(named[2]);
      return {
        month: m,
        year: y,
        period_label: `${y}-${String(m).padStart(2, '0')}`,
        period_display: displayMonth(m, y),
      };
    }
  }
  return null;
}

function displayMonth(month, year) {
  const names = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${names[month - 1]} ${year}`;
}

function prevPeriod(p) {
  let { month, year } = p;
  month -= 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return {
    month,
    year,
    period_label: `${year}-${String(month).padStart(2, '0')}`,
    period_display: displayMonth(month, year),
  };
}

module.exports = {
  cleanEnv,
  outcomeConfig,
  basicAuthHeader,
  buildDistrictUrl,
  buildBlockUrl,
  parsePeriodInput,
  displayMonth,
  prevPeriod,
};
