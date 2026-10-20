// The search language, shared by the Pokédex, Wishlist and Trade views (and by the quick-filter buttons, which
// only ever write query text). Pure: no DOM, testable in Node.
//
//   ,  or  &     AND       shiny, missing
//   |  or  ;     OR        pikachu | raichu
//   !            NOT       shiny, !shadow
//   25  1-151  -151  152-       National Dex number / range
//   +name        evolution family          @text   move           #tag    tag
//   key:value    bg:madrid  form:libre  type:fire  gen:4  tag:pvp  note:text
//   anything else is matched against Pokémon / form names (an exact name wins: "mew" is not Mewtwo)
//
// Every keyword is a term in TERMS below. A term says how it tests each kind of record:
//   species(sp, form)  facts about the Pokémon/form           (used for variants, wishes and trade offers)
//   variant(v, ctx)    facts about a variant                  (shiny, shadow, Gigantamax ...)
//   entry(e, ctx)      facts about one Pokémon you have        (XXL, lucky, background ...)
//   wish(w, ctx)       how the same word applies to a wish
// Adding a search word = adding one object here.

import { norm, isPerfect, variantHas, inMode, wishSatisfied, entrySatisfies } from './model.js';

const REGIONS = ['kanto', 'johto', 'hoenn', 'sinnoh', 'unova', 'kalos', 'alola', 'galar', 'hisui', 'paldea'];
const TYPES = ['normal', 'fire', 'water', 'grass', 'electric', 'ice', 'fighting', 'poison', 'ground', 'flying',
  'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'];
const SIZE = { xxl: 'XXL', xxs: 'XXS', xl: 'XL', xs: 'XS' };

const wishForm = (w, test) => (w.form ? test(w.form) : false);
const bgKind = (ctx, id) => ctx.model.backgrounds.get(id)?.kind;

export const TERMS = [];
const def = t => { TERMS.push(t); return t; };

// ---- states (what you have) -------------------------------------------------
def({ key: 'owned', aliases: ['own', 'have', 'got'], group: 'Collection', label: 'Owned', state: true,
  help: 'You currently have one', entry: e => e.owned > 0, wish: (w, c) => wishSatisfied(w, c.model) });
def({ key: 'registered', aliases: ['reg', 'caught', 'seen'], group: 'Collection', label: 'Registered', state: true,
  help: 'In your Pokédex (even if transferred)', entry: e => e.registered, wish: (w, c) => wishSatisfied(w, c.model) });
def({ key: 'trade', aliases: ['fortrade', 'tradeable', 'tradable', 'offer'], group: 'Collection', label: 'For trade',
  state: true, help: 'Available for trade', entry: e => e.trade > 0, wish: () => false });
def({ key: 'missing', aliases: ['need', 'needed', 'unregistered', 'todo'], group: 'Collection', label: 'Missing', special: 'missing',
  help: "Counts towards completion and you don't have it (combine: shiny, missing / xxl, missing)",
  wish: (w, c) => w.status === 'open' && !wishSatisfied(w, c.model) });
def({ key: 'wish', aliases: ['wishlist', 'wanted', 'want', 'wishlisted'], group: 'Collection', label: 'Wishlist',
  help: 'On the wishlist', variant: v => v.wishes.length > 0, wish: () => true });
def({ key: 'high', group: 'Wishlist', label: 'High priority',
  variant: v => v.wishes.some(w => w.priority === 'high'), wish: w => w.priority === 'high' });
def({ key: 'someday', aliases: ['low'], group: 'Wishlist', label: 'Someday',
  variant: v => v.wishes.some(w => w.priority === 'someday'), wish: w => w.priority === 'someday' });
def({ key: 'open', group: 'Wishlist', label: 'Open wishes', wish: w => w.status === 'open', variant: v => v.wishes.length > 0 });
def({ key: 'fulfilled', aliases: ['done', 'got-it'], group: 'Wishlist', label: 'Fulfilled', wish: w => w.status === 'fulfilled' });
def({ key: 'archived', group: 'Wishlist', label: 'Archived', wish: w => w.status === 'archived' });
def({ key: 'unreleased', aliases: ['all', 'untracked'], group: 'Collection', label: "Doesn't count",
  help: 'Variants that do not count towards completion (not released, battle-only ...)', variant: v => !v.target });

