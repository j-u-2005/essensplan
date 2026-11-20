import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePlan, normalizeParams, rankCandidates } from '../src/lib/generator.js';
import { buildShopping } from '../src/lib/shopping.js';
import { planningWeek, mondayOf, addDays, isoWeekNumber, weekdayIndex, isValidISO } from '../src/lib/dates.js';
import { makePool, rules } from './helpers.mjs';

const defaults = normalizeParams(null, rules.defaults);
const make = (seed, over = {}, pool = makePool()) =>
  generatePlan({ recipes: pool, params: normalizeParams(over, defaults), rules, seed });

test('Struktur: Mo–Fr Frühstück/Mittag/Snack, Mo–Mi HelloFresh, Sa/So nur Abend', () => {
  const { items, warnings } = make(1);
  assert.equal(warnings.length, 0);
  const at = (d, s) => items.filter((i) => i.day === d && i.slot === s);
  for (let d = 0; d < 5; d++) for (const s of ['breakfast', 'lunch', 'snack']) assert.equal(at(d, s).length, 1, `${d} ${s}`);
  for (let d = 5; d < 7; d++) for (const s of ['breakfast', 'lunch', 'snack']) assert.equal(at(d, s).length, 0);
  for (let d = 0; d < 3; d++) {
    assert.equal(at(d, 'dinner')[0].kind, 'placeholder');
    assert.equal(at(d, 'dinner')[0].title, 'HelloFresh');
  }
  for (let d = 3; d < 7; d++) assert.equal(at(d, 'dinner')[0].kind, 'recipe');
});

test('Hafer höchstens einmal pro Woche, über viele Seeds', () => {
  const pool = makePool(80, 3);
  const byId = new Map(pool.map((r) => [r.id, r]));
  for (let seed = 1; seed <= 60; seed++) {
    const { items } = make(seed, {}, pool);
    const distinct = new Set(items.filter((i) => i.recipe_id && byId.get(i.recipe_id).oats).map((i) => i.recipe_id));
    assert.ok(distinct.size <= rules.oats_max_per_week, `Seed ${seed}: ${distinct.size} Hafer-Rezepte`);
  }
});

test('Bruder-Tage: Frühstück und Mittag sind kalt essbar', () => {
  const pool = makePool(80, 5);
  const byId = new Map(pool.map((r) => [r.id, r]));
  const brother = [true, false, true, true, false, false, false];
  for (let seed = 1; seed <= 40; seed++) {
    const { items } = make(seed, { brother }, pool);
    for (const i of items) {
      if (i.recipe_id && brother[i.day] && (i.slot === 'breakfast' || i.slot === 'lunch')) {
        assert.equal(byId.get(i.recipe_id).cold_ok, 1, `Seed ${seed} Tag ${i.day} ${i.slot}`);
      }
    }
  }
});

test('Portionen: 1 + Extras, Papa-kocht-Tage ohne Extras beim Mittag, Abend nach Personen', () => {
  const { items } = make(2, {
    lunch_extras: [3, 3, 3, 3, 3, 0, 0],
    breakfast_extras: [2, 2, 2, 2, 2, 0, 0],
    dad_cooks: [false, true, false, true, false, false, false],
    dinner_persons: [1, 1, 1, 3, 2, 1, 2],
  });
  const get = (d, s) => items.find((i) => i.day === d && i.slot === s);
  assert.equal(get(0, 'lunch').servings, 4);
  assert.equal(get(1, 'lunch').servings, 1);
  assert.equal(get(3, 'lunch').servings, 1);
  assert.equal(get(2, 'breakfast').servings, 3);
  assert.equal(get(0, 'snack').servings, 1);
  assert.equal(get(3, 'dinner').servings, 3);
  assert.equal(get(5, 'dinner').servings, 1);
});

test('keine doppelten Rezepte außer Meal-Prep-Blöcken und Resten; Blöcke sind zusammenhängend', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const { items } = make(seed);
    for (const slot of ['breakfast', 'lunch', 'snack']) {
      const days = new Map();
      for (const i of items.filter((x) => x.slot === slot && x.recipe_id && !x.leftover)) {
        days.set(i.recipe_id, [...(days.get(i.recipe_id) || []), i.day]);
      }
      for (const [, ds] of days) {
        for (let k = 1; k < ds.length; k++) assert.equal(ds[k], ds[k - 1] + 1, `Seed ${seed} ${slot}: Block nicht zusammenhängend`);
      }
    }
    const dinners = items.filter((i) => i.slot === 'dinner' && i.recipe_id).map((i) => i.recipe_id);
    assert.equal(new Set(dinners).size, dinners.length);
  }
});

