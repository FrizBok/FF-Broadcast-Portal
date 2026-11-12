const [NODE_MAJOR, NODE_MINOR] = process.versions.node.split('.').map(Number);
if (NODE_MAJOR < 22 || (NODE_MAJOR === 22 && NODE_MINOR < 13)) {
  console.error(`\n  FF-Broadcast benötigt Node.js 22.13 oder neuer (gefunden: ${process.version}).\n  Download: https://nodejs.org\n`);
  process.exit(1);
}
const { DatabaseSync } = await import('node:sqlite');
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));

// Datenschutz: Alles, was der Server neu anlegt (Datenbank, WAL-/SHM-Dateien, Schlüssel, Backups),
// ist nur für den Benutzer lesbar, unter dem der Server läuft.
process.umask(0o077);
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

/** Bestehende Rechte nachziehen (z. B. nach einem Update) */
export function secureDataDir() {
  if (process.platform === 'win32') return; // Windows nutzt ACLs statt Unix-Rechte
  const fix = (p, mode) => {
    try {
      const st = fs.statSync(p);
      if ((st.mode & 0o777) !== mode) fs.chmodSync(p, mode);
    } catch (e) {
      if (e.code !== 'ENOENT') console.warn(`  Hinweis: Rechte für ${p} konnten nicht gesetzt werden (${e.code}).`);
    }
  };
  fix(DATA_DIR, 0o700);
  for (const f of fs.readdirSync(DATA_DIR)) {
    const p = path.join(DATA_DIR, f);
    try { fix(p, fs.statSync(p).isDirectory() ? 0o700 : 0o600); } catch { /* */ }
  }
}

