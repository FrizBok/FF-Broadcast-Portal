// FF-Broadcast Portal – HTTP-Server (ohne Fremdpakete: nur Node.js ≥ 22.13)
import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, DATA_DIR, getSecret, getSetting, setSetting, randomToken, seal, unseal, tx, ensureOwner, Q, updateRow, NO_PASSWORD } from './db.js';
import * as audit from './audit.js';
import * as mail from './mail.js';
import * as backup from './backup.js';
import * as ann from './announce.js';
import {
  hashPassword, verifyPassword, signToken, verifyToken, parseCookies, serializeCookie, sha256,
  newTotpSecret, verifyTotp, otpauthUrl, makeRecoveryCodes, hashRecovery, normalizeRecovery,
} from './auth.js';
import { modules, moduleById, moduleRole, canModule, modulesOfUser, allUserModules, setUserModules, publicManifest } from './modules.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const COOKIE = 'ffp_session';
const SECRET = getSecret();
const MIN_PW = 10;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const SETUP_TOKEN = process.env.SETUP_TOKEN || '';

/* ================================================================== Helfer */
class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };
const HANDLED = Symbol('handled'); // Antwort wurde vom Handler selbst gesendet (z. B. Datei-Download)

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function send(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC_HEADERS, ...headers });
  res.end(body);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Anfrage zu groß')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Ungültiges JSON')); }
    });
    req.on('error', reject);
  });
}

const clientIp = (req) => {
  if (TRUST_PROXY) {
    const x = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (x) return x;
  }
  return req.socket.remoteAddress || '';
};
const isSecure = (req) => {
  if (process.env.COOKIE_SECURE === 'true') return true;
  if (process.env.COOKIE_SECURE === 'false') return false;
  return TRUST_PROXY ? req.headers['x-forwarded-proto'] === 'https' : !!req.socket.encrypted;
};
const reqHost = (req) => (TRUST_PROXY && req.headers['x-forwarded-host']) || req.headers.host || '';
const baseUrl = (req) => mail.appUrl() || `${isSecure(req) ? 'https' : 'http'}://${reqHost(req)}`;

