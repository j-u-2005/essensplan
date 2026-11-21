import { normalizeKey } from './ingredients.js';

const CATEGORIES = [
  ['Tiefkühl', /(tiefkühl|tk-|^tk )/u],
  ['Konserven & Saucen', /(passiert|tomatenmark|sauce|soße|brühe|fond|ketchup|essig|sojasauce|pesto|kokosmilch|dosentomate|gehackte tomate|geschälte tomate|\bdose\b)/u],
  ['Fleisch & Wurst', /(hähnchen|hühnchen|pute|hack|rind|schwein|schinken|speck|bacon|wurst|salami|geflügel|steak|gulasch|schnitzel|lamm|filet)/u],
  ['Milch & Eier', /(milch|sahne|joghurt|quark|käse|butter|(^|\s)eier?($|\s)|eigelb|eiweiß|mozzarella|schmand|crème|skyr|frischkäse|margarine|ricotta)/u],
  ['Brot & Backwaren', /(brot|brötchen|toast|tortilla|wrap|fladen|baguette|burgerbrötchen|croissant|pita)/u],
  ['Nudeln, Reis & Trockenware', /(nudel|pasta|spaghetti|penne|reis|couscous|bulgur|linsen|haferflocken|müsli|mehl|grieß|polenta|cornflakes|zucker|stärke|semmelbrösel|panko|nuss|nüsse|mandel|kokos|schokolade|kakao|rosinen|chia|leinsamen|hefe|backpulver|honig|ahornsirup)/u],
  ['Gewürze & Öl', /(gewürz|pulver|curry|zimt|oregano|thymian|rosmarin|muskat|kreuzkümmel|kümmel|chili|vanille|\böl\b|öl$|salz|pfeffer|paprika edelsüß)/u],
  ['Obst & Gemüse', /(tomate|gurke|salat|zwiebel|knoblauch|karotte|möhre|paprika|zucchini|kartoffel|apfel|äpfel|banane|beere|zitrone|limette|orange|lauch|spinat|brokkoli|blumenkohl|kohl|kürbis|süßkartoffel|ingwer|petersilie|basilikum|schnittlauch|dill|koriander|minze|rucola|avocado|sellerie|radieschen|rote bete|fenchel|mais|erbsen|bohne|obst|traube|birne|kiwi|ananas|pfirsich|spargel|aubergine|kräuter|schalotte|pak choi|mangold|rettich|kohlrabi|pastinake|petersilienwurzel|melone|nektarine)/u],
];

function categoryOf(name) {
  const n = name.toLowerCase();
  for (const [cat, re] of CATEGORIES) if (re.test(n)) return cat;
  return 'Sonstiges';
}

function roundAmount(amount, unit) {
  if (unit === 'g' || unit === 'ml') {
    if (amount < 20) return Math.ceil(amount);
    return Math.ceil(amount / 5) * 5;
  }
  if (!unit || ['Stk', 'Zehe', 'Scheibe', 'Dose', 'Pck', 'Bund', 'Becher', 'Kopf', 'Knolle', 'Stange', 'Zweig', 'Blatt', 'Glas', 'Tüte', 'Beutel'].includes(unit)) {
    return Math.ceil(amount * 2 - 1e-9) / 2;
  }
  return Math.round(amount * 2) / 2 || 0.5;
}

function fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}

function displayAmount(amount, unit) {
  if (amount === null) return '';
  if (unit === 'g' && amount >= 1000) return `${fmt(amount / 1000)} kg`;
  if (unit === 'ml' && amount >= 1000) return `${fmt(amount / 1000)} l`;
  return `${fmt(amount)}${unit ? ' ' + unit : ''}`;
}

/**
 * entries: [{ ingredients: [{a,u,n}], servings: Rezept-Portionen, factor: Summe der benötigten Portionen,
 *             labels?: [{ text, rank }] (wann die Zutat gebraucht wird) }]
 * factor ist bereits "Portionen gesamt" (inkl. Mittags-Faktor); Skalierung = factor / servings
 * → { groups: [{ category, items: [{ name, text, when: string[], rank }] }], pantry: [...] }
 */
export function buildShopping(entries, rules) {
  const pantryRe = new RegExp(rules.pantry, 'iu');
  const map = new Map();

  for (const e of entries) {
    const base = e.servings > 0 ? e.servings : 4;
    const scale = e.factor / base;
    for (const ing of e.ingredients) {
      const key = `${normalizeKey(ing.n)}|${ing.u || ''}`;
      let slot = map.get(key);
      if (!slot) {
        slot = { name: ing.n, unit: ing.u, amount: null, count: 0, labels: new Map() };
        map.set(key, slot);
      }
      slot.count += 1;
      for (const l of e.labels || []) if (!slot.labels.has(l.text) || slot.labels.get(l.text) > l.rank) slot.labels.set(l.text, l.rank);
      if (ing.a !== null && ing.a !== undefined) slot.amount = (slot.amount ?? 0) + ing.a * scale;
    }
  }

  const grouped = new Map();
  const pantry = [];
  for (const slot of map.values()) {
    const amount = slot.amount === null ? null : roundAmount(slot.amount, slot.unit);
    const text = amount === null ? slot.name : `${displayAmount(amount, slot.unit)} ${slot.name}`;
    const sorted = [...slot.labels.entries()].sort((a, b) => a[1] - b[1]);
    const item = { name: slot.name, text, when: sorted.map(([t]) => t), rank: sorted.length ? sorted[0][1] : 999 };
    if (pantryRe.test(slot.name.toLowerCase().trim())) {
      pantry.push(item);
      continue;
    }
    const cat = categoryOf(slot.name);
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat).push(item);
  }

  const order = CATEGORIES.map((c) => c[0]).concat('Sonstiges');
  const groups = [...grouped.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([category, items]) => ({ category, items: items.sort((a, b) => a.name.localeCompare(b.name, 'de')) }));
  pantry.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return { groups, pantry };
}
