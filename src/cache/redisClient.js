const Redis = require('ioredis');
const config = require('../config');

/** @type {import('ioredis').Redis | null} */
let client = null;
let connectAttempted = false;
let available = false;

/**
 * Lazy Redis connection. Never throws to callers — ranking keeps working
 * with the in-memory fallback when Redis is down / unset.
 */
function getRedis() {
  if (!config.redis?.enabled) return null;
  if (connectAttempted) return client;

  connectAttempted = true;
  try {
    client = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password || undefined,
      db: config.redis.db,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 3000,
      retryStrategy(times) {
        if (times > 10) return null;
        return Math.min(times * 250, 3000);
      },
    });

    client.on('ready', () => {
      available = true;
      console.log(
        `[cache] Redis connected ${config.redis.host}:${config.redis.port}`
      );
    });
    client.on('error', (err) => {
      available = false;
      // Avoid log spam on repeated ECONNREFUSED while Redis is offline
      if (!getRedis._warned) {
        getRedis._warned = true;
        console.warn(
          `[cache] Redis unavailable (${err.message}) — using in-memory fallback`
        );
      }
    });
    client.on('end', () => {
      available = false;
    });
    client.on('reconnecting', () => {
      getRedis._warned = false;
    });

    client.connect().catch(() => {
      available = false;
    });
  } catch (err) {
    available = false;
    console.warn(
      `[cache] Redis init failed (${err.message}) — using in-memory fallback`
    );
    client = null;
  }

  return client;
}

function isRedisReady() {
  return Boolean(available && client && client.status === 'ready');
}

async function quitRedis() {
  if (!client) return;
  try {
    await client.quit();
  } catch (_) {
    /* ignore */
  }
  client = null;
  available = false;
  connectAttempted = false;
}

module.exports = {
  getRedis,
  isRedisReady,
  quitRedis,
};
