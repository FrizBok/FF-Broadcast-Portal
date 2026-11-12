// Datenbank-Sicherungen (Admin). Konsistent auch im laufenden Betrieb (VACUUM INTO).
// Automatisch alle BACKUP_INTERVAL_HOURS (Standard 6), die letzten BACKUP_KEEP (Standard 30) bleiben erhalten;
// manuelle Sicherungen werden nie automatisch gelöscht. Backups enthalten Benutzer, Passwort-Hashes und
// (verschlüsselte) 2FA-Geheimnisse – wie Passwortlisten behandeln. Der Schlüssel (secret.key) ist NICHT enthalten.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { db, DATA_DIR, ensureOwner } from './db.js';
import * as audit from './audit.js';

export const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups'));
const ENABLED = process.env.BACKUP_ENABLED !== 'false';
const INTERVAL_H = Math.max(1, Number(process.env.BACKUP_INTERVAL_HOURS) || 6);
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP) || 30);

fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });

const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
const NAME_RE = /^(auto|manual|upload)-\d{8}-\d{6}(-[a-z0-9-]+)?\.db$/;

export function create(kind = 'manual', label = '') {
  let name = `${kind}-${stamp()}${slug(label) ? '-' + slug(label) : ''}.db`;
  for (let i = 2; fs.existsSync(path.join(BACKUP_DIR, name)); i++) name = `${kind}-${stamp()}-${slug(label) ? slug(label) + '-' : ''}${i}.db`;
  const file = path.join(BACKUP_DIR, name);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  try { fs.chmodSync(file, 0o600); } catch { /* */ }
  return info(name);
}

function info(name) {
  const st = fs.statSync(path.join(BACKUP_DIR, name));
  return { name, kind: name.startsWith('auto') ? 'auto' : name.startsWith('upload') ? 'upload' : 'manual', size: st.size, at: st.mtimeMs };
}

export function list() {
  return fs.readdirSync(BACKUP_DIR).filter((n) => NAME_RE.test(n)).map(info).sort((a, b) => b.at - a.at);
}

export function filePath(name) {
  if (!NAME_RE.test(String(name))) return null;
  const f = path.join(BACKUP_DIR, name);
  return fs.existsSync(f) ? f : null;
}

export function remove(name) {
  const f = filePath(name);
  if (!f) return false;
  fs.unlinkSync(f);
  return true;
}

/** Prüft, ob eine Datei eine intakte Portal-Datenbank ist → { users } */
export function validate(file) {
  let src;
  try { src = new DatabaseSync(file, { readOnly: true }); } catch { throw new Error('Die Datei ist keine SQLite-Datenbank'); }
  try {
    let check;
    try { check = Object.values(src.prepare('PRAGMA integrity_check').get())[0]; } catch { throw new Error('Die Datei ist keine SQLite-Datenbank'); }
    if (check !== 'ok') throw new Error('Die Sicherung ist beschädigt');
    if (!src.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get()) throw new Error('Das ist keine Sicherung des Portals');
    const users = src.prepare('SELECT COUNT(*) n FROM users').get().n;
    if (!users) throw new Error('Die Sicherung enthält keine Benutzer');
    return { users };
  } finally { src.close(); }
}

/** Hochgeladene Sicherung prüfen und ablegen */
export function saveUpload(buf, label = '') {
  if (!Buffer.isBuffer(buf) || buf.length < 512) throw new Error('Bitte eine Sicherungsdatei (.db) hochladen');
  if (buf.subarray(0, 16).toString('latin1') !== 'SQLite format 3\0') throw new Error('Die Datei ist keine SQLite-Datenbank');
  let name = `upload-${stamp()}${slug(label) ? '-' + slug(label) : ''}.db`;
  for (let i = 2; fs.existsSync(path.join(BACKUP_DIR, name)); i++) name = `upload-${stamp()}-${slug(label) ? slug(label) + '-' : ''}${i}.db`;
  const file = path.join(BACKUP_DIR, name);
  fs.writeFileSync(file, buf, { mode: 0o600 });
  try { validate(file); } catch (e) { fs.unlinkSync(file); throw e; }
  return info(name);
}

/**
 * Sicherung zurückspielen. Vorher wird der aktuelle Stand gesichert („vor-wiederherstellung“).
 * Alle Tabellen werden ersetzt – außer dem Protokoll, damit nachvollziehbar bleibt, wer wann was zurückgespielt hat.
 * Spalten, die es nur auf einer Seite gibt (ältere/neuere Version), werden übersprungen bzw. mit Standardwerten gefüllt.
 */
export function restore(name) {
  const f = filePath(name);
  if (!f) throw new Error('Backup nicht gefunden');
  const { users } = validate(f);
  const safety = create('manual', 'vor-wiederherstellung');
  const KEEP_TABLES = new Set(['audit_log']);
  const q = (n) => `"${String(n).replace(/"/g, '""')}"`;
  db.exec('PRAGMA foreign_keys = OFF');
  db.prepare('ATTACH DATABASE ? AS src').run(f);
  try {
    const srcTables = new Set(db.prepare("SELECT name FROM src.sqlite_master WHERE type='table'").all().map((r) => r.name));
    const tables = db.prepare("SELECT name FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name).filter((t) => !KEEP_TABLES.has(t));
    db.exec('BEGIN');
    try {
      for (const t of tables) {
        db.exec(`DELETE FROM main.${q(t)}`);
        if (!srcTables.has(t)) continue;
        const scols = new Set(db.prepare(`PRAGMA src.table_info(${q(t)})`).all().map((c) => c.name));
        const common = db.prepare(`PRAGMA main.table_info(${q(t)})`).all().map((c) => c.name).filter((c) => scols.has(c)).map(q).join(', ');
        if (common) db.exec(`INSERT INTO main.${q(t)} (${common}) SELECT ${common} FROM src.${q(t)}`);
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw new Error('Zurückspielen fehlgeschlagen: ' + e.message); }
  } finally {
    db.exec('DETACH DATABASE src');
    db.exec('PRAGMA foreign_keys = ON');
  }
  ensureOwner();
  return { safety: safety.name, users };
}

function prune() {
  const autos = list().filter((b) => b.kind === 'auto');
  for (const b of autos.slice(KEEP)) { try { fs.unlinkSync(path.join(BACKUP_DIR, b.name)); } catch { /* */ } }
}

export const settings = () => ({ enabled: ENABLED, interval_hours: INTERVAL_H, keep: KEEP, dir: BACKUP_DIR });

if (ENABLED) {
  const run = () => {
    try { create('auto'); prune(); }
    catch (e) { console.error('  Automatisches Backup fehlgeschlagen:', e.message); audit.log('backup_failed', { detail: { error: e.message }, ok: false }); }
  };
  // erstes Backup kurz nach dem Start, wenn das letzte länger als das Intervall her ist
  const last = list().find((b) => b.kind === 'auto');
  if (!last || Date.now() - last.at > INTERVAL_H * 3600e3) setTimeout(run, 5000).unref();
  setInterval(run, INTERVAL_H * 3600e3).unref();
}
