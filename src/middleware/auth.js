const { verify } = require('../lib/jwt');
const { unauthorized, forbidden } = require('../lib/errors');

// Reads JWT from HttpOnly cookie 'cardsync_session' OR from the
// 'Authorization: Bearer <token>' header (for API clients / scripts).
function extractToken(req) {
  const cookieToken = req.cookies && req.cookies.cardsync_session;
  if (cookieToken) return cookieToken;
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

// Attach req.user when a valid token is present, but never reject. Useful for
// endpoints that are publicly visible but adapt behaviour for logged-in users.
function attachUser(req, _res, next) {
  const token = extractToken(req);
  if (token) {
    const payload = verify(token);
    if (payload && payload.sub) {
      req.user = {
        id:    payload.sub,
        email: payload.email,
        role:  payload.role,
        name:  payload.name,
      };
    }
  }
  next();
}

// Hard auth — reject if no valid token.
function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

// Role-based access control. Pass one or more allowed roles.
// Hierarchy (owner > manager > employee > view_only) — but rules can also
// specify exact role membership.
const ROLE_RANK = { owner: 4, manager: 3, employee: 2, view_only: 1 };

function requireRole(...allowed) {
  const set = new Set(allowed);
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!set.has(req.user.role)) return next(forbidden(`Requires role: ${allowed.join(' or ')}`));
    next();
  };
}

function requireMinRole(minRole) {
  const min = ROLE_RANK[minRole] || 99;
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    const rank = ROLE_RANK[req.user.role] || 0;
    if (rank < min) return next(forbidden(`Requires ${minRole} or higher`));
    next();
  };
}

module.exports = { attachUser, requireAuth, requireRole, requireMinRole, ROLE_RANK };
