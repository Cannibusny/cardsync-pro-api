// Shared fetch helper. Cookies are sent automatically because the API issues
// an HttpOnly cookie on /api/auth/login.
export async function api(path, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const resp = await fetch(path, { credentials: 'include', ...options, headers });
  const isJson = (resp.headers.get('content-type') || '').includes('application/json');
  const body = isJson ? await resp.json().catch(() => ({})) : await resp.text();
  if (!resp.ok) {
    const err = new Error(typeof body === 'object' ? (body.error || resp.statusText) : resp.statusText);
    err.status = resp.status;
    err.details = typeof body === 'object' ? body.details : undefined;
    throw err;
  }
  return body;
}

export const apiGet  = (p)        => api(p);
export const apiPost = (p, body)  => api(p, { method: 'POST',  body });
export const apiPatch = (p, body) => api(p, { method: 'PATCH', body });
export const apiDel  = (p)        => api(p, { method: 'DELETE' });

export function fmtMoney(n) {
  const x = Number(n) || 0;
  return x.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}