// ---- variant identity ----------------------------------------------------------
def({ key: 'shiny', aliases: ['shinies'], group: 'Variant', label: 'Shiny', variant: v => v.shiny, wish: w => w.shiny === 1 });
def({ key: 'shadow', aliases: ['shadows'], group: 'Variant', label: 'Shadow', variant: v => v.align === 'shadow', wish: w => w.align === 'shadow' });
def({ key: 'purified', group: 'Variant', label: 'Purified', variant: v => v.align === 'purified', wish: w => w.align === 'purified' });
def({ key: 'dynamax', aliases: ['dmax'], group: 'Variant', label: 'Dynamax', variant: v => v.max === 'dynamax', wish: w => w.max === 'dynamax' });
def({ key: 'gigantamax', aliases: ['gmax', 'g-max'], group: 'Variant', label: 'Gigantamax', variant: v => v.max === 'gigantamax', wish: w => w.max === 'gigantamax' });
def({ key: 'max', aliases: ['maxbattle'], group: 'Variant', label: 'Dynamax or Gigantamax', variant: v => v.max !== 'none', wish: w => !!w.max && w.max !== 'none' });

// ---- per-Pokémon details (things that differ between individuals) ---------------
for (const [k, label] of Object.entries(SIZE)) {
  def({ key: k, group: 'Details', label, entry: e => e.size === k, wish: w => w.size === k });
}
def({ key: 'lucky', aliases: ['luckies'], group: 'Details', label: 'Lucky', entry: e => e.lucky, wish: w => w.lucky === 1 });
def({ key: 'perfect', aliases: ['hundo', '4*', '15-15-15', '151515', 'hundos'], group: 'Details', label: 'Perfect (15/15/15)',
  entry: isPerfect, wish: w => w.minIv.every(x => x === 15) });
def({ key: 'background', aliases: ['bg', 'backgrounds'], group: 'Details', label: 'Background', help: 'Any location or special background',
  entry: e => !!e.bg, wish: w => !!(w.background || w.bg) });
def({ key: 'locationbackground', aliases: ['location', 'locationbg'], group: 'Details', label: 'Location background',
  entry: (e, c) => !!e.bg && bgKind(c, e.bg) === 'location', wish: (w, c) => w.background === 'location' || (!!w.bg && bgKind(c, w.bg) === 'location') });
def({ key: 'specialbackground', aliases: ['special', 'specialbg'], group: 'Details', label: 'Special background',
  entry: (e, c) => !!e.bg && bgKind(c, e.bg) === 'special', wish: (w, c) => w.background === 'special' || (!!w.bg && bgKind(c, w.bg) === 'special') });
def({ key: 'female', group: 'Details', label: 'Female', entry: e => e.gender === 'female', wish: w => w.gender === 'female' });
def({ key: 'male', group: 'Details', label: 'Male', entry: e => e.gender === 'male', wish: w => w.gender === 'male' });

// ---- forms ----------------------------------------------------------------------
const formTerm = (key, aliases, label, test, help) => def({ key, aliases, group: 'Form', label, help, form: true,
  species: (sp, f) => !!f && test(f), wish: w => wishForm(w, test) });
formTerm('costume', ['costumes', 'costumed', 'hat'], 'Costume', f => f.kind === 'costume');
formTerm('event', ['events'], 'Event forms', f => f.kind === 'costume' || f.kind === 'event', 'Costumes and other event forms');
formTerm('clone', ['copy'], 'Clone', f => f.code === 'COPY_2019');
formTerm('regional', ['regionals', 'regionalform'], 'Regional form', f => f.kind === 'regional');
for (const r of ['alolan', 'galarian', 'hisuian', 'paldean']) formTerm(r, [], r[0].toUpperCase() + r.slice(1), f => f.rt === r);
formTerm('mega', ['megas', 'primal'], 'Mega / Primal', f => f.kind === 'mega');
formTerm('form', ['forms', 'alternate'], 'Any non-standard form', f => f.kind !== 'base');
formTerm('genderform', ['dimorphic'], 'Visible gender difference', f => !!f.sp.gd);

