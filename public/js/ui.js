// Kleine UI-Helfer ohne Framework

const ICONS = {
  logo: '<path fill="currentColor" stroke="none" fill-rule="evenodd" d="M11.97 0.00 L4.83 1.75 L1.89 15.54 L12.00 23.99 L22.10 15.52 L19.15 1.74Z M11.96 2.67 L16.96 3.89 L19.23 14.51 L12.00 20.60 L4.75 14.55 L7.03 3.88Z M12.03 5.29 L8.47 6.16 L7.02 12.98 L12.07 17.20 L17.11 12.96 L15.65 6.16Z M12.06 7.06 L14.19 7.60 L15.19 12.28 L12.06 14.95 L8.92 12.31 L9.93 7.59Z"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  folderPlus: '<path d="M12 10v6M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  columns: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  skipBack: '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" x2="5" y1="19" y2="5"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  skipFwd: '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>',
  square: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  listPlus: '<path d="M11 12H3M16 6H3M16 18H3M18 9v6M21 12h-6"/>',
  trash: '<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6"/>',
  grip: '<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49M14.084 14.158a3 3 0 0 1-4.242-4.242M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143M2 2l20 20"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>',
  gamepad: '<line x1="6" x2="10" y1="12" y2="12"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="15" x2="15.01" y1="13" y2="13"/><line x1="18" x2="18.01" y1="11" y2="11"/><rect width="20" height="12" x="2" y="6" rx="2"/>',
  script: '<path d="M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4"/>',
  prompter: '<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4M21 2l-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  follow: '<path d="M12 3v12M6 9l6 6 6-6M5 21h14"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  hardDrive: '<line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14" rx="1"/>',
  timer: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  arrowLeft: '<path d="m12 19-7-7 7-7M19 12H5"/>',
  rotate: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  bell: '<path d="M10.27 21a2 2 0 0 0 3.46 0"/><path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  list: '<path d="M3 12h.01M3 18h.01M3 6h.01M8 12h13M8 18h13M8 6h13"/>',
  headset: '<path d="M4.5 13.5V12a7.5 7.5 0 0 1 15 0v1.5"/><rect x="2.8" y="12.5" width="4.4" height="7" rx="1.8"/><rect x="16.8" y="12.5" width="4.4" height="7" rx="1.8"/><path d="M19 19.5c0 1.6-2.2 2.3-5.5 2.3H12"/>',
  regie: '<rect x="2" y="3" width="20" height="13.5" rx="2.2"/><path d="M12 3v13.5M2 9.75h20M8 21h8M12 16.5V21"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  stack: '<rect x="5" y="2" width="14" height="3.6" rx="1.3"/><rect x="2" y="8" width="20" height="8" rx="2.2"/><rect x="5" y="18.4" width="14" height="3.6" rx="1.3"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  edit: '<path d="M12 20h9M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
  radio: '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1.5"/><rect width="7" height="7" x="14" y="3" rx="1.5"/><rect width="7" height="7" x="14" y="14" rx="1.5"/><rect width="7" height="7" x="3" y="14" rx="1.5"/>',
  rows: '<rect width="18" height="5" x="3" y="4" rx="1.5"/><rect width="18" height="5" x="3" y="15" rx="1.5"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  qr: '<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3M21 21v.01M12 7v3a2 2 0 0 1-2 2H7M3 12h.01M12 3h.01M12 16v.01M16 12h1M21 12v.01M12 21v-1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
};

export function icon(name, cls = '') {
  const s = document.createElement('span');
  s.className = 'ico ' + cls;
  s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return s;
}

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------- Toast */
let toastBox;
export function toast(msg, type = '') {
  toastBox ||= document.body.appendChild(h('div', { class: 'toasts' }));
  const t = toastBox.appendChild(h('div', { class: 'toast ' + type }, icon(type === 'err' ? 'alert' : type === 'ok' ? 'checkCircle' : 'info'), h('span', null, msg)));
  setTimeout(() => t.remove(), type === 'err' ? 4500 : 2500);
}

