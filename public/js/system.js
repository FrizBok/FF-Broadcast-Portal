import { h, icon, toast, fill, modal, confirmDialog, copyText, confirmTyped } from './ui.js';
import { get, post, put, del, fmtDateTime } from './api.js';
import { S } from './app.js';

const TABS = [['mail', 'E-Mail-Versand', 'send'], ['sicherheit', 'Sicherheit', 'shield'], ['protokoll', 'Protokoll', 'list'], ['backups', 'Backups', 'database']];

export async function systemPage(ctx, tab) {
  if (!TABS.some((t) => t[0] === tab)) tab = 'mail';
  const body = h('div');
  ctx.shell('/system',
    h('div', { class: 'page-head' }, h('span', { class: 'label' }, 'VERWALTUNG'), h('h1', null, 'System')),
    h('nav', { class: 'tabs' }, TABS.map(([id, l, ic]) => h('a', { href: '#/system/' + id, class: id === tab ? 'active' : '' }, icon(ic), l))),
    body);
  try { await ({ mail: mailTab, sicherheit: securityTab, protokoll: logTab, backups: backupTab })[tab](ctx, body); }
  catch (e) { fill(body, h('div', { class: 'empty' }, e.message)); }
}

const row = (label, el, hint) => h('label', { class: 'field' }, h('span', null, label), el, hint ? h('small', { class: 'hint' }, hint) : null);

async function mailTab(ctx, body) {
  const c = await get('/api/system/mail');
  const lock = c.env;
  const i = (v, extra = {}) => h('input', { class: 'input', value: v ?? '', disabled: lock, ...extra });
  const host = i(c.host, { placeholder: 'smtp.example.de' }), port = i(c.port, { type: 'number' }), user = i(c.user, { autocomplete: 'off' });
  const pass = i('', { type: 'password', autocomplete: 'new-password', placeholder: c.has_pass ? '•••••••• (gespeichert)' : '' });
  const secure = h('select', { class: 'input', disabled: lock }, [['starttls', 'STARTTLS (Port 587)'], ['ssl', 'SSL/TLS (Port 465)'], ['none', 'Unverschlüsselt']].map(([v, l]) => h('option', { value: v, selected: c.secure === v }, l)));
  const fromEmail = i(c.from_email, { type: 'email' }), fromName = i(c.from_name, { placeholder: 'FrankenFinals Broadcast' }), appUrl = i(c.app_url, { placeholder: 'https://broadcast.example.de' });
  const pw = h('input', { type: 'checkbox', checked: c.notify?.password !== false });
  const err = h('div', { class: 'form-error' });
  const save = async () => {
    err.textContent = '';
    try {
      await put('/api/system/mail', { host: host.value, port: port.value, secure: secure.value, user: user.value, pass: pass.value || undefined, from_email: fromEmail.value, from_name: fromName.value, app_url: appUrl.value, notify: { password: pw.checked } });
      toast('Gespeichert', 'ok'); mailTab(ctx, body);
    } catch (e) { err.textContent = e.message; }
  };
  const test = async () => {
    err.textContent = '';
    try { const r = await post('/api/system/mail/test', {}); toast('Testmail an ' + r.to + ' gesendet', 'ok'); } catch (e) { err.textContent = e.message; }
  };
  fill(body, h('div', { class: 'page-narrow card card-pad', style: { margin: '0' } },
    h('h3', null, 'SMTP-Zugang'),
    h('span', { class: 'hint' }, 'Wird für Einladungen und „Passwort vergessen“ gebraucht. ' + (c.enabled ? 'Der Versand ist eingerichtet.' : 'Noch nicht eingerichtet – ohne Mail gibt es Links nur zum Kopieren.')),
    lock ? h('p', { class: 'hint warn' }, 'Die Einstellungen sind per Umgebungsvariablen (SMTP_HOST …) festgelegt und hier nicht änderbar.') : null,
    h('div', { class: 'form-grid' }, row('Server', host), row('Port', port), row('Verschlüsselung', secure), row('Benutzername', user), row('Passwort', pass), row('Absender-Adresse', fromEmail), row('Absender-Name', fromName), row('Adresse der App', appUrl, 'Wird in Links der E-Mails verwendet.')),
    h('label', { class: 'switch', style: { margin: '6px 0 14px' } }, pw, h('span', null, 'Bei Passwortänderungen den Super-Admin benachrichtigen')),
    err,
    h('div', { class: 'row' }, lock ? null : h('button', { class: 'btn primary', onclick: save }, 'Speichern'), h('button', { class: 'btn', onclick: test }, icon('send'), 'Testmail an mich'))));
}

