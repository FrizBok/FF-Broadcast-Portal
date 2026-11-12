import { h, icon, toast, fill, menu, themeToggle, copyText, confirmDialog } from './ui.js';
import { get, post, patch, initials } from './api.js';
import { qrSvg } from './qr.js';
import { usersPage } from './users.js';
import { systemPage } from './system.js';

export const S = { user: null, status: null, modules: [] };
const root = document.body.appendChild(document.createElement('div'));
root.id = 'app';
const ROLE_LABEL = { admin: 'Admin', user: 'Mitglied', guest: 'Gast', owner: 'Super-Admin' };
export const roleName = (u) => u.owner ? 'Super-Admin' : u.role === 'admin' ? 'Admin' : u.kind === 'guest' ? 'Gast' : 'Mitglied';
export const roleClass = (u) => u.owner ? 'role-owner' : u.role === 'admin' ? 'role-admin' : u.kind === 'guest' ? 'role-guest' : 'role-user';

/* ------------------------------------------------------------ Bausteine */
const brand = () => h('div', { class: 'brand' },
  h('span', { class: 'brand-mark' }, icon('radio')),
  h('span', { class: 'brand-name' }, h('b', null, 'Frankenfinals'), h('span', null, 'Broadcast')));

const field = (label, input, hint) => h('label', { class: 'field' }, h('span', null, label), input, hint ? h('small', { class: 'hint' }, hint) : null);
const input = (props) => h('input', { class: 'input', ...props });

/** Formular mit Fehlerzeile; fn bekommt das Form-Element */
function form(children, onSubmit, submitLabel, { full = true } = {}) {
  const err = h('div', { class: 'form-error' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, submitLabel);
  const f = h('form', { novalidate: true }, children, err, btn);
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true;
    try { await onSubmit(f); } catch (ex) { err.textContent = ex.message; } finally { btn.disabled = false; }
  });
  return f;
}
const val = (f, name) => f.elements[name].value;