/** Kurzbeschreibung des Geräts für das Protokoll, z. B. „Safari · iPhone“ */
function uaShort(req) {
  const ua = String(req.headers['user-agent'] || '');
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${br} · ${os}` : br;
}

/* ================================================================== Router */
const routes = [];
function route(method, p, ...handlers) {
  const keys = [];
  const re = new RegExp('^' + p.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handlers });
}
const GET = (p, ...h) => route('GET', p, ...h);
const POST = (p, ...h) => route('POST', p, ...h);
const PUT = (p, ...h) => route('PUT', p, ...h);
const PATCH = (p, ...h) => route('PATCH', p, ...h);
const DELETE = (p, ...h) => route('DELETE', p, ...h);

const needAuth = (req) => { if (!req.user) fail(401, 'Bitte anmelden'); };
const needAdmin = (req) => { needAuth(req); if (req.user.role !== 'admin') fail(403, 'Dafür sind Admin-Rechte nötig'); };
const needOwner = (req) => { needAuth(req); if (!req.user.owner) fail(403, 'Das darf nur der Super-Admin'); };

/* ================================================================== Benutzer & Sitzungen */
const twofaPolicy = () => (getSetting('twofa_policy') === 'required' ? 'required' : 'optional');

/** Benutzerzeile → Objekt für die laufende Anfrage */
const hydrate = (u) => ({
  ...u,
  owner: !!u.is_owner,
  modules: modulesOfUser(u.id),
  must_2fa: twofaPolicy() === 'required' && !u.totp_enabled,
});

/** Darstellung für den Benutzer selbst */
function userOut(u) {
  const mods = {};
  for (const m of modules) { const r = moduleRole(u, m.manifest.id); if (r) mods[m.manifest.id] = r; }
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, kind: u.kind, owner: !!u.owner,
    must_change: !!u.must_change, totp_enabled: !!u.totp_enabled, must_2fa: !!u.must_2fa,
    expires_at: u.expires_at || null, modules: mods,
  };
}

/** Darstellung für die Benutzerverwaltung */
function userAdminOut(u, mods) {
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, kind: u.kind, owner: !!u.is_owner,
    active: !!u.active, expires_at: u.expires_at || null, expired: !!(u.expires_at && u.expires_at < Date.now()),
    invite_open: String(u.password_hash).startsWith(NO_PASSWORD), must_change: !!u.must_change,
    totp_enabled: !!u.totp_enabled, last_login: u.last_login, created_at: u.created_at,
    modules: mods || {},
  };
}

function sessionUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const bearer = (req.headers.authorization || '').match(/^Bearer (.+)$/i)?.[1];
  const p = verifyToken(bearer || cookies[COOKIE], SECRET);
  if (!p || p.p || !p.uid) return null; // Tokens mit Zweck (z. B. 2FA-Ticket) sind keine Sitzung
  const u = Q.userById.get(p.uid);
  if (!u || u.token_version !== p.tv || !u.active) return null;
  if (u.expires_at && u.expires_at < Date.now()) return null;
  return { user: hydrate(u), viaCookie: !bearer && !!cookies[COOKIE] };
}

function setSession(req, res, u) {
  const token = signToken({ uid: u.id, tv: u.token_version }, SECRET);
  res.setHeader('Set-Cookie', serializeCookie(COOKIE, token, { maxAge: 30 * 24 * 3600, secure: isSecure(req) }));
  return token;
}

/** Anmeldung abschließen (nach Passwort und ggf. 2FA) */
function completeLogin(req, res, u, extra = {}) {
  Q.touchLogin.run(u.id);
  audit.log('login', { actor: u, target: u.email, ip: clientIp(req), detail: { ua: uaShort(req), ...extra } });
  const token = setSession(req, res, u);
  return { user: userOut(hydrate(Q.userById.get(u.id))), token };
}

/* ---------- Drosselung gegen Raten */
const attempts = new Map(); // ip → [Zeitpunkte fehlgeschlagener Versuche]
function checkRate(ip) {
  const now = Date.now();
  const hits = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60000);
  attempts.set(ip, hits);
  if (hits.length >= 10) fail(429, 'Zu viele Fehlversuche. Bitte in einigen Minuten erneut versuchen.');
}
const noteFail = (ip) => attempts.set(ip, [...(attempts.get(ip) || []), Date.now()]);
const twofaFails = new Map(); // Benutzer-ID → [Zeitpunkte]
function checkTwofaRate(uid) {
  const now = Date.now();
  const hits = (twofaFails.get(uid) || []).filter((t) => now - t < 10 * 60000);
  twofaFails.set(uid, hits);
  if (hits.length >= 5) fail(429, 'Zu viele falsche Codes. Bitte in einigen Minuten erneut versuchen.');
}
setInterval(() => { attempts.clear(); twofaFails.clear(); }, 6 * 3600e3).unref();

/* ---------- Einmal-Links (Einladung / Passwort zurücksetzen) */
function createResetLink(userId, purpose, hours, createdBy) {
  Q.revokeResets.run(userId);
  const token = randomToken(24);
  Q.insertReset.run(userId, sha256(token), purpose, createdBy || null, Date.now() + hours * 3600e3);
  return { token, hours };
}
function resetRecord(token) {
  const rec = Q.resetByHash.get(sha256(token));
  if (!rec || rec.used_at || rec.expires_at < Date.now()) fail(400, 'Dieser Link ist ungültig oder abgelaufen');
  const user = Q.userById.get(rec.user_id);
  if (!user) fail(400, 'Dieser Link ist ungültig oder abgelaufen');
  return { rec, user };
}
async function mailLink(u, link, by, purpose) {
  if (!mail.enabled()) return { mailed: false };
  try {
    await mail.send(purpose === 'invite' ? mail.inviteMail(u, link, by) : mail.resetMail(u, link));
    return { mailed: true };
  } catch (e) { return { mailed: false, mail_error: e.message }; }
}
setInterval(() => { try { Q.cleanupResets.run(Date.now()); } catch { /* */ } }, 6 * 3600e3).unref();

function notifyPasswordChanged(u) {
  const owner = db.prepare('SELECT * FROM users WHERE is_owner=1').get();
  const contact = owner && owner.id !== u.id ? (owner.name || owner.email) : 'einem Admin';
  mail.notify(mail.passwordChangedMail(u, contact), 'Passwort-Hinweis', 'password');
}

const checkPassword = (pw) => { if (String(pw || '').length < MIN_PW) fail(400, `Das Passwort muss mindestens ${MIN_PW} Zeichen haben`); };
const genPassword = (len = 14) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length: len }, () => chars[randomInt(chars.length)]).join('');
};
const randomInt = (n) => crypto.randomInt(n);

/** Datum „YYYY-MM-DD“ → Ende dieses Tages (ms); leer → null */
function parseExpiry(v) {
  if (v == null || v === '') return null;
  const t = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? Date.parse(`${v}T23:59:59`) : NaN;
  if (Number.isNaN(t)) fail(400, 'Ungültiges Ablaufdatum');
  return t;
}

/* ================================================================== API: Anmeldung */
GET('/api/health', () => ({ ok: true, version: VERSION }));

GET('/api/auth/status', (req) => {
  const out = {
    needsSetup: Q.userCount.get().n === 0, setupToken: !!SETUP_TOKEN, user: req.user ? userOut(req.user) : null,
    version: VERSION, mail: mail.enabled(), twofaPolicy: twofaPolicy(),
  };
  if (req.user?.role === 'admin') { const s = audit.summary(); out.alerts = s.login_fails_24h + s.mail_fails_24h; }
  return out;
});

POST('/api/auth/setup', async (req, res) => {
  if (Q.userCount.get().n > 0) fail(400, 'Die Einrichtung ist bereits abgeschlossen');
  const { email, password, name, setup_token } = req.body;
  if (SETUP_TOKEN && setup_token !== SETUP_TOKEN) fail(403, 'Der Einrichtungs-Schlüssel stimmt nicht');
  if (!EMAIL_RE.test(email || '')) fail(400, 'Bitte eine gültige E-Mail-Adresse angeben');
  checkPassword(password);
  const { lastInsertRowid } = db.prepare("INSERT INTO users (email,name,password_hash,role,kind) VALUES (?,?,?,'admin','member')")
    .run(email.trim(), (name || '').trim().slice(0, 100), await hashPassword(password));
  ensureOwner(); // der erste Benutzer ist der Super-Admin
  const u = Q.userById.get(lastInsertRowid);
  audit.log('setup', { actor: u, target: u.email, ip: clientIp(req) });
  const token = setSession(req, res, u);
  return { user: userOut(hydrate(u)), token };
});

POST('/api/auth/login', async (req, res) => {
  const ip = clientIp(req);
  checkRate(ip);
  const { email, password } = req.body;
  const u = Q.userByEmail.get(String(email || '').trim());
  if (!u || !(await verifyPassword(String(password || ''), u.password_hash))) {
    noteFail(ip);
    audit.log('login_fail', { target: String(email || '').trim().slice(0, 200), ip, ok: false, detail: { known: !!u } });
    fail(401, 'E-Mail oder Passwort falsch');
  }
  // Erst nach richtigem Passwort verraten, warum der Zugang nicht geht
  if (!u.active) { audit.log('login_fail', { actor: u, target: u.email, ip, ok: false, detail: { reason: 'deaktiviert' } }); fail(403, 'Dieses Konto ist deaktiviert. Bitte einen Admin kontaktieren.'); }
  if (u.expires_at && u.expires_at < Date.now()) { audit.log('login_fail', { actor: u, target: u.email, ip, ok: false, detail: { reason: 'abgelaufen' } }); fail(403, 'Dein Zugang ist abgelaufen. Bitte einen Admin kontaktieren.'); }
  attempts.delete(ip);
  if (u.totp_enabled) {
    return { need2fa: true, ticket: signToken({ uid: u.id, tv: u.token_version, p: '2fa' }, SECRET, 300) };
  }
  return completeLogin(req, res, u);
});

POST('/api/auth/2fa', async (req, res) => {
  const ip = clientIp(req);
  checkRate(ip);
  const p = verifyToken(String(req.body.ticket || ''), SECRET);
  if (!p || p.p !== '2fa') fail(401, 'Die Anmeldung ist abgelaufen – bitte erneut mit dem Passwort anmelden');
  const u = Q.userById.get(p.uid);
  if (!u || u.token_version !== p.tv || !u.active || !u.totp_enabled) fail(401, 'Die Anmeldung ist abgelaufen – bitte erneut mit dem Passwort anmelden');
  checkTwofaRate(u.id);
  const code = String(req.body.code || '').trim();
  let usedRecovery = false;
  if (/^\d{3}\s?\d{3}$/.test(code)) {
    const step = verifyTotp(unseal(u.totp_secret), code);
    if (step != null && step > u.totp_last) db.prepare('UPDATE users SET totp_last=? WHERE id=?').run(step, u.id);
    else { twofaFails.set(u.id, [...(twofaFails.get(u.id) || []), Date.now()]); noteFail(ip); audit.log('login_2fa_fail', { actor: u, target: u.email, ip, ok: false }); fail(401, 'Der Code ist falsch oder schon benutzt'); }
  } else if (normalizeRecovery(code).length === 10) {
    const h = hashRecovery(code);
    const rc = Q.recoveryUnused.all(u.id).find((r) => r.code_hash === h);
    if (!rc) { twofaFails.set(u.id, [...(twofaFails.get(u.id) || []), Date.now()]); noteFail(ip); audit.log('login_2fa_fail', { actor: u, target: u.email, ip, ok: false, detail: { recovery: true } }); fail(401, 'Der Wiederherstellungscode ist falsch oder schon benutzt'); }
    Q.recoveryUse.run(rc.id);
    usedRecovery = true;
    audit.log('recovery_used', { actor: u, target: u.email, ip, detail: { left: Q.recoveryUnused.all(u.id).length } });
  } else fail(400, 'Bitte den 6-stelligen Code aus der Authenticator-App eingeben');
  attempts.delete(ip);
  return completeLogin(req, res, u, usedRecovery ? { recovery: true } : { twofa: true });
});

POST('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', serializeCookie(COOKIE, '', { maxAge: 0, secure: isSecure(req) }));
  return { ok: true };
});

// „Passwort vergessen?“ – immer dieselbe Antwort (verrät nicht, ob es die Adresse gibt), begrenzt gegen Missbrauch
const forgotIp = new Map(), forgotUser = new Map();
POST('/api/auth/forgot', (req) => {
  if (!mail.enabled()) fail(400, 'Der Mailversand ist nicht eingerichtet – bitte einen Admin um einen Reset-Link bitten');
  const ip = clientIp(req), now = Date.now();
  const hits = (forgotIp.get(ip) || []).filter((t) => now - t < 15 * 60000);
  if (hits.length >= 5) fail(429, 'Zu viele Anfragen. Bitte in ein paar Minuten erneut versuchen.');
  forgotIp.set(ip, [...hits, now]);
  const email = String(req.body.email || '').trim();
  if (!EMAIL_RE.test(email)) fail(400, 'Bitte eine gültige E-Mail-Adresse angeben');
  const u = Q.userByEmail.get(email);
  audit.log('forgot', { target: email, ip, detail: { known: !!u } });
  if (u && u.active && !(forgotUser.get(u.id) > now - 2 * 60000)) {
    forgotUser.set(u.id, now);
    const invite = String(u.password_hash).startsWith(NO_PASSWORD);
    const link = createResetLink(u.id, invite ? 'invite' : 'reset', invite ? 168 : 1, 'Passwort vergessen');
    // im Hintergrund senden, damit die Antwortzeit nichts verrät
    mail.send(invite ? mail.inviteMail(u, link) : mail.resetMail(u, link, { self: true }))
      .catch((e) => console.error(`  Mail an ${u.email} fehlgeschlagen: ${e.message}`));
  }
  return { ok: true, message: 'Falls es ein Konto mit dieser Adresse gibt, ist eine E-Mail mit einem Link unterwegs. Bitte auch im Spam-Ordner nachsehen.' };
});

GET('/api/auth/reset/:token', (req) => {
  checkRate(clientIp(req));
  const { rec, user } = resetRecord(req.params.token);
  return { email: user.email, name: user.name, purpose: rec.purpose };
});

POST('/api/auth/reset/:token', async (req) => {
  const ip = clientIp(req);
  checkRate(ip);
  const { rec, user } = resetRecord(req.params.token);
  checkPassword(req.body.password);
  db.prepare('UPDATE users SET password_hash=?, must_change=0, token_version=token_version+1 WHERE id=?').run(await hashPassword(req.body.password), user.id);
  Q.markResetUsed.run(rec.id);
  const u = Q.userById.get(user.id);
  audit.log(rec.purpose === 'invite' ? 'invite_accepted' : 'reset_used', { actor: u, target: u.email, ip });
  if (rec.purpose !== 'invite') notifyPasswordChanged(u);
  return { ok: true };
});

/* ---------- Eigenes Konto */
GET('/api/me', needAuth, (req) => ({ user: userOut(req.user) }));

PATCH('/api/me', needAuth, (req) => {
  const name = String(req.body.name ?? req.user.name).trim().slice(0, 100);
  db.prepare('UPDATE users SET name=? WHERE id=?').run(name, req.user.id);
  return { user: userOut(hydrate(Q.userById.get(req.user.id))) };
});

POST('/api/auth/password', needAuth, async (req, res) => {
  const { current, password } = req.body;
  if (!(await verifyPassword(String(current || ''), req.user.password_hash))) fail(400, 'Das aktuelle Passwort ist falsch');
  checkPassword(password);
  if (password === current) fail(400, 'Das neue Passwort muss sich vom bisherigen unterscheiden');
  db.prepare('UPDATE users SET password_hash=?, must_change=0, token_version=token_version+1 WHERE id=?').run(await hashPassword(password), req.user.id);
  const u = Q.userById.get(req.user.id);
  setSession(req, res, u);
  audit.log('password_self', { actor: u, target: u.email, ip: clientIp(req) });
  notifyPasswordChanged(u);
  return { ok: true };
});

// Pflicht-Passwortwechsel nach temporärem Passwort (ohne erneute Eingabe des alten)
POST('/api/auth/initial-password', needAuth, async (req, res) => {
  if (!req.user.must_change) fail(400, 'Kein Passwortwechsel erforderlich');
  const { password } = req.body;
  checkPassword(password);
  if (await verifyPassword(String(password), req.user.password_hash)) fail(400, 'Bitte ein anderes Passwort als das temporäre wählen');
  db.prepare('UPDATE users SET password_hash=?, must_change=0, token_version=token_version+1 WHERE id=?').run(await hashPassword(password), req.user.id);
  const u = Q.userById.get(req.user.id);
  setSession(req, res, u);
  audit.log('password_self', { actor: u, target: u.email, ip: clientIp(req), detail: { initial: true } });
  return { user: userOut(hydrate(u)) };
});

/* ---------- Zwei-Faktor-Anmeldung (eigenes Konto) */
POST('/api/me/2fa/setup', needAuth, (req) => {
  if (req.user.totp_enabled) fail(400, '2FA ist schon eingeschaltet');
  const secret = newTotpSecret();
  db.prepare('UPDATE users SET totp_secret=?, totp_last=0 WHERE id=?').run(seal(secret), req.user.id);
  return { secret, otpauth: otpauthUrl(secret, req.user.email) };
});

POST('/api/me/2fa/enable', needAuth, (req) => {
  if (req.user.totp_enabled) fail(400, '2FA ist schon eingeschaltet');
  const secret = unseal(req.user.totp_secret);
  if (!secret) fail(400, 'Bitte zuerst die Einrichtung starten');
  checkTwofaRate(req.user.id);
  const step = verifyTotp(secret, req.body.code);
  if (step == null) { twofaFails.set(req.user.id, [...(twofaFails.get(req.user.id) || []), Date.now()]); fail(400, 'Der Code stimmt nicht. Bitte prüfen, ob die Uhrzeit am Handy stimmt, und erneut versuchen.'); }
  const codes = makeRecoveryCodes();
  tx(() => {
    db.prepare('UPDATE users SET totp_enabled=1, totp_last=? WHERE id=?').run(step, req.user.id);
    Q.recoveryClear.run(req.user.id);
    for (const c of codes) Q.recoveryAdd.run(req.user.id, hashRecovery(c));
  });
  audit.log('twofa_enabled', { actor: req.user, target: req.user.email, ip: clientIp(req) });
  return { ok: true, recovery_codes: codes };
});

POST('/api/me/2fa/disable', needAuth, async (req) => {
  if (!req.user.totp_enabled) fail(400, '2FA ist nicht eingeschaltet');
  if (twofaPolicy() === 'required') fail(403, 'Der Super-Admin hat 2FA für alle verpflichtend gemacht – sie kann nicht abgeschaltet werden');
  if (!(await verifyPassword(String(req.body.password || ''), req.user.password_hash))) fail(400, 'Das Passwort ist falsch');
  checkTwofaRate(req.user.id);
  if (verifyTotp(unseal(req.user.totp_secret), req.body.code) == null) { twofaFails.set(req.user.id, [...(twofaFails.get(req.user.id) || []), Date.now()]); fail(400, 'Der Code stimmt nicht'); }
  tx(() => {
    db.prepare('UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_last=0 WHERE id=?').run(req.user.id);
    Q.recoveryClear.run(req.user.id);
  });
  audit.log('twofa_disabled', { actor: req.user, target: req.user.email, ip: clientIp(req) });
  return { ok: true };
});

POST('/api/me/2fa/recovery', needAuth, async (req) => {
  if (!req.user.totp_enabled) fail(400, '2FA ist nicht eingeschaltet');
  if (!(await verifyPassword(String(req.body.password || ''), req.user.password_hash))) fail(400, 'Das Passwort ist falsch');
  const codes = makeRecoveryCodes();
  tx(() => { Q.recoveryClear.run(req.user.id); for (const c of codes) Q.recoveryAdd.run(req.user.id, hashRecovery(c)); });
  audit.log('recovery_new', { actor: req.user, target: req.user.email, ip: clientIp(req) });
  return { recovery_codes: codes };
});

GET('/api/me/2fa', needAuth, (req) => ({
  enabled: !!req.user.totp_enabled, policy: twofaPolicy(), recovery_left: req.user.totp_enabled ? Q.recoveryUnused.all(req.user.id).length : 0,
}));

/* ================================================================== API: Module */
// Module, die die Person sehen darf (Admins: alle)
GET('/api/modules', needAuth, (req) => modules
  .map((m) => ({ m: m.manifest, role: moduleRole(req.user, m.manifest.id) }))
  .filter((x) => x.role)
  .map((x) => ({ ...publicManifest(x.m), my_role: x.role })));

// Alle Module (für die Rechtevergabe)
GET('/api/modules/all', needAdmin, () => modules.map((m) => publicManifest(m.manifest)));

/* ================================================================== API: Benutzerverwaltung (Plattform-Admins) */
/** Plattform-Admins dürfen andere Plattform-Admins nur der Super-Admin ändern */
function canManage(actor, target) {
  if (target.is_owner) return !!actor.owner && actor.id === target.id;
  if (target.role === 'admin' && !actor.owner && actor.id !== target.id) return false;
  return true;
}
const getTarget = (req) => {
  const t = Q.userById.get(Number(req.params.id));
  if (!t) fail(404, 'Benutzer nicht gefunden');
  return t;
};
const manageTarget = (req) => {
  const t = getTarget(req);
  if (!canManage(req.user, t)) fail(403, t.is_owner ? 'Den Super-Admin kann nur er selbst ändern' : 'Andere Plattform-Admins kann nur der Super-Admin ändern');
  return t;
};

GET('/api/users', needAdmin, () => {
  const mods = allUserModules();
  return { users: Q.users.all().map((u) => userAdminOut(u, mods.get(u.id))), mail: mail.enabled() };
});

POST('/api/users', needAdmin, async (req) => {
  const b = req.body;
  const email = String(b.email || '').trim();
  if (!EMAIL_RE.test(email)) fail(400, 'Bitte eine gültige E-Mail-Adresse angeben');
  if (Q.userByEmail.get(email)) fail(409, 'Zu dieser E-Mail-Adresse gibt es schon ein Konto');
  const kind = b.kind === 'guest' ? 'guest' : 'member';
  const role = kind === 'guest' ? 'user' : (b.role === 'admin' ? 'admin' : 'user');
  if (role === 'admin' && !req.user.owner) fail(403, 'Plattform-Admins kann nur der Super-Admin ernennen');
  const expires = kind === 'guest' ? parseExpiry(b.expires_at) : null;
  const direct = b.mode === 'password';
  const pw = direct ? (b.password ? String(b.password) : genPassword()) : null;
  if (direct) checkPassword(pw);
  const hash = direct ? await hashPassword(pw) : NO_PASSWORD + randomToken(8);
  const name = String(b.name || '').trim().slice(0, 100);
  const id = tx(() => {
    const r = db.prepare('INSERT INTO users (email,name,password_hash,role,kind,expires_at,must_change) VALUES (?,?,?,?,?,?,?)')
      .run(email, name, hash, role, kind, expires, direct ? 1 : 0);
    if (b.modules) setUserModules(Number(r.lastInsertRowid), b.modules);
    return Number(r.lastInsertRowid);
  });
  const u = Q.userById.get(id);
  audit.log(direct ? 'user_created' : 'user_invited', { actor: req.user, target: u.email, ip: clientIp(req), detail: { kind, role, modules: b.modules || {} } });
  const out = { user: userAdminOut(u, modulesOfUser(id)) };
  if (direct) out.password = pw;
  else {
    const link = createResetLink(id, 'invite', 168, req.user.email);
    out.link = { url: `${baseUrl(req)}/#/reset/${link.token}`, hours: link.hours };
    Object.assign(out, await mailLink(u, link, req.user.name || req.user.email, 'invite'));
  }
  return out;
});

