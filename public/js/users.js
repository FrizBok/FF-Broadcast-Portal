import { h, icon, toast, fill, modal, confirmDialog, menu, copyText, debounce } from './ui.js';
import { get, post, put, patch, del, fmtDate, fmtDateTime, initials } from './api.js';
import { userTabs } from './announce.js';

const state = { users: [], mods: [], mail: false, q: '', filter: 'all', me: null };

function copyField(text) {
  return h('div', { class: 'copy-field' }, h('input', { class: 'input', readonly: true, value: text, onfocus: (e) => e.target.select() }),
    h('button', { class: 'btn', type: 'button', onclick: () => copyText(text) }, icon('copy'), 'Kopieren'));
}

function infoDialog(title, ...body) { modal({ title, body: h('div', null, body), actions: [{ label: 'Fertig', class: 'primary' }] }); }

/** Modul-Matrix: pro Modul eine Rolle oder „kein Zugang“ */
function matrix(current = {}) {
  const sel = {};
  const el = h('div', { class: 'matrix' }, state.mods.map((m) => {
    const s = h('select', { class: 'input' }, h('option', { value: '' }, 'Kein Zugang'),
      m.roles.map((r) => h('option', { value: r.id, selected: current[m.id] === r.id }, r.label)));
    sel[m.id] = s;
    return h('div', { class: 'matrix-row' }, h('span', { class: 'mod-ico' }, icon(m.icon || 'stack')),
      h('div', { class: 'txt' }, h('b', null, m.name), h('span', null, m.available === false ? 'noch nicht verfügbar' : (m.description || ''))), s);
  }));
  if (!state.mods.length) fill(el, h('div', { class: 'hint' }, 'Es sind noch keine Module installiert.'));
  return { el, get: () => Object.fromEntries(Object.entries(sel).filter(([, s]) => s.value).map(([k, s]) => [k, s.value])) };
}

