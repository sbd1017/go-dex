// node --test tests/js/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../../godex/static/js/model.js';
import { parse, compileVariants, compileWishes, compileOffers, queryFromSearch, searchFromQuery, toggleTerm }
  from '../../godex/static/js/query.js';

const sp = (dex, name, gen, region, types, extra = {}) =>
  ({ dex, code: name.toUpperCase(), name, gen, region, family: name.toUpperCase(), class: '', types, gd: 0, rel: 1, shiny: 1, shadow: 1, gmax: 0, dmax: 0, ...extra });
const form = (id, dex, kind = 'base', name = '', extra = {}) => ({ id, dex, code: '', name, kind, rt: '', types: [], img: [null, null, null, null], rel: 1, ...extra });

function dataset() {
  const species = [
    sp(1, 'Bulbasaur', 1, 'kanto', ['grass', 'poison']),
    sp(25, 'Pikachu', 1, 'kanto', ['electric'], { family: 'PIKACHU' }),
    sp(26, 'Raichu', 1, 'kanto', ['electric'], { family: 'PIKACHU' }),
    sp(150, 'Mewtwo', 1, 'kanto', ['psychic'], { class: 'legendary' }),
    sp(151, 'Mew', 1, 'kanto', ['psychic'], { class: 'mythical' }),
    sp(484, 'Palkia', 4, 'sinnoh', ['water', 'dragon'], { class: 'legendary' }),
  ];
  const forms = [
    form('BULBASAUR', 1, 'base', '', { types: ['grass', 'poison'] }),
    form('PIKACHU', 25, 'base', '', { types: ['electric'] }),
    form('PIKACHU_VS_2019', 25, 'costume', 'Libre', { types: ['electric'] }),
    form('RAICHU', 26, 'base', '', { types: ['electric'] }),
    form('RAICHU_ALOLA', 26, 'regional', 'Alolan', { types: ['electric', 'psychic'], rt: 'alolan' }),
    form('MEWTWO', 150, 'base', '', { types: ['psychic'] }),
    form('MEW', 151, 'base', '', { types: ['psychic'] }),
    form('PALKIA', 484, 'base', '', { types: ['water', 'dragon'] }),
    form('PALKIA_ORIGIN', 484, 'alternate', 'Origin Forme', { types: ['water', 'dragon'] }),
  ];
  const variants = [];
  forms.forEach((f, i) => {
    variants.push([`${f.id}|n|normal|none`, i, 0, 0, 0, 1], [`${f.id}|s|normal|none`, i, 1, 0, 0, 1]);
    if (f.kind !== 'costume') variants.push([`${f.id}|n|shadow|none`, i, 0, 1, 0, 1], [`${f.id}|s|shadow|none`, i, 1, 1, 0, 1]);
  });
  variants.push(['MEW|s|purified|none', 6, 1, 2, 0, 0]);                 // does not count towards completion
  const entries = [
    { id: 1, v: 'BULBASAUR|n|normal|none', r: 1, o: 2, t: 1 },
    { id: 2, v: 'PIKACHU|s|normal|none', r: 1, o: 1 },
    { id: 3, v: 'PIKACHU|n|normal|none', r: 1, o: 0 },                       // registered, transferred
    { id: 4, v: 'MEWTWO|n|normal|none', r: 1, o: 1, sz: 'xxl' },
    { id: 5, v: 'PALKIA|s|normal|none', r: 1, o: 1, sz: 'xxl', bg: 'LC_X', tags: ['pvp'] },
    { id: 6, v: 'RAICHU_ALOLA|n|normal|none', r: 1, o: 3, t: 3, l: 1, ia: 15, id_: 15, is: 15 },
  ];
  const wishes = [
    { id: 1, dex: 25, form_id: 'PIKACHU_VS_2019', shiny: 1, priority: 'high', status: 'open', tags: [] },
    { id: 2, dex: 484, form_id: 'PALKIA_ORIGIN', lucky: 1, moves: 'Special Rend', priority: 'normal', status: 'open', tags: ['pvp'] },
    { id: 3, dex: 484, form_id: 'PALKIA_ORIGIN', min_iv_atk: 15, min_iv_def: 15, min_iv_sta: 15, priority: 'someday', status: 'open', tags: [] },
    { id: 4, dex: 150, background: 'any', priority: 'normal', status: 'open', tags: [] },
  ];
  return { admin: false, version: 1, settings: {}, species, forms, variants, entries, wishes,
    backgrounds: [['LC_X', 'Madrid GO Fest 2024', 'location', 2024]], tags: [['pvp', 'PvP']] };
}