async function securityTab(ctx, body) {
  const s = await get('/api/system/security');
  const owner = S.user.owner;
  const sw = h('input', { type: 'checkbox', checked: s.twofa_policy === 'required', disabled: !owner || (!S.user.totp_enabled && s.twofa_policy !== 'required') });
  sw.addEventListener('change', async () => {
    try { await put('/api/system/security', { twofa_policy: sw.checked ? 'required' : 'optional' }); toast('Gespeichert', 'ok'); securityTab(ctx, body); }
    catch (e) { sw.checked = !sw.checked; toast(e.message, 'err'); }
  });
  fill(body, h('div', { class: 'page-narrow card card-pad', style: { margin: '0' } },
    h('h3', null, 'Zwei-Faktor-Anmeldung'),
    h('div', { class: 'setting-row' },
      h('div', { class: 'txt' }, h('b', null, '2FA für alle verpflichtend'),
        h('span', { class: 'hint' }, 'Ist die Pflicht aus, entscheidet jeder selbst. Ist sie an, müssen alle 2FA einrichten und können sie nicht abschalten.' + (owner ? '' : ' Das ändert nur der Super-Admin.')),
        owner && !S.user.totp_enabled && s.twofa_policy !== 'required' ? h('div', { class: 'hint warn', style: { marginTop: '6px' } }, 'Richte zuerst selbst 2FA ein (', h('a', { href: '#/konto', style: { color: 'inherit', textDecoration: 'underline' } }, 'Mein Konto'), '), dann lässt sich die Pflicht einschalten.') : null),
      h('label', { class: 'switch' }, sw)),
    h('p', { class: 'hint' }, `${s.users_with_2fa} von ${s.users_active} aktiven Konten nutzen 2FA.`)));
}

const KIND = { setup: 'Einrichtung', login: 'Anmeldung', login_fail: 'Anmeldung fehlgeschlagen', login_2fa_fail: '2FA-Code falsch', forgot: 'Passwort vergessen', reset_used: 'Passwort zurückgesetzt', invite_accepted: 'Einladung angenommen', twofa_enabled: '2FA eingeschaltet', twofa_disabled: '2FA ausgeschaltet', twofa_reset: '2FA zurückgesetzt', recovery_used: 'Wiederherstellungs-Code benutzt', recovery_new: 'Neue Wiederherstellungs-Codes', user_created: 'Konto angelegt', user_invited: 'Konto eingeladen', user_deleted: 'Konto gelöscht', user_updated: 'Konto geändert', module_access: 'Modul-Rechte geändert', password_self: 'Passwort geändert', password_admin: 'Passwort gesetzt (Admin)', reset_link: 'Link erzeugt', owner: 'Super-Admin übertragen', mail_sent: 'Mail gesendet', mail_failed: 'Mail fehlgeschlagen', backup_manual: 'Backup erstellt', backup_upload: 'Backup hochgeladen', backup_restored: 'Backup zurückgespielt', announcement_created: 'Ankündigung erstellt', announcement_deleted: 'Ankündigung gelöscht', group_saved: 'Gruppe gespeichert', group_deleted: 'Gruppe gelöscht', backup_delete: 'Backup gelöscht', backup_failed: 'Backup fehlgeschlagen', mail_settings: 'Mail-Einstellungen', policy_changed: '2FA-Regel geändert' };

