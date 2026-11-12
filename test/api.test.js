// Ende-zu-Ende-Test der API: startet den Server mit leerer Datenbank und spielt die wichtigsten Abläufe durch.
//   npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { totpCode } from '../server/auth.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4300 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ffp-test-'));
let proc;

/** Kleiner HTTP-Client mit eigener Cookie-Ablage (eine „Browser-Sitzung“) */
function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(BASE + url, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    let data = null;
    try { data = await r.json(); } catch { /* */ }
    return { status: r.status, data };
  };
  return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b = {}) => call('PUT', u, b), patch: (u, b = {}) => call('PATCH', u, b), del: (u) => call('DELETE', u) };
}

before(async () => {
  proc = spawn(process.execPath, ['--no-warnings', 'server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, BACKUP_ENABLED: 'false' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch { /* */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server startet nicht');
});
after(() => { proc?.kill(); fs.rmSync(DATA, { recursive: true, force: true }); });

const PW = 'Sehr-sicheres-Passwort-1';
const owner = client(), member = client(), guest = client(), admin2 = client();
let memberId, guestId, admin2Id;

test('Einrichtung: erstes Konto wird Super-Admin, danach ist die Einrichtung zu', async () => {
  assert.equal((await owner.get('/api/auth/status')).data.needsSetup, true);
  assert.equal((await owner.post('/api/auth/setup', { email: 'chef@example.de', password: 'kurz' })).status, 400);
  const r = await owner.post('/api/auth/setup', { email: 'chef@example.de', name: 'Chef', password: PW });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.owner, true);
  assert.equal(r.data.user.role, 'admin');
  assert.equal((await client().post('/api/auth/setup', { email: 'x@example.de', password: PW })).status, 400);
});

test('Mitglied mit Modulrolle anlegen, Pflicht-Passwortwechsel, Rechte', async () => {
  const c = await owner.post('/api/users', { email: 'max@example.de', name: 'Max', kind: 'member', mode: 'password', modules: { rundown: 'editor' } });
  assert.equal(c.status, 200);
  memberId = c.data.user.id;
  assert.ok(c.data.password.length >= 10);
  const l = await member.post('/api/auth/login', { email: 'max@example.de', password: c.data.password });
  assert.equal(l.status, 200);
  assert.equal(l.data.user.must_change, true);
  assert.equal((await member.get('/api/modules')).status, 403); // gesperrt bis zum Passwortwechsel
  assert.equal((await member.post('/api/auth/initial-password', { password: PW + 'x' })).status, 200);
  const mods = await member.get('/api/modules');
  assert.equal(mods.data.length, 1);
  assert.equal(mods.data[0].id, 'rundown');
  assert.equal(mods.data[0].my_role, 'editor');
  assert.equal((await member.get('/api/users')).status, 403);
  assert.equal((await member.get('/api/system/audit')).status, 403);
});

