const express = require('express');

const { getSupabase } = require('../supabase');
const { requireAuth, requireMinRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

// Helpers
function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function daysAgo(n) { const x = startOfDay(); x.setDate(x.getDate() - n); return x; }

// GET /api/reports/sales/daily  — last 30 days of daily totals
router.get('/sales/daily', requireMinRole('employee'), async (req, res, next) => {
  try {
    const days = Math.min(Number(req.query.days) || 30, 365);
    const since = daysAgo(days).toISOString();

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('transactions')
      .select('created_at, total, items')
      .eq('voided', false)
      .gte('created_at', since);
    if (error) throw error;

    // Aggregate client-side (Postgres GROUP BY would need an RPC).
    const buckets = new Map();
    for (const t of data || []) {
      const day = t.created_at.slice(0, 10);
      if (!buckets.has(day)) buckets.set(day, { date: day, total: 0, count: 0, items: 0 });
      const b = buckets.get(day);
      b.total += Number(t.total) || 0;
      b.count += 1;
      b.items += Array.isArray(t.items) ? t.items.reduce((s, it) => s + (Number(it.qty) || 0), 0) : 0;
    }

    const series = Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
    series.forEach((b) => { b.total = Math.round(b.total * 100) / 100; });
    res.json({ days, series });
  } catch (err) { next(err); }
});

// GET /api/reports/sales/summary  — today / this week / this month / all-time
router.get('/sales/summary', requireMinRole('employee'), async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const today  = startOfDay().toISOString();
    const week   = daysAgo(7).toISOString();
    const month  = daysAgo(30).toISOString();

    const [
      { data: tToday, error: e1 },
      { data: tWeek,  error: e2 },
      { data: tMonth, error: e3 },
      { data: tAll,   error: e4 },
    ] = await Promise.all([
      supabase.from('transactions').select('total, items').eq('voided', false).gte('created_at', today),
      supabase.from('transactions').select('total').eq('voided', false).gte('created_at', week),
      supabase.from('transactions').select('total').eq('voided', false).gte('created_at', month),
      supabase.from('transactions').select('total').eq('voided', false),
    ]);
    if (e1) throw e1; if (e2) throw e2; if (e3) throw e3; if (e4) throw e4;

    const sum = (rows) => Math.round((rows || []).reduce((s, r) => s + (Number(r.total) || 0), 0) * 100) / 100;
    const itemsToday = (tToday || []).reduce((s, t) => s + (Array.isArray(t.items) ? t.items.reduce((x, i) => x + (Number(i.qty) || 0), 0) : 0), 0);

    res.json({
      today:        { total: sum(tToday),  count: (tToday || []).length, items: itemsToday },
      last_7_days:  { total: sum(tWeek),   count: (tWeek  || []).length },
      last_30_days: { total: sum(tMonth),  count: (tMonth || []).length },
      all_time:     { total: sum(tAll),    count: (tAll   || []).length },
    });
  } catch (err) { next(err); }
});

// GET /api/reports/inventory/summary — total cards, total value (cost + market)
router.get('/inventory/summary', requireMinRole('employee'), async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('cards').select('quantity, cost_basis, sell_price, market_price, game, product_type');
    if (error) throw error;

    let units = 0;
    let costValue = 0;
    let listValue = 0;
    let marketValue = 0;
    const byGame = {};
    const byType = {};

    for (const c of data || []) {
      const q = Number(c.quantity) || 0;
      units += q;
      costValue   += q * (Number(c.cost_basis)   || 0);
      listValue   += q * (Number(c.sell_price)   || 0);
      marketValue += q * (Number(c.market_price) || 0);
      byGame[c.game] = (byGame[c.game] || 0) + q * (Number(c.sell_price) || 0);
      byType[c.product_type] = (byType[c.product_type] || 0) + q * (Number(c.sell_price) || 0);
    }

    res.json({
      units,
      total_at_cost:   Math.round(costValue   * 100) / 100,
      total_at_list:   Math.round(listValue   * 100) / 100,
      total_at_market: Math.round(marketValue * 100) / 100,
      by_game:         Object.fromEntries(Object.entries(byGame).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      by_type:         Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    });
  } catch (err) { next(err); }
});

// GET /api/reports/inventory/low-stock — cards with quantity ≤ threshold
router.get('/inventory/low-stock', requireMinRole('employee'), async (req, res, next) => {
  try {
    const threshold = Math.max(0, Number(req.query.threshold) || 2);
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('cards').select('id, name, game, quantity, sell_price, location')
      .lte('quantity', threshold).order('quantity', { ascending: true }).limit(200);
    if (error) throw error;
    res.json({ threshold, data });
  } catch (err) { next(err); }
});

