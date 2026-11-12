import { h, icon, toast, fill, modal, confirmDialog, debounce } from './ui.js';
import { get, post, put, del, fmtDate, fmtDateTime, initials } from './api.js';

/* ------------------------------------------------------------ Info-Kasten auf der Startseite */
export async function announceBox(isAdmin) {
  const box = h('div', { class: 'ann-box' });
  const paint = async () => {
    let items = [];
    try { items = (await get('/api/announcements')).items; } catch { return fill(box); }
    if (!items.length) return fill(box);
    fill(box, h('div', { class: 'section-title' }, 'Ankündigungen'), h('div', { class: 'ann-list' }, items.map((a) => h('article', { class: 'ann-card' },
      h('div', { class: 'ann-head' }, h('span', { class: 'ann-ico' }, icon('bell')), h('h4', null, a.title),
        h('button', { class: 'icon-btn', title: 'Gelesen – ausblenden', 'aria-label': 'Ausblenden', onclick: async () => { await post(`/api/announcements/${a.id}/read`).catch(() => {}); paint(); } }, icon('x'))),
      a.body ? h('div', { class: 'ann-body' }, a.body) : null,
      h('div', { class: 'ann-meta' }, `${a.by} · ${fmtDateTime(a.created_at)}`)))));
  };
  await paint();
  return box;
}

/* ------------------------------------------------------------ Empfänger-Auswahl */
function audiencePicker(groups, users, onChange) {
  let all = true;
  const chosenG = new Set(), chosenU = new Set();
  let q = '';
  const seg = h('div', { class: 'seg seg-wide' });
  const detail = h('div');
  const userList = h('div', { class: 'pick-list' });
  const paintUsers = () => fill(userList, users.filter((u) => !q || (u.name + ' ' + u.email).toLowerCase().includes(q)).map((u) => {
    const cb = h('input', { type: 'checkbox', checked: chosenU.has(u.id), onchange: () => { cb.checked ? chosenU.add(u.id) : chosenU.delete(u.id); onChange(); } });
    return h('label', { class: 'pick-row' }, cb, h('span', { class: 'avatar sm ' + (u.kind === 'guest' ? 'role-guest' : u.role === 'admin' ? 'role-admin' : 'role-user') }, initials(u)),
      h('span', { class: 'pick-txt' }, h('b', null, u.name || u.email), u.name ? h('small', null, u.email) : null), u.kind === 'guest' ? h('span', { class: 'chip amber' }, 'Gast') : null);
  }));
  const groupChip = (g) => {
    const cb = h('input', { type: 'checkbox', checked: chosenG.has(g.id), onchange: () => { cb.checked ? chosenG.add(g.id) : chosenG.delete(g.id); onChange(); } });
    return h('label', { class: 'pick-chip' + (g.auto ? '' : ' own') }, cb, h('span', null, g.name), g.members ? h('small', null, String(g.members.length)) : null);
  };
  const paint = () => {
    fill(seg, [[true, 'Alle'], [false, 'Auswählen']].map(([v, l]) => h('button', { type: 'button', class: all === v ? 'sel' : '', style: { width: 'auto', padding: '0 16px' }, onclick: () => { all = v; paint(); onChange(); } }, l)));
    if (all) return fill(detail, h('p', { class: 'hint' }, 'Geht an alle aktiven Konten (Mitglieder und Gäste).'));
    fill(detail,
      h('div', { class: 'pick-label' }, 'Gruppen'),
      h('div', { class: 'pick-chips' }, groups.map(groupChip)),
      h('div', { class: 'pick-label' }, 'Einzelne Personen'),
      h('input', { class: 'input', placeholder: 'Person suchen …', value: q, oninput: (e) => { q = e.target.value.toLowerCase(); paintUsers(); }, style: { marginBottom: '8px' } }),
      userList);
    paintUsers();
  };
  paint();
  return { el: h('div', null, seg, detail), value: () => (all ? { all: true } : { groups: [...chosenG], users: [...chosenU] }) };
}

