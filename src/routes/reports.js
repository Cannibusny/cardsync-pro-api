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

module.exports = router;
