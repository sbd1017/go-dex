// The Pokédex grid: search, headline counters, quick filters, cards. Admin adds bulk actions.
import { h, icon, pad, fmt, confirmBox, toast, modal, copyText } from '../dom.js';
import { GO_WORDS, goSearchString, picksFromQuery } from '../gosearch.js';
import { parse, compileVariants } from '../query.js';
import { variantHas, formLabel, variantLabel, replaceEntries } from '../model.js';
import { computeStats, REGION_NAMES } from '../stats.js';
import { sprite, pips, searchBar } from '../components.js';

const QUICK = [['missing', 'Missing'], ['shiny', 'Shiny'], ['shadow', 'Shadow'], ['costume', 'Costume'], ['xxl', 'XXL'], ['xxs', 'XXS'],
  ['background', 'Background'], ['lucky', 'Lucky'], ['hundo', 'Hundo'], ['legendary', 'Legendary'], ['wish', 'Wishlist'],
  ['trade', 'For trade'], ['gmax', 'G-Max'], ['regional', 'Regional']];
const SUMMARY = [['dex', 'Pokédex'], ['shiny', 'Shiny'], ['shadow', 'Shadow'], ['lucky', 'Lucky'], ['xxl', 'XXL'], ['costume', 'Costumes']];

// Quick entry (admin): tap cards to toggle one variant without opening each Pokémon. Remembered for this tab.
const QE_KEY = 'dex-quick-entry';
const quick = (() => {
  try { return { on: false, shiny: false, align: 'normal', ...JSON.parse(sessionStorage.getItem(QE_KEY) || '{}') }; }
  catch { return { on: false, shiny: false, align: 'normal' }; }
})();
const saveQuick = () => { try { sessionStorage.setItem(QE_KEY, JSON.stringify(quick)); } catch { /* private mode */ } };
let qeChain = Promise.resolve();      // taps are saved one after another, in order

let statsCache = { key: null, value: null };
export function stats(app) {
  const key = `${app.model.version}|${app.model.entries.length}|${app.mode}|${app.model.entries.reduce((n, e) => n + e.owned + e.trade * 7 + (e.registered ? 3 : 0), 0)}`;
  if (statsCache.key !== key) statsCache = { key, value: computeStats(app.model, app.mode) };
  return statsCache.value;
}

export function render(main, app, { update }) {
  let st = main._dex;
  if (!update || !st) {
    // Region picker: pinned at the right end of the filter row, so it stays on screen and shows where you are.
    const fab = h('label', { class: 'region-pick', hidden: true });
    const sb = searchBar(app, {
      text: app.route.text, placeholder: 'Search: 25, shiny, missing ...', quick: QUICK,
      onChange: text => app.setQuery(text), trailing: fab,
    });
    st = main._dex = { sb, summary: h('div', { class: 'summary', role: 'list' }), intro: h('div'),
      bar: h('div', { class: 'resultbar' }), grid: h('div', { class: 'grid', role: 'list' }), cards: new Map(),
      qbar: h('div', { class: 'qe-bar' }), fab };
    main.replaceChildren(h('section', { class: 'view dexview' },
      h('div', { class: 'sticky-search' }, sb.el, app.admin ? st.qbar : null), st.intro, st.summary, st.bar, st.grid));
    followRegion(st);
  }
  if (app.admin) paintQuickBar(app, st);
  if (st.sb.input.value !== app.route.text && document.activeElement !== st.sb.input) st.sb.setText(app.route.text);
  paintSummary(app, st);
  paintResults(app, st);
}

function paintSummary(app, st) {
  const s = stats(app);
  const text = app.route.text.trim().toLowerCase();
  const items = SUMMARY.map(([id, label]) => {
    const x = s.byId[id];
    return { label, q: x.q, value: x.total && id !== 'xxl' ? [fmt(x.have), ` / ${fmt(x.total)}`] : [fmt(x.have)], id };
  });
  items.push({ id: 'wish', label: 'Wishlist', q: 'wish', value: [fmt(s.wishes.open)] });
  items.push({ id: 'trade', label: 'For trade', q: 'trade', value: [fmt(s.trade.count)] });
  st.summary.replaceChildren(...items.map(it => h('button', {
    type: 'button', role: 'listitem', class: ['stat', `st-${it.id}`, text === it.q && it.q && 'on'],
    onclick: () => app.setQuery(text === it.q ? '' : it.q, { push: true }),
  }, h('span', { class: 'stat-l', text: it.label }), h('span', { class: 'stat-v' }, h('b', { text: it.value[0] }), it.value[1] ? h('small', { text: it.value[1] }) : null))));
  const intro = app.model.settings.intro;
  st.intro.replaceChildren(intro && !app.route.text ? h('p', { class: 'intro', text: intro }) : '');
}

