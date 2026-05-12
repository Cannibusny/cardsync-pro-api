const express = require('express');

const { getSupabase } = require('../supabase');
const { validate } = require('../lib/validate');
const { notFound, badRequest } = require('../lib/errors');
const { requireAuth, requireMinRole } = require('../middleware/auth');
const { logActivity } = require('../middleware/activity-log');

const router = express.Router();

const CREATE_SPEC = {
  name:           { type: 'string',  required: true,  max: 200 },
  email:          { type: 'email',   max: 200 },
  phone:          { type: 'string',  max: 40 },
  birthday:       { type: 'date' },
  store_credit:   { type: 'number',  min: 0 },
  loyalty_points: { type: 'int',     min: 0 },
  preferences:    { type: 'object' },
  wishlist:       { type: 'array' },
  notes:          { type: 'string',  max: 4000 },
};

const UPDATE_SPEC = Object.fromEntries(
  Object.entries(CREATE_SPEC).map(([k, v]) => [k, { ...v, required: false }])
);

router.use(requireAuth);

// GET /api/customers
router.get('/', async (req, res, next) => {
  try {
    const limit  = Math.min(Number(req.query.limit)  || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const supabase = getSupabase();
    let query = supabase.from('customers').select('*', { count: 'exact' });
    if (req.query.q) {
      // Strip PostgREST filter-syntax chars (commas, parens, dots) AND LIKE wildcards.
      // `.or()` passes the raw string to PostgREST's parser, so unsanitized input
      // could inject additional filter clauses. Strip aggressively — operators only
      // need to type the customer's name/email/phone.
      const safe = String(req.query.q).toLowerCase().replace(/[%_,.()]/g, '');
      if (safe.length > 0) {
        query = query.or(`name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`);
      }
    }
    if (req.query.has_credit === 'true') query = query.gt('store_credit', 0);
    if (req.query.tier === 'vip') query = query.gte('total_spent', 1000);

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    res.json({ data, count, limit, offset });
  } catch (err) { next(err); }
});

// GET /api/customers/:id  (includes recent transactions for the profile page)
router.get('/:id', async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const [{ data: customer, error: cErr }, { data: txns, error: tErr }] = await Promise.all([
      supabase.from('customers').select('*').eq('id', req.params.id).maybeSingle(),
      supabase.from('transactions').select('*').eq('customer_id', req.params.id)
        .order('created_at', { ascending: false }).limit(50),
    ]);
    if (cErr) throw cErr;
    if (tErr) throw tErr;
    if (!customer) throw notFound('Customer not found');
    res.json({ ...customer, transactions: txns || [] });
  } catch (err) { next(err); }
});

// POST /api/customers
router.post('/', requireMinRole('employee'), async (req, res, next) => {
  try {
    const payload = validate(req.body, CREATE_SPEC);
    const supabase = getSupabase();
    const { data, error } = await supabase.from('customers').insert(payload).select().single();
    if (error) throw error;
    logActivity({ user: req.user, req, action: 'customer.create', resourceType: 'customer', resourceId: data.id });
    res.status(201).json(data);
  } catch (err) { next(err); }
});

// PATCH /api/customers/:id
router.patch('/:id', requireMinRole('employee'), async (req, res, next) => {
  try {
    const payload = validate(req.body, UPDATE_SPEC);

    // Employees cannot directly adjust store_credit (it would defeat audit trails);
    // they must use POS or buylist flows. Managers and above may override.
    if (req.user.role === 'employee') {
      delete payload.store_credit;
      delete payload.loyalty_points;
    }

    // Empty-payload check runs AFTER stripping so employees who try to update only
    // restricted fields get a clean 400 instead of an empty SQL UPDATE.
    if (Object.keys(payload).length === 0) throw badRequest('No fields to update');

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('customers').update(payload).eq('id', req.params.id).select().maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Customer not found');

    logActivity({
      user: req.user, req,
      action: 'customer.update', resourceType: 'customer', resourceId: data.id,
      details: { fields: Object.keys(payload) },
    });
    res.json(data);
  } catch (err) { next(err); }
});

// DELETE /api/customers/:id
router.delete('/:id', requireMinRole('manager'), async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const { error, count } = await supabase
      .from('customers').delete({ count: 'exact' }).eq('id', req.params.id);
    if (error) throw error;
    if (!count) throw notFound('Customer not found');

    logActivity({ user: req.user, req, action: 'customer.delete', resourceType: 'customer', resourceId: req.params.id });
    res.status(204).send();
  } catch (err) { next(err); }
});

// POST /api/customers/:id/adjust-credit  (managers and above)
router.post('/:id/adjust-credit', requireMinRole('manager'), async (req, res, next) => {
  try {
    const { amount, reason } = validate(req.body, {
      amount: { type: 'number', required: true },   // positive or negative
      reason: { type: 'string', required: true, max: 500 },
    });

    const supabase = getSupabase();
    const { data: cust, error: cErr } = await supabase
      .from('customers').select('id, store_credit').eq('id', req.params.id).maybeSingle();
    if (cErr) throw cErr;
    if (!cust) throw notFound('Customer not found');

    const newBalance = Math.max(0, Math.round((Number(cust.store_credit) + Number(amount)) * 100) / 100);

    const { data, error } = await supabase
      .from('customers').update({ store_credit: newBalance })
      .eq('id', req.params.id).select().single();
    if (error) throw error;

    logActivity({
      user: req.user, req,
      action: 'customer.adjust_credit', resourceType: 'customer', resourceId: data.id,
      details: { amount, reason, from: cust.store_credit, to: newBalance },
    });

    res.json(data);
  } catch (err) { next(err); }
});

module.exports = router;