const DL = { ua: 'Gerät', known: 'Konto bekannt', reason: 'Grund', kind: 'Art', role: 'Rolle', active: 'Aktiv', modules: 'Module', before: 'Vorher', after: 'Nachher', hours: 'Gültig (Std.)', mailed: 'Per Mail', recipients: 'Empfänger', mail: 'Per Mail', members: 'Mitglieder', twofa_policy: '2FA-Regel', subject: 'Betreff', error: 'Fehler', left: 'Codes übrig', host: 'Server', port: 'Port', user: 'Benutzer', from: 'Absender', app_url: 'App-Adresse', expires_at: 'Ablauf', name: 'Name', email: 'E-Mail', initial: 'Erstes Passwort', safety: 'Sicherung davor', size: 'Größe', groups: 'Gruppen', recovery: 'Wiederherstellungs-Code', twofa: '2FA', tpl: 'Vorlage', secure: 'Verschlüsselung' };
const DV = { member: 'Mitglied', guest: 'Gast', admin: 'Admin', user: 'Mitglied', required: 'Pflicht', optional: 'freiwillig' };
function fmtVal(k, v) {
  if (v === true || v === 1) return k === 'active' ? 'ja' : 'ja';
  if (v === false || v === 0) return 'nein';
  if (v == null || v === '') return '–';
  if (k === 'expires_at' && typeof v === 'number') return new Date(v).toLocaleDateString('de-DE');
  if (typeof v === 'object') { const e = Object.entries(v); return e.length ? e.map(([a, b]) => `${a}: ${b}`).join(', ') : 'keine'; }
  return DV[v] || String(v);
}
const fmtDetail = (d) => Object.entries(d).filter(([, v]) => v !== undefined).map(([k, v]) => `${DL[k] || k}: ${fmtVal(k, v)}`).join(' · ');

async function logTab(ctx, body) {
  let cat = '', q = '';
  const tbody = h('tbody'), more = h('button', { class: 'btn ghost', style: { display: 'none', margin: '12px auto' } }, 'Ältere laden');
  let last = 0;
  const load = async (append) => {
    const r = await get(`/api/system/audit?cat=${cat}&q=${encodeURIComponent(q)}${append && last ? '&before=' + last : ''}`);
    const rows = r.entries.map((e) => h('tr', { class: e.ok ? '' : 'bad' }, h('td', { class: 't' }, fmtDateTime(e.at)),
      h('td', null, KIND[e.kind] || e.kind, e.detail && Object.keys(e.detail).length ? h('small', null, fmtDetail(e.detail).slice(0, 200)) : null),
      h('td', null, e.actor || '–', e.target ? h('small', null, '→ ' + e.target) : null), h('td', { class: 't' }, e.ip || '')));
    if (!append) tbody.replaceChildren();
    tbody.append(...rows);
    if (!append && !rows.length) tbody.append(h('tr', null, h('td', { colspan: 4, class: 'hint' }, 'Keine Einträge.')));
    if (r.entries.length) last = r.entries[r.entries.length - 1].id;
    more.style.display = r.more ? '' : 'none';
  };
  more.onclick = () => load(true);
  const sel = h('select', { class: 'input', style: { width: 'auto' }, onchange: (e) => { cat = e.target.value; load(false); } }, [['', 'Alle'], ['auth', 'Anmeldung'], ['konto', 'Konten'], ['mail', 'Mail'], ['system', 'System']].map(([v, l]) => h('option', { value: v }, l)));
  const search = h('input', { class: 'input', placeholder: 'Suchen …', style: { maxWidth: '260px' }, onchange: (e) => { q = e.target.value; load(false); } });
  fill(body, h('div', { class: 'u-tools' }, sel, search),
    h('div', { class: 'table-wrap' }, h('table', { class: 'log-table' }, h('thead', null, h('tr', null, ['Zeit', 'Ereignis', 'Wer', 'IP'].map((t) => h('th', null, t)))), tbody)), more);
  await load(false);
}

const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

const KIND_LABEL = { auto: 'automatisch', manual: 'manuell', upload: 'hochgeladen' };

