// Trade: what I can offer (entries with "for trade" > 0) next to what I'm looking for (open wishes).
// Kept simple on purpose; the data model already holds quantities per entry for future matching.
import { h, icon, fmt, toast, copyText, pad, debounce } from '../dom.js';
import { parse, compileWishes, compileOffers, itemToQuery, compileCandidates } from '../query.js';
import { variantLabel } from '../model.js';
import { searchBar, sprite, entryChips, wishCard, wishTitle, wishChips } from '../components.js';
import { entryEditor } from '../editors.js';

const QUICK = [['shiny', 'Shiny'], ['legendary', 'Legendary'], ['shadow', 'Shadow'], ['costume', 'Costume'], ['lucky', 'Lucky'],
  ['xxl', 'XXL'], ['xxs', 'XXS'], ['background', 'Background'], ['regional', 'Regional'], ['high', 'High priority']];

export function render(main, app, { update }) {
  let st = main._trade;
  const owner = app.model.settings.owner_name;
  if (!update || !st) {
    const sb = searchBar(app, { text: app.route.text, placeholder: 'Filter both lists: shiny, legendary, pikachu ...', quick: QUICK,
      onChange: text => app.setQuery(text) });
    st = main._trade = { sb, tools: h('div', { class: 'resultbar' }), cols: h('div', { class: 'tradecols' }) };
    main.replaceChildren(h('section', { class: 'view tradeview' },
      h('header', { class: 'view-head' }, h('h1', { text: owner ? `Trade with ${owner}` : 'Trade' }),
        h('p', { class: 'muted', text: "What I can offer, and what I'm looking for. If we can help each other, get in touch." })),
      comparePanel(app),
      h('div', { class: 'sticky-search' }, sb.el), st.tools, st.cols));
  }
  if (st.sb.input.value !== app.route.text && document.activeElement !== st.sb.input) st.sb.setText(app.route.text);
  paint(app, st);
}

function paint(app, st) {
  const m = app.model;
  const q = parse(app.route.text, m);
  const offers = m.entries.filter(e => e.trade > 0).filter(compileOffers(q, m)).sort((a, b) => a.v.sp.dex - b.v.sp.dex || a.v.form.sort - b.v.form.sort);
  const wants = m.wishes.filter(w => w.status === 'open' && w.public).filter(compileWishes(q, m))
    .sort((a, b) => ['high', 'normal', 'someday'].indexOf(a.priority) - ['high', 'normal', 'someday'].indexOf(b.priority) || a.dex - b.dex);
  st.tools.replaceChildren(
    h('p', { class: 'count' }, h('b', { text: fmt(offers.reduce((n, e) => n + e.trade, 0)) }), ' to offer · ', h('b', { text: fmt(wants.length) }), ' wanted'),
    h('div', { class: 'bar-r' },
      h('button', { class: 'btn sm', type: 'button', onclick: async () => toast((await copyText(app.publicUrl('/trade', location.search))) ? 'Link copied' : 'Could not copy') }, icon('link'), 'Share'),
      h('button', { class: 'btn sm', type: 'button', onclick: async () => toast((await copyText(asText(app, offers, wants))) ? 'Copied as text' : 'Could not copy') }, icon('copy'), 'Copy as text')));
  st.cols.replaceChildren(
    h('section', { class: 'tcol' }, h('h2', {}, icon('trade'), h('span', { text: 'Can offer' }), h('span', { class: 'n', text: fmt(offers.length) })),
      offers.length ? h('div', { class: 'offers' }, offers.map(e => offerCard(app, e)))
        : h('div', { class: 'empty' }, h('p', { text: m.entries.some(e => e.trade) ? 'Nothing for trade matches.' : 'Nothing marked for trade right now.' }),
          app.admin ? h('p', { class: 'muted', text: 'Open a Pokémon and use "For trade" to list one here.' }) : null)),
    h('section', { class: 'tcol' }, h('h2', {}, icon('wish'), h('span', { text: 'Looking for' }), h('span', { class: 'n', text: fmt(wants.length) })),
      wants.length ? h('div', { class: 'wishes compact' }, wants.map(w => wishCard(app, w)))
        : h('div', { class: 'empty' }, h('p', { text: 'Nothing on the wishlist matches.' }))));
}

