import { readFile } from 'node:fs/promises';
import { mulberry32 } from '../src/lib/generator.js';

export const rules = JSON.parse(await readFile(new URL('../config/rules.json', import.meta.url), 'utf8'));
export const blocklistConfig = JSON.parse(await readFile(new URL('../config/blocklist.json', import.meta.url), 'utf8'));

const PROTEINS = ['veg', 'veg', 'huhn', 'hack', 'schwein', 'ei', 'kaese', 'rind'];
const DTYPES = ['salat', 'suppe', 'pasta', 'reis', 'auflauf', 'wrap', 'bowl', 'pfanne', 'kartoffel', 'sonstiges'];
const SOURCES = ['lecker', 'edeka', 'eatsmarter', 'rewe', 'gutekueche'];

/** Künstlicher, aber realistisch gemischter Rezeptpool für Generator-Tests */
export function makePool(perSlot = 60, seed = 7) {
  const rng = mulberry32(seed);
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const recipes = [];
  let id = 1;
  const base = (slot) => {
    const shelf = pick([1, 2, 3, 3, 4, 4, 7]);
    const oats = slot === 'breakfast' && rng() < 0.4;
    return {
      id: id++,
      title: `${slot}-${id}`,
      source: pick(SOURCES),
      minutes: slot === 'dinner' ? 15 + Math.floor(rng() * 40) : 10 + Math.floor(rng() * 25),
      effort: 5 + Math.floor(rng() * 30),
      s_breakfast: 0, s_lunch: 0, s_firma: 0, s_snack: 0, s_dinner: 0,
      cold_ok: rng() < 0.55 ? 1 : 0,
      micro_ok: 1,
      shelf_days: shelf,
      batch_ok: shelf >= 3 ? 1 : 0,
      sweet: slot === 'breakfast' && rng() < 0.7 ? 1 : 0,
      oats: oats ? 1 : 0,
      fructose: rng() < 0.1 ? 1 : 0,
      cost: 1 + Math.floor(rng() * 3),
      protein: pick(PROTEINS),
      dtype: pick(DTYPES),
      leftover_ok: shelf >= 3 ? 1 : 0,
      rating: 0,
      blocked: 0,
    };
  };
  for (const slot of ['breakfast', 'lunch', 'snack', 'dinner']) {
    for (let i = 0; i < perSlot; i++) {
      const r = base(slot);
      r['s_' + slot] = 1;
      if (slot === 'lunch' && rng() < 0.5) {
        r.s_firma = 1;
        r.shelf_days = Math.max(r.shelf_days, 3);
        r.dtype = pick(['suppe', 'reis', 'auflauf', 'pasta', 'pfanne']);
      }
      if (slot === 'dinner' && rng() < 0.4) r.s_lunch = 1;
      recipes.push(r);
    }
  }
  return recipes;
}
