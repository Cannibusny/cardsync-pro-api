require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');

const { errorHandler } = require('./lib/errors');
const { attachUser } = require('./middleware/auth');
const { refreshAll } = require('./services/tcgcsv');

const authRouter         = require('./routes/auth');
const cardsRouter        = require('./routes/cards');
const customersRouter    = require('./routes/customers');
const transactionsRouter = require('./routes/transactions');
const usersRouter        = require('./routes/users');
const pricesRouter       = require('./routes/prices');
const reportsRouter      = require('./routes/reports');
const uploadRouter       = require('./routes/upload');
const tradeInsRouter     = require('./routes/trade-ins');
const settingsRouter     = require('./routes/settings');
const gradingRouter      = require('./routes/grading');
const eventsRouter       = require('./routes/events');

const app = express();

// CORS — allow the frontend dev server in development; same-origin requests
// from the bundled web app are unaffected.
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins, credentials: true }));

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'tiny'));
app.use(attachUser);

// ----- Public routes -----
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'cardsync-pro-api',
    version: require('../package.json').version,
  });
});

// ----- API routes -----
app.use('/api/auth',         authRouter);
app.use('/api/cards',        cardsRouter);
app.use('/api/customers',    customersRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/users',        usersRouter);
app.use('/api/prices',       pricesRouter);
app.use('/api/reports',      reportsRouter);
app.use('/api/upload',       uploadRouter);
app.use('/api/trade-ins',    tradeInsRouter);
app.use('/api/settings',     settingsRouter);
app.use('/api/grading',      gradingRouter);
app.use('/api/events',       eventsRouter);

// ----- Static frontend (when web/ has been built) -----
const webDist = path.join(__dirname, '..', 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  // SPA fallback: any non-/api path returns index.html so client-side routing works.
  app.get(/^(?!\/api|\/health).*/, (_req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.json({
      name: 'CardSync Pro API',
      status: 'ok',
      docs: 'See README.md',
    });
  });
}

// ----- 404 + error handler -----
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

// ----- Scheduled jobs -----
function scheduleTcgcsvRefresh() {
  const cronExpr = process.env.TCGCSV_REFRESH_CRON || '0 3 * * *';
  const cats = (process.env.TCGCSV_CATEGORIES || '3,1,2,23')
    .split(',').map((s) => Number(s.trim())).filter(Number.isInteger);

  if (!cron.validate(cronExpr)) {
    console.warn(`[cron] invalid TCGCSV_REFRESH_CRON: ${cronExpr} — skipping schedule`);
    return;
  }
  cron.schedule(cronExpr, () => {
    console.log('[cron] starting scheduled TCGCSV refresh');
    refreshAll(cats)
      .then((summary) => console.log('[cron] TCGCSV refresh complete:', summary))
      .catch((err) => console.error('[cron] TCGCSV refresh failed:', err));
  });
  console.log(`[cron] scheduled TCGCSV refresh "${cronExpr}" for categories [${cats.join(',')}]`);
}

const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, () => {
  console.log(`CardSync Pro API listening on port ${port}`);
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    scheduleTcgcsvRefresh();
  } else {
    console.warn('[startup] Supabase env not set — skipping scheduled jobs.');
  }
});

// Graceful shutdown so Railway/Nixpacks can restart cleanly.
function shutdown(signal) {
  console.log(`Received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = app;
