/**
 * Erzeugt den Wochenplan und schreibt ihn in die D1-Datenbank.
 *
 * Umgebungsvariablen:
 *   WEEK_START  Montag der Zielwoche (YYYY-MM-DD); Standard: automatisch (Fr–So → nächste Woche)
 *   FORCE=1     vorhandenen Plan der Woche überschreiben (sonst: überspringen)
 *   SEED        feste Zufallszahl (Standard: neu gewürfelt)
 *   NTFY_TOPIC  optional: Push-Benachrichtigung über ntfy.sh
 */
import { readFile, writeFile } from 'node:fs/promises';
import { d1, d1Batch } from './d1.mjs';
import { generatePlan, normalizeParams } from '../src/lib/generator.js';
import { planningWeek, addDays, isValidISO, mondayOf, isoWeekNumber, formatShort } from '../src/lib/dates.js';

const rules = JSON.parse(await readFile(new URL('../config/rules.json', import.meta.url), 'utf8'));

const week = process.env.WEEK_START ? mondayOf(process.env.WEEK_START) : planningWeek();
if (!isValidISO(week)) {
  console.error(`Ungültiges Datum: ${process.env.WEEK_START}`);
  process.exit(1);
}
console.log(`Zielwoche: ${week} (KW ${isoWeekNumber(week)})`);

const existing = await d1('SELECT week_start FROM plans WHERE week_start = ?', [week]);
if (existing.length && process.env.FORCE !== '1') {
  console.log('Für diese Woche existiert bereits ein Plan – übersprungen (FORCE=1 zum Überschreiben).');
  process.exit(0);
}

// Parameter: Wochen-Override → Standard aus der App → Standard aus config/rules.json
const settingsRows = await d1('SELECT key, value FROM settings WHERE key IN (?, ?)', [`params:${week}`, 'defaults']);
const settings = Object.fromEntries(settingsRows.map((r) => [r.key, JSON.parse(r.value)]));
const defaults = normalizeParams(settings.defaults, rules.defaults);
const params = normalizeParams(settings[`params:${week}`], defaults);

// Rezepte ohne Zutatenlisten laden
const recipes = [];
for (let offset = 0; ; offset += 2000) {
  const rows = await d1(
    `SELECT id, title, source, minutes, effort, s_breakfast, s_lunch, s_snack, s_dinner, cold_ok, micro_ok,
            shelf_days, batch_ok, sweet, oats, fructose, cost, protein, dtype, leftover_ok, s_firma, rating, blocked
       FROM recipes WHERE blocked = 0 AND rating >= 0 ORDER BY id LIMIT 2000 OFFSET ?`,
    [offset],
  );
  recipes.push(...rows);
  if (rows.length < 2000) break;
}
console.log(`${recipes.length} nutzbare Rezepte geladen.`);
if (recipes.length < 40) {
  console.error('Zu wenige Rezepte – bitte zuerst den Import ausführen (mehrfach, bis mindestens ~300 Rezepte vorhanden sind).');
  process.exit(1);
}

const since = addDays(week, -7 * rules.no_repeat_weeks);
const recentRows = await d1('SELECT DISTINCT recipe_id FROM plan_items WHERE recipe_id IS NOT NULL AND week_start >= ? AND week_start < ?', [since, week]);
const recentIds = recentRows.map((r) => r.recipe_id);

const seed = process.env.SEED ? Number(process.env.SEED) : Math.floor(Math.random() * 2 ** 31);
const { items, warnings, stats } = generatePlan({ recipes, params, rules, seed, recentIds });

const statements = [
  { sql: 'DELETE FROM plan_items WHERE week_start = ?', params: [week] },
  { sql: 'DELETE FROM plans WHERE week_start = ?', params: [week] },
  { sql: 'INSERT INTO plans (week_start, created_at, seed, params) VALUES (?,?,?,?)', params: [week, new Date().toISOString(), seed, JSON.stringify(params)] },
  ...items.map((i) => ({
    sql: 'INSERT INTO plan_items (week_start, day, slot, kind, recipe_id, title, servings, note, leftover) VALUES (?,?,?,?,?,?,?,?,?)',
    params: [week, i.day, i.slot, i.kind, i.recipe_id, i.recipe_id ? null : i.title, i.servings, i.note, i.leftover],
  })),
];
await d1Batch(statements);
await writeFile('plan-created.flag', week);

console.log(`Plan gespeichert: ${items.length} Einträge, Seed ${seed}, Haferbrei/Oats ${stats.oats}×, Vorbereitungsaufwand ca. ${stats.effort} min.`);
warnings.forEach((w) => console.warn('Warnung: ' + w));

if (process.env.NTFY_TOPIC) {
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(process.env.NTFY_TOPIC)}`, {
      method: 'POST',
      headers: { Title: 'Essensplan fertig' },
      body: `Plan für KW ${isoWeekNumber(week)} (ab ${formatShort(week)}) ist bereit.${warnings.length ? ` ${warnings.length} Lücke(n).` : ''}`,
    });
  } catch (e) {
    console.warn('ntfy fehlgeschlagen: ' + e.message);
  }
}
