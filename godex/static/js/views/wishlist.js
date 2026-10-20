// The wishlist: first-class, searchable with the same language as the Pokédex.
import { h, icon, fmt, toast, copyText } from '../dom.js';
import { parse, compileWishes } from '../query.js';
import { searchBar, wishCard } from '../components.js';
import { wishEditor } from '../editors.js';

const QUICK = [['high', 'High priority'], ['shiny', 'Shiny'], ['background', 'Background'], ['xxl', 'XXL'], ['xxs', 'XXS'], ['hundo', 'Hundo'],
  ['lucky', 'Lucky'], ['legendary', 'Legendary'], ['costume', 'Costume'], ['shadow', 'Shadow'], ['missing', 'Still needed'], ['fulfilled', 'Got it']];
const GROUPS = [['high', 'High priority'], ['normal', 'Wanted'], ['someday', 'Someday']];

export function render(main, app, { update }) {
  let st = main._wish;
  if (!update || !st) {
    const sb = searchBar(app, { text: app.route.text, placeholder: 'Search the wishlist: shiny, high, legendary ...', quick: QUICK,
      onChange: text => app.setQuery(text) });
    st = main._wish = { sb, head: h('div', { class: 'resultbar' }), list: h('div', { class: 'wishgroups' }) };
    main.replaceChildren(h('section', { class: 'view wishview' },
      h('header', { class: 'view-head' }, h('h1', { text: 'Wishlist' }),
        h('p', { class: 'muted', text: "Specific Pokémon I'm hoping for, down to the form, size, IVs, background or moves." })),
      h('div', { class: 'sticky-search' }, sb.el), st.head, st.list));
  }
  if (st.sb.input.value !== app.route.text && document.activeElement !== st.sb.input) st.sb.setText(app.route.text);
  paint(app, st);
}

function paint(app, st) {
  const m = app.model;
  const q = parse(app.route.text, m);
  const wantsClosed = q.terms.some(t => t.atoms.some(a => ['fulfilled', 'archived'].includes(a.def.key)));
  const list = m.wishes.filter(w => (wantsClosed || w.status === 'open') && compileWishes(q, m)(w)).sort((a, b) => a.dex - b.dex);
  const high = list.filter(w => w.priority === 'high' && w.status === 'open').length;
  st.head.replaceChildren(
    h('p', { class: 'count' }, h('b', { text: fmt(list.length) }), list.length === 1 ? ' wish' : ' wishes',
      high ? h('span', { class: 'muted', text: ` · ${high} high priority` }) : null),
    h('div', { class: 'bar-r' },
      h('button', { class: 'btn sm', type: 'button', onclick: async () => toast((await copyText(app.publicUrl('/wishlist', location.search))) ? 'Link copied' : 'Could not copy') }, icon('link'), 'Share'),
      app.admin ? h('button', { class: 'btn sm primary', type: 'button', onclick: () => wishEditor(app) }, icon('plus'), 'Add wish') : null));
  if (!list.length) {
    st.list.replaceChildren(h('div', { class: 'empty' }, icon('wish', 'big'),
      h('p', { text: m.wishes.length ? 'No wishes match that search.' : 'The wishlist is empty.' }),
      app.admin && !m.wishes.length ? h('button', { class: 'btn primary', type: 'button', onclick: () => wishEditor(app) }, 'Add the first wish') : null));
    return;
  }
  const edit = app.admin ? { onEdit: w => wishEditor(app, { wish: w }) } : {};
  const sections = wantsClosed
    ? [[null, 'Results', list]]
    : GROUPS.map(([p, label]) => [p, label, list.filter(w => w.priority === p)]).filter(x => x[2].length);
  st.list.replaceChildren(...sections.map(([p, label, ws]) => h('section', { class: ['wgroup', p && `g-${p}`] },
    h('h2', {}, h('span', { text: label }), h('span', { class: 'n', text: fmt(ws.length) })),
    h('div', { class: 'wishes' }, ws.map(w => wishCard(app, w, edit))))));
}
