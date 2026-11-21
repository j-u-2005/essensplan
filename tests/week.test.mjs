import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePlan, normalizeParams } from '../src/lib/generator.js';
import { buildPrepPlan } from '../src/lib/prep.js';
import { assembleWeek } from '../src/lib/weekdata.js';
import { renderPrintHtml } from '../public/printview.js';
import { makePool, rules } from './helpers.mjs';

const defaults = normalizeParams(null, rules.defaults);
const ING = [{ n: 'Reis', a: 200, u: 'g' }, { n: 'Karotte', a: 2, u: null }];

function weekFixture(seed = 3) {
  const pool = makePool(60, 5).map((r) => ({ ...r, servings: 4, ingredients: JSON.stringify(ING), url: 'https://example.org/' + r.id }));
  const { items } = generatePlan({ recipes: pool, params: defaults, rules, seed });
  return { pool, items: items.map((i, n) => ({ id: n + 1, ...i })) };
}

test('Firma-Gerichte nur an Papa-kocht-Tagen, mit Extras als Portionen', () => {
  const { items } = weekFixture();
  const firma = items.filter((i) => i.slot === 'firma');
  assert.deepEqual(firma.map((i) => i.day).sort(), [1, 3]);
  for (const f of firma) assert.equal(f.servings, defaults.lunch_extras[f.day]);
});

test('Vorbereitungsplan: Sessions nur Sonntag/Mittwoch, Zeitlimits als Warnung', () => {
  const { pool, items } = weekFixture();
  const byId = new Map(pool.map((r) => [r.id, r]));
  const prep = buildPrepPlan(items, byId, rules);
  for (const s of prep.sessions) assert.ok(['sun', 'mid'].includes(s.key));
  const mid = prep.sessions.find((s) => s.key === 'mid');
  if (mid) {
    const total = mid.tasks.reduce((a, t) => a + t.minutes, 0);
    if (total > rules.prep.midweek_max_minutes) assert.ok(prep.warnings.some((w) => /Abend/.test(w)));
  }
  // jedes Nicht-Abend-Gericht taucht genau einmal in Session oder "frisch" auf
  const planned = new Set(items.filter((i) => i.kind === 'recipe' && i.slot !== 'dinner' && !i.leftover).map((i) => i.recipe_id));
  const listed = [...prep.sessions.flatMap((s) => s.tasks), ...prep.fresh].map((t) => t.recipe_id);
  assert.equal(listed.length, new Set(listed).size);
  assert.deepEqual(new Set(listed), planned);
});

test('Einkaufsliste nennt, wann Zutaten gebraucht werden', () => {
  const { pool, items } = weekFixture();
  const { shopping } = assembleWeek(items, pool, rules);
  const all = shopping.groups.flatMap((g) => g.items);
  assert.ok(all.length > 0);
  assert.ok(all.every((i) => Array.isArray(i.when) && i.when.length > 0), 'jede Zutat hat einen Zeitpunkt');
  assert.ok(all.some((i) => i.when.some((w) => /Vorbereitung|Abend kochen|frisch/.test(w))));
});

test('Druckansicht: drei Seiten, kein Skript, HTML-escaped', () => {
  const { pool, items } = weekFixture();
  const { prep, shopping } = assembleWeek(items, pool, rules);
  const view = items.map((i) => ({ ...i, recipe_title: i.recipe_id ? `<b>T${i.recipe_id}</b>` : null, minutes: 20 }));
  const html = renderPrintHtml({ week: '2026-11-23', items: view, prep, shopping });
  assert.equal((html.match(/class="page"/g) || []).length, 3);
  assert.ok(!html.includes('<b>T'));
  assert.ok(html.includes('&lt;b&gt;T'));
  assert.ok(html.includes('Firma (Papa)'));
  assert.ok(html.includes('KW 48'));
});
