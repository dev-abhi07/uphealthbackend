/**
 * Probe external district outcome API with Basic Auth from .env
 * Does not print credentials.
 */
require('dotenv').config();

function cleanEnv(v) {
  return String(v || '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

const user = cleanEnv(process.env.USER_NAME_UPDSUPERADMIN);
const pass = cleanEnv(process.env.PASSWORD_UPDSU);
if (!user || !pass) {
  console.error('Missing USER_NAME_UPDSUPERADMIN or PASSWORD_UPDSU');
  process.exit(1);
}

const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

const configured = cleanEnv(process.env.OUTCOME_DISTRICT_API_URL);
const bases = [
  'http://15.207.155.107:5000',
  'http://15.207.155.107:8080',
  'http://15.207.155.107:3000',
  'http://15.207.155.107:3010',
  'http://15.207.155.107:4000',
  'http://15.207.155.107:7001',
  'http://15.207.155.107:7002',
  'http://192.168.18.137:5000',
  'http://192.168.18.137:8080',
  'http://192.168.18.137:4000',
  'http://192.168.18.137:7001',
];

const paths = [
  '/api/DistrictOutcome?month=6&year=2026',
  '/api/district-outcome?month=6&year=2026',
  '/api/district/ranking?month=6&year=2026',
  '/api/DistrictRanking?month=6&year=2026',
  '/api/DistrictRank?month=6&year=2026',
  '/api/v1/district?month=6&year=2026',
  '/api/v1/DistrictOutcome?month=6&year=2026',
  '/DistrictOutcome?month=6&year=2026',
  '/api/ranking/district?month=6&year=2026',
  '/api/IndicatorOutcome/district?month=6&year=2026',
  '/api/indicator-outcome/district?month=6&year=2026',
  '/api/UPHealth/DistrictOutcome?month=6&year=2026',
];

function looksLikeOutcome(j) {
  const row = Array.isArray(j) ? j[0] : j?.data?.[0] || j?.districts?.[0];
  return row && (row.districtName || row.districtLgdCode) && (row.indicators || row.indexOutcome != null);
}

async function tryUrl(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(url, {
      headers: { Authorization: auth, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) {
      return { url, status: res.status, kind: 'non-json' };
    }
    const j = await res.json();
    if (looksLikeOutcome(j)) {
      const arr = Array.isArray(j) ? j : j.data || j.districts || [];
      return {
        url,
        status: res.status,
        kind: 'HIT',
        count: arr.length,
        sample: arr[0]
          ? {
              districtName: arr[0].districtName,
              rankOutcome: arr[0].rankOutcome,
              indKeys: Object.keys(arr[0].indicators || {}).length,
            }
          : null,
      };
    }
    return {
      url,
      status: res.status,
      kind: 'json-other',
      keys: j && typeof j === 'object' ? Object.keys(j).slice(0, 8) : typeof j,
    };
  } catch (e) {
    clearTimeout(t);
    return null;
  }
}

(async () => {
  if (!user || !pass) {
    console.error('Missing Basic Auth env vars');
    process.exit(1);
  }
  console.log('Probing (credentials loaded from env, not printed)...');

  if (configured) {
    const url = configured
      .replace(/\{month\}/gi, '6')
      .replace(/\{year\}/gi, '2026')
      .replace(/\{period\}/gi, '2026-06');
    const r = await tryUrl(url);
    console.log('configured URL result:', r && r.kind, r && r.status, r && r.url);
    if (r && r.kind === 'HIT') {
      console.log('SUCCESS', JSON.stringify({ url: r.url, count: r.count, sample: r.sample }));
      process.exit(0);
    }
  }

  for (const b of bases) {
    for (const path of paths) {
      const r = await tryUrl(b + path);
      if (!r) continue;
      if (r.kind === 'HIT') {
        console.log('SUCCESS', JSON.stringify({ url: r.url, count: r.count, sample: r.sample }));
        process.exit(0);
      }
      if (r.status && r.status !== 404) {
        console.log(r.status, r.kind, r.url);
      }
    }
  }
  console.log('No matching endpoint found');
  process.exit(2);
})();
