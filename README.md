# FrankenFinals Broadcast – Portal

Zentrale Plattform für FrankenFinals: Anmeldung, Mitglieder- und Gastverwaltung und eine Übersicht mit Modulen
(z. B. **FF Rundown**). Konten legt nur ein Admin an. Keine Abhängigkeiten – nur Node.js (≥ 22.13) mit eingebautem SQLite.

## Starten

```sh
npm start                 # http://localhost:3000
npm test                  # Ende-zu-Ende-Tests der API
```

Beim ersten Aufruf legst du das Super-Admin-Konto an. Konfiguration über Umgebungsvariablen (siehe `.env.example`):
`PORT`, `DATA_DIR`, `APP_URL`, `SETUP_TOKEN`, `RUNDOWN_URL`, `SMTP_*` …
Mit Docker: `docker compose up -d` (Daten im Volume `/data`).

## Konzept

- **Plattform-Rollen:** Super-Admin (genau einer), Plattform-Admin (Benutzer, Modulrechte, System; volle Rechte in jedem Modul), Mitglied, Externer Gast (befristbar).
- **Modul-Rechte:** pro Modul eigene Rollen; kein Eintrag = Modul unsichtbar.
- **Anmeldung:** E-Mail + Passwort (min. 10 Zeichen), optional/verpflichtend 2FA (TOTP, Wiederherstellungs-Codes), Passwort vergessen per SMTP, Einladungs-Links.
- **Ankündigungen:** Admins schreiben Nachrichten an alle, an Gruppen (fest oder selbst angelegt) oder einzelne Personen – als Info-Kasten auf der Startseite und optional per E-Mail.
- **System:** SMTP-Einstellungen, 2FA-Pflicht (nur Super-Admin), Protokoll, Datenbank-Backups (erstellen, hochladen, zurückspielen – nur Super-Admin, mit automatischer Sicherung davor).
- **Notfall:** `node server/reset-password.js --list | <email> | --admin | --owner | --link | --no2fa`.

Eigene Module: siehe [docs/modul-entwickeln.md](docs/modul-entwickeln.md).

**Overlay Engine** (eigener Dienst, Repo [Intracy/FF-Overlay](https://github.com/Intracy/FF-Overlay)): Anmeldung läuft über das Portal.
Im Portal `OVERLAY_URL` und `OVERLAY_SSO_SECRET` setzen, in der Overlay Engine `PORTAL_URL` und denselben Schlüssel als `PORTAL_SSO_SECRET`.
Rollen: Operator (live steuern), Editor (gestalten), Overlay-Admin (Verbindungen, Projekte, Einstellungen).

**FF Rundown** (eigener Dienst, Repo [Intracy/FF-Rundown](https://github.com/Intracy/FF-Rundown), läuft auch allein): Im Portal `RUNDOWN_URL` und
`RUNDOWN_SSO_SECRET` setzen, im Rundown `PORTAL_URL` und denselben Schlüssel als `PORTAL_SSO_SECRET`. Konten entstehen im Rundown beim ersten
Öffnen über die Kachel (bestehende Konten werden über die E-Mail verknüpft), Gäste aus dem Portal sind dort „extern“.
Ohne Schlüssel verlinkt die Kachel nur auf `RUNDOWN_URL`.

**Terminplanung** (eigener Dienst, Repo [FrizBok/FF-Planner](https://github.com/FrizBok/FF-Planner)): Im Portal `PLANNER_URL` und
`PLANNER_SSO_SECRET` setzen, in der Terminplanung `PORTAL_URL` und denselben Schlüssel als `PORTAL_SSO_SECRET`. Mit demselben Schlüssel
holt sie die Liste der Personen mit Zugriff (`/api/modules/planner/directory`). Rollen: Mitglied, Planer, Planer-Admin.

## Stand

Gerüst mit Oberfläche und API. Noch offen: FF Rundown als echtes Modul (bis dahin verlinkt `RUNDOWN_URL` auf die bestehende Installation).
