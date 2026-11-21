import { DAY_SHORT } from './dates.js';

export const SLOTS = ['breakfast', 'lunch', 'firma', 'snack', 'dinner'];
export const SLOT_ORDER = { breakfast: 0, lunch: 1, firma: 2, snack: 3, dinner: 4 };

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const truthy = (v) => v === true || v === 1 || v === 'true' || v === '1';

/** Wochenparameter (je 7 Werte, Mo–So) bereinigen und mit Standardwerten auffüllen */
export function normalizeParams(raw, defaults) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const arr = (key, conv) => {
    const given = Array.isArray(src[key]) ? src[key] : [];
    return Array.from({ length: 7 }, (_, i) => conv(given[i] ?? defaults[key][i]));
  };
  return {
    breakfast_extras: arr('breakfast_extras', (v) => clamp(Math.round(Number(v) || 0), 0, 4)),
    lunch_extras: arr('lunch_extras', (v) => clamp(Math.round(Number(v) || 0), 0, 4)),
    dad_cooks: arr('dad_cooks', truthy),
    brother: arr('brother', truthy),
    dinner_persons: arr('dinner_persons', (v) => clamp(Math.round(Number(v) || 1), 1, 3)),
    hellofresh: arr('hellofresh', truthy),
  };
}

export function servingsFor(slot, day, params) {
  if (slot === 'breakfast') return 1 + params.breakfast_extras[day];
  if (slot === 'lunch') return 1 + (params.dad_cooks[day] ? 0 : params.lunch_extras[day]);
  if (slot === 'snack') return 1;
  if (slot === 'firma') return params.lunch_extras[day];
  return params.dinner_persons[day];
}

function isEligible(r, slot, days, ctx, level, needBatch, minShelf) {
  if (ctx.used.has(r.id) && level < 3) return false;
  if (level < 1 && ctx.recent.has(r.id)) return false;
  if ((slot === 'breakfast' || slot === 'lunch') && days.some((d) => ctx.params.brother[d]) && !r.cold_ok) return false;
  if (slot === 'lunch' && !(r.cold_ok || r.micro_ok)) return false;
  if (slot === 'dinner' && r.minutes > ctx.rules.dinner_max_minutes * (level >= 2 ? 1.5 : 1)) return false;
  if (slot === 'snack' && r.minutes > ctx.rules.snack_max_minutes * (level >= 2 ? 2 : 1)) return false;
  if (r.oats && ctx.oats >= ctx.rules.oats_max_per_week) return false;
  if (needBatch && !r.batch_ok) return false;
  if (needBatch && level < 2 && r.shelf_days < minShelf) return false;
  return true;
}

function scoreRecipe(r, slot, ctx) {
  const w = ctx.rules.weights;
  let s = ctx.rng() * w.random;
  if (r.rating > 0) s += w.liked;
  if (r.fructose) s -= w.fructose;
  s -= (r.cost - 1) * w.cost;
  s -= (r.effort / 60) * w.effort;
  if (slot === 'breakfast') {
    if (r.sweet) s += w.sweet_breakfast;
    if (r.oats) s -= w.oats;
  }
  if (r.protein !== 'veg') s -= (ctx.protein[r.protein] || 0) * w.protein_repeat;
  if ((slot === 'lunch' || slot === 'dinner') && r.dtype !== 'sonstiges') s -= (ctx.dtype[r.dtype] || 0) * w.dtype_repeat;
  s -= (ctx.source[r.source] || 0) * w.source_repeat;
  if (slot !== 'dinner' && !ctx.effortSet.has(r.id) && ctx.effort + r.effort > ctx.rules.prep_max_minutes) s -= w.over_budget;
  return s;
}

function pickRecipe(slot, days, ctx, { needBatch = false, minShelf = 0 } = {}) {
  for (let level = 0; level <= 3; level++) {
    const cands = ctx.pool[slot].filter((r) => isEligible(r, slot, days, ctx, level, needBatch, minShelf));
    if (!cands.length) continue;
    let best = null;
    let bestScore = -Infinity;
    for (const r of cands) {
      const sc = scoreRecipe(r, slot, ctx);
      if (sc > bestScore) {
        bestScore = sc;
        best = r;
      }
    }
    return best;
  }
  return null;
}

function register(r, slot, ctx) {
  ctx.used.add(r.id);
  if (r.protein !== 'veg') ctx.protein[r.protein] = (ctx.protein[r.protein] || 0) + 1;
  if (r.dtype !== 'sonstiges') ctx.dtype[r.dtype] = (ctx.dtype[r.dtype] || 0) + 1;
  ctx.source[r.source] = (ctx.source[r.source] || 0) + 1;
  if (slot !== 'dinner' && !ctx.effortSet.has(r.id)) {
    ctx.effortSet.add(r.id);
    ctx.effort += r.effort;
  }
  if (r.oats) ctx.oats += 1;
}

function splitSegment(len, patterns, rng) {
  const fits = patterns.filter((p) => p.reduce((a, b) => a + b, 0) === len);
  if (fits.length) return fits[Math.floor(rng() * fits.length)];
  const out = [];
  let left = len;
  while (left > 0) {
    const n = left === 3 ? 3 : Math.min(2, left);
    out.push(n);
    left -= n;
  }
  return out;
}

