// Modul „Overlay Engine“ – Grafiken und Einblendungen für den Livestream.
//
// Läuft als eigener Dienst (Repo Intracy/FF-Overlay). Anmeldung per Single Sign-on über das Portal:
// OVERLAY_URL = Adresse der Overlay Engine, OVERLAY_SSO_SECRET = gemeinsamer Schlüssel (in der Overlay Engine
// als PORTAL_SSO_SECRET). Ohne Schlüssel verlinkt die Kachel nur auf OVERLAY_URL, ohne Adresse zeigt sie „Bald“.

export const manifest = {
  id: 'overlay',
  name: 'Overlay Engine',
  description: 'Grafiken und Einblendungen für den Livestream.',
  order: 20, // Position der Kachel
  icon: 'layers',
  roles: [
    { id: 'operator', label: 'Operator', help: 'Alert Feed, Test-Alerts, Warteschlange und Widgets live steuern' },
    { id: 'editor', label: 'Editor', help: 'zusätzlich Alerts, Designs, Regeln, Widgets, Chat und Mediathek bearbeiten' },
    { id: 'admin', label: 'Overlay-Admin', help: 'alles im Modul: Verbindungen, Projekte, Einstellungen, Schlüssel' },
  ],
  url: process.env.OVERLAY_URL || '',
  sso: true,
};
