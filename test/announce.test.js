// Ende-zu-Ende-Test: Gruppen und Ankündigungen
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4700 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ffp-test-'));
let proc;

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
  return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b = {}) => call('PUT', u, b), del: (u) => call('DELETE', u) };
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
const owner = client();
const people = {};

async function person(email, extra) {
  const c = await owner.post('/api/users', { email, mode: 'password', password: PW, ...extra });
  assert.equal(c.status, 200);
  const cl = client();
  await cl.post('/api/auth/login', { email, password: PW });
  await cl.post('/api/auth/initial-password', { password: PW + 'x' });
  people[email] = { id: c.data.user.id, cl };
}
const titles = async (email) => (await people[email].cl.get('/api/announcements')).data.items.map((a) => a.title);

test('Gruppen und Ankündigungen erreichen nur die gewählten Empfänger', async () => {
  await owner.post('/api/auth/setup', { email: 'chef@example.de', name: 'Chef', password: PW });
  await person('a@example.de', { kind: 'member', modules: { rundown: 'viewer' } });
  await person('b@example.de', { kind: 'member' });
  await person('g@example.de', { kind: 'guest' });

  // Nur Admins verwalten Gruppen und Ankündigungen
  assert.equal((await people['a@example.de'].cl.get('/api/groups')).status, 403);
  assert.equal((await people['a@example.de'].cl.post('/api/admin/announcements', { title: 'x', audience: { all: true } })).status, 403);

  const g = await owner.post('/api/groups', { name: 'Kamera-Team', members: [people['b@example.de'].id] });
  assert.equal(g.status, 200);
  assert.equal((await owner.post('/api/groups', { name: 'kamera-team' })).status, 400); // doppelt
  const groups = (await owner.get('/api/groups')).data;
  assert.ok(groups.auto.some((x) => x.id === 'mod:rundown'));

  assert.equal((await owner.post('/api/admin/announcements/preview', { audience: { all: true } })).data.count, 4);
  assert.equal((await owner.post('/api/admin/announcements', { title: 'Leer', audience: { groups: [] } })).status, 400);
  assert.equal((await owner.post('/api/admin/announcements', { title: 'An alle', body: 'Hallo\nzusammen', audience: { all: true }, send_mail: true })).data.recipients, 4);
  assert.equal((await owner.post('/api/admin/announcements', { title: 'Nur Kamera', audience: { groups: ['g:' + g.data.group.id] } })).data.recipients, 1);
  assert.equal((await owner.post('/api/admin/announcements', { title: 'Rundown', audience: { groups: ['mod:rundown'] } })).data.recipients, 2); // a + Chef (Admin)
  assert.equal((await owner.post('/api/admin/announcements', { title: 'Gäste + a', audience: { groups: ['auto:guests'], users: [people['a@example.de'].id] } })).data.recipients, 2);
  await owner.post('/api/admin/announcements', { title: 'Abgelaufen', audience: { all: true }, expires_at: '2000-01-01' });

  assert.deepEqual((await titles('a@example.de')).sort(), ['An alle', 'Gäste + a', 'Rundown']);
  assert.deepEqual((await titles('b@example.de')).sort(), ['An alle', 'Nur Kamera']);
  assert.deepEqual((await titles('g@example.de')).sort(), ['An alle', 'Gäste + a']);

  // Gelesen → verschwindet von der Startseite, bleibt unter „alle“
  const first = (await people['b@example.de'].cl.get('/api/announcements')).data.items.find((a) => a.title === 'Nur Kamera');
  assert.equal((await people['b@example.de'].cl.post(`/api/announcements/${first.id}/read`)).data.ok, true);
  assert.deepEqual(await titles('b@example.de'), ['An alle']);
  assert.equal((await people['b@example.de'].cl.get('/api/announcements?all=1')).data.items.length, 2);
  // fremde Ankündigung „lesen“ ändert nichts
  const kam = (await owner.get('/api/admin/announcements')).data.items.find((a) => a.title === 'Nur Kamera');
  assert.equal(kam.read, 1);
  assert.equal(kam.audience, 'Kamera-Team');
  assert.equal((await people['a@example.de'].cl.post(`/api/announcements/${kam.id}/read`)).data.ok, false);

  // Löschen
  assert.equal((await owner.del(`/api/admin/announcements/${kam.id}`)).status, 200);
  assert.equal((await owner.get('/api/admin/announcements')).data.items.length, 4);
  assert.equal((await owner.del(`/api/groups/${g.data.group.id}`)).status, 200);
});
