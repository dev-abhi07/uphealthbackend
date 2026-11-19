const crypto = require('crypto');
const config = require('../config');
const { getRedis, isRedisReady } = require('./redisClient');

const GEN_KEY = 'uphealth:ranking:cache_gen';
const KEY_PREFIX = 'uphealth:ranking:resp';

/** In-process fallback when Redis is off / unreachable. */
const memory = new Map();
let memoryGen = 1;

const MAX_MEMORY_ENTRIES = 80;
/** Skip in-memory store for huge payloads (Redis still used when available). */
const MAX_MEMORY_VALUE_BYTES = 1.5 * 1024 * 1024;

/** Coalesce concurrent MISS builds for the same cache key. */
const inflightByKey = new Map();

function enabled() {
  return config.redis?.cacheEnabled !== false;
}

function ttlSeconds() {
  const n = Number(config.redis?.ttlSeconds);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 60 * 60 * 24 * 30; // 30d
}

function stableStringify(value) {
  if (value == null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
    .join(',')}}`;
}

function hash(parts) {
  return crypto.createHash('sha1').update(parts).digest('hex').slice(0, 24);
}

/**
 * Scope fingerprint so division/district/block logins never share a state-admin cache entry.
 * Statewide admins share one fingerprint (same payload) for better hit rate.
 */
function scopeFingerprint(user) {
  if (!user) return 'anon';
  const rolesArr = Array.isArray(user.roles) ? [...user.roles].map(String).sort() : [];
  const roles = rolesArr.join(',');
  const geoLevel = String(user.geo_level || user.level || '').toLowerCase();
  const divisionId = user.division_id || user.divisionId || '';
  const divisionCode = user.division_code || user.divisionCode || '';
  const districtLgd = user.district_lgd || user.districtLgd || '';
  const blockLgd = user.block_lgd || user.blockLgd || '';
  const hasGeoLock = Boolean(divisionId || divisionCode || districtLgd || blockLgd);
  const statewideRole = rolesArr.some((r) =>
    ['state_admin', 'system_admin', 'sysadmin', 'admin'].includes(
      String(r).toLowerCase()
    )
  );
  if (statewideRole && !hasGeoLock && (!geoLevel || geoLevel === 'state')) {
    return hash(`statewide|${roles}`);
  }
  return hash(
    [
      user.sub || user.id || '',
      user.username || '',
      roles,
      geoLevel,
      divisionId,
      divisionCode,
      districtLgd,
      blockLgd,
    ].join('|')
  );
}

/**
 * Statewide Division/District table payloads are identical for all logins —
 * share one Redis key instead of fragmenting by user id.
 */
function isStatewideTableQuery(query = {}) {
  const view = String(query.view || '').toLowerCase();
  if (view !== 'table') return false;
  const mode = String(
    query.table_mode || query.level || query.geo_level || ''
  ).toLowerCase();
  if (mode !== 'division' && mode !== 'district') return false;
  // Area-scoped breakup / block drill must stay user/geo specific
  if (
    query.district ||
    query.district_name ||
    query.district_id ||
    query.district_lgd ||
    query.dt_lgd ||
    query.block ||
    query.block_name ||
    query.block_id ||
    query.block_lgd ||
    query.division ||
    query.div_code ||
    query.division_id
  ) {
    return false;
  }
  return true;
}

function scopeFingerprintForRequest(req) {
  if (isStatewideTableQuery(req?.query || {})) {
    return hash('statewide|table');
  }
  return scopeFingerprint(req?.user);
}

async function getGeneration() {
  const redis = getRedis();
  if (isRedisReady() && redis) {
    try {
      const raw = await redis.get(GEN_KEY);
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
      await redis.set(GEN_KEY, '1');
      return 1;
    } catch (_) {
      /* fall through */
    }
  }
  return memoryGen;
}

/**
 * Bump generation so every previous response key becomes unreachable.
 * Called after monthly outcome sync / ingest.
 */
async function bumpCacheGeneration(reason = 'sync') {
  if (!enabled()) return { ok: false, reason: 'disabled' };

  let gen = memoryGen + 1;
  memoryGen = gen;
  memory.clear();
  inflightByKey.clear();

  const redis = getRedis();
  if (isRedisReady() && redis) {
    try {
      gen = await redis.incr(GEN_KEY);
      memoryGen = gen;
      // Old keys keep the previous generation in their name and become unreachable.
      // They expire via TTL — no SCAN/DEL race against live traffic.
    } catch (err) {
      console.warn('[cache] bump via Redis failed:', err.message);
    }
  }

  console.log(`[cache] ranking response cache reset (gen=${gen}, reason=${reason})`);

  // Rebuild table left-panel keys in background (new indicators stay fast)
  try {
    const { scheduleWarmTableHierarchyCache } = require('./warmRankingTableCache');
    scheduleWarmTableHierarchyCache({ reason: `after-${reason}`, generation: gen });
  } catch (err) {
    console.warn('[cache] warm schedule failed:', err.message);
  }

  return { ok: true, generation: gen, reason };
}

/** Query keys that must not affect response identity (FE cache-busters, etc.). */
const VOLATILE_QUERY_KEYS = new Set([
  '_ts',
  '_t',
  'ts',
  'timestamp',
  '_',
  'nonce',
  'cache_bust',
  'cacheBust',
]);

/**
 * UI-only keys that do not change hierarchy rankings for hierarchy_only table loads.
 * Keeping them out of the Redis key improves hit rate across minor FE default diffs.
 */
const HIERARCHY_ONLY_IGNORE_KEYS = new Set([
  'panel_tab',
  'breakup_tab',
  'breakup_group',
  'group_by',
  'labels',
  'analytics_compare',
]);

function stableQueryForCache(query) {
  const cleaned = {};
  const q = query || {};
  const hierarchyOnly =
    q.hierarchy_only === '1' ||
    q.hierarchy_only === 'true' ||
    q.hierarchyOnly === '1' ||
    q.hierarchyOnly === 'true';

  for (const [k, v] of Object.entries(q)) {
    const key = String(k);
    if (VOLATILE_QUERY_KEYS.has(key)) continue;
    if (hierarchyOnly && HIERARCHY_ONLY_IGNORE_KEYS.has(key)) continue;
    cleaned[key] = v;
  }
  return stableStringify(cleaned);
}

function buildCacheKey(gen, req) {
  const userKey = scopeFingerprintForRequest(req);
  const path = String(req.baseUrl || '') + String(req.path || '');
  const query = stableQueryForCache(req.query || {});
  const digest = hash(`${path}?${query}|${userKey}`);
  return `${KEY_PREFIX}:${gen}:${digest}`;
}

/**
 * Build the same Redis key the middleware would use (for warm jobs).
 * @param {{ path?: string, query?: object, user?: object }} parts
 */
async function buildCacheKeyFromParts(parts = {}) {
  const gen = await getGeneration();
  const fakeReq = {
    baseUrl: parts.baseUrl || '/api/ranking',
    path: parts.path || '/dashboard',
    query: parts.query || {},
    user: parts.user || null,
  };
  return buildCacheKey(gen, fakeReq);
}

function memorySet(key, value, ttlSec) {
  if (memory.size >= MAX_MEMORY_ENTRIES) {
    const first = memory.keys().next().value;
    if (first != null) memory.delete(first);
  }
  memory.set(key, {
    value,
    expiresAt: Date.now() + ttlSec * 1000,
  });
}

function memoryGet(key) {
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return hit.value;
}

async function getCachedResponse(req) {
  if (!enabled()) return null;
  const gen = await getGeneration();
  const key = buildCacheKey(gen, req);

  const redis = getRedis();
  if (isRedisReady() && redis) {
    try {
      const raw = await redis.get(key);
      if (raw) {
        return { key, body: JSON.parse(raw), source: 'redis' };
      }
    } catch (_) {
      /* fall through to memory */
    }
  }

  const mem = memoryGet(key);
  if (mem) return { key, body: mem, source: 'memory' };
  return { key, body: null, source: null };
}

async function setCachedResponse(key, body) {
  if (!enabled() || body == null) return;
  // Do not cache auth failures / errors
  if (body.success === false) return;

  const ttl = ttlSeconds();
  const payload = JSON.stringify(body);

  if (Buffer.byteLength(payload, 'utf8') <= MAX_MEMORY_VALUE_BYTES) {
    memorySet(key, body, ttl);
  }

  const redis = getRedis();
  if (isRedisReady() && redis) {
    try {
      await redis.set(key, payload, 'EX', ttl);
    } catch (err) {
      console.warn('[cache] Redis SET failed:', err.message);
    }
  }
}

/**
 * Express middleware: cache successful JSON bodies for ranking GET routes.
 * Place after `authenticate`. Supports Redis HIT + singleflight on MISS.
 */
function rankingResponseCacheMiddleware(req, res, next) {
  if (!enabled() || req.method !== 'GET') return next();
  // Never cache export/download style paths if mounted here later
  if (String(req.path || '').includes('/export')) return next();

  let settled = false;

  getCachedResponse(req)
    .then(async (hit) => {
      if (settled) return;
      if (hit?.body) {
        settled = true;
        res.setHeader('X-Cache', `HIT-${hit.source}`);
        return res.json(hit.body);
      }

      const cacheKey = hit?.key;
      if (!cacheKey) return next();

      // Singleflight: wait for an in-progress MISS for the same key
      const pending = inflightByKey.get(cacheKey);
      if (pending) {
        try {
          const body = await pending;
          if (settled) return;
          if (body) {
            settled = true;
            res.setHeader('X-Cache', 'HIT-coalesce');
            return res.json(body);
          }
        } catch (_) {
          /* fall through and compute */
        }
      }

      let resolveInflight = () => {};
      const flight = new Promise((resolve) => {
        resolveInflight = resolve;
      });
      inflightByKey.set(cacheKey, flight);

      const finishFlight = (body) => {
        resolveInflight(body || null);
        if (inflightByKey.get(cacheKey) === flight) {
          inflightByKey.delete(cacheKey);
        }
      };

      const originalJson = res.json.bind(res);
      res.json = (body) => {
        if (!settled && res.statusCode < 400) {
          settled = true;
          res.setHeader('X-Cache', 'MISS');
          if (cacheKey && body && body.success !== false) {
            setCachedResponse(cacheKey, body).catch(() => {});
          }
          finishFlight(body && body.success !== false ? body : null);
        } else if (!settled) {
          finishFlight(null);
        }
        return originalJson(body);
      };

      res.on('close', () => {
        if (!settled) finishFlight(null);
      });

      return next();
    })
    .catch(() => {
      if (!settled) next();
    });
}

module.exports = {
  enabled,
  bumpCacheGeneration,
  getCachedResponse,
  setCachedResponse,
  rankingResponseCacheMiddleware,
  scopeFingerprint,
  scopeFingerprintForRequest,
  isStatewideTableQuery,
  buildCacheKeyFromParts,
  ttlSeconds,
};