export const db = new DatabaseSync(path.join(DATA_DIR, 'portal.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
secureDataDir();

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',          -- Plattformrolle: 'admin' | 'user'
  kind TEXT NOT NULL DEFAULT 'member',        -- 'member' | 'guest'
  active INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER,                         -- nur Gäste: Ablauf des Zugangs (ms seit 1970), leer = unbegrenzt
  must_change INTEGER NOT NULL DEFAULT 0,
  token_version INTEGER NOT NULL DEFAULT 0,
  is_owner INTEGER NOT NULL DEFAULT 0,        -- Super-Admin (genau eine Person)
  totp_secret TEXT,                           -- verschlüsselt (siehe seal())
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  totp_last INTEGER NOT NULL DEFAULT 0,       -- zuletzt benutzter Zeitschritt (gegen Wiederverwendung)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login TEXT
);
-- Rolle pro Modul. Fehlt der Eintrag, hat die Person keinen Zugriff auf das Modul.
CREATE TABLE IF NOT EXISTS user_modules (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (user_id, module)
);
-- Einmal-Links zum Zurücksetzen/Einladen (gespeichert wird nur der SHA-256-Fingerabdruck)
CREATE TABLE IF NOT EXISTS reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL DEFAULT 'reset',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at INTEGER NOT NULL,
  used_at TEXT
);
CREATE TABLE IF NOT EXISTS recovery_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_recovery_user ON recovery_codes(user_id);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- Eigene Gruppen (z. B. „Kamera-Team“) für Ankündigungen
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);
-- Ankündigungen: Empfänger werden beim Erstellen festgelegt (announcement_recipients)
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT '{}',        -- Auswahl als JSON (zur Anzeige)
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER,                         -- danach nicht mehr auf der Startseite
  mailed INTEGER NOT NULL DEFAULT 0           -- Anzahl verschickter Mails
);
CREATE TABLE IF NOT EXISTS announcement_recipients (
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at INTEGER,
  PRIMARY KEY (announcement_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ann_rcpt_user ON announcement_recipients(user_id);
`);

/** Platzhalter-Hash für Konten, die noch kein Passwort haben (Einladung offen) – passt zu keinem Passwort */
export const NO_PASSWORD = '!invite$';

export function randomToken(bytes = 18) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Geheimer Schlüssel für Login-Tokens – wird beim ersten Start erzeugt und im Datenordner gespeichert */
export function getSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(DATA_DIR, 'secret.key');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
}

/* ---------- Einstellungen (Schlüssel/Wert) */
const getS = db.prepare('SELECT value FROM settings WHERE key=?');
const setS = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
export const getSetting = (key) => getS.get(key)?.value ?? null;
export const setSetting = (key, value) => { setS.run(key, String(value)); };

/* ---------- Geheimnisse in der Datenbank verschlüsseln (AES-256-GCM, Schlüssel aus dem Server-Secret) */
const sealKey = () => crypto.createHash('sha256').update('ffp-seal:' + getSecret()).digest();
export function seal(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', sealKey(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
export function unseal(blob) {
  if (!blob) return '';
  try {
    const [iv, tag, enc] = blob.split('.').map((s) => Buffer.from(s, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', sealKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch { return ''; }
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Super-Admin: Es gibt immer genau einen. Fehlt er, wird automatisch der älteste Admin zum Super-Admin.
 * Er ist immer Plattform-Admin, aktiv und nie Gast.
 */
export function ensureOwner() {
  const owners = db.prepare('SELECT id FROM users WHERE is_owner=1 ORDER BY id').all();
  if (owners.length > 1) db.prepare('UPDATE users SET is_owner=0 WHERE is_owner=1 AND id<>?').run(owners[0].id);
  if (owners.length) {
    db.prepare("UPDATE users SET role='admin', kind='member', active=1, expires_at=NULL WHERE id=?").run(owners[0].id);
    return owners[0].id;
  }
  const first = db.prepare("SELECT id FROM users WHERE role='admin' AND kind='member' ORDER BY id LIMIT 1").get();
  if (first) db.prepare('UPDATE users SET is_owner=1 WHERE id=?').run(first.id);
  return first?.id ?? null;
}
ensureOwner();

export const Q = {
  userCount: db.prepare('SELECT COUNT(*) AS n FROM users'),
  userById: db.prepare('SELECT * FROM users WHERE id=?'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email=?'),
  users: db.prepare('SELECT * FROM users ORDER BY is_owner DESC, role, email'),
  deleteUser: db.prepare('DELETE FROM users WHERE id=?'),
  touchLogin: db.prepare("UPDATE users SET last_login=datetime('now') WHERE id=?"),
  modulesOf: db.prepare('SELECT module, role FROM user_modules WHERE user_id=?'),
  allUserModules: db.prepare('SELECT user_id, module, role FROM user_modules'),
  setModule: db.prepare('INSERT INTO user_modules (user_id,module,role) VALUES (?,?,?) ON CONFLICT(user_id,module) DO UPDATE SET role=excluded.role'),
  delModule: db.prepare('DELETE FROM user_modules WHERE user_id=? AND module=?'),
  insertReset: db.prepare('INSERT INTO reset_tokens (user_id,token_hash,purpose,created_by,expires_at) VALUES (?,?,?,?,?)'),
  resetByHash: db.prepare('SELECT * FROM reset_tokens WHERE token_hash=?'),
  resetOpenForUser: db.prepare('SELECT * FROM reset_tokens WHERE user_id=? AND used_at IS NULL AND expires_at>? ORDER BY id DESC LIMIT 1'),
  revokeResets: db.prepare("UPDATE reset_tokens SET used_at=datetime('now') WHERE user_id=? AND used_at IS NULL"),
  markResetUsed: db.prepare("UPDATE reset_tokens SET used_at=datetime('now') WHERE id=?"),
  cleanupResets: db.prepare("DELETE FROM reset_tokens WHERE expires_at<? OR (used_at IS NOT NULL AND used_at < datetime('now', '-30 days'))"),
  recoveryUnused: db.prepare('SELECT id, code_hash FROM recovery_codes WHERE user_id=? AND used_at IS NULL'),
  recoveryUse: db.prepare("UPDATE recovery_codes SET used_at=datetime('now') WHERE id=?"),
  recoveryClear: db.prepare('DELETE FROM recovery_codes WHERE user_id=?'),
  recoveryAdd: db.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?,?)'),
};

/** Dynamisches UPDATE mit Whitelist */
export function updateRow(table, id, fields, allowed) {
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (!keys.length) return;
  db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`).run(...keys.map((k) => fields[k]), id);
}
