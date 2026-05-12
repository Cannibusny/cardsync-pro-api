const express = require('express');

const { getSupabase } = require('../supabase');
const { validate } = require('../lib/validate');
const { notFound, badRequest } = require('../lib/errors');
const { requireAuth, requireMinRole } = require('../middleware/auth');
const { logActivity } = require('../middleware/activity-log');

const router = express.Router();

router.use(requireAuth);

const EVENT_TYPES = [
  'pokemon-tournament',
  'pokemon-prerelease',
  'magic-tournament',
  'magic-draft',
  'magic-prerelease',
  'yugioh-tournament',
  'onepiece-tournament',
  'workshop',
  'casual-play',
  'release-party',
  'other',
];

function round2(n) { return Math.round(Number(n) * 100) / 100; }

function normalizeParticipant(raw) {
  if (!raw || typeof raw !== 'object') throw badRequest('Participant must be an object');
  const name = String(raw.name || '').trim();
  if (!name) throw badRequest('Participant name is required');
  if (name.length > 200) throw badRequest('Participant name too long');

  const email = raw.email ? String(raw.email).trim().slice(0, 200) : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest('Participant email must be a valid email');
  }

  return {
    name,
    email,
    customer_id: raw.customer_id ? String(raw.customer_id).slice(0, 64) : null,
    paid: raw.paid === true || raw.paid === 'true',
    dropped: raw.dropped === true || raw.dropped === 'true',
    notes: raw.notes ? String(raw.notes).slice(0, 1000) : null,
  };
}