function results(app) {
  const m = app.model, mode = app.mode;
  const q = parse(app.route.text, m);
  const matched = m.variants.filter(compileVariants(q, mode, m));
  const group = app.route.group || (q.formLevel ? 'forms' : 'species');
  const groups = new Map();
  for (const v of matched) {
    const key = group === 'forms' ? v.form.id : v.sp.dex;
    let g = groups.get(key);
    if (!g) groups.set(key, g = { key, sp: v.sp, form: group === 'forms' ? v.form : null, vars: [] });
    g.vars.push(v);
  }
  let list = [...groups.values()];
  const sort = app.route.sort || 'dex';
  if (sort === 'name') list.sort((a, b) => a.sp.name.localeCompare(b.sp.name) || (a.form?.sort ?? 0) - (b.form?.sort ?? 0));
  else if (sort === 'recent') {
    const last = g => g.vars.reduce((t, v) => v.entries.reduce((u, e) => (e.updatedAt > u ? e.updatedAt : u), t), '');
    list = list.map(g => [last(g), g]).sort((a, b) => (b[0] > a[0] ? 1 : b[0] < a[0] ? -1 : a[1].sp.dex - b[1].sp.dex)).map(x => x[1]);
  } else list.sort((a, b) => a.sp.dex - b.sp.dex || (a.form?.sort ?? 0) - (b.form?.sort ?? 0));
  return { q, matched, group, list, mode };
}

function paintResults(app, st) {
  const res = results(app);
  const { q, matched, group, list, mode } = res;
  const haveCount = list.filter(g => g.vars.some(v => variantHas(v, mode))).length;
  const filtered = q.terms.length > 0;
  st.bar.replaceChildren(
    h('p', { class: 'count' }, h('b', { text: fmt(list.length) }), ` ${group === 'forms' ? 'forms' : 'Pokémon'}`,
      filtered ? h('span', { class: 'muted', text: ` · ${fmt(matched.length)} variants · you have ${fmt(haveCount)}` }) : null),
    h('div', { class: 'bar-r' },
      h('div', { class: 'seg sm', role: 'group', 'aria-label': 'Group by' }, ['species', 'forms'].map(gk => h('button', {
        type: 'button', class: group === gk ? 'on' : '', 'aria-pressed': String(group === gk),
        onclick: () => app.setOption('group', gk === (q.formLevel ? 'forms' : 'species') ? null : gk) }, gk === 'species' ? 'Species' : 'Forms'))),
      h('label', { class: 'sel' }, h('span', { class: 'sr', text: 'Sort' }), h('select', { onchange: e => app.setOption('sort', e.target.value === 'dex' ? null : e.target.value) },
        [['dex', 'No.'], ['name', 'Name'], ['recent', 'Recently changed']].map(([k, l]) => h('option', { value: k, selected: (app.route.sort || 'dex') === k }, l)))),
      list.length ? h('button', { class: 'btn sm', type: 'button', title: 'Copy these Pokédex numbers as a Pokémon GO search',
        onclick: () => goSearchDialog(app, list, q) }, icon('copy'), 'Copy for GO') : null,
      app.admin ? bulkMenu(app, matched) : null));

  if (!list.length) {
    paintRegionFab(st, null);
    const unknown = q.chips.filter(c => c.unknown).map(c => c.text);
    st.grid.replaceChildren(h('div', { class: 'empty' }, icon('ball', 'big'),
      h('p', { text: unknown.length ? `Nothing called "${unknown.join('", "')}".` : 'Nothing matches that search.' }),
      h('p', { class: 'muted', text: 'Tap ? next to the search box for what you can type.' })));
    return;
  }
  // Plain Pokédex browsing shows silhouettes for what you don't have; a variant search ("shiny, missing") shows the
  // variant dimmed in colour instead, so you can see which shiny/costume/etc. it is.
  const variantQuery = q.terms.some(t => t.atoms.some(a => a.def.variant || a.def.entry || a.def.form || a.def.special || a.def.state));
  const frag = document.createDocumentFragment();
  const keep = new Map();
  const regions = regionsShown(app, list);
  let lastGen = null;
  for (const g of list) {
    if (regions && g.sp.gen !== lastGen && REGION_NAMES[g.sp.gen]) {
      lastGen = g.sp.gen;
      frag.append(h('div', { class: 'region-h', role: 'listitem', dataset: { gen: lastGen } }, h('h2', { text: REGION_NAMES[lastGen] })));
    }
    const el = app.admin && quick.on ? quickCard(app, g, st) : card(app, g, mode, st.cards, variantQuery);
    keep.set(el.dataset.sig, el);
    frag.append(el);
  }
  st.cards = keep;
  st.grid.replaceChildren(frag);
  paintRegionFab(st, regions);
}