export async function announceDialog(onDone) {
  const [g, u, adm] = await Promise.all([get('/api/groups'), get('/api/users'), get('/api/admin/announcements')]);
  const groups = [...g.auto, ...g.groups.map((x) => ({ ...x, id: 'g:' + x.id }))];
  const users = u.users.filter((x) => x.active && !x.expired);
  const title = h('input', { class: 'input', maxlength: 120, placeholder: 'z. B. Probe am Samstag' });
  const body = h('textarea', { class: 'input', rows: 6, maxlength: 5000, placeholder: 'Was sollen alle wissen?' });
  const exp = h('input', { class: 'input', type: 'date' });
  const sendMail = h('input', { type: 'checkbox', checked: adm.mail, disabled: !adm.mail });
  const count = h('span', { class: 'chip accent' }, '…');
  const err = h('div', { class: 'form-error' });
  const update = debounce(async () => {
    try { const r = await post('/api/admin/announcements/preview', { audience: picker.value() }); count.textContent = r.count === 1 ? '1 Empfänger' : `${r.count} Empfänger`; } catch { /* */ }
  }, 150);
  const picker = audiencePicker(groups, users, update);
  update();
  modal({ title: 'Ankündigung erstellen', wide: true, body: h('div', null,
    h('label', { class: 'field' }, h('span', null, 'Titel'), title),
    h('label', { class: 'field' }, h('span', null, 'Text'), body),
    h('div', { class: 'field' }, h('span', { class: 'row' }, 'Empfänger', h('span', { class: 'spacer' }), count), picker.el),
    h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', null, 'Auf der Startseite bis'), exp, h('small', { class: 'hint' }, 'Leer = bis zum Löschen.')),
      h('div', { class: 'field' }, h('span', null, 'E-Mail'), h('label', { class: 'switch' }, sendMail, h('span', null, 'Zusätzlich per E-Mail senden')),
        adm.mail ? null : h('small', { class: 'hint warn' }, 'Mailversand ist noch nicht eingerichtet (System → E-Mail-Versand).'))),
    err),
  actions: [{ label: 'Abbrechen', class: 'ghost' }, { label: 'Veröffentlichen', class: 'primary', onClick: async () => {
    err.textContent = '';
    try {
      const r = await post('/api/admin/announcements', { title: title.value, body: body.value, audience: picker.value(), expires_at: exp.value, send_mail: sendMail.checked });
      toast(`Veröffentlicht für ${r.recipients} ${r.recipients === 1 ? 'Person' : 'Personen'}${r.mailing ? ' – Mails werden verschickt' : ''}`, 'ok');
      onDone?.();
    } catch (e) { err.textContent = e.message; return false; }
  } }] });
}

/* ------------------------------------------------------------ Verwaltung */
export async function announcementsPage(ctx) {
  const list = h('div', { class: 'u-list' });
  const load = async () => {
    const r = await get('/api/admin/announcements');
    if (!r.items.length) return fill(list, h('div', { class: 'empty' }, h('b', null, 'Noch keine Ankündigungen'), 'Erstelle die erste mit dem Knopf oben.'));
    fill(list, r.items.map((a) => h('div', { class: 'u-row ann-row' + (a.expired ? ' off' : '') },
      h('span', { class: 'ann-ico' }, icon('bell')),
      h('div', { class: 'u-who' }, h('b', null, a.title), h('span', null, `${a.by} · ${fmtDateTime(a.created_at)}`)),
      h('div', { class: 'u-meta' }, h('div', { class: 'chips' },
        h('span', { class: 'chip' }, icon('users'), a.audience),
        h('span', { class: 'chip ' + (a.read === a.total ? 'green' : '') }, icon('eye'), `${a.read} / ${a.total} gelesen`),
        a.mailed ? h('span', { class: 'chip accent' }, icon('send'), `${a.mailed} Mails`) : null,
        a.expired ? h('span', { class: 'chip red' }, 'Abgelaufen') : a.expires_at ? h('span', { class: 'chip amber' }, icon('clock'), 'bis ' + fmtDate(a.expires_at)) : null),
      a.body ? h('div', { class: 'hint ann-snippet' }, a.body) : null),
      h('div', { class: 'u-actions' }, h('button', { class: 'icon-btn', title: 'Löschen', onclick: async () => {
        if (!(await confirmDialog(`„${a.title}“ löschen? Sie verschwindet auch bei allen Empfängern.`))) return;
        try { await del('/api/admin/announcements/' + a.id); toast('Gelöscht', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
      } }, icon('trash'))))));
  };
  ctx.shell('/ankuendigungen',
    h('div', { class: 'page-head row' }, h('div', null, h('span', { class: 'label' }, 'VERWALTUNG'), h('h1', null, 'Ankündigungen'),
      h('p', { class: 'sub' }, 'Nachrichten an alle, an Gruppen oder einzelne Personen – auf der Startseite und auf Wunsch per E-Mail.')),
    h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: () => announceDialog(load) }, icon('plus'), 'Ankündigung erstellen')),
    list);
  try { await load(); } catch (e) { fill(list, h('div', { class: 'empty' }, e.message)); }
}

/* ------------------------------------------------------------ Gruppen */
export const userTabs = (active) => h('nav', { class: 'tabs' },
  h('a', { href: '#/benutzer', class: active === 'users' ? 'active' : '' }, icon('users'), 'Benutzer'),
  h('a', { href: '#/benutzer/gruppen', class: active === 'groups' ? 'active' : '' }, icon('stack'), 'Gruppen'));