PATCH('/api/users/:id', needAdmin, (req) => {
  const t = manageTarget(req);
  const b = req.body;
  const self = t.id === req.user.id;
  const f = {};
  if (b.name !== undefined) f.name = String(b.name).trim().slice(0, 100);
  if (b.email !== undefined) {
    const email = String(b.email).trim();
    if (!EMAIL_RE.test(email)) fail(400, 'Bitte eine gültige E-Mail-Adresse angeben');
    const other = Q.userByEmail.get(email);
    if (other && other.id !== t.id) fail(409, 'Zu dieser E-Mail-Adresse gibt es schon ein Konto');
    f.email = email;
  }
  const sensitive = b.role !== undefined || b.kind !== undefined || b.active !== undefined || b.expires_at !== undefined;
  if (sensitive) {
    if (self || t.is_owner) fail(400, 'Rolle, Typ und Status des eigenen Kontos kann man hier nicht ändern');
    const kind = b.kind !== undefined ? (b.kind === 'guest' ? 'guest' : 'member') : t.kind;
    let role = b.role !== undefined ? (b.role === 'admin' ? 'admin' : 'user') : t.role;
    if (kind === 'guest') role = 'user';
    if (role === 'admin' && t.role !== 'admin' && !req.user.owner) fail(403, 'Plattform-Admins kann nur der Super-Admin ernennen');
    f.kind = kind; f.role = role;
    if (b.active !== undefined) f.active = b.active ? 1 : 0;
    if (b.expires_at !== undefined || kind !== t.kind) f.expires_at = kind === 'guest' ? parseExpiry(b.expires_at !== undefined ? b.expires_at : null) : null;
    f.token_version = t.token_version + 1; // alle Geräte abmelden, Rechte gelten sofort neu
  }
  updateRow('users', t.id, f, ['name', 'email', 'role', 'kind', 'active', 'expires_at', 'token_version']);
  audit.log('user_updated', { actor: req.user, target: t.email, ip: clientIp(req), detail: { ...f, token_version: undefined } });
  return { user: userAdminOut(Q.userById.get(t.id), modulesOfUser(t.id)) };
});