// ---- species facts ----------------------------------------------------------------
const spTerm = (key, aliases, group, label, test) => def({ key, aliases, group, label, species: sp => test(sp), wish: w => test(w.sp) });
spTerm('legendary', ['legendaries', 'legend'], 'Pokémon', 'Legendary', sp => sp.class === 'legendary');
spTerm('mythical', ['mythic', 'mythicals'], 'Pokémon', 'Mythical', sp => sp.class === 'mythical');
spTerm('ultrabeast', ['ub', 'ultra-beast', 'ultrabeasts'], 'Pokémon', 'Ultra Beast', sp => sp.class === 'ultra_beast');
for (const r of REGIONS) spTerm(r, [], 'Region', r[0].toUpperCase() + r.slice(1), sp => sp.region === r);
for (let g = 1; g <= 9; g++) spTerm(`gen${g}`, [`generation${g}`, `g${g}`], 'Region', `Generation ${g}`, sp => sp.gen === g);
for (const t of TYPES) {
  def({ key: t, group: 'Type', label: t[0].toUpperCase() + t.slice(1), species: (sp, f) => (f ? f.types : sp.types).includes(t),
    wish: w => (w.form ? w.form.types : w.sp.types).includes(t) });
}

const BY_KEY = new Map();
for (const t of TERMS) for (const k of [t.key, ...(t.aliases || [])]) BY_KEY.set(k, t);

// ---- dynamic atoms (need an argument) ----------------------------------------------
const DEX = { key: 'dex', label: 'Pokédex number', group: 'Pokémon',
  species: (sp, f, a) => sp.dex >= a.lo && sp.dex <= a.hi, wish: (w, c, a) => w.dex >= a.lo && w.dex <= a.hi };
const FAMILY = { key: 'family', label: 'Family', group: 'Pokémon',
  species: (sp, f, a) => a.families.has(sp.family), wish: (w, c, a) => a.families.has(w.sp.family) };
const MOVE = { key: 'move', label: 'Move', group: 'Details',
  entry: (e, c, a) => norm(e.moves).includes(a.text), wish: (w, c, a) => norm(w.moves).includes(a.text) };
const TAG = { key: 'tag', label: 'Tag', group: 'Details',
  entry: (e, c, a) => e.tags.includes(a.slug), wish: (w, c, a) => w.tags.includes(a.slug) };
const BG = { key: 'bg', label: 'Background', group: 'Details',
  entry: (e, c, a) => !!e.bg && a.ids.has(e.bg), wish: (w, c, a) => !!w.bg && a.ids.has(w.bg) };
const NOTE = { key: 'note', label: 'Note', group: 'Details',
  entry: (e, c, a) => norm(`${e.note} ${e.privateNote} ${e.nickname}`).includes(a.text),
  wish: (w, c, a) => norm(`${w.title} ${w.note} ${w.privateNote}`).includes(a.text) };
const TYPE = { key: 'type', label: 'Type', group: 'Type',
  species: (sp, f, a) => (f ? f.types : sp.types).includes(a.text), wish: (w, c, a) => (w.form ? w.form.types : w.sp.types).includes(a.text) };
// Several words match in any order ("origin palkia" finds "Palkia (Origin Forme)").
const has = (hay, text) => (text.includes(' ') ? text.split(' ').every(w => hay.includes(w)) : hay.includes(text));
const NAME = { key: 'name', label: 'Name', group: 'Pokémon',
  species: (sp, f, a) => (a.exact ? a.exact.has(sp.dex) && (!f || !a.formOnly || has(f.n, a.text))
    : has(sp.n, a.text) || (!!f && (has(f.n, a.text) || has(f.full, a.text)))),
  wish: (w, c, a) => NAME.species(w.sp, w.form, a) || norm(`${w.title} ${w.note}`).includes(a.text) };

/**
 * Parse query text. Needs the model only for names, families, tags and backgrounds.
 * Returns { terms: [{ atoms: [atom] }], chips: [{ text, label, unknown }], formLevel }.
 */
