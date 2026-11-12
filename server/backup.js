// Datenbank-Sicherungen (Admin). Konsistent auch im laufenden Betrieb (VACUUM INTO).
// Automatisch alle BACKUP_INTERVAL_HOURS (Standard 6), die letzten BACKUP_KEEP (Standard 30) bleiben erhalten;
// manuelle Sicherungen werden nie automatisch gelöscht. Backups enthalten Benutzer, Passwort-Hashes und
// (verschlüsselte) 2FA-Geheimnisse – wie Passwortlisten behandeln. Der Schlüssel (secret.key) ist NICHT enthalten.
import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR } from './db.js';
import * as audit from './audit.js';

export const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups'));
const ENABLED = process.env.BACKUP_ENABLED !== 'false';
const INTERVAL_H = Math.max(1, Number(process.env.BACKUP_INTERVAL_HOURS) || 6);
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP) || 30);

fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });

const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
const NAME_RE = /^(auto|manual)-\d{8}-\d{6}(-[a-z0-9-]+)?\.db$/;

export function create(kind = 'manual', label = '') {
  const name = `${kind}-${stamp()}${slug(label) ? '-' + slug(label) : ''}.db`;
  const file = path.join(BACKUP_DIR, name);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  try { fs.chmodSync(file, 0o600); } catch { /* */ }
  return info(name);
}

function info(name) {
  const st = fs.statSync(path.join(BACKUP_DIR, name));
  return { name, kind: name.startsWith('auto') ? 'auto' : 'manual', size: st.size, at: st.mtimeMs };
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