// GET /api/reports/profit  — profit = sell_price - cost_basis * qty over a window
router.get('/profit', requireMinRole('manager'), async (req, res, next) => {
  try {
    const days = Math.min(Number(req.query.days) || 30, 365);
    const since = daysAgo(days).toISOString();

    const supabase = getSupabase();
    const { data: txns, error } = await supabase
      .from('transactions').select('id, created_at, total, items').eq('voided', false).gte('created_at', since);
    if (error) throw error;

    // To compute profit per transaction we need each item's cost_basis. Pull a
    // batch of card rows referenced across the period.
    const allCardIds = new Set();
    for (const t of txns || []) for (const it of (t.items || [])) if (it.card_id) allCardIds.add(it.card_id);
    let cardCosts = new Map();
    if (allCardIds.size) {
      const { data: cards } = await supabase
        .from('cards').select('id, cost_basis').in('id', Array.from(allCardIds));
      cardCosts = new Map((cards || []).map((c) => [c.id, Number(c.cost_basis) || 0]));
    }

    let revenue = 0;
    let cost = 0;
    const perDay = new Map();

    for (const t of txns || []) {
      const day = t.created_at.slice(0, 10);
      const dayBucket = perDay.get(day) || { date: day, revenue: 0, profit: 0 };
      let txnRevenue = 0;
      let txnCost = 0;
      for (const it of (t.items || [])) {
        const subtotal = Number(it.subtotal);
        const lineRevenue = Number.isFinite(subtotal)
          ? subtotal
          : (Number(it.unit_price) * Number(it.qty));
        const lineCost = (cardCosts.get(it.card_id) || 0) * (Number(it.qty) || 0);
        txnRevenue += lineRevenue;
        txnCost    += lineCost;
      }
      dayBucket.revenue += txnRevenue;
      dayBucket.profit  += (txnRevenue - txnCost);
      perDay.set(day, dayBucket);
      revenue += txnRevenue;
      cost    += txnCost;
    }

    const series = Array.from(perDay.values())
      .map((b) => ({
        date: b.date,
        revenue: Math.round(b.revenue * 100) / 100,
        profit:  Math.round(b.profit  * 100) / 100,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const totalProfit = revenue - cost;
    res.json({
      days,
      revenue: Math.round(revenue * 100) / 100,
      cost:    Math.round(cost * 100) / 100,
      profit:  Math.round(totalProfit * 100) / 100,
      margin:  revenue ? Math.round((totalProfit / revenue) * 1000) / 10 : 0,
      series,
    });
  } catch (err) { next(err); }
});

// GET /api/reports/customers/top — top spenders
router.get('/customers/top', requireMinRole('manager'), async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('customers').select('id, name, email, total_spent, loyalty_points, last_visit_at')
      .order('total_spent', { ascending: false }).limit(20);
    if (error) throw error;
    res.json({ data });
  } catch (err) { next(err); }
});

// --- Phase 2E — Advanced analytics ----------------------------------------

// GET /api/reports/profit/by-game?days=30
// Per-game revenue, cost, profit, margin, units for the window. Pulls
// transactions in window, batches a single cards lookup for cost_basis +
// game/product_type metadata, then aggregates.
router.get('/profit/by-game', requireMinRole('manager'), async (req, res, next) => {
  try {
    const days = Math.min(Number(req.query.days) || 30, 365);
    const since = daysAgo(days).toISOString();
    const supabase = getSupabase();

    const { data: txns, error } = await supabase
      .from('transactions').select('items').eq('voided', false).gte('created_at', since);
    if (error) throw error;

    const allCardIds = new Set();
    for (const t of txns || []) for (const it of (t.items || [])) if (it.card_id) allCardIds.add(it.card_id);

    let cardMeta = new Map();
    if (allCardIds.size) {
      const { data: cards } = await supabase
        .from('cards').select('id, cost_basis, game, product_type').in('id', Array.from(allCardIds));
      cardMeta = new Map((cards || []).map((c) => [c.id, c]));
    }

    const buckets = new Map();
    const ensure = (game) => {
      const key = game || 'unknown';
      if (!buckets.has(key)) buckets.set(key, { game: key, revenue: 0, cost: 0, units: 0, lines: 0 });
      return buckets.get(key);
    };

    for (const t of txns || []) {
      for (const it of (t.items || [])) {
        const meta = it.card_id ? cardMeta.get(it.card_id) : null;
        const b = ensure(meta?.game || 'unknown');
        const subtotal = Number(it.subtotal);
        const lineRevenue = Number.isFinite(subtotal)
          ? subtotal
          : (Number(it.unit_price) * Number(it.qty));
        const lineCost = (Number(meta?.cost_basis) || 0) * (Number(it.qty) || 0);
        b.revenue += lineRevenue;
        b.cost    += lineCost;
        b.units   += Number(it.qty) || 0;
        b.lines   += 1;
      }
    }

    const series = Array.from(buckets.values())
      .map((b) => ({
        game:    b.game,
        revenue: Math.round(b.revenue * 100) / 100,
        cost:    Math.round(b.cost    * 100) / 100,
        profit:  Math.round((b.revenue - b.cost) * 100) / 100,
        margin:  b.revenue ? Math.round(((b.revenue - b.cost) / b.revenue) * 1000) / 10 : 0,
        units:   b.units,
        lines:   b.lines,
      }))
      .sort((a, b) => b.profit - a.profit);

    res.json({ days, series });
  } catch (err) { next(err); }
});

// GET /api/reports/sales/top-movers?days=30&limit=10
router.get('/sales/top-movers', requireMinRole('manager'), async (req, res, next) => {
  try {
    const days  = Math.min(Number(req.query.days)  || 30, 365);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
    const since = daysAgo(days).toISOString();
    const supabase = getSupabase();

    const { data: txns, error } = await supabase
      .from('transactions').select('items').eq('voided', false).gte('created_at', since);
    if (error) throw error;

    const tally = new Map();
    for (const t of txns || []) {
      for (const it of (t.items || [])) {
        if (!it.card_id) continue;
        const cur = tally.get(it.card_id) || { card_id: it.card_id, name: it.name || '', units: 0, revenue: 0 };
        const subtotal = Number(it.subtotal);
        const lineRevenue = Number.isFinite(subtotal)
          ? subtotal
          : (Number(it.unit_price) * Number(it.qty));
        cur.units += Number(it.qty) || 0;
        cur.revenue += lineRevenue;
        if (!cur.name && it.name) cur.name = it.name;
        tally.set(it.card_id, cur);
      }
    }

    const top = Array.from(tally.values())
      .sort((a, b) => b.units - a.units || b.revenue - a.revenue)
      .slice(0, limit);

    // Enrich with current inventory data for context.
    if (top.length) {
      const { data: cards } = await supabase
        .from('cards').select('id, name, game, quantity, sell_price, card_set, number')
        .in('id', top.map((t) => t.card_id));
      const byId = new Map((cards || []).map((c) => [c.id, c]));
      for (const r of top) {
        const c = byId.get(r.card_id);
        if (c) {
          r.name        = c.name || r.name;
          r.game        = c.game || null;
          r.card_set    = c.card_set || null;
          r.number      = c.number || null;
          r.in_stock    = c.quantity;
          r.sell_price  = c.sell_price;
        }
        r.revenue = Math.round(r.revenue * 100) / 100;
      }
    }

    res.json({ days, limit, data: top });
  } catch (err) { next(err); }
});

// GET /api/reports/sales/slow-movers?days=60&limit=20
// Cards with quantity > 0 and ZERO unit sales in the window.
router.get('/sales/slow-movers', requireMinRole('manager'), async (req, res, next) => {
  try {
    const days  = Math.min(Number(req.query.days)  || 60, 365);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
    const since = daysAgo(days).toISOString();
    const supabase = getSupabase();

    const [{ data: cards, error: cErr }, { data: txns, error: tErr }] = await Promise.all([
      supabase.from('cards')
        .select('id, name, game, card_set, number, quantity, sell_price, cost_basis, created_at')
        .gt('quantity', 0),
      supabase.from('transactions').select('items').eq('voided', false).gte('created_at', since),
    ]);
    if (cErr) throw cErr;
    if (tErr) throw tErr;

    const recentlySold = new Set();
    for (const t of txns || []) {
      for (const it of (t.items || [])) {
        if (it.card_id) recentlySold.add(it.card_id);
      }
    }

    const slow = (cards || [])
      .filter((c) => !recentlySold.has(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        game: c.game,
        card_set: c.card_set,
        number: c.number,
        quantity: c.quantity,
        sell_price: c.sell_price,
        cost_basis: c.cost_basis,
        capital_locked: Math.round((Number(c.cost_basis) || 0) * (Number(c.quantity) || 0) * 100) / 100,
        added_at: c.created_at,
      }))
      .sort((a, b) => (b.capital_locked || 0) - (a.capital_locked || 0))
      .slice(0, limit);

    res.json({ days, limit, data: slow });
  } catch (err) { next(err); }
});