function card(app, g, mode, cache, variantQuery) {
  const has = v => variantHas(v, mode);
  const haveV = g.vars.find(has);
  const rep = haveV || g.vars[0];
  const scope = (g.form ? g.form.variants : g.sp.variants).filter(v => v.target || v.entries.length);
  const name = g.form ? formLabel(g.form) : g.sp.name;
  const href = app.href('dex', { dex: g.sp.dex, form: g.form?.id, text: app.route.text });
  const sig = [g.key, rep.id, !!haveV, variantQuery, href, scope.map(v => v.entries.length + ':' + v.wishes.length).join(','), mode,
    scope.reduce((n, v) => n + v.entries.reduce((k, e) => k + e.trade + (e.registered ? 1 : 0) + (e.size ? 2 : 0) + (e.lucky ? 4 : 0) + (e.bg ? 8 : 0), 0), 0)].join('|');
  const cached = cache.get(sig);
  if (cached) return cached;
  const el = h('a', { class: ['card', haveV ? 'have' : 'miss', !haveV && variantQuery && 'dim'], href, 'data-nav': '1', role: 'listitem', dataset: { sig },
    style: { '--t1': `var(--ty-${rep.form.types[0]})`, '--t2': `var(--ty-${rep.form.types[1] || rep.form.types[0]})` },
    'aria-label': `${pad(g.sp.dex)} ${name}${haveV ? '' : ', missing'}` },
  h('span', { class: 'no', text: pad(g.sp.dex) }),
  sprite(app, rep, { silhouette: !haveV && !variantQuery }),
  h('span', { class: 'nm', text: g.form && g.form.name ? g.form.name : g.sp.name }),
  g.form && g.form.name ? h('span', { class: 'sub', text: g.sp.name }) : null,
  variantQuery ? h('span', { class: 'vhint', text: variantHint(g, haveV, mode) }) : null,
  pips(scope, mode, { max: 5 }));
  return el;
}

/** Regions in the list, when it is in number order and spans more than one (else null): headings + "jump to". */
function regionsShown(app, list) {
  if ((app.route.sort || 'dex') !== 'dex') return null;
  const gens = [...new Set(list.map(g => g.sp.gen))].filter(g => REGION_NAMES[g]);
  return gens.length > 1 ? gens : null;
}

/** Top of the content under the sticky header + search (where a jumped-to heading should land). */
function coverHeight(st) {
  return document.getElementById('top').offsetHeight + (st.sb.el.closest('.sticky-search')?.offsetHeight || 0);
}

/** Region pill at the end of the filter row, like the region tabs in the in-game Pokédex: shows where you are. */
function paintRegionFab(st, gens) {
  st.fab.hidden = !gens;
  if (!gens) return;
  const select = h('select', { 'aria-label': 'Jump to region', onchange: e => {
    const target = st.grid.querySelector(`.region-h[data-gen="${e.target.value}"]`);
    if (target) glideTo(target.getBoundingClientRect().top + window.scrollY - coverHeight(st) - 4, () => syncRegionFab(st));
    syncRegionFab(st);
  } }, gens.map(g => h('option', { value: g, text: REGION_NAMES[g] })));
  st.fab.replaceChildren(icon('dex'), h('span', { class: 'rf-name' }), select, icon('updown', 'rf-chev'));
  syncRegionFab(st);
}

/** Scroll to y as a fast swipe that always takes the same time, near or far (instant with reduced motion).
    Touching, wheeling or pressing a key stops it where it is. */
const GLIDE_MS = 700;
let glide = null;
function glideTo(y, done) {
  if (glide) glide.stop();
  const from = window.scrollY, dist = y - from;
  if (Math.abs(dist) < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) { window.scrollTo(0, y); done(); return; }
  const ease = t => (t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);   // ease in-out: speeds up, then settles
  const stopEvents = ['wheel', 'touchstart', 'keydown'];
  let raf = 0, t0 = null;
  const stop = () => { cancelAnimationFrame(raf); stopEvents.forEach(ev => window.removeEventListener(ev, stop)); glide = null; done(); };
  const step = now => {
    t0 ??= now;
    const t = Math.min(1, (now - t0) / GLIDE_MS);
    window.scrollTo(0, from + dist * ease(t));
    if (t < 1) raf = requestAnimationFrame(step); else stop();
  };
  stopEvents.forEach(ev => window.addEventListener(ev, stop, { passive: true }));
  glide = { stop };
  raf = requestAnimationFrame(step);
}