function userDialog(u, reload) {
  const isNew = !u;
  const self = u && u.id === state.me.id;
  const locked = u && (self || u.owner); // Rolle/Typ/Status hier nicht änderbar
  let kind = u?.kind || 'member';
  const name = h('input', { class: 'input', value: u?.name || '', autocomplete: 'off' });
  const email = h('input', { class: 'input', type: 'email', value: u?.email || '', required: true, autocomplete: 'off' });
  const role = h('select', { class: 'input' }, h('option', { value: 'user', selected: u?.role !== 'admin' }, 'Mitglied'), h('option', { value: 'admin', selected: u?.role === 'admin' }, 'Plattform-Admin'));
  const exp = h('input', { class: 'input', type: 'date', value: u?.expires_at ? new Date(u.expires_at).toISOString().slice(0, 10) : '' });
  const active = h('input', { type: 'checkbox', checked: u ? u.active : true });
  const mode = h('select', { class: 'input' }, h('option', { value: 'invite' }, 'Einladungs-Link (Person setzt Passwort selbst)'), h('option', { value: 'password' }, 'Temporäres Passwort erzeugen'));
  const mx = matrix(u?.modules);
  const kindSeg = h('div', { class: 'seg seg-wide' });
  const rowRole = h('label', { class: 'field' }, h('span', null, 'Plattform-Rolle'), role, h('small', { class: 'hint' }, 'Plattform-Admins verwalten Benutzer und System und haben in jedem Modul volle Rechte.'));
  const rowExp = h('label', { class: 'field' }, h('span', null, 'Zugang gültig bis'), exp, h('small', { class: 'hint' }, 'Leer = unbefristet. Am Ende des Tages wird das Konto gesperrt.'));
  const rowMods = h('div', null, h('div', { class: 'section-title' }, 'Modul-Rechte'), mx.el);
  const err = h('div', { class: 'form-error' });
  const paint = () => {
    fill(kindSeg, [['member', 'Mitglied'], ['guest', 'Externer Gast']].map(([k, l]) =>
      h('button', { type: 'button', class: kind === k ? 'sel' : '', style: { width: 'auto', padding: '0 14px' }, disabled: !!locked, onclick: () => { kind = k; paint(); } }, l)));
    rowRole.style.display = kind === 'member' && !locked && state.me.owner ? '' : 'none';
    rowExp.style.display = kind === 'guest' && !locked ? '' : 'none';
    rowMods.style.display = (u?.role === 'admin' && kind === 'member' && role.value === 'admin') || (u?.owner) ? 'none' : '';
  };
  role.addEventListener('change', () => { rowMods.style.display = role.value === 'admin' && kind === 'member' ? 'none' : ''; });
  paint();
  const body = h('form', { novalidate: true },
    locked ? null : h('div', { class: 'field' }, h('span', null, 'Art des Kontos'), kindSeg),
    h('div', { class: 'form-grid' }, h('label', { class: 'field' }, h('span', null, 'Name'), name), h('label', { class: 'field' }, h('span', null, 'E-Mail'), email)),
    rowRole, rowExp,
    isNew ? h('label', { class: 'field' }, h('span', null, 'Zugang einrichten'), mode) : null,
    !isNew && !locked ? h('label', { class: 'switch', style: { marginBottom: '14px' } }, active, h('span', null, 'Konto aktiv')) : null,
    u?.owner ? h('p', { class: 'hint' }, 'Der Super-Admin hat überall volle Rechte.') : rowMods,
    err);
  const m = modal({ title: isNew ? 'Benutzer anlegen' : 'Benutzer bearbeiten', body, wide: true, actions: [
    { label: 'Abbrechen', class: 'ghost' },
    { label: isNew ? 'Anlegen' : 'Speichern', class: 'primary', onClick: async () => {
      err.textContent = '';
      try {
        const asAdmin = kind === 'member' && role.value === 'admin' && state.me.owner;
        if (isNew) {
          const r = await post('/api/users', { name: name.value, email: email.value, kind, role: asAdmin ? 'admin' : 'user', expires_at: kind === 'guest' ? exp.value : '', modules: asAdmin ? {} : mx.get(), mode: mode.value });
          await reload();
          m.close();
          if (r.password) infoDialog('Konto angelegt', h('p', null, `Temporäres Passwort für ${r.user.email} – wird nur jetzt angezeigt. Beim ersten Login muss es geändert werden.`), copyField(r.password));
          else infoDialog('Konto angelegt', h('p', null, r.mailed ? `Die Einladung wurde per E-Mail an ${r.user.email} geschickt.` : `Schick ${r.user.email} diesen Link (${r.link.hours} Stunden gültig).`),
            r.mail_error ? h('p', { class: 'hint warn' }, 'Mail fehlgeschlagen: ' + r.mail_error) : null, copyField(r.link.url));
          return false;
        }
        const f = { name: name.value, email: email.value };
        if (!locked) {
          if (kind !== u.kind) f.kind = kind;
          const nr = kind === 'guest' ? 'user' : (state.me.owner ? role.value : u.role);
          if (nr !== u.role) f.role = nr;
          if (active.checked !== u.active) f.active = active.checked;
          const oldExp = u.expires_at ? new Date(u.expires_at).toISOString().slice(0, 10) : '';
          if (kind === 'guest' && (exp.value !== oldExp || kind !== u.kind)) f.expires_at = exp.value;
        }
        const r = await patch('/api/users/' + u.id, f);
        if (!u.owner && r.user.role !== 'admin') {
          const want = mx.get(), have = r.user.modules || {};
          if (JSON.stringify(Object.entries(want).sort()) !== JSON.stringify(Object.entries(have).sort())) await put('/api/users/' + u.id + '/modules', { modules: want });
        }
        toast('Gespeichert', 'ok'); await reload();
      } catch (e) { err.textContent = e.message; return false; }
    } }] });
  return m;
}

async function sendLink(u, send) {
  const r = await post(`/api/users/${u.id}/reset-link`, { hours: 24, send });
  infoDialog('Link erzeugt', h('p', null, r.mailed ? `Der Link wurde per E-Mail an ${u.email} geschickt. Du kannst ihn auch selbst weitergeben (${r.hours} Stunden gültig).` : `Gib diesen Link an ${u.email} weiter (${r.hours} Stunden gültig).`),
    r.mail_error ? h('p', { class: 'hint warn' }, 'Mail fehlgeschlagen: ' + r.mail_error) : null, copyField(r.url));
}