/* ---------- Auf dem Handy: Kachel (Bottom Sheet) nach unten wegwischen */
export function swipeDown(sheet, handle, onClose) {
  let y0 = null, dy = 0;
  handle.addEventListener('touchstart', (e) => {
    if (!window.matchMedia('(max-width: 600px)').matches || e.target.closest('button, input, select, textarea, a')) return;
    y0 = e.touches[0].clientY; dy = 0; sheet.style.transition = 'none';
  }, { passive: true });
  handle.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  const end = () => {
    if (y0 == null) return;
    y0 = null; sheet.style.transition = 'transform .18s ease-out';
    if (dy > 90) { sheet.style.transform = 'translateY(110%)'; setTimeout(onClose, 170); }
    else sheet.style.transform = '';
  };
  handle.addEventListener('touchend', end);
  handle.addEventListener('touchcancel', end);
}

/* ---------- Modal */
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const foot = actions.length ? h('div', { class: 'modal-foot' }, actions.map((a) =>
    h('button', { class: 'btn ' + (a.class || ''), type: a.submit ? 'submit' : 'button', onclick: a.submit ? null : async () => { if ((await a.onClick?.()) !== false) close(); } }, a.label))) : null;
  const content = h('div', { class: 'modal' + (wide ? ' wide' : '') },
    h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'icon-btn', onclick: close, 'aria-label': 'Schließen' }, icon('x'))),
    h('div', { class: 'modal-body' }, body),
    foot);
  const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) close(); } }, content);
  document.body.append(back);
  document.addEventListener('keydown', onKey);
  swipeDown(content, content.querySelector('.modal-head'), close);
  setTimeout(() => back.querySelector('input:not([type=checkbox]),textarea,select')?.focus(), 30);
  return { close, el: content };
}

export function confirmDialog(text, { okLabel = 'Löschen', danger = true, title = 'Bist du sicher?' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title,
      body: h('p', null, text),
      actions: [
        { label: 'Abbrechen', class: 'ghost', onClick: () => { done = true; resolve(false); } },
        { label: okLabel, class: danger ? 'red' : 'primary', onClick: () => { done = true; resolve(true); } },
      ],
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

/* ---------- Formular-Modal */
export function formModal({ title, fields, submitLabel = 'Speichern', onSubmit }) {
  const err = h('div', { class: 'form-error' });
  const inputs = {};
  const form = h('form', null,
    fields.map((f) => {
      let input;
      if (f.type === 'select') input = h('select', { class: 'input', name: f.name }, f.options.map(([v, l]) => h('option', { value: v, selected: v === f.value }, l)));
      else input = h('input', { class: 'input', name: f.name, type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder || '', required: !!f.required, autocomplete: f.autocomplete || 'off', minlength: f.minlength || null });
      inputs[f.name] = input;
      return h('label', { class: 'field' }, h('span', null, f.label), input, f.hint ? h('small', { class: 'hint' }, f.hint) : null);
    }),
    err,
    h('div', { class: 'modal-foot', style: { padding: '6px 0 0' } },
      h('button', { class: 'btn ghost', type: 'button', onclick: () => m.close() }, 'Abbrechen'),
      h('button', { class: 'btn primary', type: 'submit' }, submitLabel)));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const values = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
    try { if ((await onSubmit(values)) !== false) m.close(); } catch (ex) { err.textContent = ex.message; }
  });
  const m = modal({ title, body: form });
  return m;
}

/* ---------- Popover */
let openPop = null;
export function closePop() { openPop?.remove(); openPop = null; }
export function popover(anchor, content) {
  closePop();
  const pop = h('div', { class: 'pop' }, content);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = Math.min(r.left, window.innerWidth - pw - 10);
  if (r.right - pw > 10 && r.left + pw > window.innerWidth - 10) left = r.right - pw;
  let top = r.bottom + 6;
  if (top + ph > window.innerHeight - 10) top = Math.max(10, r.top - ph - 6);
  pop.style.left = Math.max(10, left) + 'px';
  pop.style.top = top + 'px';
  openPop = pop;
  setTimeout(() => {
    const off = (e) => { if (!pop.contains(e.target)) { closePop(); document.removeEventListener('pointerdown', off, true); } };
    document.addEventListener('pointerdown', off, true);
  });
  return pop;
}

