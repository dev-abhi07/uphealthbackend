const crypto = require('crypto');
const config = require('../config');
const { getRedis, isRedisReady } = require('./redisClient');

const GEN_KEY = 'uphealth:ranking:cache_gen';
const KEY_PREFIX = 'uphealth:ranking:resp';

/** In-process fallback when Redis is off / unreachable. */
const memory = new Map();
let memoryGen = 1;

const MAX_MEMORY_ENTRIES = 400;

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
 */
function scopeFingerprint(user) {
  if (!user) return 'anon';
  const roles = Array.isArray(user.roles) ? [...user.roles].sort().join(',') : '';
  return hash(
    [
      user.sub || user.id || '',
      user.username || '',
      roles,
      user.geo_level || user.level || '',
      user.division_id || user.divisionId || '',
      user.division_code || user.divisionCode || '',
      user.district_lgd || user.districtLgd || '',
      user.block_lgd || user.blockLgd || '',
    ].join('|')
  );
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
  return { ok: true, generation: gen, reason };
}

function buildCacheKey(gen, req) {
  const userKey = scopeFingerprint(req.user);
  const path = String(req.baseUrl || '') + String(req.path || '');
  const query = stableStringify(req.query || {});
  const digest = hash(`${path}?${query}|${userKey}`);
  return `${KEY_PREFIX}:${gen}:${digest}`;
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

  memorySet(key, body, ttl);

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
 * Place after `authenticate`.
 */
function rankingResponseCacheMiddleware(req, res, next) {
  if (!enabled() || req.method !== 'GET') return next();
  // Never cache export/download style paths if mounted here later
  if (String(req.path || '').includes('/export')) return next();

  let settled = false;

  getCachedResponse(req)
    .then((hit) => {
      if (settled) return;
      if (hit?.body) {
        settled = true;
        res.setHeader('X-Cache', `HIT-${hit.source}`);
        return res.json(hit.body);
      }

      const cacheKey = hit?.key;
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        if (!settled && res.statusCode < 400) {
          settled = true;
          res.setHeader('X-Cache', 'MISS');
          if (cacheKey) {
            setCachedResponse(cacheKey, body).catch(() => {});
          }
        }
        return originalJson(body);
      };
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
};