PUT('/api/users/:id/modules', needAdmin, (req) => {
  const t = manageTarget(req);
  if (t.role === 'admin') fail(400, 'Plattform-Admins haben automatisch in jedem Modul volle Rechte');
  const before = modulesOfUser(t.id);
  try { tx(() => setUserModules(t.id, req.body.modules || {})); } catch (e) { fail(400, e.message); }
  const after = modulesOfUser(t.id);
  audit.log('module_access', { actor: req.user, target: t.email, ip: clientIp(req), detail: { before, after } });
  return { user: userAdminOut(Q.userById.get(t.id), after) };
});

DELETE('/api/users/:id', needAdmin, (req) => {
  const t = manageTarget(req);
  if (t.id === req.user.id) fail(400, 'Das eigene Konto kann man nicht löschen');
  if (t.is_owner) fail(400, 'Der Super-Admin kann nicht gelöscht werden');
  Q.deleteUser.run(t.id);
  audit.log('user_deleted', { actor: req.user, target: t.email, ip: clientIp(req) });
  return { ok: true };
});

POST('/api/users/:id/reset-link', needAdmin, async (req) => {
  const t = manageTarget(req);
  const hours = [1, 6, 24, 72, 168].includes(Number(req.body.hours)) ? Number(req.body.hours) : 24;
  const invite = String(t.password_hash).startsWith(NO_PASSWORD);
  const link = createResetLink(t.id, invite ? 'invite' : 'reset', hours, req.user.email);
  audit.log('reset_link', { actor: req.user, target: t.email, ip: clientIp(req), detail: { hours, mailed: !!req.body.send } });
  const out = { url: `${baseUrl(req)}/#/reset/${link.token}`, hours };
  if (req.body.send) Object.assign(out, await mailLink(t, link, req.user.name || req.user.email, invite ? 'invite' : 'reset'));
  return out;
});

