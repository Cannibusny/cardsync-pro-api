const express = require('express');

const { getSupabase } = require('../supabase');
const { validate } = require('../lib/validate');
const { notFound, badRequest, conflict } = require('../lib/errors');
const { requireAuth, requireMinRole } = require('../middleware/auth');
const { logActivity } = require('../middleware/activity-log');

const router = express.Router();

router.use(requireAuth);

const PAYMENT_METHODS = ['cash','credit','debit','store_credit','split','stripe','other'];

function round2(n) { return Math.round(Number(n) * 100) / 100; }

// GET /api/transactions
router.get('/', async (req, res, next) => {
  try {
    const limit  = Math.min(Number(req.query.limit)  || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const supabase = getSupabase();
    let query = supabase.from('transactions').select('*', { count: 'exact' });
    if (req.query.customer_id) query = query.eq('customer_id', req.query.customer_id);
    if (req.query.user_id)     query = query.eq('user_id', req.query.user_id);
    if (req.query.payment_method) query = query.eq('payment_method', req.query.payment_method);
    if (req.query.from) query = query.gte('created_at', req.query.from);
    if (req.query.to)   query = query.lte('created_at', req.query.to);
    if (req.query.voided === 'false') query = query.eq('voided', false);

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    res.json({ data, count, limit, offset });
  } catch (err) { next(err); }
});

// GET /api/transactions/:id
router.get('/:id', async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('transactions').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Transaction not found');
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/transactions  — ring up a sale
// Body: { customer_id?, items:[{card_id, qty, unit_price?, discount?}], discount_amount?,
//         tax_rate?, payment_method, payment_details?, redeem_store_credit?, redeem_loyalty? }
router.post('/', requireMinRole('employee'), async (req, res, next) => {
  try {
    const body = validate(req.body, {
      customer_id:         { type: 'string', max: 100 },
      items:               { type: 'array',  required: true },
      discount_amount:     { type: 'number', min: 0 },
      tax_rate:            { type: 'number', min: 0, max: 0.50 },
      payment_method:      { type: 'string', required: true, in: PAYMENT_METHODS },
      payment_details:     { type: 'object' },
      redeem_store_credit: { type: 'number', min: 0 },
      redeem_loyalty:      { type: 'int',    min: 0 },
      stripe_payment_intent: { type: 'string', max: 200 },
      notes:               { type: 'string', max: 4000 },
    });

    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw badRequest('At least one line item is required');
    }

    const supabase = getSupabase();

    // 1. Resolve each line item against the live card row to compute totals and
    //    confirm stock. Employees can't override unit_price — we use sell_price
    //    from DB. Managers and above may pass unit_price for manual overrides.
    const cardIds = [...new Set(body.items.map((it) => it && it.card_id).filter(Boolean))];
    const { data: cardRows, error: cardErr } = await supabase
      .from('cards').select('id, name, sell_price, quantity, quantity_reserved').in('id', cardIds);
    if (cardErr) throw cardErr;
    const byId = new Map(cardRows.map((c) => [c.id, c]));

    const lineItems = [];
    let subtotal = 0;

    for (const raw of body.items) {
      if (!raw || !raw.card_id || !raw.qty || raw.qty < 1) {
        throw badRequest('Each item must include card_id and qty (>=1)');
      }
      const card = byId.get(raw.card_id);
      if (!card) throw badRequest(`Unknown card_id ${raw.card_id}`);
      const available = (card.quantity || 0) - (card.quantity_reserved || 0);
      if (raw.qty > available) {
        throw conflict(`"${card.name}" only has ${available} in stock (requested ${raw.qty})`);
      }

      let unitPrice = Number(card.sell_price || 0);
      if (raw.unit_price !== undefined && raw.unit_price !== null) {
        if (req.user.role === 'employee') {
          // Employees can't override price (spec). Silently ignore.
        } else {
          unitPrice = Number(raw.unit_price);
        }
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) throw badRequest(`Invalid unit_price for ${card.name}`);

      const lineDiscount = Math.max(0, Number(raw.discount) || 0);
      const lineTotal = round2(Math.max(0, unitPrice * raw.qty - lineDiscount));

      lineItems.push({
        card_id:    card.id,
        name:       card.name,
        qty:        raw.qty,
        unit_price: round2(unitPrice),
        discount:   round2(lineDiscount),
        subtotal:   lineTotal,
      });
      subtotal += lineTotal;
    }

    subtotal = round2(subtotal);

    // 2. Pull settings for default tax rate.
    const { data: settings } = await supabase
      .from('settings').select('key, value').in('key', [
        'default_tax_rate','loyalty_points_per_dollar','loyalty_redemption_rate',
      ]);
    const settingsMap = Object.fromEntries((settings || []).map((s) => [s.key, s.value]));

    const taxRate = body.tax_rate != null ? Number(body.tax_rate) : Number(settingsMap.default_tax_rate || 0.08);
    const discount = Math.min(round2(Number(body.discount_amount || 0)), subtotal);
    const taxableSubtotal = round2(Math.max(0, subtotal - discount));

    // 3. Loyalty redemption (convert points to dollars off, capped at taxable subtotal).
    let redeemedLoyaltyDollars = 0;
    let redeemedLoyaltyPoints  = 0;
    let customer = null;
    if (body.customer_id) {
      const { data } = await supabase
        .from('customers').select('id, store_credit, loyalty_points, total_spent')
        .eq('id', body.customer_id).maybeSingle();
      if (!data) throw badRequest('Unknown customer_id');
      customer = data;

      if (body.redeem_loyalty && body.redeem_loyalty > 0) {
        const rate = Number(settingsMap.loyalty_redemption_rate || 0.05);
        const wantPts = Math.min(body.redeem_loyalty, customer.loyalty_points);
        redeemedLoyaltyDollars = round2(Math.min(taxableSubtotal, wantPts * rate));
        redeemedLoyaltyPoints  = Math.ceil(redeemedLoyaltyDollars / rate);
      }
    }

    const taxAmount   = round2(Math.max(0, taxableSubtotal - redeemedLoyaltyDollars) * taxRate);
    let total         = round2(taxableSubtotal - redeemedLoyaltyDollars + taxAmount);

    // 4. Store credit redemption (caps at the running total).
    let redeemedCredit = 0;
    if (body.redeem_store_credit && customer && customer.store_credit > 0) {
      redeemedCredit = round2(Math.min(body.redeem_store_credit, customer.store_credit, total));
      total = round2(total - redeemedCredit);
    }

    // 5. Compute loyalty points earned on the *post-discount, pre-redemption* total.
    const pointsPerDollar = Number(settingsMap.loyalty_points_per_dollar || 1);
    const earnedPoints = customer ? Math.floor((taxableSubtotal - redeemedLoyaltyDollars) * pointsPerDollar) : 0;

    // 6. Build the row.
    const txnRow = {
      customer_id:           body.customer_id || null,
      user_id:               req.user.id,
      items:                 lineItems,
      subtotal,
      discount_amount:       discount,
      tax_rate:              taxRate,
      tax_amount:            taxAmount,
      total,
      payment_method:        body.payment_method,
      payment_details:       body.payment_details || null,
      stripe_payment_intent: body.stripe_payment_intent || null,
      loyalty_points_earned:   earnedPoints,
      loyalty_points_redeemed: redeemedLoyaltyPoints,
      notes:                 body.notes || null,
    };

    // 7. Insert transaction, then decrement card quantities, then bump customer
    //    aggregates. We're doing this sequentially (not in a single transaction)
    //    because supabase-js doesn't expose transactions over the REST API.
    //    For Phase 1 the risk window is tiny; Phase 2 will move POS into a
    //    Postgres function for atomicity.
    const { data: inserted, error: insErr } = await supabase
      .from('transactions').insert(txnRow).select().single();
    if (insErr) throw insErr;

    // Decrement card quantities — best-effort sequential updates.
    await Promise.all(lineItems.map(async (li) => {
      const card = byId.get(li.card_id);
      const newQty = Math.max(0, (card.quantity || 0) - li.qty);
      await supabase.from('cards').update({ quantity: newQty }).eq('id', li.card_id);
    }));

    // Update customer aggregates.
    if (customer) {
      const newCredit  = round2(Math.max(0, customer.store_credit - redeemedCredit));
      const newPoints  = Math.max(0, (customer.loyalty_points || 0) - redeemedLoyaltyPoints + earnedPoints);
      const newSpent   = round2((customer.total_spent || 0) + total);
      await supabase.from('customers').update({
        store_credit:   newCredit,
        loyalty_points: newPoints,
        total_spent:    newSpent,
        last_visit_at:  new Date().toISOString(),
      }).eq('id', customer.id);
    }

    logActivity({
      user: req.user, req,
      action: 'transaction.create', resourceType: 'transaction', resourceId: inserted.id,
      details: { total, items: lineItems.length, payment_method: txnRow.payment_method },
    });

    res.status(201).json(inserted);
  } catch (err) { next(err); }
});

// POST /api/transactions/:id/void — mark a transaction as voided + restore inventory
router.post('/:id/void', requireMinRole('manager'), async (req, res, next) => {
  try {
    const { reason } = validate(req.body || {}, {
      reason: { type: 'string', required: true, max: 500 },
    });

    const supabase = getSupabase();
    const { data: txn, error } = await supabase
      .from('transactions').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!txn) throw notFound('Transaction not found');
    if (txn.voided) throw conflict('Transaction is already voided');

    // Restore inventory.
    await Promise.all((txn.items || []).map(async (li) => {
      const { data: card } = await supabase.from('cards').select('quantity').eq('id', li.card_id).maybeSingle();
      if (!card) return;
      await supabase.from('cards').update({ quantity: (card.quantity || 0) + Number(li.qty) }).eq('id', li.card_id);
    }));

    // Reverse customer credit/loyalty changes.
    if (txn.customer_id) {
      const { data: cust } = await supabase
        .from('customers').select('store_credit, loyalty_points, total_spent')
        .eq('id', txn.customer_id).maybeSingle();
      if (cust) {
        const newCredit  = round2((cust.store_credit || 0) + (txn.payment_method === 'store_credit' ? Number(txn.total) : 0));
        const newPoints  = Math.max(0, (cust.loyalty_points || 0) + (txn.loyalty_points_redeemed || 0) - (txn.loyalty_points_earned || 0));
        const newSpent   = round2(Math.max(0, (cust.total_spent || 0) - Number(txn.total)));
        await supabase.from('customers').update({
          store_credit: newCredit, loyalty_points: newPoints, total_spent: newSpent,
        }).eq('id', txn.customer_id);
      }
    }

    const { data: updated, error: upErr } = await supabase
      .from('transactions').update({
        voided: true, voided_at: new Date().toISOString(), voided_reason: reason,
      }).eq('id', txn.id).select().single();
    if (upErr) throw upErr;

    logActivity({
      user: req.user, req,
      action: 'transaction.void', resourceType: 'transaction', resourceId: txn.id,
      details: { reason, total: txn.total },
    });

    res.json(updated);
  } catch (err) { next(err); }
});

module.exports = router;
