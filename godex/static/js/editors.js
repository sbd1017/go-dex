// Admin dialogs: a special entry (XXL, lucky, hundo, background, moves ...) and a wish.
import { h, icon, modal, confirmBox, pad } from './dom.js';
import { variantLabel, formLabel, norm } from './model.js';

const opt = (v, l, cur) => h('option', { value: v, selected: String(cur ?? '') === String(v) }, l);
const field = (label, control, hint) => h('label', { class: 'fld' }, h('span', { text: label }), control, hint ? h('small', { text: hint }) : null);
const check = (name, label, checked) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', name, checked }), h('span', { class: 'sw' }), h('span', { text: label }));
const num = (name, value, min, max, label) => h('input', { type: 'number', name, min, max, inputmode: 'numeric', value: value ?? '', 'aria-label': label, placeholder: '-' });

function backgroundSelect(app, name, current, { anyOptions = false, wish = null } = {}) {
  const groups = { location: [], special: [] };
  for (const b of app.model.backgrounds.values()) groups[b.kind].push(b);
  const chosen = current || (anyOptions && wish?.background ? `@${wish.background}` : '');
  return h('select', { name },
    opt('', anyOptions ? 'No background needed' : 'None', chosen),
    anyOptions ? [opt('@any', 'Any background', chosen), opt('@location', 'Any location background', chosen),
      opt('@special', 'Any special background', chosen)] : null,
    h('optgroup', { label: 'Location backgrounds' }, groups.location.map(b => opt(b.id, b.name, chosen))),
    h('optgroup', { label: 'Special backgrounds' }, groups.special.map(b => opt(b.id, b.name, chosen))));
}

function tagsInput(app, tags) {
  const input = h('input', { type: 'text', name: 'tags', value: tags.map(t => app.model.tags.get(t)?.label || t).join(', '),
    placeholder: 'PvP, Living Dex ...', list: 'dex-tags', autocomplete: 'off' });
  const dl = h('datalist', { id: 'dex-tags' }, [...app.model.tags.values()].map(t => h('option', { value: t.label })));
  const quick = h('div', { class: 'chips pick' }, [...app.model.tags.values()].slice(0, 9).map(t => h('button', {
    type: 'button', class: 'chip btnchip', onclick: () => {
      const cur = input.value.split(',').map(s => s.trim()).filter(Boolean);
      const i = cur.findIndex(c => norm(c) === t.n);
      if (i >= 0) cur.splice(i, 1); else cur.push(t.label);
      input.value = cur.join(', ');
    } }, t.label)));
  return h('div', {}, input, dl, quick);
}

const tagsFrom = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const intOrNull = s => (s === '' || s === null || s === undefined ? null : parseInt(s, 10));

async function save(app, dlg, path, body, message) {
  try {
    const data = await app.post(path, body);
    dlg.close();
    await app.saved(data, message);
  } catch { /* toast shown */ }
}