// Temporäres Passwort setzen (Benutzer muss es beim nächsten Login ändern)
POST('/api/users/:id/password', needAdmin, async (req) => {
  const t = manageTarget(req);
  if (t.id === req.user.id) fail(400, 'Das eigene Passwort ändert man unter „Konto“');
  const pw = req.body.password ? String(req.body.password) : genPassword();
  checkPassword(pw);
  Q.revokeResets.run(t.id);
  db.prepare('UPDATE users SET password_hash=?, must_change=1, token_version=token_version+1 WHERE id=?').run(await hashPassword(pw), t.id);
  audit.log('password_admin', { actor: req.user, target: t.email, ip: clientIp(req) });
  notifyPasswordChanged(Q.userById.get(t.id));
  return { password: pw };
});

// 2FA eines Benutzers zurücksetzen (z. B. Handy verloren) – nur der Super-Admin
POST('/api/users/:id/reset-2fa', needOwner, (req) => {
  const t = getTarget(req);
  tx(() => {
    db.prepare('UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_last=0, token_version=token_version+1 WHERE id=?').run(t.id);
    Q.recoveryClear.run(t.id);
  });
  audit.log('twofa_reset', { actor: req.user, target: t.email, ip: clientIp(req) });
  return { ok: true };
});

// Super-Admin-Rolle übertragen
POST('/api/users/:id/owner', needOwner, (req) => {
  const t = getTarget(req);
  if (t.id === req.user.id) fail(400, 'Du bist bereits Super-Admin');
  if (t.kind === 'guest' || !t.active) fail(400, 'Nur aktive Mitglieder können Super-Admin werden');
  tx(() => {
    db.prepare('UPDATE users SET is_owner=0 WHERE id=?').run(req.user.id);
    db.prepare("UPDATE users SET is_owner=1, role='admin' WHERE id=?").run(t.id);
  });
  audit.log('owner', { actor: req.user, target: t.email, ip: clientIp(req) });
  return { ok: true };
});