function rowMenu(btn, u, reload) {
  const me = state.me, self = u.id === me.id;
  const canTouch = !u.owner || self;
  const adminOnlyOwner = u.role === 'admin' && !me.owner && !self;
  menu(btn, [
    { label: 'Bearbeiten', icon: 'edit', onClick: () => userDialog(u, reload) },
    !adminOnlyOwner && canTouch ? { label: u.invite_open ? 'Einladung erneuern' : 'Passwort-Link erzeugen', icon: 'link', sub: state.mail ? 'Optional per E-Mail senden' : null, onClick: async () => {
      try { await sendLink(u, state.mail && await confirmDialog(`Link zusätzlich per E-Mail an ${u.email} schicken?`, { okLabel: 'Ja, senden', danger: false, title: 'Per E-Mail senden?' })); } catch (e) { toast(e.message, 'err'); }
    } } : null,
    !self && canTouch && !adminOnlyOwner ? { label: 'Temporäres Passwort setzen', icon: 'key', onClick: async () => {
      if (!(await confirmDialog(`Für ${u.email} ein neues temporäres Passwort setzen? Alle Geräte werden abgemeldet.`, { okLabel: 'Setzen', danger: false, title: 'Passwort setzen' }))) return;
      try { const r = await post(`/api/users/${u.id}/password`, {}); infoDialog('Neues Passwort', h('p', null, 'Wird nur jetzt angezeigt. Beim nächsten Login muss es geändert werden.'), copyField(r.password)); await reload(); } catch (e) { toast(e.message, 'err'); }
    } } : null,
    me.owner && u.totp_enabled ? { label: '2FA zurücksetzen', icon: 'shield', onClick: async () => {
      if (!(await confirmDialog(`2FA von ${u.email} zurücksetzen? Die Person muss sie neu einrichten.`, { okLabel: 'Zurücksetzen', title: '2FA zurücksetzen' }))) return;
      try { await post(`/api/users/${u.id}/reset-2fa`); toast('2FA zurückgesetzt', 'ok'); await reload(); } catch (e) { toast(e.message, 'err'); }
    } } : null,
    me.owner && !self && u.kind === 'member' && u.active ? { label: 'Zum Super-Admin machen', icon: 'user', onClick: async () => {
      if (!(await confirmDialog(`Die Super-Admin-Rolle an ${u.email} übertragen? Du bleibst Plattform-Admin.`, { okLabel: 'Übertragen', title: 'Super-Admin übertragen' }))) return;
      try { await post(`/api/users/${u.id}/owner`); toast('Übertragen', 'ok'); const s = await get('/api/auth/status'); state.me.owner = false; await reload(); location.reload(); } catch (e) { toast(e.message, 'err'); }
    } } : null,
    !self && canTouch && !adminOnlyOwner ? { sep: true } : null,
    !self && canTouch && !adminOnlyOwner ? { label: 'Löschen', icon: 'trash', onClick: async () => {
      if (!(await confirmDialog(`${u.email} endgültig löschen?`))) return;
      try { await del('/api/users/' + u.id); toast('Gelöscht', 'ok'); await reload(); } catch (e) { toast(e.message, 'err'); }
    } } : null,
  ]);
}

