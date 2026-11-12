// E-Mail-Versand über SMTP – ohne Fremdpakete (node:net / node:tls).
// Unterstützt STARTTLS (Port 587), SSL/TLS (Port 465) und unverschlüsselt (nur fürs lokale Netz),
// Anmeldung per AUTH PLAIN bzw. LOGIN. Einstellungen in der Tabelle settings (Schlüssel "mail"),
// das Passwort verschlüsselt (AES-256-GCM mit dem Server-Schlüssel). Umgebungsvariablen haben Vorrang.
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSecret, getSetting, setSetting } from './db.js';
import * as audit from './audit.js';

const getS = { get: (k) => { const v = getSetting(k); return v == null ? undefined : { value: v }; } };
const setS = { run: (k, v) => setSetting(k, v) };

/* ------------------------------------------------------------------ Passwort verschlüsseln */
const key = () => crypto.createHash('sha256').update('ffp-mail:' + getSecret()).digest();
function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
function decrypt(blob) {
  if (!blob) return '';
  try {
    const [iv, tag, enc] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch { return ''; }
}

/* ------------------------------------------------------------------ Einstellungen */
const ENV = {
  host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, secure: process.env.SMTP_SECURE,
  user: process.env.SMTP_USER, pass: process.env.SMTP_PASS,
  from_email: process.env.SMTP_FROM, from_name: process.env.SMTP_FROM_NAME, app_url: process.env.APP_URL,
};
export const envLocked = () => !!ENV.host;

function stored() { try { return JSON.parse(getS.get('mail')?.value || '{}'); } catch { return {}; } }

/** Wirksame Einstellungen (inkl. Passwort im Klartext – nur serverseitig verwenden) */
function config() {
  const s = stored();
  const c = envLocked()
    ? { host: ENV.host, port: Number(ENV.port) || 587, secure: ENV.secure || (Number(ENV.port) === 465 ? 'ssl' : 'starttls'), user: ENV.user || '', pass: ENV.pass || '', from_email: ENV.from_email || ENV.user || '', from_name: ENV.from_name || 'FrankenFinals Broadcast', app_url: ENV.app_url || s.app_url || '' }
    : { host: s.host || '', port: Number(s.port) || 587, secure: s.secure || 'starttls', user: s.user || '', pass: decrypt(s.pass), from_email: s.from_email || '', from_name: s.from_name || 'FrankenFinals Broadcast', app_url: s.app_url || process.env.APP_URL || '' };
  c.app_url = String(c.app_url || '').replace(/\/+$/, '');
  return c;
}
export const enabled = () => { const c = config(); return !!(c.host && c.from_email && c.app_url); };
export const appUrl = () => config().app_url;

/** Für die Oberfläche: ohne Passwort */
export function publicSettings() {
  const c = config();
  return { host: c.host, port: c.port, secure: c.secure, user: c.user, has_pass: !!c.pass, from_email: c.from_email, from_name: c.from_name, app_url: c.app_url, enabled: enabled(), env: envLocked() };
}

export function saveSettings(b) {
  if (envLocked()) throw new Error('Der Mailversand ist über Umgebungsvariablen (SMTP_HOST …) festgelegt');
  const old = stored();
  const s = {
    host: String(b.host || '').trim().slice(0, 200),
    port: Math.max(1, Math.min(65535, parseInt(b.port, 10) || 587)),
    secure: ['starttls', 'ssl', 'none'].includes(b.secure) ? b.secure : 'starttls',
    user: String(b.user || '').trim().slice(0, 200),
    pass: b.pass === undefined || b.pass === null ? old.pass || '' : b.pass === '' ? '' : encrypt(String(b.pass).slice(0, 500)),
    from_email: String(b.from_email || '').trim().slice(0, 200),
    from_name: String(b.from_name || '').trim().slice(0, 100),
    app_url: String(b.app_url || '').trim().replace(/\/+$/, '').slice(0, 300),
  };
  if (s.host && !/^[a-z0-9.-]+$/i.test(s.host)) throw new Error('Ungültiger SMTP-Server');
  if (s.from_email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s.from_email)) throw new Error('Ungültige Absender-Adresse');
  if (s.app_url && !/^https?:\/\/[^\s/]+/i.test(s.app_url)) throw new Error('Adresse der App muss mit http:// oder https:// beginnen');
  setS.run('mail', JSON.stringify(s));
  return publicSettings();
}

