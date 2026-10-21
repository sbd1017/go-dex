// The species sheet (/dex/<number>): forms, every variant with what you have (special ones under the chosen variant), wishes.
// In admin mode the selected variant gets the quick editor (in my Pokédex / for trade) and the dialogs.
import { h, icon, pad, fmt, toast, copyText, modal } from '../dom.js';
import { variantHas, variantLabel, formLabel, isSpecial, forTrade, canHave } from '../model.js';
import { searchFromQuery } from '../query.js';
import { sprite, typeChips, entryChips, entryLine, wishCard, pips } from '../components.js';
import { entryEditor, wishEditor } from '../editors.js';

const REGION = { kanto: 'Kanto', johto: 'Johto', hoenn: 'Hoenn', sinnoh: 'Sinnoh', unova: 'Unova', kalos: 'Kalos',
  alola: 'Alola', galar: 'Galar', hisui: 'Hisui', paldea: 'Paldea' };
const CLASS = { legendary: 'Legendary', mythical: 'Mythical', ultra_beast: 'Ultra Beast' };
const ORDER = v => ['none', 'dynamax', 'gigantamax'].indexOf(v.max) * 10 + ['normal', 'shadow', 'purified'].indexOf(v.align) * 2 + (v.shiny ? 1 : 0);

let sheet = null;   // { dex, formId, varId, wrap }

export function sync(app, { refresh = false } = {}) {
  const dex = app.route?.dex;
  const sp = dex && app.model.byDex.get(dex);
  if (!sp) { close(); return; }
  if (!sheet || sheet.dex !== dex) {
    close(false);
    const form = (app.route.form && sp.forms.find(f => f.id === app.route.form)) || defaultForm(sp, app);
    sheet = { dex, formId: form.id, varId: null, scroll: 0 };
    open(app, sp);
  } else {
    if (app.route.form && app.route.form !== sheet.formId) { sheet.formId = app.route.form; sheet.varId = null; }
    paint(app, sp);
  }
}

function defaultForm(sp, app) {
  return sp.forms.find(f => f.variants.some(v => variantHas(v, app.mode))) || sp.forms.find(f => f.kind === 'base') || sp.forms[0];
}

function close(restoreFocus = true) {
  if (!sheet) return;
  sheet.wrap?.remove();
  document.documentElement.classList.remove('noscroll');
  if (restoreFocus) sheet.returnFocus?.focus?.({ preventScroll: true });
  sheet = null;
}

function leave(app) {
  const text = app.route.text;
  const url = app.href('dex', { text });
  if (history.length > 1 && app.navCount > 0) history.back();
  else app.go(url);
}

function open(app, sp) {
  sheet.returnFocus = document.activeElement;
  const wrap = h('div', { class: 'sheet-wrap', onclick: e => { if (e.target === wrap) leave(app); } });
  wrap.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { e.preventDefault(); leave(app); }
  });
  sheet.wrap = wrap;
  document.body.append(wrap);
  document.documentElement.classList.add('noscroll');
  paint(app, sp);
  wrap.querySelector('.sheet')?.focus({ preventScroll: true });
}

function step(app, sp, dir) {
  const all = app.model.species;
  const i = all.indexOf(sp) + dir;
  if (i < 0 || i >= all.length) return;
  const opts = {};
  history.replaceState(null, '', app.root(`/${all[i].dex}`) + searchFromQuery(app.route.text, opts));
  app.onRoute();
}