test('Gast: Einladungslink, kein Zugriff ohne Freigabe, deaktivieren, Ablauf', async () => {
  const c = await owner.post('/api/users', { email: 'gast@example.de', kind: 'guest', role: 'admin', mode: 'invite', expires_at: '2099-01-01' });
  assert.equal(c.status, 200);
  guestId = c.data.user.id;
  assert.equal(c.data.user.role, 'user'); // Gäste können nie Plattform-Admin sein
  assert.equal(c.data.user.kind, 'guest');
  assert.match(c.data.link.url, /#\/reset\//);
  const token = c.data.link.url.split('/reset/')[1];
  assert.equal((await guest.post('/api/auth/login', { email: 'gast@example.de', password: 'irgendwas-langes-123' })).status, 401); // vor Annahme kein Login
  assert.equal((await guest.get(`/api/auth/reset/${token}`)).data.email, 'gast@example.de');
  assert.equal((await guest.post(`/api/auth/reset/${token}`, { password: PW })).status, 200);
  assert.equal((await guest.post(`/api/auth/reset/${token}`, { password: PW })).status, 400); // Link nur einmal
  assert.equal((await guest.post('/api/auth/login', { email: 'gast@example.de', password: PW })).status, 200);
  assert.deepEqual((await guest.get('/api/modules')).data, []);
  // Freigabe geben → sofort sichtbar
  assert.equal((await owner.put(`/api/users/${guestId}/modules`, { modules: { rundown: 'viewer' } })).status, 200);
  assert.equal((await guest.get('/api/modules')).data[0].my_role, 'viewer');
  assert.equal((await owner.put(`/api/users/${guestId}/modules`, { modules: { gibtsnicht: 'viewer' } })).status, 400);
  assert.equal((await owner.put(`/api/users/${guestId}/modules`, { modules: { rundown: 'chef' } })).status, 400);
  // Alles wieder sperren
  assert.equal((await owner.put(`/api/users/${guestId}/modules`, { modules: { rundown: null } })).status, 200);
  assert.deepEqual((await guest.get('/api/modules')).data, []);
  // Deaktivieren → Sitzung ungültig, Login gesperrt
  assert.equal((await owner.patch(`/api/users/${guestId}`, { active: false })).status, 200);
  assert.equal((await guest.get('/api/modules')).status, 401);
  assert.equal((await guest.post('/api/auth/login', { email: 'gast@example.de', password: PW })).status, 403);
  // Wieder aktiv, aber Ablaufdatum in der Vergangenheit
  await owner.patch(`/api/users/${guestId}`, { active: true, expires_at: '2000-01-01' });
  assert.equal((await guest.post('/api/auth/login', { email: 'gast@example.de', password: PW })).status, 403);
});

test('Plattform-Admins: nur der Super-Admin ernennt und ändert sie', async () => {
  assert.equal((await member.post('/api/users', { email: 'z@example.de', mode: 'invite' })).status, 403);
  const c = await owner.post('/api/users', { email: 'admin2@example.de', role: 'admin', mode: 'password', password: PW + 'aa' });
  assert.equal(c.status, 200);
  admin2Id = c.data.user.id;
  await admin2.post('/api/auth/login', { email: 'admin2@example.de', password: PW + 'aa' });
  await admin2.post('/api/auth/initial-password', { password: PW + 'bb' });
  assert.equal((await admin2.get('/api/users')).status, 200);
  assert.equal((await admin2.post('/api/users', { email: 'z@example.de', role: 'admin', mode: 'invite' })).status, 403);
  assert.equal((await admin2.patch(`/api/users/${memberId}`, { role: 'admin' })).status, 403);
  assert.equal((await admin2.patch('/api/users/1', { name: 'Hack' })).status, 403); // Super-Admin unantastbar
  assert.equal((await admin2.del('/api/users/1')).status, 403);
  assert.equal((await admin2.put(`/api/system/security`, { twofa_policy: 'required' })).status, 403);
  assert.equal((await admin2.post(`/api/users/${memberId}/reset-2fa`)).status, 403);
  // Plattform-Admins sehen jedes Modul mit höchster Rolle
  assert.equal((await admin2.get('/api/modules')).data[0].my_role, 'admin');
});

test('2FA: einrichten, Login in zwei Schritten, Code nur einmal, Wiederherstellungscodes', async () => {
  const s = await member.post('/api/me/2fa/setup');
  assert.equal(s.status, 200);
  assert.match(s.data.otpauth, /^otpauth:\/\/totp\//);
  const now = () => Math.floor(Date.now() / 30000);
  assert.equal((await member.post('/api/me/2fa/enable', { code: '000000' })).status, 400);
  const e = await member.post('/api/me/2fa/enable', { code: totpCode(s.data.secret, now()) });
  assert.equal(e.status, 200);
  assert.equal(e.data.recovery_codes.length, 10);

  const m2 = client();
  const l = await m2.post('/api/auth/login', { email: 'max@example.de', password: PW + 'x' });
  assert.equal(l.data.need2fa, true);
  assert.equal(l.data.user, undefined);
  assert.equal((await m2.get('/api/modules')).status, 401); // noch nicht angemeldet
  assert.equal((await m2.post('/api/auth/2fa', { ticket: l.data.ticket, code: '123456' })).status, 401);
  // Der beim Einrichten benutzte Zeitschritt ist verbraucht → nächster Schritt
  const code = totpCode(s.data.secret, now() + 1);
  assert.equal((await m2.post('/api/auth/2fa', { ticket: l.data.ticket, code })).status, 200);
  assert.equal((await m2.get('/api/modules')).status, 200);
  const m3 = client();
  const l3 = await m3.post('/api/auth/login', { email: 'max@example.de', password: PW + 'x' });
  assert.equal((await m3.post('/api/auth/2fa', { ticket: l3.data.ticket, code })).status, 401); // gleicher Code nochmal

  const rc = e.data.recovery_codes[0];
  const m4 = client();
  const l4 = await m4.post('/api/auth/login', { email: 'max@example.de', password: PW + 'x' });
  assert.equal((await m4.post('/api/auth/2fa', { ticket: l4.data.ticket, code: rc })).status, 200);
  const m5 = client();
  const l5 = await m5.post('/api/auth/login', { email: 'max@example.de', password: PW + 'x' });
  assert.equal((await m5.post('/api/auth/2fa', { ticket: l5.data.ticket, code: rc })).status, 401); // Recovery nur einmal
  // Ein Passwort-Ticket ist keine Sitzung
  assert.equal((await client().get('/api/me')).status, 401);
});

test('2FA-Regel: erzwungen → Pflicht zur Einrichtung, Abschalten gesperrt; Zurücksetzen nur durch Super-Admin', async () => {
  // Der Super-Admin muss selbst 2FA haben, bevor er sie für alle verpflichtend macht
  assert.equal((await owner.put('/api/system/security', { twofa_policy: 'required' })).status, 400);
  const os = await owner.post('/api/me/2fa/setup');
  assert.equal((await owner.post('/api/me/2fa/enable', { code: totpCode(os.data.secret, Math.floor(Date.now() / 30000)) })).status, 200);
  assert.equal((await owner.put('/api/system/security', { twofa_policy: 'required' })).data.twofa_policy, 'required');
  // Admin2 hat noch kein 2FA → gesperrt bis zur Einrichtung
  const g = await admin2.get('/api/modules');
  assert.equal(g.status, 403);
  assert.equal(g.data.code, 'must_2fa');
  assert.equal((await admin2.get('/api/auth/status')).data.user.must_2fa, true);
  const s = await admin2.post('/api/me/2fa/setup');
  assert.equal((await admin2.post('/api/me/2fa/enable', { code: totpCode(s.data.secret, Math.floor(Date.now() / 30000)) })).status, 200);
  assert.equal((await admin2.get('/api/modules')).status, 200);
  assert.equal((await admin2.post('/api/me/2fa/disable', { password: PW + 'bb', code: '000000' })).status, 403);
  // Super-Admin setzt 2FA von Max zurück → Max muss neu einrichten
  assert.equal((await owner.post(`/api/users/${memberId}/reset-2fa`)).status, 200);
  const m = client();
  const l = await m.post('/api/auth/login', { email: 'max@example.de', password: PW + 'x' });
  assert.equal(l.data.need2fa, undefined);
  assert.equal(l.data.user.must_2fa, true);
  // Regel wieder lockern → Abschalten möglich
  await owner.put('/api/system/security', { twofa_policy: 'optional' });
  assert.equal((await m.get('/api/modules')).status, 200);
});

test('Sicherheit: falsche Anmeldedaten, Origin-Prüfung, Protokoll, Backups', async () => {
  assert.equal((await client().post('/api/auth/login', { email: 'max@example.de', password: 'falsch-falsch-1' })).status, 401);
  const r = await fetch(BASE + '/api/auth/logout', { method: 'POST', headers: { Origin: 'https://boese-seite.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
  const a = await owner.get('/api/system/audit?limit=200');
  const kinds = a.data.entries.map((e) => e.kind);
  for (const k of ['setup', 'login', 'login_fail', 'user_created', 'user_invited', 'module_access', 'twofa_enabled', 'twofa_reset', 'policy_changed']) assert.ok(kinds.includes(k), `Protokoll enthält ${k}`);
  assert.equal((await owner.get('/api/system/audit?cat=konto')).data.entries.every((e) => e.cat === 'konto'), true);
  const b = await owner.post('/api/system/backups', { label: 'Test' });
  assert.equal(b.status, 200);
  assert.equal((await owner.get('/api/system/backups')).data.backups.length, 1);
  assert.equal((await owner.del(`/api/system/backups/${b.data.backup.name}`)).status, 200);
  assert.equal((await owner.get('/api/system/backups/..%2Fpasswd')).status, 404);
});

test('Oberfläche: Startseite und Dateien werden ausgeliefert, Verzeichnis-Ausbruch verhindert', async () => {
  const h = await fetch(BASE + '/');
  assert.equal(h.status, 200);
  assert.match(h.headers.get('content-security-policy') || '', /script-src 'self'/);
  assert.equal((await fetch(BASE + '/css/portal.css')).status, 200);
  assert.equal((await fetch(BASE + '/%2e%2e/package.json')).status === 200, false);
  assert.equal((await fetch(BASE + '/..%2f..%2fserver/db.js')).status === 200, false);
});