async function restoreBackup(b) {
  const ok = await confirmTyped({
    title: 'Backup zurückspielen', word: 'ZURÜCK', okLabel: 'Zurückspielen',
    headline: `Der Stand vom ${fmtDateTime(b.at)} ersetzt alle aktuellen Daten.`,
    intro: 'Vorher wird automatisch eine Sicherung des jetzigen Stands angelegt („vor-wiederherstellung“) – damit lässt sich das wieder umkehren.',
    points: ['Benutzer, Passwörter, 2FA, Modul-Rechte, Gruppen, Ankündigungen und Einstellungen werden ersetzt.',
      'Konten, die es damals noch nicht gab, sind danach weg – auch ihre Anmeldungen.', 'Das Protokoll bleibt vollständig erhalten.'],
  });
  if (!ok) return;
  try {
    const r = await post(`/api/system/backups/${encodeURIComponent(b.name)}/restore`, {});
    toast(`Zurückgespielt (${r.users} Konten). Seite wird neu geladen …`, 'ok');
    setTimeout(() => location.reload(), 1500);
  } catch (e) { toast(e.message, 'err'); }
}

async function uploadBackup(file, reload) {
  if (!file) return;
  try {
    const r = await fetch('/api/system/backups/upload?name=' + encodeURIComponent(file.name.replace(/\.db$/i, '')), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file, credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Hochladen fehlgeschlagen');
    toast('Hochgeladen – jetzt kannst du es zurückspielen', 'ok');
    reload();
  } catch (e) { toast(e.message, 'err'); }
}

async function backupTab(ctx, body) {
  const r = await get('/api/system/backups');
  const owner = S.user.owner;
  const reload = () => backupTab(ctx, body);
  const err = h('div', { class: 'form-error' });
  const create = async () => { try { await post('/api/system/backups', {}); toast('Backup erstellt', 'ok'); reload(); } catch (e) { err.textContent = e.message; } };
  const file = h('input', { type: 'file', accept: '.db,application/octet-stream', style: { display: 'none' }, onchange: (e) => uploadBackup(e.target.files[0], reload) });
  fill(body,
    h('div', { class: 'row', style: { marginBottom: '8px' } },
      h('div', { class: 'spacer' }),
      owner ? h('button', { class: 'btn', onclick: () => file.click() }, icon('upload'), 'Backup hochladen') : null, file,
      h('button', { class: 'btn primary', onclick: create }, icon('database'), 'Backup jetzt erstellen')),
    h('p', { class: 'hint', style: { margin: '0 0 14px' } }, (r.settings.enabled ? `Automatisch alle ${r.settings.interval_hours} Stunden, die letzten ${r.settings.keep} bleiben erhalten. Manuelle und hochgeladene Sicherungen werden nie automatisch gelöscht.` : 'Automatische Sicherungen sind ausgeschaltet.')
      + (owner ? ' Mit ↺ spielst du eine Sicherung zurück; vorher wird der aktuelle Stand gesichert.' : ' Zurückspielen und Hochladen darf nur der Super-Admin.')),
    err,
    r.backups.length ? h('div', { class: 'u-list' }, r.backups.map((b) => h('div', { class: 'u-row', style: { gridTemplateColumns: 'minmax(0,1fr) auto auto auto' } },
      h('div', { class: 'u-who' }, h('b', null, b.name), h('span', null, fmtDateTime(b.at))),
      h('span', { class: 'chip ' + (b.kind === 'auto' ? '' : b.kind === 'upload' ? 'amber' : 'accent') }, KIND_LABEL[b.kind] || b.kind), h('span', { class: 'hint' }, fmtSize(b.size)),
      h('div', { class: 'u-actions' },
        owner ? h('button', { class: 'icon-btn', title: 'Zurückspielen', onclick: () => restoreBackup(b) }, icon('rotate')) : null,
        h('a', { class: 'icon-btn', href: '/api/system/backups/' + encodeURIComponent(b.name), title: 'Herunterladen' }, icon('download')),
        h('button', { class: 'icon-btn', title: 'Löschen', onclick: async () => { if (await confirmDialog(`${b.name} löschen?`)) { try { await del('/api/system/backups/' + encodeURIComponent(b.name)); reload(); } catch (e) { toast(e.message, 'err'); } } } }, icon('trash')))))) : h('div', { class: 'empty' }, h('b', null, 'Noch keine Backups'), 'Erstelle das erste mit dem Knopf oben.'));
}
