const express = require('express');
const { supabase } = require('../supabase');

const router = express.Router();

const CARD_FIELDS = [
  'name',
  'game',
  'set',
  'condition',
  'quantity',
  'purchase_price',
  'current_value',
  'platform',
  'date_purchased',
];

function pickCardFields(body) {
  const out = {};
  for (const key of CARD_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}

// GET /api/cards — list cards (supports ?game=&platform=&limit=&offset=)
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;

    let query = supabase.from('cards').select('*', { count: 'exact' });

    if (req.query.game) query = query.eq('game', req.query.game);
    if (req.query.platform) query = query.eq('platform', req.query.platform);
    if (req.query.name) query = query.ilike('name', `%${req.query.name}%`);

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    res.json({ data, count, limit, offset });
  } catch (err) {
    next(err);
  }
});

// GET /api/cards/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('cards')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Card not found' });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// POST /api/cards
router.post('/', async (req, res, next) => {
  try {
    const payload = pickCardFields(req.body || {});
    if (!payload.name || !payload.game) {
      return res.status(400).json({ error: 'name and game are required' });
    }
    const { data, error } = await supabase.from('cards').insert(payload).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/cards/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const payload = pickCardFields(req.body || {});
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    const { data, error } = await supabase
      .from('cards')
      .update(payload)
      .eq('id', req.params.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Card not found' });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/cards/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { error, count } = await supabase
      .from('cards')
      .delete({ count: 'exact' })
      .eq('id', req.params.id);
    if (error) throw error;
    if (!count) return res.status(404).json({ error: 'Card not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
