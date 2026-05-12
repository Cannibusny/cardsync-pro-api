const { badRequest } = require('./errors');

// Lightweight schema-checker. Accepts a spec object where each key maps to a
// validator descriptor. Validators run in order and the first error stops the
// chain. Returns the coerced object on success; throws HttpError(400) on
// failure.
//
// Example:
//   validate(req.body, {
//     name: { type: 'string', required: true, max: 200 },
//     game: { type: 'string', required: true, in: ['pokemon','magic','yugioh','onepiece','other'] },
//     quantity: { type: 'int', min: 0 },
//     sell_price: { type: 'number', min: 0 },
//   });
function validate(input, spec) {
  if (!input || typeof input !== 'object') throw badRequest('Request body must be a JSON object');
  const out = {};
  const errors = [];

  for (const [key, rule] of Object.entries(spec)) {
    const value = input[key];
    if (value === undefined || value === null || value === '') {
      if (rule.required) errors.push(`${key} is required`);
      continue;
    }

    let coerced = value;
    if (rule.type === 'string') {
      if (typeof coerced !== 'string') { errors.push(`${key} must be a string`); continue; }
      coerced = coerced.trim();
      if (rule.max && coerced.length > rule.max) { errors.push(`${key} must be ≤ ${rule.max} characters`); continue; }
    } else if (rule.type === 'int') {
      const n = Number(coerced);
      if (!Number.isInteger(n)) { errors.push(`${key} must be an integer`); continue; }
      coerced = n;
    } else if (rule.type === 'number') {
      const n = Number(coerced);
      if (!Number.isFinite(n)) { errors.push(`${key} must be a number`); continue; }
      coerced = n;
    } else if (rule.type === 'boolean') {
      if (typeof coerced === 'string') coerced = coerced === 'true';
      if (typeof coerced !== 'boolean') { errors.push(`${key} must be boolean`); continue; }
    } else if (rule.type === 'array') {
      if (!Array.isArray(coerced)) { errors.push(`${key} must be an array`); continue; }
    } else if (rule.type === 'object') {
      if (typeof coerced !== 'object' || Array.isArray(coerced)) { errors.push(`${key} must be an object`); continue; }
    } else if (rule.type === 'date') {
      const d = new Date(coerced);
      if (Number.isNaN(d.getTime())) { errors.push(`${key} must be a valid date`); continue; }
      coerced = d.toISOString().slice(0, 10);
    } else if (rule.type === 'email') {
      if (typeof coerced !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(coerced)) {
        errors.push(`${key} must be a valid email`); continue;
      }
      coerced = coerced.trim().toLowerCase();
    }

    if (rule.min !== undefined && Number(coerced) < rule.min) { errors.push(`${key} must be ≥ ${rule.min}`); continue; }
    if (rule.max !== undefined && rule.type !== 'string' && Number(coerced) > rule.max) {
      errors.push(`${key} must be ≤ ${rule.max}`); continue;
    }
    if (rule.in && !rule.in.includes(coerced)) {
      errors.push(`${key} must be one of: ${rule.in.join(', ')}`); continue;
    }
    if (rule.regex && !rule.regex.test(String(coerced))) {
      errors.push(`${key} is not in the expected format`); continue;
    }

    out[key] = coerced;
  }

  if (errors.length) throw badRequest('Validation failed', errors);
  return out;
}

module.exports = { validate };
