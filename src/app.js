const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const rankingRoutes = require('./routes/rankingRoutes');
const healthRankingRoutes = require('./routes/healthRankingRoutes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));

app.get('/health', (req, res) => {
  res.json({ success: true, status: 'ok', service: 'uphealthdashboard' });
});

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/ranking', rankingRoutes);
app.use('/api/health-ranking', healthRankingRoutes);
app.use('/api/upload', uploadRoutes);
// Frontend sometimes calls /upload (without /api prefix)
app.use('/upload', uploadRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