// GET /api/reports/trade-ins/summary?days=30
router.get('/trade-ins/summary', requireMinRole('manager'), async (req, res, next) => {
  try {
    const days = Math.min(Number(req.query.days) || 30, 365);
    const since = daysAgo(days).toISOString();
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('trade_ins').select('total_offer, payment_method, store_credit_bonus, cards, created_at')
      .gte('created_at', since);
    if (error) throw error;

    const summary = {
      count: 0,
      total_offered: 0,
      total_bonus: 0,
      by_method: { cash: { count: 0, total: 0 }, store_credit: { count: 0, total: 0 } },
      total_cards: 0,
    };

    for (const t of data || []) {
      summary.count += 1;
      summary.total_offered += Number(t.total_offer) || 0;
      summary.total_bonus   += Number(t.store_credit_bonus) || 0;
      const m = t.payment_method;
      if (!summary.by_method[m]) summary.by_method[m] = { count: 0, total: 0 };
      summary.by_method[m].count += 1;
      summary.by_method[m].total += Number(t.total_offer) || 0;
      if (Array.isArray(t.cards)) {
        for (const c of t.cards) summary.total_cards += Number(c.qty) || 0;
      }
    }

    summary.total_offered = Math.round(summary.total_offered * 100) / 100;
    summary.total_bonus   = Math.round(summary.total_bonus   * 100) / 100;
    for (const k of Object.keys(summary.by_method)) {
      summary.by_method[k].total = Math.round(summary.by_method[k].total * 100) / 100;
    }
    res.json({ days, ...summary });
  } catch (err) { next(err); }
});

