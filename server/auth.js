import crypto from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/* ------------------------------------------------------------------ Passwörter */
export function hashPassword(pw) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(pw, salt, 64, SCRYPT, (err, key) => {
      if (err) return reject(err);
      resolve(`scrypt$${salt.toString('base64')}$${key.toString('base64')}`);
    });
  });
}

export function verifyPassword(pw, stored) {
  return new Promise((resolve) => {
    const [algo, saltB64, keyB64] = String(stored || '').split('$');
    if (algo !== 'scrypt' || !saltB64 || !keyB64) return resolve(false);
    const expected = Buffer.from(keyB64, 'base64');
    crypto.scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT, (err, key) => {
      if (err) return resolve(false);
      resolve(crypto.timingSafeEqual(key, expected));
    });
  });
}

/* ------------------------------------------------------------------ Signierte Tokens (HMAC-SHA256, JWT-ähnlich, ohne Fremdbibliothek) */
export function signToken(payload, secret, ttlSec = 30 * 24 * 3600) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.exp && p.exp < Date.now() / 1000) return null;
    return p;
  } catch {
    return null;
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, secure, httpOnly = true, sameSite = 'Lax', path = '/' } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (maxAge != null) c += `; Max-Age=${maxAge}`;
  if (httpOnly) c += '; HttpOnly';
  if (secure) c += '; Secure';
  return c;
}

/* ------------------------------------------------------------------ Zwei-Faktor (TOTP nach RFC 6238, SHA-1, 6 Stellen, 30 s) */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

export function unbase32(s) {
  let bits = 0, val = 0;
  const out = [];
  for (const ch of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    val = (val << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32(crypto.randomBytes(20));

/** Code für einen bestimmten Zeitschritt */
export function totpCode(secret, counter, digits = 6) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', unbase32(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}

/** Prüft einen Code (±1 Zeitschritt Toleranz). Liefert den passenden Zeitschritt oder null. */
export function verifyTotp(secret, code, at = Date.now()) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now = Math.floor(at / 30000);
  for (const step of [now, now - 1, now + 1]) {
    const exp = totpCode(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(c))) return step;
  }
  return null;
}

export function otpauthUrl(secret, account, issuer = 'FrankenFinals Broadcast') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** Wiederherstellungscodes: 10 Stück im Format xxxxx-xxxxx (ohne leicht verwechselbare Zeichen) */
const RC_ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
export function makeRecoveryCodes(n = 10) {
  const one = () => {
    const bytes = crypto.randomBytes(10);
    const s = [...bytes].map((b) => RC_ALPHA[b % RC_ALPHA.length]).join('');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  };
  return Array.from({ length: n }, one);
}
export const normalizeRecovery = (c) => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const hashRecovery = (c) => crypto.createHash('sha256').update('rc:' + normalizeRecovery(c)).digest('hex');

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
