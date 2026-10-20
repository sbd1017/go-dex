// Admin only: settings, paste-a-list, import/export, backgrounds and the change history (with undo).
import { h, icon, fmt, toast, confirmBox } from '../dom.js';
import { parse, compileVariants } from '../query.js';

export function render(main, app) {
  const m = app.model, s = m.settings;
  const settings = h('form', { class: 'card-form form' },
    h('h2', { text: 'Page' }),
    h('div', { class: 'row2' },
      fld('Your name', h('input', { name: 'owner_name', value: s.owner_name, maxlength: 40, placeholder: `Shown as "Name's Pokédex"` })),
      fld('Title', h('input', { name: 'title', value: s.title, maxlength: 60 }))),
    fld('Intro (optional)', h('textarea', { name: 'intro', rows: 2, maxlength: 600 }, s.intro)),
    h('div', { class: 'row2' },
      fld('Header link text', h('input', { name: 'link_label', value: s.link_label, maxlength: 30, placeholder: 'e.g. GO tools' })),
      fld('Header link', h('input', { name: 'link_url', value: s.link_url, maxlength: 200, placeholder: '/pokemon' }))),
    h('div', { class: 'dlg-actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save')));
  settings.addEventListener('submit', async ev => {
    ev.preventDefault();
    try { await app.saved(await app.post('settings', Object.fromEntries(new FormData(settings))), 'Settings saved'); } catch { /* */ }
  });

  // ---- paste a list of numbers
  const paste = h('form', { class: 'card-form form' },
    h('h2', { text: 'Paste a list' }),
    h('p', { class: 'muted', text: 'Pokédex numbers, ranges or names separated by commas or new lines, e.g. "1-151, 155, pikachu". Marks the normal form of each.' }),
    h('textarea', { name: 'list', rows: 3, placeholder: '1-151\n387-493' }),
    h('div', { class: 'row3' },
      fld('Variant', h('select', { name: 'variant' }, h('option', { value: 'normal' }, 'Normal'), h('option', { value: 'shiny' }, 'Shiny'),
        h('option', { value: 'shadow' }, 'Shadow'), h('option', { value: 'purified' }, 'Purified'))),
      fld('Then', h('select', { name: 'action' }, h('option', { value: 'register' }, 'Add to my Pokédex'),
        h('option', { value: 'unregister' }, 'Take out of my Pokédex')))),
    h('div', { class: 'dlg-actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Apply')));
  paste.addEventListener('submit', async ev => {
    ev.preventDefault();
    const d = new FormData(paste);
    const list = String(d.get('list') || '').split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
    if (!list.length) return;
    const variant = d.get('variant');
    const q = parse(`${list.join(' | ')}${variant === 'normal' ? ', !shiny, !shadow, !purified' : `, ${variant}${variant === 'shiny' ? ', !shadow, !purified' : ', !shiny'}`}, !max`, m);
    const unknown = q.chips.filter(c => c.unknown);
    const ids = m.variants.filter(compileVariants(q, 'registered', m)).filter(v => v.form.kind === 'base' || v.form.sort === 0).map(v => v.id);
    if (!ids.length) { toast(unknown.length ? `Not recognised: ${unknown.map(c => c.text).join(', ')}` : 'Nothing matched'); return; }
    if (!(await confirmBox(`${d.get('action') === 'register' ? 'Add' : 'Take out'} ${fmt(ids.length)} Pokémon (${variant})?`, 'Apply'))) return;
    try { const data = await app.post('bulk', { variant_ids: ids, action: d.get('action') }); await app.saved(data, `${fmt(data.changed)} updated`); paste.reset(); } catch { /* */ }
  });

  // ---- import / export
  const report = h('div', { class: 'report' });
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json' });
  const modeSel = h('select', {}, h('option', { value: 'merge' }, 'Add to my collection'), h('option', { value: 'replace' }, 'Replace my collection'));
  const runImport = async dry => {
    const file = fileInput.files[0];
    if (!file) { toast('Choose an export file first'); return; }
    let data;
    try { data = JSON.parse(await file.text()); } catch { toast('That file is not JSON'); return; }
    if (!dry && modeSel.value === 'replace' && !(await confirmBox('Replace everything with this file? A backup is taken first.', 'Replace', { danger: true }))) return;
    try {
      const r = await app.post('import', { data, mode: modeSel.value, dry_run: dry });
      const rep = r.report;
      report.replaceChildren(...[h('p', { text: `${dry ? 'Check: would import' : 'Imported'} ${rep.entries} entries and ${rep.wishes} wishes.` }),
        rep.skipped.length ? h('details', {}, h('summary', { text: `${rep.skipped.length} skipped` }), h('ul', {}, rep.skipped.slice(0, 200).map(x => h('li', { text: x })))) : null,
        dry ? h('button', { class: 'btn primary', type: 'button', onclick: () => runImport(false) }, 'Import now') : null].filter(Boolean));
      if (!dry) await app.saved(r, 'Imported');
    } catch { /* */ }
  };
  const base = app.cfg.base + '/api/admin/';

  // ---- backgrounds
  const custom = [...m.backgrounds.values()].filter(b => b.id.startsWith('custom:'));
  const bgForm = h('form', { class: 'inline' },
    h('input', { name: 'name', placeholder: 'e.g. GO Fest 2026: Copenhagen', maxlength: 80, required: true, 'aria-label': 'Background name' }),
    h('select', { name: 'kind', 'aria-label': 'Kind' }, h('option', { value: 'location' }, 'Location'), h('option', { value: 'special' }, 'Special')),
    h('button', { class: 'btn', type: 'submit' }, icon('plus'), 'Add'));
  bgForm.addEventListener('submit', async ev => {
    ev.preventDefault();
    try { await app.saved(await app.post('backgrounds', Object.fromEntries(new FormData(bgForm))), 'Background added'); } catch { /* */ }
  });

  const history = h('ol', { class: 'history' }, h('li', { class: 'muted', text: 'Loading...' }));
  fetch(base + 'history', { credentials: 'same-origin' }).then(r => r.json()).then(d => {
    history.replaceChildren(...d.history.map((b, i) => h('li', { class: b.undone ? 'undone' : '' },
      h('time', { text: new Date(b.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) }),
      h('span', { text: b.summary + (b.n > 1 ? ` (+${b.n - 1} more)` : '') }),
      !b.undone && i === d.history.findIndex(x => !x.undone) ? h('button', { class: 'btn sm', type: 'button', onclick: () => app.undo(b.batch) }, icon('undo'), 'Undo') : null)));
    if (!d.history.length) history.replaceChildren(h('li', { class: 'muted', text: 'No changes yet.' }));
  }).catch(() => history.replaceChildren(h('li', { class: 'muted', text: 'Could not load the history.' })));

  main.replaceChildren(h('section', { class: 'view dataview' },
    h('header', { class: 'view-head' }, h('h1', { text: 'Data' }),
      h('p', { class: 'muted' }, `Catalog: ${fmt(m.species.length)} species, ${fmt(m.forms.length)} forms, ${fmt(m.variants.length)} variants, ${fmt(m.backgrounds.size)} backgrounds · `,
        `${fmt(m.raw.sprites)} image files`, m.raw.catalog_built_at ? ` · built ${m.raw.catalog_built_at.slice(0, 10)}` : '')),
    h('div', { class: 'datagrid' },
      settings, paste,
      h('div', { class: 'card-form' }, h('h2', { text: 'Export' }),
        h('p', { class: 'muted', text: 'Everything (collection, wishes, your catalog tweaks) as one JSON file, or spreadsheets.' }),
        h('div', { class: 'btnrow' },
          h('a', { class: 'btn', href: base + 'export.json', download: '' }, icon('download'), 'JSON backup'),
          h('a', { class: 'btn', href: base + 'export/entries.csv', download: '' }, 'Collection CSV'),
          h('a', { class: 'btn', href: base + 'export/wishes.csv', download: '' }, 'Wishlist CSV'))),
      h('div', { class: 'card-form' }, h('h2', { text: 'Import' }),
        h('p', { class: 'muted', text: 'From a JSON backup made here. Check first; nothing is changed until you confirm.' }),
        fileInput, modeSel, h('div', { class: 'btnrow' }, h('button', { class: 'btn', type: 'button', onclick: () => runImport(true) }, 'Check file')), report),
      h('div', { class: 'card-form' }, h('h2', { text: 'Backgrounds' }),
        h('p', { class: 'muted', text: `${fmt(m.backgrounds.size)} location and special backgrounds come from the game data. Add any that are missing.` }),
        bgForm, custom.length ? h('ul', { class: 'plain' }, custom.map(b => h('li', { text: `${b.name} · ${b.kind}` }))) : null),
      catalogCard(m),
      h('div', { class: 'card-form wide' }, h('h2', { text: 'Recent changes' }), history))));
}

