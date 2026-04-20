require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const cardsRouter = require('./routes/cards');
const salesRouter = require('./routes/sales');

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('tiny'));

app.get('/', (_req, res) => {
  res.json({
    name: 'CardSync Pro API',
    status: 'ok',
    endpoints: [
      'GET    /health',
      'GET    /api/cards',
      'GET    /api/cards/:id',
      'POST   /api/cards',
      'PATCH  /api/cards/:id',
      'DELETE /api/cards/:id',
      'GET    /api/sales',
      'GET    /api/sales/:id',
      'POST   /api/sales',
      'PATCH  /api/sales/:id',
      'DELETE /api/sales/:id',
    ],
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/cards', cardsRouter);
app.use('/api/sales', salesRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`CardSync Pro API listening on port ${port}`);
});
