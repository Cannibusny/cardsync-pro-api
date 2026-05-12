const express = require('express');

const { getSupabase } = require('../supabase');
const { validate } = require('../lib/validate');
const { notFound, badRequest } = require('../lib/errors');
const { requireAuth, requireMinRole } = require('../middleware/auth');
const { logActivity } = require('../middleware/activity-log');

const router = express.Router();

router.use(requireAuth);

const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG', 'SEALED'];
const GAMES = ['pokemon', 'magic', 'yugioh', 'onepiece', 'other'];
const PAYMENT_METHODS = ['cash', 'store_credit'];

function round2(n) { return Math.round(Number(n) * 100) / 100; }

// Read default_buy_percentage and store_credit_bonus from settings (cached not
// implemented in Phase 2A — read on each request, the trade-in flow is low-rps
// and the settings table is one round-trip).
async function readBuySettings(supabase) {
  const { data } = await supabase
    .from('settings').select('key, value')
    .in('key', ['default_buy_percentage', 'store_credit_bonus']);
  const map = Object.fromEntries((data || []).map((s) => [s.key, s.value]));
  return {
    defaultBuyPercentage: Number(map.default_buy_percentage ?? 0.6),
    storeCreditBonus:     Number(map.store_credit_bonus ?? 0.1),
  };
}

// Validate + normalize a single trade-in card line. Throws badRequest on
// invalid input. Returns the line as it should be persisted on trade_ins.cards
// AND as it should be added to inventory if add_to_inventory is true.
function normalizeCardLine(raw, defaultBuyPercentage) {
  if (!raw || typeof raw !== 'object') throw badRequest('Each card line must be an object');

  const name = String(raw.name || '').trim();
  if (!name) throw badRequest('Each card line must include a name');
  if (name.length > 200) throw badRequest('Card name too long');

  const game = String(raw.game || 'other').toLowerCase();
  if (!GAMES.includes(game)) throw badRequest(`Each card line must have game in: ${GAMES.join(', ')}`);

  const condition = String(raw.condition || 'NM').toUpperCase();
  if (!CONDITIONS.includes(condition)) {
    throw badRequest(`Each card line must have condition in: ${CONDITIONS.join(', ')}`);
  }

  const qty = Number(raw.qty);
  if (!Number.isInteger(qty) || qty < 1) throw badRequest('Each card line must have qty >= 1');

  const marketPrice = Number(raw.market_price);
  if (!Number.isFinite(marketPrice) || marketPrice < 0) {
    throw badRequest('Each card line must have a non-negative market_price');
  }

  // Buy price: operator can override, else fall back to default_buy_percentage
  // of market. Floor at $0 (a $0 buy price means "we took it for free").
  let buyPrice;
  if (raw.buy_price === undefined || raw.buy_price === null || raw.buy_price === '') {
    buyPrice = round2(marketPrice * defaultBuyPercentage);
  } else {
    buyPrice = Number(raw.buy_price);
    if (!Number.isFinite(buyPrice) || buyPrice < 0) {
      throw badRequest('Each card line buy_price must be a non-negative number');
    }
    buyPrice = round2(buyPrice);
  }

  return {
    name,
    game,
    card_set:       raw.card_set ? String(raw.card_set).trim().slice(0, 200) : null,
    number:         raw.number   ? String(raw.number).trim().slice(0, 40)    : null,
    condition,
    qty,
    market_price:   round2(marketPrice),
    buy_price:      buyPrice,
    line_total:     round2(buyPrice * qty),
    add_to_inventory: raw.add_to_inventory !== false, // default true
  };
}

