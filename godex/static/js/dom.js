// Small DOM helpers. No framework: the CSP only allows our own scripts, and nothing here needs one.

export function h(tag, props = {}, ...children) {
  const el = tag.startsWith('svg:') ? document.createElementNS('http://www.w3.org/2000/svg', tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk, sv);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `ic ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

export const pad = n => String(n).padStart(3, '0');
export const fmt = n => Number(n).toLocaleString('en-GB');

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

let toastTimer;
export function toast(message, action) {
  let el = document.getElementById('toast');
  if (!el) { el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(el); }
  el.replaceChildren(h('span', { text: message }));
  if (action) el.append(h('button', { class: 'toast-act', onclick: () => { el.classList.remove('on'); action.run(); } }, action.label));
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), action ? 6000 : 2600);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = h('textarea', { value: text, class: 'offscreen' });
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}

/** A modal dialog. Returns { el, close }. Content is built by the caller. */
export function modal(title, body, { wide = false, onClose } = {}) {
  const dlg = h('dialog', { class: ['dlg', wide && 'wide'] });
  const close = () => { dlg.close(); };
  dlg.addEventListener('close', () => { dlg.remove(); onClose && onClose(); });
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  dlg.append(h('div', { class: 'dlg-in' },
    h('header', { class: 'dlg-head' }, h('h2', { text: title }),
      h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Close', onclick: close }, icon('close'))),
    body));
  document.body.append(dlg);
  dlg.showModal();
  return { el: dlg, close };
}

export function confirmBox(message, okLabel = 'OK', { danger = false } = {}) {
  return new Promise(resolve => {
    let answered = false;
    const { close } = modal('Are you sure?', h('div', { class: 'dlg-body' }, h('p', { text: message }),
      h('div', { class: 'dlg-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'),
        h('button', { class: ['btn', danger ? 'danger' : 'primary'], type: 'button', onclick: () => { answered = true; close(); } }, okLabel))),
    { onClose: () => resolve(answered) });
  });
}
