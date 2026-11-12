// Notfall-Werkzeug auf dem Server (z. B. wenn kein Admin mehr hineinkommt):
//   node server/reset-password.js --list                     Benutzer anzeigen
//   node server/reset-password.js mail@example.de            temporäres Passwort erzeugen (Pflichtwechsel beim Login)
//   node server/reset-password.js mail@example.de --admin    zusätzlich (wieder) zum Plattform-Admin machen
//   node server/reset-password.js mail@example.de --owner    zum Super-Admin machen (Passwort bleibt)
//   node server/reset-password.js mail@example.de --link     Reset-Link statt Passwort (24 Std.)
//   node server/reset-password.js mail@example.de --no2fa    2FA dieses Kontos ausschalten (Gerät verloren)
// Docker: docker exec -it ff-broadcast-portal node server/reset-password.js …
import crypto from 'node:crypto';
import { db, Q, ensureOwner, randomToken, DATA_DIR } from './db.js';
import { hashPassword, sha256 } from './auth.js';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const email = args.find((a) => !a.startsWith('--'));

if (flags.has('--list') || !email) {
  const rows = Q.users.all();
  if (!rows.length) console.log('Noch keine Benutzer.');
  for (const u of rows) {
    console.log(`${String(u.id).padStart(3)}  ${u.email.padEnd(36)} ${u.is_owner ? 'Super-Admin' : u.role === 'admin' ? 'Admin      ' : u.kind === 'guest' ? 'Gast       ' : 'Mitglied   '}${u.active ? '' : ' [deaktiviert]'}${u.totp_enabled ? ' [2FA]' : ''}`);
  }
  if (!email && !flags.has('--list')) console.log('\nAufruf: node server/reset-password.js <email> [--admin] [--owner] [--link] [--no2fa]   (Daten: ' + DATA_DIR + ')');
  process.exit(0);
}

const u = Q.userByEmail.get(email);
if (!u) { console.error(`Kein Benutzer mit der Adresse ${email}.`); process.exit(1); }

if (flags.has('--admin')) { db.prepare("UPDATE users SET role='admin', kind='member', active=1, expires_at=NULL WHERE id=?").run(u.id); console.log('✓ Plattform-Admin'); }
if (flags.has('--owner')) {
  db.prepare('UPDATE users SET is_owner=0').run();
  db.prepare("UPDATE users SET is_owner=1, role='admin', kind='member', active=1, expires_at=NULL WHERE id=?").run(u.id);
  ensureOwner();
  console.log('✓ Super-Admin');
}
if (flags.has('--no2fa')) {
  db.prepare('UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_last=0, token_version=token_version+1 WHERE id=?').run(u.id);
  Q.recoveryClear.run(u.id);
  console.log('✓ 2FA ausgeschaltet (Konto ist überall abgemeldet).');
}
// --owner und --no2fa ändern das Passwort nicht – nur mit --admin oder --link wird zusätzlich eines erzeugt
if ((flags.has('--owner') || flags.has('--no2fa')) && !flags.has('--link') && !flags.has('--admin')) process.exit(0);

if (flags.has('--link')) {
  Q.revokeResets.run(u.id);
  const token = randomToken(24);
  Q.insertReset.run(u.id, sha256(token), 'reset', 'Notfall-Skript', Date.now() + 24 * 3600e3);
  console.log(`\nReset-Link (24 Std. gültig): <Adresse der App>/#/reset/${token}\n`);
} else {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const pw = Array.from({ length: 14 }, () => chars[crypto.randomInt(chars.length)]).join('');
  db.prepare('UPDATE users SET password_hash=?, must_change=1, token_version=token_version+1 WHERE id=?').run(await hashPassword(pw), u.id);
  Q.revokeResets.run(u.id);
  console.log(`\nTemporäres Passwort für ${u.email}: ${pw}\nEs muss beim nächsten Login geändert werden.\n`);
}
process.exit(0);
