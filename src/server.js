const app = require('./app');
const config = require('./config');

app.listen(config.port, () => {
  console.log(`UP Health Dashboard API listening on http://localhost:${config.port}`);
  console.log(`Auth: POST /api/auth/login`);
});
