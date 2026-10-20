// Build a Pokémon GO in-game search string from a list of Pokédex numbers and GO search words.
// GO's own syntax: "," means OR, "&" means AND, "!" means NOT; "1-151" is a number range.
// Words of the same kind (sizes, shadow/purified) are OR-ed together, everything else AND-ed:
//   xxs,xxl&shiny&1-3,7,25
// Pure (no DOM), so it runs in Node tests too.

/** GO search words we offer, grouped: words in the same group are joined with "," (either), groups with "&". */
export const GO_WORDS = [
  { word: 'shiny', label: 'Shiny', group: 'shiny' },
  { word: 'lucky', label: 'Lucky', group: 'lucky' },
  { word: '4*', label: 'Hundo (4*)', group: 'stars' },
  { word: 'shadow', label: 'Shadow', group: 'align' },
  { word: 'purified', label: 'Purified', group: 'align' },
  { word: 'xxs', label: 'XXS', group: 'size' },
  { word: 'xs', label: 'XS', group: 'size' },
  { word: 'xl', label: 'XL', group: 'size' },
  { word: 'xxl', label: 'XXL', group: 'size' },
  { word: 'costume', label: 'Costume', group: 'costume' },
  { word: 'locationbackground', label: 'Location background', group: 'bg' },
  { word: 'specialbackground', label: 'Special background', group: 'bg' },
  { word: 'dynamax', label: 'Dynamax', group: 'max' },
  { word: 'gigantamax', label: 'Gigantamax', group: 'max' },
  { word: 'female', label: 'Female', group: 'gender' },
  { word: 'male', label: 'Male', group: 'gender' },
  { word: 'legendary', label: 'Legendary', group: 'class' },
  { word: 'mythical', label: 'Mythical', group: 'class' },
];
const BY_WORD = new Map(GO_WORDS.map(w => [w.word, w]));

// Our search words -> GO's. Used to pre-pick words from what you searched for.
const FROM_OURS = {
  shiny: 'shiny', lucky: 'lucky', perfect: '4*', shadow: 'shadow', purified: 'purified', xxs: 'xxs', xs: 'xs', xl: 'xl',
  xxl: 'xxl', costume: 'costume', locationbackground: 'locationbackground', specialbackground: 'specialbackground',
  dynamax: 'dynamax', gigantamax: 'gigantamax', female: 'female', male: 'male', legendary: 'legendary', mythical: 'mythical',
};

/** 1,2,3,5,7,8,9 -> "1-3,5,7-9" (shorter strings fit GO's search box better). */
export function compressNumbers(nums) {
  const sorted = [...new Set(nums.map(Number).filter(n => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j - i >= 2 ? `${sorted[i]}-${sorted[j]}` : j > i ? `${sorted[i]},${sorted[j]}` : `${sorted[i]}`);
    i = j;
  }
  return out.join(',');
}

/**
 * picks: Map(word -> 'on' | 'not'). Same-group "on" words become one OR group; every "not" word is its own "!word".
 * Returns e.g. "xxs,xxl&shiny&!shadow&1-3,7".
 */
export function goSearchString(dexes, picks) {
  const groups = new Map();
  const nots = [];
  for (const w of GO_WORDS) {
    const state = picks.get(w.word);
    if (state === 'on') {
      if (!groups.has(w.group)) groups.set(w.group, []);
      groups.get(w.group).push(w.word);
    } else if (state === 'not') nots.push('!' + w.word);
  }
  const parts = [...[...groups.values()].map(g => g.join(',')), ...nots];
  const numbers = compressNumbers(dexes);
  if (numbers) parts.push(numbers);
  return parts.join('&');
}

/** Pre-pick GO words from a parsed query of ours ("xxl, shiny, !shadow, missing" -> xxl on, shiny on, shadow not). */
export function picksFromQuery(q) {
  const picks = new Map();
  for (const t of q.terms) {
    if (t.atoms.length !== 1) continue;            // an "either" term in our search has no single GO word
    const a = t.atoms[0];
    const word = FROM_OURS[a.def.key];
    if (word && BY_WORD.has(word)) picks.set(word, a.neg ? 'not' : 'on');
  }
  return picks;
}
