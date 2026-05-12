class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    if (details) this.details = details;
  }
}

function badRequest(message, details)   { return new HttpError(400, message, details); }
function unauthorized(message = 'Authentication required') { return new HttpError(401, message); }
function forbidden(message = 'Forbidden') { return new HttpError(403, message); }
function notFound(message = 'Not found') { return new HttpError(404, message); }
function conflict(message)              { return new HttpError(409, message); }

function errorHandler(err, _req, res, _next) {
  if (err && err.code === 'ETIMEDOUT') {
    return res.status(504).json({ error: 'Upstream timeout' });
  }
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(err.details ? { details: err.details } : {}),
  });
}

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict, errorHandler };
