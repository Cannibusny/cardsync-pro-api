const bcrypt = require('bcryptjs');

const COST = 10;

async function hash(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length < 8) {
    throw Object.assign(new Error('Password must be at least 8 characters'), { status: 400 });
  }
  return bcrypt.hash(plaintext, COST);
}

async function verify(plaintext, hashValue) {
  if (!plaintext || !hashValue) return false;
  return bcrypt.compare(plaintext, hashValue);
}

module.exports = { hash, verify };
