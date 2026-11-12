// Modul „Overlay Engine“ – Grafiken und Einblendungen für den Livestream.
//
// Noch in Planung: Die Kachel zeigt „Bald“, bis OVERLAY_URL gesetzt ist oder das Modul ins Portal einzieht.
// Die Rollen sind ein erster Vorschlag und können sich noch ändern.

export const manifest = {
  id: 'overlay',
  name: 'Overlay Engine',
  description: 'Grafiken und Einblendungen für den Livestream.',
  order: 20, // Position der Kachel
  icon: 'layers',
  roles: [
    { id: 'operator', label: 'Operator', help: 'Overlays live ein- und ausblenden' },
    { id: 'editor', label: 'Editor', help: 'Grafiken und Vorlagen bearbeiten' },
    { id: 'admin', label: 'Overlay-Admin', help: 'alles im Modul (ohne Benutzerverwaltung)' },
  ],
  url: process.env.OVERLAY_URL || '',
};
