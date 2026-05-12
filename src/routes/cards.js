const express = require('express');

const { getSupabase } = require('../supabase');
const { validate } = require('../lib/validate');
const { notFound, badRequest } = require('../lib/errors');
const { requireAuth, requireMinRole } = require('../middleware/auth');
const { logActivity } = require('../middleware/activity-log');

const router = express.Router();

const GAMES        = ['pokemon','magic','yugioh','onepiece','other'];
const CONDITIONS   = ['NM','LP','MP','HP','DMG','SEALED'];
const PRODUCT_TYPES = ['single','sealed','graded','supply','other'];
const GRADE_SERVICES = ['PSA','BGS','CGC','SGC'];

// Condition price multipliers per spec.
const CONDITION_MULTIPLIER = {
  NM: 1.00, LP: 0.85, MP: 0.70, HP: 0.50, DMG: 0.30, SEALED: 1.00,
};

function applyCondition(basePrice, condition) {
  const m = CONDITION_MULTIPLIER[condition] || 1.0;
  return Math.round((Number(basePrice || 0) * m) * 100) / 100;
}

const CREATE_SPEC = {
  name:           { type: 'string',  required: true,  max: 300 },
  game:           { type: 'string',  required: true,  in: GAMES },
  card_set:       { type: 'string',  max: 200 },
  number:         { type: 'string',  max: 50 },
  rarity:         { type: 'string',  max: 50 },
  tcgplayer_id:   { type: 'int',     min: 0 },
  product_type:   { type: 'string',  in: PRODUCT_TYPES },
  condition:      { type: 'string',  in: CONDITIONS },
  graded:         { type: 'boolean' },
  grade_service:  { type: 'string',  in: GRADE_SERVICES },
  grade:          { type: 'string',  max: 40 },
  cert_number:    { type: 'string',  max: 80 },
  quantity:       { type: 'int',     min: 0 },
  quantity_reserved: { type: 'int',  min: 0 },
  cost_basis:     { type: 'number',  min: 0 },
  sell_price:     { type: 'number',  min: 0 },
  market_price:   { type: 'number',  min: 0 },
  location:       { type: 'string',  max: 120 },
  image_url:      { type: 'string',  max: 2000 },
  notes:          { type: 'string',  max: 4000 },
  source:         { type: 'string',  max: 200 },
  date_acquired:  { type: 'date' },
};

const UPDATE_SPEC = Object.fromEntries(
  Object.entries(CREATE_SPEC).map(([k, v]) => [k, { ...v, required: false }])
);

router.use(requireAuth);

