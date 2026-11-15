// Modul „Terminplanung“ – Termine, Verfügbarkeit und Besetzung.
//
// Läuft als eigener Dienst (Repo FrizBok/FF-Planner). Anmeldung per Single Sign-on über das Portal:
// PLANNER_URL = Adresse der Terminplanung, PLANNER_SSO_SECRET = gemeinsamer Schlüssel (in der Terminplanung
// als PORTAL_SSO_SECRET). Die Terminplanung holt sich mit demselben Schlüssel die Liste der Personen mit Zugriff
// (GET /api/modules/planner/directory), damit Planer auch Leute einteilen können, die das Modul noch nie geöffnet haben.

import crypto from 'node:crypto';
import { normalizeBaseUrl, ssoSecret, ssoReady } from '../../sso.js';

export const manifest = {
  id: 'planner',
  name: 'Terminplanung',
  description: 'Termine, Verfügbarkeit und Besetzung der Crew.',
  order: 30, // Position der Kachel
  icon: 'calendar',
  roles: [
    { id: 'member', label: 'Mitglied', help: 'freigegebene Termine sehen, Verfügbarkeit eintragen, Besetzung ansehen' },
    { id: 'planner', label: 'Planer', help: 'Termine anlegen und freigeben, Personen einteilen, Rundown hinterlegen' },
    { id: 'admin', label: 'Planer-Admin', help: 'zusätzlich Stellen-Liste verwalten und Termine endgültig löschen' },
  ],
  url: process.env.PLANNER_URL || '',
  sso: true,
};

// „Deine nächsten Einsätze“ auf der Startseite: holt die eigenen Einsätze aus der Terminplanung
// (Dienst-zu-Dienst, unterschrieben mit PLANNER_SSO_SECRET: HMAC über "upcoming:<sub>:<ts>").
export function register(api) {
  api.get('/upcoming', api.requireRole('member'), async (req) => {
    if (!ssoReady(manifest)) return { enabled: false, items: [], to_answer: 0 };
    const sub = String(req.user.id);
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', ssoSecret(manifest)).update(`upcoming:${sub}:${ts}`).digest('base64url');
    const base = normalizeBaseUrl(manifest.url);
    try {
      const r = await fetch(`${base}/api/ext/upcoming?sub=${encodeURIComponent(sub)}`, { headers: { Authorization: `Portal ${ts}.${sig}` }, signal: AbortSignal.timeout(4000) });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      const link = (path) => `/sso/planner?next=${encodeURIComponent(path)}`; // öffnet direkt den Termin, Anmeldung inklusive
      return {
        enabled: true,
        items: (d.items || []).map((x) => ({ ...x, href: link(x.path) })),
        to_answer: d.to_answer || 0,
        href: '/sso/planner',
        mine_href: link('/#/meine'),
      };
    } catch {
      return { enabled: true, error: 'Terminplanung gerade nicht erreichbar', items: [], to_answer: 0 };
    }
  });
}
