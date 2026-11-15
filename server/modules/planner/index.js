// Modul „Terminplanung“ – Termine, Verfügbarkeit und Besetzung.
//
// Läuft als eigener Dienst (Repo FrizBok/FF-Planner). Anmeldung per Single Sign-on über das Portal:
// PLANNER_URL = Adresse der Terminplanung, PLANNER_SSO_SECRET = gemeinsamer Schlüssel (in der Terminplanung
// als PORTAL_SSO_SECRET). Die Terminplanung holt sich mit demselben Schlüssel die Liste der Personen mit Zugriff
// (GET /api/modules/planner/directory), damit Planer auch Leute einteilen können, die das Modul noch nie geöffnet haben.

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