function userRow(u, reload) {
  const badges = [];
  badges.push(h('span', { class: 'chip ' + (u.owner ? 'accent' : u.role === 'admin' ? 'accent' : u.kind === 'guest' ? 'amber' : '') }, u.owner ? 'Super-Admin' : u.role === 'admin' ? 'Plattform-Admin' : u.kind === 'guest' ? 'Gast' : 'Mitglied'));
  if (!u.active) badges.push(h('span', { class: 'chip red' }, 'Deaktiviert'));
  else if (u.expired) badges.push(h('span', { class: 'chip red' }, 'Abgelaufen'));
  else if (u.expires_at) badges.push(h('span', { class: 'chip amber' }, icon('clock'), 'bis ' + fmtDate(u.expires_at)));
  if (u.invite_open) badges.push(h('span', { class: 'chip amber' }, 'Einladung offen'));
  if (u.totp_enabled) badges.push(h('span', { class: 'chip green' }, icon('shield'), '2FA'));
  const mods = u.role === 'admin' || u.owner ? [h('span', { class: 'chip' }, 'Alle Module · volle Rechte')]
    : state.mods.filter((m) => u.modules[m.id]).map((m) => h('span', { class: 'chip' }, m.name + ': ', m.roles.find((r) => r.id === u.modules[m.id])?.label || u.modules[m.id]));
  const more = h('button', { class: 'icon-btn', 'aria-label': 'Aktionen', onclick: (e) => rowMenu(e.currentTarget, u, reload) }, icon('more'));
  return h('div', { class: 'u-row' + (!u.active || u.expired ? ' off' : '') },
    h('span', { class: 'avatar ' + (u.owner ? 'role-owner' : u.role === 'admin' ? 'role-admin' : u.kind === 'guest' ? 'role-guest' : 'role-user') }, initials(u)),
    h('div', { class: 'u-who' }, h('b', null, u.name || u.email), h('span', null, u.name ? u.email : ''), h('span', null, 'Letzter Login: ' + (u.last_login ? fmtDateTime(u.last_login) : 'noch nie'))),
    h('div', { class: 'u-meta' }, h('div', { class: 'chips' }, badges), mods.length ? h('div', { class: 'chips' }, mods) : h('div', { class: 'hint' }, 'Keine Module freigegeben')),
    h('div', { class: 'u-actions' }, more));
}

export async function usersPage(ctx) {
  state.me = ctx.me || (await import('./app.js')).S.user;
  const list = h('div', { class: 'u-list' });
  const count = h('span', { class: 'hint' });
  const paint = () => {
    const q = state.q.toLowerCase();
    const rows = state.users.filter((u) => (!q || (u.email + ' ' + u.name).toLowerCase().includes(q))
      && (state.filter === 'all' || (state.filter === 'guest' ? u.kind === 'guest' : state.filter === 'admin' ? u.role === 'admin' : state.filter === 'inactive' ? (!u.active || u.expired) : u.kind === 'member')));
    count.textContent = `${rows.length} von ${state.users.length}`;
    fill(list, rows.length ? rows.map((u) => userRow(u, reload)) : h('div', { class: 'empty' }, 'Keine Benutzer gefunden.'));
  };
  const reload = async () => { const r = await get('/api/users'); state.users = r.users; state.mail = r.mail; paint(); };
  const search = h('input', { class: 'input', placeholder: 'Suchen …', value: state.q, oninput: debounce((e) => { state.q = e.target.value; paint(); }, 120) });
  const filt = h('select', { class: 'input', style: { width: 'auto' }, onchange: (e) => { state.filter = e.target.value; paint(); } },
    [['all', 'Alle'], ['member', 'Mitglieder'], ['guest', 'Gäste'], ['admin', 'Plattform-Admins'], ['inactive', 'Gesperrt / abgelaufen']].map(([v, l]) => h('option', { value: v, selected: v === state.filter }, l)));
  ctx.shell('/benutzer',
    h('div', { class: 'page-head row' }, h('div', null, h('span', { class: 'label' }, 'VERWALTUNG'), h('h1', null, 'Benutzer'),
      h('p', { class: 'sub' }, 'Konten anlegen, Gäste befristen und Modul-Rechte vergeben. Konten gibt es nur auf Einladung.')),
      h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: () => userDialog(null, reload) }, icon('plus'), 'Benutzer anlegen')),
    userTabs('users'), h('div', { class: 'u-tools' }, search, filt, count), list);
  try {
    [state.mods] = await Promise.all([get('/api/modules/all'), reload()]);
    paint();
  } catch (e) { fill(list, h('div', { class: 'empty' }, e.message)); }
}