// GET /api/reports/grading/summary?days=30
router.get('/grading/summary', requireMinRole('manager'), async (req, res, next) => {
  try {
    const days = Math.min(Number(req.query.days) || 30, 365);
    const since = daysAgo(days).toISOString();
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('grading_submissions').select('status, service, service_fee, concierge_fee, cards, created_at')
      .gte('created_at', since);
    if (error) throw error;

    const summary = {
      count: 0,
      total_revenue: 0,
      by_status: {},
      by_service: {},
      total_cards: 0,
    };

    for (const s of data || []) {
      summary.count += 1;
      const fee = (Number(s.service_fee) || 0) + (Number(s.concierge_fee) || 0);
      summary.total_revenue += fee;
      summary.by_status[s.status] = (summary.by_status[s.status] || 0) + 1;
      const sv = summary.by_service[s.service] || { count: 0, revenue: 0 };
      sv.count += 1;
      sv.revenue += fee;
      summary.by_service[s.service] = sv;
      if (Array.isArray(s.cards)) {
        for (const c of s.cards) summary.total_cards += Number(c.qty) || 0;
      }
    }

    summary.total_revenue = Math.round(summary.total_revenue * 100) / 100;
    for (const k of Object.keys(summary.by_service)) {
      summary.by_service[k].revenue = Math.round(summary.by_service[k].revenue * 100) / 100;
    }
    res.json({ days, ...summary });
  } catch (err) { next(err); }
});

// GET /api/reports/employees/performance?days=30
// Per-operator: transactions count, revenue, items sold.
router.get('/employees/performance', requireMinRole('manager'), async (req, res, next) => {
  try {
    const days = Math.min(Number(req.query.days) || 30, 365);
    const since = daysAgo(days).toISOString();
    const supabase = getSupabase();

    const [{ data: txns, error: tErr }, { data: users, error: uErr }] = await Promise.all([
      supabase.from('transactions').select('user_id, total, items').eq('voided', false).gte('created_at', since),
      supabase.from('users').select('id, name, email, role'),
    ]);
    if (tErr) throw tErr;
    if (uErr) throw uErr;

    const userMap = new Map((users || []).map((u) => [u.id, u]));
    const tally = new Map();
    const ensure = (uid) => {
      const key = uid || 'unattributed';
      if (!tally.has(key)) {
        const u = uid ? userMap.get(uid) : null;
        tally.set(key, {
          user_id: uid || null,
          name: u?.name || (uid ? '(deleted user)' : '(unattributed)'),
          email: u?.email || null,
          role: u?.role || null,
          transactions: 0,
          revenue: 0,
          items: 0,
        });
      }
      return tally.get(key);
    };

    for (const t of txns || []) {
      const b = ensure(t.user_id);
      b.transactions += 1;
      b.revenue += Number(t.total) || 0;
      if (Array.isArray(t.items)) for (const it of t.items) b.items += Number(it.qty) || 0;
    }

    const data = Array.from(tally.values())
      .map((r) => ({ ...r, revenue: Math.round(r.revenue * 100) / 100 }))
      .sort((a, b) => b.revenue - a.revenue);

    res.json({ days, data });
  } catch (err) { next(err); }
});

module.exports = router;
