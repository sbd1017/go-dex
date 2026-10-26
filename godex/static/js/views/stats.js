// Stats: one hero figure, a row of tiles (each opens the matching Pokédex search), generation meters + table.
import { h, fmt } from '../dom.js';
import { pct } from '../stats.js';
import { stats } from './dex.js';

const TILES = ['shiny', 'shadow', 'purified', 'lucky', 'perfect', 'xxl', 'xxs', 'costume', 'regional', 'alternate', 'mega',
  'gmax', 'dmax', 'background', 'variants'];

export function render(main, app) {
  const s = stats(app);
  const dex = s.byId.dex;
  const go = text => app.href('dex', { text });
  const meter = (have, total) => h('span', { class: 'meter', role: 'img', 'aria-label': `${pct(have, total)}%` },
    h('span', { class: 'meter-f', style: { '--p': `${total ? (have / total) * 100 : 0}%` } }));

  main.replaceChildren(h('section', { class: 'view statsview' },
    h('header', { class: 'view-head' }, h('h1', { text: 'Stats' }),
      h('p', { class: 'muted', text: 'What is in your Pokédex. Tap any number to see those Pokémon.' })),
    h('a', { class: 'hero', href: go('missing'), 'data-nav': '1', title: 'See what is missing' },
      h('span', { class: 'hero-l', text: 'Pokédex' }),
      h('span', { class: 'hero-v' }, h('b', { text: fmt(dex.have) }), h('span', { text: ` of ${fmt(dex.total)} Pokémon` })),
      meter(dex.have, dex.total), h('span', { class: 'hero-p', text: `${pct(dex.have, dex.total)}% · ${fmt(dex.total - dex.have)} to go` })),
    h('div', { class: 'tiles' },
      TILES.map(id => s.byId[id]).filter(x => x && (x.total || x.have)).map(x => h('a', { class: 'tile', href: x.id === 'background' ? app.href('backgrounds') : go(x.q), 'data-nav': '1' },
        h('span', { class: 'tile-l', text: x.label }),
        h('span', { class: 'tile-v' }, h('b', { text: fmt(x.have) }), x.total ? h('small', { text: ` / ${fmt(x.total)}` }) : null),
        x.total ? meter(x.have, x.total) : null)),
      h('a', { class: 'tile', href: app.href('wishlist'), 'data-nav': '1' }, h('span', { class: 'tile-l', text: 'Wishlist' }),
        h('span', { class: 'tile-v' }, h('b', { text: fmt(s.wishes.open) }), h('small', { text: ' open' })),
        h('span', { class: 'tile-n', text: `${s.wishes.high} high priority · ${s.wishes.satisfied} already matched · ${s.wishes.fulfilled} got` })),
      h('a', { class: 'tile', href: app.href('trade'), 'data-nav': '1' }, h('span', { class: 'tile-l', text: 'For trade' }),
        h('span', { class: 'tile-v' }, h('b', { text: fmt(s.trade.count) })),
        h('span', { class: 'tile-n', text: `${s.trade.kinds} different Pokémon` }))),
    h('section', { class: 'blk' }, h('h2', { text: 'By generation' }),
      h('table', { class: 'gentable' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Region' }), h('th', { scope: 'col', text: 'Pokédex' }),
          h('th', { scope: 'col', class: 'num', text: '%' }), h('th', { scope: 'col', text: 'Shiny' }), h('th', { scope: 'col', class: 'num', text: '%' }))),
        h('tbody', {}, s.gens.filter(g => g.total).map(g => h('tr', {},
          h('th', { scope: 'row' }, h('a', { href: go(g.q), 'data-nav': '1' }, h('b', { text: g.label }), h('small', { text: ` Gen ${g.gen}` }))),
          h('td', {}, h('a', { href: go(`${g.q}, missing`), 'data-nav': '1', class: 'cellmeter', title: 'See what is missing' },
            meter(g.have, g.total), h('span', { class: 'num', text: `${fmt(g.have)} / ${fmt(g.total)}` }))),
          h('td', { class: 'num', text: `${pct(g.have, g.total)}` }),
          h('td', {}, h('a', { href: go(`${g.q}, shiny, missing`), 'data-nav': '1', class: 'cellmeter', title: 'See missing shinies' },
            meter(g.shinyHave, g.shinyTotal), h('span', { class: 'num', text: `${fmt(g.shinyHave)} / ${fmt(g.shinyTotal)}` }))),
          h('td', { class: 'num', text: `${pct(g.shinyHave, g.shinyTotal)}` })))))),
    h('p', { class: 'muted small', text: 'Totals only count variants that are released and catchable, according to the catalog (plus any you add). Mega and Primal forms are counted separately.' })));
}
