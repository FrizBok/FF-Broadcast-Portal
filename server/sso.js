// Single Sign-on für Module, die als eigener Dienst laufen (z. B. die Overlay Engine).
//
// Ablauf: Kachel → GET /sso/<modul> im Portal → Portal prüft Anmeldung und Modulrecht → stellt eine
// „Eintrittskarte“ (Ticket) aus → Weiterleitung zu <Modul-URL>/auth/portal?ticket=… → das Modul prüft
// die Unterschrift mit demselben Schlüssel und öffnet eine eigene Sitzung mit der Rolle aus dem Portal.
//
// Ticket = base64url(JSON) "." base64url(HMAC-SHA256(Schlüssel, base64url(JSON)))
// Inhalt:  { v: 1, iss: 'ff-broadcast-portal', aud: <modul-id>, sub, email, name, role, platform_admin,
//            iat, exp (iat + 60 s), jti (zufällig, nur einmal gültig) }
// Schlüssel: Umgebungsvariable <MODUL>_SSO_SECRET (z. B. OVERLAY_SSO_SECRET), im Modul identisch hinterlegt.
import crypto from 'node:crypto';

export const TICKET_SECONDS = 60;
const b64 = (buf) => Buffer.from(buf).toString('base64url');

export const ssoSecret = (m) => (process.env[`${m.id.toUpperCase().replace(/-/g, '_')}_SSO_SECRET`] || '').trim();
/** Adresse vereinheitlichen: ohne http(s):// wird https:// ergänzt, Pfad und Slash am Ende fallen weg */
export function normalizeBaseUrl(raw) {
  let v = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v.replace(/^\/+/, '');
  try { return new URL(v).origin; } catch { return ''; }
}
export const ssoUrl = (m) => normalizeBaseUrl(m.url);
/** Modul ist für Single Sign-on fertig eingerichtet (Adresse und mind. 32 Zeichen Schlüssel) */
export const ssoReady = (m) => !!(m.sso && ssoUrl(m) && ssoSecret(m).length >= 32);

export function signTicket(payload, secret) {
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(crypto.createHmac('sha256', secret).update(body).digest())}`;
}

/** Gegenstück (so prüft auch das Modul): Inhalt oder null */
export function verifyTicket(ticket, secret, aud, now = Date.now()) {
  const [body, sig] = String(ticket || '').split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (p.v !== 1 || p.aud !== aud || typeof p.exp !== 'number' || p.exp * 1000 < now) return null;
  return p;
}

export function ticketFor(m, user, role) {
  const iat = Math.floor(Date.now() / 1000);
  return signTicket({
    v: 1, iss: 'ff-broadcast-portal', aud: m.id, sub: String(user.id), email: user.email, name: user.name || '',
    role, platform_admin: user.role === 'admin', iat, exp: iat + TICKET_SECONDS, jti: crypto.randomBytes(16).toString('hex'),
  }, ssoSecret(m));
}
