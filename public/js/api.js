// Dünner Wrapper um fetch – Sitzung läuft über das Cookie ffp_session.
export async function api(method, url, body) {
  const opt = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let r;
  try { r = await fetch(url, opt); } catch { throw new Error('Keine Verbindung zum Server'); }
  let data = null;
  try { data = await r.json(); } catch { /* leer */ }
  if (!r.ok) {
    const err = new Error(data?.error || `Fehler ${r.status}`);
    err.status = r.status;
    if (r.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event('ffp:logout'));
    throw err;
  }
  return data;
}
export const get = (u) => api('GET', u);
export const post = (u, b = {}) => api('POST', u, b);
export const put = (u, b = {}) => api('PUT', u, b);
export const patch = (u, b = {}) => api('PATCH', u, b);
export const del = (u) => api('DELETE', u);

export const fmtDate = (ms) => ms ? new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–';
export const fmtDateTime = (ms) => ms ? new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–';
export const initials = (u) => (u.name || u.email || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