// ---------------------------------------------------------------- entries
export function entryEditor(app, { entry = null, variant = null } = {}) {
  const e = entry || { registered: true, trade: 0, gender: '', size: '', lucky: false, iv: null, bg: null, moves: '', cp: null,
    nickname: '', caughtOn: null, note: '', privateNote: '', tags: [] };
  const v = entry ? entry.v : variant;
  const iv = e.iv || [null, null, null];
  const f = h('form', { class: 'dlg-body form', novalidate: true },
    h('p', { class: 'lead' }, h('b', { text: v.sp.name }), h('span', { class: 'muted', text: ` · #${pad(v.sp.dex)}` })),
    // Which form / variant it is. Change it to move the entry, e.g. a hundo Mewtwo you turned into Mega Y.
    field('Which one', h('select', { name: 'variant_id' }, v.sp.forms.map(fm => h('optgroup', { label: fm.name ? formLabel(fm) : v.sp.name },
      fm.variants.filter(x => x.target || x === v || x.entries.length).map(x => opt(x.id, variantLabel(x), v.id))))),
      'Pick another form to move it there, like the Mega it became.'),
    h('div', { class: 'row3' },
      field('For trade', num('for_trade', e.trade, 0, 9999, 'For trade'))),
    h('div', { class: 'row3' },
      field('Size', h('select', { name: 'size' }, opt('', 'Normal size', e.size), opt('xxl', 'XXL', e.size), opt('xl', 'XL', e.size),
        opt('xs', 'XS', e.size), opt('xxs', 'XXS', e.size))),
      field('Gender', h('select', { name: 'gender' }, opt('', 'Not recorded', e.gender), opt('male', '♂ Male', e.gender),
        opt('female', '♀ Female', e.gender), opt('genderless', 'Genderless', e.gender))),
      check('lucky', 'Lucky', e.lucky)),
    h('div', { class: 'fld' }, h('span', { text: 'IVs (attack / defence / HP)' }),
      h('div', { class: 'ivs' }, num('iv_atk', iv[0], 0, 15, 'Attack IV'), num('iv_def', iv[1], 0, 15, 'Defence IV'), num('iv_sta', iv[2], 0, 15, 'HP IV'),
        h('button', { type: 'button', class: 'btn sm', onclick: () => { for (const n of ['iv_atk', 'iv_def', 'iv_sta']) f.elements[n].value = 15; } }, 'Hundo'))),
    field('Background', backgroundSelect(app, 'background_id', e.bg), 'Missing one? Add it under Data -> Backgrounds.'),
    h('div', { class: 'row2' },
      field('Moves', h('input', { type: 'text', name: 'moves', value: e.moves, placeholder: 'e.g. Dragon Tail / Special Rend', maxlength: 160 })),
      field('CP', num('cp', e.cp, 10, 99999, 'CP'))),
    h('div', { class: 'row2' },
      field('Nickname', h('input', { type: 'text', name: 'nickname', value: e.nickname, maxlength: 40 })),
      field('Caught on', h('input', { type: 'date', name: 'caught_on', value: e.caughtOn || '' }))),
    field('Tags', tagsInput(app, e.tags)),
    field('Public note', h('textarea', { name: 'note', rows: 2, maxlength: 1000 }, e.note)),
    field('Private note', h('textarea', { name: 'private_note', rows: 2, maxlength: 2000 }, e.privateNote), 'Only you see this.'),
    h('div', { class: 'dlg-actions' },
      entry ? h('button', { type: 'button', class: 'btn danger ghost', onclick: async () => {
        if (await confirmBox('Delete this entry? You can undo it afterwards.', 'Delete', { danger: true })) {
          try { const data = await app.post(`entries/${entry.id}/delete`); dlg.close(); await app.saved(data, 'Deleted'); } catch { /* */ }
        }
      } }, icon('trash'), 'Delete') : null,
      h('span', { class: 'grow' }),
      h('button', { type: 'submit', class: 'btn primary' }, entry ? 'Save' : 'Add')));
  const dlg = modal(entry ? 'Edit Pokémon' : 'Add a special one', f, { wide: true });
  f.addEventListener('submit', ev => {
    ev.preventDefault();
    const d = new FormData(f);
    const body = {
      variant_id: d.get('variant_id') || v.id, registered: true, for_trade: intOrNull(d.get('for_trade')) ?? 0,
      owned: intOrNull(d.get('for_trade')) ?? 0,          // only kept so that what is offered is also had
      size: d.get('size'), gender: d.get('gender'), lucky: !!d.get('lucky'),
      iv_atk: intOrNull(d.get('iv_atk')), iv_def: intOrNull(d.get('iv_def')), iv_sta: intOrNull(d.get('iv_sta')),
      background_id: d.get('background_id') || null, moves: d.get('moves'), cp: intOrNull(d.get('cp')),
      nickname: d.get('nickname'), caught_on: d.get('caught_on') || null, tags: tagsFrom(d.get('tags')),
      note: d.get('note'), private_note: d.get('private_note'),
    };
    save(app, dlg, entry ? `entries/${entry.id}` : 'entries', body, entry ? 'Saved' : 'Added');
  });
}