// GET /api/trade-ins
router.get('/', async (req, res, next) => {
  try {
    const limit  = Math.min(Number(req.query.limit)  || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const supabase = getSupabase();
    let query = supabase.from('trade_ins').select('*', { count: 'exact' });
    if (req.query.customer_id) query = query.eq('customer_id', req.query.customer_id);
    if (req.query.status)      query = query.eq('status', req.query.status);
    if (req.query.from)        query = query.gte('created_at', req.query.from);
    if (req.query.to)          query = query.lte('created_at', req.query.to);

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    res.json({ data, count, limit, offset });
  } catch (err) { next(err); }
});

// GET /api/trade-ins/:id
router.get('/:id', async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('trade_ins').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Trade-in not found');
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/trade-ins/quote — preview computation without saving
// Body: { cards: [...], payment_method: cash|store_credit }
router.post('/quote', requireMinRole('employee'), async (req, res, next) => {
  try {
    const body = validate(req.body || {}, {
      cards:          { type: 'array',  required: true },
      payment_method: { type: 'string', required: true, in: PAYMENT_METHODS },
    });

    if (!Array.isArray(body.cards) || body.cards.length === 0) {
      throw badRequest('At least one card line is required');
    }

    const supabase = getSupabase();
    const { defaultBuyPercentage, storeCreditBonus } = await readBuySettings(supabase);

    const lines = body.cards.map((c) => normalizeCardLine(c, defaultBuyPercentage));
    const baselineOffer = round2(lines.reduce((acc, l) => acc + l.line_total, 0));
    const bonus = body.payment_method === 'store_credit'
      ? round2(baselineOffer * storeCreditBonus) : 0;
    const totalOffer = round2(baselineOffer + bonus);

    res.json({
      lines,
      baseline_offer:     baselineOffer,
      store_credit_bonus: bonus,
      bonus_rate:         body.payment_method === 'store_credit' ? storeCreditBonus : 0,
      total_offer:        totalOffer,
      payment_method:     body.payment_method,
    });
  } catch (err) { next(err); }
});

// POST /api/trade-ins — accept cards, pay out (cash or store_credit), optionally
// roll items into inventory.
// Body: { customer_id, cards: [...], payment_method: cash|store_credit, notes? }
router.post('/', requireMinRole('employee'), async (req, res, next) => {
  try {
    const body = validate(req.body, {
      customer_id:    { type: 'string', required: true, max: 100 },
      cards:          { type: 'array',  required: true },
      payment_method: { type: 'string', required: true, in: PAYMENT_METHODS },
      notes:          { type: 'string', max: 4000 },
    });

    if (!Array.isArray(body.cards) || body.cards.length === 0) {
      throw badRequest('At least one card line is required');
    }

    const supabase = getSupabase();

    // 1. Verify customer exists; fetch current store_credit for the increment.
    const { data: customer, error: cErr } = await supabase
      .from('customers').select('id, name, store_credit')
      .eq('id', body.customer_id).maybeSingle();
    if (cErr) throw cErr;
    if (!customer) throw badRequest('Unknown customer_id');

    // 2. Compute pricing server-side. Operator-supplied buy_price overrides the
    //    default percentage but is always re-validated as a non-negative number.
    const { defaultBuyPercentage, storeCreditBonus } = await readBuySettings(supabase);
    const lines = body.cards.map((c) => normalizeCardLine(c, defaultBuyPercentage));

    const baselineOffer = round2(lines.reduce((acc, l) => acc + l.line_total, 0));
    const bonus = body.payment_method === 'store_credit'
      ? round2(baselineOffer * storeCreditBonus) : 0;
    const totalOffer = round2(baselineOffer + bonus);

    // 3. Persist the trade-in row first so we have an id for audit + inventory
    //    cross-reference (trade-in id is stored in cards.notes when rolled to
    //    inventory).
    const tradeRow = {
      customer_id:       customer.id,
      user_id:           req.user.id,
      cards:             lines,
      total_offer:       totalOffer,
      payment_method:    body.payment_method,
      store_credit_bonus: bonus,
      status:            'completed',
      notes:             body.notes || null,
    };
    const { data: trade, error: tErr } = await supabase
      .from('trade_ins').insert(tradeRow).select().single();
    if (tErr) throw tErr;

    // 4. If paying as store credit, bump customer balance by total_offer.
    if (body.payment_method === 'store_credit') {
      const newCredit = round2(Number(customer.store_credit || 0) + totalOffer);
      const { error: upErr } = await supabase
        .from('customers').update({ store_credit: newCredit }).eq('id', customer.id);
      if (upErr) throw upErr;
    }

    // 5. Roll opted-in lines into inventory. Each line becomes (or merges into)
    //    a cards row. cost_basis = buy_price; sell_price defaults to market_price
    //    (the operator can reprice later). We try to merge with an existing row
    //    matching (name, game, card_set, condition) so the inventory list
    //    doesn't bloat with duplicates.
    const inventoryToAdd = lines.filter((l) => l.add_to_inventory);
    for (const line of inventoryToAdd) {
      // Look for an existing row to merge into.
      let lookup = supabase.from('cards').select('id, quantity, cost_basis')
        .eq('name', line.name)
        .eq('game', line.game)
        .eq('condition', line.condition)
        .limit(1);
      // Match on null card_set explicitly when the line didn't specify one,
      // otherwise the lookup would match any card_set and pick an arbitrary
      // row to merge into (potentially from a totally different set).
      if (line.card_set) lookup = lookup.eq('card_set', line.card_set);
      else               lookup = lookup.is('card_set', null);
      const { data: existing } = await lookup;

      if (existing && existing.length > 0) {
        const old = existing[0];
        // Weighted-average cost basis so re-buys don't break profit math.
        const oldQty = Number(old.quantity || 0);
        const newQty = oldQty + line.qty;
        const newCostBasis = newQty > 0
          ? round2(((Number(old.cost_basis || 0) * oldQty) + (line.buy_price * line.qty)) / newQty)
          : line.buy_price;
        await supabase.from('cards').update({
          quantity:   newQty,
          cost_basis: newCostBasis,
        }).eq('id', old.id);
      } else {
        await supabase.from('cards').insert({
          name:         line.name,
          game:         line.game,
          card_set:     line.card_set,
          number:       line.number,
          condition:    line.condition,
          product_type: line.condition === 'SEALED' ? 'sealed' : 'single',
          quantity:     line.qty,
          cost_basis:   line.buy_price,
          sell_price:   line.market_price,
          market_price: line.market_price,
          source:       'buylist',
          notes:        `Trade-in ${trade.id}`,
          date_acquired: new Date().toISOString().slice(0, 10),
        });
      }
    }

    logActivity({
      user: req.user, req,
      action: 'trade_in.create', resourceType: 'trade_in', resourceId: trade.id,
      details: {
        total_offer:    totalOffer,
        payment_method: body.payment_method,
        line_count:     lines.length,
        added_to_inventory: inventoryToAdd.length,
      },
    });

    res.status(201).json(trade);
  } catch (err) { next(err); }
});

module.exports = router;