const m = buildModel(dataset());
const run = (text, mode = 'owned') => {
  const q = parse(text, m);
  const t = compileVariants(q, mode, m);
  return m.variants.filter(t).map(v => v.id).sort();
};
const dexes = (text, mode) => [...new Set(run(text, mode).map(id => m.variantById.get(id).sp.dex))].sort((a, b) => a - b);

test('25 finds Pikachu', () => assert.deepEqual(dexes('25'), [25]));
test('25, shiny -> shiny Pikachu variants', () =>
  assert.deepEqual(run('25, shiny'), ['PIKACHU_VS_2019|s|normal|none', 'PIKACHU|s|normal|none', 'PIKACHU|s|shadow|none'].sort()));
test('pikachu, costume', () => assert.deepEqual(run('pikachu, costume'), ['PIKACHU_VS_2019|n|normal|none', 'PIKACHU_VS_2019|s|normal|none']));
test('pikachu, costume, missing', () => assert.deepEqual(run('pikachu, costume, missing'), ['PIKACHU_VS_2019|n|normal|none', 'PIKACHU_VS_2019|s|normal|none']));
test('shiny, missing excludes owned shinies', () => {
  const r = run('shiny, missing');
  assert.ok(!r.includes('PIKACHU|s|normal|none'));
  assert.ok(!r.includes('PALKIA|s|normal|none'));
  assert.ok(r.includes('MEW|s|normal|none'));
  assert.ok(!r.includes('MEW|s|purified|none'), 'non-target variants never count as missing');
});
test('registered mode: transferred Pikachu is registered, not owned', () => {
  assert.ok(run('missing', 'owned').includes('PIKACHU|n|normal|none'));
  assert.ok(!run('missing', 'registered').includes('PIKACHU|n|normal|none'));
});
test('shadow, missing', () => assert.ok(run('shadow, missing').every(id => id.includes('|shadow|'))));
test('xxl, shiny -> shiny XXL owned', () => assert.deepEqual(run('xxl, shiny'), ['PALKIA|s|normal|none']));
test('legendary, xxl', () => assert.deepEqual(dexes('legendary, xxl'), [150, 484]));
test('kanto, missing', () => assert.ok(dexes('kanto, missing').every(d => d <= 151)));
test('1-151, shiny, missing', () => {
  const r = run('1-151, shiny, missing');
  assert.ok(r.length > 0 && r.every(id => id.includes('|s|')));
  assert.ok(!r.some(id => id.startsWith('PALKIA')));
});
test('shiny, !shadow', () => assert.ok(run('shiny, !shadow').every(id => id.includes('|s|normal|'))));
test('background, missing uses background wishes', () => assert.deepEqual(dexes('background, missing'), [150]));
test('background (have)', () => assert.deepEqual(dexes('background'), [484]));
test('bg:madrid', () => assert.deepEqual(dexes('bg:madrid'), [484]));
test('trade', () => assert.deepEqual(dexes('trade'), [1, 26]));
test('hundo / 4* / perfect are the same', () => {
  assert.deepEqual(dexes('hundo'), [26]); assert.deepEqual(dexes('4*'), [26]); assert.deepEqual(dexes('perfect, lucky'), [26]);
});
test('xxl, missing = species without an XXL (any variant counts)', () => {
  assert.ok(!dexes('xxl, missing').includes(150));
  assert.ok(dexes('xxl, missing').includes(25));
  assert.ok(run('shiny, xxl, missing').includes('MEWTWO|s|normal|none'), 'no shiny XXL yet');
});
test('OR with |', () => assert.deepEqual(dexes('pikachu | raichu'), [25, 26]));
test('exact name wins: mew is not mewtwo', () => assert.deepEqual(dexes('mew'), [151]));
test('partial name', () => assert.deepEqual(dexes('pika'), [25]));
test('form name', () => { const q = parse('libre', m); assert.ok(q.formLevel); assert.deepEqual(run('libre, shiny'), ['PIKACHU_VS_2019|s|normal|none']); });
test('family', () => assert.deepEqual(dexes('+pikachu'), [25, 26]));
test('alolan', () => assert.deepEqual(dexes('alolan'), [26]));
test('wish on variants', () => assert.deepEqual(dexes('wish'), [25, 150, 484]));
test('type and gen', () => { assert.deepEqual(dexes('dragon'), [484]); assert.deepEqual(dexes('gen4'), [484]); });
test('tag word', () => assert.deepEqual(dexes('pvp'), [484]));
test('unknown word is flagged', () => assert.ok(parse('qwertz', m).chips[0].unknown));
test('!owned', () => assert.ok(!dexes('!owned').includes(1) || run('!owned').every(id => !m.variantById.get(id).entries.some(e => e.owned))));