// ---------------------------------------------------------------- wishes
export function wishEditor(app, prefill = {}) {
  const m = app.model;
  const w = prefill.wish || null;
  const cur = w ? { dex: w.dex, form_id: w.form?.id || '', shiny: w.shiny, alignment: w.align, max: w.max, size: w.size, lucky: w.lucky,
    gender: w.gender, iv: w.minIv, moves: w.moves, title: w.title, note: w.note, private_note: w.privateNote, priority: w.priority,
    status: w.status, public: !!w.public, tags: w.tags, bg: w.bg }
    : { dex: prefill.dex || '', form_id: prefill.form_id || '', shiny: prefill.shiny ?? null, alignment: prefill.alignment ?? null,
      max: prefill.max ?? null, size: null, lucky: null, gender: null, iv: [null, null, null], moves: '', title: '', note: '',
      private_note: '', priority: 'normal', status: 'open', public: true, tags: [], bg: null };

  const pokeInput = h('input', { type: 'text', name: 'pokemon', list: 'dex-species', required: true, autocomplete: 'off',
    placeholder: 'Name or number', value: cur.dex ? `${pad(cur.dex)} ${m.byDex.get(cur.dex)?.name || ''}` : '' });
  const speciesList = h('datalist', { id: 'dex-species' }, m.species.map(s => h('option', { value: `${pad(s.dex)} ${s.name}` })));
  const formSel = h('select', { name: 'form_id' });
  const fillForms = () => {
    const sp = pickSpecies(m, pokeInput.value);
    formSel.replaceChildren(opt('', 'Any form', cur.form_id), ...(sp ? sp.forms.map(f => opt(f.id, f.name ? formLabel(f) : `${sp.name} (normal)`, cur.form_id)) : []));
  };
  pokeInput.addEventListener('change', fillForms);
  fillForms();
  const tri = (name, value, labels) => h('select', { name }, opt('', 'Any', value ?? ''), labels.map(([v, l]) => opt(v, l, value ?? '')));
  const prio = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Priority' },
    ['high', 'normal', 'someday'].map(p => h('label', { class: 'segopt' }, h('input', { type: 'radio', name: 'priority', value: p, checked: cur.priority === p }),
      h('span', { text: p === 'high' ? 'High' : p === 'normal' ? 'Normal' : 'Someday' }))));

  const f = h('form', { class: 'dlg-body form', novalidate: true },
    field('Pokémon', h('div', {}, pokeInput, speciesList)),
    field('Form', formSel),
    h('div', { class: 'row3' },
      field('Shiny', tri('shiny', cur.shiny === null ? '' : cur.shiny ? '1' : '0', [['1', 'Shiny'], ['0', 'Not shiny']])),
      field('Shadow', tri('alignment', cur.alignment, [['normal', 'Normal'], ['shadow', 'Shadow'], ['purified', 'Purified']])),
      field('Max', tri('max', cur.max, [['none', 'Neither'], ['dynamax', 'Dynamax'], ['gigantamax', 'Gigantamax']]))),
    h('div', { class: 'row3' },
      field('Size', tri('size', cur.size, [['xxl', 'XXL'], ['xl', 'XL'], ['xs', 'XS'], ['xxs', 'XXS']])),
      field('Lucky', tri('lucky', cur.lucky === null ? '' : cur.lucky ? '1' : '0', [['1', 'Lucky']])),
      field('Gender', tri('gender', cur.gender, [['male', '♂ Male'], ['female', '♀ Female']]))),
    h('div', { class: 'fld' }, h('span', { text: 'Minimum IVs (attack / defence / HP)' }),
      h('div', { class: 'ivs' }, num('min_iv_atk', cur.iv[0], 0, 15, 'Minimum attack'), num('min_iv_def', cur.iv[1], 0, 15, 'Minimum defence'),
        num('min_iv_sta', cur.iv[2], 0, 15, 'Minimum HP'),
        h('button', { type: 'button', class: 'btn sm', onclick: () => { for (const n of ['min_iv_atk', 'min_iv_def', 'min_iv_sta']) f.elements[n].value = 15; } }, 'Hundo'))),
    field('Background', backgroundSelect(app, 'bgpick', cur.bg, { anyOptions: true, wish: w })),
    field('Moves', h('input', { type: 'text', name: 'moves', value: cur.moves, placeholder: 'e.g. Special Rend', maxlength: 160 })),
    field('Priority', prio),
    field('Tags', tagsInput(app, cur.tags), 'PvP, Living Dex, Special Trade ... anything you like.'),
    field('Title (optional)', h('input', { type: 'text', name: 'title', value: cur.title, maxlength: 80, placeholder: 'Leave empty to describe it automatically' })),
    field('Note', h('textarea', { name: 'note', rows: 2, maxlength: 1000 }, cur.note)),
    field('Private note', h('textarea', { name: 'private_note', rows: 2, maxlength: 2000 }, cur.private_note), 'Only you see this.'),
    h('div', { class: 'row2' },
      field('Status', h('select', { name: 'status' }, opt('open', 'Wanted', cur.status), opt('fulfilled', 'Got it', cur.status), opt('archived', 'Archived', cur.status))),
      check('public', 'Show publicly', cur.public)),
    h('div', { class: 'dlg-actions' },
      w ? h('button', { type: 'button', class: 'btn danger ghost', onclick: async () => {
        if (await confirmBox('Delete this wish? You can undo it afterwards.', 'Delete', { danger: true })) {
          try { const data = await app.post(`wishes/${w.id}/delete`); dlg.close(); await app.saved(data, 'Wish deleted'); } catch { /* */ }
        }
      } }, icon('trash'), 'Delete') : null,
      h('span', { class: 'grow' }),
      h('button', { type: 'submit', class: 'btn primary' }, w ? 'Save' : 'Add to wishlist')));
  const dlg = modal(w ? 'Edit wish' : 'Add to wishlist', f, { wide: true });
  f.addEventListener('submit', ev => {
    ev.preventDefault();
    const d = new FormData(f);
    const sp = pickSpecies(m, d.get('pokemon'));
    if (!sp) { pokeInput.setCustomValidity('Pick a Pokémon from the list'); pokeInput.reportValidity(); return; }
    const bg = d.get('bgpick') || '';
    const nullable = k => (d.get(k) === '' ? null : d.get(k));
    const body = {
      dex: sp.dex, form_id: d.get('form_id') || null, shiny: nullable('shiny'), alignment: nullable('alignment'), max: nullable('max'),
      size: nullable('size'), lucky: nullable('lucky'), gender: nullable('gender'),
      min_iv_atk: intOrNull(d.get('min_iv_atk')), min_iv_def: intOrNull(d.get('min_iv_def')), min_iv_sta: intOrNull(d.get('min_iv_sta')),
      background: bg.startsWith('@') ? bg.slice(1) : (bg ? 'any' : null), background_id: bg && !bg.startsWith('@') ? bg : null,
      moves: d.get('moves'), title: d.get('title'), note: d.get('note'), private_note: d.get('private_note'),
      priority: d.get('priority') || 'normal', status: d.get('status'), public: !!d.get('public'), tags: tagsFrom(d.get('tags')),
    };
    save(app, dlg, w ? `wishes/${w.id}` : 'wishes', body, w ? 'Wish saved' : 'Added to the wishlist');
  });
  pokeInput.addEventListener('input', () => pokeInput.setCustomValidity(''));
  if (!cur.dex) setTimeout(() => pokeInput.focus(), 50);
}

function pickSpecies(m, text) {
  const s = String(text || '').trim();
  const n = s.match(/^#?0*(\d{1,4})\b/);
  if (n && m.byDex.get(+n[1])) return m.byDex.get(+n[1]);
  const t = norm(s);
  return m.species.find(sp => sp.n === t) || m.species.find(sp => sp.n.startsWith(t)) || null;
}