/* ================================================================== API: System (Plattform-Admins) */
GET('/api/system/mail', needAdmin, () => ({ ...mail.publicSettings(), notify: mail.getNotify() }));

PUT('/api/system/mail', needAdmin, (req) => {
  let out;
  try { out = mail.saveSettings(req.body); } catch (e) { fail(400, e.message); }
  if (req.body.notify) mail.saveNotify(req.body.notify);
  audit.log('mail_settings', { actor: req.user, ip: clientIp(req), detail: { host: out.host, port: out.port, secure: out.secure, user: out.user, from: out.from_email, app_url: out.app_url } });
  return { ...out, notify: mail.getNotify() };
});

POST('/api/system/mail/test', needAdmin, async (req) => {
  const to = String(req.body.to || req.user.email).trim();
  if (!EMAIL_RE.test(to)) fail(400, 'Ungültige Empfänger-Adresse');
  try { await mail.send(mail.testMail(to)); } catch (e) { fail(502, e.message); }
  return { ok: true, to };
});

GET('/api/system/security', needAdmin, () => {
  const total = db.prepare("SELECT COUNT(*) n FROM users WHERE active=1").get().n;
  const with2fa = db.prepare('SELECT COUNT(*) n FROM users WHERE active=1 AND totp_enabled=1').get().n;
  return { twofa_policy: twofaPolicy(), users_active: total, users_with_2fa: with2fa };
});

