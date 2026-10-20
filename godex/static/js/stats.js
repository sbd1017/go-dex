// Collection statistics, all derived from the same model the search uses. Pure (no DOM).
// Every metric carries the query that shows it in the Pokédex, so tiles can link straight to the list.

import { inMode, isPerfect, variantHas, wishSatisfied } from './model.js';

export const REGION_NAMES = { 1: 'Kanto', 2: 'Johto', 3: 'Hoenn', 4: 'Sinnoh', 5: 'Unova', 6: 'Kalos', 7: 'Alola', 8: 'Galar', 9: 'Paldea' };

export function computeStats(m, mode) {
  const has = v => variantHas(v, mode);
  const entryIn = (sp, test) => sp.variants.some(v => v.entries.some(e => inMode(e, mode) && test(e)));
  const nonMega = v => v.form.kind !== 'mega';
  const tracked = m.species.filter(sp => sp.variants.some(v => v.target && nonMega(v)));

  const speciesMetric = (id, label, q, pick, have = sp => sp.variants.some(v => pick(v) && has(v))) => {
    const pool = m.species.filter(sp => sp.variants.some(v => v.target && pick(v)));
    return { id, label, q, have: pool.filter(have).length, total: pool.length };
  };
  const entryMetric = (id, label, q, test) =>
    ({ id, label, q, have: tracked.filter(sp => entryIn(sp, test)).length, total: tracked.length });
  const formMetric = (id, label, q, kind) => {
    const pool = m.forms.filter(f => f.kind === kind && f.variants.some(v => v.target));
    return { id, label, q, have: pool.filter(f => f.variants.some(has)).length, total: pool.length };
  };

  const dex = speciesMetric('dex', 'Pokédex', '', v => nonMega(v));
  const targets = m.variants.filter(v => v.target);
  const bgs = new Set();
  for (const e of m.entries) if (e.bg && inMode(e, mode)) bgs.add(e.bg);
  const open = m.wishes.filter(w => w.status === 'open');
  const offers = m.entries.filter(e => e.trade > 0);

  const metrics = [
    dex,
    speciesMetric('shiny', 'Shiny', 'shiny', v => v.shiny && nonMega(v)),
    speciesMetric('shadow', 'Shadow', 'shadow', v => v.align === 'shadow'),
    speciesMetric('purified', 'Purified', 'purified', v => v.align === 'purified'),
    entryMetric('lucky', 'Lucky', 'lucky', e => e.lucky),
    entryMetric('perfect', 'Perfect', 'perfect', isPerfect),
    entryMetric('xxl', 'XXL', 'xxl', e => e.size === 'xxl'),
    entryMetric('xxs', 'XXS', 'xxs', e => e.size === 'xxs'),
    formMetric('costume', 'Costumes', 'costume', 'costume'),
    formMetric('regional', 'Regional forms', 'regional', 'regional'),
    formMetric('alternate', 'Other forms', 'form, !costume, !regional, !mega', 'alternate'),
    formMetric('mega', 'Mega & Primal', 'mega', 'mega'),
    speciesMetric('gmax', 'Gigantamax', 'gigantamax', v => v.max === 'gigantamax'),
    speciesMetric('dmax', 'Dynamax', 'dynamax', v => v.max === 'dynamax'),
    { id: 'background', label: 'Backgrounds', q: 'background', have: bgs.size, total: m.backgrounds.size },
    { id: 'variants', label: 'All variants', q: '', have: targets.filter(has).length, total: targets.length },
  ];

  const gens = [];
  for (let g = 1; g <= 9; g++) {
    const pool = tracked.filter(sp => sp.gen === g);
    const shinyPool = pool.filter(sp => sp.variants.some(v => v.target && v.shiny && nonMega(v)));
    gens.push({
      gen: g, label: REGION_NAMES[g], q: `gen${g}`, total: pool.length,
      have: pool.filter(sp => sp.variants.some(v => nonMega(v) && has(v))).length,
      shinyTotal: shinyPool.length, shinyHave: shinyPool.filter(sp => sp.variants.some(v => v.shiny && nonMega(v) && has(v))).length,
    });
  }

  return {
    mode, metrics, byId: Object.fromEntries(metrics.map(x => [x.id, x])), gens,
    wishes: { open: open.length, high: open.filter(w => w.priority === 'high').length,
      satisfied: open.filter(w => wishSatisfied(w, m)).length, fulfilled: m.wishes.filter(w => w.status === 'fulfilled').length },
    trade: { kinds: offers.length, count: offers.reduce((n, e) => n + e.trade, 0) },
    owned: { pokemon: m.entries.reduce((n, e) => n + e.owned, 0) },
  };
}

export const pct = (have, total) => (total ? Math.round((have / total) * 1000) / 10 : 0);
