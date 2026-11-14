// Modul „FF Rundown“ – Ablaufplan & Live-Steuerung.
//
// Läuft als eigener Dienst (Repo Intracy/FF-Rundown) und kann auch ganz ohne Portal betrieben werden.
// Mit dem Portal verbunden (RUNDOWN_URL + RUNDOWN_SSO_SECRET, im Rundown als PORTAL_URL + PORTAL_SSO_SECRET):
// Anmeldung per Single Sign-on, Konten werden im Rundown automatisch angelegt bzw. per E-Mail verknüpft,
// Gäste aus dem Portal sind dort „extern“ und sehen nur freigegebene Rundowns.
// Ohne Schlüssel verlinkt die Kachel einfach auf RUNDOWN_URL (Anmeldung dann im Rundown selbst).

export const manifest = {
  id: 'rundown',
  name: 'FF Rundown',
  description: 'Ablaufplan und Live-Steuerung für Shows und Events.',
  order: 10, // Position der Kachel
  icon: 'list',
  roles: [
    { id: 'viewer', label: 'Viewer', help: 'Rundowns ansehen' },
    { id: 'operator', label: 'Operator', help: 'ansehen und Live-Steuerung' },
    { id: 'editor', label: 'Editor', help: 'Rundowns bearbeiten' },
    { id: 'admin', label: 'Rundown-Admin', help: 'alles im Modul, inkl. Freigaben für Gäste (ohne Benutzerverwaltung)' },
  ],
  // Ziel der Kachel; leer = Modul ist noch nicht verfügbar („Bald“)
  url: process.env.RUNDOWN_URL || '',
  sso: true,
};