test('Abendessen sind schnell, gesperrte/„nie wieder“-Rezepte kommen nie vor', () => {
  const pool = makePool(60, 11);
  pool.slice(0, 30).forEach((r) => (r.rating = -1));
  pool.slice(30, 45).forEach((r) => (r.blocked = 1));
  const byId = new Map(pool.map((r) => [r.id, r]));
  for (let seed = 1; seed <= 20; seed++) {
    const { items } = make(seed, {}, pool);
    for (const i of items.filter((x) => x.recipe_id)) {
      const r = byId.get(i.recipe_id);
      assert.ok(r.rating >= 0 && !r.blocked);
      if (i.slot === 'dinner') assert.ok(r.minutes <= rules.dinner_max_minutes * 1.5);
    }
  }
});

test('deterministisch bei gleichem Seed, anders bei anderem Seed', () => {
  const a = JSON.stringify(make(42).items);
  assert.equal(a, JSON.stringify(make(42).items));
  assert.notEqual(a, JSON.stringify(make(43).items));
});

test('kürzlich genutzte Rezepte werden gemieden, solange genug Alternativen existieren', () => {
  const pool = makePool(60, 9);
  const first = generatePlan({ recipes: pool, params: defaults, rules, seed: 5 });
  const recentIds = first.items.filter((i) => i.recipe_id).map((i) => i.recipe_id);
  const second = generatePlan({ recipes: pool, params: defaults, rules, seed: 5, recentIds });
  const overlap = second.items.filter((i) => i.recipe_id && recentIds.includes(i.recipe_id));
  assert.equal(overlap.length, 0);
});

test('zu kleiner Pool erzeugt Warnungen statt Absturz', () => {
  const pool = makePool(2, 1);
  const { items, warnings } = make(1, {}, pool);
  assert.ok(items.length > 0);
  assert.ok(warnings.length > 0);
});

test('Austausch-Kandidaten respektieren Bruder-Regel und Hafer-Limit', () => {
  const pool = makePool(50, 2);
  const params = normalizeParams({ brother: [true, true, true, true, true, false, false] }, defaults);
  const cands = rankCandidates({ pool, slot: 'lunch', day: 1, params, rules, counts: { oats: 1 }, limit: 20 });
  assert.ok(cands.length > 0);
  assert.ok(cands.every((r) => r.cold_ok === 1));
  const bf = rankCandidates({ pool, slot: 'breakfast', day: 1, params, rules, counts: { oats: 1 }, limit: 50 });
  assert.ok(bf.every((r) => !r.oats));
});

test('Einkaufsliste: Mengen skalieren, gleiche Zutaten werden zusammengefasst', () => {
  const entries = [
    { servings: 4, factor: 8, ingredients: [{ a: 200, u: 'g', n: 'Nudeln' }, { a: 2, u: null, n: 'Zwiebeln' }, { a: 1, u: 'TL', n: 'Salz' }, { a: null, u: null, n: 'Pfeffer' }] },
    { servings: 2, factor: 1, ingredients: [{ a: 1, u: null, n: 'Zwiebel' }, { a: 500, u: 'g', n: 'Hähnchenbrust' }, { a: 300, u: 'ml', n: 'Milch' }] },
  ];
  const { groups, pantry } = buildShopping(entries, rules);
  const flat = Object.fromEntries(groups.flatMap((g) => g.items.map((i) => [i.name, i.text])));
  assert.equal(flat['Nudeln'], '400 g Nudeln');
  assert.match(flat['Zwiebeln'], /^4,5 Zwiebeln$|^5 Zwiebeln$/);
  assert.equal(flat['Hähnchenbrust'], '250 g Hähnchenbrust');
  assert.ok(pantry.some((p) => /Salz/.test(p.name)));
  assert.ok(groups.find((g) => g.category === 'Fleisch & Wurst').items.some((i) => i.name === 'Hähnchenbrust'));
});

test('Datumslogik', () => {
  assert.equal(mondayOf('2026-11-20'), '2026-11-16');
  assert.equal(planningWeek(new Date('2026-11-20T12:00:00Z')), '2026-11-23'); // Freitag → nächste Woche
  assert.equal(planningWeek(new Date('2026-11-18T12:00:00Z')), '2026-11-16'); // Mittwoch → laufende Woche
  assert.equal(planningWeek(new Date('2026-11-22T23:30:00Z')), '2026-11-23'); // So 23:30 UTC = Mo 00:30 Berlin → Woche ab 23.11. (wird nicht übersprungen)
  assert.equal(addDays('2026-12-28', 7), '2027-01-04');
  assert.equal(isoWeekNumber('2026-11-23'), 48);
  assert.equal(isoWeekNumber('2026-12-28'), 53);
  assert.equal(weekdayIndex('2026-11-23'), 0);
  assert.equal(isValidISO('2026-02-30'), false);
});
