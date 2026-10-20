// Pieces shared by several views: images, status pips, the search bar, wish/entry descriptions.
import { h, icon, pad, debounce } from './dom.js';
import { parse, hasTerm, toggleTerm, termHelp } from './query.js';
import { variantImage, variantHas, formLabel, variantLabel, isPerfect, inMode, wishSatisfied } from './model.js';

const TYPE_COLORS = { normal: '#A8A77A', fire: '#EE8130', water: '#6390F0', electric: '#F7D02C', grass: '#7AC74C',
  ice: '#96D9D6', fighting: '#C22E28', poison: '#A33EA1', ground: '#E2BF65', flying: '#A98FF3', psychic: '#F95587',
  bug: '#A6B91A', rock: '#B6A136', ghost: '#735797', dragon: '#6F35FC', dark: '#705746', steel: '#B7B7CE', fairy: '#D685AD' };
const typeColor = t => TYPE_COLORS[t] || '#8a94a6';

/** The image for a variant, or a numbered placeholder when you have no image file for it. */
export function sprite(app, v, { size = 'm', silhouette = false } = {}) {
  const file = variantImage(v);
  const fx = [silhouette && 'sil', v.align === 'shadow' && 'fx-shadow', v.align === 'purified' && 'fx-purified',
    v.max === 'gigantamax' && !v.form.img?.[2] && 'fx-gmax'];
  if (!file) {
    return h('span', { class: ['art ph', `art-${size}`, ...fx], 'aria-hidden': 'true' }, icon('ball'), h('i', { text: pad(v.sp.dex) }));
  }
  return h('span', { class: ['art', `art-${size}`, ...fx] },
    h('img', { src: `${app.cfg.base}/media/sprites/${file}`, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' }));
}

export function typeChips(types) {
  return h('span', { class: 'types' }, types.map(t => h('span', { class: 'type', style: { '--t': typeColor(t) }, text: t })));
}

/** Little icons for what you have across a set of variants (a species or a form). */
export function pips(variants, mode, { max = 6 } = {}) {
  const has = v => variantHas(v, mode);
  const anyEntry = test => variants.some(v => v.entries.some(e => inMode(e, mode) && test(e)));
  const out = [];
  const add = (cond, name, title, cls = name) => { if (cond) out.push(h('span', { class: `pip p-${cls}`, title }, icon(name))); };
  const addText = (cond, text, title, cls) => { if (cond) out.push(h('span', { class: `pip pt p-${cls}`, title, text })); };
  add(variants.some(v => v.shiny && has(v)), 'shiny', 'Shiny');
  add(variants.some(v => v.align === 'shadow' && has(v)), 'shadow', 'Shadow');
  add(variants.some(v => v.align === 'purified' && has(v)), 'purified', 'Purified');
  add(anyEntry(e => e.lucky), 'lucky', 'Lucky');
  addText(anyEntry(isPerfect), '100', 'Perfect 15/15/15', 'perfect');
  addText(anyEntry(e => e.size === 'xxl'), 'XXL', 'XXL', 'size');
  addText(anyEntry(e => e.size === 'xxs'), 'XXS', 'XXS', 'size');
  add(anyEntry(e => !!e.bg), 'bg', 'Background');
  add(variants.some(v => v.form.kind === 'costume' && has(v)), 'costume', 'Costume');
  add(variants.some(v => v.max !== 'none' && has(v)), 'max', 'Dynamax / Gigantamax');
  add(variants.some(v => v.wishes.length), 'wish', 'On the wishlist');
  add(variants.some(v => v.entries.some(e => e.trade > 0)), 'trade', 'Available for trade');
  if (out.length > max) return h('span', { class: 'pips' }, out.slice(0, max - 1), h('span', { class: 'pip more', text: `+${out.length - max + 1}` }));
  return h('span', { class: 'pips' }, out);
}

/**
 * Search box + interpreted chips + quick filters. Quick filters only edit the query text.
 * opts: { placeholder, quick: [[word, label]], onChange(text) }
 */
export function searchBar(app, { text, placeholder, quick = [], onChange, trailing = null }) {
  const input = h('input', { type: 'search', class: 'q', value: text, placeholder, 'aria-label': 'Search',
    autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'search' });
  const chips = h('div', { class: 'qchips' });
  const quickRow = h('div', { class: 'quick', role: 'toolbar', 'aria-label': 'Quick filters' });
  const fire = debounce(() => onChange(input.value), 140);
  const paint = () => {
    const parsed = parse(input.value, app.model);
    chips.replaceChildren(...parsed.chips.map(c => h('button', {
      type: 'button', class: ['qchip', c.unknown && 'unknown'], title: c.unknown ? 'Nothing matches this word' : 'Remove',
      onclick: () => { input.value = input.value.split(',').map(s => s.trim()).filter(s => s && s !== c.text).join(', '); paint(); onChange(input.value); },
    }, c.unknown ? icon('help') : null, h('span', { text: c.label }), icon('close'))));
    quickRow.replaceChildren(...quick.map(([word, label]) => h('button', {
      type: 'button', class: ['qbtn', hasTerm(input.value, word) && 'on'], 'aria-pressed': String(hasTerm(input.value, word)),
      onclick: () => { input.value = toggleTerm(input.value, word); paint(); onChange(input.value); } }, label)));
  };
  input.addEventListener('input', () => { paint(); fire(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { input.blur(); } if (e.key === 'Escape') { input.value = ''; paint(); onChange(''); } });
  paint();
  const el = h('div', { class: 'searchbar' },
    h('div', { class: 'search' }, icon('search', 's-ic'), input,
      h('button', { type: 'button', class: 'iconbtn sm', 'aria-label': 'Search help', title: 'What can I type?', onclick: () => showHelp() }, icon('help'))),
    chips, trailing ? h('div', { class: 'quick-wrap' }, quickRow, trailing) : quickRow);
  return { el, input, setText(t) { input.value = t; paint(); } };
}

function showHelp() {
  import('./dom.js').then(({ modal }) => {
    const groups = termHelp();
    const body = h('div', { class: 'dlg-body help' },
      h('p', { class: 'lead' }, 'Combine words with commas. Everything you type becomes part of the page address, so you can share exactly what you see.'),
      h('div', { class: 'help-ex' }, [
        ['25', 'Pokédex #25'], ['1-151, shiny, missing', 'Kanto shinies I still need'], ['pikachu, costume', 'costumed Pikachu'],
        ['xxl, shiny', 'shiny XXLs'], ['shiny, !shadow', 'shiny but not Shadow'], ['pikachu | raichu', 'either one'],
        ['+eevee', 'the whole family'], ['@special rend', 'by move'], ['bg:madrid', 'by background name'], ['#pvp', 'by tag'],
      ].map(([q, d]) => h('div', {}, h('code', { text: q }), h('span', { text: d })))),
      h('p', { class: 'muted' }, `"missing" means it counts towards completion and you don't have it. Combine it: "shadow, missing", "xxl, missing", "background, missing" (backgrounds on your wishlist).`),
      [...groups].map(([g, terms]) => h('section', {}, h('h3', { text: g }), h('div', { class: 'help-terms' },
        terms.map(t => h('div', { class: 'help-term', title: t.help }, h('code', { text: t.key }),
          h('span', { text: t.label + (t.aliases.length ? ` · also ${t.aliases.slice(0, 3).join(', ')}` : '') })))))));
    modal('Search', body, { wide: true });
  });
}

// ---------------------------------------------------------------- wishes
export function wishTitle(w) {
  if (w.title) return w.title;
  const bits = [];
  if (w.shiny === 1) bits.push('Shiny');
  if (w.align === 'shadow') bits.push('Shadow');
  if (w.align === 'purified') bits.push('Purified');
  if (w.lucky === 1) bits.push('Lucky');
  if (w.max === 'dynamax') bits.push('Dynamax');
  if (w.max === 'gigantamax') bits.push('Gigantamax');
  bits.push(w.form ? formLabel(w.form) : w.sp.name);
  return bits.join(' ');
}

export function wishChips(w, m) {
  const c = [];
  const chip = (text, cls = '') => c.push(h('span', { class: `chip ${cls}`, text }));
  if (w.size) chip(w.size.toUpperCase(), 'c-size');
  if (w.minIv.every(x => x === 15)) chip('15/15/15', 'c-perfect');
  else if (w.minIv.some(x => x !== null)) chip(`IVs ≥ ${w.minIv.map(x => x ?? '-').join('/')}`, 'c-perfect');
  if (w.gender) chip(w.gender === 'female' ? '♀ Female' : '♂ Male');
  if (w.bg) chip(m.backgrounds.get(w.bg)?.name || 'Background', 'c-bg');
  else if (w.background) chip({ any: 'Any background', location: 'Location background', special: 'Special background' }[w.background], 'c-bg');
  if (w.moves) chip(`Move: ${w.moves}`, 'c-move');
  for (const t of w.tags) chip(m.tags.get(t)?.label || t, 'c-tag');
  return c;
}

/** The variant to picture for a wish. */
function wishVariant(w) {
  return w.variants.find(v => v.form.kind !== 'mega' || w.form) || w.sp.variants[0];
}

export function wishCard(app, w, { onEdit } = {}) {
  const m = app.model;
  const v = wishVariant(w);
  const got = w.status === 'open' && wishSatisfied(w, m);
  return h('article', { class: ['wish', `pr-${w.priority}`, w.status !== 'open' && 'closed'] },
    h('a', { class: 'wish-art', href: app.href('dex', { dex: w.dex, form: w.form?.id }), 'data-nav': '1', 'aria-label': `Open ${w.sp.name}` },
      v ? sprite(app, v, { size: 's' }) : null),
    h('div', { class: 'wish-body' },
      h('div', { class: 'wish-top' }, h('span', { class: 'no', text: `#${pad(w.dex)}` }),
        w.priority !== 'normal' ? h('span', { class: `prio prio-${w.priority}`, text: w.priority === 'high' ? 'High' : 'Someday' }) : null,
        w.status !== 'open' ? h('span', { class: 'chip', text: w.status === 'fulfilled' ? 'Got it' : 'Archived' }) : null,
        got ? h('span', { class: 'chip c-ok', title: 'One in your Pokédex matches' }, icon('check'), 'Have one') : null,
        app.admin && !w.public ? h('span', { class: 'chip', text: 'Private' }) : null),
      h('h3', { text: wishTitle(w) }),
      h('div', { class: 'chips' }, wishChips(w, m)),
      w.note ? h('p', { class: 'note', text: w.note }) : null,
      app.admin && w.privateNote ? h('p', { class: 'note private', text: w.privateNote }) : null),
    onEdit ? h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Edit wish', onclick: () => onEdit(w) }, icon('edit')) : null);
}

// ---------------------------------------------------------------- entries
export function entryChips(e, m) {
  const c = [];
  const chip = (text, cls = '') => c.push(h('span', { class: `chip ${cls}`, text }));
  if (e.size) chip(e.size.toUpperCase(), 'c-size');
  if (e.lucky) chip('Lucky', 'c-lucky');
  if (isPerfect(e)) chip('15/15/15', 'c-perfect');
  else if (e.iv) chip(`IVs ${e.iv.map(x => x ?? '-').join('/')}`);
  if (e.gender === 'female') chip('♀');
  if (e.gender === 'male') chip('♂');
  if (e.bg) chip(m.backgrounds.get(e.bg)?.name || 'Background', 'c-bg');
  if (e.moves) chip(e.moves, 'c-move');
  if (e.cp) chip(`CP ${e.cp}`);
  if (e.nickname) chip(`"${e.nickname}"`);
  for (const t of e.tags) chip(m.tags.get(t)?.label || t, 'c-tag');
  return c;
}

export function entryLine(e) {
  return e.trade ? `${e.trade} for trade` : (e.registered ? '' : 'not in the Pokédex');
}

export { variantLabel, formLabel };
