// Ende-zu-Ende-Test: Single Sign-on für Module (Overlay Engine)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5200 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ffp-test-'));
let proc;
const SECRET = 'x'.repeat(40);
import { verifyTicket, ssoReady, normalizeBaseUrl } from '../server/sso.js';

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    let data = null;
    try { data = await r.json(); } catch { /* */ }
    return { status: r.status, data };
  };
  const raw = async (url, buf) => {
    const r = await fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...(cookie ? { Cookie: cookie } : {}) }, body: buf });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const download = async (url) => Buffer.from(await (await fetch(BASE + url, { headers: cookie ? { Cookie: cookie } : {} })).arrayBuffer());
  const open = async (url) => {
    const r = await fetch(BASE + url, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
    return { status: r.status, location: r.headers.get('location'), text: await r.text() };
  };
  return { open, get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b = {}) => call('PUT', u, b), del: (u) => call('DELETE', u), raw, download };
}

before(async () => {
  proc = spawn(process.execPath, ['--no-warnings', 'server/index.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA, BACKUP_ENABLED: 'false', OVERLAY_URL: 'https://overlay.example.de/', OVERLAY_SSO_SECRET: SECRET, RUNDOWN_URL: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch { /* */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Server startet nicht');
});
after(() => { proc?.kill(); fs.rmSync(DATA, { recursive: true, force: true }); });

const PW = 'Sehr-sicheres-Passwort-1';

test('Overlay-Kachel öffnet per Eintrittskarte mit der Rolle aus dem Portal', async () => {
  const owner = client();
  await owner.post('/api/auth/setup', { email: 'chef@example.de', name: 'Chef', password: PW });
  const tile = (await owner.get('/api/modules')).data.find((m) => m.id === 'overlay');
  assert.equal(tile.href, '/sso/overlay');
  assert.equal(tile.available, true);

  // nicht angemeldet → zur Anmeldung, danach zurück
  const anon = await client().open('/sso/overlay');
  assert.equal(anon.status, 302);
  assert.equal(anon.location, '/?next=%2Fsso%2Foverlay');

  // Super-Admin bekommt die höchste Rolle
  const o = await owner.open('/sso/overlay');
  assert.equal(o.status, 302);
  const u = new URL(o.location);
  assert.equal(u.origin + u.pathname, 'https://overlay.example.de/auth/portal');
  const t = verifyTicket(u.searchParams.get('ticket'), SECRET, 'overlay');
  assert.equal(t.role, 'admin');
  assert.equal(t.email, 'chef@example.de');
  assert.equal(t.platform_admin, true);
  assert.equal(t.kind, 'member');
  assert.ok(t.exp - t.iat <= 60);
  assert.equal(verifyTicket(u.searchParams.get('ticket'), 'falscher-schluessel'.repeat(3), 'overlay'), null);
  assert.equal(verifyTicket(u.searchParams.get('ticket'), SECRET, 'rundown'), null);
  assert.equal(verifyTicket(u.searchParams.get('ticket'), SECRET, 'overlay', Date.now() + 61000), null);

  // Mitglied mit Operator-Recht
  await owner.post('/api/users', { email: 'op@example.de', name: 'Op', mode: 'password', password: PW, modules: { overlay: 'operator' } });
  const op = client();
  await op.post('/api/auth/login', { email: 'op@example.de', password: PW });
  assert.equal((await op.open('/sso/overlay')).location, '/'.concat('?next=%2Fsso%2Foverlay')); // erst Passwort ändern
  await op.post('/api/auth/initial-password', { password: PW + 'x' });
  const r = await op.open('/sso/overlay');
  assert.equal(verifyTicket(new URL(r.location).searchParams.get('ticket'), SECRET, 'overlay').role, 'operator');

  // Ohne Freigabe: Kachel unsichtbar, direkter Aufruf → 403
  await owner.post('/api/users', { email: 'ohne@example.de', mode: 'password', password: PW, modules: { rundown: 'viewer' } });
  const no = client();
  await no.post('/api/auth/login', { email: 'ohne@example.de', password: PW });
  await no.post('/api/auth/initial-password', { password: PW + 'x' });
  assert.ok(!(await no.get('/api/modules')).data.some((m) => m.id === 'overlay'));
  const d = await no.open('/sso/overlay');
  assert.equal(d.status, 403);
  assert.match(d.text, /Kein Zugriff/);

  assert.equal((await owner.open('/sso/gibtsnicht')).status, 404);
  const log = (await owner.get('/api/system/audit?cat=auth')).data.entries.map((e) => e.kind);
  assert.ok(log.includes('module_open') && log.includes('module_denied'));
});

test('Rundown-Kachel: ohne Schlüssel normaler Link, Gäste werden im Ticket gekennzeichnet', async () => {
  const owner = client();
  await owner.post('/api/auth/login', { email: 'chef@example.de', password: PW });
  // In diesem Testserver ist RUNDOWN_URL leer → „Bald“
  assert.equal((await owner.get('/api/modules')).data.find((m) => m.id === 'rundown').available, false);
  await owner.post('/api/users', { email: 'gast@extern.de', kind: 'guest', mode: 'password', password: PW, modules: { overlay: 'operator' } });
  const g = client();
  await g.post('/api/auth/login', { email: 'gast@extern.de', password: PW });
  await g.post('/api/auth/initial-password', { password: PW + 'x' });
  const t = verifyTicket(new URL((await g.open('/sso/overlay')).location).searchParams.get('ticket'), SECRET, 'overlay');
  assert.equal(t.kind, 'guest');
});

test('Kachel zeigt „Bald“, solange Adresse oder Schlüssel fehlen', () => {
  const m = { id: 'overlay', sso: true, url: 'https://o.example.de' };
  const old = process.env.OVERLAY_SSO_SECRET;
  process.env.OVERLAY_SSO_SECRET = 'zu-kurz';
  assert.equal(ssoReady(m), false);
  process.env.OVERLAY_SSO_SECRET = 'y'.repeat(32);
  assert.equal(ssoReady(m), true);
  assert.equal(ssoReady({ ...m, url: '' }), false);
  process.env.OVERLAY_SSO_SECRET = old ?? '';
});

test('OVERLAY_URL ohne https:// oder mit Slash/Pfad wird richtig gelesen', () => {
  assert.equal(normalizeBaseUrl('overlay.example.de'), 'https://overlay.example.de');
  assert.equal(normalizeBaseUrl('https://overlay.example.de/'), 'https://overlay.example.de');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:3500/login'), 'http://127.0.0.1:3500');
  assert.equal(normalizeBaseUrl(''), '');
});

test('Mitgliederliste für Module: nur mit gültiger Unterschrift, nur Personen mit Zugriff', async () => {
  const { signDirectory } = await import('../server/sso.js');
  const owner = client();
  await owner.post('/api/auth/login', { email: 'chef@example.de', password: PW });
  const call = (auth) => fetch(BASE + '/api/modules/overlay/directory', { headers: auth ? { Authorization: auth } : {} }).then(async (r) => ({ status: r.status, data: await r.json() }));
  assert.equal((await call()).status, 401);
  assert.equal((await call('Portal ' + signDirectory('overlay', 'z'.repeat(40)))).status, 401);
  assert.equal((await call('Portal ' + signDirectory('overlay', SECRET, Math.floor(Date.now() / 1000) - 600))).status, 401);
  assert.equal((await call('Portal ' + signDirectory('rundown', SECRET))).status, 401); // falsches Modul in der Unterschrift
  const r = await call('Portal ' + signDirectory('overlay', SECRET));
  assert.equal(r.status, 200);
  const mails = r.data.users.map((u) => u.email);
  assert.ok(mails.includes('chef@example.de') && mails.includes('op@example.de'));
  assert.ok(!mails.includes('ohne@example.de'));
  const op = r.data.users.find((u) => u.email === 'op@example.de');
  assert.equal(op.role, 'operator');
  assert.equal(r.data.users.find((u) => u.email === 'chef@example.de').role, 'admin');
  // Modul ohne Schlüssel (Rundown) → nie abrufbar
  const rd = await fetch(BASE + '/api/modules/rundown/directory', { headers: { Authorization: 'Portal ' + signDirectory('rundown', '') } });
  assert.equal(rd.status, 401);
});

test('Ziel im Modul (next) wird weitergegeben, auch über die Anmeldung hinweg', async () => {
  const anon = await client().open('/sso/overlay?next=' + encodeURIComponent('/#/termin/5'));
  assert.equal(anon.location, '/?next=' + encodeURIComponent('/sso/overlay?next=' + encodeURIComponent('/#/termin/5')));
  const owner = client();
  await owner.post('/api/auth/login', { email: 'chef@example.de', password: PW });
  const r = await owner.open('/sso/overlay?next=' + encodeURIComponent('/#/termin/5'));
  assert.equal(new URL(r.location).searchParams.get('next'), '/#/termin/5');
  // fremde Adressen werden verworfen
  for (const bad of ['//boese.de/x', 'https://boese.de', '/\\boese.de']) {
    const x = await owner.open('/sso/overlay?next=' + encodeURIComponent(bad));
    assert.equal(new URL(x.location).searchParams.get('next'), null);
  }
});

test('Startseite: „Deine nächsten Einsätze“ – ohne eingerichtete Terminplanung leer', async () => {
  const owner = client();
  await owner.post('/api/auth/login', { email: 'chef@example.de', password: PW });
  const r = await owner.get('/api/m/planner/upcoming');
  assert.equal(r.status, 200);
  assert.equal(r.data.enabled, false); // im Testserver ist PLANNER_URL nicht gesetzt
  assert.equal((await client().get('/api/m/planner/upcoming')).status, 401);
});
