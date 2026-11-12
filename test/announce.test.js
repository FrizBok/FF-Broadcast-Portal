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
  const raw = async (url, buf) => {
    const r = await fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...(cookie ? { Cookie: cookie } : {}) }, body: buf });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const download = async (url) => Buffer.from(await (await fetch(BASE + url, { headers: cookie ? { Cookie: cookie } : {} })).arrayBuffer());
  return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b = {}) => call('PUT', u, b), del: (u) => call('DELETE', u), raw, download };
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

test('Gruppen einer Person direkt setzen', async () => {
  const a = await owner.post('/api/groups', { name: 'Licht' });
  const b = await owner.post('/api/groups', { name: 'Ton' });
  const uid = people['b@example.de'].id;
  const r = await owner.put(`/api/users/${uid}/groups`, { groups: [a.data.group.id, b.data.group.id, 9999] });
  assert.deepEqual(r.data.groups, [a.data.group.id, b.data.group.id]);
  assert.equal((await people['b@example.de'].cl.put(`/api/users/${uid}/groups`, { groups: [] })).status, 403);
  await owner.put(`/api/users/${uid}/groups`, { groups: [b.data.group.id] });
  const groups = (await owner.get('/api/groups')).data.groups;
  assert.deepEqual(groups.find((g) => g.name === 'Licht').members, []);
  assert.deepEqual(groups.find((g) => g.name === 'Ton').members, [uid]);
});

test('Backup zurückspielen und hochladen (nur Super-Admin)', async () => {
  const bk = (await owner.post('/api/system/backups', {})).data.backup;
  await owner.post('/api/users', { email: 'spaeter@example.de', mode: 'invite' });
  await owner.post('/api/groups', { name: 'Neue Gruppe' });
  assert.ok((await owner.get('/api/users')).data.users.some((u) => u.email === 'spaeter@example.de'));

  // Andere Admins dürfen nicht zurückspielen
  await owner.post('/api/users', { email: 'admin2@example.de', role: 'admin', mode: 'password', password: PW });
  const adm = client();
  await adm.post('/api/auth/login', { email: 'admin2@example.de', password: PW });
  await adm.post('/api/auth/initial-password', { password: PW + 'x' });
  assert.equal((await adm.post(`/api/system/backups/${bk.name}/restore`)).status, 403);

  const r = await owner.post(`/api/system/backups/${bk.name}/restore`);
  assert.equal(r.status, 200);
  assert.match(r.data.safety, /^manual-.*vor-wiederherstellung.*\.db$/);
  const users = (await owner.get('/api/users')).data.users;
  assert.ok(!users.some((u) => u.email === 'spaeter@example.de'));
  assert.ok(!users.some((u) => u.email === 'admin2@example.de'));
  assert.ok(!(await owner.get('/api/groups')).data.groups.some((g) => g.name === 'Neue Gruppe'));
  assert.equal((await adm.get('/api/me')).status, 401); // Konto gibt es im alten Stand nicht
  // Protokoll bleibt erhalten und enthält die Wiederherstellung
  const log = (await owner.get('/api/system/audit?q=spaeter')).data.entries;
  assert.ok(log.some((e) => e.kind === 'user_invited'));
  assert.ok((await owner.get('/api/system/audit?cat=system')).data.entries.some((e) => e.kind === 'backup_restored'));

  // Sicherungsstand „vor der Wiederherstellung“ wieder einspielen → Konto ist zurück
  assert.equal((await owner.post(`/api/system/backups/${r.data.safety}/restore`)).status, 200);
  assert.ok((await owner.get('/api/users')).data.users.some((u) => u.email === 'spaeter@example.de'));

  // Hochladen: echte Sicherung ja, Unsinn nein
  const buf = await owner.download(`/api/system/backups/${bk.name}`);
  const up = await owner.raw('/api/system/backups/upload?name=vom-alten-server', buf);
  assert.equal(up.status, 200);
  assert.match(up.data.backup.name, /^upload-.*-vom-alten-server\.db$/);
  assert.equal((await owner.raw('/api/system/backups/upload', Buffer.from('kein backup'.repeat(100)))).status, 400);
  assert.equal((await adm.raw('/api/system/backups/upload', buf)).status, 403); // admin2 ist durch den zweiten Restore wieder da, aber kein Super-Admin
});