/** What the last catalog update brought (new species, forms, shinies, backgrounds). */
function catalogCard(m) {
  const info = m.raw.catalog || {};
  const ch = info.changes;
  const when = iso => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'never');
  const list = (title, items) => (items && items.length ? h('div', { class: 'cat-new' },
    h('b', { text: `${items.length} ${title}` }),
    h('p', { class: 'muted small', text: items.slice(0, 40).join(', ') + (items.length > 40 ? ` and ${items.length - 40} more` : '') })) : null);
  return h('div', { class: 'card-form wide' }, h('h2', { text: 'Pokédex updates' }),
    h('p', { class: 'muted', text: 'New Pokémon, forms, costumes, shinies and backgrounds are picked up from the game data and ' +
      `Leek Duck's shiny list (weekly, on the server). Your collection is never changed by an update, and your own "Counts" switches always win.` }),
    h('p', { class: 'small' }, `Catalog built ${when(m.raw.catalog_built_at)} · loaded ${when(info.loaded_at)}`),
    ch ? h('div', { class: 'cat-changes' }, h('p', { class: 'small', text: `Last update with something new: ${when(ch.at)}` }),
      list('new Pokémon', ch.species), list('new forms and costumes', ch.forms), list('new shinies', ch.shinies),
      list('new backgrounds', ch.backgrounds)) : h('p', { class: 'muted small', text: 'No updates with new content yet.' }));
}

function fld(label, control) {
  return h('label', { class: 'fld' }, h('span', { text: label }), control);
}