/* ------------------------------------------------------------------ SMTP */
const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const encHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n').trimEnd();
const cleanAddr = (s) => String(s || '').replace(/[\r\n<>"]/g, '').trim();

function buildMessage({ from_email, from_name }, { to, subject, text, html }) {
  const boundary = 'ffp-' + crypto.randomBytes(12).toString('hex');
  const domain = from_email.split('@')[1] || 'localhost';
  const headers = [
    `From: ${encHeader(from_name || 'FF-Broadcast')} <${cleanAddr(from_email)}>`,
    `To: <${cleanAddr(to)}>`,
    `Subject: ${encHeader(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type, body) => [`--${boundary}`, `Content-Type: ${type}; charset=utf-8`, 'Content-Transfer-Encoding: base64', '', wrap76(b64(body))].join('\r\n');
  return [...headers, '', part('text/plain', text), part('text/html', html), `--${boundary}--`, ''].join('\r\n');
}

/** Minimaler SMTP-Dialog; wirft bei Fehlern mit verständlicher Meldung */
function smtpSend(c, to, data) {
  return new Promise((resolve, reject) => {
    let sock, buf = '', waiter = null, done = false;
    const timer = setTimeout(() => fin(new Error('Zeitüberschreitung beim Mailserver')), 20000);
    const fin = (err, val) => {
      if (done) return; done = true; clearTimeout(timer);
      try { sock?.end(); sock?.destroy(); } catch { /* */ }
      err ? reject(err) : resolve(val);
    };
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      if (!waiter) return; // Antwort bleibt im Puffer, bis jemand liest
      // vollständige Antwort: letzte Zeile "NNN Text"
      const lines = buf.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          const resp = lines.slice(0, i + 1).join('\n');
          buf = lines.slice(i + 1).join('\r\n');
          const w = waiter; waiter = null;
          w?.(resp);
          return;
        }
      }
    };
    const read = () => new Promise((res) => { waiter = res; if (buf) onData(''); });
    const cmd = async (line, ok, what) => {
      if (line !== null) sock.write(line + '\r\n');
      const r = await read();
      const code = Number(r.slice(0, 3));
      if (!ok.includes(code)) throw new Error(`${what}: ${r.split('\n').pop().slice(4) || r}`);
      return r;
    };
    const attach = (s) => { sock = s; sock.on('data', onData); sock.on('error', (e) => fin(friendly(e))); };
    const hostname = os.hostname().replace(/[^a-z0-9.-]/gi, '') || 'localhost';
    const tlsOpts = { host: c.host, servername: c.host, minVersion: 'TLSv1.2' };

    const run = async () => {
      await cmd(null, [220], 'Begrüßung');
      let ehlo = await cmd(`EHLO ${hostname}`, [250], 'EHLO');
      if (c.secure === 'starttls') {
        if (!/STARTTLS/i.test(ehlo)) throw new Error('Der Server bietet kein STARTTLS an – Port/Verschlüsselung prüfen');
        await cmd('STARTTLS', [220], 'STARTTLS');
        sock.removeAllListeners('data');
        const up = tls.connect({ ...tlsOpts, socket: sock });
        await new Promise((res, rej) => { up.once('secureConnect', res); up.once('error', rej); });
        attach(up);
        ehlo = await cmd(`EHLO ${hostname}`, [250], 'EHLO');
      }
      if (c.user) {
        if (/AUTH[ =][^\n]*PLAIN/i.test(ehlo)) await cmd(`AUTH PLAIN ${b64(`\0${c.user}\0${c.pass}`)}`, [235], 'Anmeldung');
        else {
          await cmd('AUTH LOGIN', [334], 'Anmeldung');
          await cmd(b64(c.user), [334], 'Anmeldung');
          await cmd(b64(c.pass), [235], 'Anmeldung');
        }
      }
      await cmd(`MAIL FROM:<${cleanAddr(c.from_email)}>`, [250], 'Absender');
      await cmd(`RCPT TO:<${cleanAddr(to)}>`, [250, 251], 'Empfänger');
      await cmd('DATA', [354], 'DATA');
      const body = data.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
      await cmd(body + '\r\n.', [250], 'Senden');
      try { sock.write('QUIT\r\n'); } catch { /* */ }
      fin(null, true);
    };

    try {
      const s = c.secure === 'ssl' ? tls.connect({ ...tlsOpts, port: c.port }) : net.connect({ host: c.host, port: c.port });
      attach(s);
      s.once(c.secure === 'ssl' ? 'secureConnect' : 'connect', () => run().catch((e) => fin(e)));
    } catch (e) { fin(friendly(e)); }
  });
}
function friendly(e) {
  const m = { ENOTFOUND: 'SMTP-Server nicht gefunden', ECONNREFUSED: 'Verbindung abgelehnt – Port prüfen', ETIMEDOUT: 'Keine Verbindung zum Mailserver', ECONNRESET: 'Verbindung vom Mailserver getrennt' }[e.code];
  return new Error(m ? `${m} (${e.code})` : e.message);
}

/** Mail senden: { to, subject, text, html } */
export async function send(msg) {
  const c = config();
  if (!c.host || !c.from_email) throw new Error('Mailversand ist nicht eingerichtet (System → E-Mail-Versand)');
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(msg.to || '')) throw new Error('Ungültige Empfänger-Adresse');
  try {
    const r = await smtpSend(c, msg.to, buildMessage(c, msg));
    audit.log('mail_sent', { target: msg.to, detail: { subject: msg.subject, tpl: msg.tpl } });
    return r;
  } catch (e) {
    audit.log('mail_failed', { target: msg.to, detail: { subject: msg.subject, tpl: msg.tpl, error: e.message }, ok: false });
    throw e;
  }
}

/* ------------------------------------------------------------------ Vorlagen */
// Die Vorlagen liegen als HTML + Text in server/mail-templates/<name>.{html,txt}.
// Platzhalter: {{name}} (im HTML automatisch maskiert), Abschnitte: {{#flag}}…{{/flag}}.
// Die erste Zeile der Text-Vorlage ist der Betreff ("Betreff: …").
const TPL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mail-templates');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const cache = new Map();
function load(name) {
  if (!cache.has(name)) {
    const html = fs.readFileSync(path.join(TPL_DIR, name + '.html'), 'utf8');
    const raw = fs.readFileSync(path.join(TPL_DIR, name + '.txt'), 'utf8').replace(/\r\n/g, '\n');
    const m = raw.match(/^Betreff:\s*(.*)\n\n?/);
    cache.set(name, { html, subject: m ? m[1].trim() : 'FrankenFinals Broadcast', text: m ? raw.slice(m[0].length) : raw });
  }
  return cache.get(name);
}
function fill(tpl, vars, escape) {
  // {{{name}}} = bereits maskiertes HTML; wird zuletzt eingesetzt, damit Benutzertext nie als Vorlage gelesen wird
  const raw = [];
  return tpl
    .replace(/\{\{\{(\w+)\}\}\}/g, (_, k) => `\u0000${raw.push(String(vars[k] ?? '')) - 1}\u0000`)
    .replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, k, inner) => (vars[k] ? inner : ''))
    .replace(/\{\{(\w+)\}\}/g, (_, k) => (escape ? esc(vars[k]) : String(vars[k] ?? '')))
    .replace(/\u0000(\d+)\u0000/g, (_, i) => raw[Number(i)]);
}
/** Vorlage füllen → { to, subject, html, text } */
export function render(name, to, vars = {}) {
  const t = load(name);
  const v = { app_url: appUrl(), ...vars };
  return { to, tpl: name, subject: fill(t.subject, v, false), html: fill(t.html, v, true), text: fill(t.text, v, false) };
}

const validity = (h) => (h >= 48 ? `${Math.round(h / 24)} Tage` : h === 1 ? '1 Stunde' : `${h} Stunden`);
const TZ = process.env.TZ_MAIL || 'Europe/Berlin';
/** "11.11.2026, 14:05 Uhr" (deutsche Zeit) */
export function when(d = new Date()) {
  const f = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return f.format(new Date(d)).replace(' um ', ', ') + ' Uhr';
}
/** "2026-06-14" → "Samstag, 14.06.2026" */
function dayLabel(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return 'ohne Datum';
  const d = new Date(iso + 'T12:00:00Z');
  return new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}
const hello = (u) => u.name || u.email.split('@')[0];
const resetUrl = (link) => `${appUrl()}/#/reset/${link.token}`;

export function inviteMail(u, link, by) {
  return render('einladung', u.email, {
    name: hello(u), eingeladen_von: by || 'Ein Admin', email: u.email, link: resetUrl(link), gueltigkeit: validity(link.hours),
  });
}

export function resetMail(u, link, { self = false } = {}) {
  return render('passwort-reset', u.email, {
    name: hello(u), link: resetUrl(link), gueltigkeit: validity(link.hours), selbst_angefordert: self,
    grund: self ? 'für dein Konto wurde „Passwort vergessen“ angefordert.' : 'ein Admin hat dir einen Link zum Zurücksetzen deines Passworts geschickt.',
  });
}

/** Ankündigung an ein Mitglied */
export function announcementMail(u, a) {
  return render('ankuendigung', u.email, {
    titel: a.title, text: a.body, text_html: esc(a.body).replace(/\n/g, '<br>'), vorschau: a.body.slice(0, 120),
    von: a.by, datum: when(a.created_at),
  });
}

export function testMail(to) {
  return render('testmail', to, { app_url: appUrl() || '(Adresse der App nicht eingetragen)' });
}

export function passwordChangedMail(u, contact) {
  return render('passwort-geaendert', u.email, { name: hello(u), email: u.email, zeitpunkt: when(), kontakt: contact || 'einem Admin' });
}

/* ------------------------------------------------------------------ Benachrichtigungen (an/aus) */
export const NOTIFY_TYPES = ['password'];
const NOTIFY_DEFAULT = { password: true };
export function getNotify() {
  let v = {};
  try { v = JSON.parse(getS.get('notify')?.value || '{}'); } catch { /* */ }
  return { ...NOTIFY_DEFAULT, ...v };
}
export function saveNotify(b) {
  const cur = getNotify();
  for (const k of NOTIFY_TYPES) if (b[k] !== undefined) cur[k] = !!b[k];
  setS.run('notify', JSON.stringify(cur));
  return cur;
}

/** Benachrichtigung im Hintergrund senden – blockiert nie, wirft nie. type = Schalter aus NOTIFY_TYPES */
export function notify(msg, label = 'Mail', type = null) {
  if (!enabled()) return;
  if (type && !getNotify()[type]) return;
  Promise.resolve().then(() => send(msg))
    .then(() => console.log(`  ${label} an ${msg.to} gesendet`))
    .catch((e) => console.error(`  ${label} an ${msg.to} fehlgeschlagen:`, e.message));
}
