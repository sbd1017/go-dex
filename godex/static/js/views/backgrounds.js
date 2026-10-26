// Backgrounds: every location and special background in the game. The ones you have are in colour, with the
// Pokémon that carry them; tap one for the full picture and the list.
import { h, fmt, modal } from '../dom.js';
import { sprite, bgUrl } from '../components.js';
import { variantLabel, inMode, norm } from '../model.js';

const st = { kind: 'all', show: 'all', text: '' };
const KINDS = [['all', 'All'], ['location', 'Location'], ['special', 'Special']];
const SHOW = [['all', 'All'], ['have', 'Have'], ['missing', 'Missing']];

const yours = (app, bg) => bg.entries.filter(e => inMode(e, app.mode));

export function render(main, app) {
  const all = [...app.model.backgrounds.values()];
  const haveN = all.filter(bg => yours(app, bg).length).length;
  const grid = h('div', { class: 'bggrid', role: 'list' });
  const count = h('p', { class: 'resultbar-t' });
  const paint = () => {
    const text = norm(st.text);
    const list = all.filter(bg => (st.kind === 'all' || bg.kind === st.kind)
      && (st.show === 'all' || (st.show === 'have') === yours(app, bg).length > 0)
      && (!text || bg.n.includes(text) || String(bg.year || '').includes(text)));
    list.sort((a, b) => (yours(app, b).length > 0) - (yours(app, a).length > 0) || (b.year || 0) - (a.year || 0) || a.name.localeCompare(b.name));
    count.replaceChildren(h('b', { text: fmt(list.length) }), ` background${list.length === 1 ? '' : 's'}`);
    grid.replaceChildren(...(list.length ? list.map(bg => card(app, bg))
      : [h('p', { class: 'empty', text: 'No background matches that.' })]));
  };
  const seg = (opts, key) => h('div', { class: 'seg sm', role: 'group' }, opts.map(([v, label]) => h('button', {
    type: 'button', class: st[key] === v ? 'on' : '', 'aria-pressed': String(st[key] === v),
    onclick: e => { st[key] = v; for (const b of e.currentTarget.parentNode.children) b.classList.toggle('on', b === e.currentTarget); paint(); },
  }, label)));
  main.replaceChildren(h('section', { class: 'view bgview' },
    h('header', { class: 'view-head' }, h('h1', { text: 'Backgrounds' }),
      h('p', { class: 'muted' }, `${fmt(haveN)} of ${fmt(all.length)} location and special backgrounds. Tap one to see who has it.`)),
    h('div', { class: 'bgbar' },
      h('label', { class: 'bgfind' }, h('span', { class: 'sr', text: 'Find a background' }),
        h('input', { type: 'search', placeholder: 'Find: madrid, 2024, go fest ...', value: st.text, autocomplete: 'off',
          oninput: e => { st.text = e.target.value; paint(); } })),
      seg(KINDS, 'kind'), seg(SHOW, 'show')),
    count, grid,
    h('p', { class: 'muted small', text: 'Background pictures come from your own image folder (see media/sprites/README.md); without one you see the name only.' })));
  paint();
}

function card(app, bg) {
  const mine = yours(app, bg);
  const url = bgUrl(app, bg);
  return h('button', { type: 'button', class: ['bgcard', mine.length ? 'have' : 'miss'], role: 'listitem', onclick: () => open(app, bg),
    'aria-label': `${bg.name}${mine.length ? `, ${mine.length} Pokémon` : ', missing'}` },
  h('span', { class: 'bg-art' },
    url ? h('img', { src: url, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }) : h('span', { class: 'bg-ph', text: bg.name }),
    mine.length ? h('span', { class: 'bg-mons' }, mine.slice(0, 3).map(e => sprite(app, e.v, { size: 'xs' })),
      mine.length > 3 ? h('span', { class: 'bg-more', text: `+${mine.length - 3}` }) : null) : null),
  h('span', { class: 'bg-nm', text: bg.name }),
  h('span', { class: 'bg-meta', text: [bg.kind === 'special' ? 'Special' : 'Location', bg.year].filter(Boolean).join(' · ') }));
}

function open(app, bg) {
  const mine = yours(app, bg);
  const url = bgUrl(app, bg);
  const body = h('div', { class: 'dlg-body bgdetail' },
    h('div', { class: ['bg-hero', !url && 'noart'], style: url ? { '--bgart': `url("${url}")` } : {} },
      mine.slice(0, 1).map(e => sprite(app, e.v, { size: 'l' }))),
    h('p', { class: 'muted', text: [bg.kind === 'special' ? 'Special background' : 'Location background', bg.year].filter(Boolean).join(' · ') }),
    mine.length
      ? h('ul', { class: 'entries' }, mine.map(e => h('li', { class: 'entry' },
        sprite(app, e.v, { size: 'xs' }),
        h('div', { class: 'entry-b' }, h('a', { href: app.href('dex', { dex: e.v.sp.dex, form: e.v.form.id }), 'data-nav': '1',
          onclick: () => dlg.close() }, h('b', { text: variantLabel(e.v) }))))))
      : h('p', { text: 'Not in your Pokédex yet.' }));
  const dlg = modal(bg.name, body, { wide: true });
}
