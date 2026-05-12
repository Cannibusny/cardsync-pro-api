const express = require('express');

const { getSupabase } = require('../supabase');
const { badRequest } = require('../lib/errors');
const { requireAuth, requireMinRole } = require('../middleware/auth');
const { logActivity } = require('../middleware/activity-log');

const router = express.Router();

router.use(requireAuth);

// Settings are read-mostly, low-cardinality, and small. We don't bother with
// pagination — return everything as a flat key->value map.
//
// GET /api/settings -> { key: value, key2: value2, ... }
router.get('/', async (_req, res, next) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('settings').select('key, value');
    if (error) throw error;
    const map = {};
    for (const row of (data || [])) map[row.key] = row.value;
    res.json(map);
  } catch (err) { next(err); }
});

// PATCH /api/settings { key: value, ... } — upsert each provided key.
// Manager+ only. Empty body or invalid types -> 400. We accept any JSON value
// (jsonb column on the settings table).
router.patch('/', requireMinRole('manager'), async (req, res, next) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      throw badRequest('Body must be a JSON object of { key: value } pairs');
    }
    const keys = Object.keys(req.body);
    if (keys.length === 0) throw badRequest('At least one setting key is required');

    const supabase = getSupabase();
    const rows = keys.map((k) => ({ key: k, value: req.body[k], updated_at: new Date().toISOString() }));
    const { data, error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' }).select();
    if (error) throw error;

    logActivity({
      user: req.user, req,
      action: 'settings.update', resourceType: 'setting',
      details: { keys },
    });

    const map = {};
    for (const row of (data || [])) map[row.key] = row.value;
    res.json(map);
  } catch (err) { next(err); }
});

module.exports = router;