// Regel für 2FA: nur der Super-Admin
PUT('/api/system/security', needOwner, (req) => {
  const policy = req.body.twofa_policy === 'required' ? 'required' : 'optional';
  if (policy === 'required' && !req.user.totp_enabled) fail(400, 'Richte zuerst selbst die Zwei-Faktor-Anmeldung ein, bevor du sie für alle verpflichtend machst');
  const before = twofaPolicy();
  setSetting('twofa_policy', policy);
  if (before !== policy) audit.log('policy_changed', { actor: req.user, ip: clientIp(req), detail: { twofa_policy: policy } });
  return { twofa_policy: policy };
});

GET('/api/system/audit', needAdmin, (req) => audit.list({ cat: req.query.cat, q: req.query.q, before: req.query.before, limit: req.query.limit }));

GET('/api/system/backups', needAdmin, () => ({ backups: backup.list(), settings: backup.settings() }));
POST('/api/system/backups', needAdmin, (req) => {
  let b;
  try { b = backup.create('manual', req.body.label); } catch (e) { fail(500, `Backup fehlgeschlagen: ${e.message}`); }
  audit.log('backup_manual', { actor: req.user, target: b.name, ip: clientIp(req) });
  return { backup: b };
});
GET('/api/system/backups/:name', needAdmin, (req, res) => {
  const f = backup.filePath(req.params.name);
  if (!f) fail(404, 'Backup nicht gefunden');
  const st = fs.statSync(f);
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': st.size, 'Content-Disposition': `attachment; filename="${req.params.name}"`, 'Cache-Control': 'no-store', ...SEC_HEADERS });
  fs.createReadStream(f).pipe(res);
  return HANDLED;
});
DELETE('/api/system/backups/:name', needAdmin, (req) => {
  if (!backup.remove(req.params.name)) fail(404, 'Backup nicht gefunden');
  audit.log('backup_delete', { actor: req.user, target: req.params.name, ip: clientIp(req) });
  return { ok: true };
});
/* ================================================================== API: Ankündigungen & Gruppen */
GET('/api/announcements', needAuth, (req) => ({ items: ann.myAnnouncements(req.user.id, { all: req.query.all === '1' }) }));

POST('/api/announcements/:id/read', needAuth, (req) => ({ ok: ann.markRead(req.user.id, Number(req.params.id)) }));

GET('/api/admin/announcements', needAdmin, () => ({ items: ann.adminAnnouncements(), mail: mail.enabled() }));

POST('/api/admin/announcements/preview', needAdmin, (req) => ({ count: ann.resolveAudience(req.body.audience || {}).length }));

/** Mails nacheinander im Hintergrund verschicken, damit der SMTP-Server nicht überlastet */
async function mailAnnouncement(id, recipients) {
  const a = db.prepare('SELECT * FROM announcements WHERE id=?').get(id);
  if (!a) return;
  const msg = { title: a.title, body: a.body, by: a.created_by_name, created_at: a.created_at };
  let sent = 0;
  for (const u of recipients) {
    try { await mail.send(mail.announcementMail(u, msg)); sent++; } catch (e) { console.error(`  Ankündigung an ${u.email} fehlgeschlagen: ${e.message}`); }
  }
  db.prepare('UPDATE announcements SET mailed=? WHERE id=?').run(sent, id);
}

POST('/api/admin/announcements', needAdmin, (req) => {
  const b = req.body;
  let r;
  try { r = ann.createAnnouncement({ title: b.title, body: b.body, audience: b.audience, expires_at: parseExpiry(b.expires_at) }, req.user); }
  catch (e) { fail(400, e.message); }
  const send = !!b.send_mail && mail.enabled();
  audit.log('announcement_created', { actor: req.user, target: String(b.title || '').slice(0, 120), ip: clientIp(req), detail: { recipients: r.recipients.length, mail: send } });
  if (send) mailAnnouncement(r.id, r.recipients).catch((e) => console.error('  Ankündigung:', e.message));
  return { id: r.id, recipients: r.recipients.length, mailing: send };
});

DELETE('/api/admin/announcements/:id', needAdmin, (req) => {
  const a = db.prepare('SELECT * FROM announcements WHERE id=?').get(Number(req.params.id));
  if (!a) fail(404, 'Ankündigung nicht gefunden');
  db.prepare('DELETE FROM announcements WHERE id=?').run(a.id);
  audit.log('announcement_deleted', { actor: req.user, target: a.title, ip: clientIp(req) });
  return { ok: true };
});

GET('/api/groups', needAdmin, () => ({ auto: ann.autoGroups(), groups: ann.listGroups() }));

const saveGroup = (req, id) => {
  let gid;
  try { gid = ann.saveGroup(id, req.body); } catch (e) { fail(400, e.message); }
  audit.log('group_saved', { actor: req.user, target: String(req.body.name || ''), ip: clientIp(req), detail: { members: (req.body.members || []).length } });
  return { group: ann.listGroups().find((g) => g.id === gid) };
};
POST('/api/groups', needAdmin, (req) => saveGroup(req, null));
PUT('/api/groups/:id', needAdmin, (req) => {
  if (!db.prepare('SELECT id FROM groups WHERE id=?').get(Number(req.params.id))) fail(404, 'Gruppe nicht gefunden');
  return saveGroup(req, Number(req.params.id));
});
DELETE('/api/groups/:id', needAdmin, (req) => {
  const g = db.prepare('SELECT * FROM groups WHERE id=?').get(Number(req.params.id));
  if (!g) fail(404, 'Gruppe nicht gefunden');
  db.prepare('DELETE FROM groups WHERE id=?').run(g.id);
  audit.log('group_deleted', { actor: req.user, target: g.name, ip: clientIp(req) });
  return { ok: true };
});