function paint(app, sp) {
  if (!sheet) return;
  const m = app.model, mode = app.mode;
  const form = sp.forms.find(f => f.id === sheet.formId) || sp.forms[0];
  const visible = v => v.target || v.entries.length || v.wishes.length;
  const vars = form.variants.filter(v => app.admin || visible(v)).sort((a, b) => ORDER(a) - ORDER(b));
  const counted = vars.filter(visible);
  const extra = vars.filter(v => !visible(v));
  if (!sheet.varId || !vars.some(v => v.id === sheet.varId)) sheet.varId = (counted.find(v => variantHas(v, mode)) || counted[0] || vars[0])?.id;
  const sel = m.variantById.get(sheet.varId);
  const old = sheet.wrap.querySelector('.sheet');
  const scroll = old ? old.scrollTop : 0;

  const spVars = sp.variants.filter(visible);
  const haveN = spVars.filter(v => v.target && variantHas(v, mode)).length;
  const targetN = spVars.filter(v => v.target).length;
  const tradeN = sp.variants.reduce((n, v) => n + forTrade(v), 0);
  const heroV = sel || counted[0];
  const types = form.types.length ? form.types : sp.types;

  const shareUrl = app.publicUrl(`/${sp.dex}`, searchFromQuery('', form.kind !== 'base' && sp.forms.length > 1 ? { f: form.id } : {}));
  const el = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title', tabindex: '-1',
    style: { '--t1': `var(--ty-${types[0]})`, '--t2': `var(--ty-${types[1] || types[0]})` } },
  h('div', { class: 'sheet-hero' },
    h('div', { class: 'sheet-tools' },
      h('button', { class: 'iconbtn glass', type: 'button', 'aria-label': 'Previous Pokémon', onclick: () => step(app, sp, -1) }, icon('left')),
      h('button', { class: 'iconbtn glass', type: 'button', 'aria-label': 'Next Pokémon', onclick: () => step(app, sp, 1) }, icon('right')),
      h('span', { class: 'grow' }),
      h('button', { class: 'iconbtn glass', type: 'button', 'aria-label': 'Copy link', title: 'Copy a link to this Pokémon',
        onclick: async () => toast((await copyText(shareUrl)) ? 'Link copied' : shareUrl) }, icon('link')),
      h('button', { class: 'iconbtn glass', type: 'button', 'aria-label': 'Close', onclick: () => leave(app) }, icon('close'))),
    h('div', { class: 'hero-art' }, heroV ? sprite(app, heroV, { size: 'l' }) : null),
    h('div', { class: 'hero-txt' },
      h('span', { class: 'no', text: `#${pad(sp.dex)}` }),
      h('h2', { id: 'sheet-title', text: form.kind === 'base' || !form.name ? sp.name : formLabel(form) }),
      heroV ? h('p', { class: 'hero-var', text: variantLabel(heroV, { withName: false }) }) : null,
      h('div', { class: 'hero-meta' }, typeChips(types),
        h('span', { class: 'meta', text: [`Gen ${sp.gen}`, REGION[sp.region], CLASS[sp.class]].filter(Boolean).join(' · ') })))),
  h('div', { class: 'sheet-body' },
    h('div', { class: 'facts' },
      fact(`${haveN}/${targetN}`, 'variants in the Pokédex'),
      tradeN ? fact(fmt(tradeN), 'for trade', 'f-trade') : null,
      sp.wishes.some(w => w.status === 'open') ? fact(fmt(sp.wishes.filter(w => w.status === 'open').length), 'wished for', 'f-wish') : null),
    sp.forms.length > 1 ? h('section', { class: 'blk' }, h('h3', { text: `Forms · ${sp.forms.length}` }),
      h('div', { class: 'forms', role: 'tablist' }, sp.forms.map(f => formChip(app, f, f === form, mode)))) : null,
    h('section', { class: 'blk' },
      h('h3', { text: sp.forms.length > 1 ? formLabel(form) : 'Variants' }),
      h('div', { class: 'vtiles' }, counted.map(v => tile(app, v, v === sel, mode)),
        app.admin ? h('button', { class: 'vt add', type: 'button', onclick: () => addVariant(app, form) }, icon('plus'), h('span', { text: 'Other variant' })) : null),
      extra.length ? h('details', { class: 'extra' }, h('summary', { text: `Not counted (${extra.length})` }),
        h('div', { class: 'vtiles' }, extra.map(v => tile(app, v, v === sel, mode)))) : null),
    sel ? variantPanel(app, sel, mode) : null,
    wishList(app, sp, form),
    app.admin ? recordSwitches(app, sp) : null));
  if (old) old.replaceWith(el); else sheet.wrap.append(el);
  el.scrollTop = scroll;
}

const fact = (value, label, cls = '') => h('div', { class: `fact ${cls}` }, h('b', { text: value }), h('span', { text: label }));

function formChip(app, f, on, mode) {
  const v = f.variants.find(x => x.target) || f.variants[0];
  const has = f.variants.some(x => variantHas(x, mode));
  return h('button', { type: 'button', role: 'tab', 'aria-selected': String(on), class: ['fchip', on && 'on', has ? 'have' : 'miss'],
    onclick: () => { sheet.formId = f.id; sheet.varId = null; paint(app, f.sp); } },
  v ? sprite(app, v, { size: 'xs', silhouette: !has }) : null, h('span', { text: f.name || 'Normal' }));
}

