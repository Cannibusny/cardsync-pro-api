const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');

const { getSupabase } = require('../supabase');
const { badRequest } = require('../lib/errors');
const { requireAuth, requireMinRole } = require('../middleware/auth');
const { logActivity } = require('../middleware/activity-log');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB cap
});

router.use(requireAuth);

const GAMES        = new Set(['pokemon','magic','yugioh','onepiece','other']);
const CONDITIONS   = new Set(['NM','LP','MP','HP','DMG','SEALED']);
const PRODUCT_TYPES = new Set(['single','sealed','graded','supply','other']);

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeRow(raw) {
  // Accept a flexible set of column names (case-insensitive, snake or title).
  const lower = {};
  for (const [k, v] of Object.entries(raw)) lower[k.trim().toLowerCase().replace(/\s+/g, '_')] = v;

  const pick = (...keys) => {
    for (const k of keys) if (lower[k] !== undefined && lower[k] !== '') return lower[k];
    return null;
  };

  const game = String(pick('game') || 'other').toLowerCase();
  const condition = String(pick('condition') || 'NM').toUpperCase();
  const productType = String(pick('product_type','type') || 'single').toLowerCase();

  return {
    name:           String(pick('name','card_name','title') || '').trim(),
    game:           GAMES.has(game) ? game : 'other',
    card_set:       pick('card_set','set','expansion') || null,
    number:         pick('number','collector_number','no') || null,
    rarity:         pick('rarity') || null,
    tcgplayer_id:   num(pick('tcgplayer_id','product_id','id')),
    product_type:   PRODUCT_TYPES.has(productType) ? productType : 'single',
    condition:      CONDITIONS.has(condition) ? condition : 'NM',
    graded:         /^(true|y|yes|1)$/i.test(String(pick('graded') || '')),
    grade_service:  pick('grade_service','grader') || null,
    grade:          pick('grade') || null,
    cert_number:    pick('cert_number','cert','certification') || null,
    quantity:       num(pick('quantity','qty')) || 1,
    cost_basis:     num(pick('cost_basis','cost','purchase_price')) || 0,
    sell_price:     num(pick('sell_price','price','list_price')) || 0,
    market_price:   num(pick('market_price','market')),
    location:       pick('location','shelf','bin') || null,
    image_url:      pick('image_url','image','img') || null,
    notes:          pick('notes','note') || null,
    source:         pick('source') || 'csv-import',
    date_acquired:  pick('date_acquired','date_purchased','date') || null,
  };
}

// POST /api/upload/cards  — multipart form, field 'file' is the CSV
router.post('/cards', requireMinRole('manager'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw badRequest('Missing CSV file (field name "file")');
    const text = req.file.buffer.toString('utf8');

    let parsed;
    try {
      parsed = parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true });
    } catch (err) {
      throw badRequest('Could not parse CSV: ' + err.message);
    }
    if (!Array.isArray(parsed) || parsed.length === 0) throw badRequest('CSV is empty');
    if (parsed.length > 5000) throw badRequest('CSV too large (max 5,000 rows per upload)');

    const rows = parsed.map(normalizeRow).filter((r) => r.name && r.game);
    if (rows.length === 0) throw badRequest('No valid rows (each row needs at least a `name` and `game`)');

    const supabase = getSupabase();
    const chunkSize = 200;
    let inserted = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error, count } = await supabase.from('cards').insert(chunk, { count: 'exact' });
      if (error) {
        errors.push({ chunk: i / chunkSize, message: error.message });
      } else {
        inserted += count || chunk.length;
      }
    }

    logActivity({
      user: req.user, req,
      action: 'cards.bulk_import',
      details: { total: rows.length, inserted, errors: errors.length },
    });

    res.status(errors.length ? 207 : 201).json({
      ok: errors.length === 0,
      total_rows: rows.length,
      inserted,
      skipped:    rows.length - inserted,
      errors,
    });
  } catch (err) { next(err); }
});

module.exports = router;
