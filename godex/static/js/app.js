// Entry point: state, routing, data loading, the shell (header + tabs). Views live in views/*.js.
import { buildModel, replaceEntries } from './model.js';
import { queryFromSearch, searchFromQuery } from './query.js';
import { h, icon, toast, modal } from './dom.js';
import * as dexView from './views/dex.js';
import * as detailView from './views/detail.js';
import * as wishView from './views/wishlist.js';
import * as tradeView from './views/trade.js';
import * as statsView from './views/stats.js';
import * as dataView from './views/data.js';

const CFG = JSON.parse(document.getElementById('dex-config').textContent);
const VIEWS = { dex: dexView, wishlist: wishView, trade: tradeView, stats: statsView, data: dataView };
const TABS = [['dex', '', 'Pokédex', 'dex'], ['wishlist', '/wishlist', 'Wishlist', 'wish'], ['trade', '/trade', 'Trade', 'trade'],
  ['stats', '/stats', 'Stats', 'chart']];

export const app = {
  cfg: CFG, admin: CFG.admin, model: null, route: null, lastQuery: {}, navCount: 0,

  // ---------------------------------------------------------------- urls
  root(path = '') { return CFG.base + (CFG.admin ? '/admin' : '') + path; },
  publicUrl(path = '', search = '') { return location.origin + CFG.base + path + search; },
  mode: 'registered',                                   // one idea of "have": it's in your Pokédex

  parseRoute() {
    let rel = location.pathname.slice(CFG.base.length) || '/';
    if (CFG.admin) rel = rel.replace(/^\/admin/, '') || '/';
    const seg = rel.split('/').filter(Boolean);
    const q = queryFromSearch(location.search);
    let view = 'dex', dex = null;
    if (/^\d+$/.test(seg[0] || '')) dex = +seg[0];
    else if (seg[0] && VIEWS[seg[0]] && (seg[0] !== 'data' || CFG.admin)) view = seg[0];
    return { view, dex, text: q.text || '', group: q.group || null, sort: q.sort || null, form: q.f || null };
  },

  href(view, { text = '', dex = null, form = null } = {}) {
    const path = dex ? `/${dex}` : (view === 'dex' ? '/' : `/${view}`);
    const opts = {};
    if (view === 'dex' && this.route?.group) opts.group = this.route.group;
    if (form) opts.f = form;
    return this.root(path) + searchFromQuery(text, opts);
  },

  go(url, { replace = false } = {}) {
    if (url === location.pathname + location.search) return;
    history[replace ? 'replaceState' : 'pushState'](null, '', url);
    if (!replace) this.navCount++;
    this.onRoute();
  },

  /** Update the current list's query (replaceState while typing). */
  setQuery(text, { push = false } = {}) {
    const r = this.route;
    const opts = {};
    if (r.group && r.view === 'dex') opts.group = r.group;
    if (r.sort) opts.sort = r.sort;
    const path = r.dex ? `/${r.dex}` : (r.view === 'dex' ? '/' : `/${r.view}`);
    history[push ? 'pushState' : 'replaceState'](null, '', this.root(path) + searchFromQuery(text, opts));
    this.route = this.parseRoute();
    this.lastQuery[r.view] = text;
    this.renderMain(r);                 // same view: update in place, so the search box keeps focus
  },

  setOption(key, value) {
    const r = this.route;
    const opts = { group: r.group, sort: r.sort, [key]: value };
    const clean = Object.fromEntries(Object.entries(opts).filter(([, v]) => v));
    const path = r.dex ? `/${r.dex}` : (r.view === 'dex' ? '/' : `/${r.view}`);
    history.replaceState(null, '', this.root(path) + searchFromQuery(r.text, clean));
    this.onRoute();
  },

  // ---------------------------------------------------------------- data
  async load() {
    const res = await fetch(CFG.base + (CFG.admin ? '/api/admin/dataset' : '/api/dataset'), { credentials: 'same-origin' });
    // An expired site login answers with a redirect to the sign-in page (HTML), not JSON.
    if (res.status === 401 || res.redirected || !isJson(res)) throw new Error(CFG.admin ? 'signin' : `HTTP ${res.status}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    this.model = buildModel(await res.json());
  },

  async post(path, body = {}) {
    let res;
    try {
      res = await fetch(CFG.base + '/api/admin/' + path, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': CFG.csrf }, body: JSON.stringify(body),
      });
    } catch {
      toast('Offline? Nothing was saved.'); throw new Error('network');
    }
    if (res.status === 401 || res.redirected || (res.status < 500 && !isJson(res))) {
      toast('Your sign-in expired, so that was not saved. Reload to sign in again.'); throw new Error('signin');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok !== true) { toast(data.error || 'That did not save. Try again.'); throw new Error(data.error || 'failed'); }
    return data;
  },

  /** After a write: patch locally when the server sent the rows, else refetch. Offers undo. */
  async saved(data, message = 'Saved', { variantIds = null } = {}) {
    if (variantIds && data.entries) replaceEntries(this.model, variantIds, data.entries);
    else await this.load();
    this.renderAll();
    toast(message, { label: 'Undo', run: () => this.undo(data.batch) });
    if (variantIds) this.load().then(() => this.renderAll()).catch(() => {});   // pick up anything derived server-side
  },

  async undo(batch) {
    try {
      const r = await this.post('undo', batch ? { batch } : {});
      await this.load();
      this.renderAll();
      toast(`Undone: ${r.undone.summary}`);
    } catch { /* toast already shown */ }
  },

  // ---------------------------------------------------------------- render
  onRoute() {
    const prev = this.route;
    this.route = this.parseRoute();
    if (!prev || prev.view !== this.route.view) this.renderShell();
    this.renderMain(prev);
    detailView.sync(this);
  },

  renderAll() { this.renderShell(); this.renderMain(); detailView.sync(this, { refresh: true }); },

  renderMain(prev) {
    const main = document.getElementById('main');
    const view = VIEWS[this.route.view];
    const sameView = prev && prev.view === this.route.view && main.dataset.view === this.route.view;
    main.dataset.view = this.route.view;
    view.render(main, this, { update: sameView });
    if (!sameView) window.scrollTo(0, 0);
    const s = this.model.settings;
    const who = s.owner_name ? `${s.owner_name}'s ` : '';
    const titles = { dex: s.title || 'Pokédex', wishlist: 'Wishlist', trade: 'Trade', stats: 'Stats', data: 'Data' };
    document.title = `${who}${titles[this.route.view]}${CFG.admin ? ' · editing' : ''}`;
  },

  /** The header cog (admin only): just the name shown as "Name's Pokédex". Everything else stays on the Data page. */
  openSettings() {
    const input = h('input', { name: 'owner_name', value: this.model.settings.owner_name || '', maxlength: 40, placeholder: 'e.g. Ash', autocomplete: 'off' });
    const form = h('form', { class: 'form dlg-body' },
      h('label', { class: 'fld' }, h('span', { text: 'Your name' }), input),
      h('p', { class: 'muted small', text: `Shown as "Name's Pokédex". Leave empty for just "Pokédex".` }),
      h('div', { class: 'dlg-actions' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save')));
    const dlg = modal('Settings', form);
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      try { await this.saved(await this.post('settings', { owner_name: input.value.trim() }), 'Name saved'); dlg.close(); } catch { /* toast already shown */ }
    });
    input.select();   // typing replaces the old name
  },

  renderShell() {
    const s = this.model.settings;
    const header = document.getElementById('top');
    const tabs = [...TABS, ...(CFG.admin ? [['data', '/data', 'Data', 'gear']] : [])];
    const tabLinks = cls => tabs.map(([v, path, label, ic]) => h('a', {
      class: [cls, this.route.view === v && 'on'], href: this.root(path) + (this.lastQuery[v] ? searchFromQuery(this.lastQuery[v]) : ''),
      'aria-current': this.route.view === v ? 'page' : null, 'aria-label': label, title: label, 'data-nav': '1' }, icon(ic), h('span', { text: label })));
    header.replaceChildren(h('div', { class: 'top-in' },
      h('a', { class: 'brand', href: this.root('/'), 'data-nav': '1' }, h('span', { class: 'ball' }, icon('ball')),
        h('span', { class: 'brand-t' }, s.owner_name ? h('small', { text: `${s.owner_name}'s` }) : null, h('b', { text: s.title || 'Pokédex' }))),
      h('nav', { class: 'tabs-top', 'aria-label': 'Sections' }, tabLinks('tab')),
      h('div', { class: 'top-r' },
        CFG.admin ? h('button', { class: 'iconbtn', type: 'button', title: 'Undo the last change', 'aria-label': 'Undo', onclick: () => this.undo() }, icon('undo')) : null,
        h('button', { class: 'iconbtn', type: 'button', title: 'Light / dark', 'aria-label': 'Switch theme', onclick: toggleTheme }, icon('theme')),
        // Everyone sees the cog; on the public page it leads to the editing page (which asks you to sign in first)
        // and opens Settings there.
        CFG.admin ? h('button', { class: 'iconbtn', type: 'button', title: 'Settings', 'aria-label': 'Settings', onclick: () => this.openSettings() }, icon('cog'))
          : h('a', { class: 'iconbtn', href: CFG.base + '/admin/#settings', title: 'Settings (sign in to change)', 'aria-label': 'Settings' }, icon('cog')),
        s.link_url ? h('a', { class: 'textlink', href: s.link_url }, s.link_label || 'More') : null,
        CFG.admin ? h('a', { class: 'pill edit-pill', href: CFG.base + '/', title: 'Open the public, read-only page',
          onclick: e => { e.currentTarget.href = location.pathname.replace(CFG.base + '/admin', CFG.base) + location.search; } }, 'Editing · view public') : null)));
    document.getElementById('tabbar').replaceChildren(...tabLinks('tabb'));
  },
};

const isJson = res => (res.headers.get('content-type') || '').includes('json');

function toggleTheme() {
  const cur = document.documentElement.dataset.theme || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('dex-theme', next); } catch { /* private mode */ }
}

async function boot() {
  document.body.addEventListener('click', e => {
    const a = e.target.closest('a[data-nav]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    app.go(a.getAttribute('href'));
  });
  window.addEventListener('popstate', () => { app.navCount = Math.max(0, app.navCount - 1); app.onRoute(); });
  try {
    await app.load();
  } catch (err) {
    document.getElementById('main').replaceChildren(h('div', { class: 'empty big' },
      h('p', { text: err.message === 'signin' ? 'Sign in to edit.' : 'The Pokédex could not be loaded. Try again in a moment.' }),
      h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'Reload')));
    return;
  }
  app.route = app.parseRoute();
  app.lastQuery[app.route.view] = app.route.text;
  document.body.classList.toggle('is-admin', CFG.admin);
  app.renderShell();
  app.renderMain();
  detailView.sync(app);
  if (CFG.admin && location.hash === '#settings') {          // arrived from the public page's cog
    history.replaceState(null, '', location.pathname + location.search);
    app.openSettings();
  }
}

boot();