function segments(days) {
  const out = [];
  let cur = [];
  for (const d of days) {
    if (cur.length && d !== cur[cur.length - 1] + 1) {
      out.push(cur);
      cur = [];
    }
    cur.push(d);
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * recipes: Zeilen aus der DB (Zahlen-Flags), ohne Zutaten
 * params: normalisierte Wochenparameter, rules: config/rules.json
 */
export function generatePlan({ recipes, params, rules, seed, recentIds = [] }) {
  const rng = mulberry32(seed);
  const ctx = {
    rules,
    params,
    rng,
    pool: { breakfast: [], lunch: [], firma: [], snack: [], dinner: [] },
    used: new Set(),
    recent: new Set(recentIds),
    protein: {},
    dtype: {},
    source: {},
    effort: 0,
    effortSet: new Set(),
    oats: 0,
  };
  for (const r of recipes) {
    if (r.blocked || r.rating < 0) continue;
    for (const s of SLOTS) if (r['s_' + s]) ctx.pool[s].push(r);
  }

  const items = [];
  const warnings = [];
  const addItem = (day, slot, r, extra = {}) =>
    items.push({
      day,
      slot,
      kind: 'recipe',
      recipe_id: r.id,
      title: r.title,
      servings: servingsFor(slot, day, params),
      note: null,
      leftover: 0,
      ...extra,
    });
  const addMissing = (day, slot) => {
    warnings.push(`Kein passendes Rezept für ${DAY_SHORT[day]} ${slot}`);
    items.push({
      day,
      slot,
      kind: 'custom',
      recipe_id: null,
      title: 'Noch kein Rezept – bitte auswählen',
      servings: servingsFor(slot, day, params),
      note: null,
      leftover: 0,
    });
  };

  // 1) Abendessen
  const dinnerByDay = {};
  for (let d = 0; d < 7; d++) {
    if (params.hellofresh[d]) {
      items.push({ day: d, slot: 'dinner', kind: 'placeholder', recipe_id: null, title: 'HelloFresh', servings: params.dinner_persons[d], note: null, leftover: 0 });
      continue;
    }
    const r = pickRecipe('dinner', [d], ctx);
    if (!r) {
      addMissing(d, 'dinner');
      continue;
    }
    register(r, 'dinner', ctx);
    dinnerByDay[d] = r;
    addItem(d, 'dinner', r);
  }

  // 2) Mittagessen: Reste vom Vorabend, sonst Meal-Prep-Blöcke
  const workdays = [0, 1, 2, 3, 4];
  const leftoverDays = [];
  for (const d of [1, 2, 3, 4]) {
    if (leftoverDays.length >= rules.max_leftovers) break;
    const dr = dinnerByDay[d - 1];
    if (!dr || !dr.s_lunch || !dr.leftover_ok) continue;
    if (params.brother[d] && !dr.cold_ok) continue;
    if (rng() >= rules.leftover_prob) continue;
    leftoverDays.push(d);
    addItem(d, 'lunch', dr, { leftover: 1, note: `Rest vom Abendessen (${DAY_SHORT[d - 1]})` });
  }

  const planSlot = (slot, days) => {
    for (const seg of segments(days)) {
      const lens = splitSegment(seg.length, rules.blocks[slot], rng);
      let pos = 0;
      for (const len of lens) {
        const blockDays = seg.slice(pos, pos + len);
        pos += len;
        let r = null;
        if (len > 1) r = pickRecipe(slot, blockDays, ctx, { needBatch: true, minShelf: len });
        if (r) {
          register(r, slot, ctx);
          for (const d of blockDays) addItem(d, slot, r);
        } else {
          for (const d of blockDays) {
            const single = pickRecipe(slot, [d], ctx);
            if (!single) {
              addMissing(d, slot);
              continue;
            }
            register(single, slot, ctx);
            addItem(d, slot, single);
          }
        }
      }
    }
  };

  planSlot('lunch', workdays.filter((d) => !leftoverDays.includes(d)));

  // Firma (Papa kocht dort): vorkochbare Gerichte, die in der Firma nur noch aufgewärmt werden
  for (const d of workdays) {
    if (!params.dad_cooks[d] || params.lunch_extras[d] < 1) continue;
    const r = pickRecipe('firma', [d], ctx);
    if (!r) {
      addMissing(d, 'firma');
      continue;
    }
    register(r, 'firma', ctx);
    addItem(d, 'firma', r, { note: 'Vorkochen, in der Firma nur aufwärmen' });
  }
  planSlot('breakfast', workdays);
  planSlot('snack', workdays);

  items.sort((a, b) => a.day - b.day || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot]);
  return { items, warnings, stats: { oats: ctx.oats, effort: ctx.effort } };
}

/** Für den Austausch einzelner Einträge in der App (Worker) */
export function rankCandidates({ pool, slot, day, params, rules, used = new Set(), recent = new Set(), counts = {}, rng = Math.random, limit = 10, excludeId = null }) {
  const ctx = {
    rules,
    params,
    rng,
    used,
    recent,
    protein: counts.protein || {},
    dtype: counts.dtype || {},
    source: counts.source || {},
    effort: counts.effort || 0,
    effortSet: counts.effortSet || new Set(),
    oats: counts.oats || 0,
  };
  return pool
    .filter((r) => !r.blocked && r.rating >= 0 && r.id !== excludeId && isEligible(r, slot, [day], ctx, 1, false, 0))
    .map((r) => ({ r, s: scoreRecipe(r, slot, ctx) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.r);
}
