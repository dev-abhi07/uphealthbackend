/**
 * Fire FE-like parallel ranking requests to try to reproduce "out of shared memory".
 */
const http = require('http');

const PORT = process.env.PORT || 3010;
const BASE = `http://127.0.0.1:${PORT}`;

function request(method, path, { token, body, maxBody = 400 } = {}) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      `${BASE}${path}`,
      {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            body: maxBody ? data.slice(0, maxBody) : data,
            path,
          });
        });
      },
    );
    req.on('error', (err) =>
      resolve({ status: 0, body: err.message, path }),
    );
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const login = await request('POST', '/api/auth/login', {
    body: { username: 'state.admin', password: 'Pass@123' },
    maxBody: 0,
  });
  let token = '';
  try {
    const parsed = JSON.parse(login.body);
    token = parsed?.data?.token || parsed?.token || '';
  } catch {
    /* ignore */
  }
  if (!token) {
    console.error('Login failed', login);
    process.exit(1);
  }
  console.log('Logged in as state.admin');

  const paths = [
    '/api/ranking/executive-summary?period=2026-07&level=division',
    '/api/ranking/executive-summary?period=2026-07&level=district',
    '/api/ranking/dashboard?level=district&geo_level=district&view=map&period=2026-07&panel_tab=indicators',
    '/api/ranking/dashboard?level=division&geo_level=division&view=map&period=2026-07&panel_tab=indicators',
    '/api/ranking/dashboard?level=district&geo_level=district&view=table&table_mode=district&period=2026-07&breakup_only=1&breakup_tab=indicators',
    '/api/ranking/dashboard?level=district&geo_level=district&view=table&table_mode=district&period=2026-07&panel_tab=indicators',
    '/api/ranking/rank-insights?period=2026-07&level=district',
    '/api/ranking/analytics?period=2026-07&mode=month&compare=timeperiod',
  ];

  console.log('Warmup executive...');
  const warm = await request('GET', paths[0], { token });
  console.log(warm.status, warm.body.slice(0, 120));

  const heavy = [
    '/api/ranking/rank-insights?period=2026-07&level=district',
    '/api/ranking/rank-insights?period=2026-07&level=division',
    '/api/ranking/dashboard?level=district&geo_level=district&view=table&table_mode=district&period=2026-07&breakup_only=1&breakup_tab=indicators',
    '/api/ranking/dashboard?level=district&geo_level=block&view=table&table_mode=block&period=2026-07&panel_tab=indicators',
    '/api/ranking/executive-summary?period=2026-07&level=district',
    '/api/ranking/analytics?period=2026-07&mode=month&compare=timeperiod',
  ];

  for (const waves of [8, 16]) {
    console.log(`\nBurst x${waves} heavy paths in parallel...`);
    const jobs = [];
    for (let i = 0; i < waves; i += 1) {
      for (const p of heavy) jobs.push(request('GET', p, { token }));
    }
    const t0 = Date.now();
    const results = await Promise.all(jobs);
    const shared = results.filter((r) => /shared memory/i.test(r.body));
    const fails = results.filter((r) => r.status >= 400 || r.status === 0);
    const byStatus = {};
    for (const r of results) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    }
    console.log(
      'total',
      results.length,
      'ms',
      Date.now() - t0,
      'httpFails',
      fails.length,
      'sharedMemory',
      shared.length,
      'byStatus',
      byStatus,
    );
    [...shared, ...fails.filter((f) => !/shared memory/i.test(f.body))]
      .slice(0, 20)
      .forEach((f) => console.log(f.status, f.path, f.body.slice(0, 200)));
    if (shared.length) break;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