/* ================================================================== Module einhängen */
for (const { manifest, register } of modules) {
  if (!register) continue;
  const id = manifest.id;
  const prefix = `/api/m/${id}`;
  const requireRole = (min) => (req) => { if (!canModule(req.user, id, min)) fail(403, 'Dafür fehlt dir die Berechtigung in diesem Modul'); };
  register({
    id, requireRole,
    get: (p, ...h) => GET(prefix + p, needAuth, ...h), post: (p, ...h) => POST(prefix + p, needAuth, ...h),
    put: (p, ...h) => PUT(prefix + p, needAuth, ...h), patch: (p, ...h) => PATCH(prefix + p, needAuth, ...h),
    del: (p, ...h) => DELETE(prefix + p, needAuth, ...h), fail, DATA_DIR,
  });
}

/* ================================================================== Statische Dateien */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function serveFile(req, res, file) {
  const st = fs.statSync(file);
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const ext = path.extname(file).toLowerCase();
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.woff2' ? 'public, max-age=604800' : 'no-cache', ETag: etag, ...SEC_HEADERS };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

function tryStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return false; }
  if (rel.includes('\0')) return false;
  const file = path.normalize(path.join(PUBLIC, rel === '/' ? 'index.html' : rel));
  if (!file.startsWith(PUBLIC + path.sep) && file !== PUBLIC) return false;
  try {
    if (fs.statSync(file).isFile()) { serveFile(req, res, file); return true; }
  } catch { /* nicht vorhanden */ }
  // Oberfläche (Hash-Router): alles ohne Dateiendung liefert die Startseite
  if (!path.extname(rel)) { serveFile(req, res, path.join(PUBLIC, 'index.html')); return true; }
  return false;
}

/* ================================================================== Server */
const MUST_CHANGE_ALLOWED = ['/api/auth/status', '/api/auth/initial-password', '/api/auth/logout'];
const MUST_2FA_ALLOWED = ['/api/auth/status', '/api/auth/logout', '/api/auth/password', '/api/me'];

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Nicht erlaubt' });
      if (tryStatic(req, res, pathname)) return;
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SEC_HEADERS });
      return res.end('Nicht gefunden');
    }

    // Anfragen aus fremden Seiten verhindern (CSRF) – zusätzlich zu SameSite=Lax
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) {
      let ok = false;
      try { ok = new URL(req.headers.origin).host === reqHost(req); } catch { /* */ }
      if (!ok) return send(res, 403, { error: 'Ungültiger Ursprung der Anfrage' });
    }

    const sess = sessionUser(req);
    req.user = sess?.user || null;
    req.query = Object.fromEntries(url.searchParams);
    if (req.user?.must_change && !MUST_CHANGE_ALLOWED.some((x) => pathname === x)) return send(res, 403, { error: 'Bitte zuerst ein neues Passwort festlegen', code: 'must_change' });
    if (req.user?.must_2fa && !MUST_2FA_ALLOWED.some((x) => pathname === x) && !pathname.startsWith('/api/me/2fa')) return send(res, 403, { error: 'Bitte zuerst die Zwei-Faktor-Anmeldung einrichten', code: 'must_2fa' });

    let matched = false;
    for (const r of routes) {
      const m = pathname.match(r.re);
      if (!m) continue;
      matched = true;
      if (r.method !== req.method) continue;
      req.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      req.body = (req.method === 'GET' || req.method === 'DELETE') ? {} : await readBody(req);
      for (let i = 0; i < r.handlers.length; i++) {
        const out = await r.handlers[i](req, res);
        if (out === HANDLED) return;
        if (i === r.handlers.length - 1) return send(res, 200, out ?? { ok: true });
      }
      return;
    }
    send(res, matched ? 405 : 404, { error: matched ? 'Methode nicht erlaubt' : 'Nicht gefunden' });
  } catch (e) {
    if (e instanceof HttpError) {
      if (!res.headersSent) send(res, e.status, { error: e.message, ...e.extra });
      return;
    }
    console.error('  Serverfehler:', e);
    if (!res.headersSent) send(res, 500, { error: 'Interner Serverfehler' });
  }
});

server.listen(PORT, HOST, () => {
  const nets = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal);
  console.log(`\n  FF-Broadcast Portal v${VERSION} läuft`);
  console.log(`  Lokal:     http://localhost:${PORT}`);
  if (nets[0] && HOST === '0.0.0.0') console.log(`  Netzwerk:  http://${nets[0].address}:${PORT}`);
  console.log(`  Daten:     ${DATA_DIR}`);
  console.log(`  Module:    ${modules.map((m) => m.manifest.name).join(', ') || '–'}`);
  if (Q.userCount.get().n === 0) console.log(`  Noch kein Konto – beim ersten Aufruf im Browser wird das Super-Admin-Konto angelegt${SETUP_TOKEN ? ' (Einrichtungs-Schlüssel aus SETUP_TOKEN nötig)' : ''}.`);
  if (!TRUST_PROXY && !SETUP_TOKEN && Q.userCount.get().n === 0) console.log('  Tipp: Setze SETUP_TOKEN, wenn der Server vor der Einrichtung aus dem Internet erreichbar ist.');
  console.log('');
});

function shutdown(code = 0) {
  server.close(() => { try { db.close(); } catch { /* */ } process.exit(code); });
  setTimeout(() => process.exit(code), 3000).unref();
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
