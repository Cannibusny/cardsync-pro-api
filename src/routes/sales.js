const express = require('express');
const { supabase } = require('../supabase');

const router = express.Router();

const SALE_FIELDS = ['card_id', 'sale_price', 'platform', 'sale_date', 'profit'];

function pickSaleFields(body) {
  const out = {};
  for (const key of SALE_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}

// GET /api/sales — list sales (supports ?card_id=&platform=&limit=&offset=)
router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;

    let query = supabase.from('sales').select('*', { count: 'exact' });
    if (req.query.card_id) query = query.eq('card_id', req.query.card_id);
    if (req.query.platform) query = query.eq('platform', req.query.platform);

    const { data, error, count } = await query
      .order('sale_date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    res.json({ data, count, limit, offset });
  } catch (err) {
    next(err);
  }
});

// GET /api/sales/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('sales')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Sale not found' });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// POST /api/sales — auto-computes profit if not provided, using card.purchase_price
router.post('/', async (req, res, next) => {
  try {
    const payload = pickSaleFields(req.body || {});
    if (!payload.card_id || payload.sale_price === undefined) {
      return res.status(400).json({ error: 'card_id and sale_price are required' });
    }

    if (payload.profit === undefined) {
      const { data: card, error: cardErr } = await supabase
        .from('cards')
        .select('purchase_price')
        .eq('id', payload.card_id)
        .maybeSingle();
      if (cardErr) throw cardErr;
      if (!card) return res.status(400).json({ error: 'card_id does not reference an existing card' });
      payload.profit = Number(payload.sale_price) - Number(card.purchase_price || 0);
    }

    const { data, error } = await supabase.from('sales').insert(payload).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/sales/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const payload = pickSaleFields(req.body || {});
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    const { data, error } = await supabase
      .from('sales')
      .update(payload)
      .eq('id', req.params.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Sale not found' });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/sales/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { error, count } = await supabase
      .from('sales')
      .delete({ count: 'exact' })
      .eq('id', req.params.id);
    if (error) throw error;
    if (!count) return res.status(404).json({ error: 'Sale not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
