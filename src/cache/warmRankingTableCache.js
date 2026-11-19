/**
 * Warm Redis keys for table left-panel (hierarchy_only) so indicator switches
 * are Redis HITs instead of cold deep-dive rebuilds.
 */
const { query } = require('../db/pool');
const rankingDeepDiveService = require('../ranking/rankingDeepDiveService');
const {
  enabled,
  buildCacheKeyFromParts,
  setCachedResponse,
} = require('./rankingResponseCache');

let warmRunning = false;
let warmTimer = null;

function truthy(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

async function listWarmIndicators() {
  const { rows } = await query(
    `
    SELECT code
    FROM indicator
    WHERE is_active = TRUE AND code ~ '^IND\\d{3}$'
    ORDER BY sno NULLS LAST, code
    `
  );
  return ['RANK_COMPOSITE', ...rows.map((r) => String(r.code).toUpperCase())];
}

async function resolveWarmPeriod(period) {
  if (period) return String(period);
  try {
    const {
      listOutcomePeriodLabels,
    } = require('../outcome/outcomeRankingQueries');
    const labels = await listOutcomePeriodLabels();
    if (Array.isArray(labels) && labels.length) {
      return labels[labels.length - 1];
    }
  } catch (_) {
    /* fall through */
  }
  const { rows } = await query(
    `
    SELECT DISTINCT period_label
    FROM indicator_outcome_district
    WHERE period_label IS NOT NULL AND period_label <> ''
    ORDER BY period_label DESC
    LIMIT 1
    `
  );
  return rows[0]?.period_label || null;
}

function tableQuery({ period, mode, indicatorCode, filter = 'all' }) {
  const q = {
    view: 'table',
    level: mode,
    geo_level: mode,
    table_mode: mode,
    period: String(period),
    hierarchy_only: '1',
    labels: '1',
    panel_tab: 'indicators',
    analytics_compare: 'timeperiod',
    analytics_mode: 'month',
  };
  if (indicatorCode && String(indicatorCode).toUpperCase() !== 'RANK_COMPOSITE') {
    q.indicator_code = String(indicatorCode).toUpperCase();
  }
  if (filter && filter !== 'all') q.filter = filter;
  return q;
}

async function warmOne({ period, mode, indicatorCode, filter }) {
  const queryObj = tableQuery({ period, mode, indicatorCode, filter });
  const data = await rankingDeepDiveService.getDeepDiveDashboard({
    view: 'table',
    level: mode,
    tableMode: mode,
    period,
    indicatorCode,
    filter,
    hierarchyOnly: true,
    panelTab: 'indicators',
    labels: 1,
    analyticsCompare: 'timeperiod',
    analyticsMode: 'month',
  });
  const body = { success: true, ...data };
  const key = await buildCacheKeyFromParts({
    baseUrl: '/api/ranking',
    path: '/dashboard',
    query: queryObj,
    user: null,
  });
  await setCachedResponse(key, body);
  return key;
}

/**
 * Warm hierarchy_only table responses for current period × modes × indicators.
 * @param {{ period?: string, modes?: string[], filters?: string[], concurrency?: number, reason?: string }} opts
 */
async function warmTableHierarchyCache(opts = {}) {
  if (!enabled()) {
    return { ok: false, reason: 'cache-disabled', warmed: 0 };
  }
  if (warmRunning) {
    return { ok: false, reason: 'already-running', warmed: 0 };
  }

  warmRunning = true;
  const started = Date.now();
  let warmed = 0;
  let failed = 0;

  try {
    const period = await resolveWarmPeriod(opts.period);
    if (!period) {
      return { ok: false, reason: 'no-period', warmed: 0 };
    }

    const modes = opts.modes || ['division', 'district'];
    const filters = opts.filters || ['all'];
    const concurrency = Math.max(1, Math.min(4, Number(opts.concurrency) || 2));
    const indicators = await listWarmIndicators();

    const jobs = [];
    for (const mode of modes) {
      for (const filter of filters) {
        for (const indicatorCode of indicators) {
          jobs.push({ period, mode, indicatorCode, filter });
        }
      }
    }

    console.log(
      `[cache-warm] starting table hierarchy warm (${jobs.length} keys, period=${period}, reason=${opts.reason || 'manual'})`
    );

    let cursor = 0;
    async function worker() {
      while (cursor < jobs.length) {
        const idx = cursor++;
        const job = jobs[idx];
        try {
          await warmOne(job);
          warmed += 1;
          if (warmed % 10 === 0 || warmed === jobs.length) {
            console.log(`[cache-warm] progress ${warmed}/${jobs.length}`);
          }
        } catch (err) {
          failed += 1;
          console.warn(
            `[cache-warm] failed ${job.mode}/${job.indicatorCode}:`,
            err.message
          );
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    const ms = Date.now() - started;
    console.log(
      `[cache-warm] done warmed=${warmed} failed=${failed} in ${ms}ms (reason=${opts.reason || 'manual'})`
    );
    return { ok: true, warmed, failed, period, ms };
  } finally {
    warmRunning = false;
  }
}

/** Debounced background warm (used after outcome sync bump). */
function scheduleWarmTableHierarchyCache(opts = {}) {
  if (!enabled()) return;
  if (String(process.env.RANKING_CACHE_WARM || 'true').toLowerCase() === 'false') {
    return;
  }
  if (warmTimer) clearTimeout(warmTimer);
  const delayMs = Number(opts.delayMs) || 2500;
  warmTimer = setTimeout(() => {
    warmTableHierarchyCache(opts).catch((err) => {
      console.warn('[cache-warm] background warm failed:', err.message);
    });
  }, delayMs);
  if (typeof warmTimer.unref === 'function') warmTimer.unref();
}

function scheduleWarmOnBoot() {
  if (!truthy(process.env.RANKING_CACHE_WARM_ON_BOOT)) return;
  scheduleWarmTableHierarchyCache({ reason: 'boot', delayMs: 5000 });
}

module.exports = {
  warmTableHierarchyCache,
  scheduleWarmTableHierarchyCache,
  scheduleWarmOnBoot,
  listWarmIndicators,
};