/** Which region heading is at the top of the screen right now. */
function syncRegionFab(st) {
  if (st.fab.hidden) return;
  const line = coverHeight(st) + 12;
  let current = null;
  for (const hd of st.grid.querySelectorAll('.region-h')) {
    if (hd.getBoundingClientRect().top <= line) current = hd.dataset.gen; else break;
  }
  const select = st.fab.querySelector('select');
  current = current || select.options[0]?.value;
  select.value = current;
  st.fab.querySelector('.rf-name').textContent = REGION_NAMES[current] || '';
}

function followRegion(st) {
  let timer = null;
  const onScroll = () => {
    if (!st.fab.isConnected) { window.removeEventListener('scroll', onScroll); return; }   // view was replaced
    if (timer) return;
    timer = setTimeout(() => { timer = null; syncRegionFab(st); }, 80);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
}

function bulkMenu(app, matched) {
  const act = async (action, label) => {
    const ids = matched.map(v => v.id);
    if (!ids.length) return;
    if (!(await confirmBox(`${label}: ${fmt(ids.length)} variants shown by this search. You can undo it afterwards.`, 'Do it'))) return;
    try {
      const data = await app.post('bulk', { variant_ids: ids, action });
      await app.saved(data, `${fmt(data.changed)} updated`);
    } catch { /* toast shown */ }
  };
  return h('details', { class: 'menu' }, h('summary', { class: 'btn sm' }, icon('bolt'), 'Bulk'),
    h('div', { class: 'menu-list' },
      h('p', { class: 'muted', text: 'Applies to every variant this search shows.' }),
      h('button', { type: 'button', onclick: () => act('register', 'Add all to the Pokédex') }, 'Add to Pokédex'),
      h('button', { type: 'button', onclick: () => act('unregister', 'Take all out of the Pokédex') }, 'Remove from Pokédex'),
      h('button', { type: 'button', onclick: () => act('untrade', 'Take all off trade') }, 'Not for trade')));
}

/** "Shiny Shadow +2": which of the matched variants the card stands for, in a variant search. */
function variantHint(g, haveV, mode) {
  const pool = haveV ? g.vars.filter(v => variantHas(v, mode)) : g.vars;
  const first = haveV || g.vars[0];
  const label = variantLabel(first, { withName: false });
  return pool.length > 1 ? `${label} +${pool.length - 1}` : label;
}

// ---------------------------------------------------------------- quick entry
function paintQuickBar(app, st) {
  const set = (k, v) => { quick[k] = v; saveQuick(); paintQuickBar(app, st); paintResults(app, st); };
  const seg = (label, key, opts) => h('div', { class: 'seg sm', role: 'group', 'aria-label': label },
    opts.map(([v, l]) => h('button', { type: 'button', class: quick[key] === v ? 'on' : '', 'aria-pressed': String(quick[key] === v),
      onclick: () => set(key, v) }, l)));
  st.qbar.classList.toggle('on', quick.on);
  st.qbar.replaceChildren(
    h('label', { class: 'switch sm', title: 'Tap cards to mark them instead of opening them' },
      h('input', { type: 'checkbox', checked: quick.on, onchange: e => set('on', e.target.checked) }),
      h('span', { class: 'sw' }), h('span', { text: 'Quick entry' })),
    ...(quick.on ? [
      h('span', { class: 'qe-l', text: 'Tap adds' }),
      seg('Shiny or not', 'shiny', [[false, 'Normal'], [true, 'Shiny']]),
      seg('Shadow or purified', 'align', [['normal', 'Plain'], ['shadow', 'Shadow'], ['purified', 'Purified']]),
    ] : []));
}

/** The variant a quick-entry tap changes for this card: the chosen shiny/alignment of its form (base form for species). */
function quickTarget(g) {
  const form = g.form || g.sp.forms.find(f => f.kind === 'base') || g.sp.forms.find(f => f.kind !== 'mega') || g.sp.forms[0];
  return form.variants.find(v => v.shiny === quick.shiny && v.align === quick.align && v.max === 'none') || null;
}

function quickState(v) {
  return !!v && v.entries.some(e => e.registered);
}

function quickCard(app, g, st) {
  const v = quickTarget(g);
  const on = quickState(v);
  const name = g.form && g.form.name ? g.form.name : g.sp.name;
  const what = 'in Pokédex';
  const el = h('div', { class: ['card', 'qe', on ? 'have' : 'miss', !v && 'na'], role: 'listitem',
    style: { '--t1': `var(--ty-${(v || g.vars[0]).form.types[0]})`, '--t2': `var(--ty-${(v || g.vars[0]).form.types[1] || (v || g.vars[0]).form.types[0]})` } },
  h('button', { type: 'button', class: 'qe-tap', disabled: !v, 'aria-pressed': String(on),
    'aria-label': v ? `${variantLabel(v)}: ${on ? what : 'not ' + what}. Tap to change.` : `${name}: no such variant`,
    onclick: () => v && quickTap(app, st, v, el) }),
  h('span', { class: 'no', text: pad(g.sp.dex) }),
  h('a', { class: 'qe-open', href: app.href('dex', { dex: g.sp.dex, form: g.form?.id, text: app.route.text }), 'data-nav': '1',
    'aria-label': `Open ${name}`, title: 'Open' }, icon('right')),
  v ? sprite(app, v, { silhouette: !on }) : h('span', { class: 'art art-m ph' }, icon('ball')),
  h('span', { class: 'nm', text: name }),
  h('span', { class: 'vhint', text: v ? (on ? `✓ ${what}` : variantLabel(v, { withName: false })) : 'None' }));
  return el;
}

function quickTap(app, st, v, el) {
  const was = quickState(v);
  const op = { registered: was ? 0 : 1 };
  el.classList.toggle('have', !was);                     // answer the tap straight away
  el.classList.toggle('miss', was);
  qeChain = qeChain.then(async () => {
    try {
      const data = await app.post('quick', { variant_id: v.id, ...op });
      replaceEntries(app.model, [v.id], data.entries);
      const now = quickState(v);
      if (was && now) toast(`${variantLabel(v)} is still in the Pokédex through its special entries`);
      else toast(`${variantLabel(v)}: ${now ? 'added to' : 'taken out of'} the Pokédex`, { label: 'Undo', run: () => app.undo(data.batch) });
    } catch { /* toast shown by post() */ }
    app.renderMain(app.route);                            // repaint counters and this card from the saved state
  });
}

// ---------------------------------------------------------------- copy as a Pokémon GO search
function goSearchDialog(app, list, q) {
  const dexes = list.map(g => g.sp.dex);
  const picks = picksFromQuery(q);                     // start from what you searched for
  const out = h('textarea', { class: 'go-out', rows: 3, spellcheck: 'false', autocapitalize: 'off', 'aria-label': 'Pokémon GO search' });
  const info = h('p', { class: 'muted small' });
  const chips = h('div', { class: 'chips go-words' });
  const paint = () => {
    out.value = goSearchString(dexes, picks);
    const n = new Set(dexes).size;
    info.textContent = `${n} Pokédex number${n === 1 ? '' : 's'} · ${out.value.length} characters` +
      (out.value.length > 1500 ? ' · very long: the game may cut it off, so narrow your search' : '');
    chips.replaceChildren(...GO_WORDS.map(w => {
      const state = picks.get(w.word);
      return h('button', { type: 'button', class: ['chip', 'btnchip', state === 'on' && 'go-on', state === 'not' && 'go-not'],
        title: 'Tap: include · again: exclude (!) · again: off', 'aria-pressed': String(!!state),
        onclick: () => {
          const next = !state ? 'on' : state === 'on' ? 'not' : null;
          if (next) picks.set(w.word, next); else picks.delete(w.word);
          paint();
        } }, state === 'not' ? `!${w.label}` : w.label);
    }));
  };
  paint();
  const body = h('div', { class: 'dlg-body' },
    h('p', {}, 'Paste this into the search bar of your Pokémon storage in Pokémon GO. ',
      h('span', { class: 'muted', text: 'It lists the Pokédex numbers this search shows here, plus the GO words below.' })),
    out, info,
    h('div', { class: 'fld' }, h('span', { text: 'GO search words' }), chips,
      h('small', { text: 'Tap once to include, twice to exclude (!), three times to remove. Sizes, Shadow/Purified, backgrounds and so on count as "either" when you pick more than one (xxs,xxl).' })),
    h('div', { class: 'dlg-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => { picks.clear(); paint(); } }, 'Numbers only'),
      h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        toast((await copyText(out.value)) ? 'Copied: paste it into Pokémon GO' : 'Could not copy: select the text and copy it');
      } }, icon('copy'), 'Copy')));
  modal('Copy for Pokémon GO', body, { wide: true });
}
