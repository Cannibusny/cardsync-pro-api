const express = require('express');

const { getSupabase } = require('../supabase');
const { validate } = require('../lib/validate');
const { badRequest } = require('../lib/errors');
const { requireAuth, requireMinRole } = require('../middleware/auth');
const { logActivity } = require('../middleware/activity-log');
const { refreshAll } = require('../services/tcgcsv');

const router = express.Router();

router.use(requireAuth);

// GET /api/prices  — search the cache by name (autocomplete in admin UI)
router.get('/', async (req, res, next) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q || q.length < 2) return res.json({ data: [] });

    const supabase = getSupabase();
    let query = supabase.from('card_prices').select('*').ilike('name', `%${q}%`).limit(50);
    if (req.query.game) query = query.eq('game', req.query.game);
    const { data, error } = await query;
    if (error) throw error;
    res.json({ data });
  } catch (err) { next(err); }
});

// GET /api/prices/:tcgplayer_id
router.get('/:tcgplayer_id', async (req, res, next) => {
  try {
    const id = Number(req.params.tcgplayer_id);
    if (!Number.isInteger(id)) throw badRequest('tcgplayer_id must be an integer');

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('card_prices').select('*').eq('tcgplayer_id', id).maybeSingle();
    if (error) throw error;
    res.json(data || null);
  } catch (err) { next(err); }
});

// POST /api/prices/refresh  — trigger an immediate TCGCSV refresh
// Body: { categories: [3,1,2,23] } (optional; defaults to env TCGCSV_CATEGORIES)
router.post('/refresh', requireMinRole('manager'), async (req, res, next) => {
  try {
    const { categories } = validate(req.body || {}, {
      categories: { type: 'array' },
    });
    const envIds = (process.env.TCGCSV_CATEGORIES || '3,1,2,23')
      .split(',').map((s) => Number(s.trim())).filter(Number.isInteger);
    const list = (categories && categories.length ? categories : envIds).map(Number);

    // Fire-and-forget so the HTTP request doesn't time out. Result is logged.
    refreshAll(list)
      .then((summary) => {
        console.log('[prices] refresh complete:', summary);
        logActivity({
          user: req.user, req,
          action: 'prices.refresh',
          details: { summary },
        });
      })
      .catch((err) => console.error('[prices] refresh failed:', err));

    res.status(202).json({ ok: true, categories: list, message: 'Refresh started in background.' });
  } catch (err) { next(err); }
});

// POST /api/prices/apply-to-card/:card_id — copy market_price from cache to the card row
router.post('/apply-to-card/:card_id', requireMinRole('employee'), async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const { data: card, error: cErr } = await supabase
      .from('cards').select('id, tcgplayer_id').eq('id', req.params.card_id).maybeSingle();
    if (cErr) throw cErr;
    if (!card) throw badRequest('Card not found');
    if (!card.tcgplayer_id) throw badRequest('Card has no tcgplayer_id');

    const { data: price, error: pErr } = await supabase
      .from('card_prices').select('market_price').eq('tcgplayer_id', card.tcgplayer_id).maybeSingle();
    if (pErr) throw pErr;
    if (!price) throw badRequest('No price record for this tcgplayer_id (run /api/prices/refresh)');

    const { data, error } = await supabase
      .from('cards').update({ market_price: price.market_price }).eq('id', card.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

module.exports = router;
