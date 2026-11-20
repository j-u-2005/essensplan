const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };

const UNITS = {
  g: 'g', gr: 'g', gramm: 'g', kg: 'kg', ml: 'ml', l: 'l', liter: 'l', cl: 'cl', dl: 'dl',
  el: 'EL', esslöffel: 'EL', tl: 'TL', teelöffel: 'TL',
  prise: 'Prise', prisen: 'Prise',
  bund: 'Bund', bd: 'Bund',
  dose: 'Dose', dosen: 'Dose',
  pck: 'Pck', päckchen: 'Pck', pkg: 'Pck', packung: 'Pck', pk: 'Pck',
  stk: 'Stk', stück: 'Stk', stücke: 'Stk',
  scheibe: 'Scheibe', scheiben: 'Scheibe',
  zehe: 'Zehe', zehen: 'Zehe',
  becher: 'Becher', glas: 'Glas', gläser: 'Glas', tasse: 'Tasse', tassen: 'Tasse', handvoll: 'Handvoll',
  zweig: 'Zweig', zweige: 'Zweig',
  stange: 'Stange', stangen: 'Stange',
  kopf: 'Kopf', köpfe: 'Kopf', knolle: 'Knolle', knollen: 'Knolle',
  würfel: 'Würfel', msp: 'Msp', messerspitze: 'Msp',
  schuss: 'Schuss', spritzer: 'Spritzer', tüte: 'Tüte', tüten: 'Tüte', beutel: 'Beutel',
  blatt: 'Blatt', blätter: 'Blatt',
};

const NUM = '(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+[.,]\\d+|\\d+[½¼¾⅓⅔⅛]?|[½¼¾⅓⅔⅛])';
const LEAD = new RegExp(`^(?:ca\\.?|circa|etwa|ungefähr)?\\s*(${NUM})(?:\\s*(?:-|–|—|bis)\\s*(${NUM}))?\\s*`, 'iu');

function toNumber(s) {
  s = s.trim().replace(',', '.');
  if (FRACTIONS[s] !== undefined) return FRACTIONS[s];
  let m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = s.match(/^(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) / Number(m[2]);
  m = s.match(/^(\d+)([½¼¾⅓⅔⅛])$/);
  if (m) return Number(m[1]) + FRACTIONS[m[2]];
  const v = parseFloat(s);
  return Number.isNaN(v) ? null : v;
}

const TO_BASE = { kg: ['g', 1000], l: ['ml', 1000], cl: ['ml', 10], dl: ['ml', 100] };

/** "200 g Mehl" → { a: 200, u: 'g', n: 'Mehl' } (a/u dürfen null sein) */
export function parseIngredient(raw) {
  let line = String(raw || '').replace(/\s+/g, ' ').trim();
  line = line.replace(/^[-–•*]\s*/, '');
  let amount = null;
  let unit = null;

  const m = line.match(LEAD);
  if (m) {
    const a = toNumber(m[1]);
    const b = m[2] ? toNumber(m[2]) : null;
    if (a !== null) {
      amount = b !== null ? (a + b) / 2 : a;
      line = line.slice(m[0].length);
      const um = line.match(/^([\p{L}]+)\.?(?=\s|$)/u);
      if (um) {
        const key = um[1].toLowerCase();
        if (UNITS[key]) {
          unit = UNITS[key];
          line = line.slice(um[0].length).trim();
        }
      }
    }
  }
  if (unit && TO_BASE[unit] && amount !== null) {
    const [base, factor] = TO_BASE[unit];
    amount *= factor;
    unit = base;
  }

  let name = line
    .replace(/\([^)]*\)/g, ' ')
    .split(',')[0]
    .replace(/^(?:von|vom|aus)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name) name = String(raw || '').trim();

  return { a: amount, u: unit, n: name };
}

const DESCRIPTORS =
  /\b(frische|frischer|frisches|frischen|gehackte|gehackter|gehacktes|gehackten|gemahlene|gemahlener|gemahlenes|große|großer|großes|kleine|kleiner|kleines|mittelgroße|mittelgroßer|reife|reifer|reifes|etwas|bio|geriebene|geriebener|geriebenes|gewürfelte|gewürfelter|gehobelte|getrocknete|getrockneter|tiefgekühlte|tiefgekühlter|tk)\b/gi;

/** Schlüssel zum Zusammenfassen gleicher Zutaten */
export function normalizeKey(name) {
  let k = String(name || '').toLowerCase().replace(DESCRIPTORS, ' ').replace(/\s+/g, ' ').trim();
  if (k.length > 5 && /(en|eln)$/.test(k)) k = k.slice(0, -1);
  return k;
}