function groupDialog(gr, users, reload) {
  const name = h('input', { class: 'input', value: gr?.name || '', maxlength: 60, placeholder: 'z. B. Kamera-Team' });
  const desc = h('input', { class: 'input', value: gr?.description || '', maxlength: 200 });
  const chosen = new Set(gr?.members || []);
  let q = '';
  const cnt = h('span', { class: 'chip accent' });
  const list = h('div', { class: 'pick-list' });
  const paint = () => {
    cnt.textContent = `${chosen.size} ausgewählt`;
    fill(list, users.filter((u) => !q || (u.name + ' ' + u.email).toLowerCase().includes(q)).map((u) => {
      const cb = h('input', { type: 'checkbox', checked: chosen.has(u.id), onchange: () => { cb.checked ? chosen.add(u.id) : chosen.delete(u.id); cnt.textContent = `${chosen.size} ausgewählt`; } });
      return h('label', { class: 'pick-row' }, cb, h('span', { class: 'avatar sm ' + (u.kind === 'guest' ? 'role-guest' : 'role-user') }, initials(u)),
        h('span', { class: 'pick-txt' }, h('b', null, u.name || u.email), u.name ? h('small', null, u.email) : null), u.kind === 'guest' ? h('span', { class: 'chip amber' }, 'Gast') : null);
    }));
  };
  paint();
  const err = h('div', { class: 'form-error' });
  modal({ title: gr ? 'Gruppe bearbeiten' : 'Gruppe anlegen', body: h('div', null,
    h('div', { class: 'form-grid' }, h('label', { class: 'field' }, h('span', null, 'Name'), name), h('label', { class: 'field' }, h('span', null, 'Beschreibung (optional)'), desc)),
    h('div', { class: 'field' }, h('span', { class: 'row' }, 'Mitglieder', h('span', { class: 'spacer' }), cnt),
      h('input', { class: 'input', placeholder: 'Person suchen …', oninput: (e) => { q = e.target.value.toLowerCase(); paint(); }, style: { marginBottom: '8px' } }), list),
    err),
  wide: true,
  actions: [{ label: 'Abbrechen', class: 'ghost' }, { label: 'Speichern', class: 'primary', onClick: async () => {
    err.textContent = '';
    const b = { name: name.value, description: desc.value, members: [...chosen] };
    try { gr ? await put('/api/groups/' + gr.id, b) : await post('/api/groups', b); toast('Gespeichert', 'ok'); reload(); } catch (e) { err.textContent = e.message; return false; }
  } }] });
}

export async function groupsPage(ctx) {
  const list = h('div', { class: 'u-list' });
  let users = [];
  const load = async () => {
    const [g, u] = await Promise.all([get('/api/groups'), get('/api/users')]);
    users = u.users;
    const byId = new Map(users.map((x) => [x.id, x]));
    if (!g.groups.length) return fill(list, h('div', { class: 'empty' }, h('b', null, 'Noch keine Gruppen'), 'Gruppen fassen Personen zusammen, z. B. „Kamera-Team“ – praktisch für Ankündigungen.'));
    fill(list, g.groups.map((gr) => h('div', { class: 'u-row' },
      h('span', { class: 'ann-ico' }, icon('users')),
      h('div', { class: 'u-who' }, h('b', null, gr.name), h('span', null, gr.description || `${gr.members.length} ${gr.members.length === 1 ? 'Person' : 'Personen'}`)),
      h('div', { class: 'u-meta' }, h('div', { class: 'chips' }, gr.members.slice(0, 12).map((id) => byId.get(id)).filter(Boolean).map((m) => h('span', { class: 'chip' }, m.name || m.email)),
        gr.members.length > 12 ? h('span', { class: 'chip' }, `+${gr.members.length - 12}`) : null, gr.members.length ? null : h('span', { class: 'hint' }, 'Noch leer'))),
      h('div', { class: 'u-actions' },
        h('button', { class: 'icon-btn', title: 'Bearbeiten', onclick: () => groupDialog(gr, users, load) }, icon('edit')),
        h('button', { class: 'icon-btn', title: 'Löschen', onclick: async () => {
          if (!(await confirmDialog(`Gruppe „${gr.name}“ löschen? Die Personen selbst bleiben erhalten.`))) return;
          try { await del('/api/groups/' + gr.id); toast('Gelöscht', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
        } }, icon('trash'))))));
  };
  ctx.shell('/benutzer',
    h('div', { class: 'page-head row' }, h('div', null, h('span', { class: 'label' }, 'VERWALTUNG'), h('h1', null, 'Gruppen'),
      h('p', { class: 'sub' }, 'Eigene Gruppen für Ankündigungen. Feste Gruppen wie „Alle Mitglieder“ oder „Mit Zugang zu FF Rundown“ gibt es automatisch.')),
    h('div', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: () => groupDialog(null, users, load) }, icon('plus'), 'Gruppe anlegen')),
    userTabs('groups'), list);
  try { await load(); } catch (e) { fill(list, h('div', { class: 'empty' }, e.message)); }
}
