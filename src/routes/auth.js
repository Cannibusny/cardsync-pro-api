const express = require('express');
const rateLimit = require('express-rate-limit');

const { getSupabase } = require('../supabase');
const { sign } = require('../lib/jwt');
const { verify: verifyPassword, hash: hashPassword } = require('../lib/password');
const { validate } = require('../lib/validate');
const { unauthorized, notFound, badRequest } = require('../lib/errors');
const { requireAuth } = require('../middleware/auth');
const { logActivity } = require('../middleware/activity-log');

const router = express.Router();

const COOKIE_NAME = 'cardsync_session';
const cookieOpts = () => ({
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path:     '/',
  maxAge:   12 * 60 * 60 * 1000,
});

// Aggressive rate limit on the login path to slow credential stuffing.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      Number(process.env.LOGIN_RATE_LIMIT || 20),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many login attempts; try again later.' },
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = validate(req.body, {
      email:    { type: 'email',  required: true },
      password: { type: 'string', required: true, max: 200 },
    });

    const supabase = getSupabase();
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, role, password_hash, active')
      .eq('email', email)
      .maybeSingle();
    if (error) throw error;
    if (!user || !user.active) throw unauthorized('Invalid email or password');

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) throw unauthorized('Invalid email or password');

    const token = sign({
      sub:   user.id,
      email: user.email,
      role:  user.role,
      name:  user.name,
    });

    res.cookie(COOKIE_NAME, token, cookieOpts());

    // Best-effort last-login bump (don't fail login if this errors).
    supabase.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id)
      .then(() => {}, () => {});

    logActivity({
      user, req,
      action:       'auth.login',
      resourceType: 'user',
      resourceId:   user.id,
    });

    res.json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token, // also returned for non-cookie API consumers (mobile, scripts)
    });
  } catch (err) { next(err); }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, cookieOpts());
  if (req.user) {
    logActivity({
      user: req.user, req,
      action:       'auth.logout',
      resourceType: 'user',
      resourceId:   req.user.id,
    });
  }
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { current_password, new_password } = validate(req.body, {
      current_password: { type: 'string', required: true, max: 200 },
      new_password:     { type: 'string', required: true, max: 200 },
    });
    if (new_password.length < 8) throw badRequest('New password must be at least 8 characters');

    const supabase = getSupabase();
    const { data: user, error } = await supabase
      .from('users').select('password_hash').eq('id', req.user.id).maybeSingle();
    if (error) throw error;
    if (!user) throw notFound('User not found');

    const ok = await verifyPassword(current_password, user.password_hash);
    if (!ok) throw unauthorized('Current password is incorrect');

    const newHash = await hashPassword(new_password);
    const { error: upErr } = await supabase
      .from('users').update({ password_hash: newHash }).eq('id', req.user.id);
    if (upErr) throw upErr;

    logActivity({
      user: req.user, req,
      action:       'auth.change_password',
      resourceType: 'user',
      resourceId:   req.user.id,
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/auth/init — owners may seed/promote an initial owner if no
// active owners exist yet. Useful right after running schema.sql since the
// seed row uses a placeholder password.
router.post('/init', async (req, res, next) => {
  try {
    const { email, password, name } = validate(req.body, {
      email:    { type: 'email',  required: true },
      password: { type: 'string', required: true, max: 200 },
      name:     { type: 'string', required: true, max: 200 },
    });
    if (password.length < 8) throw badRequest('Password must be at least 8 characters');

    const supabase = getSupabase();
    const { data: owners, error: ownerErr } = await supabase
      .from('users').select('id').eq('role', 'owner').eq('active', true);
    if (ownerErr) throw ownerErr;

    // Once a real owner exists, /init becomes inert — must use normal user
    // management to add or promote.
    if (owners && owners.length > 0) {
      // Replace the seed default-owner if it's still using the placeholder hash.
      // We can identify it by email = owner@cardsync.local AND last_login_at IS NULL.
      const { data: seed } = await supabase
        .from('users').select('id').eq('email', 'owner@cardsync.local').is('last_login_at', null).maybeSingle();
      if (!seed) throw badRequest('Owner already initialized. Use /api/users to add new operators.');
    }

    const password_hash = await hashPassword(password);

    // Upsert by email so re-running /init updates the seed.
    const { data: existing } = await supabase
      .from('users').select('id').eq('email', email).maybeSingle();

    let user;
    if (existing) {
      const { data, error } = await supabase
        .from('users').update({ password_hash, name, role: 'owner', active: true })
        .eq('id', existing.id).select().single();
      if (error) throw error;
      user = data;
    } else {
      const { data, error } = await supabase
        .from('users').insert({ name, email, password_hash, role: 'owner', active: true })
        .select().single();
      if (error) throw error;
      user = data;
    }

    // Remove the seed row if it's still around and not the row we just wrote.
    await supabase.from('users').delete()
      .eq('email', 'owner@cardsync.local')
      .neq('id', user.id);

    logActivity({
      user: { id: user.id, email: user.email },
      action:       'auth.init_owner',
      resourceType: 'user',
      resourceId:   user.id,
      req,
    });

    res.status(201).json({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.cookieName = COOKIE_NAME;
module.exports.cookieOpts = cookieOpts;