// GET /api/cards — list with filters
router.get('/', async (req, res, next) => {
  try {
    const limit  = Math.min(Number(req.query.limit)  || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const supabase = getSupabase();
    let query = supabase.from('cards').select('*', { count: 'exact' });

    if (req.query.game)         query = query.eq('game', req.query.game);
    if (req.query.product_type) query = query.eq('product_type', req.query.product_type);
    if (req.query.condition)    query = query.eq('condition', req.query.condition);
    if (req.query.card_set)     query = query.eq('card_set', req.query.card_set);
    if (req.query.location)     query = query.eq('location', req.query.location);
    if (req.query.graded != null) query = query.eq('graded', req.query.graded === 'true');
    if (req.query.in_stock === 'true') query = query.gt('quantity', 0);
    if (req.query.q) query = query.ilike('name', `%${req.query.q}%`);

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    res.json({ data, count, limit, offset });
  } catch (err) { next(err); }
});

// GET /api/cards/:id
router.get('/:id', async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('cards').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Card not found');
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/cards
router.post('/', requireMinRole('employee'), async (req, res, next) => {
  try {
    const payload = validate(req.body, CREATE_SPEC);
    payload.source = payload.source || 'manual';

    const supabase = getSupabase();
    const { data, error } = await supabase.from('cards').insert(payload).select().single();
    if (error) throw error;

    logActivity({
      user: req.user, req,
      action: 'card.create', resourceType: 'card', resourceId: data.id,
      details: { name: data.name, game: data.game, qty: data.quantity },
    });

    res.status(201).json(data);
  } catch (err) { next(err); }
});

// PATCH /api/cards/:id
router.patch('/:id', requireMinRole('employee'), async (req, res, next) => {
  try {
    const payload = validate(req.body, UPDATE_SPEC);
    if (Object.keys(payload).length === 0) throw badRequest('No fields to update');

    // Employees may not change cost_basis or sell_price (spec: "cannot change prices").
    if (req.user.role === 'employee') {
      delete payload.cost_basis;
      delete payload.sell_price;
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('cards').update(payload).eq('id', req.params.id).select().maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Card not found');

    logActivity({
      user: req.user, req,
      action: 'card.update', resourceType: 'card', resourceId: data.id,
      details: { fields: Object.keys(payload) },
    });

    res.json(data);
  } catch (err) { next(err); }
});

// DELETE /api/cards/:id (managers and above only)
router.delete('/:id', requireMinRole('manager'), async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const { error, count } = await supabase
      .from('cards').delete({ count: 'exact' }).eq('id', req.params.id);
    if (error) throw error;
    if (!count) throw notFound('Card not found');

    logActivity({
      user: req.user, req,
      action: 'card.delete', resourceType: 'card', resourceId: req.params.id,
    });

    res.status(204).send();
  } catch (err) { next(err); }
});

// POST /api/cards/:id/reprice  — set sell_price = condition-adjusted market price
router.post('/:id/reprice', requireMinRole('manager'), async (req, res, next) => {
  try {
    const { multiplier } = validate(req.body || {}, {
      multiplier: { type: 'number', min: 0.1, max: 10 },
    });

    const supabase = getSupabase();
    const { data: card, error: getErr } = await supabase
      .from('cards').select('*').eq('id', req.params.id).maybeSingle();
    if (getErr) throw getErr;
    if (!card) throw notFound('Card not found');
    if (!card.market_price) throw badRequest('Card has no market_price (run /api/prices/refresh first)');

    const conditionAdjusted = applyCondition(card.market_price, card.condition);
    const newPrice = Math.round(conditionAdjusted * (multiplier || 1.0) * 100) / 100;

    const { data, error } = await supabase
      .from('cards').update({ sell_price: newPrice }).eq('id', req.params.id).select().single();
    if (error) throw error;

    logActivity({
      user: req.user, req,
      action: 'card.reprice', resourceType: 'card', resourceId: data.id,
      details: { from: card.sell_price, to: newPrice, multiplier },
    });

    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/cards/bulk-reprice  — reprice all cards matching filters
router.post('/bulk-reprice', requireMinRole('manager'), async (req, res, next) => {
  try {
    const { game, product_type, condition, multiplier } = validate(req.body || {}, {
      game:         { type: 'string', in: GAMES },
      product_type: { type: 'string', in: PRODUCT_TYPES },
      condition:    { type: 'string', in: CONDITIONS },
      multiplier:   { type: 'number', required: true, min: 0.1, max: 10 },
    });

    const supabase = getSupabase();
    let query = supabase.from('cards').select('*').not('market_price', 'is', null);
    if (game)         query = query.eq('game', game);
    if (product_type) query = query.eq('product_type', product_type);
    if (condition)    query = query.eq('condition', condition);

    const { data: rows, error } = await query;
    if (error) throw error;

    const updates = rows.map((c) => ({
      id: c.id,
      sell_price: Math.round(applyCondition(c.market_price, c.condition) * multiplier * 100) / 100,
    }));

    // Supabase doesn't support bulk update by id in a single call without
    // upsert; we use upsert with the existing primary key.
    if (updates.length > 0) {
      const { error: upErr } = await supabase.from('cards').upsert(updates, { onConflict: 'id' });
      if (upErr) throw upErr;
    }

    logActivity({
      user: req.user, req,
      action: 'card.bulk_reprice',
      details: { count: updates.length, filters: { game, product_type, condition }, multiplier },
    });

    res.json({ ok: true, repriced: updates.length });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.CONDITION_MULTIPLIER = CONDITION_MULTIPLIER;
module.exports.applyCondition = applyCondition;