// GET /api/events
// Query params:
//   when=upcoming | past | all  (default: all)
//   event_type, from, to, limit, offset
router.get('/', async (req, res, next) => {
  try {
    const limit  = Math.min(Number(req.query.limit)  || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const when   = req.query.when || 'all';

    const supabase = getSupabase();
    let query = supabase.from('events').select('*', { count: 'exact' });
    if (req.query.event_type) query = query.eq('event_type', req.query.event_type);
    if (req.query.from)       query = query.gte('event_date', req.query.from);
    if (req.query.to)         query = query.lte('event_date', req.query.to);

    const nowIso = new Date().toISOString();
    if (when === 'upcoming') {
      query = query.gte('event_date', nowIso).order('event_date', { ascending: true });
    } else if (when === 'past') {
      query = query.lt('event_date', nowIso).order('event_date', { ascending: false });
    } else {
      query = query.order('event_date', { ascending: false });
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) throw error;
    res.json({ data, count, limit, offset });
  } catch (err) { next(err); }
});

// GET /api/events/:id
router.get('/:id', async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('events').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Event not found');
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/events  (manager+)
// Body: { name, event_type, event_date, entry_fee?, capacity?, notes?, participants? }
router.post('/', requireMinRole('manager'), async (req, res, next) => {
  try {
    const body = validate(req.body, {
      name:       { type: 'string', required: true, max: 200 },
      event_type: { type: 'string', required: true, max: 100 },
      event_date: { type: 'string', required: true, max: 100 },
      entry_fee:  { type: 'number', min: 0 },
      capacity:   { type: 'int',    min: 0 },
      notes:      { type: 'string', max: 4000 },
      participants: { type: 'array' },
    });

    // event_date should parse as a real date.
    const d = new Date(body.event_date);
    if (Number.isNaN(d.getTime())) throw badRequest('event_date must be a valid date/time');

    const participants = Array.isArray(body.participants)
      ? body.participants.map(normalizeParticipant)
      : [];

    if (body.capacity != null && participants.length > body.capacity) {
      throw badRequest('participants exceeds capacity');
    }

    const row = {
      name:       body.name,
      event_type: body.event_type,
      event_date: d.toISOString(),
      entry_fee:  round2(Number(body.entry_fee || 0)),
      capacity:   body.capacity != null ? body.capacity : null,
      participants,
      results:    null,
      notes:      body.notes || null,
    };

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('events').insert(row).select().single();
    if (error) throw error;

    logActivity({
      user: req.user, req,
      action: 'event.create', resourceType: 'event', resourceId: data.id,
      details: { name: data.name, event_type: data.event_type, event_date: data.event_date },
    });

    res.status(201).json(data);
  } catch (err) { next(err); }
});

// PATCH /api/events/:id  (manager+)
// Editable fields: name, event_type, event_date, entry_fee, capacity, notes.
// Use participants/results endpoints below for those fields.
router.patch('/:id', requireMinRole('manager'), async (req, res, next) => {
  try {
    const body = validate(req.body, {
      name:       { type: 'string', max: 200 },
      event_type: { type: 'string', max: 100 },
      event_date: { type: 'string', max: 100 },
      entry_fee:  { type: 'number', min: 0 },
      capacity:   { type: 'int',    min: 0 },
      notes:      { type: 'string', max: 4000 },
    });

    const patch = {};
    if (body.name       !== undefined) patch.name = body.name;
    if (body.event_type !== undefined) patch.event_type = body.event_type;
    if (body.event_date !== undefined) {
      const d = new Date(body.event_date);
      if (Number.isNaN(d.getTime())) throw badRequest('event_date must be a valid date/time');
      patch.event_date = d.toISOString();
    }
    if (body.entry_fee !== undefined) patch.entry_fee = round2(Number(body.entry_fee));
    if (body.capacity  !== undefined) patch.capacity  = body.capacity;
    if (body.notes     !== undefined) patch.notes     = body.notes;

    if (Object.keys(patch).length === 0) throw badRequest('No editable fields provided');

    const supabase = getSupabase();
    // Capacity guard: refuse to lower capacity below current registered count.
    if (patch.capacity != null) {
      const { data: existing, error: exErr } = await supabase
        .from('events').select('participants').eq('id', req.params.id).maybeSingle();
      if (exErr) throw exErr;
      if (!existing) throw notFound('Event not found');
      const count = (existing.participants || []).length;
      if (count > patch.capacity) {
        throw badRequest(`capacity (${patch.capacity}) is below current registered count (${count})`);
      }
    }

    const { data, error } = await supabase
      .from('events').update(patch).eq('id', req.params.id).select().maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Event not found');

    logActivity({
      user: req.user, req,
      action: 'event.update', resourceType: 'event', resourceId: data.id,
      details: { fields: Object.keys(patch) },
    });

    res.json(data);
  } catch (err) { next(err); }
});

// DELETE /api/events/:id  (manager+)
router.delete('/:id', requireMinRole('manager'), async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const { data: existing, error: exErr } = await supabase
      .from('events').select('id, name').eq('id', req.params.id).maybeSingle();
    if (exErr) throw exErr;
    if (!existing) throw notFound('Event not found');

    const { error } = await supabase.from('events').delete().eq('id', existing.id);
    if (error) throw error;

    logActivity({
      user: req.user, req,
      action: 'event.delete', resourceType: 'event', resourceId: existing.id,
      details: { name: existing.name },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/events/:id/participants  (employee+)
// Body: { name, email?, customer_id?, paid?, dropped?, notes? }
router.post('/:id/participants', requireMinRole('employee'), async (req, res, next) => {
  try {
    const participant = normalizeParticipant(req.body || {});

    const supabase = getSupabase();
    const { data: event, error: eErr } = await supabase
      .from('events').select('id, name, capacity, participants').eq('id', req.params.id).maybeSingle();
    if (eErr) throw eErr;
    if (!event) throw notFound('Event not found');

    const list = Array.isArray(event.participants) ? event.participants : [];
    if (event.capacity != null && list.length >= event.capacity) {
      throw badRequest('Event is at capacity');
    }

    // If customer_id was provided, verify it points at a real customer.
    if (participant.customer_id) {
      const { data: cust, error: cErr } = await supabase
        .from('customers').select('id').eq('id', participant.customer_id).maybeSingle();
      if (cErr) throw cErr;
      if (!cust) throw badRequest('Unknown customer_id');
    }

    const next = list.concat([participant]);
    const { data, error } = await supabase
      .from('events').update({ participants: next }).eq('id', event.id).select().single();
    if (error) throw error;

    logActivity({
      user: req.user, req,
      action: 'event.participant.add', resourceType: 'event', resourceId: event.id,
      details: { name: participant.name },
    });
    res.json(data);
  } catch (err) { next(err); }
});

// PATCH /api/events/:id/participants/:idx  (employee+)
// Body: subset of { name, email, customer_id, paid, dropped, notes }
router.patch('/:id/participants/:idx', requireMinRole('employee'), async (req, res, next) => {
  try {
    const idx = Number(req.params.idx);
    if (!Number.isInteger(idx) || idx < 0) throw badRequest('Invalid participant index');

    const supabase = getSupabase();
    const { data: event, error: eErr } = await supabase
      .from('events').select('id, participants').eq('id', req.params.id).maybeSingle();
    if (eErr) throw eErr;
    if (!event) throw notFound('Event not found');

    const list = Array.isArray(event.participants) ? event.participants.slice() : [];
    if (idx >= list.length) throw notFound('Participant not found');

    const existing = list[idx] || {};
    // Merge changes, keeping any field the request didn't touch.
    const merged = normalizeParticipant({ ...existing, ...req.body });
    list[idx] = merged;

    const { data, error } = await supabase
      .from('events').update({ participants: list }).eq('id', event.id).select().single();
    if (error) throw error;

    logActivity({
      user: req.user, req,
      action: 'event.participant.update', resourceType: 'event', resourceId: event.id,
      details: { idx, paid: merged.paid, dropped: merged.dropped },
    });
    res.json(data);
  } catch (err) { next(err); }
});

// DELETE /api/events/:id/participants/:idx  (employee+)
router.delete('/:id/participants/:idx', requireMinRole('employee'), async (req, res, next) => {
  try {
    const idx = Number(req.params.idx);
    if (!Number.isInteger(idx) || idx < 0) throw badRequest('Invalid participant index');

    const supabase = getSupabase();
    const { data: event, error: eErr } = await supabase
      .from('events').select('id, participants').eq('id', req.params.id).maybeSingle();
    if (eErr) throw eErr;
    if (!event) throw notFound('Event not found');

    const list = Array.isArray(event.participants) ? event.participants.slice() : [];
    if (idx >= list.length) throw notFound('Participant not found');

    const removed = list[idx];
    list.splice(idx, 1);

    const { data, error } = await supabase
      .from('events').update({ participants: list }).eq('id', event.id).select().single();
    if (error) throw error;

    logActivity({
      user: req.user, req,
      action: 'event.participant.remove', resourceType: 'event', resourceId: event.id,
      details: { idx, name: removed?.name },
    });
    res.json(data);
  } catch (err) { next(err); }
});

// PATCH /api/events/:id/results  (manager+)
// Body: { results: { bracket?: string|object, winners?: [{ place, name, prize? }], notes? } }
// Stores whatever shape the operator provides under `results` jsonb.
router.patch('/:id/results', requireMinRole('manager'), async (req, res, next) => {
  try {
    const results = req.body && req.body.results;
    if (results === undefined) throw badRequest('results field is required');
    if (results !== null && typeof results !== 'object') {
      throw badRequest('results must be an object or null');
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('events').update({ results }).eq('id', req.params.id).select().maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('Event not found');

    logActivity({
      user: req.user, req,
      action: 'event.results', resourceType: 'event', resourceId: data.id,
      details: {
        winners_count: Array.isArray(results?.winners) ? results.winners.length : 0,
      },
    });
    res.json(data);
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.EVENT_TYPES = EVENT_TYPES;