function tile(app, v, on, mode) {
  const has = variantHas(v, mode);
  const t = forTrade(v);
  let state = has ? 'In Pokédex' : 'Missing';
  if (t) state += ` · ${t} for trade`;
  if (!v.target && !v.entries.length) state = 'Not counted';
  return h('button', { type: 'button', class: ['vt', has ? 'have' : 'miss', on && 'on', !v.target && 'untracked'], 'aria-pressed': String(on),
    onclick: () => { sheet.varId = v.id; paint(app, v.sp); } },
  sprite(app, v, { size: 'm' }),
  h('span', { class: 'vt-l', text: variantLabel(v, { withName: false }) }),
  h('span', { class: 'vt-s', text: state }),
  h('span', { class: 'vt-p' }, pips([v], mode, { max: 4 })));
}

function variantPanel(app, v, mode) {
  const special = v.entries.filter(isSpecial);
  const plain = v.entries.find(e => !isSpecial(e));
  const body = [];
  if (app.admin) {
    const reg = !!plain?.registered;
    const regBySpecial = !reg && v.entries.some(e => e.registered);
    const pTrade = plain?.trade || 0;
    const quick = async (op, msg) => {
      try {
        const data = await app.post('quick', { variant_id: v.id, ...op });
        await app.saved(data, msg, { variantIds: [v.id] });
      } catch { /* toast shown */ }
    };
    body.push(h('div', { class: 'editor' },
      h('label', { class: 'switch', title: regBySpecial ? 'In the Pokédex through a special one below' : '' },
        h('input', { type: 'checkbox', checked: reg || regBySpecial, disabled: regBySpecial,
          onchange: e => quick({ registered: e.target.checked }, e.target.checked ? 'Added to the Pokédex' : 'Taken out of the Pokédex') }),
        h('span', { class: 'sw' }), h('span', { text: 'In my Pokédex' })),
      stepper('For trade', pTrade, d => quick({ trade_delta: d }, `For trade: ${Math.max(0, pTrade + d)}`), val => quick({ for_trade: val }, `For trade: ${val}`)),
      h('div', { class: 'ed-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => entryEditor(app, { variant: v }) }, icon('plus'), 'Special one'),
        h('button', { class: 'btn', type: 'button', onclick: () => wishEditor(app, { dex: v.sp.dex, form_id: v.form.id, shiny: v.shiny ? 1 : null,
          alignment: v.align === 'normal' ? null : v.align, max: v.max === 'none' ? null : v.max }) }, icon('wish'), 'Wishlist'),
        h('label', { class: 'switch sm', title: 'Whether this variant counts towards completion and "missing"' },
          h('input', { type: 'checkbox', checked: v.target, onchange: async e => {
            try { await app.saved(await app.post('variants/target', { variant_id: v.id, target: e.target.checked ? 1 : 0 }), e.target.checked ? 'Counts towards completion' : 'No longer counted'); } catch { /* */ }
          } }), h('span', { class: 'sw' }), h('span', { text: 'Counts' }))),
      special.length ? null : h('p', { class: 'hint', text: 'Use "Special one" for an XXL, lucky, hundo, background, or a Pokémon with particular moves.' })));
  }
  const rows = (app.admin ? special : v.entries.filter(e => isSpecial(e) || e.note)).filter(e => app.admin || e.registered);
  return h('section', { class: 'blk panel' },
    h('h3', {}, variantLabel(v), app.admin ? h('code', { class: 'vid', title: 'Variant id (for imports)', text: v.id })
      : h('span', { class: 'muted', text: variantHas(v, mode) ? '' : ' · missing' })),
    body,
    rows.length ? h('ul', { class: 'entries' }, rows.map(e => entryRow(app, e, { showVariant: false }))) : null,
    !app.admin && !rows.length ? h('p', { class: 'muted small', text: variantHas(v, mode) ? `In the Pokédex${forTrade(v) ? `, ${forTrade(v)} available for trade` : ''}.` : 'Not in the Pokédex yet.' }) : null);
}

function stepper(label, value, onDelta, onSet) {
  const input = h('input', { type: 'number', min: '0', max: '9999', inputmode: 'numeric', value: String(value), 'aria-label': label,
    onchange: e => { const n = Math.max(0, Math.min(9999, parseInt(e.target.value || '0', 10) || 0)); if (n !== value) onSet(n); } });
  return h('div', { class: 'stepper' }, h('span', { class: 'st-l', text: label }),
    h('div', { class: 'st-c' },
      h('button', { type: 'button', class: 'iconbtn', 'aria-label': `${label} minus one`, disabled: value <= 0, onclick: () => onDelta(-1) }, icon('minus')),
      input,
      h('button', { type: 'button', class: 'iconbtn', 'aria-label': `${label} plus one`, onclick: () => onDelta(1) }, icon('plus'))));
}

function entryRow(app, e, { showVariant = true } = {}) {
  return h('li', { class: 'entry' },
    sprite(app, e.v, { size: 'xs' }),
    h('div', { class: 'entry-b' },
      h('div', { class: 'entry-t' }, showVariant ? h('b', { text: variantLabel(e.v) }) : null, h('span', { class: 'muted', text: entryLine(e) })),
      h('div', { class: 'chips' }, entryChips(e, app.model)),
      e.note ? h('p', { class: 'note', text: e.note }) : null,
      app.admin && e.privateNote ? h('p', { class: 'note private', text: e.privateNote }) : null),
    app.admin ? h('button', { class: 'iconbtn', type: 'button', 'aria-label': 'Edit', onclick: () => entryEditor(app, { entry: e }) }, icon('edit')) : null);
}

/** What the game can record for this species. Off = never counted as missing or in the totals. */
function recordSwitches(app, sp) {
  const sw = (rec, label) => h('label', { class: 'switch sm' },
    h('input', { type: 'checkbox', checked: rec === 'regional' ? !!sp.regional : canHave(sp, rec), onchange: async e => {
      try {
        await app.saved(await app.post('species/record', { dex: sp.dex, record: rec, value: e.target.checked ? 1 : 0 }),
          rec === 'regional' ? `${sp.name}: ${e.target.checked ? 'regional exclusive' : 'not a regional exclusive'}`
            : `${sp.name} ${e.target.checked ? 'can' : "can't"} ${rec === 'sizes' ? 'be XXS / XXL' : 'be lucky'}`);
      } catch { /* toast shown */ }
    } }), h('span', { class: 'sw' }), h('span', { text: label }));
  return h('section', { class: 'blk' }, h('h3', { text: 'In the game' }),
    h('div', { class: 'ed-actions' }, sw('sizes', 'Can be XXS / XXL'), sw('lucky', 'Can be lucky'), sw('regional', 'Regional exclusive')),
    h('p', { class: 'hint', text: 'Turn off what the game never records for this Pokémon, so "missing" searches and totals skip it. Regional exclusives show up when you search "regional".' }));
}

function wishList(app, sp, form) {
  const ws = sp.wishes.filter(w => app.admin || w.status === 'open');
  if (!ws.length && !app.admin) return null;
  return h('section', { class: 'blk' }, h('h3', { text: 'Wishlist' }),
    ws.length ? h('div', { class: 'wishes compact' }, ws.map(w => wishCard(app, w, app.admin ? { onEdit: x => wishEditor(app, { wish: x }) } : {}))) : null,
    app.admin ? h('button', { class: 'btn', type: 'button', onclick: () => wishEditor(app, { dex: sp.dex, form_id: form.kind === 'base' ? null : form.id }) }, icon('plus'), 'Add a wish') : null);
}

function addVariant(app, form) {
  const sel = (name, opts) => h('label', { class: 'fld' }, h('span', { text: name }), h('select', { name: name.toLowerCase() }, opts.map(([v, l]) => h('option', { value: v }, l))));
  const f = h('form', { class: 'dlg-body form' },
    h('p', { class: 'muted', text: `Add a variant of ${formLabel(form)} that the catalog doesn't list (for example a Dynamax one). It will count towards completion.` }),
    sel('Shiny', [['n', 'Not shiny'], ['s', 'Shiny']]),
    sel('Alignment', [['normal', 'Normal'], ['shadow', 'Shadow'], ['purified', 'Purified']]),
    sel('Max', [['dynamax', 'Dynamax'], ['gigantamax', 'Gigantamax'], ['none', 'Neither']]),
    h('div', { class: 'dlg-actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Add')));
  const dlg = modal('Other variant', f);
  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const d = new FormData(f);
    const id = `${form.id}|${d.get('shiny')}|${d.get('alignment')}|${d.get('max')}`;
    try {
      const data = await app.post('variants/target', { variant_id: id, target: 1 });
      dlg.close();
      if (sheet) sheet.varId = id;
      await app.saved(data, 'Variant added');
    } catch { /* toast shown */ }
  });
}