test('wishlist queries', () => {
  const ws = text => m.wishes.filter(compileWishes(parse(text, m), m)).map(w => w.id);
  assert.deepEqual(ws('shiny'), [1]);
  assert.deepEqual(ws('high'), [1]);
  assert.deepEqual(ws('legendary'), [2, 3, 4]);
  assert.deepEqual(ws('pikachu'), [1]);
  assert.deepEqual(ws('background'), [4]);
  assert.deepEqual(ws('lucky'), [2]);
  assert.deepEqual(ws('hundo'), [3]);
  assert.deepEqual(ws('pvp'), [2]);
  assert.deepEqual(ws('@special rend'), [2]);
});

test('trade offers', () => {
  const offers = m.entries.filter(e => e.trade > 0);
  const os = text => offers.filter(compileOffers(parse(text, m), m)).map(e => e.id);
  assert.deepEqual(os(''), [1, 6]);
  assert.deepEqual(os('lucky'), [6]);
  assert.deepEqual(os('alolan'), [6]);
});

test('urls', () => {
  assert.equal(searchFromQuery('shiny, missing'), '?shiny&missing');
  assert.equal(searchFromQuery('shiny, !shadow'), '?shiny&!shadow');
  assert.equal(searchFromQuery('1-151, shiny', { mode: 'registered' }), '?1-151&shiny&mode=registered');
  assert.equal(searchFromQuery('mr. mime'), '?q=mr.%20mime');
  assert.equal(searchFromQuery('+pikachu'), '?%2Bpikachu');
  assert.equal(queryFromSearch('?shiny&missing').text, 'shiny, missing');
  assert.equal(queryFromSearch('?%2Bpikachu').text, '+pikachu');
  assert.equal(queryFromSearch('?q=mr.%20mime&mode=registered').mode, 'registered');
  assert.equal(queryFromSearch('?bg=madrid').text, 'bg:madrid');
  assert.equal(toggleTerm('shiny, missing', 'shiny'), 'missing');
  assert.equal(toggleTerm('missing', 'xxl'), 'missing, xxl');
});

test('names match in any word order', () => assert.deepEqual(run('origin palkia').map(id => id.split('|')[0])[0], 'PALKIA_ORIGIN'));

test('trade compare: free text lines', async () => {
  const { itemToQuery, compileCandidates } = await import('../../godex/static/js/query.js');
  assert.equal(itemToQuery('shiny alolan raichu'), 'shiny, alolan, raichu');
  assert.equal(itemToQuery('#150'), '#150');
  const cand = text => { const { test } = compileCandidates(parse(itemToQuery(text), m)); return m.variants.filter(test).map(v => v.id); };
  assert.deepEqual(cand('shiny alolan raichu'), ['RAICHU_ALOLA|s|normal|none']);
  const { details } = compileCandidates(parse(itemToQuery('xxl mewtwo'), m));
  assert.deepEqual(details.map(a => a.def.key), ['xxl']);
  assert.ok(cand('xxl mewtwo').includes('MEWTWO|s|normal|none'), 'details never hide a candidate');
});

test('GO search strings', async () => {
  const { compressNumbers, goSearchString, picksFromQuery } = await import('../../godex/static/js/gosearch.js');
  assert.equal(compressNumbers([7, 1, 2, 3, 25, 26, 9, 3]), '1-3,7,9,25,26');
  assert.equal(compressNumbers([]), '');
  const picks = new Map([['xxs', 'on'], ['xxl', 'on'], ['shiny', 'on'], ['shadow', 'not']]);
  assert.equal(goSearchString([123, 145, 1, 2, 3], picks), 'shiny&xxs,xxl&!shadow&1-3,123,145');
  assert.equal(goSearchString([25], new Map()), '25');
  const fromQ = picksFromQuery(parse('xxl, shiny, !shadow, missing, kanto', m));
  assert.deepEqual([...fromQ], [['xxl', 'on'], ['shiny', 'on'], ['shadow', 'not']]);
  assert.deepEqual([...picksFromQuery(parse('hundo', m))], [['4*', 'on']]);
});

test('one idea of having it: owned, have and registered all mean in your Pokédex', () => {
  const inDex = run('registered', 'registered');
  assert.deepEqual(run('owned', 'registered'), inDex);
  assert.deepEqual(run('have', 'registered'), inDex);
  assert.ok(inDex.includes('PIKACHU|n|normal|none'), 'transferred Pikachu (registered, none owned) still counts');
  assert.ok(!run('missing', 'registered').includes('PIKACHU|n|normal|none'));
});