function authScreen(...kids) {
  fill(root, h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' }, brand(), ...kids)));
  root.querySelector('input')?.focus();
}

/* ------------------------------------------------------------ Anmelde-Bildschirme */
function loginScreen(msg) {
  const f = form([
    field('E-Mail', input({ name: 'email', type: 'email', autocomplete: 'username', required: true })),
    field('Passwort', input({ name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
  ], async (fm) => {
    const r = await post('/api/auth/login', { email: val(fm, 'email'), password: val(fm, 'password') });
    if (r.need2fa) return twofaScreen(r.ticket);
    await start();
  }, 'Anmelden');
  authScreen(h('p', null, msg || 'Bitte melde dich an.'), f,
    h('div', { class: 'links' }, h('button', { type: 'button', onclick: forgotScreen }, 'Passwort vergessen?')));
}

function twofaScreen(ticket) {
  const f = form([
    field('Code aus der Authenticator-App', input({ name: 'code', class: 'input code-input', inputmode: 'text', autocomplete: 'one-time-code', required: true, placeholder: '123 456' }),
      'Oder einen deiner Wiederherstellungs-Codes eingeben.'),
  ], async (fm) => { await post('/api/auth/2fa', { ticket, code: val(fm, 'code') }); await start(); }, 'Bestätigen');
  authScreen(h('p', null, 'Zwei-Faktor-Anmeldung'), f, h('div', { class: 'links' }, h('button', { type: 'button', onclick: () => loginScreen() }, 'Zurück')));
}

function forgotScreen() {
  const box = h('div');
  const f = form([field('E-Mail', input({ name: 'email', type: 'email', required: true }))], async (fm) => {
    const r = await post('/api/auth/forgot', { email: val(fm, 'email') });
    fill(box, h('div', { class: 'ok-box' }, r.message));
  }, 'Link anfordern');
  authScreen(h('p', null, 'Wir schicken dir einen Link zum Zurücksetzen.'), box, f,
    h('div', { class: 'links' }, h('button', { type: 'button', onclick: () => loginScreen() }, 'Zurück zur Anmeldung')));
  if (!S.status?.mail) fill(box, h('div', { class: 'hint warn' }, 'Der Mailversand ist nicht eingerichtet. Bitte einen Admin um einen Reset-Link bitten.'));
}

async function resetScreen(token) {
  let info;
  try { info = await get('/api/auth/reset/' + encodeURIComponent(token)); }
  catch (e) { return authScreen(h('p', null, e.message), h('div', { class: 'links' }, h('button', { onclick: () => { location.hash = ''; loginScreen(); } }, 'Zur Anmeldung'))); }
  const invite = info.purpose === 'invite';
  const f = form([
    field('E-Mail', input({ value: info.email, disabled: true })),
    field('Neues Passwort', input({ name: 'password', type: 'password', autocomplete: 'new-password', required: true, minlength: 10 }), 'Mindestens 10 Zeichen.'),
    field('Passwort wiederholen', input({ name: 'again', type: 'password', autocomplete: 'new-password', required: true })),
  ], async (fm) => {
    if (val(fm, 'password') !== val(fm, 'again')) throw new Error('Die Passwörter stimmen nicht überein');
    await post('/api/auth/reset/' + encodeURIComponent(token), { password: val(fm, 'password') });
    location.hash = '';
    loginScreen('Passwort gespeichert – jetzt kannst du dich anmelden.');
  }, invite ? 'Konto aktivieren' : 'Passwort speichern');
  authScreen(h('p', null, invite ? `Willkommen${info.name ? ', ' + info.name : ''}! Lege dein Passwort fest.` : 'Lege ein neues Passwort fest.'), f);
}

function setupScreen() {
  const f = form([
    field('Dein Name', input({ name: 'name', autocomplete: 'name' })),
    field('E-Mail', input({ name: 'email', type: 'email', autocomplete: 'username', required: true })),
    field('Passwort', input({ name: 'password', type: 'password', autocomplete: 'new-password', required: true, minlength: 10 }), 'Mindestens 10 Zeichen.'),
    S.status.setupToken ? field('Einrichtungs-Schlüssel', input({ name: 'setup_token', type: 'password', required: true }), 'Steht in der Umgebungsvariable SETUP_TOKEN des Servers.') : null,
  ], async (fm) => {
    await post('/api/auth/setup', { name: val(fm, 'name'), email: val(fm, 'email'), password: val(fm, 'password'), setup_token: S.status.setupToken ? val(fm, 'setup_token') : undefined });
    await start();
  }, 'Portal einrichten');
  authScreen(h('p', null, 'Erste Einrichtung: Dieses Konto wird Super-Admin.'), f);
}

function mustChangeScreen() {
  const f = form([
    field('Neues Passwort', input({ name: 'password', type: 'password', autocomplete: 'new-password', required: true, minlength: 10 }), 'Mindestens 10 Zeichen, nicht das temporäre.'),
    field('Wiederholen', input({ name: 'again', type: 'password', autocomplete: 'new-password', required: true })),
  ], async (fm) => {
    if (val(fm, 'password') !== val(fm, 'again')) throw new Error('Die Passwörter stimmen nicht überein');
    await post('/api/auth/initial-password', { password: val(fm, 'password') });
    await start();
  }, 'Passwort speichern');
  authScreen(h('p', null, 'Bitte wähle jetzt ein eigenes Passwort.'), f, h('div', { class: 'links' }, h('button', { onclick: logout }, 'Abmelden')));
}

/* ------------------------------------------------------------ 2FA-Einrichtung (Konto und Pflicht) */
export function recoveryCodesView(codes) {
  return h('div', null,
    h('p', { class: 'hint' }, 'Bewahre diese Codes sicher auf. Jeder funktioniert nur einmal – falls du dein Handy verlierst.'),
    h('div', { class: 'codes' }, codes.map((c) => h('span', null, c))),
    h('button', { class: 'btn', type: 'button', onclick: () => copyText(codes.join('\n')) }, icon('copy'), 'Alle kopieren'));
}

async function twofaSetupView(onDone) {
  const wrap = h('div');
  let r;
  try { r = await post('/api/me/2fa/setup'); } catch (e) { fill(wrap, h('div', { class: 'form-error' }, e.message)); return wrap; }
  const qr = h('div', { class: 'qr-img', html: qrSvg(r.otpauth, { border: 0 }) });
  const f = form([field('6-stelliger Code', input({ name: 'code', class: 'input code-input', inputmode: 'numeric', autocomplete: 'one-time-code', required: true, placeholder: '123 456' }))], async (fm) => {
    const res = await post('/api/me/2fa/enable', { code: val(fm, 'code') });
    fill(wrap, h('div', { class: 'hint ok' }, '2FA ist jetzt aktiv.'), recoveryCodesView(res.recovery_codes),
      h('button', { class: 'btn primary', style: { marginTop: '14px' }, onclick: onDone }, 'Fertig, Codes sind gesichert'));
  }, 'Aktivieren');
  fill(wrap,
    h('div', { class: 'qr-box' }, qr, h('div', { class: 'qr-side' },
      h('p', { class: 'hint' }, 'Scanne den QR-Code mit einer Authenticator-App (z. B. Google Authenticator, Aegis, 1Password) oder gib den Schlüssel manuell ein.'),
      h('div', { class: 'secret' }, r.secret))),
    f);
  return wrap;
}

async function mustTwofaScreen() {
  const body = await twofaSetupView(start);
  authScreen(h('p', null, 'Der Super-Admin verlangt Zwei-Faktor-Anmeldung. Bitte richte sie jetzt ein.'), body,
    h('div', { class: 'links' }, h('button', { onclick: logout }, 'Abmelden')));
  document.querySelector('.auth-card').style.width = 'min(520px, 100%)';
}

/* ------------------------------------------------------------ Gerüst */
const NAV = () => [
  { href: '#/', label: 'Übersicht', icon: 'grid', match: (p) => p === '' || p === '/' },
  S.user.role === 'admin' ? { href: '#/benutzer', label: 'Benutzer', icon: 'users', match: (p) => p.startsWith('/benutzer') } : null,
  S.user.role === 'admin' ? { href: '#/system', label: 'System', icon: 'shield', match: (p) => p.startsWith('/system'), dot: S.status?.alerts > 0 } : null,
].filter(Boolean);

function shell(path, ...content) {
  const u = S.user;
  const userBtn = h('button', { class: 'user-btn', onclick: (e) => menu(e.currentTarget, [
    { label: 'Mein Konto', icon: 'user', onClick: () => { location.hash = '#/konto'; } },
    { sep: true },
    { label: 'Abmelden', icon: 'logout', onClick: logout },
  ]) },
    h('span', { class: 'avatar ' + roleClass(u), style: { width: '32px', height: '32px', fontSize: '12px' } }, initials(u)),
    h('span', { class: 'user-btn-txt' }, h('b', null, u.name || u.email), h('span', null, roleName(u))), icon('more'));
  fill(root,
    h('header', { class: 'topbar' },
      h('a', { href: '#/' }, brand()),
      h('nav', { class: 'nav' }, NAV().map((n) => h('a', { href: n.href, class: n.match(path) ? 'active' : '' }, icon(n.icon), n.label, n.dot ? h('span', { class: 'dot' }) : null))),
      h('div', { class: 'spacer' }), themeToggle(), userBtn),
    h('main', { class: 'page' }, ...content));
}

/* ------------------------------------------------------------ Startseite */
async function homePage() {
  const u = S.user;
  const list = h('div');
  shell('/', h('div', { class: 'page-head' }, h('span', { class: 'label' }, 'WILLKOMMEN'), h('h1', null, u.name ? `Hallo ${u.name.split(' ')[0]}` : 'Übersicht'),
    h('p', { class: 'sub' }, 'Deine Module bei FrankenFinals Broadcast.')), list);
  let mods = [];
  try { mods = await get('/api/modules'); } catch (e) { return fill(list, h('div', { class: 'empty' }, e.message)); }
  S.modules = mods;
  if (!mods.length) {
    return fill(list, h('div', { class: 'empty' }, h('b', null, 'Noch keine Module'),
      u.role === 'admin' ? 'Weise Benutzern unter „Benutzer“ Module zu.' : 'Dir wurde noch kein Modul freigegeben. Frag einen Admin.'));
  }
  fill(list, h('div', { class: 'mod-grid' }, mods.map((m) => modCard(m))));
}

function modCard(m, { admin = false } = {}) {
  const ready = m.available !== false && m.href;
  const tag = ready ? 'a' : 'div';
  const roleLabel = m.roles?.find((r) => r.id === m.my_role)?.label;
  return h(tag, { class: 'mod-card' + (ready ? '' : ' off') + (admin ? ' admin' : ''), href: ready ? m.href : null },
    h('div', { class: 'mod-top' }, h('span', { class: 'mod-ico' }, icon(m.icon || 'stack')),
      ready ? null : h('span', { class: 'chip' }, 'Bald')),
    h('h3', null, m.name), h('p', null, m.description || ''),
    h('div', { class: 'mod-foot' }, roleLabel ? h('span', { class: 'role-badge role-' + m.my_role }, roleLabel) : null,
      ready ? h('span', { class: 'mod-go' }, icon('external')) : null));
}

/* ------------------------------------------------------------ Mein Konto */
async function accountPage() {
  const u = S.user;
  let tf;
  try { tf = await get('/api/me/2fa'); } catch { tf = { enabled: u.totp_enabled, policy: 'optional', recovery_left: 0 }; }
  const nameF = form([field('Name', input({ name: 'name', value: u.name || '' })), field('E-Mail', input({ value: u.email, disabled: true }), 'Die E-Mail-Adresse ändert ein Admin.')],
    async (fm) => { const r = await patch('/api/me', { name: val(fm, 'name') }); S.user = r.user; toast('Gespeichert', 'ok'); render(); }, 'Speichern');
  const pwF = form([
    field('Aktuelles Passwort', input({ name: 'current', type: 'password', autocomplete: 'current-password', required: true })),
    field('Neues Passwort', input({ name: 'password', type: 'password', autocomplete: 'new-password', required: true, minlength: 10 }), 'Mindestens 10 Zeichen.'),
  ], async (fm) => { await post('/api/auth/password', { current: val(fm, 'current'), password: val(fm, 'password') }); fm.reset(); toast('Passwort geändert', 'ok'); }, 'Passwort ändern');

  const tfBox = h('div');
  const paintTf = async () => {
    const info = await get('/api/me/2fa').catch(() => tf);
    S.user.totp_enabled = info.enabled;
    if (!info.enabled) {
      fill(tfBox, h('p', { class: 'hint' }, 'Schützt dein Konto zusätzlich mit einem Code aus einer Authenticator-App.'),
        h('button', { class: 'btn primary', onclick: async () => fill(tfBox, await twofaSetupView(paintTf)) }, icon('shield'), '2FA einrichten'));
      return;
    }
    const locked = info.policy === 'required';
    fill(tfBox,
      h('div', { class: 'row' }, h('span', { class: 'chip green' }, icon('check'), 'Aktiv'), h('span', { class: 'hint' }, `${info.recovery_left} Wiederherstellungs-Codes übrig`)),
      locked ? h('p', { class: 'hint', style: { marginTop: '12px' } }, 'Der Super-Admin hat 2FA für alle verpflichtend gemacht – sie kann nicht abgeschaltet werden.') : null,
      h('div', { class: 'row', style: { marginTop: '14px' } },
        h('button', { class: 'btn', onclick: recoveryDialog }, icon('key'), 'Neue Wiederherstellungs-Codes'),
        locked ? null : h('button', { class: 'btn red', onclick: disableDialog }, 'Ausschalten')));
  };
  const recoveryDialog = async () => {
    const { formModal, modal } = await import('./ui.js');
    formModal({ title: 'Neue Wiederherstellungs-Codes', submitLabel: 'Erzeugen', fields: [{ name: 'password', label: 'Passwort zur Bestätigung', type: 'password', required: true, autocomplete: 'current-password' }],
      onSubmit: async (v) => { const r = await post('/api/me/2fa/recovery', { password: v.password }); modal({ title: 'Deine neuen Codes', body: recoveryCodesView(r.recovery_codes), actions: [{ label: 'Fertig', class: 'primary' }] }); paintTf(); } });
  };
  const disableDialog = async () => {
    const { formModal } = await import('./ui.js');
    formModal({ title: '2FA ausschalten', submitLabel: 'Ausschalten', fields: [
      { name: 'password', label: 'Passwort', type: 'password', required: true, autocomplete: 'current-password' },
      { name: 'code', label: 'Aktueller Code aus der App', required: true, autocomplete: 'one-time-code' }],
    onSubmit: async (v) => { await post('/api/me/2fa/disable', v); toast('2FA ausgeschaltet', 'ok'); paintTf(); } });
  };
  shell('/konto', h('div', { class: 'page-narrow', style: { margin: '0 auto' } },
    h('div', { class: 'page-head' }, h('span', { class: 'label' }, 'KONTO'), h('h1', null, 'Mein Konto'),
      h('p', { class: 'sub' }, h('span', { class: 'role-badge ' + roleClass(u) }, roleName(u)), u.expires_at ? ` · Zugang bis ${new Date(u.expires_at).toLocaleDateString('de-DE')}` : '')),
    h('div', { class: 'card card-pad' }, h('h3', null, 'Profil'), nameF),
    h('div', { class: 'card card-pad' }, h('h3', null, 'Passwort'), pwF),
    h('div', { class: 'card card-pad' }, h('h3', null, 'Zwei-Faktor-Anmeldung'), tfBox)));
  paintTf();
}

/* ------------------------------------------------------------ Router */
export const ctx = { shell, field, input, form, val, modCard, roleName, roleClass };

async function render() {
  const hash = location.hash.replace(/^#/, '');
  const resetM = hash.match(/^\/reset\/(.+)$/);
  if (!S.user) {
    if (S.status?.needsSetup) return setupScreen();
    if (resetM) return resetScreen(resetM[1]);
    return loginScreen();
  }
  if (S.user.must_change) return mustChangeScreen();
  if (S.user.must_2fa && !S.user.totp_enabled) return mustTwofaScreen();
  const path = hash || '/';
  const admin = S.user.role === 'admin';
  if (path === '/konto') return accountPage();
  if (admin && path.startsWith('/benutzer')) return usersPage(ctx);
  if (admin && path.startsWith('/system')) return systemPage(ctx, path.split('/')[2] || 'mail');
  return homePage();
}

async function logout() {
  try { await post('/api/auth/logout'); } catch { /* */ }
  S.user = null; location.hash = ''; await start();
}

async function start() {
  try { S.status = await get('/api/auth/status'); S.user = S.status.user; }
  catch (e) { return authScreen(h('p', null, e.message)); }
  render();
}

window.addEventListener('hashchange', () => { document.querySelector('.pop')?.remove(); render(); });
window.addEventListener('ffp:logout', () => { if (S.user) { S.user = null; start(); } });
start();
