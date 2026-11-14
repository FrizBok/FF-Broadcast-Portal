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

## Module als eigener Dienst (Single Sign-on)

Läuft ein Modul als eigenes Programm (z. B. die Overlay Engine, Repo `Intracy/FF-Overlay`), meldet sich niemand dort
separat an. Stattdessen:

```js
export const manifest = { id: 'overlay', …, url: process.env.OVERLAY_URL || '', sso: true };
```

- Die Kachel verlinkt dann auf `/sso/<id>`. Das Portal prüft Anmeldung und Modulrecht und leitet weiter zu
  `<url>/auth/portal?ticket=…`.
- Das Ticket ist 60 Sekunden gültig, enthält `sub, email, name, role, platform_admin, aud, exp, jti` und ist mit
  HMAC-SHA256 signiert (`server/sso.js`). Schlüssel: Umgebungsvariable `<ID>_SSO_SECRET` (mind. 32 Zeichen), im Modul
  identisch hinterlegt.
- Das Modul prüft Signatur, `aud`, Ablauf und dass `jti` nur einmal benutzt wird, und öffnet eine eigene Sitzung mit der
  Rolle. Rechte prüft das Modul selbst.
- Fehlt Adresse oder Schlüssel, zeigt die Kachel „Bald“. Ohne Recht gibt `/sso/<id>` „Kein Zugriff“ zurück; beides
  landet im Protokoll (`module_open`, `module_denied`).