function offerCard(app, e) {
  return h('article', { class: 'offer' },
    h('a', { href: app.href('dex', { dex: e.v.sp.dex, form: e.v.form.id }), 'data-nav': '1', class: 'offer-art', 'aria-label': `Open ${e.v.sp.name}` },
      sprite(app, e.v, { size: 's' })),
    h('div', { class: 'offer-b' },
      h('div', { class: 'wish-top' }, h('span', { class: 'no', text: `#${pad(e.v.sp.dex)}` }), h('span', { class: 'qty-b', text: `×${e.trade}` })),
      h('h3', { text: variantLabel(e.v) }),
      h('div', { class: 'chips' }, entryChips(e, app.model)),
      e.note ? h('p', { class: 'note', text: e.note }) : null),
    app.admin ? h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Edit', onclick: () => entryEditor(app, { entry: e }) }, icon('edit')) : null);
}

function asText(app, offers, wants) {
  const owner = app.model.settings.owner_name || 'I';
  const plain = el => el.map(c => c.textContent).join(', ');
  const lines = [`${owner === 'I' ? 'I' : owner} can offer:`];
  for (const e of offers) {
    const extra = plain(entryChips(e, app.model));
    lines.push(`- ${variantLabel(e.v)}${extra ? ` (${extra})` : ''}${e.trade > 1 ? ` ×${e.trade}` : ''}`);
  }
  if (!offers.length) lines.push('- nothing right now');
  lines.push('', `${owner === 'I' ? 'I am' : owner + ' is'} looking for:`);
  for (const w of wants) {
    const extra = plain(wishChips(w, app.model));
    lines.push(`- ${wishTitle(w)}${extra ? ` (${extra})` : ''}${w.priority === 'high' ? ' [high priority]' : ''}`);
  }
  if (!wants.length) lines.push('- nothing right now');
  lines.push('', app.publicUrl('/trade'));
  return lines.join('\n');
}

// ---------------------------------------------------------------- compare with a visitor's list
const CMP_KEY = 'dex-trade-compare';

function comparePanel(app) {
  const m = app.model;
  const owner = m.settings.owner_name || 'I';
  let saved = { have: '', want: '' };
  try { saved = { ...saved, ...JSON.parse(localStorage.getItem(CMP_KEY) || '{}') }; } catch { /* private mode */ }
  const have = h('textarea', { rows: 5, placeholder: 'shiny ditto\nalolan vulpix\n#147\nxxl mimikyu', value: saved.have, 'aria-label': 'Pokémon you can trade' });
  const want = h('textarea', { rows: 5, placeholder: 'lucky palkia\nshiny togepi\ncostume pikachu', value: saved.want, 'aria-label': 'Pokémon you are looking for' });
  const out = h('div', { class: 'cmp-out' });
  const paint = () => {
    try { localStorage.setItem(CMP_KEY, JSON.stringify({ have: have.value, want: want.value })); } catch { /* */ }
    out.replaceChildren(...compare(app, have.value, want.value));
  };
  const later = debounce(paint, 200);
  have.addEventListener('input', later);
  want.addEventListener('input', later);
  paint();
  return h('details', { class: 'compare', open: !!(saved.have || saved.want) },
    h('summary', {}, icon('trade'), h('span', { text: 'Compare with your list' }),
      h('small', { class: 'muted', text: ' · see what we could trade' })),
    h('div', { class: 'cmp-in' },
      h('div', { class: 'row2' },
        h('label', { class: 'fld' }, h('span', { text: 'You can offer' }), have),
        h('label', { class: 'fld' }, h('span', { text: 'You are looking for' }), want)),
      h('p', { class: 'muted small', text: 'One Pokémon per line: a name or number, plus words like shiny, shadow, lucky, xxl, costume or alolan. Nothing you type leaves your browser.' }),
      out));

  function compare(app, haveText, wantText) {
    const lines = t => t.split(/\n+/).map(x => x.trim()).filter(Boolean).slice(0, 200);
    const wishes = m.wishes.filter(w => w.status === 'open' && (app.admin || w.public));
    const offers = m.entries.filter(e => e.trade > 0);
    const theyHave = lines(haveText).map(line => {
      const q = parse(itemToQuery(line), m);
      if (!q.terms.length || q.chips.some(c => c.unknown)) return { line, unknown: true, hits: [] };
      const { test, details } = compileCandidates(q);
      const hits = wishes.filter(w => w.variants.some(test)).map(w => ({ w, needs: needs(w, details) }));
      return { line, hits };
    });
    const theyWant = lines(wantText).map(line => {
      const q = parse(itemToQuery(line), m);
      if (!q.terms.length || q.chips.some(c => c.unknown)) return { line, unknown: true, hits: [] };
      return { line, hits: offers.filter(compileOffers(q, m)) };
    });
    if (!theyHave.length && !theyWant.length) return [];
    const goodHave = theyHave.filter(x => x.hits.length), goodWant = theyWant.filter(x => x.hits.length);
    const unknown = [...theyHave, ...theyWant].filter(x => x.unknown).map(x => x.line);
    const summary = [];
    for (const x of goodHave) summary.push(`You have ${x.line}: ${x.hits.map(({ w, needs: n }) => wishTitle(w) + (n.length ? ` (needs ${n.join(', ')})` : '')).join('; ')}`);
    for (const x of goodWant) summary.push(`You want ${x.line}: ${x.hits.map(e => variantLabel(e.v) + (e.trade > 1 ? ` ×${e.trade}` : '')).join('; ')}`);
    return [
      h('div', { class: 'cmp-cols' },
        h('section', {}, h('h3', {}, icon('wish'), `${owner === 'I' ? 'I want' : owner + ' wants'} · ${goodHave.length} of yours`),
          goodHave.length ? h('ul', { class: 'cmp-list' }, goodHave.map(x => h('li', {}, h('b', { text: x.line }),
            h('div', { class: 'chips' }, x.hits.map(({ w, needs: n }) => h('span', { class: ['chip', n.length ? '' : 'c-ok'], text: wishTitle(w) + (n.length ? ` · needs ${n.join(', ')}` : '') }))))))
            : h('p', { class: 'muted small', text: theyHave.length ? 'Nothing on your list is on the wishlist.' : 'Add what you can offer on the left.' })),
        h('section', {}, h('h3', {}, icon('trade'), `${owner === 'I' ? 'I can' : owner + ' can'} offer · ${goodWant.length} of your wants`),
          goodWant.length ? h('ul', { class: 'cmp-list' }, goodWant.map(x => h('li', {}, h('b', { text: x.line }),
            h('div', { class: 'chips' }, x.hits.map(e => h('span', { class: 'chip c-ok', text: variantLabel(e.v) + (e.trade > 1 ? ` ×${e.trade}` : '') + (entryChips(e, m).length ? ` · ${entryChips(e, m).map(c => c.textContent).join(', ')}` : '') }))))))
            : h('p', { class: 'muted small', text: theyWant.length ? 'Nothing you want is up for trade right now.' : 'Add what you are looking for on the right.' }))),
      unknown.length ? h('p', { class: 'muted small' }, 'Not recognised: ', unknown.join(', ')) : null,
      summary.length ? h('button', { class: 'btn sm', type: 'button', onclick: async () => toast((await copyText(summary.join('\n'))) ? 'Copied' : 'Could not copy') }, icon('copy'), 'Copy the matches') : null,
    ].filter(Boolean);
  }
}

/** Requirements of a wish that the visitor's description does not already state (so they know what to check). */
function needs(w, details) {
  const said = new Set(details.map(a => a.def.key));
  const n = [];
  if (w.size && !said.has(w.size)) n.push(w.size.toUpperCase());
  if (w.lucky === 1 && !said.has('lucky')) n.push('lucky');
  if (w.minIv.every(x => x === 15) && !said.has('perfect')) n.push('15/15/15');
  else if (w.minIv.some(x => x !== null) && !said.has('perfect')) n.push(`IVs ${w.minIv.map(x => x ?? '-').join('/')}`);
  if ((w.background || w.bg) && !['background', 'locationbackground', 'specialbackground', 'bg'].some(k => said.has(k))) n.push('a background');
  if (w.gender && !said.has(w.gender)) n.push(w.gender);
  if (w.moves && !said.has('move')) n.push(w.moves);
  return n;
}
