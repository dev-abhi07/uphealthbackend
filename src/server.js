const app = require('./app');
const config = require('./config');
const { getRedis } = require('./cache/redisClient');

// Warm Redis (non-blocking). Ranking still works via in-memory fallback if down.
if (config.redis?.enabled) {
  getRedis();
}

app.listen(config.port, () => {
  console.log(`UP Health Dashboard API listening on http://localhost:${config.port}`);
  console.log(`Auth: POST /api/auth/login`);
  if (config.redis?.cacheEnabled) {
    console.log(
      `Ranking response cache: on (Redis ${config.redis.host}:${config.redis.port}, TTL ${config.redis.ttlSeconds}s)`
    );
  }
});
