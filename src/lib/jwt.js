const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'insecure-dev-secret-please-set-JWT_SECRET';
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

if (SECRET === 'insecure-dev-secret-please-set-JWT_SECRET') {
  console.warn('[jwt] JWT_SECRET not set — using insecure default. DO NOT deploy without setting JWT_SECRET.');
}

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

function verify(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch (_err) {
    return null;
  }
}

module.exports = { sign, verify, EXPIRES_IN };
