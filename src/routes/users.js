const express = require('express');

const { getSupabase } = require('../supabase');
const { validate } = require('../lib/validate');
const { notFound, badRequest, conflict } = require('../lib/errors');
const { requireAuth, requireRole, requireMinRole } = require('../middleware/auth');
const { logActivity } = require('../middleware/activity-log');
const { hash: hashPassword } = require('../lib/password');

const router = express.Router();

const ROLES = ['owner','manager','employee','view_only'];

router.use(requireAuth);

// GET /api/users  (manager and up — employees can't see staff roster)
router.get('/', requireMinRole('manager'), async (req, res, next) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('users').select('id, name, email, role, active, last_login_at, created_at')
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json({ data });
  } catch (err) { next(err); }
});

// POST /api/users  (owner only — adding new operators)
router.post('/', requireRole('owner'), async (req, res, next) => {
  try {
    const { name, email, password, role } = validate(req.body, {
      name:     { type: 'string', required: true, max: 200 },
      email:    { type: 'email',  required: true },
      password: { type: 'string', required: true, max: 200 },
      role:     { type: 'string', required: true, in: ROLES },
    });
    if (password.length < 8) throw badRequest('Password must be at least 8 characters');

    const supabase = getSupabase();
    const { data: existing } = await supabase.from('users').select('id').eq('email', email).maybeSingle();
    if (existing) throw conflict('A user with that email already exists');

    const password_hash = await hashPassword(password);
    const { data, error } = await supabase
      .from('users').insert({ name, email, password_hash, role, active: true })
      .select('id, name, email, role, active, created_at').single();
    if (error) throw error;

    logActivity({
      user: req.user, req,
      action: 'user.create', resourceType: 'user', resourceId: data.id,
      details: { email: data.email, role: data.role },
    });

    res.status(201).json(data);
  } catch (err) { next(err); }
});

// PATCH /api/users/:id  (owner — change role, deactivate, rename)
router.patch('/:id', requireRole('owner'), async (req, res, next) => {
  try {
    const payload = validate(req.body, {
      name:     { type: 'string', max: 200 },
      role:     { type: 'string', in: ROLES },
      active:   { type: 'boolean' },
      password: { type: 'string', max: 200 },
    });

    const updates = {};
    if (payload.name   !== undefined) updates.name = payload.name;
    if (payload.role   !== undefined) updates.role = payload.role;
    if (payload.active !== undefined) updates.active = payload.active;
    if (payload.password) {
      if (payload.password.length < 8) throw badRequest('Password must be at least 8 characters');
      updates.password_hash = await hashPassword(payload.password);
    }
    if (Object.keys(updates).length === 0) throw badRequest('No fields to update');

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('users').update(updates).eq('id', req.params.id)
      .select('id, name, email, role, active, last_login_at, created_at').maybeSingle();
    if (error) throw error;
    if (!data) throw notFound('User not found');

    logActivity({
      user: req.user, req,
      action: 'user.update', resourceType: 'user', resourceId: data.id,
      details: { fields: Object.keys(updates) },
    });

    res.json(data);
  } catch (err) { next(err); }
});

// DELETE /api/users/:id  (owner)
router.delete('/:id', requireRole('owner'), async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) throw badRequest('You cannot delete your own account');
    const supabase = getSupabase();
    const { error, count } = await supabase
      .from('users').delete({ count: 'exact' }).eq('id', req.params.id);
    if (error) throw error;
    if (!count) throw notFound('User not found');

    logActivity({ user: req.user, req, action: 'user.delete', resourceType: 'user', resourceId: req.params.id });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
