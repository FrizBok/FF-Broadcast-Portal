// Modul „FF Rundown“ – Ablaufplan & Live-Steuerung.
//
// Aktuell nur eine Verknüpfung: Solange der Rundown noch nicht ins Portal umgezogen ist, zeigt die Kachel
// auf die bestehende Installation (Umgebungsvariable RUNDOWN_URL, z. B. https://ffrundown.fl-tecmedia.de).
// Die Rollen sind schon die späteren Modul-Rollen und werden pro Person im Portal vergeben.

export const manifest = {
  id: 'rundown',
  name: 'FF Rundown',
  description: 'Ablaufplan und Live-Steuerung für Shows und Events.',
  icon: 'list',
  roles: [
    { id: 'viewer', label: 'Viewer', help: 'Rundowns ansehen' },
    { id: 'operator', label: 'Operator', help: 'ansehen und Live-Steuerung' },
    { id: 'editor', label: 'Editor', help: 'Rundowns bearbeiten' },
    { id: 'admin', label: 'Rundown-Admin', help: 'alles im Modul, inkl. Freigaben für Gäste (ohne Benutzerverwaltung)' },
  ],
  // Ziel der Kachel; leer = Modul ist noch nicht verfügbar („Bald“)
  url: process.env.RUNDOWN_URL || '',
};
