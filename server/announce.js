// Gruppen und Ankündigungen
import { db, tx } from './db.js';
import { modules, moduleRole, allUserModules } from './modules.js';

/* ------------------------------------------------------------------ Gruppen */
/** Feste Gruppen, die sich aus den Konten ergeben */
export function autoGroups() {
  const out = [
    { id: 'auto:members', name: 'Alle Mitglieder', auto: true },
    { id: 'auto:guests', name: 'Alle Gäste', auto: true },
    { id: 'auto:admins', name: 'Plattform-Admins', auto: true },
  ];
  for (const m of modules) out.push({ id: 'mod:' + m.manifest.id, name: `Mit Zugang zu ${m.manifest.name}`, auto: true });
  return out;
}

export function listGroups() {
  const members = new Map();
  for (const r of db.prepare('SELECT group_id, user_id FROM group_members').all()) {
    if (!members.has(r.group_id)) members.set(r.group_id, []);
    members.get(r.group_id).push(r.user_id);
  }
  return db.prepare('SELECT * FROM groups ORDER BY name').all().map((g) => ({ ...g, members: members.get(g.id) || [] }));
}

export function saveGroup(id, { name, description, members }) {
  name = String(name || '').trim().slice(0, 60);
  if (!name) throw new Error('Bitte einen Namen angeben');
  const other = db.prepare('SELECT id FROM groups WHERE name=?').get(name);
  if (other && other.id !== id) throw new Error('Eine Gruppe mit diesem Namen gibt es schon');
  const ids = [...new Set((Array.isArray(members) ? members : []).map(Number).filter(Number.isInteger))];
  return tx(() => {
    if (id) db.prepare('UPDATE groups SET name=?, description=? WHERE id=?').run(name, String(description || '').slice(0, 200), id);
    else id = Number(db.prepare('INSERT INTO groups (name, description) VALUES (?,?)').run(name, String(description || '').slice(0, 200)).lastInsertRowid);
    db.prepare('DELETE FROM group_members WHERE group_id=?').run(id);
    const add = db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) SELECT ?, id FROM users WHERE id=?');
    for (const u of ids) add.run(id, u);
    return id;
  });
}

/* ------------------------------------------------------------------ Empfänger */
const usable = (u) => u.active && !(u.expires_at && u.expires_at < Date.now());

/** Auswahl { all, groups: ['auto:members','mod:rundown','g:3'], users: [ids] } → Liste aktiver Konten */
export function resolveAudience(a = {}) {
  const users = db.prepare('SELECT * FROM users').all().filter(usable);
  if (a.all) return users;
  const groups = new Set(Array.isArray(a.groups) ? a.groups.map(String) : []);
  const direct = new Set(Array.isArray(a.users) ? a.users.map(Number) : []);
  const mods = allUserModules();
  const inGroup = new Set();
  for (const g of groups) {
    const m = g.match(/^g:(\d+)$/);
    if (m) for (const r of db.prepare('SELECT user_id FROM group_members WHERE group_id=?').all(Number(m[1]))) inGroup.add(r.user_id);
  }
  return users.filter((u) => direct.has(u.id) || inGroup.has(u.id)
    || (groups.has('auto:members') && u.kind === 'member')
    || (groups.has('auto:guests') && u.kind === 'guest')
    || (groups.has('auto:admins') && u.role === 'admin')
    || [...groups].some((g) => g.startsWith('mod:') && moduleRole({ ...u, modules: mods.get(u.id) || {} }, g.slice(4))));
}

/** Auswahl lesbar beschreiben, z. B. „Alle“ oder „Kamera-Team, 2 Personen“ */
export function describeAudience(a = {}) {
  if (a.all) return 'Alle';
  const names = new Map([...autoGroups().map((g) => [g.id, g.name]), ...listGroups().map((g) => ['g:' + g.id, g.name])]);
  const parts = (a.groups || []).map((g) => names.get(g)).filter(Boolean);
  const n = (a.users || []).length;
  if (n) parts.push(n === 1 ? '1 Person' : `${n} Personen`);
  return parts.join(', ') || '–';
}

/* ------------------------------------------------------------------ Ankündigungen */
export function createAnnouncement({ title, body, audience, expires_at }, actor) {
  title = String(title || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
  body = String(body || '').replace(/\r\n/g, '\n').trim().slice(0, 5000);
  if (!title) throw new Error('Bitte einen Titel angeben');
  const a = { all: !!audience?.all, groups: audience?.all ? [] : (audience?.groups || []).map(String).slice(0, 100), users: audience?.all ? [] : (audience?.users || []).map(Number).filter(Number.isInteger).slice(0, 1000) };
  const rcpt = resolveAudience(a);
  if (!rcpt.length) throw new Error('Die Auswahl enthält keine Empfänger');
  const id = tx(() => {
    const r = db.prepare('INSERT INTO announcements (title, body, audience, created_by, created_by_name, created_at, expires_at) VALUES (?,?,?,?,?,?,?)')
      .run(title, body, JSON.stringify(a), actor.id, actor.name || actor.email, Date.now(), expires_at || null);
    const id = Number(r.lastInsertRowid);
    const add = db.prepare('INSERT INTO announcement_recipients (announcement_id, user_id) VALUES (?,?)');
    for (const u of rcpt) add.run(id, u.id);
    return id;
  });
  return { id, recipients: rcpt };
}

const out = (r) => ({ id: r.id, title: r.title, body: r.body, by: r.created_by_name, created_at: r.created_at, expires_at: r.expires_at });

/** Ankündigungen für ein Konto (nicht abgelaufen; gelesene nur auf Wunsch) */
export function myAnnouncements(userId, { all = false } = {}) {
  return db.prepare(`SELECT a.*, r.read_at FROM announcements a JOIN announcement_recipients r ON r.announcement_id=a.id
    WHERE r.user_id=? AND (a.expires_at IS NULL OR a.expires_at>?) ${all ? '' : 'AND r.read_at IS NULL'} ORDER BY a.created_at DESC LIMIT 50`)
    .all(userId, Date.now()).map((r) => ({ ...out(r), read: !!r.read_at }));
}

export function markRead(userId, id) {
  return db.prepare('UPDATE announcement_recipients SET read_at=? WHERE user_id=? AND announcement_id=? AND read_at IS NULL').run(Date.now(), userId, id).changes > 0;
}

/** Übersicht für Admins mit Empfänger- und Gelesen-Zahl */
export function adminAnnouncements() {
  return db.prepare(`SELECT a.*, COUNT(r.user_id) AS total, COUNT(r.read_at) AS read FROM announcements a
    LEFT JOIN announcement_recipients r ON r.announcement_id=a.id GROUP BY a.id ORDER BY a.created_at DESC LIMIT 200`).all()
    .map((r) => {
      let aud = {};
      try { aud = JSON.parse(r.audience); } catch { /* */ }
      return { ...out(r), audience: describeAudience(aud), total: r.total, read: r.read, mailed: r.mailed, expired: !!(r.expires_at && r.expires_at < Date.now()) };
    });
}
