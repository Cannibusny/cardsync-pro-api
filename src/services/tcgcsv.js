// TCGCSV importer.
// Fetches daily CSV dumps of TCGPlayer prices from https://tcgcsv.com/ and
// upserts them into the `card_prices` cache table. Free; no API key required.
//
// Endpoint pattern:
//   https://tcgcsv.com/tcgplayer/<category-id>/<group-id>/ProductsAndPrices.csv
// or aggregate per category (we use the per-group URLs because they include
// product names and group names directly).
//
// Categories of interest:
//   3  = Pokemon
//   1  = Magic: The Gathering
//   2  = Yu-Gi-Oh!
//   23 = One Piece
//
// Strategy: fetch group list per category -> fetch each group's
// ProductsAndPrices.csv -> upsert into card_prices.

const { parse } = require('csv-parse/sync');
const { getSupabase } = require('../supabase');

const TCGCSV_BASE = 'https://tcgcsv.com/tcgplayer';

// Map TCGCSV category ids -> our game key.
const CATEGORY_GAME = {
  3:  'pokemon',
  1:  'magic',
  2:  'yugioh',
  23: 'onepiece',
};

async function fetchJson(url) {
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`Failed ${resp.status} fetching ${url}`);
  return resp.json();
}

async function fetchText(url) {
  const resp = await fetch(url, { headers: { Accept: 'text/csv,*/*' } });
  if (!resp.ok) throw new Error(`Failed ${resp.status} fetching ${url}`);
  return resp.text();
}

// Fetch the list of groups (i.e. sets / expansions) for a category.
async function fetchGroups(categoryId) {
  const json = await fetchJson(`${TCGCSV_BASE}/${categoryId}/groups`);
  return (json && json.results) || (Array.isArray(json) ? json : []);
}

async function fetchProductsAndPrices(categoryId, groupId) {
  const csv = await fetchText(`${TCGCSV_BASE}/${categoryId}/${groupId}/ProductsAndPrices.csv`);
  return parse(csv, { columns: true, skip_empty_lines: true, trim: true });
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowToPriceRecord(row, game, groupName) {
  // TCGCSV columns include: productId, name, cleanName, group, marketPrice,
  // lowPrice, midPrice, highPrice, directLowPrice, subTypeName.
  // For graded variants you'd cross-reference subTypeName.
  const id = num(row.productId);
  if (!id) return null;
  return {
    tcgplayer_id:      id,
    name:              row.name || row.cleanName || '',
    game,
    card_set:          groupName || row.group || null,
    market_price:      num(row.marketPrice),
    low_price:         num(row.lowPrice),
    mid_price:         num(row.midPrice),
    high_price:        num(row.highPrice),
    direct_low_price:  num(row.directLowPrice),
    refreshed_at:      new Date().toISOString(),
  };
}

async function refreshCategory(categoryId) {
  const game = CATEGORY_GAME[Number(categoryId)] || `category-${categoryId}`;
  const groups = await fetchGroups(categoryId);
  if (!groups.length) return { game, groups: 0, prices: 0 };

  const supabase = getSupabase();
  let totalPrices = 0;

  for (const group of groups) {
    const groupId = group.groupId || group.id;
    const groupName = group.name;
    if (!groupId) continue;

    try {
      const rows = await fetchProductsAndPrices(categoryId, groupId);
      const records = rows.map((r) => rowToPriceRecord(r, game, groupName)).filter(Boolean);
      if (!records.length) continue;

      // Chunk upserts to keep request size sane.
      const chunkSize = 500;
      for (let i = 0; i < records.length; i += chunkSize) {
        const chunk = records.slice(i, i + chunkSize);
        const { error } = await supabase.from('card_prices').upsert(chunk, { onConflict: 'tcgplayer_id' });
        if (error) throw error;
      }
      totalPrices += records.length;
    } catch (err) {
      console.warn(`[tcgcsv] failed group ${categoryId}/${groupId}:`, err.message);
    }
  }

  return { game, groups: groups.length, prices: totalPrices };
}

async function refreshAll(categories) {
  const out = [];
  for (const id of categories) {
    const result = await refreshCategory(id);
    out.push(result);
  }
  return out;
}

module.exports = { refreshCategory, refreshAll, CATEGORY_GAME };
