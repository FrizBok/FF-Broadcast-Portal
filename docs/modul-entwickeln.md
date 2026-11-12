# Ein Modul entwickeln

Ein Modul ist ein Ordner `server/modules/<id>/index.js`. Er wird beim Start automatisch geladen.

```js
export const manifest = {
  id: 'beispiel',                 // gleich dem Ordnernamen, nur a-z0-9-
  name: 'Beispiel',
  description: 'Kurzbeschreibung für die Kachel',
  icon: 'stack',                  // Icon-Name aus public/js/ui.js
  order: 30,                      // Position der Kachel (kleiner = weiter vorn, Standard 100)
  roles: [                        // aufsteigend: letzte Rolle = höchste
    { id: 'viewer', label: 'Zuschauer', help: 'Darf ansehen' },
    { id: 'admin',  label: 'Beispiel-Admin', help: 'Darf alles im Modul' },
  ],
  url: '',                        // externe Adresse der Kachel, oder
  path: '/m/beispiel',            // Pfad innerhalb des Portals
};

// optional: eigene API unter /api/m/<id>/…
export function register(api) {
  api.get('/daten', (req) => ({ rolle: 'ok' }));
  api.post('/aendern', api.requireRole('admin'), (req) => { /* … */ return { ok: true }; });
}
```

Regeln:
- `api.get/post/put/patch/del` verlangen automatisch eine Anmeldung; `api.requireRole(min)` prüft die Modul-Rolle (`req.user`).
- Plattform-Admins haben automatisch die höchste Rolle jedes Moduls. Wer keinen Eintrag hat, sieht das Modul nicht.
- Ohne `url`/`path` zeigt die Kachel „Bald“ (z. B. `url: process.env.OVERLAY_URL || ''`).
- Daten des Moduls gehören in `api.DATA_DIR` (eigene Datei oder eigene Tabellen mit Präfix `<id>_`).
