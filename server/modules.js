// Modul-Registry. Jedes Modul ist ein Ordner server/modules/<id>/ mit einer index.js, die exportiert:
//
//   export const manifest = { id, name, description, icon, roles: [{ id, label, help }], url?, order? };
//   export function register(api) { ... }   // optional: eigene API unter /api/m/<id>/…
//   manifest.path = '/rundown/'              // optional: Adresse einer vom Modul ausgelieferten Seite (statt url)
//
// `roles` ist geordnet von „wenig“ nach „viel“ (die letzte Rolle ist die höchste). Die Rolle einer Person
// im Modul steht in der Tabelle user_modules. Plattform-Admins haben in jedem Modul automatisch die höchste Rolle.
// Details: docs/modul-entwickeln.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Q } from './db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'modules');
const ID_RE = /^[a-z][a-z0-9-]{1,30}$/;

export const modules = [];

for (const name of fs.readdirSync(dir).sort()) {
  const file = path.join(dir, name, 'index.js');
  if (!fs.existsSync(file)) continue;
  const mod = await import(pathToFileURL(file).href);
  const m = mod.manifest;
  if (!m || !ID_RE.test(m.id) || m.id !== name) throw new Error(`Modul „${name}“: ungültiges oder fehlendes manifest (id muss dem Ordnernamen entsprechen)`);
  if (!Array.isArray(m.roles) || !m.roles.length || m.roles.some((r) => !r?.id || !r?.label)) throw new Error(`Modul „${name}“: roles fehlt oder ist ungültig`);
  modules.push({ manifest: m, register: mod.register || null });
}
// Reihenfolge der Kacheln: manifest.order (kleiner = weiter vorn), sonst alphabetisch
modules.sort((a, b) => (a.manifest.order ?? 100) - (b.manifest.order ?? 100) || a.manifest.name.localeCompare(b.manifest.name, 'de'));

export const moduleById = (id) => modules.find((m) => m.manifest.id === id)?.manifest || null;
export const roleIds = (id) => moduleById(id)?.roles.map((r) => r.id) || [];
const rank = (id, role) => roleIds(id).indexOf(role);

/** Rolle einer Person in einem Modul – null = kein Zugriff. Plattform-Admins sind überall Admin des Moduls. */
export function moduleRole(user, id) {
  const m = moduleById(id);
  if (!user || !m) return null;
  if (user.role === 'admin') return m.roles[m.roles.length - 1].id;
  const row = user.modules?.[id];
  return row && rank(id, row) >= 0 ? row : null;
}

/** Hat die Person im Modul mindestens diese Rolle? */
export const canModule = (user, id, minRole) => {
  const r = moduleRole(user, id);
  return r != null && rank(id, r) >= rank(id, minRole);
};

/** Rollen aller Module einer Person als { moduleId: rolle } (nur gültige Einträge) */
export function modulesOfUser(userId) {
  const out = {};
  for (const r of Q.modulesOf.all(userId)) if (rank(r.module, r.role) >= 0) out[r.module] = r.role;
  return out;
}

/** Alle Modul-Rollen aller Benutzer in einem Rutsch (für die Benutzerliste) */
export function allUserModules() {
  const out = new Map();
  for (const r of Q.allUserModules.all()) {
    if (rank(r.module, r.role) < 0) continue;
    if (!out.has(r.user_id)) out.set(r.user_id, {});
    out.get(r.user_id)[r.module] = r.role;
  }
  return out;
}

/** Modul-Rollen einer Person setzen: { moduleId: rolle | null }. Unbekannte Module/Rollen werden abgelehnt.
 *  Aufrufer sorgen selbst für eine Transaktion (tx), wenn sie mehrere Dinge gemeinsam speichern. */
export function setUserModules(userId, wanted) {
  for (const [id, role] of Object.entries(wanted || {})) {
    if (!moduleById(id)) throw new Error(`Unbekanntes Modul: ${id}`);
    if (role != null && role !== '' && rank(id, role) < 0) throw new Error(`Ungültige Rolle „${role}“ für Modul ${moduleById(id).name}`);
  }
  for (const [id, role] of Object.entries(wanted || {})) {
    if (role == null || role === '') Q.delModule.run(userId, id);
    else Q.setModule.run(userId, id, role);
  }
}

/** Beschreibung für die Oberfläche */
export const publicManifest = (m) => ({
  id: m.id, name: m.name, description: m.description || '', icon: m.icon || 'grid',
  roles: m.roles, href: m.url || m.path || null, available: !!(m.url || m.path),
});
