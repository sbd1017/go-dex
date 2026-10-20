// Turns the server's dataset into linked objects the views and the search engine work on.
// Pure (no DOM), so it runs in Node tests too.

const ALIGN = ['normal', 'shadow', 'purified'];
const MAX = ['none', 'dynamax', 'gigantamax'];

export function norm(s) {
  return String(s ?? '').replace(/♀/g, ' f').replace(/♂/g, ' m').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const ENTRY_LONG = { id: 'id', v: 'variant_id', r: 'registered', o: 'owned', t: 'for_trade', g: 'gender', sz: 'size',
  l: 'lucky', ia: 'iv_atk', id_: 'iv_def', is: 'iv_sta', bg: 'background_id', mv: 'moves', cp: 'cp', nn: 'nickname',
  co: 'caught_on', n: 'note', pn: 'private_note', u: 'updated_at', tags: 'tags' };

/** Normalise an entry from either the compact dataset form or a full API row. */
function entryFrom(raw) {
  const r = {};
  for (const [k, v] of Object.entries(raw)) r[ENTRY_LONG[k] || k] = v;
  const iv = [r.iv_atk, r.iv_def, r.iv_sta];
  return {
    id: r.id, variantId: r.variant_id, registered: !!r.registered, owned: r.owned || 0, trade: r.for_trade || 0,
    gender: r.gender || '', size: r.size || '', lucky: !!r.lucky,
    iv: iv.every(x => x === null || x === undefined) ? null : iv.map(x => (x ?? null)),
    bg: r.background_id || null, moves: r.moves || '', cp: r.cp || null, nickname: r.nickname || '',
    caughtOn: r.caught_on || null, note: r.note || '', privateNote: r.private_note || '', tags: r.tags || [],
    updatedAt: r.updated_at || '',
  };
}

export const isPerfect = e => !!e.iv && e.iv.every(x => x === 15);
export const isSpecial = e => !!(e.gender || e.size || e.lucky || e.iv || e.bg || e.moves || e.cp || e.nickname);

export function buildModel(ds) {
  const m = {
    raw: ds, admin: !!ds.admin, version: ds.version, settings: ds.settings || {},
    species: [], byDex: new Map(), forms: [], formById: new Map(), variants: [], variantById: new Map(),
    entries: [], wishes: [], backgrounds: new Map(), tags: new Map(),
  };
  for (const s of ds.species) {
    const sp = { ...s, n: norm(s.name), forms: [], variants: [], wishes: [] };
    m.species.push(sp); m.byDex.set(sp.dex, sp);
  }
  for (const f of ds.forms) {
    const sp = m.byDex.get(f.dex);
    const form = { ...f, sp, n: norm(f.name), full: norm(`${sp.name} ${f.name}`), variants: [] };
    m.forms.push(form); m.formById.set(form.id, form); sp.forms.push(form);
  }
  for (const [id, fi, shiny, a, x, target] of ds.variants) {
    const form = m.forms[fi];
    const v = { id, form, sp: form.sp, shiny: !!shiny, align: ALIGN[a], max: MAX[x], target: !!target, entries: [], wishes: [] };
    m.variants.push(v); m.variantById.set(id, v); form.variants.push(v); form.sp.variants.push(v);
  }
  for (const [id, name, kind, year] of ds.backgrounds) m.backgrounds.set(id, { id, name, kind, year, n: norm(name) });
  for (const [slug, label] of ds.tags) m.tags.set(slug, { slug, label, n: norm(label) });
  for (const raw of ds.entries) addEntry(m, entryFrom(raw));
  for (const w of ds.wishes) addWish(m, w);
  return m;
}

function addEntry(m, e) {
  const v = m.variantById.get(e.variantId);
  if (!v) return;
  e.v = v; v.entries.push(e); m.entries.push(e);
}

/** Replace all entries of the given variants (after a quick edit). */
export function replaceEntries(m, variantIds, rows) {
  const ids = new Set(variantIds);
  m.entries = m.entries.filter(e => !ids.has(e.variantId));
  for (const id of ids) { const v = m.variantById.get(id); if (v) v.entries = []; }
  for (const r of rows) addEntry(m, entryFrom(r));
}

function addWish(m, raw) {
  const sp = m.byDex.get(raw.dex);
  if (!sp) return;
  const w = {
    id: raw.id, dex: raw.dex, sp, form: raw.form_id ? m.formById.get(raw.form_id) || null : null,
    shiny: raw.shiny ?? null, align: raw.alignment ?? null, max: raw.max ?? null, gender: raw.gender ?? null,
    size: raw.size ?? null, lucky: raw.lucky ?? null,
    minIv: [raw.min_iv_atk ?? null, raw.min_iv_def ?? null, raw.min_iv_sta ?? null],
    background: raw.background ?? null, bg: raw.background_id ?? null, moves: raw.moves || '', title: raw.title || '',
    note: raw.note || '', privateNote: raw.private_note || '', priority: raw.priority || 'normal',
    status: raw.status || 'open', public: raw.public ?? 1, tags: raw.tags || [], createdAt: raw.created_at || '',
    updatedAt: raw.updated_at || '', fulfilledAt: raw.fulfilled_at || null, raw,
  };
  w.variants = wishVariants(w);
  if (w.status === 'open') for (const v of w.variants) v.wishes.push(w);
  sp.wishes.push(w);
  m.wishes.push(w);
}

/** Variants a wish could be satisfied by (its requirements at variant level). */
function wishVariants(w) {
  return w.sp.variants.filter(v =>
    (!w.form || v.form === w.form) && (w.shiny === null || v.shiny === !!w.shiny) &&
    (w.align === null || v.align === w.align) && (w.max === null || v.max === w.max) &&
    (w.form || v.form.kind !== 'mega'));
}

/** Does this owned entry meet the wish's per-Pokémon requirements? */
export function entrySatisfies(w, e, m) {
  if (!e.registered) return false;
  if (w.size && e.size !== w.size) return false;
  if (w.lucky !== null && e.lucky !== !!w.lucky) return false;
  if (w.gender && e.gender !== w.gender) return false;
  if (w.bg && e.bg !== w.bg) return false;
  if (w.background) {
    if (!e.bg) return false;
    if (w.background !== 'any' && m.backgrounds.get(e.bg)?.kind !== w.background) return false;
  }
  for (let i = 0; i < 3; i++) if (w.minIv[i] !== null && !(e.iv && e.iv[i] !== null && e.iv[i] >= w.minIv[i])) return false;
  if (w.moves && !norm(e.moves).includes(norm(w.moves))) return false;
  return true;
}

export const wishSatisfied = (w, m) => w.variants.some(v => v.entries.some(e => entrySatisfies(w, e, m)));

/** Does this entry count as having it? The app always uses 'registered' (in your Pokédex). */
export const inMode = (e, mode) => (mode === 'registered' ? e.registered : e.owned > 0);
export const variantHas = (v, mode) => v.entries.some(e => inMode(e, mode));
export const owned = v => v.entries.reduce((n, e) => n + e.owned, 0);
export const forTrade = v => v.entries.reduce((n, e) => n + e.trade, 0);

export function variantLabel(v, { withName = true } = {}) {
  const parts = [];
  if (v.shiny) parts.push('Shiny');
  if (v.align === 'shadow') parts.push('Shadow');
  if (v.align === 'purified') parts.push('Purified');
  if (v.max === 'dynamax') parts.push('Dynamax');
  if (v.max === 'gigantamax') parts.push('Gigantamax');
  if (withName) parts.push(formLabel(v.form));
  else if (!parts.length) parts.push('Normal');
  return parts.join(' ');
}

export function formLabel(f) {
  if (!f.name) return f.sp.name;
  if (f.kind === 'mega') {                       // names are 'Mega', 'Mega X', 'Primal'
    const [word, ...rest] = f.name.split(' ');
    return [word, f.sp.name, ...rest].join(' ');
  }
  if (f.kind === 'regional' && /^(Alolan|Galarian|Hisuian|Paldean)$/.test(f.name)) return `${f.name} ${f.sp.name}`;
  return `${f.sp.name} (${f.name})`;
}

/** Image file for a variant: [normal, shiny, gmax, gmax shiny]. */
export function variantImage(v) {
  const [n, s, g, gs] = v.form.img || [];
  if (v.max === 'gigantamax') return (v.shiny ? gs || g || s : g) || n;
  return (v.shiny ? s : n) || n || null;
}
