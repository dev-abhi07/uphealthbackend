require('dotenv').config();

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'uphealthdashboard',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },
  /**
   * How many simultaneous logins the same userid may keep.
   * Oldest active sessions are revoked when a new login exceeds this.
   * Override via MAX_CONCURRENT_SESSIONS (default 2).
   */
  maxConcurrentSessions: (() => {
    const n = Number(process.env.MAX_CONCURRENT_SESSIONS ?? 2);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2;
  })(),
  outcome: {
    enabled: String(process.env.OUTCOME_API_ENABLED || 'true').toLowerCase() !== 'false',
    districtUrl: process.env.OUTCOME_DISTRICT_API_URL || '',
    timeoutMs: Number(process.env.OUTCOME_API_TIMEOUT_MS) || 8000,
    apiKey: process.env.OUTCOME_API_KEY || '',
  },
  /**
   * Ranking API response cache (Redis + in-memory fallback).
   * Fresh monthly sync bumps the generation and drops all cached payloads.
   */
  redis: {
    enabled: String(process.env.REDIS_ENABLED || 'true').toLowerCase() !== 'false',
    cacheEnabled:
      String(process.env.RANKING_RESPONSE_CACHE || 'true').toLowerCase() !== 'false',
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || '',
    db: Number(process.env.REDIS_DB) || 0,
    /** Default 30 days — data only refreshes on monthly sync. */
    ttlSeconds: Number(process.env.RANKING_CACHE_TTL_SECONDS) || 60 * 60 * 24 * 30,
  },
};
