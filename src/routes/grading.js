const express = require('express');

const { getSupabase } = require('../supabase');
const { validate } = require('../lib/validate');
const { notFound, badRequest } = require('../lib/errors');
const { requireAuth, requireMinRole } = require('../middleware/auth');
const { logActivity } = require('../middleware/activity-log');

const router = express.Router();

router.use(requireAuth);

const SERVICES = ['PSA', 'BGS', 'CGC', 'SGC'];
const STATUSES = ['received', 'submitted', 'grading', 'returned', 'delivered', 'cancelled'];

function round2(n) { return Math.round(Number(n) * 100) / 100; }

function normalizeCardLine(raw) {
  if (!raw || typeof raw !== 'object') throw badRequest('Each card line must be an object');

  const name = String(raw.name || '').trim();
  if (!name) throw badRequest('Each card line must include a name');
  if (name.length > 200) throw badRequest('Card name too long');

  const qty = Number(raw.qty);
  if (!Number.isInteger(qty) || qty < 1) throw badRequest('Each card line must have qty >= 1');

  return {
    name,
    card_set:       raw.card_set ? String(raw.card_set).trim().slice(0, 200) : null,
    number:         raw.number   ? String(raw.number).trim().slice(0, 40)    : null,
    qty,
    est_grade:      raw.est_grade ? String(raw.est_grade).trim().slice(0, 50) : null,
    declared_value: raw.declared_value != null && raw.declared_value !== ''
                       ? round2(Math.max(0, Number(raw.declared_value) || 0))
                       : null,
    image_url:      raw.image_url ? String(raw.image_url).trim().slice(0, 500) : null,
    returned_grade: null,
    cert_number:    null,
  };
}

// GET /api/grading
router.get('/', async (req, res, next) => {
  try {
    const limit  = Math.min(Number(req.query.limit)  || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const supabase = getSupabase();
    let query = supabase.from('grading_submissions').select('*', { count: 'exact' });
    if (req.query.customer_id) query = query.eq('customer_id', req.query.customer_id);
    if (req.query.status)      query = query.eq('status', req.query.status);
    if (req.query.service)     query = query.eq('service', req.query.service);
    if (req.query.from)        query = query.gte('created_at', req.query.from);
    if (req.query.to)          query = query.lte('created_at', req.query.to);

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    res.json({ data, count, limit, offset });
  } catch (err) { next(err); }
});

// GET /api/grading/:id
router.get('/:id', async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('grading_submissions').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Grading submission not found');
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/grading — intake a grading submission from a customer.
// Status starts as 'received'. status transitions happen via PATCH /:id/status.
//
// Body: {
//   customer_id, service: 'PSA'|'BGS'|'CGC'|'SGC',
//   cards: [{ name, card_set?, number?, qty, est_grade?, declared_value?, image_url? }],
//   service_fee?, concierge_fee?, notes?
// }
router.post('/', requireMinRole('employee'), async (req, res, next) => {
  try {
    const body = validate(req.body, {
      customer_id:    { type: 'string', required: true, max: 100 },
      service:        { type: 'string', required: true, in: SERVICES },
      cards:          { type: 'array',  required: true },
      service_fee:    { type: 'number', min: 0 },
      concierge_fee:  { type: 'number', min: 0 },
      notes:          { type: 'string', max: 4000 },
    });

    if (!Array.isArray(body.cards) || body.cards.length === 0) {
      throw badRequest('At least one card line is required');
    }

    const supabase = getSupabase();

    // Verify customer exists.
    const { data: customer, error: cErr } = await supabase
      .from('customers').select('id, name').eq('id', body.customer_id).maybeSingle();
    if (cErr) throw cErr;
    if (!customer) throw badRequest('Unknown customer_id');

    const lines = body.cards.map(normalizeCardLine);

    const row = {
      customer_id:   customer.id,
      service:       body.service,
      cards:         lines,
      status:        'received',
      service_fee:   round2(Number(body.service_fee || 0)),
      concierge_fee: round2(Number(body.concierge_fee || 0)),
      notes:         body.notes || null,
    };

    const { data, error } = await supabase
      .from('grading_submissions').insert(row).select().single();
    if (error) throw error;

    logActivity({
      user: req.user, req,
      action: 'grading.create', resourceType: 'grading_submission', resourceId: data.id,
      details: {
        service:    body.service,
        line_count: lines.length,
        total_cards: lines.reduce((s, l) => s + l.qty, 0),
      },
    });

    res.status(201).json(data);
  } catch (err) { next(err); }
});

// PATCH /api/grading/:id/status — advance through the workflow.
// Valid statuses: received -> submitted -> grading -> returned -> delivered.
// 'cancelled' is allowed from any non-terminal state.
//
// Body: { status, returned_grades?: { [card_index]: { returned_grade, cert_number? } } }
//
// When transitioning to 'returned', the operator can optionally provide
// returned_grades per card line. Cards remain in cards[] (jsonb) with the new
// returned_grade/cert_number fields populated.
router.patch('/:id/status', requireMinRole('employee'), async (req, res, next) => {
  try {
    const body = validate(req.body, {
      status:          { type: 'string', required: true, in: STATUSES },
      returned_grades: { type: 'object' },
    });

    const supabase = getSupabase();
    const { data: sub, error } = await supabase
      .from('grading_submissions').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!sub) throw notFound('Grading submission not found');

    if (sub.status === 'delivered' || sub.status === 'cancelled') {
      throw badRequest(`Cannot transition from terminal status "${sub.status}"`);
    }

    const patch = { status: body.status };
    if (body.status === 'submitted' && !sub.submitted_at) {
      patch.submitted_at = new Date().toISOString();
    }
    if (body.status === 'returned' && !sub.returned_at) {
      patch.returned_at = new Date().toISOString();
    }

    // If returned_grades supplied, splice them into the cards[] array. The
    // operator can also leave this empty and just record the status change.
    if (body.returned_grades && typeof body.returned_grades === 'object') {
      const cards = (sub.cards || []).map((c, idx) => {
        const rg = body.returned_grades[idx] || body.returned_grades[String(idx)];
        if (!rg) return c;
        return {
          ...c,
          returned_grade: rg.returned_grade ? String(rg.returned_grade).trim().slice(0, 50) : c.returned_grade,
          cert_number:    rg.cert_number    ? String(rg.cert_number).trim().slice(0, 100)   : c.cert_number,
        };
      });
      patch.cards = cards;
    }

    const { data: updated, error: upErr } = await supabase
      .from('grading_submissions').update(patch).eq('id', sub.id).select().single();
    if (upErr) throw upErr;

    logActivity({
      user: req.user, req,
      action: 'grading.status', resourceType: 'grading_submission', resourceId: sub.id,
      details: { from: sub.status, to: body.status },
    });

    res.json(updated);
  } catch (err) { next(err); }
});

module.exports = router;
