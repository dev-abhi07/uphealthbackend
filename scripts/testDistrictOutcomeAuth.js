/**
 * Test Basic Auth against known DistrictOutcome host.
 * Does not print username/password.
 */
require('dotenv').config();

function cleanEnv(v) {
  return String(v || '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

const user = cleanEnv(process.env.USER_NAME_UPDSUPERADMIN);
const pass = cleanEnv(process.env.PASSWORD_UPDSU);
const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

const urls = [
  'http://15.207.155.107:3000/api/DistrictOutcome?month=6&year=2026',
  'http://15.207.155.107:3000/api/district-outcome?month=6&year=2026',
  'http://15.207.155.107:3000/api/DistrictOutcome/GetAll?month=6&year=2026',
  'http://15.207.155.107:3000/swagger',
  'http://15.207.155.107:3000/swagger/index.html',
  'http://15.207.155.107:3000/swagger/v1/swagger.json',
];

(async () => {
  console.log('user length', user.length, 'pass length', pass.length, 'hasHash', pass.includes('#'));
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: auth, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      const ct = res.headers.get('content-type') || '';
      let info = '';
      if (ct.includes('json')) {
        const j = await res.json();
        if (Array.isArray(j)) {
          info = `array len=${j.length}`;
          if (j[0]?.districtName) info += ` first=${j[0].districtName} rank=${j[0].rankOutcome} inds=${Object.keys(j[0].indicators || {}).length}`;
        } else if (j && typeof j === 'object') {
          info = `keys=${Object.keys(j).slice(0, 10).join(',')}`;
        }
      } else {
        info = (await res.text()).slice(0, 120).replace(/\s+/g, ' ');
      }
      console.log(res.status, url, info);
    } catch (e) {
      console.log('ERR', url, e.name || e.message);
    }
  }
})();