export function parse(text, model) {
  const terms = [];
  const chips = [];
  let formLevel = false;
  for (const rawTerm of String(text || '').split(/[,&\n]+/)) {
    const atoms = [];
    for (let raw of rawTerm.split(/[|;]+/)) {
      raw = raw.trim();
      if (!raw) continue;
      const atom = parseAtom(raw, model);
      atoms.push(atom);
      if (atom.def.form || (atom.def === NAME && atom.arg.formOnly)) formLevel = true;
    }
    if (atoms.length) {
      terms.push({ atoms });
      chips.push({ text: rawTerm.trim(), label: atoms.map(a => (a.neg ? 'not ' : '') + a.label).join(' or '),
        unknown: atoms.some(a => a.unknown) });
    }
  }
  return { terms, chips, formLevel };
}

function parseAtom(raw, model) {
  let neg = false;
  let s = raw;
  while (s.startsWith('!')) { neg = !neg; s = s.slice(1).trim(); }
  const low = s.toLowerCase();
  const atom = (d, arg = null, label = d.label, unknown = false) => ({ neg, def: d, arg, raw, label, unknown });
  let m;
  if ((m = low.match(/^#?(\d{1,4})$/))) return atom(DEX, { lo: +m[1], hi: +m[1] }, `#${m[1]}`);
  if ((m = low.match(/^(\d{0,4})\s*-\s*(\d{0,4})$/)) && (m[1] || m[2])) {
    const lo = m[1] ? +m[1] : 1, hi = m[2] ? +m[2] : 9999;
    return atom(DEX, { lo, hi }, `#${lo}-${m[2] ? hi : '...'}`);
  }
  if ((m = low.match(/^([a-z]+)\s*:\s*(.+)$/))) {
    const [, key, value] = m;
    const text = norm(value);
    if (key === 'bg' || key === 'background') {
      const ids = new Set([...model.backgrounds.values()].filter(b => b.n.includes(text) || b.id.toLowerCase() === value.trim()).map(b => b.id));
      return atom(BG, { ids }, `Background "${value.trim()}"`, ids.size === 0);
    }
    if (key === 'tag') return tagAtom(atom, model, value);
    if (key === 'note') return atom(NOTE, { text }, `Note "${value.trim()}"`);
    if (key === 'move') return atom(MOVE, { text }, `Move "${value.trim()}"`);
    if (key === 'type' && TYPES.includes(text)) return atom(TYPE, { text }, `Type ${text}`);
    if ((key === 'gen' || key === 'generation') && /^[1-9]$/.test(text)) return atom(BY_KEY.get(`gen${text}`));
    if (key === 'form') return atom(NAME, { text, formOnly: true }, `Form "${value.trim()}"`);
    if (key === 'priority' && ['high', 'normal', 'someday'].includes(text)) {
      return atom({ key: 'priority', label: `${text} priority`, group: 'Wishlist',
        variant: v => v.wishes.some(w => w.priority === text), wish: w => w.priority === text });
    }
  }
  if (s.startsWith('@')) return atom(MOVE, { text: norm(s.slice(1)) }, `Move "${s.slice(1).trim()}"`);
  if (s.startsWith('#')) return tagAtom(atom, model, s.slice(1));
  if (s.startsWith('+')) {
    const text = norm(s.slice(1));
    const sps = model.species.filter(sp => sp.n === text);
    const found = sps.length ? sps : model.species.filter(sp => sp.n.startsWith(text));
    return atom(FAMILY, { families: new Set(found.map(sp => sp.family)) }, `${found[0]?.name || s.slice(1)} family`, !found.length);
  }
  const t = BY_KEY.get(low) || BY_KEY.get(low.replace(/\s+/g, ''));
  if (t) return atom(t);
  // plain words: a Pokémon / form name, else a tag
  const text = norm(s);
  const exact = model.species.filter(sp => sp.n === text);
  if (exact.length) return atom(NAME, { text, exact: new Set(exact.map(sp => sp.dex)) }, exact[0].name);
  const anyName = model.species.some(sp => has(sp.n, text)) || model.forms.some(f => has(f.n, text) || has(f.full, text));
  if (!anyName) {
    const tag = [...model.tags.values()].find(tg => tg.slug === text.replace(/ /g, '-') || tg.n === text);
    if (tag) return atom(TAG, { slug: tag.slug }, tag.label);
  }
  const formOnly = !model.species.some(sp => has(sp.n, text)) && model.forms.some(f => has(f.n, text) || has(f.full, text));
  return atom(NAME, { text, formOnly }, `"${s}"`, !anyName);
}

function tagAtom(atom, model, value) {
  const text = norm(value);
  const tag = [...model.tags.values()].find(tg => tg.slug === text.replace(/ /g, '-') || tg.n === text);
  return atom(TAG, { slug: tag ? tag.slug : text.replace(/ /g, '-') }, `#${tag ? tag.label : value.trim()}`, !tag);
}

const isEntryAtom = a => !!a.def.entry && !a.def.species && !a.def.variant && !a.def.special;

/**
 * Compile a parsed query into a test for variants.
 * mode: 'owned' | 'registered' decides what "have" means unless the query says owned/registered/trade itself.
 */
export function compileVariants(q, mode, model) {
  const ctx = { model, mode };
  let missing = false, have = false, includeUntargeted = false;
  const eTerms = [], rTerms = [];
  for (const t of q.terms) {
    if (t.atoms.length === 1 && t.atoms[0].def.special === 'missing') {
      if (t.atoms[0].neg) have = true; else missing = true;
      continue;
    }
    if (t.atoms.some(a => a.def.key === 'unreleased' && !a.neg)) includeUntargeted = true;
    if (t.atoms.every(a => isEntryAtom(a) && !a.neg)) eTerms.push(t); else rTerms.push(t);
  }
  const stateGiven = eTerms.some(t => t.atoms.some(a => a.def.state));
  const entryOk = e => (stateGiven || inMode(e, mode)) && eTerms.every(t => t.atoms.some(a => a.def.entry(e, ctx, a.arg)));
  const bgMissing = missing && eTerms.some(t => t.atoms.some(a => ['background', 'locationbackground', 'specialbackground', 'bg'].includes(a.def.key)));

  const atomOn = (a, v) => {
    let r;
    if (a.def.special === 'missing') r = v.target && !variantHas(v, mode);
    else if (a.def.species) r = a.def.species(v.sp, v.form, a.arg);
    else if (a.def.variant) r = a.def.variant(v, ctx, a.arg);
    else if (a.def.entry) r = v.entries.some(e => (a.def.state || inMode(e, mode)) && a.def.entry(e, ctx, a.arg));
    else r = false;
    return a.neg ? !r : r;
  };
  return v => {
    if (!includeUntargeted && !v.target && !v.entries.length) return false;
    for (const t of rTerms) if (!t.atoms.some(a => atomOn(a, v))) return false;
    if (missing) {
      if (!v.target && !bgMissing) return false;
      if (bgMissing) return v.wishes.some(w => (w.background || w.bg) && !v.entries.some(e => entrySatisfies(w, e, model)));
      return !v.entries.some(entryOk);
    }
    if (have || eTerms.length) return v.entries.some(entryOk);
    return true;
  };
}

/** Test for wishes. Words with no wish meaning are ignored rather than hiding everything. */
export function compileWishes(q, model) {
  const ctx = { model };
  return w => q.terms.every(t => t.atoms.some(a => {
    const fn = a.def.wish;
    if (!fn) return !a.neg;
    const r = !!fn(w, ctx, a.arg);
    return a.neg ? !r : r;
  }));
}

/** Test for trade offers: one owned entry with for_trade > 0. */
export function compileOffers(q, model) {
  const ctx = { model, mode: 'owned' };
  return e => q.terms.every(t => t.atoms.some(a => {
    let r;
    if (a.def.special === 'missing') r = false;
    else if (a.def.species) r = a.def.species(e.v.sp, e.v.form, a.arg);
    else if (a.def.variant) r = a.def.variant(e.v, ctx, a.arg);
    else if (a.def.entry) r = a.def.entry(e, ctx, a.arg);
    else r = true;
    return a.neg ? !r : r;
  }));
}

/** Toggle one simple word in a query string (used by the quick-filter buttons). */
export function toggleTerm(text, word) {
  const parts = String(text || '').split(',').map(s => s.trim()).filter(Boolean);
  const i = parts.findIndex(p => p.toLowerCase() === word.toLowerCase());
  if (i >= 0) parts.splice(i, 1); else parts.push(word);
  return parts.join(', ');
}
export const hasTerm = (text, word) =>
  String(text || '').split(',').some(p => p.trim().toLowerCase() === word.toLowerCase());

/** Help listing, generated from the registry. */
export function termHelp() {
  const groups = new Map();
  for (const t of TERMS) {
    if (!groups.has(t.group)) groups.set(t.group, []);
    groups.get(t.group).push({ key: t.key, aliases: t.aliases || [], label: t.label, help: t.help || '' });
  }
  return groups;
}

// ---- URLs: ?shiny&missing  (falls back to ?q=... when a term needs it) ---------------
const RESERVED = new Set(['q', 'mode', 'group', 'sort', 'f']);

export function queryFromSearch(search) {
  const params = new URLSearchParams(search);
  const parts = [];
  const opts = {};
  for (const [k, v] of params) {
    if (k === 'q') parts.push(v);
    else if (RESERVED.has(k)) opts[k] = v;
    else parts.push(v ? `${k}:${v}` : k);
  }
  return { text: parts.join(', '), ...opts };
}

export function searchFromQuery(text, opts = {}) {
  const parts = String(text || '').split(',').map(s => s.trim()).filter(Boolean);
  const simple = parts.every(p => /^[!a-z0-9*+@#-]+$/i.test(p) && !RESERVED.has(p.toLowerCase()));
  const out = [];
  if (parts.length) {
    if (simple) out.push(...parts.map(p => encodeURIComponent(p.toLowerCase())));
    else out.push('q=' + encodeURIComponent(parts.join(', ')));
  }
  for (const [k, v] of Object.entries(opts)) if (v) out.push(`${k}=${encodeURIComponent(v)}`);
  return out.length ? '?' + out.join('&') : '';
}

// ---- trade compare: a visitor's free-text lines ------------------------------------------
/**
 * "shiny alolan vulpix" -> "shiny, alolan, vulpix". Keywords become terms; the other words stay together as a name,
 * so "mr mime" or "tapu koko" work. Commas inside a line are kept as they are.
 */
export function itemToQuery(line) {
  const s = String(line || '').trim().replace(/^[-*•]\s*/, '');
  if (!s || s.includes(',')) return s;
  const parts = [], name = [];
  const flush = () => { if (name.length) { parts.push(name.join(' ')); name.length = 0; } };
  for (const word of s.split(/\s+/)) {
    const w = word.toLowerCase();
    if (BY_KEY.has(w) || /^[!#+@]/.test(w) || /^#?\d{1,4}$/.test(w) || /^\d{0,4}-\d{0,4}$/.test(w) || /^[a-z]+:/.test(w)) {
      flush(); parts.push(word);
    } else name.push(word);
  }
  flush();
  return parts.join(', ');
}

/** Variants a description could mean, whatever anyone owns. Per-Pokémon details (xxl, lucky ...) are returned separately. */
export function compileCandidates(q) {
  const details = [];
  for (const t of q.terms) for (const a of t.atoms) if (isEntryAtom(a) && !a.def.state && !a.neg) details.push(a);
  // Unless they say otherwise, people mean the plain one (shadow Pokémon can't be traded anyway).
  const said = k => q.terms.some(t => t.atoms.some(a => k.includes(a.def.key)));
  const alignSaid = said(['shadow', 'purified']), maxSaid = said(['dynamax', 'gigantamax', 'max']);
  const test = v => (alignSaid || v.align === 'normal') && (maxSaid || v.max === 'none') && q.terms.every(t => t.atoms.some(a => {
    let r;
    if (a.def.species) r = a.def.species(v.sp, v.form, a.arg);
    else if (a.def.variant && a.def.key !== 'wish' && !['high', 'someday', 'open'].includes(a.def.key)) r = a.def.variant(v, {}, a.arg);
    else return true;                                       // details, states and wishlist words don't narrow variants
    return a.neg ? !r : r;
  }));
  return { test, details };
}