/** Menü: Einträge {label, icon, onClick, active, sub} · Zwischenüberschrift {section} · Trennlinie {sep} */
export function menu(anchor, items) {
  const list = items.filter(Boolean).filter((it, i, arr) => !it.section || (arr[i + 1] && !arr[i + 1].section && !arr[i + 1].sep));
  return popover(anchor, list.map((it) => it.section ? h('div', { class: 'mi-sec' }, it.section)
    : it.sep ? h('div', { class: 'mi-sep' })
    : h('button', { class: 'mi' + (it.active ? ' active' : '') + (it.sub ? ' has-sub' : ''), onclick: () => { closePop(); it.onClick(); } },
      it.icon ? icon(it.icon) : null,
      it.sub ? h('span', { class: 'mi-txt' }, h('span', null, it.label), h('small', null, it.sub)) : it.label)));
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('In die Zwischenablage kopiert', 'ok');
}

export function autosize(ta) {
  if (!ta || ta.tagName !== 'TEXTAREA') return;
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}

/** replaceChildren mit Arrays/null-Unterstützung */
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
}

/** Gefährliche Aktion: Bestätigung durch Eintippen eines Wortes */
export function confirmTyped({ title, intro, points = [], word = 'NEU', okLabel = 'Bestätigen', headline = 'Achtung – diese Aktion kann nicht rückgängig gemacht werden.' }) {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input', { class: 'input', autocomplete: 'off', spellcheck: 'false', placeholder: word });
    const ok = h('button', { class: 'btn red', type: 'button', disabled: true }, okLabel);
    const check = () => { ok.disabled = input.value.trim().toUpperCase() !== word.toUpperCase(); };
    input.addEventListener('input', check);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !ok.disabled) ok.click(); });
    const body = h('div', null,
      h('div', { class: 'danger-box' }, icon('alert'), h('div', null, h('b', null, headline), intro ? h('div', null, intro) : null)),
      points.length ? h('ul', { class: 'danger-list' }, points.map((p) => h('li', null, p))) : null,
      h('label', { class: 'field' }, h('span', null, ['Zum Bestätigen ', h('b', null, word), ' eingeben']), input));
    const m = modal({ title, body, onClose: () => { if (!done) resolve(false); } });
    const foot = h('div', { class: 'modal-foot' },
      h('button', { class: 'btn ghost', type: 'button', onclick: () => m.close() }, 'Abbrechen'), ok);
    ok.addEventListener('click', () => { done = true; m.close(); resolve(true); });
    m.el.append(foot);
    setTimeout(() => input.focus(), 40);
  });
}

/** Hell/Dunkel-Umschalter (Sonne = zu hell wechseln, Mond = zu dunkel wechseln) */
export function themeToggle() {
  const cur = () => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const btn = h('button', { class: 'theme-toggle', type: 'button' });
  const paint = () => {
    const t = cur();
    btn.dataset.mode = t;
    btn.title = t === 'dark' ? 'Zum hellen Design wechseln' : 'Zum dunklen Design wechseln';
    btn.setAttribute('aria-label', btn.title);
    btn.replaceChildren(h('span', { class: 'tt-knob' }, icon(t === 'dark' ? 'moon' : 'sun')), h('span', { class: 'tt-ico tt-sun' }, icon('sun')), h('span', { class: 'tt-ico tt-moon' }, icon('moon')));
  };
  btn.addEventListener('click', () => {
    const t = cur() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('ffp.theme', t); } catch { /* */ }
    document.querySelectorAll('.theme-toggle').forEach((b) => b.dispatchEvent(new Event('repaint')));
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'dark' ? '#000000' : '#f3f3f6');
  });
  btn.addEventListener('repaint', paint);
  paint();
  return btn;
}
